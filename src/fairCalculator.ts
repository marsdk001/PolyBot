// src/fairCalculator.ts
import { AssetSymbol, Exchange, FairProbs, MarketBook } from "./types";
import { GBMFairProbability } from "./gbm";
import { ACTIVE_EXCHANGES, DELTA_ANCHOR_EXCHANGE } from "./constants";

export class FairCalculator {
  // Hybrid fair probabilities (main output)
  public fairProbs: Record<AssetSymbol, FairProbs> = {
    BTC: { UP: 0.5, DOWN: 0.5 },
    ETH: { UP: 0.5, DOWN: 0.5 },
    SOL: { UP: 0.5, DOWN: 0.5 },
    XRP: { UP: 0.5, DOWN: 0.5 },
  };

  // Per-exchange UP probabilities
  public fairByExchange: Record<AssetSymbol, Record<Exchange, number>> = {
    BTC: {} as Record<Exchange, number>,
    ETH: {} as Record<Exchange, number>,
    SOL: {} as Record<Exchange, number>,
    XRP: {} as Record<Exchange, number>,
  };

  // Basis: Poly - GBM (The structural offset)
  private basis: Record<AssetSymbol, Record<Exchange, number>> = {
    BTC: {} as Record<Exchange, number>,
    ETH: {} as Record<Exchange, number>,
    SOL: {} as Record<Exchange, number>,
    XRP: {} as Record<Exchange, number>,
  };

  // Latch Timer: Tracks how long we've been diverged (for timeout)
  private latchStart: Record<AssetSymbol, Record<Exchange, number>> = {
    BTC: {} as Record<Exchange, number>,
    ETH: {} as Record<Exchange, number>,
    SOL: {} as Record<Exchange, number>,
    XRP: {} as Record<Exchange, number>,
  };

  constructor(
    private gbm: Record<AssetSymbol, Record<Exchange, GBMFairProbability>>,
    private getCurrentPrice: (
      symbol: AssetSymbol,
      exchange: Exchange
    ) => number,
    private getStartPrice: (symbol: AssetSymbol, exchange: Exchange) => number,
    private getMarketStartTime: (symbol: AssetSymbol) => number,
    private getPolyBook: (
      symbol: AssetSymbol
    ) => Record<"UP" | "DOWN", MarketBook>
  ) {}

  updateAllFairs(now: number) {
    (["BTC", "ETH", "SOL", "XRP"] as AssetSymbol[]).forEach((symbol) => {
      this.updatePerExchangeFairs(symbol, now);
      this.updateHybridFair(symbol, now);
    });
  }

  private updatePerExchangeFairs(symbol: AssetSymbol, now: number) {
    const marketStartTime = this.getMarketStartTime(symbol);
    if (!marketStartTime || marketStartTime <= 0) return;

    const minsLeft = (marketStartTime + 900_000 - now) / 60_000;
    if (minsLeft <= 0) return;

    ACTIVE_EXCHANGES.forEach((exch) => {
      const currentPrice = this.getCurrentPrice(symbol, exch);
      const startPrice = this.getStartPrice(symbol, exch);

      if (currentPrice <= 0 || startPrice <= 0) {
        this.fairByExchange[symbol][exch] = 0.5;
        return;
      }

      const fairUp = this.gbm[symbol][exch].calculate(
        currentPrice,
        startPrice,
        minsLeft
      ).UP;

      const polyUp = this.getPolyBook(symbol).UP.mid;

      // Basis Calibration & Spike Logic
      // 1. Calculate velocity of underlying asset
      const recentPct = this.gbm[symbol][exch].getRecentPctChange(500);
      const isSpike = Math.abs(recentPct) > 0.035; // > 0.05% move in 1s

      if (polyUp > 0) {
        // Initialize basis if missing
        if (this.basis[symbol][exch] === undefined) {
          this.basis[symbol][exch] = polyUp - fairUp;
        }

        // If calm, update basis to align GBM with Poly (Basis = Poly - GBM)
        // If spiking, freeze basis at pre-spike level
        if (isSpike) {
          // Spike detected: Reset latch timer, freeze basis (let Fair move away from Poly)
          this.latchStart[symbol][exch] = 0;
        } else {
          const currentBasis = this.basis[symbol][exch];
          const projectedFair = fairUp + currentBasis;
          const diff = Math.abs(projectedFair - polyUp);
          const rawDiff = Math.abs(fairUp - polyUp);

          // Convergence Latch with Timeout
          if (diff < 0.005 || rawDiff < 0.005) {
            // Converged: Snap basis to track Poly precisely
            this.basis[symbol][exch] = polyUp - fairUp;
            this.latchStart[symbol][exch] = 0;
          } else {
            // Diverged: Check timeout
            if (!this.latchStart[symbol][exch]) {
              this.latchStart[symbol][exch] = now;
            }

            // If diverged for > 3 seconds, give up and snap (prevent permanent divergence)
            // Otherwise, hold basis frozen (no smoothing)
            if (now - this.latchStart[symbol][exch] > 3000) {
              this.basis[symbol][exch] = polyUp - fairUp;
              this.latchStart[symbol][exch] = 0;
            }
          }
        }
      }

      const currentBasis = this.basis[symbol][exch] || 0;
      const calibratedFair = fairUp + currentBasis;

      this.fairByExchange[symbol][exch] = Math.max(
        0.001,
        Math.min(0.999, calibratedFair)
      );
    });
  }

  private updateHybridFair(symbol: AssetSymbol, now: number) {
    // Use the configured Anchor Exchange for the main hybrid calculation
    // If Anchor is AVERAGE, fallback to BINANCE for volatility (GBM) source
    const anchor =
      (DELTA_ANCHOR_EXCHANGE as string) === "AVERAGE" ? "BINANCE" : (DELTA_ANCHOR_EXCHANGE as Exchange);
    const gbm = this.gbm[symbol][anchor];

    const currentPrice = this.getCurrentPrice(symbol, anchor);
    const startPrice = this.getStartPrice(symbol, anchor);
    const marketStartTime = this.getMarketStartTime(symbol);

    if (currentPrice <= 0 || startPrice <= 0 || marketStartTime <= 0) return;

    const minsLeft = (marketStartTime + 900_000 - now) / 60_000;
    if (minsLeft <= 0) return;

    const gbmFair = gbm.calculate(currentPrice, startPrice, minsLeft);

    const polyUp = this.getPolyBook(symbol).UP.mid;
    const polyDown = this.getPolyBook(symbol).DOWN.mid;
    if (polyUp <= 0 || polyDown <= 0) return;

    // Apply Basis Calibration to Hybrid Fair as well
    const currentBasis = this.basis[symbol][anchor] || 0;
    const hybridUp = gbmFair.UP + currentBasis;
    const clampedUp = Math.max(0.001, Math.min(0.999, hybridUp));

    this.fairProbs[symbol].UP = clampedUp;
    this.fairProbs[symbol].DOWN = 1 - clampedUp;

    // Safety: if somehow NaN (e.g., log(0) or bad sigma), fallback to poly or 0.5
    if (isNaN(this.fairProbs[symbol].UP)) {
      console.warn(
        `⚠️ NaN detected in hybrid fair for ${symbol} — falling back to Poly mid`
      );
      this.fairProbs[symbol].UP = this.getPolyBook(symbol).UP.mid || 0.5;
      this.fairProbs[symbol].DOWN = 1 - this.fairProbs[symbol].UP;
    }
  }

  getCombinedExchangeFair(symbol: AssetSymbol): number {
    const values = Object.entries(this.fairByExchange[symbol])
      .filter(([exch]) => exch !== DELTA_ANCHOR_EXCHANGE && exch !== "DEEPCOIN" && exch !== "COINBASE" && exch !== "BINANCE")
      .map(([, v]) => v)
      .filter((v) => v > 0 && v < 1);

    const polyMid = this.getPolyBook(symbol).UP.mid;

    if (values.length === 0) {
      return polyMid || 0.5;
    }

    const rawAvg = values.reduce((sum, v) => sum + v, 0) / values.length;

    if (!polyMid || polyMid <= 0) {
      return rawAvg;
    }

    // Since individual fairs are already calibrated to Poly, we just average them.
    return Math.max(0.001, Math.min(0.999, rawAvg));
  }
}

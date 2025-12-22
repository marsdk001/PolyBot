// src/fairCalculator.ts
import { AssetSymbol, Exchange, FairProbs, MarketBook } from "./types";
import { GBMFairProbability } from "./gbm";

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

    const exchanges: Exchange[] = [
      "BINANCE",
      "BYBIT",
      "GATE",
      "OKX",
      "MEXC",
      "BITGET",
      "DEEPCOIN",
    ];

    exchanges.forEach((exch) => {
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

      // Light tether to Poly (15%)
      const tethered = fairUp * 0.85 + polyUp * 0.15;

      this.fairByExchange[symbol][exch] = Math.max(
        0.001,
        Math.min(0.999, tethered)
      );
    });
  }

  private updateHybridFair(symbol: AssetSymbol, now: number) {
    const gbm = this.gbm[symbol].BINANCE;

    const currentPrice = this.getCurrentPrice(symbol, "BINANCE");
    const startPrice = this.getStartPrice(symbol, "BINANCE");
    const marketStartTime = this.getMarketStartTime(symbol);

    if (currentPrice <= 0 || startPrice <= 0 || marketStartTime <= 0) return;

    const minsLeft = (marketStartTime + 900_000 - now) / 60_000;
    if (minsLeft <= 0) return;

    const gbmFair = gbm.calculate(currentPrice, startPrice, minsLeft);

    const polyUp = this.getPolyBook(symbol).UP.mid;
    const polyDown = this.getPolyBook(symbol).DOWN.mid;
    if (polyUp <= 0 || polyDown <= 0) return;

    const moneyness = Math.abs(Math.log(currentPrice / startPrice));
    const timeFactor = Math.min(1, minsLeft / 15);

    let alpha = 0.25 + 0.65 * (1 - Math.exp(-moneyness * 4)) * (1 - timeFactor);
    alpha = Math.max(0.15, Math.min(0.9, alpha));

    const hybridUp = (1 - alpha) * gbmFair.UP + alpha * polyUp;
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
      .filter(([exch]) => exch !== "BINANCE" && exch !== "DEEPCOIN")  // ← Exclude Deepcoin too
      .map(([, v]) => v)
      .filter((v) => v > 0 && v < 1);

    if (values.length === 0) {
      return this.getPolyBook(symbol).UP.mid || 0.5;
    }

    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.max(0.001, Math.min(0.999, average)); // Clamp for safety
  }
}

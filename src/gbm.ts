// src/gbm.ts
import { AssetSymbol, Exchange } from "./types";

export class GBMFairProbability {
  private history: { ts: number; price: number }[] = [];
  private ewmaVariance = 0;

  // Fair smoothing memory
  private lastFairUp: number | null = null;

  constructor(
    private readonly LAMBDA: number = 0.983,
    private readonly MIN_SIGMA_PER_MIN: number = 0.0004
  ) {}

  addPrice(price: number) {
    const now = Date.now();
    this.history.push({ ts: now, price });

    // Keep max 48 hours of data
    const cutoff = now - 48 * 60 * 60 * 1000;
    this.history = this.history.filter((p) => p.ts > cutoff);

    if (this.history.length > 1) {
      const prevPrice = this.history[this.history.length - 2].price;
      if (prevPrice > 0 && price > 0) {
        const r = Math.log(price / prevPrice);
        this.ewmaVariance =
          this.LAMBDA * this.ewmaVariance + (1 - this.LAMBDA) * r * r;
      }
    }
  }

  preloadHistoricalPrices(prices: number[]) {
    this.history = [];
    this.ewmaVariance = 0;
    this.lastFairUp = null;

    for (const price of prices) {
      if (price > 0) this.addPrice(price);
    }

    console.log(
      `Preloaded ${prices.length} historical prices → EWMA volatility initialized`
    );
  }

  // % move over last ms
  getRecentPctChange(ms: number): number {
    if (this.history.length < 2) return 0;
    const now = this.history[this.history.length - 1].ts;
    const target = now - ms;
    const past = [...this.history].reverse().find((p) => p.ts <= target);
    if (!past) return 0;
    const curr = this.history[this.history.length - 1].price;
    return ((curr - past.price) / past.price) * 100;
  }

  private normCDF(x: number): number {
    const y = x * Math.sqrt(0.5);  // Fixed: Math.sqrt(0.5) instead of undefined Math.SQRT1_2
    if (y <= -8) return 0;
    if (y >= 8) return 1;
  
    const z = Math.abs(y);
    const t = 1 / (1 + 0.5 * z);
  
    const poly =
      t *
      (1.00002368 +
        t *
          (0.37409196 +
            t *
              (0.09678418 +
                t *
                  (-0.18628806 +
                    t *
                      (0.27886807 +
                        t *
                          (-1.13520398 +
                            t *
                              (1.48851587 +
                                t * (-0.82215223 + t * 0.17087277))))))));
  
    const tau = t * Math.exp(-z * z - 1.26551223 + poly);
    const erf = y >= 0 ? 1 - tau : tau - 1;
  
    return 0.5 * (1 + erf);
  }

  estimateVolatilityPerMinute(): number {
    if (this.ewmaVariance === 0) return this.MIN_SIGMA_PER_MIN;
    const sigmaPerSample = Math.sqrt(this.ewmaVariance);
    const sigmaPerMinute = sigmaPerSample * Math.sqrt(60);
    return Math.max(sigmaPerMinute, this.MIN_SIGMA_PER_MIN);
  }

  /**
   * Main fair probability calculator
   *
   * Spike behavior:
   * - Near start + early → inflate sigma, reduce trust
   * - Far from start or late → spikes mostly ignored
   * - Fair relaxes smoothly over time
   */
  calculate(
    currentPrice: number,
    startPrice: number,
    minutesRemaining: number
  ): { UP: number; DOWN: number } {
    if (minutesRemaining <= 0 || currentPrice <= 0 || startPrice <= 0) {
      const up = currentPrice >= startPrice ? 1 : 0;
      return { UP: up, DOWN: 1 - up };
    }

    const tau = minutesRemaining;
    const baseSigma = this.estimateVolatilityPerMinute();

    // --- Spike / shock detection ---
    const recentPct = Math.abs(this.getRecentPctChange(2000)); // 2s shock
    const spikeThreshold = 0.15; // % move considered a shock
    const spikeSeverity = Math.min(1, recentPct / spikeThreshold);

    // --- Option-aware weighting ---
    const moneyness = Math.abs(Math.log(currentPrice / startPrice));
    const timeFactor = Math.min(1, tau / 15);

    // Spike relevance decays with distance & time
    const shockWeight = spikeSeverity * Math.exp(-moneyness * 6) * timeFactor;

    // Inflate sigma (vega effect)
    const effectiveSigma = baseSigma * (1 + shockWeight * 1.5);

    const d =
      (Math.log(currentPrice / startPrice) -
        effectiveSigma * effectiveSigma * 0.5 * tau) /
      (effectiveSigma * Math.sqrt(tau));

    let fairUp = this.normCDF(d);
    fairUp = Math.max(0.001, Math.min(0.999, fairUp));

    // --- Relaxation (critical for smoothing) ---
    const relax = 0.08 + 0.25 * Math.exp(-moneyness * 5) * timeFactor;

    if (this.lastFairUp == null) {
      this.lastFairUp = fairUp;
    } else {
      this.lastFairUp = this.lastFairUp * (1 - relax) + fairUp * relax;
    }

    return {
      UP: this.lastFairUp,
      DOWN: 1 - this.lastFairUp,
    };
  }
}
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

    // Keep max 60 seconds of data (we only need ~2s for recent change)
    const cutoff = now - 60 * 1000;
    while (this.history.length > 0 && this.history[0].ts < cutoff) {
      this.history.shift();
    }

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

    // Iterate backwards without copying array
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].ts <= target) {
        const past = this.history[i];
        const curr = this.history[this.history.length - 1].price;
        return ((curr - past.price) / past.price) * 100;
      }
    }
    return 0;
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
    let sigma = this.estimateVolatilityPerMinute();

    // --- 2. Gamma / Gap Risk (Theta) ---
    // As time -> 0, enforce a higher volatility floor to represent execution/gap risk.
    // This prevents probabilities from snapping to 0/1 too aggressively in the final seconds.
    const gapRisk = 0.001 / Math.max(0.1, Math.sqrt(tau));
    sigma = Math.max(sigma, gapRisk);

    const d =
      Math.log(currentPrice / startPrice) / (sigma * Math.sqrt(tau));

    let fairUp = this.normCDF(d);
    fairUp = Math.max(0.001, Math.min(0.999, fairUp));

    // No smoothing (snappy response)
    this.lastFairUp = fairUp;

    return {
      UP: fairUp,
      DOWN: 1 - fairUp,
    };
  }
}
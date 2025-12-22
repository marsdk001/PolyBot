// src/types.ts

export type Exchange =
  | "BINANCE"
  | "BYBIT"
  | "GATE"
  | "OKX"
  | "ASTER"
  | "HYPER"
  | "MEXC"
  | "BITGET"
  | "DEEPCOIN";

// Forward declaration: we don't need the full class, just the shape for mapping
export type GBMFairProbabilityInstance = {
  addPrice(price: number): void;
  calculate(currentPrice: number, startPrice: number, minutesRemaining: number): { UP: number; DOWN: number };
  getRecentPctChange(ms: number): number;
  estimateVolatilityPerMinute(): number;
  preloadHistoricalPrices?(prices: number[]): void;
  // Add other methods you use if needed
};

export type GBMMap = Record<Exchange, GBMFairProbabilityInstance>;

export type FairByExchange = Record<Exchange, number>;

export type PlotPoint = {
  ts: number;

  // Base delta (Binance reference)
  pctDelta: number;

  // Per-exchange deltas
  deltaBybit?: number;
  deltaGate?: number;
  deltaOkx?: number;
  deltaAster?: number;
  deltaHyper?: number;
  deltaMexc?: number;
  deltaBitget?: number;
  deltaDeepcoin?: number;

  // 🔹 Hybrid fair (current production logic)
  fairUp?: number;
  fairDown?: number;

  fairCombined?: number;

  // 🔹 Per-exchange GBM fairs (UP probability %)
  fairBinance?: number;
  fairBybit?: number;
  fairGate?: number;
  fairOkx?: number;
  fairAster?: number;
  fairHyper?: number;
  fairMexc?: number;
  fairBitget?: number;
  fairDeepcoin?: number;

  // Polymarket mids
  polyUp?: number;
  polyDown?: number;

  // Edge vs hybrid fair
  edgeUp?: number;
  edgeDown?: number;
};

export type AssetSymbol = "BTC" | "ETH" | "SOL" | "XRP";

export interface FairProbs {
  UP: number;
  DOWN: number;
}

export interface MarketBook {
  bid: number;
  ask: number;
  mid: number;
}

export interface PolyPoint {
  ts: number;
  up: number;
  down: number;
}
// src/auto_trading_bot.ts
import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import WebSocket from "ws";
import * as dotenv from "dotenv";
import * as path from "path";
import readline from "readline";
import fs from "fs";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const PLOT_INTERVAL_SEC = 60; // 5 minutes (CHANGE TO 3600 LATER)
const SAMPLE_INTERVAL_MS = 100;
const PLOT_POINTS = (PLOT_INTERVAL_SEC * 1000) / SAMPLE_INTERVAL_MS;
const PLOTS_DIR = "./plots";

type Exchange =
  | "BINANCE"
  | "BYBIT"
  | "GATE"
  | "OKX"
  | "ASTER"
  | "HYPER"
  | "MEXC"
  | "BITGET"
  | "DEEPCOIN";

type GBMMap = Record<Exchange, GBMFairProbability>;

type FairByExchange = Record<Exchange, number>;

if (!fs.existsSync(PLOTS_DIR)) {
  fs.mkdirSync(PLOTS_DIR, { recursive: true });
}

type PlotPoint = {
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

type AssetSymbol = "BTC" | "ETH" | "SOL" | "XRP";

class PlotBuffer {
  private data: PlotPoint[] = [];
  private bucketStart: number | null = null;

  constructor(private symbol: AssetSymbol) {}

  add(point: PlotPoint) {
    if (!this.bucketStart) {
      this.bucketStart = this.alignToBucket(point.ts);
    }

    this.data.push(point);

    if (this.data.length >= PLOT_POINTS) {
      this.exportAndReset();
    }
  }

  private alignToBucket(ts: number): number {
    const d = new Date(ts);

    const intervalMin = PLOT_INTERVAL_SEC / 60; // 1 now, 5 before, 60 later
    const minutes = Math.floor(d.getMinutes() / intervalMin) * intervalMin;

    d.setMinutes(minutes, 0, 0);
    return d.getTime();
  }

  private exportAndReset() {
    if (!this.bucketStart) return;

    const start = new Date(this.bucketStart);
    const label = `${start.getFullYear()}-${(start.getMonth() + 1)
      .toString()
      .padStart(2, "0")}-${start.getDate().toString().padStart(2, "0")}_${start
      .getHours()
      .toString()
      .padStart(2, "0")}-${start.getMinutes().toString().padStart(2, "0")}`;

    const filename = `${this.symbol}_${label}.html`;
    const filepath = path.join(PLOTS_DIR, filename);

    fs.writeFileSync(filepath, this.generateHTML(), "utf8");

    console.log(`📈 Plot exported: ${filepath}`);

    this.data = [];
    this.bucketStart = null;
  }

  private generateHTML(): string {
    // Use actual timestamps for x-axis
    const t = this.data.map((d) => new Date(d.ts));

    // Prepare Plotly traces
    // Prepare Plotly traces
    const traces = [
      // ───────────── Hybrid fair & poly ─────────────
      {
        x: t,
        y: this.data.map((d) => d.fairUp),
        name: "Fair UP (Hybrid)",
        yaxis: "y1",
        line: { dash: "solid", width: 3 },
      },
      {
        x: t,
        y: this.data.map((d) => d.fairDown),
        name: "Fair DOWN (Hybrid)",
        yaxis: "y1",
        line: { dash: "solid" },
        visible: "legendonly",
      },

      {
        x: t,
        y: this.data.map((d) => d.polyUp),
        name: "Poly UP",
        yaxis: "y1",
        line: { dash: "dot" },
      },
      {
        x: t,
        y: this.data.map((d) => d.polyDown),
        name: "Poly DOWN",
        yaxis: "y1",
        line: { dash: "dot" },
        visible: "legendonly",
      },

      {
        x: t,
        y: this.data.map((d) => d.edgeUp),
        name: "Edge UP",
        yaxis: "y1",
        line: { dash: "dash" },
        visible: "legendonly",
      },
      {
        x: t,
        y: this.data.map((d) => d.edgeDown),
        name: "Edge DOWN",
        yaxis: "y1",
        line: { dash: "dash" },
        visible: "legendonly",
      },

      // ───────────── Per-exchange fair curves (legend-only) ─────────────
      {
        x: t,
        y: this.data.map((d) => d.fairBinance),
        name: "Fair Binance",
        yaxis: "y1",
        visible: "legendonly",
      },
      {
        x: t,
        y: this.data.map((d) => d.fairBybit),
        name: "Fair Bybit",
        yaxis: "y1",
        visible: "legendonly",
      },
      {
        x: t,
        y: this.data.map((d) => d.fairGate),
        name: "Fair Gate",
        yaxis: "y1",
        visible: "legendonly",
      },
      {
        x: t,
        y: this.data.map((d) => d.fairOkx),
        name: "Fair OKX",
        yaxis: "y1",
        visible: "legendonly",
      },
      {
        x: t,
        y: this.data.map((d) => d.fairMexc),
        name: "Fair MEXC",
        yaxis: "y1",
        visible: "legendonly",
      },
      {
        x: t,
        y: this.data.map((d) => d.fairBitget),
        name: "Fair Bitget",
        yaxis: "y1",
        visible: "legendonly",
      },
      {
        x: t,
        y: this.data.map((d) => d.fairDeepcoin),
        name: "Fair Deepcoin",
        yaxis: "y1",
        visible: "legendonly",
      },

      // ───────────── Price deltas (% Δ) ─────────────
      {
        x: t,
        y: this.data.map((d) => d.pctDelta),
        name: "% Δ Binance",
        yaxis: "y2",
        line: { width: 3, color: "#00ff00" },
      },
      {
        x: t,
        y: this.data.map((d) => d.deltaBybit),
        name: "% Δ Bybit",
        yaxis: "y2",
        line: { width: 2, color: "#ff9900" },
      },
      {
        x: t,
        y: this.data.map((d) => d.deltaGate),
        name: "% Δ Gate.io",
        yaxis: "y2",
        line: { width: 2, color: "#ff00ff" },
      },
      {
        x: t,
        y: this.data.map((d) => d.deltaOkx),
        name: "% Δ OKX",
        yaxis: "y2",
        line: { width: 2, color: "#00ffff" },
      },

      // 🆕 NEW venues
      {
        x: t,
        y: this.data.map((d) => d.deltaMexc),
        name: "% Δ MEXC",
        yaxis: "y2",
        line: { width: 2, color: "#081b06" },
      },
      {
        x: t,
        y: this.data.map((d) => d.deltaBitget),
        name: "% Δ Bitget",
        yaxis: "y2",
        line: { width: 2, color: "#00aa88" },
      },
      {
        x: t,
        y: this.data.map((d) => d.deltaDeepcoin),
        name: "% Δ Deepcoin",
        yaxis: "y2",
        line: { width: 2, color: "#8888ff" },
      },
    ];

    // Layout with dual y-axes
    const layout = {
      title: `${this.symbol} – 5 Minute Snapshot`,

      hovermode: "x unified", // ← show all Y values at the same X

      xaxis: {
        title: "Time",
        showspikes: true,
        spikemode: "across",
        spikesnap: "cursor",
        spikecolor: "#888",
        spikethickness: 1,
      },

      yaxis: {
        title: "Probability / Edge (%)",
        range: [-100, 100],
        showspikes: true, // optional horizontal crosshair
        spikemode: "across",
        spikesnap: "cursor",
        spikecolor: "#888",
        spikethickness: 1,
      },

      yaxis2: {
        title: "% Price Δ",
        overlaying: "y",
        side: "right",
        showgrid: false,
      },

      legend: {
        orientation: "h",
        y: -0.2,
      },

      margin: {
        t: 50,
        b: 50,
        l: 60,
        r: 60,
      },
    };

    return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <script src="https://cdn.plot.ly/plotly-2.30.0.min.js"></script>
  </head>
  <body>
    <div id="chart" style="width:100%;height:100vh;"></div>
    <script>
      const traces = ${JSON.stringify(traces)};
      const layout = ${JSON.stringify(layout)};
      Plotly.newPlot("chart", traces, layout);
    </script>
  </body>
  </html>`;
  }
}

// ===== ANSI COLOR HELPERS =====
const RESET = "\x1b[0m";

// Asset colors (hex → nearest ANSI via 24-bit)
const COLOR_BTC = "\x1b[38;2;248;165;10m"; // #f8a50a
const COLOR_ETH = "\x1b[38;2;5;72;98m"; // #054862
const COLOR_SOL = "\x1b[38;2;99;13;95m"; // #630d5f
const COLOR_XRP = "\x1b[38;2;98;182;249m"; // #62B6F9

// Directional
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

// ─────────────────────────────────────────────────────────────────────────────
// GBM Fair Probability Calculator – zero dependencies, production-grade
// ─────────────────────────────────────────────────────────────────────────────

// Enable ANSI escape codes on Windows (optional but safe on all platforms)
if (process.platform === "win32") {
  require("child_process").execSync("chcp 65001 >nul");
}

class GBMFairProbability {
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
    const y = x * Math.SQRT1_2;
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

// ─────────────────────────────────────────────────────────────────────────────
// Main Bot
// ─────────────────────────────────────────────────────────────────────────────
interface FairProbs {
  UP: number;
  DOWN: number;
}
interface MarketBook {
  bid: number;
  ask: number;
  mid: number;
}

interface PolyPoint {
  ts: number;
  up: number;
  down: number;
}

class AutoTradingBot {
  private wallet: Wallet;
  private client: ClobClient;

  // ===== PRICE SOURCE CONFIG =====
  private readonly PRICE_SOURCE: "PERP" | "SPOT" = "PERP";

  // Token IDs
  private tokenIdUp: string | null = null;
  private tokenIdDown: string | null = null;
  private tokenIdUpETH: string | null = null;
  private tokenIdDownETH: string | null = null;
  private tokenIdUpSOL: string | null = null;
  private tokenIdDownSOL: string | null = null;
  private tokenIdUpXRP: string | null = null;
  private tokenIdDownXRP: string | null = null;

  // Prices
  private binanceBtcPrice = 0;
  private binanceEthPrice = 0;
  private binanceBtcStartPrice = 0;
  private binanceEthStartPrice = 0;
  private binanceSolPrice = 0;
  private binanceXrpPrice = 0;
  private binanceSolStartPrice = 0;
  private binanceXrpStartPrice = 0;

  // Multi-exchange prices
  private bybitBtcPrice = 0;
  private bybitEthPrice = 0;
  private bybitSolPrice = 0;
  private bybitXrpPrice = 0;

  private gateBtcPrice = 0;
  private gateEthPrice = 0;
  private gateSolPrice = 0;
  private gateXrpPrice = 0;

  private okxBtcPrice = 0;
  private okxEthPrice = 0;
  private okxSolPrice = 0;
  private okxXrpPrice = 0;

  // ===== Aster Prices =====
  private asterBtcPrice = 0;
  private asterEthPrice = 0;
  private asterSolPrice = 0;
  private asterXrpPrice = 0;
  private asterStartPrices: Record<AssetSymbol, number> = {
    BTC: 0,
    ETH: 0,
    SOL: 0,
    XRP: 0,
  };

  // ===== Hyperliquid Prices =====
  private hyperBtcPrice = 0;
  private hyperEthPrice = 0;
  private hyperSolPrice = 0;
  private hyperXrpPrice = 0;
  private hyperStartPrices: Record<AssetSymbol, number> = {
    BTC: 0,
    ETH: 0,
    SOL: 0,
    XRP: 0,
  };

  // ===== MEXC Prices =====
  private mexcBtcPrice = 0;
  private mexcEthPrice = 0;
  private mexcSolPrice = 0;
  private mexcXrpPrice = 0;

  // ===== BitGet Prices =====
  private bitgetBtcPrice = 0;
  private bitgetEthPrice = 0;
  private bitgetSolPrice = 0;
  private bitgetXrpPrice = 0;

  // ===== Deepcoin Prices =====
  private deepcoinBtcPrice = 0;
  private deepcoinEthPrice = 0;
  private deepcoinSolPrice = 0;
  private deepcoinXrpPrice = 0;

  // Start prices synced to Binance
  private binanceStartPrices = { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };
  private bybitStartPrices = { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };
  private gateStartPrices = { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };
  private okxStartPrices = { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };
  private mexcStartPrices = { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };
  private bitgetStartPrices = { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };
  private deepcoinStartPrices = { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };

  // Market timing
  private binanceStartTimeBTC = 0;
  private binanceStartTimeETH = 0;
  private binanceStartTimeSOL = 0;
  private binanceStartTimeXRP = 0;

  private gbm: Record<AssetSymbol, GBMMap> = {
    BTC: this.initGBMs(),
    ETH: this.initGBMs(),
    SOL: this.initGBMs(),
    XRP: this.initGBMs(),
  };

  // Models
  private initGBMs(): GBMMap {
    return {
      BINANCE: new GBMFairProbability(0.985, 0.00025),
      BYBIT: new GBMFairProbability(0.985, 0.00025),
      GATE: new GBMFairProbability(0.985, 0.00025),
      OKX: new GBMFairProbability(0.985, 0.00025),
      ASTER: new GBMFairProbability(0.985, 0.00025),
      HYPER: new GBMFairProbability(0.985, 0.00025),
      MEXC: new GBMFairProbability(0.985, 0.00025),
      BITGET: new GBMFairProbability(0.985, 0.00025),
      DEEPCOIN: new GBMFairProbability(0.985, 0.00025),
    };
  }

  // private gbmBTC = new GBMFairProbability(0.935, 0.0002);
  // private gbmETH = new GBMFairProbability(0.934, 0.0002);
  // private gbmSOL = new GBMFairProbability(0.934, 0.0002);
  // private gbmXRP = new GBMFairProbability(0.93, 0.0002);

  // Fair probabilities
  private fairProbs: Record<"BTC" | "ETH" | "SOL" | "XRP", FairProbs> = {
    BTC: { UP: 0.5, DOWN: 0.5 },
    ETH: { UP: 0.5, DOWN: 0.5 },
    SOL: { UP: 0.5, DOWN: 0.5 },
    XRP: { UP: 0.5, DOWN: 0.5 },
  };

  // Polymarket book
  private book: Record<
    "BTC" | "ETH" | "SOL" | "XRP",
    Record<"UP" | "DOWN", MarketBook>
  > = {
    BTC: { UP: { bid: 0, ask: 0, mid: 0 }, DOWN: { bid: 0, ask: 0, mid: 0 } },
    ETH: { UP: { bid: 0, ask: 0, mid: 0 }, DOWN: { bid: 0, ask: 0, mid: 0 } },
    SOL: { UP: { bid: 0, ask: 0, mid: 0 }, DOWN: { bid: 0, ask: 0, mid: 0 } },
    XRP: { UP: { bid: 0, ask: 0, mid: 0 }, DOWN: { bid: 0, ask: 0, mid: 0 } },
  };

  // Poly history for change detection
  private polyHistory: Record<AssetSymbol, PolyPoint[]> = {
    BTC: [],
    ETH: [],
    SOL: [],
    XRP: [],
  };

  // plot chart buffers
  private plotBuffers: Record<AssetSymbol, PlotBuffer> = {
    BTC: new PlotBuffer("BTC"),
    ETH: new PlotBuffer("ETH"),
    SOL: new PlotBuffer("SOL"),
    XRP: new PlotBuffer("XRP"),
  };

  private fairByExchange: Record<AssetSymbol, FairByExchange> = {
    BTC: {} as FairByExchange,
    ETH: {} as FairByExchange,
    SOL: {} as FairByExchange,
    XRP: {} as FairByExchange,
  };

  // Config
  private priceThreshold = parseFloat(
    process.env.PRICE_DIFFERENCE_THRESHOLD || "0.018"
  );
  private tradeAmountUSD = parseFloat(process.env.DEFAULT_TRADE_AMOUNT || "15");
  private cooldownMs = parseInt(process.env.TRADE_COOLDOWN || "20") * 1000;
  private lastTradeTime = { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };

  // Spike detection config (per asset, for hybrid blending)
  private spikeWindowMs = 2000; // Look back 2s for stability check
  private spikeThresh: Record<AssetSymbol, number> = {
    BTC: 0.02, // % change thresh for "spike"
    ETH: 0.03,
    SOL: 0.05,
    XRP: 0.07,
  };
  private flipBonus = 0.05; // Extra adjustment if spike flips delta sign
  private certaintyThresh = 2.5; // Std devs for forcing extreme probs

  // WebSockets
  private binanceWs: WebSocket | null = null;
  private polymarketWs: WebSocket | null = null;
  private bybitWs: WebSocket | null = null;
  private gateWs: WebSocket | null = null;
  private okxWs: WebSocket | null = null;
  private asterWs: WebSocket | null = null;
  private hyperWs: WebSocket | null = null;
  private mexcWs: WebSocket | null = null;
  private bitgetWs: WebSocket | null = null;
  private deepcoinWs: WebSocket | null = null;
  private running = true;

  constructor() {
    const pk = process.env.PRIVATE_KEY;
    if (!pk) throw new Error("PRIVATE_KEY not set in .env");
    this.wallet = new Wallet(pk);
    this.client = new ClobClient(
      "https://clob.polymarket.com",
      137,
      this.wallet
    );
  }

  async start() {
    console.clear();
    console.log("Binance Perp + GBM → Polymarket Arbitrage Bot\n");
    await this.findMarkets();
    if (this.PRICE_SOURCE === "PERP") {
      this.connectBinancePerpTradeWS();
    } else {
      this.connectBinanceSpotTradeWS();
    }
    this.connectBybitPerpTradeWS();
    this.connectGatePerpTradeWS();
    this.connectOKXPerpTradeWS();
    // this.connectAsterPerpWS();
    // this.connectHyperliquidWS();
    this.connectMexcPerpTradeWS();
    this.connectBitgetPerpTradeWS();
    this.connectDeepcoinPerpTradeWS();
    this.connectPolymarket();
    await this.preloadHistoricalVolatility();
    this.startMonitoringLoop();

    setInterval(() => {
      this.recordPlotPoint("BTC");
      this.recordPlotPoint("ETH");
      this.recordPlotPoint("SOL");
      this.recordPlotPoint("XRP");
    }, SAMPLE_INTERVAL_MS);
  }

  private calcFairForExchange(
    symbol: AssetSymbol,
    exch: Exchange,
    now: number,
    currentPrice: number,
    startPrice: number,
    marketStartTime: number
  ): number {
    if (currentPrice <= 0 || startPrice <= 0) return 0.5;

    const minsLeft = (marketStartTime + 900_000 - now) / 60_000;
    if (minsLeft <= 0) return currentPrice >= startPrice ? 0.999 : 0.001;

    return this.gbm[symbol][exch].calculate(currentPrice, startPrice, minsLeft)
      .UP;
  }

  private resetAllStartPrices() {
    const zero = { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };

    this.binanceStartPrices = { ...zero };
    this.bybitStartPrices = { ...zero };
    this.gateStartPrices = { ...zero };
    this.okxStartPrices = { ...zero };
    this.asterStartPrices = { ...zero };
    this.hyperStartPrices = { ...zero };
    this.mexcStartPrices = { ...zero };
    this.bitgetStartPrices = { ...zero };
    this.deepcoinStartPrices = { ...zero };
  }

  private async findMarkets() {
    await Promise.all([
      this.findMarket("btc"),
      this.findMarket("eth"),
      this.findMarket("sol"),
      this.findMarket("xrp"),
    ]);
  }

  private async findMarket(symbol: "btc" | "eth" | "sol" | "xrp") {
    const now = Date.now();
    const interval = 15 * 60 * 1000;

    // Start from the most recent interval start (could be past or current)
    let base = now - (now % interval);

    // Search up to 10 intervals forward (covers delays + future markets)
    for (let i = -1; i < 10; i++) {
      // -1 to cover slight past, +10 for future
      const openTimestampMs = base + i * interval;

      if (
        now - openTimestampMs > interval &&
        now - openTimestampMs < 2 * interval
      )
        continue;

      const ts = Math.floor(openTimestampMs / 1000);
      const slug = `${symbol}-updown-15m-${ts}`;

      try {
        const res = await fetch(
          `https://gamma-api.polymarket.com/markets?slug=${slug}&active=true&closed=false`
        );

        if (!res.ok) continue; // Skip bad responses

        const json: any = await res.json();
        const market = Array.isArray(json) ? json[0] : json?.data?.[0];

        if (market?.clobTokenIds) {
          const ids =
            typeof market.clobTokenIds === "string"
              ? JSON.parse(market.clobTokenIds)
              : market.clobTokenIds;

          if (symbol === "btc") {
            this.tokenIdUp = ids[0];
            this.tokenIdDown = ids[1];
            this.binanceStartTimeBTC = openTimestampMs;
            this.binanceBtcStartPrice = 0; // Will be fetched
          } else if (symbol === "eth") {
            this.tokenIdUpETH = ids[0];
            this.tokenIdDownETH = ids[1];
            this.binanceStartTimeETH = openTimestampMs;
            this.binanceEthStartPrice = 0;
          } else if (symbol === "sol") {
            this.tokenIdUpSOL = ids[0];
            this.tokenIdDownSOL = ids[1];
            this.binanceStartTimeSOL = openTimestampMs;
            this.binanceSolStartPrice = 0;
          } else if (symbol === "xrp") {
            this.tokenIdUpXRP = ids[0];
            this.tokenIdDownXRP = ids[1];
            this.binanceStartTimeXRP = openTimestampMs;
            this.binanceXrpStartPrice = 0;
          }

          console.log(
            `✅ Found new ${symbol.toUpperCase()} market: ${
              market.question
            } (starts ${new Date(openTimestampMs).toLocaleTimeString()})`
          );

          // Fetch true open price from Binance perps
          await this.fetchStartPrice(symbol, openTimestampMs);

          // Resubscribe Polymarket WS to new token IDs
          const newIds =
            symbol === "btc"
              ? [this.tokenIdUp, this.tokenIdDown]
              : symbol === "eth"
              ? [this.tokenIdUpETH, this.tokenIdDownETH]
              : symbol === "sol"
              ? [this.tokenIdUpSOL, this.tokenIdDownSOL]
              : [this.tokenIdUpXRP, this.tokenIdDownXRP];

          if (this.polymarketWs?.readyState === WebSocket.OPEN) {
            this.polymarketWs.send(
              JSON.stringify({
                type: "market",
                assets_ids: newIds.filter(Boolean),
              })
            );
            console.log(
              `📡 Resubscribed Polymarket WS to new ${symbol.toUpperCase()} tokens`
            );
          } else {
            console.log(
              `⚠️ Polymarket WS not open yet — will subscribe on connect`
            );
          }

          return;
        }
      } catch (err) {
        // Silent — many slugs won't exist
      }
    }

    console.warn(
      `⚠️ No active ${symbol.toUpperCase()} 15m market found (checked -1 to +10 intervals)`
    );
  }

  private async preloadHistoricalVolatility() {
    const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"];
    const hours = 24;
    const interval = "1m";

    for (const sym of symbols) {
      try {
        const endTime = Date.now();
        const startTime = endTime - hours * 60 * 60 * 1000;

        const res = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`
        );
        const data = (await res.json()) as any[];

        const closes = data.map((candle) => parseFloat(candle[4])); // Index 4 = close price

        console.log(`✅ Preloaded ${closes.length} 1m candles for ${sym}`);
      } catch (err) {
        console.warn(
          `⚠️ Failed to preload history for ${sym}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  private async fetchStartPrice(
    symbol: "btc" | "eth" | "sol" | "xrp",
    openTimestampMs: number
  ) {
    const binanceSymbol =
      symbol === "btc"
        ? "BTCUSDT"
        : symbol === "eth"
        ? "ETHUSDT"
        : symbol === "sol"
        ? "SOLUSDT"
        : "XRPUSDT";
    const endTimestampMs = openTimestampMs + 15 * 60 * 1000;

    try {
      const res = await fetch(
        `https://fapi.binance.com/fapi/v1/klines` +
          `?symbol=${binanceSymbol}` +
          `&interval=15m` +
          `&startTime=${openTimestampMs}` +
          `&endTime=${endTimestampMs}` +
          `&limit=1`
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as any[];

      if (Array.isArray(data) && data.length > 0) {
        const openPrice = parseFloat(data[0][1]); // Index 1 = open price

        if (symbol === "btc") {
          this.binanceBtcStartPrice = openPrice;
          console.log(
            `✅ True BTC start price fetched: $${openPrice.toFixed(
              2
            )} (Binance 15m open)`
          );
        } else if (symbol === "eth") {
          this.binanceEthStartPrice = openPrice;
          console.log(
            `✅ True ETH start price fetched: $${openPrice.toFixed(
              2
            )} (Binance 15m open)`
          );
        } else if (symbol === "sol") {
          this.binanceSolStartPrice = openPrice;
          console.log(
            `✅ True SOL start price fetched: $${openPrice.toFixed(
              4
            )} (Binance 15m open)`
          );
        } else if (symbol === "xrp") {
          this.binanceXrpStartPrice = openPrice;
          console.log(
            `✅ True XRP start price fetched: $${openPrice.toFixed(
              4
            )} (Binance 15m open)`
          );
        }
        return;
      }
    } catch (err) {
      console.warn(
        `⚠️ Failed to fetch true start price for ${binanceSymbol}:`,
        err instanceof Error ? err.message : String(err)
      );
    }

    // Fallback: will be set by first live tick
    console.log(
      `⬇️ ${binanceSymbol} start price will use first live tick as fallback`
    );
  }

  private connectBinanceSpotTradeWS() {
    const WS_URL =
      "wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade/solusdt@trade/xrpusdt@trade";

    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.binanceWs?.terminate();
      this.binanceWs = new WebSocket(WS_URL);

      this.binanceWs.on("open", () => {
        reconnectAttempts = 0;
        console.log(
          "✅ Binance SPOT TRADE WS connected — sub-second updates on every trade"
        );
      });

      this.binanceWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          const trade = msg.data;
          if (trade?.e !== "trade") return;

          const symbol = trade.s;
          const price = parseFloat(trade.p);
          if (!price || price <= 0) return;

          switch (symbol) {
            case "BTCUSDT":
              this.binanceBtcPrice = price;
              this.gbm.BTC.BINANCE.addPrice(price);
              price;
              if (
                this.binanceBtcStartPrice === 0 &&
                this.binanceStartTimeBTC > 0
              )
                this.binanceBtcStartPrice = price;
              this.updateFairForExchange("BTC", "BINANCE");
              break;

            case "ETHUSDT":
              this.binanceEthPrice = price;
              this.gbm.ETH.BINANCE.addPrice(price);
              if (
                this.binanceEthStartPrice === 0 &&
                this.binanceStartTimeETH > 0
              )
                this.binanceEthStartPrice = price;
              this.updateFairForExchange("ETH", "BINANCE");
              break;

            case "SOLUSDT":
              this.binanceSolPrice = price;
              this.gbm.SOL.BINANCE.addPrice(price);
              if (
                this.binanceSolStartPrice === 0 &&
                this.binanceStartTimeSOL > 0
              )
                this.binanceSolStartPrice = price;
              this.updateFairForExchange("SOL", "BINANCE");
              break;

            case "XRPUSDT":
              this.binanceXrpPrice = price;
              this.gbm.XRP.BINANCE.addPrice(price);
              if (
                this.binanceXrpStartPrice === 0 &&
                this.binanceStartTimeXRP > 0
              )
                this.binanceXrpStartPrice = price;
              this.updateFairForExchange("XRP", "BINANCE");
              break;
          }

          this.render();
        } catch {}
      });

      this.binanceWs.on("close", () => {
        console.log("🔌 Binance SPOT Trade WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });

      this.binanceWs.on("error", () => {
        this.binanceWs?.close();
      });
    };

    connect();
  }

  private connectBinancePerpTradeWS() {
    // Combined stream for both symbols — ultra-fast trade-by-trade updates
    const WS_URL =
      "wss://fstream.binance.com/stream?streams=btcusdt@trade/ethusdt@trade/solusdt@trade/xrpusdt@trade";

    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.binanceWs?.terminate();
      this.binanceWs = new WebSocket(WS_URL);

      this.binanceWs.on("open", () => {
        reconnectAttempts = 0;
        console.log(
          "✅ Binance Perpetual Futures TRADE WS connected — sub-second updates on every trade"
        );
        console.log(
          "   Streaming: BTCUSDT@trade, ETHUSDT@trade, SOLUSDT@trade, XRPUSDT@trade"
        );
      });

      this.binanceWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          const trade = msg.data;

          if (trade.e !== "trade") return;

          const symbol = trade.s; // "BTCUSDT" or "ETHUSDT" or "SOLUSDT" or "XRPUSDT"
          const price = parseFloat(trade.p); // Last traded price
          const isBuyerMaker = trade.m; // true if sell (taker), false if buy

          if (isNaN(price) || price <= 0) return;

          // Optional: Use volume-weighted or just last price — last is fine for high-liquidity perps
          if (symbol === "BTCUSDT") {
            this.binanceBtcPrice = price;
            this.gbm.BTC.BINANCE.addPrice(price);
            this.updateFairForExchange("BTC", "BINANCE");
            price;

            if (
              this.binanceBtcStartPrice === 0 &&
              this.binanceStartTimeBTC > 0
            ) {
              this.binanceBtcStartPrice = price;
              console.log(`🎯 BTC perp start price set: $${price.toFixed(2)}`);
            }
          } else if (symbol === "ETHUSDT") {
            this.binanceEthPrice = price;
            this.updateFairForExchange("ETH", "BINANCE");
            this.gbm.ETH.BINANCE.addPrice(price);

            if (
              this.binanceEthStartPrice === 0 &&
              this.binanceStartTimeETH > 0
            ) {
              this.binanceEthStartPrice = price;
              console.log(`🎯 ETH perp start price set: $${price.toFixed(2)}`);
            }
          } else if (symbol === "SOLUSDT") {
            this.binanceSolPrice = price;
            this.updateFairForExchange("SOL", "BINANCE");
            this.gbm.SOL.BINANCE.addPrice(price);

            if (
              this.binanceSolStartPrice === 0 &&
              this.binanceStartTimeSOL > 0
            ) {
              this.binanceSolStartPrice = price;
              console.log(`🎯 SOL perp start price set: $${price.toFixed(4)}`);
            }
          } else if (symbol === "XRPUSDT") {
            this.binanceXrpPrice = price;
            this.updateFairForExchange("XRP", "BINANCE");
            this.gbm.XRP.BINANCE.addPrice(price);

            if (
              this.binanceXrpStartPrice === 0 &&
              this.binanceStartTimeXRP > 0
            ) {
              this.binanceXrpStartPrice = price;
              console.log(`🎯 XRP perp start price set: $${price.toFixed(4)}`);
            }
          }

          // Instant reaction to every trade tick
          this.render();
        } catch (e) {
          // Silently ignore malformed messages
        }
      });

      this.binanceWs.on("close", () => {
        console.log("🔌 Binance Perp Trade WS closed → reconnecting in 3s...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });

      this.binanceWs.on("error", (err) => {
        console.error("❌ Binance Perp Trade WS error:", err.message);
        this.binanceWs?.close();
      });
    };

    connect();
  }

  // === BYBIT — All 4 assets ===
  private connectBybitPerpTradeWS() {
    const WS_URL = "wss://stream.bybit.com/v5/public/linear";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.bybitWs?.terminate();
      this.bybitWs = new WebSocket(WS_URL);

      this.bybitWs.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Bybit Perpetual TRADE WS connected (BTC/ETH/SOL/XRP)");
        this.bybitWs!.send(
          JSON.stringify({
            op: "subscribe",
            args: [
              "publicTrade.BTCUSDT",
              "publicTrade.ETHUSDT",
              "publicTrade.SOLUSDT",
              "publicTrade.XRPUSDT",
            ],
          })
        );
      });

      this.bybitWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.topic?.startsWith("publicTrade.") && msg.data) {
            for (const trade of msg.data) {
              const symbol = trade.s;
              const price = parseFloat(trade.p);
              if (price <= 0) continue;

              switch (symbol) {
                case "BTCUSDT":
                  this.bybitBtcPrice = price;
                  this.gbm.BTC.BYBIT.addPrice(price);
                  this.updateFairForExchange("BTC", "BYBIT");
                  if (this.bybitStartPrices.BTC === 0)
                    this.bybitStartPrices.BTC = price;
                  break;
                case "ETHUSDT":
                  this.bybitEthPrice = price;
                  this.gbm.ETH.BYBIT.addPrice(price);
                  this.updateFairForExchange("ETH", "BYBIT");
                  if (this.bybitStartPrices.ETH === 0)
                    this.bybitStartPrices.ETH = price;
                  break;
                case "SOLUSDT":
                  this.bybitSolPrice = price;
                  this.gbm.SOL.BYBIT.addPrice(price);
                  this.updateFairForExchange("SOL", "BYBIT");
                  if (this.bybitStartPrices.SOL === 0)
                    this.bybitStartPrices.SOL = price;
                  break;
                case "XRPUSDT":
                  this.bybitXrpPrice = price;
                  this.gbm.XRP.BYBIT.addPrice(price);
                  this.updateFairForExchange("XRP", "BYBIT");
                  if (this.bybitStartPrices.XRP === 0)
                    this.bybitStartPrices.XRP = price;
                  break;
              }
              this.render();
            }
          }
        } catch {}
      });

      this.bybitWs.on("close", () => {
        console.log("🔌 Bybit WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });

      this.bybitWs.on("error", () => this.bybitWs?.close());
    };

    connect();
  }

  // === GATE.IO — All 4 assets ===
  private connectGatePerpTradeWS() {
    const WS_URL = "wss://fx-ws.gateio.ws/v4/ws/usdt";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.gateWs?.terminate();
      this.gateWs = new WebSocket(WS_URL);

      this.gateWs.on("open", () => {
        reconnectAttempts = 0;
        console.log(
          "✅ Gate.io Perpetual TRADE WS connected (BTC/ETH/SOL/XRP)"
        );
        this.gateWs!.send(
          JSON.stringify({
            time: Math.floor(Date.now() / 1000),
            channel: "futures.trades",
            event: "subscribe",
            payload: ["BTC_USDT", "ETH_USDT", "SOL_USDT", "XRP_USDT"],
          })
        );
      });

      this.gateWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (
            msg.channel === "futures.trades" &&
            msg.event === "update" &&
            msg.result
          ) {
            for (const trade of msg.result) {
              const contract = trade.contract;
              const price = parseFloat(trade.price);
              if (price <= 0) continue;

              switch (contract) {
                case "BTC_USDT":
                  this.gateBtcPrice = price;
                  this.gbm.BTC.GATE.addPrice(price);
                  this.updateFairForExchange("BTC", "GATE");
                  if (this.gateStartPrices.BTC === 0)
                    this.gateStartPrices.BTC = price;
                  break;
                case "ETH_USDT":
                  this.gateEthPrice = price;
                  this.gbm.ETH.GATE.addPrice(price);
                  this.updateFairForExchange("ETH", "GATE");
                  if (this.gateStartPrices.ETH === 0)
                    this.gateStartPrices.ETH = price;
                  break;
                case "SOL_USDT":
                  this.gateSolPrice = price;
                  this.gbm.SOL.GATE.addPrice(price);
                  this.updateFairForExchange("SOL", "GATE");
                  if (this.gateStartPrices.SOL === 0)
                    this.gateStartPrices.SOL = price;
                  break;
                case "XRP_USDT":
                  this.gateXrpPrice = price;
                  this.gbm.XRP.GATE.addPrice(price);
                  this.updateFairForExchange("XRP", "GATE");
                  if (this.gateStartPrices.XRP === 0)
                    this.gateStartPrices.XRP = price;
                  break;
              }
              this.render();
            }
          }
        } catch {}
      });

      this.gateWs.on("close", () => {
        console.log("🔌 Gate.io WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });

      this.gateWs.on("error", () => this.gateWs?.close());
    };

    connect();
  }

  // === OKX — All 4 assets ===
  private connectOKXPerpTradeWS() {
    const WS_URL = "wss://ws.okx.com:8443/ws/v5/public";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.okxWs?.terminate();
      this.okxWs = new WebSocket(WS_URL);

      this.okxWs.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ OKX Perpetual TRADE WS connected (BTC/ETH/SOL/XRP)");
        this.okxWs!.send(
          JSON.stringify({
            op: "subscribe",
            args: [
              { channel: "trades", instId: "BTC-USDT-SWAP" },
              { channel: "trades", instId: "ETH-USDT-SWAP" },
              { channel: "trades", instId: "SOL-USDT-SWAP" },
              { channel: "trades", instId: "XRP-USDT-SWAP" },
            ],
          })
        );
      });

      this.okxWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.arg?.channel === "trades" && msg.data) {
            for (const trade of msg.data) {
              const instId = trade.instId;
              const price = parseFloat(trade.px);
              if (price <= 0) continue;

              switch (instId) {
                case "BTC-USDT-SWAP":
                  this.okxBtcPrice = price;
                  this.gbm.BTC.OKX.addPrice(price);
                  this.updateFairForExchange("BTC", "OKX");
                  if (this.okxStartPrices.BTC === 0)
                    this.okxStartPrices.BTC = price;
                  break;
                case "ETH-USDT-SWAP":
                  this.okxEthPrice = price;
                  this.gbm.ETH.OKX.addPrice(price);
                  this.updateFairForExchange("ETH", "OKX");
                  if (this.okxStartPrices.ETH === 0)
                    this.okxStartPrices.ETH = price;
                  break;
                case "SOL-USDT-SWAP":
                  this.okxSolPrice = price;
                  this.gbm.SOL.OKX.addPrice(price);
                  this.updateFairForExchange("SOL", "OKX");
                  if (this.okxStartPrices.SOL === 0)
                    this.okxStartPrices.SOL = price;
                  break;
                case "XRP-USDT-SWAP":
                  this.okxXrpPrice = price;
                  this.gbm.XRP.OKX.addPrice(price);
                  this.updateFairForExchange("XRP", "OKX");
                  if (this.okxStartPrices.XRP === 0)
                    this.okxStartPrices.XRP = price;
                  break;
              }
              this.render();
            }
          }
        } catch {}
      });

      this.okxWs.on("close", () => {
        console.log("🔌 OKX WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });

      this.okxWs.on("error", () => this.okxWs?.close());
    };

    connect();
  }

  private connectAsterPerpWS() {
    const WS_URL = "wss://fstream.asterdex.com/ws";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;

      this.asterWs?.terminate();
      this.asterWs = new WebSocket(WS_URL);

      this.asterWs.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Aster Perp WS connected");

        // SUBSCRIBE explicitly (this is the missing piece)
        const streams = [
          "btcusdt@aggTrade",
          "ethusdt@aggTrade",
          "solusdt@aggTrade",
          "xrpusdt@aggTrade",
        ];

        this.asterWs!.send(
          JSON.stringify({
            method: "SUBSCRIBE",
            params: streams,
            id: 1,
          })
        );
      });

      this.asterWs.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          // Handle both possible payload shapes
          const data = msg.data ?? msg;

          if (!data || data.e !== "aggTrade") return;
          if (!data.s || !data.p) return;

          const symbol = data.s.toUpperCase();
          const price = parseFloat(data.p);

          if (!Number.isFinite(price) || price <= 0) return;

          switch (symbol) {
            case "BTCUSDT":
              this.asterBtcPrice = price;
              this.gbm.BTC.ASTER.addPrice(price);
              this.updateFairForExchange("BTC", "ASTER");
              if (this.asterStartPrices.BTC === 0) {
                this.asterStartPrices.BTC = price;
              }
              break;

            case "ETHUSDT":
              this.asterEthPrice = price;
              this.gbm.ETH.ASTER.addPrice(price);
              this.updateFairForExchange("ETH", "ASTER");
              if (this.asterStartPrices.ETH === 0) {
                this.asterStartPrices.ETH = price;
              }
              break;

            case "SOLUSDT":
              this.asterSolPrice = price;
              this.gbm.SOL.ASTER.addPrice(price);
              this.updateFairForExchange("SOL", "ASTER");
              if (this.asterStartPrices.SOL === 0) {
                this.asterStartPrices.SOL = price;
              }
              break;

            case "XRPUSDT":
              this.asterXrpPrice = price;
              this.gbm.XRP.ASTER.addPrice(price);
              this.updateFairForExchange("XRP", "ASTER");
              if (this.asterStartPrices.XRP === 0) {
                this.asterStartPrices.XRP = price;
              }
              break;
          }
        } catch {
          // swallow malformed frames
        }
      });

      this.asterWs.on("close", () => {
        console.log("🔌 Aster WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10_000));
      });

      this.asterWs.on("error", () => {
        this.asterWs?.close();
      });
    };

    connect();
  }

  private connectHyperliquidWS() {
    const WS_URL = "wss://api.hyperliquid.xyz/ws";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.hyperWs?.terminate();
      this.hyperWs = new WebSocket(WS_URL);

      this.hyperWs.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Hyperliquid WS connected");

        // Subscribe for trades
        ["BTC", "ETH", "SOL", "XRP"].forEach((coin) => {
          this.hyperWs?.send(
            JSON.stringify({
              method: "subscribe",
              subscription: { type: "trades", coin },
            })
          );
        });
      });

      this.hyperWs.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          // Ignore subscription acks / heartbeats
          if (msg.channel !== "trades" || !Array.isArray(msg.data)) return;

          for (const trade of msg.data) {
            const coin = trade.coin;
            const price = parseFloat(trade.px);

            if (!coin || !Number.isFinite(price) || price <= 0) continue;

            switch (coin) {
              case "BTC":
                this.hyperBtcPrice = price;
                this.gbm.BTC.HYPER.addPrice(price);
                this.updateFairForExchange("BTC", "HYPER");
                if (this.hyperStartPrices.BTC === 0) {
                  this.hyperStartPrices.BTC = price;
                }
                break;

              case "ETH":
                this.hyperEthPrice = price;
                this.gbm.ETH.HYPER.addPrice(price);
                this.updateFairForExchange("ETH", "HYPER");
                if (this.hyperStartPrices.ETH === 0) {
                  this.hyperStartPrices.ETH = price;
                }
                break;

              case "SOL":
                this.hyperSolPrice = price;
                this.gbm.SOL.HYPER.addPrice(price);
                this.updateFairForExchange("SOL", "HYPER");
                if (this.hyperStartPrices.SOL === 0) {
                  this.hyperStartPrices.SOL = price;
                }
                break;

              case "XRP":
                this.hyperXrpPrice = price;
                this.gbm.XRP.HYPER.addPrice(price);
                this.updateFairForExchange("XRP", "HYPER");
                if (this.hyperStartPrices.XRP === 0) {
                  this.hyperStartPrices.XRP = price;
                }
                break;
            }
          }
        } catch (err) {
          // swallow malformed frames
        }
      });

      this.hyperWs.on("close", () => {
        console.log("🔌 Hyperliquid WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });
      this.hyperWs.on("error", () => this.hyperWs?.close());
    };

    connect();
  }

  private connectMexcPerpTradeWS() {
    const WS_URL = "wss://contract.mexc.com/edge";
    let reconnectAttempts = 0;

    const symbols = ["BTC_USDT", "ETH_USDT", "SOL_USDT", "XRP_USDT"];

    const connect = () => {
      if (!this.running) return;
      this.mexcWs?.terminate();
      this.mexcWs = new WebSocket(WS_URL);

      this.mexcWs.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ MEXC Perpetual TRADE WS connected");

        // Subscribe one symbol at a time
        symbols.forEach((sym) => {
          this.mexcWs!.send(
            JSON.stringify({
              method: "sub.deal",
              param: { symbol: sym },
            })
          );
        });

        // ping every 15-20s to keep alive
        const pingInterval = setInterval(() => {
          if (this.mexcWs?.readyState === WebSocket.OPEN) {
            this.mexcWs.send(JSON.stringify({ method: "ping" }));
          }
        }, 20000);

        this.mexcWs?.on("close", () => clearInterval(pingInterval));
      });

      this.mexcWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.channel !== "push.deal" || !Array.isArray(msg.data)) return;

          for (const trade of msg.data) {
            const price = parseFloat(trade.p);
            if (!price || price <= 0) continue;

            switch (msg.symbol) {
              case "BTC_USDT":
                this.mexcBtcPrice = price;
                this.gbm.BTC.MEXC.addPrice(price);
                this.updateFairForExchange("BTC", "MEXC");
                if (this.mexcStartPrices.BTC === 0)
                  this.mexcStartPrices.BTC = price;
                break;

              case "ETH_USDT":
                this.mexcEthPrice = price;
                this.gbm.ETH.MEXC.addPrice(price);
                this.updateFairForExchange("ETH", "MEXC");
                if (this.mexcStartPrices.ETH === 0)
                  this.mexcStartPrices.ETH = price;
                break;

              case "SOL_USDT":
                this.mexcSolPrice = price;
                this.gbm.SOL.MEXC.addPrice(price);
                this.updateFairForExchange("SOL", "MEXC");
                if (this.mexcStartPrices.SOL === 0)
                  this.mexcStartPrices.SOL = price;
                break;

              case "XRP_USDT":
                this.mexcXrpPrice = price;
                this.gbm.XRP.MEXC.addPrice(price);
                this.updateFairForExchange("XRP", "MEXC");
                if (this.mexcStartPrices.XRP === 0)
                  this.mexcStartPrices.XRP = price;
                break;
            }
          }

          this.render();
        } catch {
          // swallow malformed frames
        }
      });

      this.mexcWs.on("close", () => {
        console.log("🔌 MEXC WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });

      this.mexcWs.on("error", () => this.mexcWs?.close());
    };

    connect();
  }

  private connectBitgetPerpTradeWS() {
    const WS_URL = "wss://ws.bitget.com/v2/ws/public"; // ← NEW V2 ENDPOINT
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.bitgetWs?.terminate();
      this.bitgetWs = new WebSocket(WS_URL);

      this.bitgetWs.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Bitget Perpetual TRADE WS connected (V2)");

        // Subscribe to trade channels (use "mc" for mixed/perpetual contracts)
        this.bitgetWs!.send(
          JSON.stringify({
            op: "subscribe",
            args: [
              { instType: "USDT-FUTURES", channel: "trade", instId: "BTCUSDT" },
              { instType: "USDT-FUTURES", channel: "trade", instId: "ETHUSDT" },
              { instType: "USDT-FUTURES", channel: "trade", instId: "SOLUSDT" },
              { instType: "USDT-FUTURES", channel: "trade", instId: "XRPUSDT" },
            ],
          })
        );

        // ← PING (required for V2 as well)
        const pingInterval = setInterval(() => {
          if (this.bitgetWs?.readyState === WebSocket.OPEN) {
            this.bitgetWs.send("ping");
          }
        }, 20000);

        this.bitgetWs?.on("close", () => clearInterval(pingInterval));
      });

      this.bitgetWs.on("message", (data) => {
        const msgStr = data.toString();

        // Handle server ping
        if (msgStr === "pong") return;

        try {
          const msg = JSON.parse(msgStr);

          if (msg.arg?.channel !== "trade") return;
          if (!msg.data || !Array.isArray(msg.data) || msg.data.length === 0)
            return;

          // Now we know it's a valid trade message (snapshot or update)
          for (const trade of msg.data) {
            const instId = trade.instId || msg.arg.instId; // fallback
            const price = parseFloat(trade.px || trade.price); // V2 uses "px"
            if (price <= 0) continue;

            switch (instId) {
              case "BTCUSDT":
                this.bitgetBtcPrice = price;
                this.gbm.BTC.BITGET.addPrice(price);
                if (this.bitgetStartPrices.BTC === 0)
                  this.bitgetStartPrices.BTC = price;
                this.updateFairForExchange("BTC", "BITGET"); // if using the new function
                break;
              case "ETHUSDT":
                this.bitgetEthPrice = price;
                this.gbm.ETH.BITGET.addPrice(price);
                if (this.bitgetStartPrices.ETH === 0)
                  this.bitgetStartPrices.ETH = price;
                this.updateFairForExchange("ETH", "BITGET");
                break;
              case "SOLUSDT":
                this.bitgetSolPrice = price;
                this.gbm.SOL.BITGET.addPrice(price);
                if (this.bitgetStartPrices.SOL === 0)
                  this.bitgetStartPrices.SOL = price;
                this.updateFairForExchange("SOL", "BITGET");
                break;
              case "XRPUSDT":
                this.bitgetXrpPrice = price;
                this.gbm.XRP.BITGET.addPrice(price);
                if (this.bitgetStartPrices.XRP === 0)
                  this.bitgetStartPrices.XRP = price;
                this.updateFairForExchange("XRP", "BITGET");
                break;
            }

            this.render();
          }
        } catch (e) {
          // Ignore malformed messages
        }
      });

      this.bitgetWs.on("close", () => {
        console.log("🔌 Bitget WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });

      this.bitgetWs.on("error", () => this.bitgetWs?.close());
    };

    connect();
  }
  private connectDeepcoinPerpTradeWS() {
    const WS_URL =
      "wss://stream.deepcoin.com/streamlet/trade/public/swap?platform=api";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.deepcoinWs?.terminate();
      this.deepcoinWs = new WebSocket(WS_URL);

      this.deepcoinWs.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Deepcoin Perpetual TRADE WS connected");

        // Subscribe to trades for each symbol
        const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"];
        symbols.forEach((inst, idx) => {
          this.deepcoinWs!.send(
            JSON.stringify({
              SendTopicAction: {
                Action: "1",
                FilterValue: `DeepCoin_${inst}`,
                LocalNo: idx + 1,
                ResumeNo: -2,
                TopicID: "7",
              },
            })
          );
        });
      });

      this.deepcoinWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // Deepcoin returns an array of notifications under 'r'
          if (!Array.isArray(msg.r)) return;

          msg.r.forEach((item: any) => {
            const d = item.d;
            if (!d || !d.I || !d.N) return; // I = instrument, N = last price

            const symbol = d.I; // e.g., "BTCUSDT"
            const price = parseFloat(d.N);
            if (!(price > 0)) return;

            switch (symbol) {
              case "BTCUSDT":
                this.deepcoinBtcPrice = price;
                this.gbm.BTC.DEEPCOIN.addPrice(price);
                this.updateFairForExchange("BTC", "DEEPCOIN");
                if (this.deepcoinStartPrices.BTC === 0)
                  this.deepcoinStartPrices.BTC = price;
                break;
              case "ETHUSDT":
                this.deepcoinEthPrice = price;
                this.gbm.ETH.DEEPCOIN.addPrice(price);
                this.updateFairForExchange("ETH", "DEEPCOIN");
                if (this.deepcoinStartPrices.ETH === 0)
                  this.deepcoinStartPrices.ETH = price;
                break;
              case "SOLUSDT":
                this.deepcoinSolPrice = price;
                this.gbm.SOL.DEEPCOIN.addPrice(price);
                this.updateFairForExchange("SOL", "DEEPCOIN");
                if (this.deepcoinStartPrices.SOL === 0)
                  this.deepcoinStartPrices.SOL = price;
                break;
              case "XRPUSDT":
                this.deepcoinXrpPrice = price;
                this.gbm.XRP.DEEPCOIN.addPrice(price);
                this.updateFairForExchange("XRP", "DEEPCOIN");
                if (this.deepcoinStartPrices.XRP === 0)
                  this.deepcoinStartPrices.XRP = price;
                break;
            }
          });

          this.render();
        } catch {}
      });

      this.deepcoinWs.on("close", () => {
        console.log("🔌 Deepcoin WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });

      this.deepcoinWs.on("error", () => this.deepcoinWs?.close());
    };

    connect();
  }

  private connectPolymarket() {
    let reconnectAttempts = 0;
    const connect = () => {
      if (!this.running) return;
      this.polymarketWs?.close();
      this.polymarketWs = new WebSocket(
        "wss://ws-subscriptions-clob.polymarket.com/ws/market"
      );
      const pingInterval = setInterval(() => {
        if (this.polymarketWs?.readyState === WebSocket.OPEN) {
          this.polymarketWs.send("PING"); // Polymarket expects string "PING"
        }
      }, 5000);
      this.polymarketWs.on("open", () => {
        reconnectAttempts = 0;
        console.log("Polymarket WS open");
        const ids = [
          this.tokenIdUp,
          this.tokenIdDown,
          this.tokenIdUpETH,
          this.tokenIdDownETH,
          this.tokenIdUpSOL,
          this.tokenIdDownSOL,
          this.tokenIdUpXRP,
          this.tokenIdDownXRP,
        ].filter(Boolean) as string[];
        if (ids.length > 0) {
          this.polymarketWs?.send(
            JSON.stringify({ type: "market", assets_ids: ids })
          );
        }
      });
      this.polymarketWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg === "PONG") return; // ignore
          this.processPolymarketMessage(msg);
        } catch {}
      });
      this.polymarketWs.on("close", () => {
        clearInterval(pingInterval);
        if (reconnectAttempts++ < 999) {
          setTimeout(connect, Math.min(1000 * reconnectAttempts, 8000));
        }
      });
      this.polymarketWs.on("error", () => {
        clearInterval(pingInterval);
        this.polymarketWs?.close();
      });
    };
    connect();
  }

  private processPolymarketMessage(msg: any) {
    const changes = msg.price_changes || msg;
    const list = Array.isArray(changes) ? changes : [msg];

    for (const c of list) {
      const id = c.asset_id || c.assetId;
      const bid = parseFloat(c.best_bid || c.bid || "0");
      const ask = parseFloat(c.best_ask || c.ask || "0");
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;

      if (!id || mid <= 0) continue;

      let symbol: AssetSymbol | null = null;

      if (id === this.tokenIdUp) {
        symbol = "BTC";
        Object.assign(this.book.BTC.UP, { bid, ask, mid });
      } else if (id === this.tokenIdDown) {
        symbol = "BTC";
        Object.assign(this.book.BTC.DOWN, { bid, ask, mid });
      } else if (id === this.tokenIdUpETH) {
        symbol = "ETH";
        Object.assign(this.book.ETH.UP, { bid, ask, mid });
      } else if (id === this.tokenIdDownETH) {
        symbol = "ETH";
        Object.assign(this.book.ETH.DOWN, { bid, ask, mid });
      } else if (id === this.tokenIdUpSOL) {
        symbol = "SOL";
        Object.assign(this.book.SOL.UP, { bid, ask, mid });
      } else if (id === this.tokenIdDownSOL) {
        symbol = "SOL";
        Object.assign(this.book.SOL.DOWN, { bid, ask, mid });
      } else if (id === this.tokenIdUpXRP) {
        symbol = "XRP";
        Object.assign(this.book.XRP.UP, { bid, ask, mid });
      } else if (id === this.tokenIdDownXRP) {
        symbol = "XRP";
        Object.assign(this.book.XRP.DOWN, { bid, ask, mid });
      }

      if (symbol) {
        const hist = this.polyHistory[symbol];
        hist.push({
          ts: Date.now(),
          up: this.book[symbol].UP.mid,
          down: this.book[symbol].DOWN.mid,
        });
        if (hist.length > 600) hist.shift();
      }
    }

    // ─────────────────────────────────────
    // Feed Polymarket → GBM calibration
    // ─────────────────────────────────────

    this.render();
  }

  private getPolyRecentChange(
    symbol: AssetSymbol,
    ms: number,
    dir: "up" | "down"
  ): number {
    const hist = this.polyHistory[symbol];
    if (hist.length < 2) return 999;
    const now = hist[hist.length - 1].ts;
    const target = now - ms;
    const pastEntry = [...hist].reverse().find((p) => p.ts <= target);
    if (!pastEntry) return 999;
    const curr = hist[hist.length - 1][dir];
    const past = pastEntry[dir];
    return Math.abs(curr - past);
  }

  private updateFairForExchange(symbol: AssetSymbol, exchange: Exchange) {
    const now = Date.now();

    const marketStartTime =
      symbol === "BTC"
        ? this.binanceStartTimeBTC
        : symbol === "ETH"
        ? this.binanceStartTimeETH
        : symbol === "SOL"
        ? this.binanceStartTimeSOL
        : this.binanceStartTimeXRP;

    if (!marketStartTime || marketStartTime <= 0) return;

    const currentPriceMap: Record<Exchange, number> = {
      BINANCE:
        symbol === "BTC"
          ? this.binanceBtcPrice
          : symbol === "ETH"
          ? this.binanceEthPrice
          : symbol === "SOL"
          ? this.binanceSolPrice
          : this.binanceXrpPrice,
      BYBIT:
        symbol === "BTC"
          ? this.bybitBtcPrice
          : symbol === "ETH"
          ? this.bybitEthPrice
          : symbol === "SOL"
          ? this.bybitSolPrice
          : this.bybitXrpPrice,
      GATE:
        symbol === "BTC"
          ? this.gateBtcPrice
          : symbol === "ETH"
          ? this.gateEthPrice
          : symbol === "SOL"
          ? this.gateSolPrice
          : this.gateXrpPrice,
      OKX:
        symbol === "BTC"
          ? this.okxBtcPrice
          : symbol === "ETH"
          ? this.okxEthPrice
          : symbol === "SOL"
          ? this.okxSolPrice
          : this.okxXrpPrice,
      ASTER:
        symbol === "BTC"
          ? this.asterBtcPrice
          : symbol === "ETH"
          ? this.asterEthPrice
          : symbol === "SOL"
          ? this.asterSolPrice
          : this.asterXrpPrice,
      HYPER:
        symbol === "BTC"
          ? this.hyperBtcPrice
          : symbol === "ETH"
          ? this.hyperEthPrice
          : symbol === "SOL"
          ? this.hyperSolPrice
          : this.hyperXrpPrice,
      MEXC:
        symbol === "BTC"
          ? this.mexcBtcPrice
          : symbol === "ETH"
          ? this.mexcEthPrice
          : symbol === "SOL"
          ? this.mexcSolPrice
          : this.mexcXrpPrice,
      BITGET:
        symbol === "BTC"
          ? this.bitgetBtcPrice
          : symbol === "ETH"
          ? this.bitgetEthPrice
          : symbol === "SOL"
          ? this.bitgetSolPrice
          : this.bitgetXrpPrice,
      DEEPCOIN:
        symbol === "BTC"
          ? this.deepcoinBtcPrice
          : symbol === "ETH"
          ? this.deepcoinEthPrice
          : symbol === "SOL"
          ? this.deepcoinSolPrice
          : this.deepcoinXrpPrice,
    };

    const startPriceMap: Record<Exchange, number> = {
      BINANCE:
        symbol === "BTC"
          ? this.binanceBtcStartPrice
          : symbol === "ETH"
          ? this.binanceEthStartPrice
          : symbol === "SOL"
          ? this.binanceSolStartPrice
          : this.binanceXrpStartPrice,
      BYBIT: this.bybitStartPrices[symbol],
      GATE: this.gateStartPrices[symbol],
      OKX: this.okxStartPrices[symbol],
      ASTER: this.asterStartPrices[symbol],
      HYPER: this.hyperStartPrices[symbol],
      MEXC: this.mexcStartPrices[symbol],
      BITGET: this.bitgetStartPrices[symbol],
      DEEPCOIN: this.deepcoinStartPrices[symbol],
    };

    const currentPrice = currentPriceMap[exchange];
    const startPrice = startPriceMap[exchange];

    if (currentPrice <= 0 || startPrice <= 0) return;

    const minsLeft = (marketStartTime + 900_000 - now) / 60_000;
    if (minsLeft <= 0) return;

    const fairUp = this.gbm[symbol][exchange].calculate(
      currentPrice,
      startPrice,
      minsLeft
    ).UP;

    this.fairByExchange[symbol][exchange] = fairUp;
  }
  private updateHybridFair(symbol: AssetSymbol, now: number) {
    // ───────────────── GBM: BINANCE only (by design) ─────────────────
    const gbm = this.gbm[symbol].BINANCE;

    const currentPrice =
      symbol === "BTC"
        ? this.binanceBtcPrice
        : symbol === "ETH"
        ? this.binanceEthPrice
        : symbol === "SOL"
        ? this.binanceSolPrice
        : this.binanceXrpPrice;

    const startPrice =
      symbol === "BTC"
        ? this.binanceBtcStartPrice
        : symbol === "ETH"
        ? this.binanceEthStartPrice
        : symbol === "SOL"
        ? this.binanceSolStartPrice
        : this.binanceXrpStartPrice;

    const marketStartTime =
      symbol === "BTC"
        ? this.binanceStartTimeBTC
        : symbol === "ETH"
        ? this.binanceStartTimeETH
        : symbol === "SOL"
        ? this.binanceStartTimeSOL
        : this.binanceStartTimeXRP;

    if (currentPrice <= 0 || startPrice <= 0 || marketStartTime <= 0) return;

    const minsLeft = (marketStartTime + 900_000 - now) / 60_000;
    if (minsLeft <= 0) return;

    // ───────────────── Pure GBM fair (Binance-driven) ─────────────────
    const gbmFair = gbm.calculate(currentPrice, startPrice, minsLeft);

    // ───────────────── Polymarket mids ─────────────────
    const polyUp = this.book[symbol].UP.mid;
    const polyDown = this.book[symbol].DOWN.mid;
    if (polyUp <= 0 || polyDown <= 0) return;

    // ───────────────── Trust weighting ─────────────────
    const moneyness = Math.abs(Math.log(currentPrice / startPrice));
    const timeFactor = Math.min(1, minsLeft / 15);

    let alpha = 0.25 + 0.65 * (1 - Math.exp(-moneyness * 4)) * (1 - timeFactor);

    alpha = Math.max(0.15, Math.min(0.9, alpha));

    // ───────────────── Hybrid fair ─────────────────
    const hybridUp = (1 - alpha) * gbmFair.UP + alpha * polyUp;
    const clampedUp = Math.max(0.001, Math.min(0.999, hybridUp));

    this.fairProbs[symbol].UP = clampedUp;
    this.fairProbs[symbol].DOWN = 1 - clampedUp;
  }

  private fmtPct(p: number): string {
    return (p * 100).toFixed(1).padEnd(5);
  }

  private recordPlotPoint(symbol: AssetSymbol) {
    const now = Date.now();

    const fair = this.fairProbs[symbol];
    const book = this.book[symbol];

    // ───────────────── Binance prices & start ─────────────────
    const binancePrice =
      symbol === "BTC"
        ? this.binanceBtcPrice
        : symbol === "ETH"
        ? this.binanceEthPrice
        : symbol === "SOL"
        ? this.binanceSolPrice
        : this.binanceXrpPrice;

    const binanceStart =
      symbol === "BTC"
        ? this.binanceBtcStartPrice
        : symbol === "ETH"
        ? this.binanceEthStartPrice
        : symbol === "SOL"
        ? this.binanceSolStartPrice
        : this.binanceXrpStartPrice;

    // ───────────────── Other exchange prices ─────────────────
    const bybitPrice =
      symbol === "BTC"
        ? this.bybitBtcPrice
        : symbol === "ETH"
        ? this.bybitEthPrice
        : symbol === "SOL"
        ? this.bybitSolPrice
        : this.bybitXrpPrice;

    const gatePrice =
      symbol === "BTC"
        ? this.gateBtcPrice
        : symbol === "ETH"
        ? this.gateEthPrice
        : symbol === "SOL"
        ? this.gateSolPrice
        : this.gateXrpPrice;

    const okxPrice =
      symbol === "BTC"
        ? this.okxBtcPrice
        : symbol === "ETH"
        ? this.okxEthPrice
        : symbol === "SOL"
        ? this.okxSolPrice
        : this.okxXrpPrice;

    const asterPrice =
      symbol === "BTC"
        ? this.asterBtcPrice
        : symbol === "ETH"
        ? this.asterEthPrice
        : symbol === "SOL"
        ? this.asterSolPrice
        : this.asterXrpPrice;

    const hyperPrice =
      symbol === "BTC"
        ? this.hyperBtcPrice
        : symbol === "ETH"
        ? this.hyperEthPrice
        : symbol === "SOL"
        ? this.hyperSolPrice
        : this.hyperXrpPrice;

    // 🆕 NEW venues
    const mexcPrice =
      symbol === "BTC"
        ? this.mexcBtcPrice
        : symbol === "ETH"
        ? this.mexcEthPrice
        : symbol === "SOL"
        ? this.mexcSolPrice
        : this.mexcXrpPrice;

    const bitgetPrice =
      symbol === "BTC"
        ? this.bitgetBtcPrice
        : symbol === "ETH"
        ? this.bitgetEthPrice
        : symbol === "SOL"
        ? this.bitgetSolPrice
        : this.bitgetXrpPrice;

    const deepcoinPrice =
      symbol === "BTC"
        ? this.deepcoinBtcPrice
        : symbol === "ETH"
        ? this.deepcoinEthPrice
        : symbol === "SOL"
        ? this.deepcoinSolPrice
        : this.deepcoinXrpPrice;

    // ───────────────── Start prices ─────────────────
    const bybitStart = this.bybitStartPrices[symbol];
    const gateStart = this.gateStartPrices[symbol];
    const okxStart = this.okxStartPrices[symbol];
    const asterStart = this.asterStartPrices[symbol];
    const hyperStart = this.hyperStartPrices[symbol];

    // 🆕 NEW venues
    const mexcStart = this.mexcStartPrices[symbol];
    const bitgetStart = this.bitgetStartPrices[symbol];
    const deepcoinStart = this.deepcoinStartPrices[symbol];

    // ───────────────── Deltas (%) ─────────────────
    const binanceDelta =
      binanceStart > 0
        ? ((binancePrice - binanceStart) / binanceStart) * 100
        : 0;

    const bybitDelta =
      bybitStart > 0 ? ((bybitPrice - bybitStart) / bybitStart) * 100 : 0;

    const gateDelta =
      gateStart > 0 ? ((gatePrice - gateStart) / gateStart) * 100 : 0;

    const okxDelta =
      okxStart > 0 ? ((okxPrice - okxStart) / okxStart) * 100 : 0;

    const asterDelta =
      asterStart > 0 ? ((asterPrice - asterStart) / asterStart) * 100 : 0;

    const hyperDelta =
      hyperStart > 0 ? ((hyperPrice - hyperStart) / hyperStart) * 100 : 0;

    // 🆕 NEW venues
    const mexcDelta =
      mexcStart > 0 ? ((mexcPrice - mexcStart) / mexcStart) * 100 : 0;

    const bitgetDelta =
      bitgetStart > 0 ? ((bitgetPrice - bitgetStart) / bitgetStart) * 100 : 0;

    const deepcoinDelta =
      deepcoinStart > 0
        ? ((deepcoinPrice - deepcoinStart) / deepcoinStart) * 100
        : 0;

    // ───────────────── Fair-by-exchange (UP probs) ─────────────────
    const fairByEx = this.fairByExchange[symbol];

    this.plotBuffers[symbol].add({
      ts: now,

      // Price deltas
      pctDelta: binanceDelta,
      deltaBybit: bybitDelta,
      deltaGate: gateDelta,
      deltaOkx: okxDelta,
      deltaAster: asterDelta,
      deltaHyper: hyperDelta,

      // 🆕 NEW deltas
      deltaMexc: mexcDelta,
      deltaBitget: bitgetDelta,
      deltaDeepcoin: deepcoinDelta,

      // Existing hybrid fair
      fairUp: fair.UP * 100,
      fairDown: fair.DOWN * 100,

      // Per-exchange GBM fair curves
      fairBinance: (fairByEx.BINANCE ?? fair.UP) * 100,
      fairBybit: (fairByEx.BYBIT ?? fair.UP) * 100,
      fairGate: (fairByEx.GATE ?? fair.UP) * 100,
      fairOkx: (fairByEx.OKX ?? fair.UP) * 100,
      fairAster: (fairByEx.ASTER ?? fair.UP) * 100,
      fairHyper: (fairByEx.HYPER ?? fair.UP) * 100,

      // 🆕 NEW fairs
      fairMexc: (fairByEx.MEXC ?? fair.UP) * 100,
      fairBitget: (fairByEx.BITGET ?? fair.UP) * 100,
      fairDeepcoin: (fairByEx.DEEPCOIN ?? fair.UP) * 100,

      // Poly
      polyUp: book.UP.mid * 100,
      polyDown: book.DOWN.mid * 100,

      // Edge vs hybrid fair
      edgeUp: (fair.UP - book.UP.mid) * 100,
      edgeDown: (fair.DOWN - book.DOWN.mid) * 100,
    });
  }

  private render() {
    const DASHBOARD_LINES = 17;

    const now = new Date().toLocaleTimeString();

    const btcLeft = this.binanceStartTimeBTC
      ? Math.max(
          0,
          Math.floor((this.binanceStartTimeBTC + 900000 - Date.now()) / 1000)
        )
      : 0;

    const ethLeft = this.binanceStartTimeETH
      ? Math.max(
          0,
          Math.floor((this.binanceStartTimeETH + 900000 - Date.now()) / 1000)
        )
      : 0;

    const solLeft = this.binanceStartTimeSOL
      ? Math.max(
          0,
          Math.floor((this.binanceStartTimeSOL + 900000 - Date.now()) / 1000)
        )
      : 0;
    const xrpLeft = this.binanceStartTimeXRP
      ? Math.max(
          0,
          Math.floor((this.binanceStartTimeXRP + 900000 - Date.now()) / 1000)
        )
      : 0;

    // ───── price deltas ─────
    const btcDelta =
      this.binanceBtcStartPrice > 0
        ? this.binanceBtcPrice - this.binanceBtcStartPrice
        : 0;
    const btcPct =
      this.binanceBtcStartPrice > 0
        ? (btcDelta / this.binanceBtcStartPrice) * 100
        : 0;
    const btcColor = btcDelta >= 0 ? GREEN : RED;
    const btcArrow = btcDelta >= 0 ? "▲" : "▼";

    const ethDelta =
      this.binanceEthStartPrice > 0
        ? this.binanceEthPrice - this.binanceEthStartPrice
        : 0;
    const ethPct =
      this.binanceEthStartPrice > 0
        ? (ethDelta / this.binanceEthStartPrice) * 100
        : 0;
    const ethColor = ethDelta >= 0 ? GREEN : RED;
    const ethArrow = ethDelta >= 0 ? "▲" : "▼";

    const solDelta =
      this.binanceSolStartPrice > 0
        ? this.binanceSolPrice - this.binanceSolStartPrice
        : 0;
    const solPct =
      this.binanceSolStartPrice > 0
        ? (solDelta / this.binanceSolStartPrice) * 100
        : 0;
    const solColor = solDelta >= 0 ? GREEN : RED;
    const solArrow = solDelta >= 0 ? "▲" : "▼";

    const xrpDelta =
      this.binanceXrpStartPrice > 0
        ? this.binanceXrpPrice - this.binanceXrpStartPrice
        : 0;
    const xrpPct =
      this.binanceXrpStartPrice > 0
        ? (xrpDelta / this.binanceXrpStartPrice) * 100
        : 0;
    const xrpColor = xrpDelta >= 0 ? GREEN : RED;
    const xrpArrow = xrpDelta >= 0 ? "▲" : "▼";

    const dashboard = [
      `╔══════════════════════════════════════════════════════════════╗`,
      `║ Binance × Polymarket 15-min Arb Bot         ${now.padEnd(17)}║`,
      `╠══════════════════════════════════════════════════════════════╣`,

      `║ ${COLOR_BTC}BTC${RESET} • ${btcLeft
        .toString()
        .padEnd(3)}s left │ $${this.binanceBtcPrice
        .toFixed(2)
        .padEnd(10)} ${btcColor}${btcArrow}${RESET} ${btcColor}${btcDelta
        .toFixed(2)
        .padEnd(7)}${RESET} ${btcColor}(${btcPct.toFixed(3)}%)${"".padEnd(
        13
      )}${RESET}║`,

      `║   Fair  ${GREEN}UP ${this.fmtPct(
        this.fairProbs.BTC.UP
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        this.fairProbs.BTC.DOWN
      )}${RESET}                                 ║`,
      `║   Poly  ${GREEN}UP ${this.fmtPct(
        this.book.BTC.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        this.book.BTC.DOWN.mid
      )}${RESET}                                 ║`,
      `║   Edge  ${GREEN}UP ${this.fmtPct(
        this.fairProbs.BTC.UP - this.book.BTC.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        this.fairProbs.BTC.DOWN - this.book.BTC.DOWN.mid
      )}${RESET}                                 ║`,

      `║                                                              ║`,

      `║ ${COLOR_ETH}ETH${RESET} • ${ethLeft
        .toString()
        .padEnd(3)}s left │ $${this.binanceEthPrice
        .toFixed(2)
        .padEnd(10)} ${ethColor}${ethArrow}${RESET} ${ethColor}${ethDelta
        .toFixed(2)
        .padEnd(7)}${RESET} ${ethColor}(${ethPct.toFixed(3)}%)${"".padEnd(
        13
      )}${RESET}║`,

      `║   Fair  ${GREEN}UP ${this.fmtPct(
        this.fairProbs.ETH.UP
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        this.fairProbs.ETH.DOWN
      )}${RESET}                                 ║`,
      `║   Poly  ${GREEN}UP ${this.fmtPct(
        this.book.ETH.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        this.book.ETH.DOWN.mid
      )}${RESET}                                 ║`,
      `║   Edge  ${GREEN}UP ${this.fmtPct(
        this.fairProbs.ETH.UP - this.book.ETH.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        this.fairProbs.ETH.DOWN - this.book.ETH.DOWN.mid
      )}${RESET}                                 ║`,

      `║                                                              ║`,

      `║ ${COLOR_SOL}SOL${RESET} • ${solLeft
        .toString()
        .padEnd(3)}s left │ $${this.binanceSolPrice
        .toFixed(4)
        .padEnd(10)} ${solColor}${solArrow}${RESET} ${solColor}${solDelta
        .toFixed(4)
        .padEnd(7)}${RESET} ${solColor}(${solPct.toFixed(3)}%)${"".padEnd(
        13
      )}${RESET}║`,

      `║   Fair  ${GREEN}UP ${this.fmtPct(
        this.fairProbs.SOL.UP
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        this.fairProbs.SOL.DOWN
      )}${RESET}                                 ║`,
      `║   Poly  ${GREEN}UP ${this.fmtPct(
        this.book.SOL.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        this.book.SOL.DOWN.mid
      )}${RESET}                                 ║`,
      `║   Edge  ${GREEN}UP ${this.fmtPct(
        this.fairProbs.SOL.UP - this.book.SOL.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        this.fairProbs.SOL.DOWN - this.book.SOL.DOWN.mid
      )}${RESET}                                 ║`,

      `║                                                              ║`,

      `║ ${COLOR_XRP}XRP${RESET} • ${xrpLeft
        .toString()
        .padEnd(3)}s left │ $${this.binanceXrpPrice
        .toFixed(4)
        .padEnd(10)} ${xrpColor}${xrpArrow}${RESET} ${xrpColor}${xrpDelta
        .toFixed(4)
        .padEnd(7)}${RESET} ${xrpColor}(${xrpPct.toFixed(3)}%)${"".padEnd(
        13
      )}${RESET}║`,

      `║   Fair  ${GREEN}UP ${this.fmtPct(
        this.fairProbs.XRP.UP
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        this.fairProbs.XRP.DOWN
      )}${RESET}                                 ║`,
      `║   Poly  ${GREEN}UP ${this.fmtPct(
        this.book.XRP.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        this.book.XRP.DOWN.mid
      )}${RESET}                                 ║`,
      `║   Edge  ${GREEN}UP ${this.fmtPct(
        this.fairProbs.XRP.UP - this.book.XRP.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        this.fairProbs.XRP.DOWN - this.book.XRP.DOWN.mid
      )}${RESET}                                 ║`,

      `╠══════════════════════════════════════════════════════════════╣`,
      `║ Threshold ±${this.priceThreshold
        .toString()
        .padEnd(4)} │ Amount $${this.tradeAmountUSD
        .toString()
        .padEnd(6)} │ Cooldown ${this.cooldownMs / 1000}s             ║`,
      `╚══════════════════════════════════════════════════════════════╝`,
      ``,
    ];

    process.stdout.write("\x1b7");
    readline.cursorTo(process.stdout, 0, 0);
    process.stdout.write(dashboard.join("\n"));
    process.stdout.write("\x1b8");
    readline.moveCursor(process.stdout, 0, DASHBOARD_LINES);
  }

  private async checkMarketRollover() {
    const now = Date.now();

    const btcExpired =
      this.binanceStartTimeBTC &&
      now > this.binanceStartTimeBTC + 15 * 60 * 1000 + 1000;

    const ethExpired =
      this.binanceStartTimeETH &&
      now > this.binanceStartTimeETH + 15 * 60 * 1000 + 1000;

    const solExpired =
      this.binanceStartTimeSOL &&
      now > this.binanceStartTimeSOL + 15 * 60 * 1000 + 1000;

    const xrpExpired =
      this.binanceStartTimeXRP &&
      now > this.binanceStartTimeXRP + 15 * 60 * 1000 + 1000;

    // If nothing expired, do nothing
    if (!btcExpired && !ethExpired && !solExpired && !xrpExpired) return;

    this.resetAllStartPrices();

    // Close WS ONCE
    console.log("⏰ Market rollover detected — reconnecting WS");
    this.polymarketWs?.close();

    if (btcExpired) {
      console.log("⏰ BTC market expired — searching for new one...");
      await this.findMarket("btc");
    }

    if (ethExpired) {
      console.log("⏰ ETH market expired — searching for new one...");
      await this.findMarket("eth");
    }

    if (solExpired) {
      console.log("⏰ SOL market expired — searching for new one...");
      await this.findMarket("sol");
    }

    if (xrpExpired) {
      console.log("⏰ XRP market expired — searching for new one...");
      await this.findMarket("xrp");
    }
  }

  private startMonitoringLoop() {
    // 1. Ultra-fast render loop — 2 times per second (500ms)
    setInterval(() => {
      if (this.running) this.render();
    }, 500);

    // 2. Trade check still every 1 second (no need to spam orders)
    setInterval(async () => {
      if (!this.running) return;
      await this.checkMarketRollover();
      this.checkForTrade("BTC");
      this.checkForTrade("ETH");
      this.checkForTrade("SOL");
      this.checkForTrade("XRP");
    }, 1000);
  }

  private checkForTrade(symbol: "BTC" | "ETH" | "SOL" | "XRP") {
    const now = Date.now();
    if (now - this.lastTradeTime[symbol] < this.cooldownMs) return;

    const fair = this.fairProbs[symbol];
    const poly = this.book[symbol];

    // ───────────────── Binance prices & start ─────────────────
    const startPrice =
      symbol === "BTC"
        ? this.binanceBtcStartPrice
        : symbol === "ETH"
        ? this.binanceEthStartPrice
        : symbol === "SOL"
        ? this.binanceSolStartPrice
        : this.binanceXrpStartPrice;

    const currentPrice =
      symbol === "BTC"
        ? this.binanceBtcPrice
        : symbol === "ETH"
        ? this.binanceEthPrice
        : symbol === "SOL"
        ? this.binanceSolPrice
        : this.binanceXrpPrice;

    if (startPrice <= 0 || currentPrice <= 0) return;

    const pctDelta = ((currentPrice - startPrice) / startPrice) * 100;

    // ───────────────── Market timing ─────────────────
    const marketStartTime =
      symbol === "BTC"
        ? this.binanceStartTimeBTC
        : symbol === "ETH"
        ? this.binanceStartTimeETH
        : symbol === "SOL"
        ? this.binanceStartTimeSOL
        : this.binanceStartTimeXRP;

    const minsLeft = Math.max(0, (marketStartTime + 900_000 - now) / 60_000);
    if (minsLeft <= 0) return;

    // ───────────────── Spike detection (BINANCE GBM) ─────────────────
    const gbm = this.gbm[symbol].BINANCE;

    const price_spike = gbm.getRecentPctChange(1000); // ~1s

    let side: "UP" | "DOWN" | null = null;
    if (price_spike > 0) side = "UP";
    else if (price_spike < 0) side = "DOWN";
    if (!side) return;

    // ───────────────── Thresholds ─────────────────
    const base_spike_thresh =
      symbol === "BTC"
        ? 0.03
        : symbol === "ETH"
        ? 0.05
        : symbol === "SOL"
        ? 0.08
        : 0.1; // % per second

    const time_factor = minsLeft / 15; // smaller near expiry
    const delta_scale = 1;
    const delta_factor = 1 / (0.1 + Math.abs(pctDelta) / delta_scale);

    const spike_thresh = base_spike_thresh * time_factor * delta_factor;

    if (Math.abs(price_spike) <= spike_thresh) return;

    // ───────────────── Poly lag check ─────────────────
    const poly_dir: "up" | "down" = side === "UP" ? "up" : "down";

    const poly_change = this.getPolyRecentChange(symbol, 1000, poly_dir);

    const lag_thresh = 0.01; // 1%

    if (poly_change >= lag_thresh) return;

    // ───────────────── Edge check ─────────────────
    const edge =
      side === "UP" ? fair.UP - poly.UP.mid : fair.DOWN - poly.DOWN.mid;

    if (edge <= this.priceThreshold) return;

    // ───────────────── Token selection ─────────────────
    let tokenId: string | null = null;

    switch (symbol) {
      case "BTC":
        tokenId = side === "UP" ? this.tokenIdUp : this.tokenIdDown;
        break;
      case "ETH":
        tokenId = side === "UP" ? this.tokenIdUpETH : this.tokenIdDownETH;
        break;
      case "SOL":
        tokenId = side === "UP" ? this.tokenIdUpSOL : this.tokenIdDownSOL;
        break;
      case "XRP":
        tokenId = side === "UP" ? this.tokenIdUpXRP : this.tokenIdDownXRP;
        break;
    }

    if (!tokenId) return;

    const price = poly[side].mid;
    if (price <= 0) return;

    // ───────────────── Execute ─────────────────
    this.executeTrade(symbol, tokenId, price);
    this.lastTradeTime[symbol] = now;
  }

  private async executeTrade(
    symbol: "BTC" | "ETH" | "SOL" | "XRP",
    tokenId: string,
    price: number
  ) {
    console.log(`\nTRADE ${symbol} @ $${price.toFixed(4)}`);
    const size = this.tradeAmountUSD / price;
    try {
      const buy = await this.client.createAndPostOrder(
        { tokenID: tokenId, price: price * 1.005, size, side: Side.BUY },
        { tickSize: "0.001", negRisk: false },
        OrderType.GTC
      );
      console.log(`Buy order placed: ${buy.orderID}`);

      const tpPrice = Math.min(price + 0.012, 0.99);
      const slPrice = Math.max(price - 0.008, 0.01);
      await Promise.all([
        this.client.createAndPostOrder(
          { tokenID: tokenId, price: tpPrice, size, side: Side.SELL },
          {},
          OrderType.GTC
        ),
        this.client.createAndPostOrder(
          { tokenID: tokenId, price: slPrice, size, side: Side.SELL },
          {},
          OrderType.GTC
        ),
      ]);
      console.log(`TP/SL placed`);
    } catch (e: any) {
      console.error("Trade failed:", e.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  const bot = new AutoTradingBot();
  await bot.start();
})();

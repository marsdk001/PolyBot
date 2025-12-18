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

if (!fs.existsSync(PLOTS_DIR)) {
  fs.mkdirSync(PLOTS_DIR, { recursive: true });
}

type PlotPoint = {
  ts: number;
  pctDelta: number; // Binance

  deltaBybit: number;
  deltaGate: number;
  deltaOkx: number;

  fairUp: number;
  fairDown: number;

  polyUp: number;
  polyDown: number;

  edgeUp: number;
  edgeDown: number;
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
    const traces = [
      {
        x: t,
        y: this.data.map((d) => d.fairUp),
        name: "Fair UP",
        yaxis: "y1",
        line: { dash: "solid" },
      },
      {
        x: t,
        y: this.data.map((d) => d.fairDown),
        name: "Fair DOWN",
        yaxis: "y1",
        line: { dash: "solid" },
        visible: "legendonly" 
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
        visible: "legendonly" 
      },

      {
        x: t,
        y: this.data.map((d) => d.edgeUp),
        name: "Edge UP",
        yaxis: "y1",
        line: { dash: "dash" },
        visible: "legendonly" 
      },
      {
        x: t,
        y: this.data.map((d) => d.edgeDown),
        name: "Edge DOWN",
        yaxis: "y1",
        line: { dash: "dash" },
        visible: "legendonly" 
      },

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

  constructor(
    private readonly LAMBDA: number = 0.983, // Increased for smoother volatility — less sensitive to single spikes
    private readonly MIN_SIGMA_PER_MIN: number = 0.0004 // ~0.04% per minute floor
  ) {}

  addPrice(price: number) {
    const now = Date.now();
    this.history.push({ ts: now, price });

    // Keep max 48 hours of data
    const cutoff = now - 48 * 60 * 60 * 1000;
    this.history = this.history.filter((p) => p.ts > cutoff);

    // Update EWMA variance
    if (this.history.length > 1) {
      const prevPrice = this.history[this.history.length - 2].price;
      if (prevPrice > 0 && price > 0) {
        const r = Math.log(price / prevPrice);
        this.ewmaVariance =
          this.LAMBDA * this.ewmaVariance + (1 - this.LAMBDA) * r * r;
      }
    }
  }

  // Pre-load historical closes (oldest → newest)
  preloadHistoricalPrices(prices: number[]) {
    this.history = [];
    this.ewmaVariance = 0;

    for (const price of prices) {
      if (price > 0) {
        this.addPrice(price);
      }
    }

    console.log(
      `Preloaded ${prices.length} historical prices → EWMA volatility initialized`
    );
  }

  getRecentPctChange(ms: number): number {
    if (this.history.length < 2) return 0;
    const now = this.history[this.history.length - 1].ts;
    const target = now - ms;
    const pastEntry = [...this.history].reverse().find((p) => p.ts <= target);
    if (!pastEntry) return 0;
    const curr = this.history[this.history.length - 1].price;
    return ((curr - pastEntry.price) / pastEntry.price) * 100;
  }

  getRecentPrice(ms: number): number {
    if (this.history.length < 2)
      return this.history[this.history.length - 1]?.price || 0;
    const now = this.history[this.history.length - 1].ts;
    const target = now - ms;
    const pastEntry = [...this.history].reverse().find((p) => p.ts <= target);
    return pastEntry ? pastEntry.price : this.history[0].price;
  }

  // Standard normal CDF — accurate approximation
  private normCDF(x: number): number {
    const y = x * Math.SQRT1_2; // Adjust input to erf: x / sqrt(2)
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

    return 0.5 * (1 + erf); // Correct scaling without extra * Math.SQRT1_2
  }

  estimateVolatilityPerMinute(): number {
    if (this.ewmaVariance == 0) return this.MIN_SIGMA_PER_MIN;

    const sigmaPerSample = Math.sqrt(this.ewmaVariance);
    const sigmaPerMinute = sigmaPerSample * Math.sqrt(60); // ~60 updates/min from trade stream

    return Math.max(sigmaPerMinute, this.MIN_SIGMA_PER_MIN);
  }

  calculate(
    currentPrice: number,
    startPrice: number,
    minutesRemaining: number
  ): { UP: number; DOWN: number } {
    if (minutesRemaining <= 0 || currentPrice <= 0 || startPrice <= 0) {
      return {
        UP: currentPrice >= startPrice ? 1 : 0,
        DOWN: currentPrice < startPrice ? 1 : 0,
      };
    }

    const tau = minutesRemaining;
    const sigma = this.estimateVolatilityPerMinute();

    if (sigma < 1e-8) {
      return {
        UP: currentPrice >= startPrice ? 1 : 0,
        DOWN: currentPrice < startPrice ? 1 : 0,
      };
    }

    const d =
      (Math.log(currentPrice / startPrice) - ((sigma * sigma) / 2) * tau) /
      (sigma * Math.sqrt(tau));

    const probUp = this.normCDF(d); // ← Now works!

    return {
      UP: Math.max(0.001, Math.min(0.999, probUp)),
      DOWN: Math.max(0.001, Math.min(0.999, 1 - probUp)),
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

  // Start prices synced to Binance
  private bybitStartPrices = { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };
  private gateStartPrices = { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };
  private okxStartPrices = { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };

  // Market timing
  private marketStartTimeBTC = 0;
  private marketStartTimeETH = 0;
  private marketStartTimeSOL = 0;
  private marketStartTimeXRP = 0;

  // Models
  private gbmBTC = new GBMFairProbability(0.935, 0.0002);
  private gbmETH = new GBMFairProbability(0.934, 0.0002);
  private gbmSOL = new GBMFairProbability(0.934, 0.0002);
  private gbmXRP = new GBMFairProbability(0.93, 0.0002);

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
            this.marketStartTimeBTC = openTimestampMs;
            this.binanceBtcStartPrice = 0; // Will be fetched
          } else if (symbol === "eth") {
            this.tokenIdUpETH = ids[0];
            this.tokenIdDownETH = ids[1];
            this.marketStartTimeETH = openTimestampMs;
            this.binanceEthStartPrice = 0;
          } else if (symbol === "sol") {
            this.tokenIdUpSOL = ids[0];
            this.tokenIdDownSOL = ids[1];
            this.marketStartTimeSOL = openTimestampMs;
            this.binanceSolStartPrice = 0;
          } else if (symbol === "xrp") {
            this.tokenIdUpXRP = ids[0];
            this.tokenIdDownXRP = ids[1];
            this.marketStartTimeXRP = openTimestampMs;
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
              this.gbmBTC.addPrice(price);
              if (
                this.binanceBtcStartPrice === 0 &&
                this.marketStartTimeBTC > 0
              )
                this.binanceBtcStartPrice = price;
              break;

            case "ETHUSDT":
              this.binanceEthPrice = price;
              this.gbmETH.addPrice(price);
              if (
                this.binanceEthStartPrice === 0 &&
                this.marketStartTimeETH > 0
              )
                this.binanceEthStartPrice = price;
              break;

            case "SOLUSDT":
              this.binanceSolPrice = price;
              this.gbmSOL.addPrice(price);
              if (
                this.binanceSolStartPrice === 0 &&
                this.marketStartTimeSOL > 0
              )
                this.binanceSolStartPrice = price;
              break;

            case "XRPUSDT":
              this.binanceXrpPrice = price;
              this.gbmXRP.addPrice(price);
              if (
                this.binanceXrpStartPrice === 0 &&
                this.marketStartTimeXRP > 0
              )
                this.binanceXrpStartPrice = price;
              break;
          }

          this.updateFairProbs();
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
            this.gbmBTC.addPrice(price);

            if (
              this.binanceBtcStartPrice === 0 &&
              this.marketStartTimeBTC > 0
            ) {
              this.binanceBtcStartPrice = price;
              console.log(`🎯 BTC perp start price set: $${price.toFixed(2)}`);
            }
          } else if (symbol === "ETHUSDT") {
            this.binanceEthPrice = price;
            this.gbmETH.addPrice(price);

            if (
              this.binanceEthStartPrice === 0 &&
              this.marketStartTimeETH > 0
            ) {
              this.binanceEthStartPrice = price;
              console.log(`🎯 ETH perp start price set: $${price.toFixed(2)}`);
            }
          } else if (symbol === "SOLUSDT") {
            this.binanceSolPrice = price;
            this.gbmSOL.addPrice(price);

            if (
              this.binanceSolStartPrice === 0 &&
              this.marketStartTimeSOL > 0
            ) {
              this.binanceSolStartPrice = price;
              console.log(`🎯 SOL perp start price set: $${price.toFixed(4)}`);
            }
          } else if (symbol === "XRPUSDT") {
            this.binanceXrpPrice = price;
            this.gbmXRP.addPrice(price);

            if (
              this.binanceXrpStartPrice === 0 &&
              this.marketStartTimeXRP > 0
            ) {
              this.binanceXrpStartPrice = price;
              console.log(`🎯 XRP perp start price set: $${price.toFixed(4)}`);
            }
          }

          // Instant reaction to every trade tick
          this.updateFairProbs();
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
                  if (this.bybitStartPrices.BTC === 0 && this.binanceBtcStartPrice > 0)
                    this.bybitStartPrices.BTC = this.binanceBtcStartPrice;
                  break;
                case "ETHUSDT":
                  this.bybitEthPrice = price;
                  if (this.bybitStartPrices.ETH === 0 && this.binanceEthStartPrice > 0)
                    this.bybitStartPrices.ETH = this.binanceEthStartPrice;
                  break;
                case "SOLUSDT":
                  this.bybitSolPrice = price;
                  if (this.bybitStartPrices.SOL === 0 && this.binanceSolStartPrice > 0)
                    this.bybitStartPrices.SOL = this.binanceSolStartPrice;
                  break;
                case "XRPUSDT":
                  this.bybitXrpPrice = price;
                  if (this.bybitStartPrices.XRP === 0 && this.binanceXrpStartPrice > 0)
                    this.bybitStartPrices.XRP = this.binanceXrpStartPrice;
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
                  if (this.gateStartPrices.BTC === 0 && this.binanceBtcStartPrice > 0)
                    this.gateStartPrices.BTC = this.binanceBtcStartPrice;
                  break;
                case "ETH_USDT":
                  this.gateEthPrice = price;
                  if (this.gateStartPrices.ETH === 0 && this.binanceEthStartPrice > 0)
                    this.gateStartPrices.ETH = this.binanceEthStartPrice;
                  break;
                case "SOL_USDT":
                  this.gateSolPrice = price;
                  if (this.gateStartPrices.SOL === 0 && this.binanceSolStartPrice > 0)
                    this.gateStartPrices.SOL = this.binanceSolStartPrice;
                  break;
                case "XRP_USDT":
                  this.gateXrpPrice = price;
                  if (this.gateStartPrices.XRP === 0 && this.binanceXrpStartPrice > 0)
                    this.gateStartPrices.XRP = this.binanceXrpStartPrice;
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
                  if (this.okxStartPrices.BTC === 0 && this.binanceBtcStartPrice > 0)
                    this.okxStartPrices.BTC = this.binanceBtcStartPrice;
                  break;
                case "ETH-USDT-SWAP":
                  this.okxEthPrice = price;
                  if (this.okxStartPrices.ETH === 0 && this.binanceEthStartPrice > 0)
                    this.okxStartPrices.ETH = this.binanceEthStartPrice;
                  break;
                case "SOL-USDT-SWAP":
                  this.okxSolPrice = price;
                  if (this.okxStartPrices.SOL === 0 && this.binanceSolStartPrice > 0)
                    this.okxStartPrices.SOL = this.binanceSolStartPrice;
                  break;
                case "XRP-USDT-SWAP":
                  this.okxXrpPrice = price;
                  if (this.okxStartPrices.XRP === 0 && this.binanceXrpStartPrice > 0)
                    this.okxStartPrices.XRP = this.binanceXrpStartPrice;
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

  private updateFairProbs() {
    const now = Date.now();

    this.updateHybridFair("BTC", now);
    this.updateHybridFair("ETH", now);
    this.updateHybridFair("SOL", now);
    this.updateHybridFair("XRP", now);
  }

  private updateHybridFair(symbol: AssetSymbol, now: number) {
    const gbm =
      symbol === "BTC"
        ? this.gbmBTC
        : symbol === "ETH"
        ? this.gbmETH
        : symbol === "SOL"
        ? this.gbmSOL
        : this.gbmXRP;

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
        ? this.marketStartTimeBTC
        : symbol === "ETH"
        ? this.marketStartTimeETH
        : symbol === "SOL"
        ? this.marketStartTimeSOL
        : this.marketStartTimeXRP;

    if (currentPrice <= 0 || startPrice <= 0 || marketStartTime <= 0) return;

    const minsLeft = (marketStartTime + 900000 - now) / 60000;
    if (minsLeft <= 0) return;

    // Compute pure GBM fair
    const gbmFair = gbm.calculate(currentPrice, startPrice, minsLeft);

    // Get poly mids
    const polyUp = this.book[symbol].UP.mid;
    const polyDown = this.book[symbol].DOWN.mid;
    if (polyUp <= 0 || polyDown <= 0) return;

    // Detect recent spike
    const recentPct = gbm.getRecentPctChange(this.spikeWindowMs);
    const spikeMagnitude = Math.abs(recentPct);
    const isSpike = spikeMagnitude > this.spikeThresh[symbol];

    // Get past price for accurate pastDelta
    const pastPrice = gbm.getRecentPrice(this.spikeWindowMs);
    const pastDelta =
      startPrice > 0 ? ((pastPrice - startPrice) / startPrice) * 100 : 0;
    const currDelta =
      startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : 0;

    // Check if spike flipped delta sign
    const flippedSign =
      Math.sign(pastDelta) !== Math.sign(currDelta) &&
      spikeMagnitude > this.spikeThresh[symbol] * 0.5;

    // Blending alpha: 1 = full poly, 0 = full GBM
    let alpha = isSpike ? 0 : 1; // Binary for now; could smooth: alpha = 1 / (1 + spikeMagnitude / thresh)

    // Hybrid UP
    let hybridUp = (1 - alpha) * gbmFair.UP + alpha * polyUp;

    // Amplify for sign-flip spikes
    if (isSpike && flippedSign) {
      const direction = recentPct > 0 ? 1 : -1;
      hybridUp += direction * this.flipBonus;
    }

    // Apply certainty clip to avoid overestimation of reversal
    const logRatio = Math.log(currentPrice / startPrice);
    const sigma = gbm.estimateVolatilityPerMinute();
    const tau = minsLeft || 0.001; // avoid div0
    const certainty = Math.abs(logRatio) / (sigma * Math.sqrt(tau));
    if (certainty > this.certaintyThresh) {
      hybridUp = logRatio > 0 ? 0.999 : 0.001;
    }

    hybridUp = Math.max(0.001, Math.min(0.999, hybridUp));

    this.fairProbs[symbol] = {
      UP: hybridUp,
      DOWN: 1 - hybridUp,
    };
  }

  private fmtPct(p: number): string {
    return (p * 100).toFixed(1).padEnd(5);
  }

  private recordPlotPoint(symbol: AssetSymbol) {
    const now = Date.now();

    const fair = this.fairProbs[symbol];
    const book = this.book[symbol];

    // Binance prices & start
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

    // Other exchanges
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

    const bybitStart = this.bybitStartPrices[symbol];
    const gateStart = this.gateStartPrices[symbol];
    const okxStart = this.okxStartPrices[symbol];

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

    this.plotBuffers[symbol].add({
      ts: now,
      pctDelta: binanceDelta,

      deltaBybit: bybitDelta,
      deltaGate: gateDelta,
      deltaOkx: okxDelta,

      fairUp: fair.UP * 100,
      fairDown: fair.DOWN * 100,

      polyUp: book.UP.mid * 100,
      polyDown: book.DOWN.mid * 100,

      edgeUp: (fair.UP - book.UP.mid) * 100,
      edgeDown: (fair.DOWN - book.DOWN.mid) * 100,
    });
  }
  private render() {
    const DASHBOARD_LINES = 17;

    const now = new Date().toLocaleTimeString();

    const btcLeft = this.marketStartTimeBTC
      ? Math.max(
          0,
          Math.floor((this.marketStartTimeBTC + 900000 - Date.now()) / 1000)
        )
      : 0;

    const ethLeft = this.marketStartTimeETH
      ? Math.max(
          0,
          Math.floor((this.marketStartTimeETH + 900000 - Date.now()) / 1000)
        )
      : 0;

    const solLeft = this.marketStartTimeSOL
      ? Math.max(
          0,
          Math.floor((this.marketStartTimeSOL + 900000 - Date.now()) / 1000)
        )
      : 0;
    const xrpLeft = this.marketStartTimeXRP
      ? Math.max(
          0,
          Math.floor((this.marketStartTimeXRP + 900000 - Date.now()) / 1000)
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
      this.marketStartTimeBTC &&
      now > this.marketStartTimeBTC + 15 * 60 * 1000 + 1000;

    const ethExpired =
      this.marketStartTimeETH &&
      now > this.marketStartTimeETH + 15 * 60 * 1000 + 1000;

    const solExpired =
      this.marketStartTimeSOL &&
      now > this.marketStartTimeSOL + 15 * 60 * 1000 + 1000;

    const xrpExpired =
      this.marketStartTimeXRP &&
      now > this.marketStartTimeXRP + 15 * 60 * 1000 + 1000;

    // If nothing expired, do nothing
    if (!btcExpired && !ethExpired && !solExpired && !xrpExpired) return;

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

    const pctDelta =
      startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : 0;

    const marketStartTime =
      symbol === "BTC"
        ? this.marketStartTimeBTC
        : symbol === "ETH"
        ? this.marketStartTimeETH
        : symbol === "SOL"
        ? this.marketStartTimeSOL
        : this.marketStartTimeXRP;

    const minsLeft = Math.max(0, (marketStartTime + 900000 - now) / 60000);
    if (minsLeft <= 0) return;

    const gbm =
      symbol === "BTC"
        ? this.gbmBTC
        : symbol === "ETH"
        ? this.gbmETH
        : symbol === "SOL"
        ? this.gbmSOL
        : this.gbmXRP;

    const price_spike = gbm.getRecentPctChange(1000);

    let side: "UP" | "DOWN" | null = null;
    if (price_spike > 0) side = "UP";
    else if (price_spike < 0) side = "DOWN";
    if (!side) return;

    const base_spike_thresh =
      symbol === "BTC"
        ? 0.03
        : symbol === "ETH"
        ? 0.05
        : symbol === "SOL"
        ? 0.08
        : 0.1; // % per second, adjust per asset volatility

    const time_factor = minsLeft / 15; // 0 to 1, smaller near expiry

    const delta_scale = 1; // % delta scale
    const delta_factor = 1 / (0.1 + Math.abs(pctDelta) / delta_scale); // higher when close to 0 delta (harder trigger)

    const spike_thresh = base_spike_thresh * time_factor * delta_factor;

    if (Math.abs(price_spike) > spike_thresh) {
      const poly_dir: "up" | "down" = side === "UP" ? "up" : "down";
      const poly_change = this.getPolyRecentChange(symbol, 1000, poly_dir);

      const lag_thresh = 0.01; // 1% change in prob

      if (poly_change < lag_thresh) {
        const edge =
          side === "UP" ? fair.UP - poly.UP.mid : fair.DOWN - poly.DOWN.mid;

        if (edge > this.priceThreshold) {
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

          this.executeTrade(symbol, tokenId, price);
          this.lastTradeTime[symbol] = now;
        }
      }
    }
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

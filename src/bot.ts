// src/bot.ts
import { GBMFairProbability } from "./gbm";
import { PlotBuffer } from "./plotBuffer";
import { PolymarketClient } from "./polymarketClient";
import { MarketFinder } from "./marketFinder";
import { VolatilityPreloader } from "./volatilityPreloader";
import { BinancePerpSource } from "./priceSources/binancePerp";
import { BybitPerpSource } from "./priceSources/bybitPerp";
import { GatePerpSource } from "./priceSources/gatePerp";
import { OkxPerpSource } from "./priceSources/okxPerp";
import { MexcPerpSource } from "./priceSources/mexcPerp";
import { BitgetPerpSource } from "./priceSources/bitgetPerp";
import { DeepcoinPerpSource } from "./priceSources/deepcoinPerp";
import { PolymarketWs } from "./polymarketWs";
import { FairCalculator } from "./fairCalculator";
import { TradingLogic } from "./tradingLogic";
import { Dashboard } from "./dashboard";
import { SAMPLE_INTERVAL_MS } from "./constants";
import { AssetSymbol, Exchange, PlotPoint, FairProbs } from "./types";
import readline from "readline";

export class AutoTradingBot {
  private gbm: Record<AssetSymbol, Record<Exchange, GBMFairProbability>>;
  private plotBuffers: Record<AssetSymbol, PlotBuffer>;
  private marketFinder = new MarketFinder();
  private volatilityPreloader = new VolatilityPreloader();
  private polymarketClient = new PolymarketClient();
  private polymarketWs: PolymarketWs;
  private fairCalculator: FairCalculator;
  private tradingLogic: TradingLogic;
  private dashboard = new Dashboard();
  private tradingEnabled = false; // Default: trading OFF

  // Price sources
  private binanceSource: BinancePerpSource;
  private bybitSource: BybitPerpSource;
  private gateSource: GatePerpSource;
  private okxSource: OkxPerpSource;
  private mexcSource: MexcPerpSource;
  private bitgetSource: BitgetPerpSource;
  private deepcoinSource: DeepcoinPerpSource;

  // Shared state for easy access
  private prices: Record<AssetSymbol, number> = {
    BTC: 0,
    ETH: 0,
    SOL: 0,
    XRP: 0,
  };
  private startPrices: Record<AssetSymbol, number> = {
    BTC: 0,
    ETH: 0,
    SOL: 0,
    XRP: 0,
  };
  private startTimes: Record<AssetSymbol, number> = {
    BTC: 0,
    ETH: 0,
    SOL: 0,
    XRP: 0,
  };

  constructor() {
    // Initialize GBMs
    this.gbm = {
      BTC: this.initExchangeGBMs(),
      ETH: this.initExchangeGBMs(),
      SOL: this.initExchangeGBMs(),
      XRP: this.initExchangeGBMs(),
    };

    this.plotBuffers = {
      BTC: new PlotBuffer("BTC"),
      ETH: new PlotBuffer("ETH"),
      SOL: new PlotBuffer("SOL"),
      XRP: new PlotBuffer("XRP"),
    };

    this.polymarketWs = new PolymarketWs(() => this.onUpdate());

    // Fair calculator needs access to prices/start/etc
    this.fairCalculator = new FairCalculator(
      this.gbm,
      (symbol, exch) => this.getCurrentPrice(symbol, exch),
      (symbol, exch) => this.getStartPrice(symbol, exch),
      (symbol) => this.startTimes[symbol],
      (symbol) => this.polymarketWs.book[symbol]
    );

    this.tradingLogic = new TradingLogic(
      this.fairCalculator.fairProbs,
      (symbol) => this.polymarketWs.book[symbol],
      (symbol) => this.startPrices[symbol],
      (symbol) => this.prices[symbol],
      (symbol) => this.startTimes[symbol],
      (symbol, side) => {
        const ids = this.marketFinder.getTokenIds(symbol);
        return side === "UP" ? ids.up : ids.down;
      },
      this.polymarketWs,
      this.polymarketClient,
      () => this.tradingEnabled
    );

    // Price sources
    const onPriceUpdate = () => this.onUpdate();

    this.binanceSource = new BinancePerpSource(this.gbm, onPriceUpdate);
    this.bybitSource = new BybitPerpSource(this.gbm, onPriceUpdate);
    this.gateSource = new GatePerpSource(this.gbm, onPriceUpdate);
    this.okxSource = new OkxPerpSource(this.gbm, onPriceUpdate);
    this.mexcSource = new MexcPerpSource(this.gbm, onPriceUpdate);
    this.bitgetSource = new BitgetPerpSource(this.gbm, onPriceUpdate);
    this.deepcoinSource = new DeepcoinPerpSource(this.gbm, onPriceUpdate);
  }

  private initExchangeGBMs() {
    const exchanges: Exchange[] = [
      "BINANCE",
      "BYBIT",
      "GATE",
      "OKX",
      "MEXC",
      "BITGET",
      "DEEPCOIN",
    ];
    const map: Partial<Record<Exchange, GBMFairProbability>> = {};
    exchanges.forEach((ex) => {
      map[ex] = new GBMFairProbability(0.985, 0.00025);
    });
    return map as Record<Exchange, GBMFairProbability>;
  }

  private setupTradingToggle() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    console.log("🔧 Trading toggle active — type 'trade on/off' or 'status'");

    rl.on("line", (line) => {
      const cmd = line.trim().toLowerCase();

      if (cmd === "trade on") {
        this.tradingEnabled = true;
        console.log("✅ Trading ENABLED");
      } else if (cmd === "trade off") {
        this.tradingEnabled = false;
        console.log("⛔ Trading DISABLED");
      } else if (cmd === "status" || cmd === "trade status") {
        console.log(
          `📊 Trading is currently ${
            this.tradingEnabled ? "ENABLED" : "DISABLED"
          }`
        );
      } else if (cmd === "help" || cmd === "?") {
        console.log("Commands: 'trade on' | 'trade off' | 'status' | 'help'");
      }
    });
  }

  private getCurrentPrice(symbol: AssetSymbol, exchange: Exchange): number {
    // Handle Binance specifically (the most important one for hybrid fair)
    if (exchange === "BINANCE") {
      const priceMap: Record<AssetSymbol, number> = {
        BTC: this.binanceSource.binanceBtcPrice,
        ETH: this.binanceSource.binanceEthPrice,
        SOL: this.binanceSource.binanceSolPrice,
        XRP: this.binanceSource.binanceXrpPrice,
      };

      const price = priceMap[symbol];

      // If we have a valid live price, use it; otherwise fall back to start price
      if (price > 0) {
        return price;
      }
    }

    // Existing handling for other exchanges (keep your original code here)
    // Example for the others — adjust if you have more:
    if (exchange === "BYBIT") {
      const map: Record<AssetSymbol, number> = {
        BTC: this.bybitSource.bybitBTCPrice,
        ETH: this.bybitSource.bybitETHPrice,
        SOL: this.bybitSource.bybitSOLPrice,
        XRP: this.bybitSource.bybitXRPPrice,
      };
      return map[symbol] ?? 0;
    }

    if (exchange === "GATE") {
      const map: Record<AssetSymbol, number> = {
        BTC: this.gateSource.gateBTCPrice,
        ETH: this.gateSource.gateETHPrice,
        SOL: this.gateSource.gateSOLPrice,
        XRP: this.gateSource.gateXRPPrice,
      };
      return map[symbol] ?? 0;
    }

    if (exchange === "OKX") {
      const map: Record<AssetSymbol, number> = {
        BTC: this.okxSource.okxBTCPrice,
        ETH: this.okxSource.okxETHPrice,
        SOL: this.okxSource.okxSOLPrice,
        XRP: this.okxSource.okxXRPPrice,
      };
      return map[symbol] ?? 0;
    }

    if (exchange === "MEXC") {
      const map: Record<AssetSymbol, number> = {
        BTC: this.mexcSource.mexcBTCPrice,
        ETH: this.mexcSource.mexcETHPrice,
        SOL: this.mexcSource.mexcSOLPrice,
        XRP: this.mexcSource.mexcXRPPrice,
      };
      return map[symbol] ?? 0;
    }

    if (exchange === "BITGET") {
      const map: Record<AssetSymbol, number> = {
        BTC: this.bitgetSource.bitgetBTCPrice,
        ETH: this.bitgetSource.bitgetETHPrice,
        SOL: this.bitgetSource.bitgetSOLPrice,
        XRP: this.bitgetSource.bitgetXRPPrice,
      };
      return map[symbol] ?? 0;
    }

    if (exchange === "DEEPCOIN") {
      const map: Record<AssetSymbol, number> = {
        BTC: this.deepcoinSource.deepcoinBTCPrice,
        ETH: this.deepcoinSource.deepcoinETHPrice,
        SOL: this.deepcoinSource.deepcoinSOLPrice,
        XRP: this.deepcoinSource.deepcoinXRPPrice,
      };
      return map[symbol] ?? 0;
    }

    // Final fallback
    return this.startPrices[symbol] || 0;
  }

  private getStartPrice(symbol: AssetSymbol, exchange: Exchange): number {
    if (exchange === "BINANCE") return this.marketFinder.getStartPrice(symbol);
    switch (exchange) {
      case "BYBIT":
        return this.bybitSource.bybitStartPrices[symbol];
      case "GATE":
        return this.gateSource.gateStartPrices[symbol];
      case "OKX":
        return this.okxSource.okxStartPrices[symbol];
      case "MEXC":
        return this.mexcSource.mexcStartPrices[symbol];
      case "BITGET":
        return this.bitgetSource.bitgetStartPrices[symbol];
      case "DEEPCOIN":
        return this.deepcoinSource.deepcoinStartPrices[symbol];
      default:
        return 0;
    }
  }

  async start() {
    console.clear();
    console.log(
      "Binance Perp + Multi-Exchange GBM → Polymarket Arbitrage Bot\n"
    );

    // 1. Initial market discovery
    await this.marketFinder.findMarkets();

    // 2. CRITICAL: Set start times and prices IMMEDIATELY after first findMarkets()
    (["BTC", "ETH", "SOL", "XRP"] as AssetSymbol[]).forEach((symbol) => {
      const startTime = this.marketFinder.getStartTime(symbol);
      const startPrice = this.marketFinder.getStartPrice(symbol);

      if (startTime > 0 && startPrice > 0) {
        this.startTimes[symbol] = startTime;
        this.startPrices[symbol] = startPrice;

        // Sync true start price to ALL exchanges
        this.bybitSource.bybitStartPrices[symbol] = startPrice;
        this.gateSource.gateStartPrices[symbol] = startPrice;
        this.okxSource.okxStartPrices[symbol] = startPrice;
        this.mexcSource.mexcStartPrices[symbol] = startPrice;
        this.bitgetSource.bitgetStartPrices[symbol] = startPrice;
        this.deepcoinSource.deepcoinStartPrices[symbol] = startPrice;

        console.log(
          `🎯 Initial ${symbol} start — time: ${new Date(
            startTime
          ).toLocaleTimeString()}, price: $${startPrice.toFixed(
            symbol === "SOL" || symbol === "XRP" ? 4 : 2
          )}`
        );
      }
    });

    // 3. Update Polymarket token IDs
    (["BTC", "ETH", "SOL", "XRP"] as AssetSymbol[]).forEach((symbol) => {
      const { up, down } = this.marketFinder.getTokenIds(symbol);
      this.polymarketWs.updateTokenIds(symbol, up, down);
    });

    // 4. Connect all sources
    this.binanceSource.connect(this.startTimes);
    this.bybitSource.connect();
    this.gateSource.connect();
    this.okxSource.connect();
    this.mexcSource.connect();
    this.bitgetSource.connect();
    // this.deepcoinSource.connect();
    this.polymarketWs.connect();

    // 5. Start loops (including rollover detection)
    this.startLoops();
    this.setupTradingToggle();
  }
  private onUpdate() {
    const now = Date.now();

    // Update ALL live prices from sources
    const symbols: AssetSymbol[] = ["BTC", "ETH", "SOL", "XRP"];

    symbols.forEach((symbol) => {
      // Binance (primary for dashboard)
      const binancePrice = this.getCurrentPrice(symbol, "BINANCE");
      this.prices[symbol] =
        binancePrice > 0 ? binancePrice : this.startPrices[symbol];
    });

    if (this.startTimes.BTC > 0) {
      this.fairCalculator.updateAllFairs(now);
    }

    // Compute combined fair for dashboard
    const combinedFair: Record<AssetSymbol, FairProbs> = {
      BTC: {
        UP: this.fairCalculator.getCombinedExchangeFair("BTC"),
        DOWN: 1 - this.fairCalculator.getCombinedExchangeFair("BTC"),
      },
      ETH: {
        UP: this.fairCalculator.getCombinedExchangeFair("ETH"),
        DOWN: 1 - this.fairCalculator.getCombinedExchangeFair("ETH"),
      },
      SOL: {
        UP: this.fairCalculator.getCombinedExchangeFair("SOL"),
        DOWN: 1 - this.fairCalculator.getCombinedExchangeFair("SOL"),
      },
      XRP: {
        UP: this.fairCalculator.getCombinedExchangeFair("XRP"),
        DOWN: 1 - this.fairCalculator.getCombinedExchangeFair("XRP"),
      },
    };

    this.dashboard.render(
      combinedFair, // ← Now using combined fair instead of hybrid
      this.polymarketWs.book,
      this.prices,
      this.startPrices,
      {
        BTC: Math.max(
          0,
          Math.floor((this.startTimes.BTC + 900000 - now) / 1000)
        ),
        ETH: Math.max(
          0,
          Math.floor((this.startTimes.ETH + 900000 - now) / 1000)
        ),
        SOL: Math.max(
          0,
          Math.floor((this.startTimes.SOL + 900000 - now) / 1000)
        ),
        XRP: Math.max(
          0,
          Math.floor((this.startTimes.XRP + 900000 - now) / 1000)
        ),
      }
    );
  }

  private startLoops() {
    // Fast render
    setInterval(() => this.onUpdate(), 500);

    // Trading check + rollover
    setInterval(async () => {
      const now = Date.now();
      await this.checkMarketRollover();
      // For now, rely on market finder logic during start

      ["BTC", "ETH", "SOL", "XRP"].forEach((sym) => {
        this.tradingLogic.checkForTrade(sym as AssetSymbol, now);
      });
    }, 1000);

    // Plot sampling
    setInterval(() => {
      const now = Date.now();
      this.recordAllPlotPoints(now);
    }, SAMPLE_INTERVAL_MS);
  }

  private async checkMarketRollover() {
    const now = Date.now();

    // Helper to check if a specific market has expired
    const isExpired = (symbol: AssetSymbol): boolean => {
      const startTime = this.startTimes[symbol];
      // Expired if more than 15 minutes + 60 seconds grace period has passed
      return startTime > 0 && now > startTime + 900_000 + 2000; // 2 second delay
    };

    // Find which markets have expired
    const expiredSymbols = (
      ["BTC", "ETH", "SOL", "XRP"] as AssetSymbol[]
    ).filter(isExpired);

    // No expired markets → nothing to do
    if (expiredSymbols.length === 0) return;

    console.log(
      `⏰ 15m market(s) expired: ${expiredSymbols.join(
        ", "
      )} — initiating rollover`
    );

    // 1. Re-discover the new 15-minute markets
    await this.marketFinder.findMarkets();

    // 2. Update start times and prices for ALL symbols (not just expired ones)
    //     This ensures everything stays in sync even if only one expired
    (["BTC", "ETH", "SOL", "XRP"] as AssetSymbol[]).forEach((symbol) => {
      const newStartTime = this.marketFinder.getStartTime(symbol);
      const newStartPrice = this.marketFinder.getStartPrice(symbol);

      if (newStartTime > 0 && newStartPrice > 0) {
        // Update bot's central start time & price
        this.startTimes[symbol] = newStartTime;
        this.startPrices[symbol] = newStartPrice;

        // Sync the true Binance 15m open price to EVERY exchange
        this.bybitSource.bybitStartPrices[symbol] = newStartPrice;
        this.gateSource.gateStartPrices[symbol] = newStartPrice;
        this.okxSource.okxStartPrices[symbol] = newStartPrice;
        this.mexcSource.mexcStartPrices[symbol] = newStartPrice;
        this.bitgetSource.bitgetStartPrices[symbol] = newStartPrice;
        this.deepcoinSource.deepcoinStartPrices[symbol] = newStartPrice;

        console.log(
          `🎯 ${symbol} rollover — new start time: ${new Date(
            newStartTime
          ).toLocaleTimeString()}, price: $${newStartPrice.toFixed(
            symbol === "SOL" || symbol === "XRP" ? 4 : 2
          )}`
        );
      } else {
        console.warn(
          `⚠️ Could not retrieve valid start time/price for ${symbol} during rollover`
        );
      }
    });

    // 3. Update Polymarket token IDs for the new markets
    (["BTC", "ETH", "SOL", "XRP"] as AssetSymbol[]).forEach((symbol) => {
      const { up, down } = this.marketFinder.getTokenIds(symbol);
      this.polymarketWs.updateTokenIds(symbol, up, down);
    });

    // 4. Force a full reconnect of the Polymarket WebSocket
    //     This is critical — Polymarket often doesn't send data for new tokens on an existing connection
    this.polymarketWs.reconnect();

    // 5. Reset fair probabilities to neutral to avoid carry-over from previous market
    (["BTC", "ETH", "SOL", "XRP"] as AssetSymbol[]).forEach((symbol) => {
      this.fairCalculator.fairProbs[symbol] = { UP: 0.5, DOWN: 0.5 };
    });

    console.log("✅ Rollover complete — bot ready for new 15-minute markets");
  }

  private recordAllPlotPoints(now: number) {
    (["BTC", "ETH", "SOL", "XRP"] as AssetSymbol[]).forEach((symbol) => {
      // Binance (reference)
      const binancePrice = this.prices[symbol];
      const binanceStart = this.startPrices[symbol];
      const binanceDelta =
        binanceStart > 0
          ? ((binancePrice - binanceStart) / binanceStart) * 100
          : 0;

      // Bybit
      const bybitPrice = this.bybitSource[
        `bybit${symbol}Price` as keyof BybitPerpSource
      ] as number;
      const bybitStart = this.bybitSource.bybitStartPrices[symbol];
      const bybitDelta =
        bybitStart > 0
          ? ((bybitPrice - bybitStart) / bybitStart) * 100
          : undefined;

      // Gate.io
      const gatePrice = this.gateSource[
        `gate${symbol}Price` as keyof GatePerpSource
      ] as number;
      const gateStart = this.gateSource.gateStartPrices[symbol];
      const gateDelta =
        gateStart > 0 ? ((gatePrice - gateStart) / gateStart) * 100 : undefined;

      // OKX
      const okxPrice = this.okxSource[
        `okx${symbol}Price` as keyof OkxPerpSource
      ] as number;
      const okxStart = this.okxSource.okxStartPrices[symbol];
      const okxDelta =
        okxStart > 0 ? ((okxPrice - okxStart) / okxStart) * 100 : undefined;

      // MEXC
      const mexcPrice = this.mexcSource[
        `mexc${symbol}Price` as keyof MexcPerpSource
      ] as number;
      const mexcStart = this.mexcSource.mexcStartPrices[symbol];
      const mexcDelta =
        mexcStart > 0 ? ((mexcPrice - mexcStart) / mexcStart) * 100 : undefined;

      // Bitget
      const bitgetPrice = this.bitgetSource[
        `bitget${symbol}Price` as keyof BitgetPerpSource
      ] as number;
      const bitgetStart = this.bitgetSource.bitgetStartPrices[symbol];
      const bitgetDelta =
        bitgetStart > 0
          ? ((bitgetPrice - bitgetStart) / bitgetStart) * 100
          : undefined;

      // Deepcoin
      const deepcoinPrice = this.deepcoinSource[
        `deepcoin${symbol}Price` as keyof DeepcoinPerpSource
      ] as number;
      const deepcoinStart = this.deepcoinSource.deepcoinStartPrices[symbol];
      const deepcoinDelta =
        deepcoinStart > 0
          ? ((deepcoinPrice - deepcoinStart) / deepcoinStart) * 100
          : undefined;

      this.plotBuffers[symbol].add({
        ts: now,

        // Price % deltas
        pctDelta: binanceDelta,
        deltaBybit: bybitDelta,
        deltaGate: gateDelta,
        deltaOkx: okxDelta,
        deltaMexc: mexcDelta,
        deltaBitget: bitgetDelta,
        deltaDeepcoin: deepcoinDelta,

        // Fair probabilities
        fairUp: this.fairCalculator.fairProbs[symbol].UP * 100,
        fairDown: this.fairCalculator.fairProbs[symbol].DOWN * 100,
        fairCombined: this.fairCalculator.getCombinedExchangeFair(symbol) * 100,

        // Per-exchange fair (UP %)
        fairBinance: this.fairCalculator.fairByExchange[symbol]?.BINANCE * 100,
        fairBybit: this.fairCalculator.fairByExchange[symbol]?.BYBIT * 100,
        fairGate: this.fairCalculator.fairByExchange[symbol]?.GATE * 100,
        fairOkx: this.fairCalculator.fairByExchange[symbol]?.OKX * 100,
        fairMexc: this.fairCalculator.fairByExchange[symbol]?.MEXC * 100,
        fairBitget: this.fairCalculator.fairByExchange[symbol]?.BITGET * 100,
        fairDeepcoin:
          this.fairCalculator.fairByExchange[symbol]?.DEEPCOIN * 100,

        // Polymarket
        polyUp: this.polymarketWs.book[symbol].UP.mid * 100,
        polyDown: this.polymarketWs.book[symbol].DOWN.mid * 100,

        // Edge
        edgeUp:
          (this.fairCalculator.fairProbs[symbol].UP -
            this.polymarketWs.book[symbol].UP.mid) *
          100,
        edgeDown:
          (this.fairCalculator.fairProbs[symbol].DOWN -
            this.polymarketWs.book[symbol].DOWN.mid) *
          100,
      });
    });
  }
}

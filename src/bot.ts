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
import { CoinbaseSpotSource } from "./priceSources/coinbaseSpot";
import { PolymarketWs } from "./polymarketWs";
import { FairCalculator } from "./fairCalculator";
import { TradingLogic } from "./tradingLogic";
import { Dashboard } from "./dashboard";
import { BalanceChecker } from "./balance_checker";
import {
  SAMPLE_INTERVAL_MS,
  DELTA_ANCHOR_EXCHANGE,
  LOGIC_INTERVAL_MS,
  DASHBOARD_INTERVAL_MS,
  TRADING_LOOP_MS,
  ACTIVE_EXCHANGES,
  PLOTS_DIR,
} from "./constants";
import { AssetSymbol, Exchange, PlotPoint, FairProbs } from "./types";
import readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as util from "util";

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
  private balanceChecker = new BalanceChecker();
  private tradingEnabled = false; // Default: trading OFF

  // Price sources
  private binanceSource: BinancePerpSource;
  private bybitSource: BybitPerpSource;
  private gateSource: GatePerpSource;
  private okxSource: OkxPerpSource;
  private mexcSource: MexcPerpSource;
  private bitgetSource: BitgetPerpSource;
  private coinbaseSource: CoinbaseSpotSource;

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

  private lastPlotTime = 0;
  private lastFairUpdate = 0;

  public binanceStartPrices: Record<AssetSymbol, number> = {
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
    this.coinbaseSource = new CoinbaseSpotSource(this.gbm, onPriceUpdate);
  }

  private initExchangeGBMs() {
    const map: Partial<Record<Exchange, GBMFairProbability>> = {};
    ACTIVE_EXCHANGES.forEach((ex) => {
      map[ex] = new GBMFairProbability(0.985, 0.00025);
    });
    return map as Record<Exchange, GBMFairProbability>;
  }

  private setupTradingToggle() {
    if (!process.stdin.isTTY) {
      console.log("⚠️ Non-interactive environment detected (VPS/PM2). Trading toggle via stdin disabled.");
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    console.log("🔧 Trading toggle active — type 'trade on/off', 'status' or 'balance'");

    rl.on("line", async (line) => {
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
      } else if (cmd === "balance") {
        console.log("Checking balances...");
        try {
          const balances = await this.balanceChecker.checkBalances(this.polymarketClient.wallet);
          this.balanceChecker.displayBalances(balances);
        } catch (err) {
          console.error("❌ Failed to check balance:", err);
        }
      } else if (cmd === "help" || cmd === "?") {
        console.log("Commands: 'trade on' | 'trade off' | 'status' | 'balance' | 'help'");
      }
    });
  }

  private getCurrentPrice(symbol: AssetSymbol, exchange: Exchange): number {
    if (exchange === "AVERAGE") {
      let sum = 0;
      let count = 0;
      for (const ex of ACTIVE_EXCHANGES) {
        const p = this.getCurrentPrice(symbol, ex);
        if (p > 0) {
          sum += p;
          count++;
        }
      }
      return count > 0 ? sum / count : 0;
    }

    if (exchange === "BINANCE") {
      const map: Record<AssetSymbol, number> = {
        BTC: this.binanceSource.binanceBtcPrice,
        ETH: this.binanceSource.binanceEthPrice,
        SOL: this.binanceSource.binanceSolPrice,
        XRP: this.binanceSource.binanceXrpPrice,
      };
      return map[symbol] ?? 0;
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

    if (exchange === "COINBASE") {
      const map: Record<AssetSymbol, number> = {
        BTC: this.coinbaseSource.coinbaseBTCPrice,
        ETH: this.coinbaseSource.coinbaseETHPrice,
        SOL: this.coinbaseSource.coinbaseSOLPrice,
        XRP: this.coinbaseSource.coinbaseXRPPrice,
      };
      return map[symbol] ?? 0;
    }
    // Final fallback
    return this.startPrices[symbol] || 0;
  }

  private getStartPrice(symbol: AssetSymbol, exchange: Exchange): number {
    switch (exchange) {
      case "BINANCE":
        return this.binanceSource.binanceStartPrices[symbol];
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
      case "COINBASE":
        return this.coinbaseSource.coinbaseStartPrices[symbol];
      case "AVERAGE":
        return this.startPrices[symbol];
      default:
        return 0;
    }
  }

  async start() {
    this.setupLogger();

    if (process.stdout.isTTY) {
      console.clear();
    }
    console.log(
      "Binance Perp + Multi-Exchange GBM → Polymarket Arbitrage Bot\n"
    );
    console.log(`📂 Working Directory: ${process.cwd()}`);
    console.log(`💾 Plots Directory: ${PLOTS_DIR}`);

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
        this.coinbaseSource.coinbaseStartPrices[symbol] = startPrice;

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
    this.coinbaseSource.connect();
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
      // Anchor Exchange (primary for dashboard & delta calculation)
      const anchorPrice = this.getCurrentPrice(
        symbol,
        DELTA_ANCHOR_EXCHANGE as Exchange
      );

      this.prices[symbol] =
        anchorPrice > 0 ? anchorPrice : this.startPrices[symbol];
    });

    // Throttle fair calculation to max once per 50ms
    if (now - this.lastFairUpdate >= 50) {
      if (this.startTimes.BTC > 0) {
        this.fairCalculator.updateAllFairs(now);
      }
      this.lastFairUpdate = now;
    }
  }

  private renderDashboard() {
    const now = Date.now();
    if (this.startTimes.BTC === 0) return; // Don't render before initialization

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
    // 1. Heartbeat for logic (fallback if WS is quiet)
    setInterval(() => this.onUpdate(), LOGIC_INTERVAL_MS);

    // 2. Dashboard Render Loop (Throttled to 1s to prevent console I/O blocking)
    if (process.stdout.isTTY) {
      setInterval(() => this.renderDashboard(), DASHBOARD_INTERVAL_MS);
    } else {
      console.log("📺 Dashboard disabled (Non-TTY detected) - Check logs/bot.log for output");
    }

    // Trading check + rollover
    setInterval(async () => {
      const now = Date.now();
      await this.checkMarketRollover();
      // For now, rely on market finder logic during start

      ["BTC", "ETH", "SOL", "XRP"].forEach((sym) => {
        this.tradingLogic.checkForTrade(sym as AssetSymbol, now);
      });
    }, TRADING_LOOP_MS);

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
      let newStartPrice = this.marketFinder.getStartPrice(symbol);

      // If using a custom anchor (not Binance), snapshot its current price as the start price
      if ((DELTA_ANCHOR_EXCHANGE as string) !== "BINANCE") {
        const anchorPrice = this.getCurrentPrice(
          symbol,
          DELTA_ANCHOR_EXCHANGE as Exchange
        );
        if (anchorPrice > 0) {
          newStartPrice = anchorPrice;
          console.log(
            `⚖️ Snapped ${symbol} start price to ${DELTA_ANCHOR_EXCHANGE}: $${newStartPrice.toFixed(
              2
            )}`
          );
        }
      }

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
        this.coinbaseSource.coinbaseStartPrices[symbol] = newStartPrice;

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
    const lag = this.lastPlotTime > 0 ? Math.max(0, now - this.lastPlotTime - SAMPLE_INTERVAL_MS) : 0;
    this.lastPlotTime = now;
    const binanceStaleness = now - this.binanceSource.lastMessageTs;
    const bybitStaleness = now - this.bybitSource.lastMessageTs;
    const gateStaleness = now - this.gateSource.lastMessageTs;
    const okxStaleness = now - this.okxSource.lastMessageTs;
    const mexcStaleness = now - this.mexcSource.lastMessageTs;
    const bitgetStaleness = now - this.bitgetSource.lastMessageTs;
    const coinbaseStaleness = now - this.coinbaseSource.lastMessageTs;
    const polyStaleness = now - this.polymarketWs.lastMessageTs;

    (["BTC", "ETH", "SOL", "XRP"] as AssetSymbol[]).forEach((symbol) => {
      // Anchor (reference)
      const anchorPrice = this.prices[symbol];
      const anchorStart = this.startPrices[symbol];
      const anchorDelta =
        anchorStart > 0 ? ((anchorPrice - anchorStart) / anchorStart) * 100 : 0;

      // Binance
      const binSuffix = symbol.charAt(0) + symbol.slice(1).toLowerCase();
      const binancePrice = this.binanceSource[
        `binance${binSuffix}Price` as keyof BinancePerpSource
      ] as number;
      const binanceStart = this.binanceSource.binanceStartPrices[symbol];
      const binanceDelta =
        binanceStart > 0
          ? ((binancePrice - binanceStart) / binanceStart) * 100
          : undefined;

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

      // Coinbase
      const coinbasePrice = this.coinbaseSource[
        `coinbase${symbol}Price` as keyof CoinbaseSpotSource
      ] as number;
      const coinbaseStart = this.coinbaseSource.coinbaseStartPrices[symbol];
      const coinbaseDelta =
        coinbaseStart > 0 ? ((coinbasePrice - coinbaseStart) / coinbaseStart) * 100 : undefined;

      const combinedFairValue = this.fairCalculator.getCombinedExchangeFair(symbol);
      const polyUpVal = this.polymarketWs.book[symbol].UP.mid;
      const diff = Math.abs(combinedFairValue - polyUpVal) * 100;

      this.plotBuffers[symbol].add({
        ts: now,
        loopLag: lag,
        binanceStaleness: binanceStaleness,
        bybitStaleness: bybitStaleness,
        gateStaleness: gateStaleness,
        okxStaleness: okxStaleness,
        mexcStaleness: mexcStaleness,
        bitgetStaleness: bitgetStaleness,
        coinbaseStaleness: coinbaseStaleness,
        polyStaleness: polyStaleness,

        // Price % deltas (pctDelta is now the Anchor delta)
        pctDelta: anchorDelta,
        deltaBybit: bybitDelta,
        deltaGate: gateDelta,
        deltaOkx: okxDelta,
        deltaMexc: mexcDelta,
        deltaBitget: bitgetDelta,
        deltaCoinbase: coinbaseDelta,
        deltaBinance: binanceDelta,
        
        diff,

        // Fair probabilities
        fairUp: this.fairCalculator.fairProbs[symbol].UP * 100,
        fairDown: this.fairCalculator.fairProbs[symbol].DOWN * 100,
        fairCombined: combinedFairValue * 100,

        // Per-exchange fair (UP %)
        fairBinance: this.fairCalculator.fairByExchange[symbol]?.BINANCE * 100,
        fairBybit: this.fairCalculator.fairByExchange[symbol]?.BYBIT * 100,
        fairGate: this.fairCalculator.fairByExchange[symbol]?.GATE * 100,
        fairOkx: this.fairCalculator.fairByExchange[symbol]?.OKX * 100,
        fairMexc: this.fairCalculator.fairByExchange[symbol]?.MEXC * 100,
        fairBitget: this.fairCalculator.fairByExchange[symbol]?.BITGET * 100,
        fairDeepcoin:
          this.fairCalculator.fairByExchange[symbol]?.DEEPCOIN * 100,
        fairCoinbase: this.fairCalculator.fairByExchange[symbol]?.COINBASE * 100,

        // Polymarket
        polyUp: polyUpVal * 100,
        polyDown: this.polymarketWs.book[symbol].DOWN.mid * 100,

        // Edge
        edgeUp:
          (combinedFairValue - polyUpVal) * 100,
        edgeDown:
          ((1 - combinedFairValue) -
            this.polymarketWs.book[symbol].DOWN.mid) *
          100,
      });
    });
  }

  private setupLogger() {
    const logDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logFile = path.join(logDir, "bot.log");
    const logStream = fs.createWriteStream(logFile, { flags: "a" });

    const formatMsg = (level: string, args: any[]) => {
      const timestamp = new Date().toISOString();
      const msg = util.format(...args);
      return `[${timestamp}] [${level}] ${msg}\n`;
    };

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args: any[]) => {
      logStream.write(formatMsg("INFO", args));
      originalLog.apply(console, args);
    };

    console.warn = (...args: any[]) => {
      logStream.write(formatMsg("WARN", args));
      originalWarn.apply(console, args);
    };

    console.error = (...args: any[]) => {
      logStream.write(formatMsg("ERROR", args));
      originalError.apply(console, args);
    };
    
    console.log(`📝 Logging initialized. Outputting to: ${logFile}`);
  }
}

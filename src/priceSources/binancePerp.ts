// src/priceSources/binancePerp.ts
import WebSocket from "ws";
import { AssetSymbol, Exchange } from "../types";
import { GBMFairProbability } from "../gbm";

export class BinancePerpSource {
  private ws: WebSocket | null = null;
  private running = true;

  // Prices
  public binanceBtcPrice = 0;
  public binanceEthPrice = 0;
  public binanceSolPrice = 0;
  public binanceXrpPrice = 0;

  // Start prices
  public binanceBtcStartPrice = 0;
  public binanceEthStartPrice = 0;
  public binanceSolStartPrice = 0;
  public binanceXrpStartPrice = 0;
  
  public binanceStartPrices: Record<AssetSymbol, number> = {
    BTC: 0,
    ETH: 0,
    SOL: 0,
    XRP: 0,
  };

  // Start times
  public binanceStartTimeBTC = 0;
  public binanceStartTimeETH = 0;
  public binanceStartTimeSOL = 0;
  public binanceStartTimeXRP = 0;

  // Health tracking
  private lastMessageTs = 0;
  private healthInterval: NodeJS.Timeout | null = null;

  constructor(
    private gbm: Record<AssetSymbol, Record<Exchange, GBMFairProbability>>,
    private onPriceUpdate: () => void
  ) {}

  connect(startTimes: {
    BTC: number;
    ETH: number;
    SOL: number;
    XRP: number;
  }) {
    this.binanceStartTimeBTC = startTimes.BTC;
    this.binanceStartTimeETH = startTimes.ETH;
    this.binanceStartTimeSOL = startTimes.SOL;
    this.binanceStartTimeXRP = startTimes.XRP;

    const WS_URL =
      "wss://fstream.binance.com/stream?streams=btcusdt@trade/ethusdt@trade/solusdt@trade/xrpusdt@trade";

    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;

      this.ws?.terminate();
      this.ws = new WebSocket(WS_URL);
      this.lastMessageTs = Date.now();

      this.ws.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Binance Perp WS connected");
      });

      this.ws.on("message", (data) => {
        this.lastMessageTs = Date.now();

        try {
          const msg = JSON.parse(data.toString());
          const trade = msg.data;
          if (!trade || trade.e !== "trade") return;

          const symbol = trade.s;
          const price = parseFloat(trade.p);
          if (!price || price <= 0) return;

          switch (symbol) {
            case "BTCUSDT":
              this.binanceBtcPrice = price;
              this.gbm.BTC.BINANCE.addPrice(price);
              if (this.binanceBtcStartPrice === 0 && this.binanceStartTimeBTC > 0) {
                this.binanceBtcStartPrice = price;
                this.binanceStartPrices.BTC = price;
              }
              break;

            case "ETHUSDT":
              this.binanceEthPrice = price;
              this.gbm.ETH.BINANCE.addPrice(price);
              if (this.binanceEthStartPrice === 0 && this.binanceStartTimeETH > 0) {
                this.binanceEthStartPrice = price;
                this.binanceStartPrices.ETH = price;
              }
              break;

            case "SOLUSDT":
              this.binanceSolPrice = price;
              this.gbm.SOL.BINANCE.addPrice(price);
              if (this.binanceSolStartPrice === 0 && this.binanceStartTimeSOL > 0) {
                this.binanceSolStartPrice = price;
                this.binanceStartPrices.SOL = price;
              }
              break;

            case "XRPUSDT":
              this.binanceXrpPrice = price;
              this.gbm.XRP.BINANCE.addPrice(price);
              if (this.binanceXrpStartPrice === 0 && this.binanceStartTimeXRP > 0) {
                this.binanceXrpStartPrice = price;
                this.binanceStartPrices.XRP = price;
              }
              break;
          }

          this.onPriceUpdate();
        } catch (err) {
          // swallow malformed ticks
        }
      });

      this.ws.on("close", () => {
        console.log("🔌 Binance WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });

      this.ws.on("error", () => {
        this.ws?.close();
      });

      // 🔍 Health watchdog (critical)
      if (this.healthInterval) clearInterval(this.healthInterval);
      this.healthInterval = setInterval(() => {
        const age = Date.now() - this.lastMessageTs;
        if (age > 5000) {
          console.warn(
            `⚠️ Binance WS stale (${age}ms no trades) → forcing reconnect`
          );
          this.ws?.terminate();
        }
      }, 2000);
    };

    connect();
  }

  stop() {
    this.running = false;
    this.healthInterval && clearInterval(this.healthInterval);
    this.ws?.close();
  }
}

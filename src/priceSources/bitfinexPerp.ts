import WebSocket from "ws";
import { AssetSymbol, Exchange } from "../types";
import { GBMFairProbability } from "../gbm";

/**
 * Bitfinex Perpetual Futures price source
 * Mirrors BinancePerpSource behavior
 */
export class BitfinexPerpSource {
  private ws: WebSocket | null = null;
  private running = true;

  // Prices
  public bitfinexBtcPrice = 0;
  public bitfinexEthPrice = 0;
  public bitfinexSolPrice = 0;
  public bitfinexXrpPrice = 0;

  // Start prices
  public bitfinexBtcStartPrice = 0;
  public bitfinexEthStartPrice = 0;
  public bitfinexSolStartPrice = 0;
  public bitfinexXrpStartPrice = 0;

  public bitfinexStartPrices: Record<AssetSymbol, number> = {
    BTC: 0,
    ETH: 0,
    SOL: 0,
    XRP: 0,
  };

  // Start times
  public bitfinexStartTimeBTC = 0;
  public bitfinexStartTimeETH = 0;
  public bitfinexStartTimeSOL = 0;
  public bitfinexStartTimeXRP = 0;

  // Health tracking
  private lastMessageTs = 0;
  private healthInterval: NodeJS.Timeout | null = null;

  // Channel → symbol mapping
  private channelToSymbol = new Map<number, AssetSymbol>();

  constructor(
    private gbm: Record<AssetSymbol, Record<Exchange, GBMFairProbability>>,
    private onPriceUpdate: () => void
  ) {}

  connect(startTimes: { BTC: number; ETH: number; SOL: number; XRP: number }) {
    this.bitfinexStartTimeBTC = startTimes.BTC;
    this.bitfinexStartTimeETH = startTimes.ETH;
    this.bitfinexStartTimeSOL = startTimes.SOL;
    this.bitfinexStartTimeXRP = startTimes.XRP;

    const WS_URL = "wss://api-pub.bitfinex.com/ws/2";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;

      this.ws?.terminate();
      this.ws = new WebSocket(WS_URL);
      this.lastMessageTs = Date.now();
      this.channelToSymbol.clear();

      this.ws.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Bitfinex Perp WS connected");

        // Subscribe to trades (perpetuals)
        this.subscribe("BTC", "tBTCUSD");
        this.subscribe("ETH", "tETHUSD");
        this.subscribe("SOL", "tSOLUSD");
        this.subscribe("XRP", "tXRPUSD");
      });

      this.ws.on("message", (raw) => {
        this.lastMessageTs = Date.now();

        try {
          const msg = JSON.parse(raw.toString());

          // Subscription confirmation
          if (msg.event === "subscribed" && msg.channel === "trades") {
            const symbol = this.mapSymbol(msg.symbol);
            if (symbol) {
              this.channelToSymbol.set(msg.chanId, symbol);
            }
            return;
          }

          // Heartbeat
          if (Array.isArray(msg) && msg[1] === "hb") return;

          // Trade message
          if (Array.isArray(msg) && Array.isArray(msg[2])) {
            const chanId = msg[0];
            const symbol = this.channelToSymbol.get(chanId);
            if (!symbol) return;

            // trade format: [ ID, MTS, AMOUNT, PRICE ]
            const trade = msg[2];
            const price = Math.abs(trade[3]);
            if (!price || price <= 0) return;

            this.handlePrice(symbol, price);
          }
        } catch {
          // ignore malformed packets
        }
      });

      this.ws.on("close", () => {
        console.log("🔌 Bitfinex WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });

      this.ws.on("error", () => {
        this.ws?.close();
      });

      // Health watchdog
      if (this.healthInterval) clearInterval(this.healthInterval);
      this.healthInterval = setInterval(() => {
        const age = Date.now() - this.lastMessageTs;
        if (age > 5000) {
          console.warn(
            `⚠️ Bitfinex WS stale (${age}ms no trades) → forcing reconnect`
          );
          this.ws?.terminate();
        }
      }, 2000);
    };

    connect();
  }

  private subscribe(symbol: AssetSymbol, finSymbol: string) {
    this.ws?.send(
      JSON.stringify({
        event: "subscribe",
        channel: "trades",
        symbol: finSymbol,
      })
    );
  }

  private mapSymbol(finSymbol: string): AssetSymbol | null {
    switch (finSymbol) {
      case "tBTCUSD":
        return "BTC";
      case "tETHUSD":
        return "ETH";
      case "tSOLUSD":
        return "SOL";
      case "tXRPUSD":
        return "XRP";
      default:
        return null;
    }
  }

  private handlePrice(symbol: AssetSymbol, price: number) {
    switch (symbol) {
      case "BTC":
        this.bitfinexBtcPrice = price;
        this.gbm.BTC.BITFINEX.addPrice(price);
        if (this.bitfinexBtcStartPrice === 0 && this.bitfinexStartTimeBTC > 0) {
          this.bitfinexBtcStartPrice = price;
          this.bitfinexStartPrices.BTC = price;
          console.log(`🎯 BTC Bitfinex start price set: $${price.toFixed(2)}`);
        }
        break;

      case "ETH":
        this.bitfinexEthPrice = price;
        this.gbm.ETH.BITFINEX.addPrice(price);
        if (this.bitfinexEthStartPrice === 0 && this.bitfinexStartTimeETH > 0) {
          this.bitfinexEthStartPrice = price;
          this.bitfinexStartPrices.ETH = price;
          console.log(`🎯 ETH Bitfinex start price set: $${price.toFixed(2)}`);
        }
        break;

      case "SOL":
        this.bitfinexSolPrice = price;
        this.gbm.SOL.BITFINEX.addPrice(price);
        if (this.bitfinexSolStartPrice === 0 && this.bitfinexStartTimeSOL > 0) {
          this.bitfinexSolStartPrice = price;
          this.bitfinexStartPrices.SOL = price;
          this.bitfinexStartPrices.XRP = price;
          console.log(`🎯 SOL Bitfinex start price set: $${price.toFixed(4)}`);
        }
        break;

      case "XRP":
        this.bitfinexXrpPrice = price;
        this.gbm.XRP.BITFINEX.addPrice(price);
        if (this.bitfinexXrpStartPrice === 0 && this.bitfinexStartTimeXRP > 0) {
          this.bitfinexXrpStartPrice = price;
          console.log(`🎯 XRP Bitfinex start price set: $${price.toFixed(4)}`);
        }
        break;
    }

    this.onPriceUpdate();
  }

  stop() {
    this.running = false;
    this.healthInterval && clearInterval(this.healthInterval);
    this.ws?.close();
  }
}

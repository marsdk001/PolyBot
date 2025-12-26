import WebSocket from "ws";
import { AssetSymbol, Exchange } from "../types";
import { GBMFairProbability } from "../gbm";

export class CoinbaseSpotSource {
  private ws: WebSocket | null = null;
  private running = true;

  public coinbaseBTCPrice = 0;
  public coinbaseETHPrice = 0;
  public coinbaseSOLPrice = 0;
  public coinbaseXRPPrice = 0;

  public coinbaseStartPrices: Record<AssetSymbol, number> = {
    BTC: 0,
    ETH: 0,
    SOL: 0,
    XRP: 0,
  };

  public lastMessageTs = 0;

  constructor(
    private gbm: Record<AssetSymbol, Record<Exchange, GBMFairProbability>>,
    private onPriceUpdate: () => void
  ) {}

  connect() {
    const WS_URL = "wss://ws-feed.exchange.coinbase.com";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.ws?.terminate();
      this.ws = new WebSocket(WS_URL);

      this.ws.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Coinbase Spot WS connected");
        this.ws!.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"],
            channels: ["ticker", "heartbeat"],
          })
        );
      });

      this.ws.on("message", (data) => {
        this.lastMessageTs = Date.now();
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "heartbeat") return;

          if (msg.type === "ticker" && msg.price) {
            const price = parseFloat(msg.price);
            if (price <= 0) return;

            switch (msg.product_id) {
              case "BTC-USD":
                this.coinbaseBTCPrice = price;
                this.gbm.BTC.COINBASE.addPrice(price);
                break;
              case "ETH-USD":
                this.coinbaseETHPrice = price;
                this.gbm.ETH.COINBASE.addPrice(price);
                break;
              case "SOL-USD":
                this.coinbaseSOLPrice = price;
                this.gbm.SOL.COINBASE.addPrice(price);
                break;
              case "XRP-USD":
                this.coinbaseXRPPrice = price;
                this.gbm.XRP.COINBASE.addPrice(price);
                break;
            }
            this.onPriceUpdate();
          }
        } catch {}
      });

      this.ws.on("close", () => {
        console.log("🔌 Coinbase WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });

      this.ws.on("error", () => this.ws?.close());
    };

    connect();
  }

  stop() {
    this.running = false;
    this.ws?.close();
  }
}
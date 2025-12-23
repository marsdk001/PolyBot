// src/priceSources/bitgetPerp.ts
import WebSocket from "ws";
import { AssetSymbol, Exchange } from "../types";
import { GBMFairProbability } from "../gbm";

export class BitgetPerpSource {
  private ws: WebSocket | null = null;
  private running = true;

  public bitgetBTCPrice = 0;
  public bitgetETHPrice = 0;
  public bitgetSOLPrice = 0;
  public bitgetXRPPrice = 0;

  public bitgetStartPrices: Record<AssetSymbol, number> = {
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
    const WS_URL = "wss://ws.bitget.com/v2/ws/public";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.ws?.terminate();
      this.ws = new WebSocket(WS_URL);

      this.ws.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Bitget Perpetual TRADE WS connected (V2)");

        this.ws!.send(
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

        const pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send("ping");
          }
        }, 5000);

        this.ws?.on("close", () => clearInterval(pingInterval));
      });

      this.ws.on("message", (data) => {
        this.lastMessageTs = Date.now();
        const msgStr = data.toString();
        if (msgStr === "pong") return;

        try {
          const msg = JSON.parse(msgStr);

          if (msg.arg?.channel !== "trade") return;
          if (!msg.data || !Array.isArray(msg.data)) return;

          for (const trade of msg.data) {
            const instId = trade.instId || msg.arg.instId;
            const price = parseFloat(trade.px || trade.price);
            if (price <= 0) continue;

            switch (instId) {
              case "BTCUSDT":
                this.bitgetBTCPrice = price;
                this.gbm.BTC.BITGET.addPrice(price);
                break;
              case "ETHUSDT":
                this.bitgetETHPrice = price;
                this.gbm.ETH.BITGET.addPrice(price);
                break;
              case "SOLUSDT":
                this.bitgetSOLPrice = price;
                this.gbm.SOL.BITGET.addPrice(price);
                break;
              case "XRPUSDT":
                this.bitgetXRPPrice = price;
                this.gbm.XRP.BITGET.addPrice(price);
                break;
            }
          }

          this.onPriceUpdate();
        } catch {}
      });

      this.ws.on("close", () => {
        console.log("🔌 Bitget WS closed → reconnecting...");
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
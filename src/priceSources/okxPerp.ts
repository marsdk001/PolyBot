// src/priceSources/okxPerp.ts
import WebSocket from "ws";
import { AssetSymbol, Exchange } from "../types";
import { GBMFairProbability } from "../gbm";

export class OkxPerpSource {
  private ws: WebSocket | null = null;
  private running = true;

  public okxBTCPrice = 0;
  public okxETHPrice = 0;
  public okxSOLPrice = 0;
  public okxXRPPrice = 0;

  public okxStartPrices: Record<AssetSymbol, number> = {
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
    const WS_URL = "wss://ws.okx.com:8443/ws/v5/public";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.ws?.terminate();
      this.ws = new WebSocket(WS_URL);

      this.ws.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ OKX Perpetual TRADE WS connected");
        this.ws!.send(
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

      this.ws.on("message", (data) => {
        this.lastMessageTs = Date.now();
        try {
          const msg = JSON.parse(data.toString());
          if (msg.arg?.channel === "trades" && msg.data) {
            for (const trade of msg.data) {
              const instId = trade.instId;
              const price = parseFloat(trade.px);
              if (price <= 0) continue;

              switch (instId) {
                case "BTC-USDT-SWAP":
                  this.okxBTCPrice = price;
                  this.gbm.BTC.OKX.addPrice(price);
                  break;
                case "ETH-USDT-SWAP":
                  this.okxETHPrice = price;
                  this.gbm.ETH.OKX.addPrice(price);
                  break;
                case "SOL-USDT-SWAP":
                  this.okxSOLPrice = price;
                  this.gbm.SOL.OKX.addPrice(price);
                  break;
                case "XRP-USDT-SWAP":
                  this.okxXRPPrice = price;
                  this.gbm.XRP.OKX.addPrice(price);
                  break;
              }
              this.onPriceUpdate();
            }
          }
        } catch {}
      });

      this.ws.on("close", () => {
        console.log("🔌 OKX WS closed → reconnecting...");
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
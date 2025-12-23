// src/priceSources/mexcPerp.ts
import WebSocket from "ws";
import { AssetSymbol, Exchange } from "../types";
import { GBMFairProbability } from "../gbm";

export class MexcPerpSource {
  private ws: WebSocket | null = null;
  private running = true;

  public mexcBTCPrice = 0;
  public mexcETHPrice = 0;
  public mexcSOLPrice = 0;
  public mexcXRPPrice = 0;

  public mexcStartPrices: Record<AssetSymbol, number> = {
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
    const WS_URL = "wss://contract.mexc.com/edge";
    let reconnectAttempts = 0;
    const symbols = ["BTC_USDT", "ETH_USDT", "SOL_USDT", "XRP_USDT"];

    const connect = () => {
      if (!this.running) return;
      this.ws?.terminate();
      this.ws = new WebSocket(WS_URL);

      this.ws.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ MEXC Perpetual TRADE WS connected");

        symbols.forEach((sym) => {
          this.ws!.send(
            JSON.stringify({
              method: "sub.deal",
              param: { symbol: sym },
            })
          );
        });

        // Keep-alive ping
        const pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ method: "ping" }));
          }
        }, 20000);

        this.ws?.on("close", () => clearInterval(pingInterval));
      });

      this.ws.on("message", (data) => {
        this.lastMessageTs = Date.now();
        try {
          const msg = JSON.parse(data.toString());

          if (msg.channel !== "push.deal" || !Array.isArray(msg.data)) return;

          for (const trade of msg.data) {
            const price = parseFloat(trade.p);
            if (!price || price <= 0) continue;

            switch (msg.symbol) {
              case "BTC_USDT":
                this.mexcBTCPrice = price;
                this.gbm.BTC.MEXC.addPrice(price);
                break;
              case "ETH_USDT":
                this.mexcETHPrice = price;
                this.gbm.ETH.MEXC.addPrice(price);
                break;
              case "SOL_USDT":
                this.mexcSOLPrice = price;
                this.gbm.SOL.MEXC.addPrice(price);
                break;
              case "XRP_USDT":
                this.mexcXRPPrice = price;
                this.gbm.XRP.MEXC.addPrice(price);
                break;
            }
          }

          this.onPriceUpdate();
        } catch {}
      });

      this.ws.on("close", () => {
        console.log("🔌 MEXC WS closed → reconnecting...");
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
// src/priceSources/bybitPerp.ts
import WebSocket from "ws";
import { AssetSymbol, Exchange } from "../types";
import { GBMFairProbability } from "../gbm";

export class BybitPerpSource {
  private ws: WebSocket | null = null;
  private running = true;

  public bybitBTCPrice = 0;
  public bybitETHPrice = 0;
  public bybitSOLPrice = 0;
  public bybitXRPPrice = 0;

  public bybitStartPrices: Record<AssetSymbol, number> = {
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
    const WS_URL = "wss://stream.bybit.com/v5/public/linear";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.ws?.terminate();
      this.ws = new WebSocket(WS_URL);

      this.ws.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Bybit Perpetual TRADE WS connected");
        this.ws!.send(
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

      this.ws.on("message", (data) => {
        this.lastMessageTs = Date.now();
        try {
          const msg = JSON.parse(data.toString());
          if (msg.topic?.startsWith("publicTrade.") && msg.data) {
            for (const trade of msg.data) {
              const symbol = trade.s;
              const price = parseFloat(trade.p);
              if (price <= 0) continue;

              switch (symbol) {
                case "BTCUSDT":
                  this.bybitBTCPrice = price;
                  this.gbm.BTC.BYBIT.addPrice(price);
                  break;
                case "ETHUSDT":
                  this.bybitETHPrice = price;
                  this.gbm.ETH.BYBIT.addPrice(price);
                  break;
                case "SOLUSDT":
                  this.bybitSOLPrice = price;
                  this.gbm.SOL.BYBIT.addPrice(price);
                  break;
                case "XRPUSDT":
                  this.bybitXRPPrice = price;
                  this.gbm.XRP.BYBIT.addPrice(price);
                  break;
              }
              this.onPriceUpdate();
            }
          }
        } catch {}
      });

      this.ws.on("close", () => {
        console.log("🔌 Bybit WS closed → reconnecting...");
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
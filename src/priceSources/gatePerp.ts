// src/priceSources/gatePerp.ts
import WebSocket from "ws";
import { AssetSymbol, Exchange } from "../types";
import { GBMFairProbability } from "../gbm";

export class GatePerpSource {
  private ws: WebSocket | null = null;
  private running = true;

  public gateBTCPrice = 0;
  public gateETHPrice = 0;
  public gateSOLPrice = 0;
  public gateXRPPrice = 0;

  public gateStartPrices: Record<AssetSymbol, number> = {
    BTC: 0,
    ETH: 0,
    SOL: 0,
    XRP: 0,
  };

  constructor(
    private gbm: Record<AssetSymbol, Record<Exchange, GBMFairProbability>>,
    private onPriceUpdate: () => void
  ) {}

  connect() {
    const WS_URL = "wss://fx-ws.gateio.ws/v4/ws/usdt";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.ws?.terminate();
      this.ws = new WebSocket(WS_URL);

      this.ws.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Gate.io Perpetual TRADE WS connected");
        this.ws!.send(
          JSON.stringify({
            time: Math.floor(Date.now() / 1000),
            channel: "futures.trades",
            event: "subscribe",
            payload: ["BTC_USDT", "ETH_USDT", "SOL_USDT", "XRP_USDT"],
          })
        );
      });

      this.ws.on("message", (data) => {
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
                  this.gateBTCPrice = price;
                  this.gbm.BTC.GATE.addPrice(price);
                  break;
                case "ETH_USDT":
                  this.gateETHPrice = price;
                  this.gbm.ETH.GATE.addPrice(price);
                  break;
                case "SOL_USDT":
                  this.gateSOLPrice = price;
                  this.gbm.SOL.GATE.addPrice(price);
                  break;
                case "XRP_USDT":
                  this.gateXRPPrice = price;
                  this.gbm.XRP.GATE.addPrice(price);
                  break;
              }
              this.onPriceUpdate();
            }
          }
        } catch {}
      });

      this.ws.on("close", () => {
        console.log("🔌 Gate.io WS closed → reconnecting...");
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
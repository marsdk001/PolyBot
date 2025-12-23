// src/priceSources/deepcoinPerp.ts
import WebSocket from "ws";
import { AssetSymbol, Exchange } from "../types";
import { GBMFairProbability } from "../gbm";

export class DeepcoinPerpSource {
  private ws: WebSocket | null = null;
  private running = true;
  private pingInterval: NodeJS.Timeout | null = null;

  public deepcoinBTCPrice = 0;
  public deepcoinETHPrice = 0;
  public deepcoinSOLPrice = 0;
  public deepcoinXRPPrice = 0;

  public deepcoinStartPrices: Record<AssetSymbol, number> = {
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
    const WS_URL =
      "wss://stream.deepcoin.com/streamlet/trade/public/swap?platform=api";
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;

      // Clean up old connection
      if (this.ws) {
        this.ws.removeAllListeners();
        this.ws.terminate();
      }
      if (this.pingInterval) clearInterval(this.pingInterval);

      this.ws = new WebSocket(WS_URL);

      this.ws.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Deepcoin Perpetual TRADE WS connected");

        const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"];
        symbols.forEach((inst, idx) => {
          this.ws!.send(
            JSON.stringify({
              SendTopicAction: {
                Action: "1",
                FilterValue: `DeepCoin_${inst}`,
                LocalNo: idx + 1,
                ResumeNo: -1,  // Recommended for resume from latest
                TopicID: "2",  // "2" = trade/transaction details (more reliable)
              },
            })
          );
        });

        // Send "ping" every 20 seconds to keep alive
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send("ping");
            // Optional: console.log("❤️ Deepcoin ping sent");
          }
        }, 20000);
      });

      this.ws.on("message", (data) => {
        this.lastMessageTs = Date.now();
        const msgStr = data.toString();

        // Ignore pong responses
        if (msgStr === "pong") {
          // Optional: console.log("❤️ Deepcoin pong received");
          return;
        }

        try {
          const msg = JSON.parse(msgStr);
          if (!Array.isArray(msg.r)) return;

          let updated = false;

          msg.r.forEach((item: any) => {
            const d = item.d;
            if (!d || !d.I || !d.N) return;

            const symbol = d.I;
            const price = parseFloat(d.N);
            if (!(price > 0)) return;

            let asset: AssetSymbol | null = null;

            switch (symbol) {
              case "BTCUSDT":
                this.deepcoinBTCPrice = price;
                this.gbm.BTC.DEEPCOIN.addPrice(price);
                asset = "BTC";
                break;
              case "ETHUSDT":
                this.deepcoinETHPrice = price;
                this.gbm.ETH.DEEPCOIN.addPrice(price);
                asset = "ETH";
                break;
              case "SOLUSDT":
                this.deepcoinSOLPrice = price;
                this.gbm.SOL.DEEPCOIN.addPrice(price);
                asset = "SOL";
                break;
              case "XRPUSDT":
                this.deepcoinXRPPrice = price;
                this.gbm.XRP.DEEPCOIN.addPrice(price);
                asset = "XRP";
                break;
            }

            if (asset && this.deepcoinStartPrices[asset] === 0) {
              this.deepcoinStartPrices[asset] = price;
            }

            updated = true;
          });

          if (updated) this.onPriceUpdate();
        } catch {}
      });

      this.ws.on("close", () => {
        console.log("🔌 Deepcoin WS closed → reconnecting...");
        if (this.pingInterval) clearInterval(this.pingInterval);
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 10000));
      });

      this.ws.on("error", (err) => {
        console.error("❌ Deepcoin WS error:", err.message);
      });
    };

    connect();
  }

  stop() {
    this.running = false;
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.ws?.terminate();
  }
}
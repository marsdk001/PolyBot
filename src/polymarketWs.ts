// src/polymarketWs.ts
import WebSocket from "ws";
import { AssetSymbol, MarketBook, PolyPoint, FairProbs } from "./types";

export class PolymarketWs {
  private ws: WebSocket | null = null;
  private running = true;
  public lastMessageTs = 0;

  public book: Record<AssetSymbol, Record<"UP" | "DOWN", MarketBook>> = {
    BTC: { UP: { bid: 0, ask: 0, mid: 0 }, DOWN: { bid: 0, ask: 0, mid: 0 } },
    ETH: { UP: { bid: 0, ask: 0, mid: 0 }, DOWN: { bid: 0, ask: 0, mid: 0 } },
    SOL: { UP: { bid: 0, ask: 0, mid: 0 }, DOWN: { bid: 0, ask: 0, mid: 0 } },
    XRP: { UP: { bid: 0, ask: 0, mid: 0 }, DOWN: { bid: 0, ask: 0, mid: 0 } },
  };

  public polyHistory: Record<AssetSymbol, PolyPoint[]> = {
    BTC: [],
    ETH: [],
    SOL: [],
    XRP: [],
  };

  private tokenIds: Record<
    AssetSymbol,
    { up: string | null; down: string | null }
  > = {
    BTC: { up: null, down: null },
    ETH: { up: null, down: null },
    SOL: { up: null, down: null },
    XRP: { up: null, down: null },
  };

  constructor(private onUpdate: () => void) {}

  connect() {
    let reconnectAttempts = 0;

    const connect = () => {
      if (!this.running) return;
      this.ws?.close();
      this.ws = new WebSocket(
        "wss://ws-subscriptions-clob.polymarket.com/ws/market"
      );

      const pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send("PING");
        }
      }, 5000);

      // Health watchdog
      const healthInterval = setInterval(() => {
        const age = Date.now() - this.lastMessageTs;
        if (age > 15000) {
          console.warn(`⚠️ Polymarket WS stale (${age}ms) → forcing reconnect`);
          this.ws?.terminate();
        }
      }, 2000);

      this.ws.on("open", () => {
        reconnectAttempts = 0;
        console.log("✅ Polymarket WS connected");

        const allIds = Object.values(this.tokenIds)
          .flatMap((ids) => [ids.up, ids.down])
          .filter(Boolean) as string[];

        if (allIds.length > 0) {
          this.ws?.send(JSON.stringify({ type: "market", assets_ids: allIds }));
        }
      });

      this.ws.on("message", (data) => {
        this.lastMessageTs = Date.now();
        try {
          const msg = JSON.parse(data.toString());
          if (msg === "PONG") return;
          this.processMessage(msg);
          this.onUpdate();
        } catch {}
      });

      this.ws.on("close", () => {
        clearInterval(pingInterval);
        clearInterval(healthInterval);
        console.log("🔌 Polymarket WS closed → reconnecting...");
        setTimeout(connect, Math.min(1000 * ++reconnectAttempts, 8000));
      });

      this.ws.on("error", () => {
        clearInterval(pingInterval);
        clearInterval(healthInterval);
        this.ws?.close();
      });
    };

    connect();
  }

  reconnect() {
    console.log("🔄 Forcing Polymarket WS reconnect for new market");
    this.ws?.close();
    // The existing connect() logic will handle reconnection automatically
  }

  updateTokenIds(symbol: AssetSymbol, up: string | null, down: string | null) {
    this.tokenIds[symbol] = { up, down };

    if (this.ws?.readyState === WebSocket.OPEN) {
      const allIds = Object.values(this.tokenIds)
        .flatMap((ids) => [ids.up, ids.down])
        .filter(Boolean) as string[];

      if (allIds.length > 0) {
        this.ws.send(JSON.stringify({ type: "market", assets_ids: allIds }));
        console.log(`📡 Resubscribed Polymarket WS for ${symbol}`);
      }
    }
  }

  private processMessage(msg: any) {
    const changes = msg.price_changes || msg;
    const list = Array.isArray(changes) ? changes : [msg];

    for (const c of list) {
      const id = c.asset_id || c.assetId;
      const bid = parseFloat(c.best_bid || c.bid || "0");
      const ask = parseFloat(c.best_ask || c.ask || "0");
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;

      if (!id || mid <= 0) continue;

      // Type-safe search over known symbols
      let foundSymbol: AssetSymbol | null = null;
      let side: "UP" | "DOWN" | null = null;

      // Check each possible symbol
      if (this.tokenIds.BTC.up === id) {
        foundSymbol = "BTC";
        side = "UP";
      } else if (this.tokenIds.BTC.down === id) {
        foundSymbol = "BTC";
        side = "DOWN";
      } else if (this.tokenIds.ETH.up === id) {
        foundSymbol = "ETH";
        side = "UP";
      } else if (this.tokenIds.ETH.down === id) {
        foundSymbol = "ETH";
        side = "DOWN";
      } else if (this.tokenIds.SOL.up === id) {
        foundSymbol = "SOL";
        side = "UP";
      } else if (this.tokenIds.SOL.down === id) {
        foundSymbol = "SOL";
        side = "DOWN";
      } else if (this.tokenIds.XRP.up === id) {
        foundSymbol = "XRP";
        side = "UP";
      } else if (this.tokenIds.XRP.down === id) {
        foundSymbol = "XRP";
        side = "DOWN";
      }

      if (foundSymbol && side) {
        Object.assign(this.book[foundSymbol][side], { bid, ask, mid });

        const hist = this.polyHistory[foundSymbol];
        hist.push({
          ts: Date.now(),
          up: this.book[foundSymbol].UP.mid,
          down: this.book[foundSymbol].DOWN.mid,
        });
        if (hist.length > 600) hist.shift();
      }
    }
  }

  getRecentPolyChange(
    symbol: AssetSymbol,
    ms: number,
    dir: "up" | "down"
  ): number {
    const hist = this.polyHistory[symbol];
    if (hist.length < 2) return 999;

    const now = hist[hist.length - 1].ts;
    const target = now - ms;
    const pastEntry = [...hist].reverse().find((p) => p.ts <= target);
    if (!pastEntry) return 999;

    const curr = hist[hist.length - 1][dir];
    const past = pastEntry[dir];
    return Math.abs(curr - past);
  }

  stop() {
    this.running = false;
    this.ws?.close();
  }
}

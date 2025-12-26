// src/marketFinder.ts
import { AssetSymbol } from "./types";
import { DELTA_ANCHOR_EXCHANGE } from "./constants";

export class MarketFinder {
  private tokenIdUp: string | null = null;
  private tokenIdDown: string | null = null;
  private tokenIdUpETH: string | null = null;
  private tokenIdDownETH: string | null = null;
  private tokenIdUpSOL: string | null = null;
  private tokenIdDownSOL: string | null = null;
  private tokenIdUpXRP: string | null = null;
  private tokenIdDownXRP: string | null = null;

  private binanceStartTimeBTC = 0;
  private binanceStartTimeETH = 0;
  private binanceStartTimeSOL = 0;
  private binanceStartTimeXRP = 0;

  private binanceBtcStartPrice = 0;
  private binanceEthStartPrice = 0;
  private binanceSolStartPrice = 0;
  private binanceXrpStartPrice = 0;

  // Getters for use in main bot
  getTokenIds(symbol: AssetSymbol): { up: string | null; down: string | null } {
    switch (symbol) {
      case "BTC":
        return { up: this.tokenIdUp, down: this.tokenIdDown };
      case "ETH":
        return { up: this.tokenIdUpETH, down: this.tokenIdDownETH };
      case "SOL":
        return { up: this.tokenIdUpSOL, down: this.tokenIdDownSOL };
      case "XRP":
        return { up: this.tokenIdUpXRP, down: this.tokenIdDownXRP };
    }
  }

  getStartTime(symbol: AssetSymbol): number {
    switch (symbol) {
      case "BTC":
        return this.binanceStartTimeBTC;
      case "ETH":
        return this.binanceStartTimeETH;
      case "SOL":
        return this.binanceStartTimeSOL;
      case "XRP":
        return this.binanceStartTimeXRP;
    }
  }

  getStartPrice(symbol: AssetSymbol): number {
    switch (symbol) {
      case "BTC":
        return this.binanceBtcStartPrice;
      case "ETH":
        return this.binanceEthStartPrice;
      case "SOL":
        return this.binanceSolStartPrice;
      case "XRP":
        return this.binanceXrpStartPrice;
    }
  }

  async findMarkets(): Promise<void> {
    await Promise.all([
      this.findMarket("btc"),
      this.findMarket("eth"),
      this.findMarket("sol"),
      this.findMarket("xrp"),
    ]);
  }

  private async findMarket(symbol: "btc" | "eth" | "sol" | "xrp") {
    const now = Date.now();
    const interval = 15 * 60 * 1000;

    let base = now - (now % interval);

    for (let i = -1; i < 10; i++) {
      const openTimestampMs = base + i * interval;

      if (
        now - openTimestampMs > interval &&
        now - openTimestampMs < 2 * interval
      )
        continue;

      const ts = Math.floor(openTimestampMs / 1000);
      const slug = `${symbol}-updown-15m-${ts}`;

      try {
        const res = await fetch(
          `https://gamma-api.polymarket.com/markets?slug=${slug}&active=true&closed=false`
        );

        if (!res.ok) continue;

        const json: any = await res.json();
        const market = Array.isArray(json) ? json[0] : json?.data?.[0];

        if (market?.clobTokenIds) {
          const ids =
            typeof market.clobTokenIds === "string"
              ? JSON.parse(market.clobTokenIds)
              : market.clobTokenIds;

          const upperSymbol = symbol.toUpperCase() as AssetSymbol;

          if (symbol === "btc") {
            this.tokenIdUp = ids[0];
            this.tokenIdDown = ids[1];
            this.binanceStartTimeBTC = openTimestampMs;
          } else if (symbol === "eth") {
            this.tokenIdUpETH = ids[0];
            this.tokenIdDownETH = ids[1];
            this.binanceStartTimeETH = openTimestampMs;
          } else if (symbol === "sol") {
            this.tokenIdUpSOL = ids[0];
            this.tokenIdDownSOL = ids[1];
            this.binanceStartTimeSOL = openTimestampMs;
          } else if (symbol === "xrp") {
            this.tokenIdUpXRP = ids[0];
            this.tokenIdDownXRP = ids[1];
            this.binanceStartTimeXRP = openTimestampMs;
          }

          console.log(
            `✅ Found new ${upperSymbol} market: ${market.question} (starts ${new Date(
              openTimestampMs
            ).toLocaleTimeString()})`
          );

          await this.fetchStartPrice(symbol, openTimestampMs);
          return;
        }
      } catch (err) {
        // Silent
      }
    }

    console.warn(`⚠️ No active ${symbol.toUpperCase()} 15m market found`);
  }

  private async fetchStartPrice(
    symbol: "btc" | "eth" | "sol" | "xrp",
    openTimestampMs: number
  ) {
    if (DELTA_ANCHOR_EXCHANGE === "COINBASE") {
      const success = await this.fetchCoinbaseStartPrice(symbol, openTimestampMs);
      if (success) return;
    }

    const binanceSymbol =
      symbol === "btc"
        ? "BTCUSDT"
        : symbol === "eth"
        ? "ETHUSDT"
        : symbol === "sol"
        ? "SOLUSDT"
        : "XRPUSDT";

    const endTimestampMs = openTimestampMs + 15 * 60 * 1000;

    try {
      const res = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${binanceSymbol}&interval=15m&startTime=${openTimestampMs}&endTime=${endTimestampMs}&limit=1`
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as any[];

      if (Array.isArray(data) && data.length > 0) {
        const openPrice = parseFloat(data[0][1]);

        if (symbol === "btc") this.binanceBtcStartPrice = openPrice;
        else if (symbol === "eth") this.binanceEthStartPrice = openPrice;
        else if (symbol === "sol") this.binanceSolStartPrice = openPrice;
        else if (symbol === "xrp") this.binanceXrpStartPrice = openPrice;

        console.log(
          `✅ True ${symbol.toUpperCase()} start price fetched: $${openPrice.toFixed(
            symbol === "sol" || symbol === "xrp" ? 4 : 2
          )} (Binance 15m open)`
        );
      }
    } catch (err) {
      console.warn(`⚠️ Failed to fetch start price for ${binanceSymbol}`);
      console.log(`⬇️ Will use first live tick as fallback`);
    }
  }

  private async fetchCoinbaseStartPrice(
    symbol: "btc" | "eth" | "sol" | "xrp",
    openTimestampMs: number
  ): Promise<boolean> {
    const product =
      symbol === "btc"
        ? "BTC-USD"
        : symbol === "eth"
        ? "ETH-USD"
        : symbol === "sol"
        ? "SOL-USD"
        : "XRP-USD";

    const startISO = new Date(openTimestampMs).toISOString();
    const endISO = new Date(openTimestampMs + 15 * 60 * 1000).toISOString();

    try {
      const res = await fetch(
        `https://api.exchange.coinbase.com/products/${product}/candles?granularity=900&start=${startISO}&end=${endISO}`
      );
      if (!res.ok) return false;
      const data = (await res.json()) as any[];

      if (Array.isArray(data) && data.length > 0) {
        // Coinbase: [time, low, high, open, close, volume] -> Open is index 3
        // API returns newest first, but we requested a specific 15m slice
        const candle = data[data.length - 1];
        const openPrice = candle[3];
        this.setStartPrice(symbol, openPrice);
        console.log(
          `✅ True ${symbol.toUpperCase()} start price fetched: $${openPrice} (Coinbase 15m open)`
        );
        return true;
      }
    } catch (e) {}
    return false;
  }

  private setStartPrice(symbol: "btc" | "eth" | "sol" | "xrp", price: number) {
    if (symbol === "btc") this.binanceBtcStartPrice = price;
    else if (symbol === "eth") this.binanceEthStartPrice = price;
    else if (symbol === "sol") this.binanceSolStartPrice = price;
    else if (symbol === "xrp") this.binanceXrpStartPrice = price;
  }
}
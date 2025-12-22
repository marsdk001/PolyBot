// src/tradingLogic.ts
import { AssetSymbol, FairProbs, MarketBook } from "./types";
import { PolymarketClient } from "./polymarketClient";
import { config } from "./config";
import { PolymarketWs } from "./polymarketWs";

export class TradingLogic {
  private lastTradeTime: Record<AssetSymbol, number> = {
    BTC: 0,
    ETH: 0,
    SOL: 0,
    XRP: 0,
  };

  constructor(
    private fairProbs: Record<AssetSymbol, FairProbs>,
    private getPolyBook: (
      symbol: AssetSymbol
    ) => Record<"UP" | "DOWN", MarketBook>,
    private getStartPrice: (symbol: AssetSymbol) => number,
    private getCurrentPrice: (symbol: AssetSymbol) => number,
    private getMarketStartTime: (symbol: AssetSymbol) => number,
    private getTokenId: (
      symbol: AssetSymbol,
      side: "UP" | "DOWN"
    ) => string | null,
    private polymarketWs: PolymarketWs,
    private client: PolymarketClient,
    private isTradingEnabled: () => boolean
  ) {}

  checkForTrade(symbol: AssetSymbol, now: number) {
    if (!this.isTradingEnabled()) {
      return;
    }
    if (now - this.lastTradeTime[symbol] < config.TRADE_COOLDOWN) return;

    const fair = this.fairProbs[symbol];
    const poly = this.getPolyBook(symbol);

    const startPrice = this.getStartPrice(symbol);
    const currentPrice = this.getCurrentPrice(symbol);

    if (startPrice <= 0 || currentPrice <= 0) return;

    const pctDelta = ((currentPrice - startPrice) / startPrice) * 100;

    const marketStartTime = this.getMarketStartTime(symbol);
    const minsLeft = Math.max(0, (marketStartTime + 900_000 - now) / 60_000);
    if (minsLeft <= 0) return;

    // Simple spike detection on Binance
    const recentChange = this.polymarketWs.getRecentPolyChange(
      symbol,
      1000,
      "up"
    ); // placeholder logic, adjust as needed
    // In original: used GBM recent pct change
    // We'll approximate with price movement for now

    const priceSpike = Math.abs(pctDelta); // simplified

    let side: "UP" | "DOWN" | null = null;
    if (currentPrice > startPrice) side = "UP";
    else if (currentPrice < startPrice) side = "DOWN";

    if (!side) return;

    const edge =
      side === "UP" ? fair.UP - poly.UP.mid : fair.DOWN - poly.DOWN.mid;

    if (edge <= config.PRICE_DIFFERENCE_THRESHOLD) return;

    const tokenId = this.getTokenId(symbol, side);
    if (!tokenId) return;

    const price = poly[side].mid;
    if (price <= 0) return;

    this.executeTrade(symbol, tokenId, price);
    this.lastTradeTime[symbol] = now;
  }

  private async executeTrade(
    symbol: AssetSymbol,
    tokenId: string,
    price: number
  ) {
    console.log(`\n🚀 TRADE ${symbol} @ $${price.toFixed(4)}`);

    const size = config.DEFAULT_TRADE_AMOUNT / price;

    try {
      await this.client.createAndPostOrder({
        tokenID: tokenId,
        price: price * 1.005,
        size,
        side: "BUY" as any,
      });

      console.log(`✅ Buy order placed`);

      const tpPrice = Math.min(price + 0.012, 0.99);
      const slPrice = Math.max(price - 0.008, 0.01);

      await Promise.all([
        this.client.createAndPostOrder({
          tokenID: tokenId,
          price: tpPrice,
          size,
          side: "SELL" as any,
        }),
        this.client.createAndPostOrder({
          tokenID: tokenId,
          price: slPrice,
          size,
          side: "SELL" as any,
        }),
      ]);

      console.log(`✅ TP/SL placed`);
    } catch (e: any) {
      console.error("❌ Trade failed:", e.message);
    }
  }
}

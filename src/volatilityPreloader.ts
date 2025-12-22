// src/volatilityPreloader.ts
export class VolatilityPreloader {
    async preloadHistoricalVolatility(): Promise<void> {
      const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"];
      const hours = 24;
      const interval = "1m";
  
      for (const sym of symbols) {
        try {
          const endTime = Date.now();
          const startTime = endTime - hours * 60 * 60 * 1000;
  
          const res = await fetch(
            `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`
          );
          const data = (await res.json()) as any[];
  
          const closes = data.map((candle) => parseFloat(candle[4]));
  
          console.log(`✅ Preloaded ${closes.length} 1m candles for ${sym}`);
        } catch (err) {
          console.warn(
            `⚠️ Failed to preload history for ${sym}:`,
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    }
  }
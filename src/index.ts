// src/index.ts
import { AutoTradingBot } from "./bot";

(async () => {
  const bot = new AutoTradingBot();
  await bot.start();
})();
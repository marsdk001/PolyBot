// src/config.ts
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

export const config = {
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  PRICE_DIFFERENCE_THRESHOLD: parseFloat(
    process.env.PRICE_DIFFERENCE_THRESHOLD || "0.018"
  ),
  DEFAULT_TRADE_AMOUNT: parseFloat(process.env.DEFAULT_TRADE_AMOUNT || "15"),
  TRADE_COOLDOWN: parseInt(process.env.TRADE_COOLDOWN || "20") * 1000, // in ms
};

if (!config.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY not set in .env");
}
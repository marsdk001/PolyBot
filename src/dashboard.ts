// src/dashboard.ts
import readline from "readline";
import {
  COLOR_BTC,
  COLOR_ETH,
  COLOR_SOL,
  COLOR_XRP,
  GREEN,
  RED,
  RESET,
} from "./constants";
import { AssetSymbol, FairProbs, MarketBook } from "./types";
import { config } from "./config";

export class Dashboard {
  private fmtPct(p: number): string {
    if (isNaN(p)) return " ?.?? ".padEnd(5);
    return (p * 100).toFixed(1).padEnd(5);
  }

  render(
    combinedFair: Record<AssetSymbol, FairProbs>, // ← changed from fairProbs
    book: Record<AssetSymbol, Record<"UP" | "DOWN", MarketBook>>,
    prices: Record<AssetSymbol, number>,
    startPrices: Record<AssetSymbol, number>,
    timeLeft: Record<AssetSymbol, number>
  ) {
    const now = new Date().toLocaleTimeString();

    const getColorAndArrow = (symbol: AssetSymbol) => {
      const delta = prices[symbol] - startPrices[symbol];
      return delta >= 0
        ? { color: GREEN, arrow: "▲" }
        : { color: RED, arrow: "▼" };
    };

    const btc = getColorAndArrow("BTC");
    const eth = getColorAndArrow("ETH");
    const sol = getColorAndArrow("SOL");
    const xrp = getColorAndArrow("XRP");

    const dashboard = [
      `╔══════════════════════════════════════════════════════════════╗`,
      `║ Binance × Polymarket 15-min Arb Bot         ${now.padEnd(17)}║`,
      `╠══════════════════════════════════════════════════════════════╣`,

      // BTC block
      `║ ${COLOR_BTC}BTC${RESET} • ${timeLeft.BTC.toString().padEnd(
        3
      )}s left │ $${prices.BTC.toFixed(2).padEnd(10)} ${btc.color}${
        btc.arrow
      }${RESET} ${(prices.BTC - startPrices.BTC).toFixed(2).padStart(8)} ${
        btc.color
      }(${(((prices.BTC - startPrices.BTC) / startPrices.BTC) * 100).toFixed(
        3
      )}%)${RESET} ║`,
      `║   Fair  ${GREEN}UP ${this.fmtPct(
        combinedFair.BTC.UP
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        combinedFair.BTC.DOWN
      )}${RESET}                                 ║`,
      `║   Poly  ${GREEN}UP ${this.fmtPct(
        book.BTC.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        book.BTC.DOWN.mid
      )}${RESET}                                 ║`,
      `║   Edge  ${GREEN}UP ${this.fmtPct(
        combinedFair.BTC.UP - book.BTC.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        combinedFair.BTC.DOWN - book.BTC.DOWN.mid
      )}${RESET}                                 ║`,

      // ETH block
      `║ ${COLOR_ETH}ETH${RESET} • ${timeLeft.ETH.toString().padEnd(
        3
      )}s left │ $${prices.ETH.toFixed(2).padEnd(10)} ${eth.color}${
        eth.arrow
      }${RESET} ${(prices.ETH - startPrices.ETH).toFixed(2).padStart(8)} ${
        eth.color
      }(${(((prices.ETH - startPrices.ETH) / startPrices.ETH) * 100).toFixed(
        3
      )}%)${RESET} ║`,
      `║   Fair  ${GREEN}UP ${this.fmtPct(
        combinedFair.ETH.UP
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        combinedFair.ETH.DOWN
      )}${RESET}                                 ║`,
      `║   Poly  ${GREEN}UP ${this.fmtPct(
        book.ETH.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        book.ETH.DOWN.mid
      )}${RESET}                                 ║`,
      `║   Edge  ${GREEN}UP ${this.fmtPct(
        combinedFair.ETH.UP - book.ETH.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        combinedFair.ETH.DOWN - book.ETH.DOWN.mid
      )}${RESET}                                 ║`,

      // SOL block
      `║ ${COLOR_SOL}SOL${RESET} • ${timeLeft.SOL.toString().padEnd(
        3
      )}s left │ $${prices.SOL.toFixed(4).padEnd(10)} ${sol.color}${
        sol.arrow
      }${RESET} ${(prices.SOL - startPrices.SOL).toFixed(4).padStart(8)} ${
        sol.color
      }(${(((prices.SOL - startPrices.SOL) / startPrices.SOL) * 100).toFixed(
        3
      )}%)${RESET} ║`,
      `║   Fair  ${GREEN}UP ${this.fmtPct(
        combinedFair.SOL.UP
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        combinedFair.SOL.DOWN
      )}${RESET}                                 ║`,
      `║   Poly  ${GREEN}UP ${this.fmtPct(
        book.SOL.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        book.SOL.DOWN.mid
      )}${RESET}                                 ║`,
      `║   Edge  ${GREEN}UP ${this.fmtPct(
        combinedFair.SOL.UP - book.SOL.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        combinedFair.SOL.DOWN - book.SOL.DOWN.mid
      )}${RESET}                                 ║`,

      // XRP block
      `║ ${COLOR_XRP}XRP${RESET} • ${timeLeft.XRP.toString().padEnd(
        3
      )}s left │ $${prices.XRP.toFixed(4).padEnd(10)} ${xrp.color}${
        xrp.arrow
      }${RESET} ${(prices.XRP - startPrices.XRP).toFixed(4).padStart(8)} ${
        xrp.color
      }(${(((prices.XRP - startPrices.XRP) / startPrices.XRP) * 100).toFixed(
        3
      )}%)${RESET} ║`,
      `║   Fair  ${GREEN}UP ${this.fmtPct(
        combinedFair.XRP.UP
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        combinedFair.XRP.DOWN
      )}${RESET}                                 ║`,
      `║   Poly  ${GREEN}UP ${this.fmtPct(
        book.XRP.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        book.XRP.DOWN.mid
      )}${RESET}                                 ║`,
      `║   Edge  ${GREEN}UP ${this.fmtPct(
        combinedFair.XRP.UP - book.XRP.UP.mid
      )}${RESET}  ${RED}DOWN ${this.fmtPct(
        combinedFair.XRP.DOWN - book.XRP.DOWN.mid
      )}${RESET}                                 ║`,
      `╠══════════════════════════════════════════════════════════════╣`,
      `║ Threshold ±${config.PRICE_DIFFERENCE_THRESHOLD.toString().padEnd(
        4
      )} │ Amount $${config.DEFAULT_TRADE_AMOUNT.toString().padEnd(
        6
      )} │ Cooldown ${config.TRADE_COOLDOWN / 1000}s             ║`,
      `╚══════════════════════════════════════════════════════════════╝`,
      ``,
    ];

    process.stdout.write("\x1b7"); // Save cursor
    readline.cursorTo(process.stdout, 0, 0);
    process.stdout.write(dashboard.join("\n"));
    process.stdout.write("\x1b8"); // Restore cursor
    readline.moveCursor(process.stdout, 0, 28); // Adjust if lines change
  }
}

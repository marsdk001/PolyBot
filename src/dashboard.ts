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

    const mkLine = (sym: AssetSymbol, col: string, dec: number) => {
      const p = prices[sym];
      const s = startPrices[sym];
      const t = timeLeft[sym];
      const { color: c, arrow: a } = getColorAndArrow(sym);
      const dollarDiff = p - s;

      const line = `║ ${col}${sym}${RESET} • ${t.toString().padEnd(3)}s left │ [${s.toFixed(dec)}] $${p.toFixed(dec).padEnd(9)} ${c}${a} ($${Math.abs(dollarDiff).toFixed(dec)})${RESET}`;
      const visibleLen = line.replace(/\x1b\[[0-9;]*m/g, "").length;
      return line + " ".repeat(Math.max(0, 62 - visibleLen)) + "║";
    };

    const dashboard = [
      `╔══════════════════════════════════════════════════════════════╗`,
      `║ Binance × Polymarket 15-min Arb Bot         ${now.padEnd(17)}║`,
      `╠══════════════════════════════════════════════════════════════╣`,

      // BTC block
      mkLine("BTC", COLOR_BTC, 2),
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
      mkLine("ETH", COLOR_ETH, 2),
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
      mkLine("SOL", COLOR_SOL, 4),
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
      mkLine("XRP", COLOR_XRP, 4),
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

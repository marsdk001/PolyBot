// src/constants.ts
import * as path from "path";
import * as fs from "fs";

export const PLOT_INTERVAL_SEC = 60; // 5 minutes (CHANGE TO 3600 LATER)
export const SAMPLE_INTERVAL_MS = 50;
export const PLOT_POINTS = (PLOT_INTERVAL_SEC * 1000) / SAMPLE_INTERVAL_MS;
export const PLOTS_DIR = "./plots";

if (!fs.existsSync(PLOTS_DIR)) {
  fs.mkdirSync(PLOTS_DIR, { recursive: true });
}

// ===== ANSI COLOR HELPERS =====
export const RESET = "\x1b[0m";

// Asset colors (hex → nearest ANSI via 24-bit)
export const COLOR_BTC = "\x1b[38;2;248;165;10m"; // #f8a50a
export const COLOR_ETH = "\x1b[38;2;5;72;98m"; // #054862
export const COLOR_SOL = "\x1b[38;2;99;13;95m"; // #630d5f
export const COLOR_XRP = "\x1b[38;2;98;182;249m"; // #62B6F9

// Directional
export const GREEN = "\x1b[32m";
export const RED = "\x1b[31m";
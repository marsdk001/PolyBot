// src/plotWorker.ts
import { parentPort } from "worker_threads";
import * as fs from "fs";
import * as path from "path";
import {
  PLOT_VISIBLE_POLY_UP,
  PLOT_VISIBLE_POLY_DOWN,
  PLOT_VISIBLE_EDGE,
  PLOT_VISIBLE_FAIR_COMBINED,
  PLOT_VISIBLE_FAIR_INDIVIDUAL,
  PLOT_VISIBLE_DELTAS,
  PLOT_VISIBLE_LAG,
  PLOT_VISIBLE_STALENESS,
} from "./constants";

parentPort?.on("message", async (msg) => {
  const { symbol, data, plotsDir, bucketStart } = msg;

  if (!data || data.length === 0) return;

  try {
    const html = generateHTML(symbol, data);

    const start = new Date(bucketStart);
    const label = `${start.getFullYear()}-${(start.getMonth() + 1)
      .toString()
      .padStart(2, "0")}-${start.getDate().toString().padStart(2, "0")}_${start
      .getHours()
      .toString()
      .padStart(2, "0")}-${start.getMinutes().toString().padStart(2, "0")}`;

    const filename = `${symbol}_${label}.html`;
    const filepath = path.join(plotsDir, filename);

    await fs.promises.writeFile(filepath, html, "utf8");
    
    // Optional: Notify main thread of success (fire and forget usually fine here)
  } catch (err) {
    console.error(`❌ Plot Worker Error (${symbol}):`, err);
  }
});

function generateHTML(symbol: string, data: any[]): string {
  const t = data.map((d: any) => new Date(d.ts));

  const traces = [
    // Poly
    {
      x: t,
      y: data.map((d: any) => d.polyUp),
      name: "Poly UP",
      yaxis: "y1",
      line: { dash: "dot" },
      mode: "lines+markers",
      marker: { size: 3 },
      visible: PLOT_VISIBLE_POLY_UP,
    },
    {
      x: t,
      y: data.map((d: any) => d.polyDown),
      name: "Poly DOWN",
      yaxis: "y1",
      line: { dash: "dot" },
      mode: "lines+markers",
      marker: { size: 3 },
      visible: PLOT_VISIBLE_POLY_DOWN,
    },

    // Edge
    {
      x: t,
      y: data.map((d: any) => d.edgeUp),
      name: "Edge UP",
      yaxis: "y1",
      line: { dash: "dash" },
      mode: "lines+markers",
      marker: { size: 3 },
      visible: PLOT_VISIBLE_EDGE,
    },
    {
      x: t,
      y: data.map((d: any) => d.edgeDown),
      name: "Edge DOWN",
      yaxis: "y1",
      line: { dash: "dash" },
      mode: "lines+markers",
      marker: { size: 3 },
      visible: PLOT_VISIBLE_EDGE,
    },

    // Combined Exchange Fair
    {
      x: t,
      y: data.map((d: any) => d.fairCombined),
      name: "Combined Exchange Fair",
      yaxis: "y1",
      line: { width: 3, color: "#9467bd" },
      mode: "lines+markers",
      marker: { size: 3 },
      visible: PLOT_VISIBLE_FAIR_COMBINED,
    },

    // Per-exchange GBM fairs
    {
      x: t,
      y: data.map((d: any) => d.fairBinance),
      name: "Fair Binance",
      yaxis: "y1",
      line: { color: "#1f77b4" },
      mode: "lines+markers",
      marker: { size: 2 },
      visible: PLOT_VISIBLE_FAIR_INDIVIDUAL,
    },
    {
      x: t,
      y: data.map((d: any) => d.fairBybit),
      name: "Fair Bybit",
      yaxis: "y1",
      line: { color: "#ff7f0e" },
      mode: "lines+markers",
      marker: { size: 2 },
      visible: PLOT_VISIBLE_FAIR_INDIVIDUAL,
    },
    {
      x: t,
      y: data.map((d: any) => d.fairGate),
      name: "Fair Gate",
      yaxis: "y1",
      line: { color: "#2ca02c" },
      mode: "lines+markers",
      marker: { size: 2 },
      visible: PLOT_VISIBLE_FAIR_INDIVIDUAL,
    },
    {
      x: t,
      y: data.map((d: any) => d.fairOkx),
      name: "Fair OKX",
      yaxis: "y1",
      line: { color: "#d62728" },
      mode: "lines+markers",
      marker: { size: 2 },
      visible: PLOT_VISIBLE_FAIR_INDIVIDUAL,
    },
    {
      x: t,
      y: data.map((d: any) => d.fairMexc),
      name: "Fair MEXC",
      yaxis: "y1",
      line: { color: "#9467bd" },
      mode: "lines+markers",
      marker: { size: 2 },
      visible: PLOT_VISIBLE_FAIR_INDIVIDUAL,
    },
    {
      x: t,
      y: data.map((d: any) => d.fairBitget),
      name: "Fair Bitget",
      yaxis: "y1",
      line: { color: "#8c564b" },
      mode: "lines+markers",
      marker: { size: 2 },
      visible: PLOT_VISIBLE_FAIR_INDIVIDUAL,
    },

    // Price % deltas
    {
      x: t,
      y: data.map((d: any) => d.pctDelta),
      name: "% Δ Anchor",
      yaxis: "y2",
      line: { width: 3, color: "#00ff00" },
      mode: "lines+markers",
      marker: { size: 3 },
      visible: PLOT_VISIBLE_DELTAS,
    },
    {
      x: t,
      y: data.map((d: any) => d.deltaBybit),
      name: "% Δ Bybit",
      yaxis: "y2",
      line: { width: 2, color: "#ff9900" },
      mode: "lines+markers",
      marker: { size: 2 },
      visible: PLOT_VISIBLE_DELTAS,
    },
    {
      x: t,
      y: data.map((d: any) => d.deltaGate),
      name: "% Δ Gate.io",
      yaxis: "y2",
      line: { width: 2, color: "#ff00ff" },
      mode: "lines+markers",
      marker: { size: 2 },
      visible: PLOT_VISIBLE_DELTAS,
    },
    {
      x: t,
      y: data.map((d: any) => d.deltaOkx),
      name: "% Δ OKX",
      yaxis: "y2",
      line: { width: 2, color: "#00ffff" },
      mode: "lines+markers",
      marker: { size: 2 },
      visible: PLOT_VISIBLE_DELTAS,
    },
    {
      x: t,
      y: data.map((d: any) => d.deltaMexc),
      name: "% Δ MEXC",
      yaxis: "y2",
      line: { width: 2, color: "#081b06" },
      mode: "lines+markers",
      marker: { size: 2 },
      visible: PLOT_VISIBLE_DELTAS,
    },
    {
      x: t,
      y: data.map((d: any) => d.deltaBitget),
      name: "% Δ Bitget",
      yaxis: "y2",
      line: { width: 2, color: "#00aa88" },
      mode: "lines+markers",
      marker: { size: 2 },
      visible: PLOT_VISIBLE_DELTAS,
    },

    // Loop Lag
    {
      x: t,
      y: data.map((d: any) => d.loopLag),
      name: "Loop Lag (ms)",
      yaxis: "y3",
      line: { width: 1, color: "#ff0000" },
      mode: "lines+markers",
      marker: { size: 2 },
      visible: PLOT_VISIBLE_LAG,
    },
    {
      x: t,
      y: data.map((d: any) => d.binanceStaleness),
      name: "Binance Staleness (ms)",
      yaxis: "y3",
      line: { width: 1, color: "#00aaff" },
      mode: "lines",
      visible: PLOT_VISIBLE_STALENESS,
    },
    {
      x: t,
      y: data.map((d: any) => d.bybitStaleness),
      name: "Bybit Staleness (ms)",
      yaxis: "y3",
      line: { width: 1, color: "#ffaa00" },
      mode: "lines",
      visible: PLOT_VISIBLE_STALENESS,
    },
    {
      x: t,
      y: data.map((d: any) => d.gateStaleness),
      name: "Gate Staleness (ms)",
      yaxis: "y3",
      line: { width: 1, color: "#aaff00" },
      mode: "lines",
      visible: PLOT_VISIBLE_STALENESS,
    },
    {
      x: t,
      y: data.map((d: any) => d.okxStaleness),
      name: "OKX Staleness (ms)",
      yaxis: "y3",
      line: { width: 1, color: "#00ffaa" },
      mode: "lines",
      visible: PLOT_VISIBLE_STALENESS,
    },
    {
      x: t,
      y: data.map((d: any) => d.mexcStaleness),
      name: "MEXC Staleness (ms)",
      yaxis: "y3",
      line: { width: 1, color: "#aa00ff" },
      mode: "lines",
      visible: PLOT_VISIBLE_STALENESS,
    },
    {
      x: t,
      y: data.map((d: any) => d.bitgetStaleness),
      name: "Bitget Staleness (ms)",
      yaxis: "y3",
      line: { width: 1, color: "#00aaaa" },
      mode: "lines",
      visible: PLOT_VISIBLE_STALENESS,
    },
  ];



  const layout = {
    title: `${symbol} – 1 Minute Multi-Exchange Snapshot`,
    hovermode: "x unified",
    xaxis: {
      title: "Time",
      showspikes: true,
      spikemode: "across",
      spikesnap: "cursor",
      spikecolor: "#888",
      spikethickness: 1,
    },
    yaxis: {
      title: "Probability (%)",
      range: [0, 100],
      showspikes: true,
    },
    yaxis2: {
      title: "% Price Δ",
      overlaying: "y",
      side: "right",
      showgrid: false,
    },
    yaxis3: {
      title: "Lag / Staleness (ms)",
      overlaying: "y",
      side: "right",
      position: 0.95,
      showgrid: false,
    },
    legend: { orientation: "h", y: -0.2 },
    margin: { t: 50, b: 50, l: 60, r: 60 },
  };

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<script src="https://cdn.plot.ly/plotly-2.30.0.min.js"></script>
</head>
<body>
<div id="chart" style="width:100%;height:100vh;"></div>
<script>
  const traces = ${JSON.stringify(traces)};
  const layout = ${JSON.stringify(layout)};
  Plotly.newPlot("chart", traces, layout);
</script>
</body>
</html>`;
}

// src/plotBuffer.ts
import * as fs from "fs";
import * as path from "path";
import { PLOTS_DIR, PLOT_POINTS, PLOT_INTERVAL_SEC } from "./constants";
import { AssetSymbol, PlotPoint } from "./types";

export class PlotBuffer {
  private data: PlotPoint[] = [];
  private bucketStart: number | null = null;

  constructor(private symbol: AssetSymbol) {}

  add(point: PlotPoint) {
    const currentBucket = this.alignToBucket(point.ts);

    // First point ever
    if (this.bucketStart === null) {
      this.bucketStart = currentBucket;
      this.data = [point];
      return;
    }

    // Still in the same 60-second bucket
    if (currentBucket === this.bucketStart) {
      this.data.push(point);
      return;
    }

    // Crossed into a new minute → export the completed bucket immediately
    if (this.data.length > 0) {
      this.exportAndReset();
    }

    // Start new bucket with current point
    this.bucketStart = currentBucket;
    this.data = [point];
  }

  private alignToBucket(ts: number): number {
    // Align to exact 60-second intervals from epoch
    // Ensures buckets are :00–:59, :00–:59, etc. of every minute
    const intervalMs = PLOT_INTERVAL_SEC * 1000; // 60000
    return Math.floor(ts / intervalMs) * intervalMs;
  }

  private exportAndReset() {
    if (this.bucketStart === null || this.data.length === 0) return;

    const start = new Date(this.bucketStart);

    // Filename uses the start time of the bucket (current minute)
    const label = `${start.getFullYear()}-${(start.getMonth() + 1)
      .toString()
      .padStart(2, "0")}-${start.getDate().toString().padStart(2, "0")}_${start
      .getHours()
      .toString()
      .padStart(2, "0")}-${start.getMinutes().toString().padStart(2, "0")}`;

    const filename = `${this.symbol}_${label}.html`;
    const filepath = path.join(PLOTS_DIR, filename);

    fs.writeFileSync(filepath, this.generateHTML(), "utf8");

    console.log(`📈 Plot exported: ${filepath} (${this.data.length} points)`);

    // Reset for next bucket
    this.data = [];
    this.bucketStart = null;
  }

  private generateHTML(): string {
    const t = this.data.map((d) => new Date(d.ts));

    const traces = [
      // Poly
      {
        x: t,
        y: this.data.map((d) => d.polyUp),
        name: "Poly UP",
        yaxis: "y1",
        line: { dash: "dot" },
      },
      {
        x: t,
        y: this.data.map((d) => d.polyDown),
        name: "Poly DOWN",
        yaxis: "y1",
        line: { dash: "dot" },
        visible: "legendonly",
      },

      // Edge
      {
        x: t,
        y: this.data.map((d) => d.edgeUp),
        name: "Edge UP",
        yaxis: "y1",
        line: { dash: "dash" },
        visible: "legendonly",
      },
      {
        x: t,
        y: this.data.map((d) => d.edgeDown),
        name: "Edge DOWN",
        yaxis: "y1",
        line: { dash: "dash" },
        visible: "legendonly",
      },

      // Combined Exchange Fair
      {
        x: t,
        y: this.data.map((d) => d.fairCombined),
        name: "Combined Exchange Fair",
        yaxis: "y1",
        line: { width: 3, color: "#9467bd" },
      },

      // Per-exchange GBM fairs
      {
        x: t,
        y: this.data.map((d) => d.fairBinance),
        name: "Fair Binance",
        yaxis: "y1",
        line: { color: "#1f77b4" },
      },
      {
        x: t,
        y: this.data.map((d) => d.fairBybit),
        name: "Fair Bybit",
        yaxis: "y1",
        line: { color: "#ff7f0e" },
      },
      {
        x: t,
        y: this.data.map((d) => d.fairGate),
        name: "Fair Gate",
        yaxis: "y1",
        line: { color: "#2ca02c" },
      },
      {
        x: t,
        y: this.data.map((d) => d.fairOkx),
        name: "Fair OKX",
        yaxis: "y1",
        line: { color: "#d62728" },
      },
      {
        x: t,
        y: this.data.map((d) => d.fairMexc),
        name: "Fair MEXC",
        yaxis: "y1",
        line: { color: "#9467bd" },
      },
      {
        x: t,
        y: this.data.map((d) => d.fairBitget),
        name: "Fair Bitget",
        yaxis: "y1",
        line: { color: "#8c564b" },
      },
      // {
      //   x: t,
      //   y: this.data.map((d) => d.fairDeepcoin),
      //   name: "Fair Deepcoin",
      //   yaxis: "y1",
      //   line: { color: "#e377c2" },
      // },

      // Price % deltas
      {
        x: t,
        y: this.data.map((d) => d.pctDelta),
        name: "% Δ Binance",
        yaxis: "y2",
        line: { width: 3, color: "#00ff00" },
      },
      {
        x: t,
        y: this.data.map((d) => d.deltaBybit),
        name: "% Δ Bybit",
        yaxis: "y2",
        line: { width: 2, color: "#ff9900" },
      },
      {
        x: t,
        y: this.data.map((d) => d.deltaGate),
        name: "% Δ Gate.io",
        yaxis: "y2",
        line: { width: 2, color: "#ff00ff" },
      },
      {
        x: t,
        y: this.data.map((d) => d.deltaOkx),
        name: "% Δ OKX",
        yaxis: "y2",
        line: { width: 2, color: "#00ffff" },
      },
      {
        x: t,
        y: this.data.map((d) => d.deltaMexc),
        name: "% Δ MEXC",
        yaxis: "y2",
        line: { width: 2, color: "#081b06" },
      },
      {
        x: t,
        y: this.data.map((d) => d.deltaBitget),
        name: "% Δ Bitget",
        yaxis: "y2",
        line: { width: 2, color: "#00aa88" },
      },
      // {
      //   x: t,
      //   y: this.data.map((d) => d.deltaDeepcoin),
      //   name: "% Δ Deepcoin",
      //   yaxis: "y2",
      //   line: { width: 2, color: "#8888ff" },
      // },
    ];

    const layout = {
      title: `${this.symbol} – 1 Minute Multi-Exchange Snapshot`,
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
}
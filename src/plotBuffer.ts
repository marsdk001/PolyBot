// src/plotBuffer.ts
import { Worker } from "worker_threads";
import * as path from "path";
import { PLOTS_DIR, PLOT_POINTS, PLOT_INTERVAL_SEC } from "./constants";
import { AssetSymbol, PlotPoint } from "./types";

// Shared worker instance (Singleton)
let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    // Auto-detect .ts vs .js for worker file
    const workerFileName = __filename.endsWith(".ts")
      ? "plotWorker.ts"
      : "plotWorker.js";
    worker = new Worker(path.join(__dirname, workerFileName));
    worker.on("error", (err) => console.error("❌ Plot Worker Error:", err));
  }
  return worker;
}

export class PlotBuffer {
  private data: PlotPoint[] = [];
  private bucketStart: number | null = null;

  constructor(private symbol: AssetSymbol) {
    // Initialize worker early to ensure it's ready
    getWorker();
  }

  add(point: PlotPoint) {
    const currentBucket = this.alignToBucket(point.ts);

    // First point ever
    if (this.bucketStart === null) {
      this.bucketStart = currentBucket;
      this.data = [point];
      return;
    }

    // Case 1: Point belongs to current bucket (00:00 - 00:59)
    if (currentBucket === this.bucketStart) {
      this.data.push(point);
      return;
    }

    // Case 2: Point belongs to a NEW bucket -> Export old, start new
    if (currentBucket > this.bucketStart) {
      if (this.data.length > 0) {
        this.exportAndReset();
      }
      this.bucketStart = currentBucket;
      this.data = [point];
      return;
    }

    // Case 3: Late packet (older than current bucket) -> ignore
  }

  private alignToBucket(ts: number): number {
    // Align to exact 60-second intervals from epoch
    // Ensures buckets are :00–:59, :00–:59, etc. of every minute
    const intervalMs = PLOT_INTERVAL_SEC * 1000; // 60000
    return Math.floor(ts / intervalMs) * intervalMs;
  }

  private exportAndReset() {
    if (this.bucketStart === null || this.data.length === 0) return;

    // Offload to worker
    getWorker().postMessage({
      symbol: this.symbol,
      data: this.data,
      plotsDir: PLOTS_DIR,
      bucketStart: this.bucketStart,
    });

    // Reset for next bucket
    this.data = [];
  }
}

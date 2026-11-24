import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Logger } from "../config/logger.js";

export function startProcessMetrics(logger: Logger, intervalMs = 60_000) {
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  const timer = setInterval(() => {
    const memory = process.memoryUsage();
    logger.info(
      {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        eventLoopDelayP95Ms: Number((delay.percentile(95) / 1e6).toFixed(2)),
      },
      "Process resource sample",
    );
    delay.reset();
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    delay.disable();
  };
}

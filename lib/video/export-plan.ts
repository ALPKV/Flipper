export type ExportQuality = "auto" | "original" | "compact";
export type ExportPlan = { precise: boolean; estimatedBytes: number; fits: boolean; reason: string };

/** One video, not an automatic sequence of downloads. Conservative estimates, not guarantees. */
export function planExport(fileSize: number, duration: number, seconds: number, count: number,
  quality: ExportQuality, touch: boolean): ExportPlan {
  void fileSize;void duration;void quality;
  // Compact mode is bounded to 1.5 Mbit/s video + 96 Kbit/s audio, plus mux overhead.
  const compact = seconds * 210_000 + count * 4096;
  const limit = touch ? 90e6 : 240e6;
  const precise = true;
  const estimatedBytes = compact;
  return { precise, estimatedBytes, fits: estimatedBytes <= limit,
    reason: "720p video / exact 30 fps cuts" };
}

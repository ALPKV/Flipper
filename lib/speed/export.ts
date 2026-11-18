"use client";

import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } from "mediabunny";
import { drawOverlay, type OverlayData } from "./overlay";

/**
 * Re-encodes the delivery with the same overlay the review shows, entirely on this device
 * (WebCodecs via Mediabunny). The original audio is kept (copied when possible). Rotation is baked
 * into the pixels so the overlay lines up in every player.
 */
export async function exportOverlayMp4(
  file: File,
  overlay: OverlayData,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<{ blob: Blob; audioKept: boolean }> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  try {
    const conversion = await Conversion.init({
      input, output, tracks: "primary", showWarnings: false,
      video: {
        codec: "avc", forceTranscode: true, allowTransformationMetadata: false,
        process: (sample) => {
          const w = sample.displayWidth, h = sample.displayHeight;
          if (!canvas || canvas.width !== w || canvas.height !== h) {
            canvas = new OffscreenCanvas(w, h);
            ctx = canvas.getContext("2d");
          }
          if (!ctx) throw new Error("This browser cannot draw video frames for export.");
          sample.draw(ctx, 0, 0, w, h);
          drawOverlay(ctx, w, h, overlay, sample.timestamp);
          return canvas;
        },
      },
    });
    if (!conversion.isValid || conversion.discardedTracks.some((d) => d.track.type === "video"))
      throw new Error("This browser cannot re-encode this video. Try Chrome or Edge, or an H.264 MP4 recording.");
    const audioKept = !conversion.discardedTracks.some((d) => d.track.type === "audio");
    conversion.onProgress = (p) => onProgress(Math.min(0.99, p));
    const abort = () => void conversion.cancel();
    signal.addEventListener("abort", abort, { once: true });
    try { await conversion.execute(); } finally { signal.removeEventListener("abort", abort); }
    if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("Export produced no file.");
    onProgress(1);
    return { blob: new Blob([buffer], { type: "video/mp4" }), audioKept };
  } finally {
    input.dispose();
  }
}

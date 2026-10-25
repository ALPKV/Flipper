"use client";

import { coverage, motionFraction, type ScanResult } from "../tracking/visual-deliveries";

/** One native decode pass, two 160px buffers; no full video or frame collection in JS memory. */
export async function scanDeliveries(src: string, signal: AbortSignal,
  onProgress: (progress: number) => void): Promise<ScanResult> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  Object.assign(video.style, { position: "fixed", width: "2px", height: "2px", opacity: "0.01", pointerEvents: "none" });
  document.body.appendChild(video);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 160;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) { video.remove(); throw new Error("Canvas is unavailable in this browser."); }
  let frame = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        clearTimeout(timer);
        video.removeEventListener("loadedmetadata", loaded);
        video.removeEventListener("error", failed);
        signal.removeEventListener("abort", aborted);
        if (error) reject(error); else resolve();
      };
      const loaded = () => done();
      const failed = () => done(new Error("This browser cannot decode the recording for a visual scan. Try an H.264 MP4."));
      const aborted = () => done(new DOMException("Scan canceled", "AbortError"));
      const timer = setTimeout(() => done(new Error("Video metadata timed out.")), 12_000);
      video.addEventListener("loadedmetadata", loaded);
      video.addEventListener("error", failed);
      signal.addEventListener("abort", aborted, { once: true });
      video.src = src;
      if (signal.aborted) aborted();
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("This video has no usable duration.");
    if (!("requestVideoFrameCallback" in video)) throw new Error("Visual scanning needs a browser with video-frame callbacks. Audio clips are still available.");
    const series: ScanResult["series"] = { t: [], m: [] };
    const sampledTimes: number[] = [];
    let previous: Uint8Array | null = null;
    let last = -1;
    let gapCount = 0;
    video.playbackRate = 3;
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      let lastFrameAt = performance.now();
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        video.cancelVideoFrameCallback(frame);
        signal.removeEventListener("abort", aborted);
        video.removeEventListener("ended", ended);
        video.removeEventListener("error", failed);
        video.pause();
        if (error) reject(error); else resolve();
      };
      const aborted = () => finish(new DOMException("Scan canceled", "AbortError"));
      const ended = () => finish();
      const failed = () => finish(new Error("Video decoding failed. Your audio clips are unchanged."));
      signal.addEventListener("abort", aborted, { once: true });
      video.addEventListener("ended", ended, { once: true });
      video.addEventListener("error", failed, { once: true });
      const timer = setInterval(() => {
        if (signal.aborted) return aborted();
        if (document.hidden) return finish(new Error("Scan paused because the tab was hidden. Keep this tab visible and retry; audio clips are unchanged."));
        if (performance.now() - lastFrameAt > 8000) finish(new Error("The video decoder stalled. Disable Low Power Mode or try a shorter 1080p recording. Audio clips are unchanged."));
      }, 250);
      const sample = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (finished) return;
        lastFrameAt = performance.now();
        const t = metadata.mediaTime;
        if (t - last >= .19) {
          try {
            ctx.drawImage(video, 0, 0, 160, 160);
            const rgba = ctx.getImageData(0, 0, 160, 160).data;
            const gray = new Uint8Array(160 * 160);
            for (let i = 0; i < gray.length; i++) gray[i] = (rgba[4 * i] + 2 * rgba[4 * i + 1] + rgba[4 * i + 2]) >> 2;
            sampledTimes.push(t);
            if (previous && t - last <= .5) {
              series.t.push(t);
              series.m.push(motionFraction(previous, gray));
            } else if (previous) {
              if (++gapCount >= 3) video.playbackRate = Math.max(1, video.playbackRate / 1.5);
            }
            previous = gray;
            last = t;
            onProgress(Math.min(.99, t / video.duration));
          } catch (error) { finish(error instanceof Error ? error : new Error("Could not read video frames.")); return; }
        }
        frame = video.requestVideoFrameCallback(sample);
      };
      frame = video.requestVideoFrameCallback(sample);
      video.play().catch(() => finish(new Error("Playback was blocked. Turn off Low Power Mode and press Scan again.")));
      if (signal.aborted) aborted();
    });
    const covered = coverage(sampledTimes);
    if (!series.t.length) throw new Error("No usable visual samples were decoded. Audio clips are unchanged.");
    onProgress(1);
    return { series, covered, duration: video.duration };
  } finally {
    video.cancelVideoFrameCallback?.(frame);
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}

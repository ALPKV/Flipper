"use client";

import { coverage, motionFraction, repairWindows, type ScanResult } from "../tracking/visual-deliveries";

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
    video.playbackRate = 2;
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
              if (++gapCount >= 1) video.playbackRate = 1;
            }
            previous = gray;
            last = t;
            onProgress(Math.min(.79, .8 * t / video.duration));
          } catch (error) { finish(error instanceof Error ? error : new Error("Could not read video frames.")); return; }
        }
        frame = video.requestVideoFrameCallback(sample);
      };
      frame = video.requestVideoFrameCallback(sample);
      video.play().catch(() => finish(new Error("Playback was blocked. Turn off Low Power Mode and press Scan again.")));
      if (signal.aborted) aborted();
    });
    // Playback can drop frames when the browser is busy. Repair those exact intervals by
    // deterministic seeking, with context overlap; do not silently accept a partial scan.
    const repairs = repairWindows(sampledTimes, video.duration);
    const distance = repairs.reduce((n, [a, b]) => n + b - a, 0);
    let repaired = 0;
    for (const [a, b] of repairs) {
      previous = null;
      let previousTime = -1;
      for (let t = a; t <= b + .001; t += .2) {
        if (signal.aborted) throw new DOMException("Scan canceled", "AbortError");
        const target = Math.min(t, video.duration - .001);
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timeout);
            video.removeEventListener("seeked", done);
            video.removeEventListener("error", failed);
            signal.removeEventListener("abort", aborted);
            if (error) reject(error); else resolve();
          };
          const done = () => finish();
          const failed = () => finish(new Error("Could not repair missing video frames."));
          const aborted = () => finish(new DOMException("Scan canceled", "AbortError"));
          const timeout = setTimeout(() => finish(new Error("Video seek timed out. Try a shorter H.264 MP4.")), 5000);
          video.addEventListener("seeked", done, { once: true });
          video.addEventListener("error", failed, { once: true });
          signal.addEventListener("abort", aborted, { once: true });
          if (Math.abs(video.currentTime - target) < .001 && video.readyState >= 2) done();
          else video.currentTime = target;
        });
        ctx.drawImage(video, 0, 0, 160, 160);
        const rgba = ctx.getImageData(0, 0, 160, 160).data;
        const gray = new Uint8Array(25600);
        for (let i = 0; i < gray.length; i++) gray[i] = (rgba[4*i] + 2*rgba[4*i+1] + rgba[4*i+2]) >> 2;
        sampledTimes.push(target);
        if (previous) { series.t.push(target); series.m.push(motionFraction(previous, gray)); }
        previous = gray;
        previousTime = target;
        onProgress(.8 + .19 * (repaired + target - a) / Math.max(.2, distance));
      }
      if (previousTime < b - .25) throw new Error("Video repair did not cover the missing interval.");
      repaired += b - a;
    }
    // Overlapping repairs replace their original samples, instead of creating duplicate times.
    const ordered = series.t.map((t, i) => ({ t, m: series.m[i], i })).sort((a, b) => a.t - b.t || a.i - b.i);
    const clean: typeof ordered = [];
    for (const point of ordered) {
      const prev = clean.at(-1);
      if (prev && point.t - prev.t < .09) clean[clean.length - 1] = point;
      else clean.push(point);
    }
    series.t = clean.map((p) => p.t);
    series.m = clean.map((p) => p.m);
    const covered = coverage([...new Set(sampledTimes)].sort((a, b) => a - b));
    if (covered[0]?.[0] <= .25) covered[0][0] = 0;
    const tail = covered.at(-1);
    if (tail && video.duration - tail[1] <= .25) tail[1] = video.duration;
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

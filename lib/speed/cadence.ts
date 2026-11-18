import type { Gray } from "../tracking/core.ts";

/**
 * What the decoded frames say about real capture time.
 *
 * Presentation timestamps (PTS) are the starting point, but they are not always capture times:
 * - Phone editors and messaging apps often convert 24/25 fps footage to 30 fps by REPEATING frames.
 *   A repeated frame has its own PTS but shows the same instant, so its timestamp is fiction.
 * - Variable-frame-rate files skip PTS slots when the phone drops frames.
 * - Slow-motion files play captured frames at a lower rate; `slowFactor` converts back to real time.
 *
 * This module removes exact repeats, keeps real PTS gaps, and (only when repeats were found) re-times
 * the unique frames evenly, reporting how far that moves any frame as extra timing uncertainty.
 */
export type Cadence = {
  /** Indices (into the decoded frames) of frames that show a new instant. */
  unique: number[];
  /** Real-time seconds for each unique frame (PTS / slowFactor, re-timed if repeats were found). */
  times: number[];
  /** Typical real time between unique frames. */
  frameSeconds: number;
  /** Number of exact repeated frames removed. */
  repeats: number;
  /** Largest real-time gap between unique frames, e.g. a dropped frame. */
  maxGap: number;
  /** Extra timing uncertainty (s) introduced by re-timing repeated-frame footage. 0 when not needed. */
  retimeError: number;
  slowFactor: number;
  notes: string[];
};

/** Mean absolute pixel difference, sampled on a grid for speed. */
export function frameDifference(a: Gray, b: Gray, stride = 3): number {
  let sum = 0, n = 0;
  for (let y = 0; y < a.h; y += stride) {
    const row = y * a.w;
    for (let x = 0; x < a.w; x += stride) { sum += Math.abs(a.data[row + x] - b.data[row + x]); n++; }
  }
  return n ? sum / n : 0;
}

/**
 * A repeat is a frame that differs from its predecessor by far less than the clip's normal
 * frame-to-frame change (sensor noise and compression keep real frames apart).
 */
export function analyzeCadence(frames: Gray[], pts: number[], slowFactor = 1): Cadence {
  if (frames.length !== pts.length || frames.length < 3) throw new Error("Need at least three decoded frames with timestamps.");
  if (!(slowFactor >= 1 && slowFactor <= 32)) throw new Error("Slow-motion factor must be between 1 and 32.");
  for (let i = 1; i < pts.length; i++) if (!(pts[i] > pts[i - 1])) throw new Error("Frame timestamps must increase.");
  const diffs = frames.slice(1).map((f, i) => frameDifference(frames[i], f));
  // A repeat re-encoded by a phone editor is not bit-identical, but it differs from its predecessor
  // far less than real neighbouring frames do (measured: 0.0-0.6 vs 2-6 grey levels).
  const candidates: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const near = diffs.slice(Math.max(0, i - 4), i + 3).filter((_, k, all) => all[k] !== diffs[i - 1]);
    const local = median(near.length ? near : diffs);
    if (diffs[i - 1] < 0.35 * local && diffs[i - 1] < 1.0) candidates.push(i);
  }
  // Frame-rate conversion repeats come in a regular pattern (e.g. every 5th frame). A lone
  // near-identical frame (a still scene) is not evidence of conversion and is kept.
  const gaps = candidates.slice(1).map((c, i) => c - candidates[i]);
  // Some repeats are re-encoded just above the threshold, so gaps can be multiples of the period.
  const period = gaps.length ? Math.max(2, Math.min(...gaps)) : 0;
  const onPattern = (g: number) => { const m = Math.round(g / period); return m >= 1 && Math.abs(g - m * period) <= 1; };
  const regular = candidates.length >= 2 && gaps.filter(onPattern).length >= 0.75 * gaps.length;
  const drop = new Set(regular ? candidates : []);
  const unique = frames.map((_, i) => i).filter((i) => !drop.has(i));
  const repeats = frames.length - unique.length;
  const notes: string[] = [];
  if (!regular && candidates.length) notes.push("A near-identical frame was kept: it does not follow a frame-rate conversion pattern.");
  let times = unique.map((i) => pts[i] / slowFactor);
  let retimeError = 0;
  if (repeats > 0) {
    // Repeated frames mean the file was converted from a lower capture rate. Unique frames were
    // captured evenly; their PTS were shifted to fit the 30 fps grid. Fit a straight line of
    // capture index against PTS and use it, recording how far any frame moved.
    const n = unique.length;
    const xs = unique.map((_, k) => k);
    const mx = (n - 1) / 2, my = times.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let k = 0; k < n; k++) { sxy += (xs[k] - mx) * (times[k] - my); sxx += (xs[k] - mx) ** 2; }
    const slope = sxy / sxx, icpt = my - slope * mx;
    const fitted = xs.map((k) => icpt + slope * k);
    const residual = Math.max(...fitted.map((f, k) => Math.abs(f - times[k])));
    // Only trust even re-timing when the repeats really look like a regular pulldown pattern.
    const ptsStep = median(pts.slice(1).map((t, i) => t - pts[i])) / slowFactor;
    if (residual <= 1.01 * ptsStep) {
      times = fitted;
      retimeError = residual;
      notes.push(`${repeats} repeated frame${repeats === 1 ? "" : "s"} removed: the file was converted from about ${Math.round(1 / slope)} fps. Unique frames re-timed evenly (moves frames by up to ${Math.round(residual * 1000)} ms).`);
    } else {
      retimeError = ptsStep;
      notes.push(`${repeats} repeated frames removed at irregular positions; timing uncertainty increased by one frame.`);
    }
  }
  const steps = times.slice(1).map((t, i) => t - times[i]);
  const frameSeconds = median(steps);
  const maxGap = Math.max(...steps);
  if (maxGap > 1.6 * frameSeconds) notes.push(`A gap of ${Math.round(maxGap * 1000)} ms between frames (dropped frames). Real timestamps are used across it.`);
  if (slowFactor > 1) notes.push(`Slow-motion: video time divided by ${slowFactor} to get real time.`);
  return { unique, times, frameSeconds, repeats, maxGap, retimeError, slowFactor, notes };
}

export function median(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

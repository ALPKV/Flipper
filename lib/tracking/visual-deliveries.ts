/** Lightweight action candidates from a fixed camera. Motion is evidence, not proof of a delivery. */
export type MotionSeries = { t: number[]; m: number[] };
export type MotionPeak = { t: number; strength: number };
export type ScanResult = { series: MotionSeries; covered: [number, number][]; duration: number };

export function motionFraction(a: Uint8Array, b: Uint8Array): number {
  if (!a.length || a.length !== b.length) return 0;
  let count = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 20) count++;
  return count / a.length;
}

export function coverage(times: number[], maxGap = .5): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 1; i < times.length; i++) {
    if (!(times[i] > times[i - 1]) || times[i] - times[i - 1] > maxGap) continue;
    const last = spans.at(-1);
    if (last && last[1] >= times[i - 1] - 1e-6) last[1] = times[i];
    else spans.push([times[i - 1], times[i]]);
  }
  return spans;
}

/** Never interpolate across decoder gaps: an unseen interval cannot generate a delivery. */
export function actionPeaks(series: MotionSeries, prominence = .012, gap = 2): MotionPeak[] {
  const candidates: MotionPeak[] = [];
  for (const [start, end] of coverage(series.t)) {
    const indexes = series.t.flatMap((t, i) => t >= start && t <= end ? [i] : []);
    if (indexes.length < 3) continue;
    const values: number[] = [];
    let j = indexes[0];
    for (let t = start; t <= end; t += .1) {
      while (j < indexes.at(-1)! - 1 && series.t[j + 1] < t) j++;
      const fraction = Math.max(0, Math.min(1, (t - series.t[j]) / Math.max(1e-6, series.t[j + 1] - series.t[j])));
      values.push(series.m[j] + fraction * (series.m[j + 1] - series.m[j]));
    }
    const smoothed = values.map((v, i) => (values[i - 1] ?? v) / 3 + v / 3 + (values[i + 1] ?? v) / 3);
    for (let i = 1; i < smoothed.length - 1; i++) {
      const peak = smoothed[i];
      if (!(peak > smoothed[i - 1] && peak >= smoothed[i + 1])) continue;
      let left = peak, right = peak;
      for (let k = i - 1; k >= Math.max(0, i - 20) && smoothed[k] <= peak; k--) left = Math.min(left, smoothed[k]);
      for (let k = i + 1; k < Math.min(smoothed.length, i + 21) && smoothed[k] <= peak; k++) right = Math.min(right, smoothed[k]);
      const strength = peak - Math.max(left, right);
      if (strength >= prominence) candidates.push({ t: start + i * .1, strength });
    }
  }
  const kept: MotionPeak[] = [];
  for (const p of candidates.sort((a, b) => b.strength - a.strength)) {
    if (kept.every((other) => Math.abs(other.t - p.t) >= gap)) kept.push(p);
  }
  return kept.sort((a, b) => a.t - b.t);
}

export type CandidateDelivery = { t: number; rel: number; kind?: "bat" | "motion"; actionTime?: number };

/** Associate each action with at most one audio event; never invent a bat-contact time. */
export function fuseDeliveries(audio: { t: number; rel: number }[], peaks: MotionPeak[], covered: [number, number][]): CandidateDelivery[] {
  const used = new Set<number>();
  const out: CandidateDelivery[] = [];
  for (const p of peaks) {
    let match = -1;
    let best = Infinity;
    audio.forEach((a, i) => {
      const dt = a.t - p.t;
      if (used.has(i) || dt < -.4 || dt > 2.6) return;
      const distance = Math.abs(dt - .8);
      if (distance < best) { best = distance; match = i; }
    });
    if (match >= 0) {
      used.add(match);
      out.push({ ...audio[match], kind: "bat", actionTime: p.t });
    } else out.push({ t: p.t, rel: 0, kind: "motion", actionTime: p.t });
  }
  // Preserve sound candidates in unseen intervals instead of treating missing frames as no bowler.
  audio.forEach((a, i) => {
    if (!used.has(i) && !covered.some(([start, end]) => start <= Math.max(0, a.t - 2.6) && end >= a.t + .2)) {
      out.push({ ...a, kind: "bat" });
    }
  });
  // A second movement immediately after a matched contact is usually follow-through,
  // not a second delivery. Keep the dead time shorter than the audio detector's 3s gap.
  return out.filter((d) => d.kind !== "motion" || !out.some((other) =>
    other.kind === "bat" && other.actionTime != null && d.t >= other.t && d.t - other.t < 1.5
  )).sort((a, b) => a.t - b.t);
}

/** Decode only holes, with overlap for the action detector's two-second context. */
export function repairWindows(times: number[], duration: number): [number, number][] {
  const spans = coverage([...times].sort((a, b) => a - b));
  const holes: [number, number][] = [];
  let last = 0;
  for (const [a, b] of spans) {
    if (a - last > .25) holes.push([Math.max(0, last - 2.2), Math.min(duration, a + 2.2)]);
    last = Math.max(last, b);
  }
  if (duration - last > .25) holes.push([Math.max(0, last - 2.2), duration]);
  const merged: [number, number][] = [];
  for (const [a, b] of holes) {
    const prev = merged.at(-1);
    if (prev && a <= prev[1]) prev[1] = Math.max(prev[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

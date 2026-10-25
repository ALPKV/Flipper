/**
 * Offline regression for the browser's visual + audio heuristics.
 * Requires <name>.s16 (mono 16 kHz) and <name>.motion (160×160 grayscale, 5 fps).
 * Decode: ffmpeg -i input.mp4 -vf "fps=5,scale=160:160,format=gray" -f rawvideo name.motion
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findImpacts, pickShots, refineContact, selectSounds } from "../../lib/tracking/hits.ts";
import { actionPeaks, coverage, fuseDeliveries, motionFraction } from "../../lib/tracking/visual-deliveries.ts";

const dir = process.argv[2];
if (!dir) throw new Error("Usage: node --experimental-strip-types scripts/deliveries/eval-visual.mts <data-directory>");
const labels: Record<string, { releases: number[]; userRejectedClipStarts?: number[] }> = JSON.parse(readFileSync(new URL("labels.json", import.meta.url), "utf8"));
function score(found: number[], releases: number[]) {
  const used = new Set<number>();
  let detected = 0, duplicates = 0;
  for (const t of found) {
    const matches = (r: number) => t >= r - .8 && t <= r + 2.6;
    const i = releases.findIndex((r, i) => !used.has(i) && matches(r));
    if (i >= 0) { used.add(i); detected++; }
    else if (releases.some(matches)) duplicates++;
  }
  return { detected, total: releases.length, duplicates, false: found.length - detected - duplicates };
}
for (const [name, { releases, userRejectedClipStarts = [] }] of Object.entries(labels)) {
  const raw = readFileSync(join(dir, `${name}.motion`));
  const series = { t: [] as number[], m: [] as number[] };
  let previous: Uint8Array | null = null;
  for (let i = 0; i + 25600 <= raw.length; i += 25600) {
    const current = raw.subarray(i, i + 25600);
    if (previous) { series.t.push(i / 25600 / 5); series.m.push(motionFraction(previous, current)); }
    previous = current;
  }
  const b = readFileSync(join(dir, `${name}.s16`));
  const pcm = new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  const impacts = (await findImpacts(pcm, 16000)).filter((e) => e.riseDb > 10).map((e) => ({ ...e, t: refineContact(pcm, 16000, e.t) }));
  const audio = pickShots(selectSounds(impacts, process.argv.includes("--noisy")), -25, 3);
  const fused = fuseDeliveries(audio, actionPeaks(series), coverage(series.t));
  const suggested = fused.filter(d => d.kind === "motion" || d.actionTime != null);
  const rejectedRetained = suggested.filter(d => userRejectedClipStarts.some(t => d.t >= t && d.t <= t + 2.5)).map(d => d.t);
  if (rejectedRetained.length) throw new Error(`${name}: user-confirmed false clips returned to automatic selection: ${rejectedRetained}`);
  if (process.argv.includes("--details")) console.log(name, {audio: audio.map(d=>d.t), fused});
  console.log(name, JSON.stringify({ audio: score(audio.map((d) => d.t), releases), fused: score(fused.map((d) => d.t), releases), suggestedExport: score(suggested.map(d=>d.t), releases), needsReview: fused.length - suggested.length, visualOnly: fused.filter((d) => d.kind === "motion").length }));
}

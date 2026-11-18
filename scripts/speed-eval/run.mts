/**
 * Offline Speed Check evaluation against hand annotations (developer-only, local files).
 *   node --experimental-strip-types scripts/speed-eval/run.mts <frames-dir> <audio-dir> [split]
 *
 * What it can establish: ball-tracking error against annotated positions, wrong-object
 * associations, release/contact event timing against annotated frames, and whether the tool
 * measures or refuses when it should. What it CANNOT establish: real-world speed accuracy — no
 * radar or other independent speed reference exists for these recordings.
 *
 * Pose (MediaPipe) does not run in Node. The release cue is SIMULATED from the annotation with a
 * deterministic offset (+-0.1 s, +-20 px) to mimic an imperfect arm-whip cue. Deliveries where the
 * bowler's hand is not visible get no cue, as pose could not find a release there.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analyzeDelivery, type DeliveryAnalysis } from "../../lib/speed/analyze.ts";
import { isRefusal } from "../../lib/speed/measure.ts";
import { findImpacts, refineContact, selectSounds, pickShots } from "../../lib/tracking/hits.ts";
import { loadClip, sessionAudio } from "./data.mts";

type Annotation = {
  id: string; clip: string; session: string; split: "tune" | "holdout";
  handVisible: boolean;
  /** PTS (video s) of the last frame with the ball in the hand and the first with it free. */
  lastInHand?: number; firstFree?: number; firstFreeXY?: [number, number];
  /** Visually verified ball positions: [pts, x, y] in 1280-long-side pixels. */
  ball: [number, number, number][];
  /** PTS of the last frame in which the ball is visible before reaching the batter. */
  lastSeen?: number;
  /** PTS of frames where the ball is NOT visible (hidden); a tracked point there is a wrong association. */
  occluded?: number[];
  reachesBatter: boolean;
  contact: "bat-visible" | "bat-occluded" | "none";
  /** PTS bracket of visual bat contact, when visible. */
  contactFrames?: [number, number];
  expected: "measure" | "refuse";
  note: string;
};
type Session = { video: string; audio: string; farStumps: { base: [number, number]; top: [number, number] }; pitchM: number; cameraBehindM: [number, number]; note: string };

const [dir, audioDir, only] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(new URL("./annotations.json", import.meta.url), "utf8")) as { sessions: Record<string, Session>; deliveries: Annotation[] };
const jitter = (id: string, k: number) => {
  let h = 2166136261;
  for (const ch of id + k) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) / 2 ** 32) * 2 - 1;
};
const soundCache = new Map<string, { t: number; rel: number }[]>();
async function sounds(session: string, from: number, to: number) {
  // Mimic a trimmed single-delivery upload: detect impacts in audio from 2 s before to 1 s after.
  const key = `${session}:${from}:${to}`;
  if (soundCache.has(key)) return soundCache.get(key)!;
  const all = sessionAudio(audioDir, spec.sessions[session].audio)!;
  const a0 = Math.max(0, from - 2), pcm = all.subarray(Math.round(a0 * 16000), Math.round((to + 1) * 16000));
  const impacts = (await findImpacts(pcm, 16000)).filter((e) => e.riseDb > 10).map((e) => ({ ...e, t: refineContact(pcm, 16000, e.t) + a0 }));
  const out = pickShots(selectSounds(impacts), -25, 0.25).map((s) => ({ t: s.t, rel: s.rel }));
  soundCache.set(key, out);
  return out;
}

const rows: Record<string, unknown>[] = [];
const report: Record<string, unknown> = {};
for (const a of spec.deliveries) {
  if (only && a.split !== only) continue;
  const s = spec.sessions[a.session];
  const clip = loadClip(dir, a.clip);
  const cue = a.handVisible && a.firstFree != null && a.firstFreeXY
    ? { t: a.firstFree + 0.1 * jitter(a.id, 1), x: a.firstFreeXY[0] + 20 * jitter(a.id, 2), y: a.firstFreeXY[1] + 20 * jitter(a.id, 3), source: "pose" as const }
    : null;
  const t0 = Date.now();
  const res: DeliveryAnalysis = analyzeDelivery({
    frames: clip.frames, pts: clip.times, slowFactor: 1,
    farStumps: { base: { x: s.farStumps.base[0], y: s.farStumps.base[1] }, top: { x: s.farStumps.top[0], y: s.farStumps.top[1] } },
    release: cue, sounds: await sounds(a.session, clip.times[0], clip.times.at(-1)!),
    calibration: { pitchM: s.pitchM, cameraBehindM: s.cameraBehindM },
  });
  const ms = Date.now() - t0;
  // Hand not visible: the decision above has no cue (correct behaviour). For TRACKING metrics only,
  // re-run with a cue at the first annotated ball sighting, as a user tap would give.
  const trackRes = !cue && a.ball.length ? analyzeDelivery({
    frames: clip.frames, pts: clip.times, slowFactor: 1,
    farStumps: { base: { x: s.farStumps.base[0], y: s.farStumps.base[1] }, top: { x: s.farStumps.top[0], y: s.farStumps.top[1] } },
    release: { t: a.ball[0][0], x: a.ball[0][1], y: a.ball[0][2], source: "manual" }, sounds: [], calibration: { pitchM: s.pitchM, cameraBehindM: s.cameraBehindM },
  }) : res;
  // Tracking error against verified positions (observed points only).
  const errs: number[] = [];
  let wrong = 0, matched = 0;
  for (const [pts, x, y] of a.ball) {
    const p = trackRes.points.find((q) => Math.abs(q.pts - pts) < 0.005 && q.observed);
    if (!p) continue;
    matched++;
    const e = Math.hypot(p.x - x, p.y - y);
    errs.push(e);
    if (e > 6) wrong++;
  }
  // Tracked observed points on frames where the annotation says the ball is NOT visible, or on
  // annotated frames but on another object, are wrong associations.
  const annotatedPts = new Set(a.ball.map((b) => b[0].toFixed(3)));
  const hidden = new Set((a.occluded ?? []).map((t) => t.toFixed(3)));
  wrong += trackRes.points.filter((p) => p.observed && hidden.has(p.pts.toFixed(3))).length;
  const unverified = trackRes.points.filter((p) => p.observed && !annotatedPts.has(p.pts.toFixed(3)) && !hidden.has(p.pts.toFixed(3))).length;
  // In capture frames: these files hold ~24 fps content, so count unique frames between the two PTS.
  const releaseErrFrames = res.release && a.firstFree != null ? signedUniqueFrames(res.cadence.unique.map((i) => clip.times[i]), a.firstFree, res.release.firstFreePts) : null;
  const arrivalWrong = res.checks.some((c) => c.id === "arrival" && c.ok) && !a.reachesBatter;
  const outcome = isRefusal(res.result) ? "refuse" : "measure";
  const row = {
    id: a.id, split: a.split, expected: a.expected, outcome, correct: outcome === a.expected,
    tracked: trackRes.points.filter((p) => p.observed).length, bridged: trackRes.points.filter((p) => !p.observed).length, trackingCue: trackRes === res ? "pose-sim" : "tap-sim",
    recall: a.ball.length ? `${matched}/${a.ball.length}` : "-", medianErrPx: errs.length ? +median(errs).toFixed(2) : null, maxErrPx: errs.length ? +Math.max(...errs).toFixed(1) : null,
    wrongAssoc: wrong, unverifiedPts: unverified, releaseErrFrames, falseArrival: arrivalWrong,
    speed: isRefusal(res.result) ? null : `${Math.round(res.result.kmh)} (${Math.round(res.result.low)}-${Math.round(res.result.high)})`,
    reason: isRefusal(res.result) ? res.result.reason : null, ms,
  };
  rows.push(row);
  report[a.id] = { ...row, points: res.points.map((p) => [p.pts, +p.x.toFixed(1), +p.y.toFixed(1), p.observed ? 1 : 0]), checks: res.checks, release: res.release, contact: res.contact, cadence: res.cadence.notes };
  console.log(JSON.stringify(row));
}
writeFileSync(`${dir}/../speedcheck-${only ?? "all"}.json`, JSON.stringify(report, null, 1));
const sum = (f: (r: Record<string, unknown>) => boolean) => rows.filter(f).length;
console.log(`\n${rows.length} deliveries: ${sum((r) => r.correct as boolean)} correct measure/refuse decisions; measured ${sum((r) => r.outcome === "measure")}; wrong associations on verified frames ${rows.reduce((a, r) => a + (r.wrongAssoc as number), 0)}`);

function signedUniqueFrames(unique: number[], truth: number, got: number) {
  const idx = (t: number) => unique.findIndex((u) => Math.abs(u - t) < 0.006);
  const a = idx(truth), b = idx(got);
  return a < 0 || b < 0 ? null : b - a;
}
function median(v: number[]) { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

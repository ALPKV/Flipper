/**
 * Runs the PRE-EXISTING Speed Check logic (components/video/speed-check.tsx at the start of this
 * branch) on decoded delivery windows, without pose (MediaPipe cannot run in Node). This is the
 * ball-release fallback path that the old UI used when pose found nothing.
 *   node --experimental-strip-types scripts/speed-eval/baseline.mts <frames-dir> <audio-dir>
 */
import { readdirSync, writeFileSync } from "node:fs";
import { analyzeFrames } from "../../lib/tracking/analyze.ts";
import { findImpacts, selectSounds, pickShots, refineContact } from "../../lib/tracking/hits.ts";
import { estimateSpeed } from "../../lib/tracking/speed-estimate.ts";
import { PITCH_M, CREASE_M, CREASE_TO_CREASE_M } from "../../lib/tracking/metrics.ts";
import { half, loadClip, sessionAudio, sessionOf } from "./data.mts";

const [dir, audioDir] = process.argv.slice(2);
const behind = 4; // old UI default
const names = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", "")).sort();
const out: Record<string, unknown> = {};
for (const name of names) {
  const clip = loadClip(dir, name);
  const t0 = clip.times[0], t1 = clip.times.at(-1)!;
  const pcmAll = sessionAudio(audioDir, sessionOf(name))!;
  // Mimic uploading a trimmed single-delivery clip: audio from 2 s before to 1 s after the window.
  const a0 = Math.max(0, t0 - 2), a1 = t1 + 1;
  const pcm = pcmAll.subarray(Math.round(a0 * 16000), Math.round(a1 * 16000));
  const impacts = (await findImpacts(pcm, 16000)).filter((e) => e.riseDb > 10).map((e) => ({ ...e, t: refineContact(pcm, 16000, e.t) + a0 }));
  const contacts = pickShots(selectSounds(impacts), -10, 2).filter((c) => c.t > t0 && c.t < t1).sort((a, b) => b.rel - a.rel);
  let result: Record<string, unknown>;
  if (!contacts.length) result = { refused: "No clear bat contact found." };
  else if (contacts.length > 1 && contacts[0].rel - contacts[1].rel < 3) result = { refused: "Several equally strong impacts." };
  else {
    const contact = contacts[0].t;
    const visualContact = contact - (behind + PITCH_M - CREASE_M) / 343;
    const keep = clip.times.map((t, i) => i).filter((i) => clip.times[i] >= visualContact - 1.6 && clip.times[i] <= visualContact + 0.08);
    const frames = keep.map((i) => half(clip.frames[i])), times = keep.map((i) => clip.times[i]);
    const tracked = analyzeFrames(frames, times, visualContact);
    const d = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    const frameSeconds = d[Math.floor(d.length / 2)];
    const pts = tracked.points;
    const gaps = pts.some((p, i) => i > 0 && p.t - pts[i - 1].t > 3.1 * frameSeconds);
    const base = { contact, release: tracked.release, points: pts.map((p) => ({ t: p.t, x: p.x * clip.w, y: p.y * clip.h })), bounce: tracked.bounce };
    if (tracked.release == null || pts.length < 8 || !tracked.bounce || frameSeconds > 1 / 24)
      result = { ...base, refused: "The incoming flight could not be measured reliably." };
    else if (gaps) result = { ...base, refused: "The ball disappears for too many frames." };
    else {
      const s = estimateSpeed({ release: tracked.release, contact, frameSeconds, distanceM: CREASE_TO_CREASE_M, distanceErrorM: 0.5, soundDistanceM: behind + PITCH_M - CREASE_M, videoTimeFactor: 1 });
      result = s ? { ...base, kmh: s.kmh, low: s.low, high: s.high } : { ...base, refused: "Timings not plausible." };
    }
  }
  out[name] = result;
  console.log(name, result.refused ? `REFUSED: ${result.refused}` : `${(result.kmh as number).toFixed(1)} km/h [${(result.low as number).toFixed(0)}-${(result.high as number).toFixed(0)}] release ${(result.release as number).toFixed(3)} contact ${(result.contact as number).toFixed(3)}`, `track=${(result.points as unknown[] | undefined)?.length ?? 0}`);
}
writeFileSync(`${dir}/../baseline.json`, JSON.stringify(out, null, 1));

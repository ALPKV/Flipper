/**
 * Tracking-only comparison: runs the PRE-EXISTING analyzeFrames (640-pixel frames, trained blob
 * model) with the end of the flight GIVEN from the annotation (lastSeen + 0.1 s), so its tracking
 * can be scored even where the old flow stopped early for lack of a contact sound.
 *   node --experimental-strip-types scripts/speed-eval/baseline-assisted.mts <frames-dir>
 */
import { readFileSync } from "node:fs";
import { analyzeFrames } from "../../lib/tracking/analyze.ts";
import { half, loadClip } from "./data.mts";
const dir = process.argv[2];
const spec = JSON.parse(readFileSync(new URL("./annotations.json", import.meta.url), "utf8"));
let on = 0, total = 0, off = 0;
for (const a of spec.deliveries) {
  if (a.lastSeen == null) continue;
  const clip = loadClip(dir, a.clip);
  const end = a.lastSeen + 0.1;
  const keep = clip.times.map((_, i) => i).filter((i) => clip.times[i] >= end - 1.6 && clip.times[i] <= end + 0.08);
  const r = analyzeFrames(keep.map((i) => half(clip.frames[i])), keep.map((i) => clip.times[i]), end);
  const pts = r.points.map((p) => ({ t: p.t, x: p.x * clip.w, y: p.y * clip.h }));
  const ok = a.ball.filter(([t, x, y]: number[]) => pts.some((p) => Math.abs(p.t - t) < 0.005 && Math.hypot(p.x - x, p.y - y) <= 6)).length;
  const offBall = pts.filter((p) => !a.ball.some((q: number[]) => Math.abs(q[0] - p.t) < 0.005 && Math.hypot(q[1] - p.x, q[2] - p.y) <= 6)).length;
  on += ok; total += a.ball.length; off += offBall;
  console.log(JSON.stringify({ id: a.id, split: a.split, trackedPts: pts.length, onBall: `${ok}/${a.ball.length}`, offBallPts: offBall, release: r.release, note: r.releaseNote }));
}
console.log(`old tracker, contact given: ${on}/${total} annotated ball frames found; ${off} tracked points not on the ball`);

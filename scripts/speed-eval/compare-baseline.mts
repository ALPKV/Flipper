/**
 * Scores the PRE-EXISTING tracker's output (baseline.json from baseline.mts) against the same
 * annotations used for the new pipeline.
 *   node --experimental-strip-types scripts/speed-eval/compare-baseline.mts <eval-dir>
 */
import { readFileSync } from "node:fs";
const dir = process.argv[2];
const base = JSON.parse(readFileSync(`${dir}/baseline.json`, "utf8")) as Record<string, { points?: { t: number; x: number; y: number }[]; refused?: string; kmh?: number; release?: number }>;
const spec = JSON.parse(readFileSync(new URL("./annotations.json", import.meta.url), "utf8"));
for (const a of spec.deliveries) {
  const b = base[a.clip];
  const pts = b?.points ?? [];
  let matched = 0, wrong = 0;
  const errs: number[] = [];
  for (const [t, x, y] of a.ball) {
    const p = pts.find((q) => Math.abs(q.t - t) < 0.005);
    if (!p) continue;
    const e = Math.hypot(p.x - x, p.y - y);
    if (e <= 6) { matched++; errs.push(e); } else wrong++;
  }
  const hidden = new Set((a.occluded ?? []).map((t: number) => t.toFixed(3)));
  wrong += pts.filter((p) => hidden.has(p.t.toFixed(3))).length;
  const offBall = pts.filter((p) => !a.ball.some((q: number[]) => Math.abs(q[0] - p.t) < 0.005 && Math.hypot(q[1] - p.x, q[2] - p.y) <= 6)).length;
  console.log(JSON.stringify({ id: a.id, split: a.split, trackedPts: pts.length, onBall: `${matched}/${a.ball.length}`, offBallPts: offBall, wrongOnAnnotated: wrong, outcome: b?.refused ? `refuse: ${b.refused}` : `measure ${b?.kmh?.toFixed(0)} km/h` }));
}

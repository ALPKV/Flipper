/**
 * Synthetic "camera behind the bowler" deliveries with exact ground truth, for regression tests.
 * They validate timing, geometry and decision logic; they say NOTHING about real-world accuracy.
 *
 * World: z along the pitch (m) from the bowler's stumps, y up, x sideways. Pinhole camera
 * `behind` metres behind the bowler's stumps at height 1.6 m, looking down the pitch.
 */
import type { Gray } from "../lib/tracking/core.ts";

export type SynthOptions = {
  fps?: number; w?: number; h?: number; speed?: number; behind?: number;
  /** Repeat every n-th frame (frame-rate conversion), or 0. */
  repeatEvery?: number;
  /** Hide the ball from this real time onwards (e.g. bowler's follow-through). */
  occludeFrom?: number | null;
  /** Release happens out of the picture (ball enters from the left edge). */
  releaseOutOfView?: boolean;
  distractors?: boolean;
  seed?: number;
};

export type Synth = {
  frames: Gray[]; pts: number[]; w: number; h: number;
  releaseT: number; contactT: number; bounceT: number;
  /** True ball position (px) per frame, or null when hidden/in hand. */
  truth: ({ x: number; y: number; free: boolean } | null)[];
  hand: { x: number; y: number }[];
  farBase: { x: number; y: number }; farTop: { x: number; y: number };
  trueAverageKmh: number; soundT: number; pitchM: number; behind: number;
};

export function synthDelivery(o: SynthOptions = {}): Synth {
  const fps = o.fps ?? 60, w = o.w ?? 360, h = o.h ?? 640, behind = o.behind ?? 3, pitchM = 20.12;
  const f = 0.9 * h, cx = w / 2, cy = h * 0.42, camY = 1.6;
  const project = (x: number, y: number, z: number) => ({ x: cx + (f * x) / (z + behind), y: cy - (f * (y - camY)) / (z + behind), r: (f * 0.036) / (z + behind) });
  const speed = o.speed ?? 30; // m/s along the pitch
  const releaseT = 0.5, rz = 1.6, ry = 2.2, rx = 0.35;
  const contactZ = pitchM - 1.5;
  // Flight: constant horizontal speed (drag ignored), gravity, one bounce (restitution 0.45).
  const g = 9.81, vy0 = -3.2;
  const tb = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * ry)) / g; // time to reach y = 0
  const vyb = 0.45 * (g * tb - vy0);
  const pos = (t: number) => {
    const s = t - releaseT;
    const z = rz + speed * s, x = rx - 0.02 * speed * s;
    const y = s <= tb ? ry + vy0 * s - 0.5 * g * s * s : vyb * (s - tb) - 0.5 * g * (s - tb) ** 2;
    return { x, y: Math.max(0, y), z };
  };
  const contactT = releaseT + (contactZ - rz) / speed;
  const bounceT = releaseT + tb;
  let seed = o.seed ?? 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const frames: Gray[] = [], pts: number[] = [], truth: Synth["truth"] = [], hand: Synth["hand"] = [];
  const n = Math.round((contactT + 0.25) * fps * (o.repeatEvery ? o.repeatEvery / (o.repeatEvery - 1) : 1));
  const base = new Uint8Array(w * h);
  for (let p = 0; p < base.length; p++) base[p] = 70 + Math.floor(rnd() * 6);
  let last: Gray | null = null;
  // With `repeatEvery`, unique frames are CAPTURED evenly at fps*(n-1)/n (e.g. 24 fps) and shown on
  // the file's fps grid (e.g. 30 fps), repeating one frame in every n: a real frame-rate conversion.
  const captureFps = o.repeatEvery ? (fps * (o.repeatEvery - 1)) / o.repeatEvery : fps;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const shown = i / fps;
    if (o.repeatEvery && i % o.repeatEvery === o.repeatEvery - 1 && last) {
      frames.push({ data: last.data.slice(), w, h }); pts.push(shown); truth.push(truth[truth.length - 1]); hand.push(hand[hand.length - 1]);
      continue;
    }
    const t = u++ / captureFps;
    const data = base.slice();
    const g2: Gray = { data, w, h };
    // Sensor noise so real frames are never identical.
    for (let p = 0; p < data.length; p += 7) data[p] += Math.floor(rnd() * 3);
    // The bowling hand: rises to the release point then swings down and away.
    const hs = t - releaseT;
    const handW = hs <= 0 ? { x: rx, y: ry - 0.9 * Math.min(1, -hs / 0.3), z: rz - 0.3 * Math.min(1, -hs / 0.3) } : { x: rx + 0.3 * hs * 3, y: ry - 6 * hs, z: rz + 0.8 * hs * 3 };
    const hp = project(handW.x, handW.y, handW.z);
    hand.push({ x: hp.x, y: hp.y });
    if (!o.releaseOutOfView) disc(g2, hp.x, hp.y + 6, 5, 40);
    let tr: Synth["truth"][number] = null;
    if (t < releaseT) {
      if (!o.releaseOutOfView) { disc(g2, hp.x, hp.y - 3, project(rx, ry, rz).r, 235); tr = { x: hp.x, y: hp.y - 3, free: false }; }
    } else if (t <= contactT) {
      const b = pos(t), q = project(b.x, b.y, b.z);
      const hidden = (o.occludeFrom != null && t >= o.occludeFrom) || (o.releaseOutOfView && t < releaseT + 0.08);
      if (!hidden && q.x > -2 && q.x < w + 2) { disc(g2, q.x, q.y, Math.max(1.2, q.r), 235); tr = { x: q.x, y: q.y, free: true }; }
    }
    if (o.occludeFrom != null && t >= o.occludeFrom) {
      // A large dark "follow-through" body sliding over the batter's end.
      const k = Math.min(1, (t - o.occludeFrom) / 0.1);
      disc(g2, cx + 40 - 30 * k, project(0, 1, pitchM).y + 10, 60, 30);
    }
    if (o.distractors) {
      // Flickering net knots (appear/disappear) and another net's ball crossing the top of frame.
      for (let k = 0; k < 25; k++) if (rnd() < 0.5) disc(g2, rnd() * w, rnd() * h * 0.3, 1.2, 200);
      disc(g2, 20 + 6 * i, h * 0.12, 2, 230);
    }
    truth.push(tr);
    frames.push(g2); pts.push(shown); last = g2;
  }
  const fb = project(0, 0, pitchM), ft = project(0, 0.711, pitchM);
  const path = pos(contactT), start = pos(releaseT);
  const trueAverageKmh = 3.6 * Math.hypot(path.z - start.z, path.x - start.x) / (contactT - releaseT);
  const soundT = contactT + (pitchM - 1.5 + behind) / 343;
  return { frames, pts, w, h, releaseT, contactT, bounceT, truth, hand, farBase: { x: fb.x, y: fb.y }, farTop: { x: ft.x, y: ft.y }, trueAverageKmh, soundT, pitchM, behind };
}

function disc(g: Gray, x: number, y: number, r: number, v: number) {
  for (let yy = Math.floor(y - r - 1); yy <= y + r + 1; yy++) for (let xx = Math.floor(x - r - 1); xx <= x + r + 1; xx++) {
    if (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h) continue;
    const d = Math.hypot(xx - x, yy - y);
    if (d <= r) g.data[yy * g.w + xx] = v;
    else if (d <= r + 1) g.data[yy * g.w + xx] = Math.round((g.data[yy * g.w + xx] + v) / 2);
  }
}

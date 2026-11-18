import { detect, defaultDetectOptions, type Candidate, type Gray } from "../tracking/core.ts";

/**
 * Follows ONE delivered ball from near the bowler's hand towards the batter, for a camera behind
 * the bowler. Pure functions (no browser APIs) so the same code runs in tests and the evaluation.
 *
 * Seen from behind the bowler, most of the ball's motion is AWAY from the camera: on screen it
 * travels a short path from the hand towards the far stumps and slows down as it recedes. Just
 * after release it can sit almost still on screen. The tracker therefore combines:
 *  - a corridor: only blobs between the release hand and the far stumps are considered (netting,
 *    trees and other nets produce hundreds of moving blobs per frame elsewhere);
 *  - motion: three-frame differencing finds moving blobs; seeds must head towards the far stumps;
 *  - consistency: each new point must fall inside a tight gate around a short-history prediction,
 *    and a chain is cut at the first point that lands far from its prediction (a jump to another
 *    object), rather than averaging the error away;
 *  - appearance: near the hand, where the ball barely moves on screen, the first free-flight
 *    frames are found by matching the ball's own image patch; bridged frames are re-checked the
 *    same way;
 *  - time: at most `maxMissing` frames may be bridged; bridged points stay `observed: false` and
 *    a track never starts or ends on a bridged point.
 * A bounce is allowed once, as an abrupt upward change of screen motion, after which prediction
 * restarts from the bounce instead of forcing one smooth curve through it.
 */

export type BallPoint = {
  /** Index into the unique (de-duplicated) frames. */
  k: number;
  /** Real time in seconds. */
  t: number;
  x: number;
  y: number;
  r: number;
  observed: boolean;
  /** Distance (px) between the point and where the motion model predicted it. */
  residual: number;
  /** First point after an abrupt upward change of screen motion (the bounce). */
  bounce?: boolean;
};

export type TrackHints = {
  /** Image point (pixels) of the far (batter's) stumps; the delivery must head there. */
  target: { x: number; y: number };
  /** Release cue (pose or a manual tap): time window and hand position, which bound the search. */
  release: { t: number; window: number; x: number; y: number; radius: number };
  /** No point after this time is used (e.g. visual bat contact + one frame). */
  until?: number;
};

export type TrackOptions = {
  maxMissing: number;
  minObserved: number;
  /** Largest on-screen move per frame, as a fraction of the image's long side. */
  maxStepFrac: number;
  /** Seeds must head towards the target within this angle (radians). */
  maxHeadingError: number;
  /** Corridor half-width as a fraction of the long side. */
  corridorFrac: number;
};

export const DEFAULT_TRACK_OPTIONS: TrackOptions = { maxMissing: 2, minObserved: 6, maxStepFrac: 0.06, maxHeadingError: 0.75, corridorFrac: 0.07 };

export type DeliveryTrack = {
  points: BallPoint[];
  bounceIndex: number | null;
  /** Mean prediction residual (px) of observed points after the seed. */
  meanResidual: number;
  score: number;
};

export type FrameCandidates = Candidate[][];

/** Moving-blob candidates for every unique frame (first and last frames have no neighbours). */
export function findCandidates(frames: Gray[], maxCandidates = 600): FrameCandidates {
  const { w, h } = frames[0];
  const opt = { ...defaultDetectOptions(w, h), maxCandidates, threshold: 16, minArea: 2 };
  return frames.map((f, k) => (k === 0 || k === frames.length - 1 ? [] : detect(frames[k - 1], f, frames[k + 1], opt)));
}

const radiusOf = (c: Candidate) => Math.sqrt(c.area / Math.PI);
const angleBetween = (ax: number, ay: number, bx: number, by: number) => {
  const d = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return d > 0 ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / d))) : Math.PI;
};

export function segmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
  const u = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0;
  return Math.hypot(p.x - a.x - u * vx, p.y - a.y - u * vy);
}

/**
 * Screen region a delivery can occupy: from the hand to the far stumps, plus the pitch below that
 * line (the ball drops towards its bounce, which is nearer the camera than the far stumps, so it
 * appears lower on screen). Everything else (sky, netting, neighbouring nets) is ignored.
 */
export function deliveryZone(hand: { x: number; y: number }, target: { x: number; y: number }) {
  const L = Math.hypot(target.x - hand.x, target.y - hand.y);
  return [hand, target, { x: target.x, y: target.y + 0.45 * L }, { x: hand.x, y: hand.y + 0.8 * L }];
}

export function insideZone(p: { x: number; y: number }, poly: { x: number; y: number }[], margin: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  if (inside) return true;
  return poly.some((a, i) => segmentDistance(p, a, poly[(i + 1) % poly.length]) <= margin);
}

/** Predicts position at time t from up to the last four observed points (velocity with damped change). */
function predict(history: BallPoint[], t: number): { x: number; y: number; speed: number } {
  const obs = history.filter((p) => p.observed).slice(-4);
  const a = obs[obs.length - 1];
  if (obs.length === 1) return { x: a.x, y: a.y, speed: 0 };
  const b = obs[obs.length - 2];
  const vx = (a.x - b.x) / (a.t - b.t), vy = (a.y - b.y) / (a.t - b.t);
  let ax = 0, ay = 0;
  if (obs.length >= 3) {
    const c = obs[obs.length - 3];
    const ux = (b.x - c.x) / (b.t - c.t), uy = (b.y - c.y) / (b.t - c.t);
    const span = (a.t - c.t) / 2;
    // Damped acceleration: enough for perspective slow-down, not enough to fling the prediction.
    ax = (0.5 * (vx - ux)) / span;
    ay = (0.5 * (vy - uy)) / span;
  }
  const dt = t - a.t;
  return { x: a.x + vx * dt + 0.5 * ax * dt * dt, y: a.y + vy * dt + 0.5 * ay * dt * dt, speed: Math.hypot(vx, vy) };
}

function extend(seed: BallPoint[], cands: FrameCandidates, times: number[], hints: TrackHints, opt: TrackOptions, frameSeconds: number, longSide: number) {
  const pts = seed.map((p) => ({ ...p }));
  let missing = 0;
  let bounceIndex: number | null = null;
  const maxStep = opt.maxStepFrac * longSide;
  for (let k = pts[pts.length - 1].k + 1; k < cands.length; k++) {
    if (hints.until != null && times[k] > hints.until) break;
    // After a bounce the motion model restarts from the bounce point.
    const history = (bounceIndex == null ? pts : pts.slice(bounceIndex)).filter((p) => p.observed);
    const last = history.at(-1)!;
    const steps = (times[k] - last.t) / frameSeconds;
    let pred = predict(history.length >= 2 ? history : pts.filter((p) => p.observed), times[k]);
    let gate = 2.5 + 0.35 * pred.speed * frameSeconds * steps + 1.5 * missing;
    if (history.length === 1) {
      // Straight after the bounce: sideways motion continues, vertical motion is unknown but upward.
      const before = pts.slice(0, bounceIndex!).filter((p) => p.observed).slice(-2);
      const vx = (before[1].x - before[0].x) / (before[1].t - before[0].t);
      const vy = (before[1].y - before[0].y) / (before[1].t - before[0].t);
      const dt = times[k] - last.t;
      pred = { x: last.x + vx * dt, y: last.y - 0.5 * Math.abs(vy) * dt, speed: pred.speed };
      gate = 2.5 + 0.6 * Math.abs(vy) * dt + 1.5 * missing;
    }
    let best: Candidate | null = null, bestD = gate;
    for (const c of cands[k]) {
      const d = Math.hypot(c.x - pred.x, c.y - pred.y);
      if (d < bestD && Math.hypot(c.x - last.x, c.y - last.y) / steps <= maxStep) { best = c; bestD = d; }
    }
    let bounced = false;
    // Bounce: the ball moves up the screen relative to the prediction while its sideways motion
    // continues. Allowed once, only on observed evidence, and never in the first four points.
    if (!best && bounceIndex == null && pts.filter((p) => p.observed).length >= 4) {
      const yGate = 2.5 + 2.2 * pred.speed * frameSeconds * steps;
      // The ball keeps its size through the bounce; net and shoe blobs nearby usually do not match it.
      const lastArea = Math.PI * last.r * last.r;
      let bestCost = Infinity, bestDx = gate;
      for (const c of cands[k]) {
        const dx = Math.abs(c.x - pred.x), dy = pred.y - c.y; // dy > 0: higher on screen than predicted
        const size = Math.abs(Math.log(c.area / lastArea));
        if (dx >= gate || dy <= 0 || dy >= yGate || size > 1.2) continue;
        const cost = dx / gate + size;
        if (cost < bestCost) { best = c; bestCost = cost; bestDx = dx; }
      }
      if (best) { bounced = true; bestD = bestDx; }
    }
    if (best) {
      pts.push({ k, t: times[k], x: best.x, y: best.y, r: radiusOf(best), observed: true, residual: bestD });
      if (bounced) { bounceIndex = pts.length - 1; pts[bounceIndex].bounce = true; }
      missing = 0;
    } else {
      if (++missing > opt.maxMissing) break;
      pts.push({ k, t: times[k], x: pred.x, y: pred.y, r: last.r, observed: false, residual: 0 });
    }
  }
  while (pts.length && !pts[pts.length - 1].observed) pts.pop();
  if (bounceIndex != null && pts.slice(bounceIndex + 1).filter((p) => p.observed).length < 2) {
    // A "bounce" with fewer than two confirming points afterwards is not evidence of a bounce.
    pts.length = bounceIndex;
    for (const p of pts) delete p.bounce;
    while (pts.length && !pts[pts.length - 1].observed) pts.pop();
    bounceIndex = null;
  }
  return { pts, bounceIndex };
}

/**
 * Association confidence: an observed point far from its prediction means the chain has probably
 * jumped to another object. Everything from that point on is dropped rather than averaged in.
 */
export function trimUnreliable(pts: BallPoint[], limit: number): BallPoint[] {
  // A large, blurred ball near the camera has a noisier centre: allow for its size and speed.
  const allowed = (i: number) => {
    const a = pts[i - 1], b = pts[i - 2];
    const step = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, a.k - b.k);
    return Math.max(limit, 0.8 * pts[i].r, 0.25 * step);
  };
  // Right after a bounce the prediction is deliberately loose; the points after it must agree instead.
  const exempt = (i: number) => pts[i].bounce || pts[i - 1].bounce || pts.slice(Math.max(0, i - 3), i).some((q) => q.bounce) && i - pts.findIndex((q) => q.bounce) <= 1;
  const cut = pts.findIndex((p, i) => i >= 2 && p.observed && !exempt(i) && p.residual > allowed(i));
  const kept = cut < 0 ? pts : pts.slice(0, cut);
  while (kept.length && !kept[kept.length - 1].observed) kept.pop();
  return kept;
}

/** Finds the most consistent ball path starting near the release cue. */
export function trackDelivery(input: FrameCandidates, frames: Gray[], times: number[], hints: TrackHints, opt: TrackOptions = DEFAULT_TRACK_OPTIONS): DeliveryTrack | null {
  const size = frames[0];
  if (input.length !== times.length || input.length < 5) return null;
  const n = input.length;
  const longSide = Math.max(size.w, size.h);
  const hand = { x: hints.release.x, y: hints.release.y };
  const width = opt.corridorFrac * longSide;
  const zone = deliveryZone(hand, hints.target);
  const cands = input.map((frame, k) => times[k] < hints.release.t - hints.release.window - 0.05 ? [] :
    frame.filter((c) => insideZone(c, zone, width)));
  const steps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const frameSeconds = steps[Math.floor(steps.length / 2)];
  const maxStep = opt.maxStepFrac * longSide;
  const minStep = 0.0015 * longSide;
  const residualLimit = 4 * longSide / 1280;
  let best: DeliveryTrack | null = null;
  for (let k = 1; k < n - 2; k++) {
    if (hints.until != null && times[k] > hints.until) break;
    if (Math.abs(times[k] - hints.release.t) > hints.release.window) continue;
    for (const a of cands[k]) {
      if (Math.hypot(a.x - hand.x, a.y - hand.y) > hints.release.radius) continue;
      for (let g = 1; g <= 2 && k + g < n; g++) {
        for (const b of cands[k + g]) {
          const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) / g;
          if (dist < minStep || dist > maxStep) continue;
          if (angleBetween(dx, dy, hints.target.x - a.x, hints.target.y - a.y) > opt.maxHeadingError) continue;
          const seed: BallPoint[] = [
            { k, t: times[k], x: a.x, y: a.y, r: radiusOf(a), observed: true, residual: 0 },
            ...(g === 2 ? [{ k: k + 1, t: times[k + 1], x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: radiusOf(a), observed: false, residual: 0 }] : []),
            { k: k + g, t: times[k + g], x: b.x, y: b.y, r: radiusOf(b), observed: true, residual: 0 },
          ];
          const ext = extend(seed, cands, times, hints, opt, frameSeconds, longSide);
          let pts = trimUnreliable(ext.pts, residualLimit);
          if (pts.filter((p) => p.observed).length < opt.minObserved) continue;
          // Validate BEFORE comparing tracks: a chain that leaves the hand and then jumps elsewhere
          // must not win on length.
          pts = validateStart(pts, frames);
          if (pts.filter((p) => p.observed).length < opt.minObserved) continue;
          if (Math.hypot(pts[0].x - hand.x, pts[0].y - hand.y) > hints.release.radius * 1.5) continue;
          const bounceIndex = bounceOf(pts);
          const scored = scoreTrack(pts, hints, longSide);
          if (!best || scored.score > best.score) best = { points: pts, bounceIndex, ...scored };
        }
      }
    }
  }
  return best;
}

function scoreTrack(pts: BallPoint[], hints: TrackHints, longSide: number) {
  const observed = pts.filter((p) => p.observed);
  const resid = observed.slice(2).map((p) => p.residual);
  const meanResidual = resid.length ? resid.reduce((a, b) => a + b, 0) / resid.length : 0;
  const first = observed[0], last = observed[observed.length - 1];
  const startD = Math.hypot(first.x - hints.target.x, first.y - hints.target.y);
  const endD = Math.hypot(last.x - hints.target.x, last.y - hints.target.y);
  // Fraction of the hand-to-batter screen distance covered by the track.
  const progress = startD > 0 ? (startD - endD) / startD : 0;
  const predicted = pts.length - observed.length;
  const score = observed.length + 8 * progress - 1.5 * predicted - 2 * meanResidual * (1280 / longSide) - (endD / longSide) * 10;
  return { meanResidual, score };
}

/** Normalised cross-correlation of a square patch of `a` at (ax, ay) with `b` at (bx, by). */
export function ncc(a: Gray, ax: number, ay: number, b: Gray, bx: number, by: number, R: number): number {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const xa = ax + dx, ya = ay + dy, xb = bx + dx, yb = by + dy;
    if (xa < 0 || ya < 0 || xb < 0 || yb < 0 || xa >= a.w || ya >= a.h || xb >= b.w || yb >= b.h) return -1;
    const va = a.data[ya * a.w + xa], vb = b.data[yb * b.w + xb];
    sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; n++;
  }
  const cov = sab - (sa * sb) / n, da = saa - (sa * sa) / n, db = sbb - (sb * sb) / n;
  return da > 1 && db > 1 ? cov / Math.sqrt(da * db) : -1;
}

const patchRadius = (r: number) => Math.max(3, Math.min(9, Math.round(2 * Math.max(1.5, r))));

/** Square patch of `g` around (cx, cy), resampled by `scale` (bilinear), as a small Gray. */
function patch(g: Gray, cx: number, cy: number, R: number, scale: number): Gray {
  const n = 2 * R + 1, data = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = Math.min(g.w - 1.001, Math.max(0, cx + (i - R) / scale)), y = Math.min(g.h - 1.001, Math.max(0, cy + (j - R) / scale));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, p = y0 * g.w + x0;
    data[j * n + i] = (g.data[p] * (1 - fx) + g.data[p + 1] * fx) * (1 - fy) + (g.data[p + g.w] * (1 - fx) + g.data[p + g.w + 1] * fx) * fy;
  }
  return { data, w: n, h: n };
}

/**
 * Best NCC of `ref`'s ball patch around (x, y) in frame k, searching +-`search` px. `scales` > 1
 * look for a LARGER ball (earlier frames, nearer the camera).
 */
export function matchNear(frames: Gray[], ref: BallPoint, k: number, x: number, y: number, search: number, scales: number[] = [1]) {
  const R = patchRadius(ref.r);
  let best = -1, bx = Math.round(x), by = Math.round(y);
  for (const sc of scales) {
    const Rs = Math.round(R * sc);
    // Template: the reference ball enlarged by `sc`, compared with an equally sized window.
    const tpl = sc === 1 ? null : patch(frames[ref.k], ref.x, ref.y, Rs, sc);
    for (let dy = -search; dy <= search; dy++) for (let dx = -search; dx <= search; dx++) {
      const s = tpl ? ncc(tpl, Rs, Rs, frames[k], Math.round(x) + dx, Math.round(y) + dy, Rs)
        : ncc(frames[ref.k], Math.round(ref.x), Math.round(ref.y), frames[k], Math.round(x) + dx, Math.round(y) + dy, R);
      if (s > best) { best = s; bx = Math.round(x) + dx; by = Math.round(y) + dy; }
    }
  }
  return { score: best, x: bx, y: by };
}

/**
 * Appearance continuity: each newly observed point must still look like the ball seen at the
 * previous observed point. When the ball passes behind the bowler, the motion chain can slide on
 * along the edge of a head or shirt; that edge does not look like the ball, so the track ends at
 * the last point that did.
 */
export function endWhereAppearanceBreaks(pts: BallPoint[], frames: Gray[], minScore = 0.5): BallPoint[] {
  let lastGood = -1;
  for (let i = 0; i < pts.length; i++) {
    if (!pts[i].observed) continue;
    if (lastGood < 0) { lastGood = i; continue; }
    const ref = pts[lastGood];
    const m = matchNear(frames, ref, pts[i].k, pts[i].x, pts[i].y, 1, [1, 0.85]);
    if (m.score < minScore) break;
    lastGood = i;
  }
  return lastGood < 0 ? [] : pts.slice(0, lastGood + 1);
}

/**
 * A seed's first point is the riskiest association (it sits next to the hand). It is kept only if
 * it looks like the ball seen a few frames later; otherwise it is dropped (not moved).
 */
export function validateStart(pts: BallPoint[], frames: Gray[], minScore = 0.6): BallPoint[] {
  let out = pts;
  for (let guard = 0; guard < 3; guard++) {
    const obs = out.filter((p) => p.observed);
    if (obs.length < 4) return out;
    if (matchNear(frames, obs[2], obs[0].k, obs[0].x, obs[0].y, 1).score >= minScore) return out;
    out = out.slice(out.indexOf(obs[0]) + 1);
    while (out.length && !out[0].observed) out = out.slice(1);
  }
  return out;
}

/** Bridged (predicted) frames become observed only if the ball patch is really there. */
export function confirmByAppearance(pts: BallPoint[], frames: Gray[], minScore = 0.8): BallPoint[] {
  return pts.map((p, i) => {
    if (p.observed) return p;
    const ref = pts.slice(i + 1).find((q) => q.observed) ?? pts.slice(0, i).reverse().find((q) => q.observed);
    if (!ref) return p;
    const m = matchNear(frames, ref, p.k, p.x, p.y, 3);
    return m.score >= minScore ? { ...p, x: m.x, y: m.y, observed: true } : p;
  });
}

/**
 * Just after release the ball can sit still on screen, so frame differencing misses it. Walk
 * backwards from the first point by APPEARANCE: the ball patch must reappear close by. Stops when
 * the match fails (typically the ball is in, or partly hidden by, the hand).
 */
export function extendBackByAppearance(pts: BallPoint[], frames: Gray[], times: number[], maxBack = 4, minScore = 0.7): BallPoint[] {
  const out = [...pts];
  // The motion mask under-estimates a ball that barely moves; measure its size from the image.
  const first = { ...out[0], r: apparentRadius(frames[out[0].k], out[0].x, out[0].y) };
  const next = out.slice(1).find((p) => p.observed);
  // Search as far as the ball could have moved in one frame, judging from its first observed step.
  const step = next ? Math.min(25, Math.hypot(next.x - first.x, next.y - first.y) / Math.max(1, next.k - first.k)) : 0;
  const search = Math.max(patchRadius(first.r) + 3, Math.ceil(1.5 * step + 4));
  // Free flight is smooth: going backwards, each match must sit on the backward continuation of
  // the first observed step. A ball still in the hand follows the arm's arc instead, so it fails
  // this test even though it LOOKS exactly like the ball.
  const vx = next ? (next.x - first.x) / Math.max(1, next.k - first.k) : 0;
  const vy = next ? (next.y - first.y) / Math.max(1, next.k - first.k) : 0;
  const tol = Math.max(3, 0.6 * Math.hypot(vx, vy)) + 1;
  let cx = first.x, cy = first.y;
  for (let k = first.k - 1, steps = 0; k >= 0 && steps < maxBack; k--, steps++) {
    const m = matchNear(frames, first, k, cx - vx, cy - vy, search, [1, 1.2, 1.45]);
    if (m.score < minScore) break;
    if (Math.hypot(m.x - (cx - vx), m.y - (cy - vy)) > tol) break;
    out.unshift({ k, t: times[k], x: m.x, y: m.y, r: first.r, observed: true, residual: 0 });
    cx = m.x; cy = m.y;
  }
  return out;
}

/**
 * Apparent ball radius (px) from the intensity profile: the radius at which the ring brightness
 * is halfway between the centre and the surrounding background. Bounded to 2-10 px.
 */
export function apparentRadius(g: Gray, x: number, y: number): number {
  const ring = (r: number) => {
    let sum = 0, n = 0;
    for (let a = 0; a < 16; a++) {
      const xx = Math.round(x + r * Math.cos((a * Math.PI) / 8)), yy = Math.round(y + r * Math.sin((a * Math.PI) / 8));
      if (xx >= 0 && yy >= 0 && xx < g.w && yy < g.h) { sum += g.data[yy * g.w + xx]; n++; }
    }
    return n ? sum / n : 0;
  };
  const c = (ring(0) + ring(1)) / 2, b = (ring(12) + ring(13) + ring(14)) / 3;
  if (Math.abs(c - b) < 8) return 2;
  for (let r = 1; r <= 10; r++) if (Math.abs(ring(r) - b) < 0.5 * Math.abs(c - b)) return Math.max(2, r);
  return 10;
}

/** Full ball-path pipeline on unique frames. */
export function followDelivery(frames: Gray[], times: number[], hints: TrackHints, opt: TrackOptions = DEFAULT_TRACK_OPTIONS): DeliveryTrack | null {
  const tr = trackDelivery(findCandidates(frames), frames, times, hints, opt);
  if (!tr) return null;
  let pts = confirmByAppearance(tr.points, frames);
  pts = endWhereAppearanceBreaks(pts, frames);
  if (!pts.length) return null;
  pts = extendBackByAppearance(pts, frames, times);
  if (pts.filter((p) => p.observed).length < opt.minObserved) return null;
  return { ...tr, points: pts, bounceIndex: bounceOf(pts) };
}

function bounceOf(pts: BallPoint[]): number | null {
  const i = pts.findIndex((p) => p.bounce);
  return i > 0 ? i : null;
}

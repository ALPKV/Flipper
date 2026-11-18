import type { Gray } from "../tracking/core.ts";
import { analyzeCadence, type Cadence } from "./cadence.ts";
import { followDelivery, type BallPoint } from "./track.ts";
import { isRefusal, measureSpeed, type Calibration, type Refusal, type SpeedResult } from "./measure.ts";

/**
 * The whole Speed Check decision, independent of the browser: frames + timestamps + a release cue
 * + far-stumps calibration + impact sounds in, a measured result or a specific refusal out.
 * Every check that can refuse is listed in `checks`, so the UI and the evaluation report the same
 * evidence.
 */

export type Pt = { x: number; y: number };

/** How late the first free sighting can be without hand evidence (from 24 fps development clips). */
export const LATE_SIGHTING_ALLOWANCE_S = 0.1;

export type ReleaseCue = {
  /** Real time (s) of the cue: the arm-whip from pose, or the frame the user marked. */
  t: number;
  /** Hand (pose wrist) or tapped ball position, in frame pixels. */
  x: number; y: number;
  source: "pose" | "manual";
};

export type ContactSound = { t: number; rel: number };

export type DeliveryInput = {
  frames: Gray[];
  /** Presentation timestamps (video seconds) of `frames`. */
  pts: number[];
  slowFactor: number;
  /** Far (batter's) stumps, frame pixels. */
  farStumps: { base: Pt; top: Pt };
  release: ReleaseCue | null;
  /** Impact sounds, VIDEO seconds (the same clock as `pts`). Ignored for slow-motion. */
  sounds: ContactSound[];
  /**
   * Pose wrists in the frame BEFORE and the frame AT the first free sighting (frame pixels), plus
   * the bowler's torso length (px). When the ball is at the hand in the first and clear of it in the
   * second, the release is confirmed to that one frame interval.
   */
  releaseConfirmation?: { before: Pt[]; at: Pt[]; torsoPx: number } | null;
  /** Manual bat-contact frame bracket (video seconds), overriding sound. */
  contactFrames?: readonly [number, number] | null;
  calibration: Calibration;
};

export type TrackedPoint = BallPoint & { pts: number };

export type Check = { id: string; label: string; ok: boolean; detail: string };

export type DeliveryAnalysis = {
  cadence: Cadence;
  points: TrackedPoint[];
  bounce: TrackedPoint | null;
  /** Release bracket (real s) and the frame PTS where the ball is first seen free. */
  release: { bracket: [number, number]; firstFreePts: number; prevPts: number; confirmed: boolean } | null;
  contact: { kind: "sound"; t: number; pts: number } | { kind: "frame"; bracket: [number, number]; pts: number } | null;
  checks: Check[];
  result: SpeedResult | Refusal;
};

export function analyzeDelivery(input: DeliveryInput): DeliveryAnalysis {
  const cadence = analyzeCadence(input.frames, input.pts, input.slowFactor);
  const frames = cadence.unique.map((i) => input.frames[i]);
  const ptsOf = (k: number) => input.pts[cadence.unique[k]];
  const { w, h } = frames[0];
  const long = Math.max(w, h);
  const checks: Check[] = [];
  const out = (reason: string): DeliveryAnalysis => ({ cadence, points, bounce, release, contact, checks, result: { reason } });
  let points: TrackedPoint[] = [];
  let bounce: TrackedPoint | null = null;
  let release: DeliveryAnalysis["release"] = null;
  let contact: DeliveryAnalysis["contact"] = null;

  checks.push({ id: "timing", label: "Frame timing", ok: true, detail: cadence.notes.join(" ") || `Real timestamps, one frame every ${Math.round(cadence.frameSeconds * 1000)} ms.` });
  if (cadence.frameSeconds > 1 / 20) {
    checks[0].ok = false;
    return out("The video has fewer than 20 real frames per second; release cannot be timed usefully.");
  }

  const { base, top } = input.farStumps;
  const stumpPx = Math.hypot(top.x - base.x, top.y - base.y);
  if (!(stumpPx >= 3)) return out("Mark the base and top of the batter's stumps.");

  if (!input.release) {
    checks.push({ id: "release", label: "Release", ok: false, detail: "No bowling action found." });
    return out("No bowling action was found, so the release could not be located. Step to the frame where the ball has just left the hand and tap the ball.");
  }
  const cue = input.release;
  const track = followDelivery(frames, cadence.times, {
    target: base,
    release: { t: cue.t, window: cue.source === "manual" ? 2.5 * cadence.frameSeconds : 0.25, x: cue.x, y: cue.y, radius: (cue.source === "manual" ? 0.04 : 0.09) * long },
  });
  if (!track) {
    checks.push({ id: "track", label: "Ball path", ok: false, detail: "No consistent ball path from the hand towards the batter." });
    return out("The ball could not be followed from the hand towards the batter. It may be too small, too blurred, or hidden.");
  }
  points = track.points.map((p) => ({ ...p, pts: ptsOf(p.k) }));
  bounce = track.bounceIndex != null ? points[track.bounceIndex] : null;
  const observed = points.filter((p) => p.observed);
  const bridged = points.length - observed.length;
  checks.push({ id: "track", label: "Ball path", ok: true, detail: `${observed.length} frames with the ball seen${bridged ? `, ${bridged} bridged (predicted, not seen)` : ""}.` });

  // Release: the frame before the first free sighting must exist and the sighting must be inside
  // the picture, next to where the bowling action happened.
  const first = points[0];
  const edge = Math.min(first.x, first.y, w - first.x, h - first.y);
  if (first.k === 0) {
    checks.push({ id: "release", label: "Release", ok: false, detail: "The ball is already free in the first frame analysed." });
    return out("The ball is already in flight at the start of the analysed frames; the release is not in view.");
  }
  if (edge < 0.025 * Math.min(w, h)) {
    checks.push({ id: "release", label: "Release", ok: false, detail: "First seen at the edge of the picture." });
    return out("The ball first appears at the edge of the picture, so its release is out of view. Film with the bowler's whole action in frame.");
  }
  if (cue.source === "pose" && Math.hypot(first.x - cue.x, first.y - cue.y) > 0.12 * long) {
    checks.push({ id: "release", label: "Release", ok: false, detail: "First sighting is far from the bowler's hand." });
    return out("The ball was first seen well away from the bowler's hand, so the release frame is not known.");
  }
  // Release timing. Seen from behind, the ball can travel almost straight away from the camera just
  // after release and sit still on screen, so the first FREE sighting can come late (measured on
  // 24 fps development clips: up to ~0.1 s). It can also be one frame early (ball still resting on
  // the fingertips). Without hand evidence the bracket covers both; with pose wrists showing the
  // ball at the hand one frame and clear of it the next, it narrows to that frame interval.
  const prevT = cadence.times[first.k - 1];
  const nextT = first.k + 1 < cadence.times.length ? cadence.times[first.k + 1] : first.t + cadence.frameSeconds;
  const conf = input.releaseConfirmation;
  const near = (ws: Pt[], p: Pt) => ws.length > 0 && Math.min(...ws.map((q) => Math.hypot(q.x - p.x, q.y - p.y))) <= Math.max(3 * first.r, 0.3 * (conf?.torsoPx ?? 0));
  const prev = points.find((p) => p.k === first.k - 1);
  const confirmed = !!conf && near(conf.before, prev ?? first) && !near(conf.at, first);
  release = confirmed
    ? { bracket: [prevT, first.t], firstFreePts: first.pts, prevPts: ptsOf(first.k - 1), confirmed }
    : { bracket: [Math.min(prevT, first.t - LATE_SIGHTING_ALLOWANCE_S), nextT], firstFreePts: first.pts, prevPts: ptsOf(first.k - 1), confirmed };
  checks.push({ id: "release", label: "Release", ok: true, detail: confirmed
    ? `Ball at the hand at ${fmt(ptsOf(first.k - 1))} s and clear of it at ${fmt(first.pts)} s.`
    : `Ball first seen free at ${fmt(first.pts)} s. Hand contact was not confirmed, so release is allowed anywhere from ${Math.round(LATE_SIGHTING_ALLOWANCE_S * 1000)} ms before to one frame after.` });

  // Arrival: the ball must be SEEN reaching the batter's end, otherwise a later sound cannot be
  // tied to this ball.
  const last = observed[observed.length - 1];
  if (!inBatterZone(last, base, top)) {
    checks.push({ id: "arrival", label: "Reaches the batter", ok: false, detail: `Last seen at ${fmt(last.pts)} s, short of the batter's end.` });
    return out("The ball was lost before it reached the batter (often hidden by the bowler's follow-through), so bat contact cannot be linked to it. Move the camera slightly higher or to one side.");
  }
  checks.push({ id: "arrival", label: "Reaches the batter", ok: true, detail: `Seen at the batter's end at ${fmt(last.pts)} s.` });

  // Contact.
  const fs = cadence.frameSeconds;
  let evidenceContact: Parameters<typeof measureSpeed>[0]["contact"];
  if (input.contactFrames) {
    const [a, b] = input.contactFrames;
    contact = { kind: "frame", bracket: [a / input.slowFactor, b / input.slowFactor], pts: b };
    evidenceContact = { kind: "frame", bracket: contact.bracket };
    checks.push({ id: "contact", label: "Bat contact", ok: true, detail: `Marked on the video between ${fmt(a)} and ${fmt(b)} s.` });
  } else {
    if (input.slowFactor > 1) {
      checks.push({ id: "contact", label: "Bat contact", ok: false, detail: "Slow-motion audio cannot time the contact." });
      return out("This is slow-motion footage, whose sound cannot time bat contact. Mark the contact frame instead.");
    }
    // The crack reaches the microphone ~50-80 ms after the visual contact; contact itself happens
    // between one frame before the last sighting and a few frames after (ball hidden by bat/pads).
    const from = last.t - fs + 0.04, to = last.t + 4 * fs + 0.1;
    const near = input.sounds.filter((s) => s.t >= from && s.t <= to).sort((a, b) => b.rel - a.rel);
    const later = input.sounds.filter((x) => x.t > to && x.t <= last.t + 1.0).sort((a, b) => b.rel - a.rel)[0];
    if (!near.length && later) {
      // Seen from behind, a low ball in mid-pitch can project close to the batter's end, so the
      // screen position alone cannot prove arrival. A contact sound well after the last sighting
      // means the ball was lost before it got there.
      checks.push({ id: "contact", label: "Bat contact", ok: false, detail: `Impact at ${fmt(later.t)} s, ${Math.round((later.t - last.t) * 1000)} ms after the ball was last seen.` });
      return out("The ball was lost before it reached the batter: the bat-contact sound comes well after the last sighting, so they cannot be linked. Move the camera slightly higher or to one side.");
    }
    if (!near.length) {
      checks.push({ id: "contact", label: "Bat contact", ok: false, detail: "No impact sound when the ball reached the batter." });
      return out("No bat-contact sound was heard when the ball reached the batter (left, missed or too quiet). This version measures release to bat.");
    }
    if (near.length > 1 && near[0].rel - near[1].rel < 3) {
      checks.push({ id: "contact", label: "Bat contact", ok: false, detail: "Two similar impact sounds." });
      return out("Two similar impact sounds happened as the ball reached the batter; the contact is ambiguous.");
    }
    contact = { kind: "sound", t: near[0].t, pts: near[0].t };
    evidenceContact = { kind: "sound", t: near[0].t };
    checks.push({ id: "contact", label: "Bat contact", ok: true, detail: `Contact sound at ${fmt(near[0].t)} s, when the ball reached the batter.` });
  }
  const result = measureSpeed({ release: release.bracket, contact: evidenceContact, retimeError: cadence.retimeError }, input.calibration);
  checks.push({ id: "speed", label: "Plausibility", ok: !isRefusal(result), detail: isRefusal(result) ? result.reason : "Timing and distance give a plausible delivery." });
  return { cadence, points, bounce, release, contact, checks, result };
}

const fmt = (t: number) => t.toFixed(3);

/**
 * Where a ball arriving at the batter can appear: from the stumps' base up to ~2.2 stump heights
 * (about 1.6 m) above it, and ~2.5 stump heights (about 1.8 m) to either side, at the far stumps'
 * scale. A ball higher on screen than that may still be metres short of the batter: seen from
 * behind, height and distance along the pitch are confused, so the zone is deliberately tight.
 */
export function inBatterZone(p: Pt, base: Pt, top: Pt): boolean {
  const s = Math.hypot(top.x - base.x, top.y - base.y);
  return Math.abs(p.x - base.x) <= 2.5 * s && p.y >= base.y - 2.2 * s && p.y <= base.y + 0.6 * s;
}

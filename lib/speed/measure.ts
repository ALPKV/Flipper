/**
 * Turns observed events into an AVERAGE speed with an honest range, or a specific refusal.
 *
 * What one phone behind the bowler can and cannot measure
 * -------------------------------------------------------
 * Time is measurable: frame timestamps (after removing repeated frames) bracket the release to
 * one capture interval, and the bat-contact crack can be timed to a few milliseconds once the
 * sound's travel time to the camera is removed.
 *
 * Distance is NOT measurable from pixels here. A pitch calibration (a ground-plane mapping from the
 * stumps and creases) locates points ON THE GROUND. An airborne ball projects to a ray from the
 * camera; without its height, every point along that ray is equally consistent with the image, and
 * seen from behind the bowler that ray runs almost along the pitch, so the depth error is metres.
 * Only the bounce is on the ground, and from behind, the bounce's screen position changes very
 * little over several metres of length at 30 fps.
 *
 * So the distance comes from where the events happen relative to pitch landmarks:
 *   distance = stumps-to-stumps − (release point in front of the bowler's stumps)
 *                                − (contact point in front of the batter's stumps)
 * Both offsets are ranges, stated in the result, never hidden.
 *
 * The result is the AVERAGE speed between release and bat contact. It is not release speed:
 * a ball loses speed through the air and at the bounce, so a radar release speed would be higher.
 */

export const SOUND_MPS = 343;

/** Assumed ranges (metres) — shown to the user with every result. */
export const ASSUMPTIONS = {
  /** Release point in front of the bowler's stumps: front foot near the popping crease (1.22 m), hand up to ~1 m further ahead. */
  releaseAheadM: [0.8, 2.3] as const,
  /** Bat contact in front of the batter's stumps: back-foot to front-foot shots. */
  contactAheadM: [0.3, 2.7] as const,
  /** Phone audio/video alignment tolerance (s). Not verified per device. */
  avSyncS: 0.02,
};

export type Calibration = {
  /** Stumps-to-stumps distance confirmed by the user (20.12 m for a full pitch). */
  pitchM: number;
  /** Camera distance behind the bowler's stumps, range in metres (for the sound delay). */
  cameraBehindM: readonly [number, number];
};

export type SpeedEvidence = {
  /** Release lies between these real times (s): last frame with the ball in hand / first free frame. */
  release: readonly [number, number];
  /**
   * Bat contact: the crack's onset at the microphone (real time, s), or a frame bracket marked on
   * the video (e.g. slow-motion clips, whose audio cannot be trusted for timing).
   */
  contact: { kind: "sound"; t: number } | { kind: "frame"; bracket: readonly [number, number] };
  /** Extra timing tolerance from re-timed (frame-rate converted) footage. */
  retimeError: number;
};

export type SpeedResult = {
  kmh: number; low: number; high: number;
  flightSeconds: readonly [number, number];
  distanceM: readonly [number, number];
  acousticDelayS: readonly [number, number];
};

export type Refusal = { reason: string };

export const isRefusal = (r: SpeedResult | Refusal): r is Refusal => "reason" in r;

export function measureSpeed(e: SpeedEvidence, cal: Calibration): SpeedResult | Refusal {
  const [r0, r1] = e.release;
  const cvals = e.contact.kind === "sound" ? [e.contact.t] : [...e.contact.bracket];
  if (![r0, r1, ...cvals, e.retimeError, cal.pitchM, ...cal.cameraBehindM].every(Number.isFinite))
    return { reason: "Missing timing or calibration values." };
  if (!(r1 >= r0) || e.retimeError < 0) return { reason: "Release bracket is invalid." };
  if (cal.pitchM < 10 || cal.pitchM > 22) return { reason: "Stumps-to-stumps distance must be between 10 and 22 m." };
  const [b0, b1] = cal.cameraBehindM;
  if (b0 < 0 || b1 < b0 || b1 > 30) return { reason: "Camera distance behind the stumps must be a range between 0 and 30 m." };
  const [ra0, ra1] = ASSUMPTIONS.releaseAheadM, [ca0, ca1] = ASSUMPTIONS.contactAheadM;
  // Sound path: from contact (ca in front of the batter's stumps) back to the camera.
  const d0 = Math.max(0, cal.pitchM - ca1 + b0), d1 = cal.pitchM - ca0 + b1;
  let delay: readonly [number, number] = [0, 0];
  let contact0: number, contact1: number;
  if (e.contact.kind === "sound") {
    delay = [d0 / SOUND_MPS, d1 / SOUND_MPS];
    const sync = ASSUMPTIONS.avSyncS;
    contact0 = e.contact.t - delay[1] - sync;
    contact1 = e.contact.t - delay[0] + sync;
  } else {
    if (!(e.contact.bracket[1] >= e.contact.bracket[0])) return { reason: "Contact bracket is invalid." };
    [contact0, contact1] = e.contact.bracket;
  }
  contact0 -= e.retimeError; contact1 += e.retimeError;
  const rel0 = r0 - e.retimeError, rel1 = r1 + e.retimeError;
  const T0 = contact0 - rel1, T1 = contact1 - rel0;
  if (!(T0 > 0.15)) return { reason: "The contact sound is too soon after release for a real delivery (or belongs to something else)." };
  if (T1 > 2.0) return { reason: "Release and contact are too far apart for one delivery." };
  const D0 = cal.pitchM - ra1 - ca1, D1 = cal.pitchM - ra0 - ca0;
  if (D0 <= 3) return { reason: "The pitch is too short for the release and contact assumptions." };
  const Dm = cal.pitchM - (ra0 + ra1) / 2 - (ca0 + ca1) / 2;
  const Tm = (T0 + T1) / 2;
  const kmh = 3.6 * Dm / Tm, low = 3.6 * D0 / T1, high = 3.6 * D1 / T0;
  if (kmh < 30 || kmh > 170) return { reason: `The timings give ${Math.round(kmh)} km/h, which is not a plausible delivery. The sound or release was probably wrong.` };
  if ((high - low) / kmh > 0.6) return { reason: "The timing is too uncertain for a useful number (the range is wider than ±30%). A higher frame rate helps." };
  return { kmh, low, high, flightSeconds: [T0, T1], distanceM: [D0, D1], acousticDelayS: delay };
}

export const kmhToMph = (kmh: number) => kmh / 1.609344;

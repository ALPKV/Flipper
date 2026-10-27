export type SpeedInput = {
  release: number; contact: number; frameSeconds: number;
  distanceM: number; distanceErrorM: number;
  /** Camera-to-contact distance, not the flight distance. Zero for visually marked contact. */
  soundDistanceM: number;
};

/** Average flight speed, never radar/release speed. Bounds describe stated input tolerances only. */
export function estimateSpeed(i: SpeedInput) {
  if (![i.release, i.contact, i.frameSeconds, i.distanceM, i.distanceErrorM, i.soundDistanceM].every(Number.isFinite)
    || i.distanceM < 5 || i.distanceM > 30 || i.distanceErrorM < 0 || i.distanceErrorM >= i.distanceM
    || i.frameSeconds <= 0 || i.frameSeconds > .1 || i.soundDistanceM < 0 || i.soundDistanceM > 50) return null;
  const acousticDelay = i.soundDistanceM / 343;
  const flightSeconds = i.contact - acousticDelay - i.release;
  if (flightSeconds <= .12 || flightSeconds > 2.5) return null;
  const kmh = 3.6 * i.distanceM / flightSeconds;
  // One frame of uncertainty at each selected event, conservatively summed.
  const timingError = 2 * i.frameSeconds + (i.soundDistanceM > 0 ? .005 : 0);
  if (flightSeconds <= timingError || kmh < 15 || kmh > 180) return null;
  const low = 3.6 * (i.distanceM - i.distanceErrorM) / (flightSeconds + timingError);
  const high = 3.6 * (i.distanceM + i.distanceErrorM) / (flightSeconds - timingError);
  return { kmh, low, high, flightSeconds, acousticDelay };
}

export type SpeedInput = {
  release: number; contact: number; frameSeconds: number;
  distanceM: number; distanceErrorM: number;
  /** Camera-to-contact distance, not the flight distance. Zero for visually marked contact. */
  soundDistanceM: number;
  videoTimeFactor?: number | null;
  releaseUncertainty?: number;
};

/** Average flight speed, never radar/release speed. Bounds describe stated input tolerances only. */
export function estimateSpeed(i: SpeedInput) {
  if(i.videoTimeFactor===null)return null;
  const factor=i.videoTimeFactor??1;
  if(!Number.isFinite(factor)||factor<1||factor>32)return null;
  if(i.releaseUncertainty!=null&&(!Number.isFinite(i.releaseUncertainty)||i.releaseUncertainty<0))return null;
  if (![i.release, i.contact, i.frameSeconds, i.distanceM, i.distanceErrorM, i.soundDistanceM].every(Number.isFinite)
    || i.distanceM < 5 || i.distanceM > 30 || i.distanceErrorM < 0 || i.distanceErrorM >= i.distanceM
    || i.frameSeconds <= 0 || i.frameSeconds > .1 || i.soundDistanceM < 0 || i.soundDistanceM > 50) return null;
  const acousticDelay = i.soundDistanceM / 343;
  const flightSeconds = (i.contact-i.release)/factor - acousticDelay;
  if (flightSeconds <= .12 || flightSeconds > 2.5) return null;
  const kmh = 3.6 * i.distanceM / flightSeconds;
  // One frame of uncertainty at each selected event, conservatively summed.
  const timingError = (Math.max(i.frameSeconds,i.releaseUncertainty??i.frameSeconds)+i.frameSeconds)/factor + (i.soundDistanceM > 0 ? .005 : 0);
  if (flightSeconds <= timingError || kmh < 15 || kmh > 180) return null;
  const low = 3.6 * (i.distanceM - i.distanceErrorM) / (flightSeconds + timingError);
  const high = 3.6 * (i.distanceM + i.distanceErrorM) / (flightSeconds - timingError);
  return { kmh, low, high, flightSeconds, acousticDelay };
}

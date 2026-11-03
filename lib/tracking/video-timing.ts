export type VideoTiming = { mode: "normal" | "slow" | "unknown"; captureFps: number; playbackFps: number };
export const NORMAL_TIMING: VideoTiming = { mode: "normal", captureFps: 120, playbackFps: 30 };

/** Video seconds / factor = real seconds. File FPS cannot reveal the original capture rate. */
export function timingFactor(timing: VideoTiming): number | null {
  if (timing.mode === "unknown") return null;
  if (timing.mode === "normal") return 1;
  if (![timing.captureFps,timing.playbackFps].every(Number.isFinite) || timing.playbackFps < 1
    || timing.captureFps < timing.playbackFps || timing.captureFps > 960) return null;
  const factor = timing.captureFps / timing.playbackFps;
  return factor <= 32 ? factor : null;
}

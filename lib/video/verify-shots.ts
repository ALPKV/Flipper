"use client";

import { flightFrames } from "./native-decode";
import { analyzeFrames } from "../tracking/analyze";

/** An independent ball-flight check, not just "somebody moved near a sound". */
export async function verifyShots(file: File, contacts: number[], duration: number,
  signal: AbortSignal, progress: (p: number) => void): Promise<number[]> {
  const accepted: number[] = [];
  for (let i = 0; i < contacts.length; i++) {
    if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    const contact = contacts[i];
    const { frames, times } = await flightFrames(file, Math.max(0, contact - 1.6), Math.min(duration, contact + .08), signal, () => {});
    if (frames.length >= 8) {
      const a = analyzeFrames(frames, times, contact);
      const points = a.points;
      if (points.length >= 8) {
        const first = points[0], last = points.at(-1)!;
        const steps = points.slice(1).map((p,j)=>p.t-points[j].t).sort((x,y)=>x-y);
        const median = steps[Math.floor(steps.length/2)];
        const span = last.t - first.t;
        const displacement = Math.hypot(last.x-first.x,last.y-first.y);
        const dense = median > 0 && points.every((p,j)=>j===0 || p.t-points[j-1].t <= 3.1*median);
        // Precision comes before recall: a partially seen flight remains a review candidate.
        if (span >= .15 && span <= 1.8 && contact-last.t >= -.05 && contact-last.t <= .15
          && displacement >= .04 && dense) accepted.push(contact);
      }
    }
    progress((i+1)/Math.max(1,contacts.length));
    await new Promise(r=>setTimeout(r,0));
  }
  return accepted;
}

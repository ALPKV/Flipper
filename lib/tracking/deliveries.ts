import type { DeliveryCategory } from "./pose-actions.ts";
/** A shot found from the sound: bat contact time and loudness against the session's big hits (dB). */
export type Delivery = { t: number; rel: number; kind?: "bat" | "motion"; actionTime?: number; category?: DeliveryCategory; poseConfidence?: number };

export const deliveryId = (d: Delivery) => `${d.kind === "motion" ? "v" : "a"}${d.t.toFixed(3)}`;

/**
 * The clip around each shot: `leadIn` before it and `length` long, but never reaching into the
 * neighbouring shots, so every ball keeps its own clip however close the next one is. Pass only the
 * shots being kept (not ones marked Not a shot), so a removed fake doesn't shorten its neighbours.
 */
export function clipWindows(
  deliveries: Delivery[],
  leadIn: number,
  length: number,
  duration = Infinity,
): { delivery: Delivery; start: number; end: number }[] {
  const list = [...deliveries].filter(d=>Number.isFinite(d.t)&&d.t>=0&&d.t<duration)
    .sort((a,b)=>a.t-b.t).filter((d,i,all)=>i===0||d.t!==all[i-1].t);
  return list.map((d,k)=> {
    const previous=list[k-1],next=list[k+1];
    // A shared midpoint splits neighbouring windows even when sounds are very close.
    // Keep each onset inside its own clip; never drop a sound because another cut covers it.
    const desiredStart=Math.max(0,d.t-leadIn);
    const start=Math.max(desiredStart,previous?(previous.t+d.t)/2:0);
    const end=Math.min(duration,Math.max(d.t+.001,d.t-leadIn+(d.kind==="motion"?Math.max(3.5,length):length)),next?(d.t+next.t)/2:Infinity);
    return {delivery:d,start,end};
  });
}

import type { DeliveryCategory } from "./pose-actions.ts";
/** A shot found from the sound: bat contact time and loudness against the session's big hits (dB). */
export type Delivery = { t: number; rel: number; kind?: "bat" | "motion"; actionTime?: number; category?: DeliveryCategory; poseConfidence?: number };

export const deliveryId = (d: Delivery) => `${d.kind === "motion" ? "v" : "a"}${d.t.toFixed(3)}`;

/** Every detected event gets its own full window. Neighbouring events never shorten it. */
export function clipWindows(deliveries:Delivery[],leadIn:number,length:number,duration=Infinity,offset=0):{delivery:Delivery;start:number;end:number}[]{
 return [...deliveries].filter(d=>Number.isFinite(d.t)&&d.t>=0).sort((a,b)=>a.t-b.t).map(d=>{
  const size=d.kind==="motion"?Math.max(3.5,length):length;
  const wanted=d.t+offset-leadIn;
  let start=Math.max(0,wanted),end=Math.min(duration,wanted+size);
  // An extreme offset still retains the candidate at the nearest recording edge.
  if(end<=0){start=0;end=Math.min(duration,size);}
  if(start>=duration){end=duration;start=Math.max(0,duration-size);}
  return {delivery:d,start,end};
 });
}

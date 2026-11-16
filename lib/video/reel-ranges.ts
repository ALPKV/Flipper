export type ReelRange={start:number;end:number;padBefore?:number;padAfter?:number};
/** Preserve every selected clip in order, including repeated and overlapping footage. */
export function reelRanges(clips:ReelRange[]):ReelRange[]{
 return clips.filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.start>=0&&c.end>c.start).map(c=>({...c}));
}
export function reelPosition(ranges:ReelRange[],elapsed:number){
 let remaining=Math.max(0,elapsed);
 for(let i=0;i<ranges.length;i++){
  const duration=ranges[i].end-ranges[i].start;
  if(remaining<duration||i===ranges.length-1)return {index:i,time:ranges[i].start+Math.min(duration,remaining)};
  remaining-=duration;
 }
 return {index:0,time:0};
}

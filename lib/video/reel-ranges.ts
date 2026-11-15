export type ReelRange={start:number;end:number};
/** Touching/overlapping cuts contain no waiting to remove. Render that source span once. */
export function reelRanges(clips:ReelRange[]):ReelRange[]{
 const out:ReelRange[]=[];
 for(const c of clips.filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.start>=0&&c.end>c.start).sort((a,b)=>a.start-b.start)){
  const last=out.at(-1);
  if(last&&c.start<=last.end+.00001)last.end=Math.max(last.end,c.end);
  else out.push({...c});
 }
 return out;
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

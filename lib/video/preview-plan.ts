import type {ReelRange} from "./reel-ranges";
/** Preview has a bounded, separate budget; full export size never disables it. */
export function previewPlan(ranges:ReelRange[],frameCounts?:number[],limit=90){
 const clips:ReelRange[]=[],frames:number[]=[];
 let remaining=limit;
 for(let i=0;i<ranges.length&&remaining>0;i++){
  const c=ranges[i],duration=c.end-c.start;
  if(!Number.isFinite(duration)||duration<=0||c.start<0)continue;
  if(frameCounts){
   const n=frameCounts[i];
   if(!Number.isInteger(n)||n<=0||n/30>remaining+.00001)break;
   clips.push({...c});frames.push(n);remaining-=n/30;
  }else{
   const take=Math.min(duration,remaining);clips.push({start:c.start,end:c.start+take});remaining-=take;
  }
 }
 const total=frameCounts?frameCounts.reduce((n,v)=>n+v/30,0):ranges.reduce((n,c)=>n+Math.max(0,c.end-c.start),0);
 return {ranges:clips,frameCounts:frameCounts?frames:undefined,seconds:limit-remaining,limited:total>limit+.00001};
}

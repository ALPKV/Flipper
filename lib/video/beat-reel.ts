export type BeatClip={id:string;contact:number|null};
export type BeatCut={start:number;end:number;frames:number;hitAt:number;id:string};
/** Native-speed clips: contact sits halfway through each beat-length slot. 30fps grid
 * is rounded cumulatively, so a long reel does not accumulate one rounding error per hit. */
export function beatReel(clips:BeatClip[],bpm:number,beats:number,duration:number):{cuts:BeatCut[];skipped:number}{
 if(!Number.isFinite(bpm)||bpm<40||bpm>240||![2,4,8].includes(beats)||!Number.isFinite(duration)||duration<=0)return {cuts:[],skipped:clips.length};
 const period=60/bpm*beats,cuts:BeatCut[]=[];
 for(const c of [...clips].sort((a,b)=>(a.contact??Infinity)-(b.contact??Infinity))){
  if(c.contact==null||!Number.isFinite(c.contact))continue;
  const i=cuts.length,a=Math.round(i*period*30),b=Math.round((i+1)*period*30);
  const hitFrame=Math.round((i+.5)*period*30),lead=(hitFrame-a)/30;
  const start=c.contact-lead,end=start+(b-a)/30;
  if(start<0||end>duration||start<(cuts.at(-1)?.end??0)-.00001)continue;
  cuts.push({id:c.id,start,end,frames:b-a,hitAt:hitFrame/30});
 }
 return {cuts,skipped:clips.length-cuts.length};
}

export type BeatClip={id:string;contact:number|null;start?:number;end?:number;anchor?:number};
export type BeatCut={start:number;end:number;frames:number;hitAt:number;id:string;padBefore:number;padAfter:number};
/** Keep every candidate. Overlap is intentional; edge frames are held to fill beat slots. */
export function beatReel(clips:BeatClip[],bpm:number,beats:number,duration:number,offset=0):{cuts:BeatCut[];skipped:number}{
 if(!Number.isFinite(bpm)||bpm<40||bpm>240||!Number.isInteger(beats)||beats<1||beats>16||!Number.isFinite(duration)||duration<=0)return {cuts:[],skipped:clips.length};
 const period=60/bpm*beats;
 const cuts=clips.map((c,i)=>{
  const a=Math.round(i*period*30),b=Math.round((i+1)*period*30),hitFrame=Math.round((i+.5)*period*30);
  const raw=c.contact??c.anchor??((c.start??0)+(c.end??duration))/2;
  const anchor=Math.max(0,Math.min(duration,Number.isFinite(raw+offset)?raw+offset:0));
  const wanted=anchor-(hitFrame-a)/30,wantedEnd=wanted+(b-a)/30;
  const start=Math.max(0,Math.min(duration-.000001,wanted)),end=Math.min(duration,Math.max(start+.000001,wantedEnd));
  return {id:c.id,start,end,frames:b-a,hitAt:hitFrame/30,padBefore:Math.max(0,-wanted),padAfter:Math.max(0,wantedEnd-duration)};
 });
 return {cuts,skipped:0};
}

"use client";
import {useEffect,useRef,useState} from "react";
import {Button,Panel} from "../ui";
import {reelPosition,type ReelRange} from "@/lib/video/reel-ranges";
import {clock} from "./video-drop";
/** Plays the selected spans from the original file. No encoding, uploads or intermediate files. */
export function ReelPreview({url,ranges}:{url:string;ranges:ReelRange[]}){
 const video=useRef<HTMLVideoElement>(null);
 const index=useRef(0);
 const [playing,setPlaying]=useState(false),[elapsed,setElapsed]=useState(0),[error,setError]=useState("");
 const total=ranges.reduce((n,c)=>n+c.end-c.start,0);
 useEffect(()=>{
  if(!playing)return;
  let frame=0,disposed=false;
  const tick=()=>{
   const v=video.current,c=ranges[index.current];
   if(!v||!c||disposed)return;
   if(!v.seeking&&v.currentTime>=c.end){
    if(index.current+1<ranges.length){index.current++;v.currentTime=ranges[index.current].start;}
    else {v.pause();setPlaying(false);setElapsed(total);return;}
   }
   const prefix=ranges.slice(0,index.current).reduce((n,r)=>n+r.end-r.start,0);
   setElapsed(Math.min(total,prefix+Math.max(0,Math.min(v.currentTime,ranges[index.current].end)-ranges[index.current].start)));
   frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
  return ()=>{disposed=true;cancelAnimationFrame(frame);};
 },[playing,ranges,total]);
 async function play(){
  const v=video.current;if(!v||!ranges.length)return;
  if(playing){v.pause();setPlaying(false);return;}
  if(elapsed>=total){index.current=0;v.currentTime=ranges[0].start;setElapsed(0);}
  try{await v.play();setPlaying(true);setError("");}catch{setError("Could not play this video. Try an H.264 MP4 in Chrome or Edge.");}
 }
 function seek(t:number){const p=reelPosition(ranges,t);index.current=p.index;if(video.current)video.current.currentTime=p.time;setElapsed(t);}
 return <Panel title="Preview highlights">
  <p className="mb-3 text-sm text-slate">Watch your selected highlights before creating the MP4. This preview skips the excluded footage directly from your original recording.</p>
  <video aria-label="Highlights preview" ref={video} src={url} preload="metadata" playsInline className="max-h-[55vh] w-full bg-navy-950" onLoadedMetadata={()=>{if(video.current&&ranges.length)video.current.currentTime=ranges[0].start;}} onEnded={()=>{if(index.current===ranges.length-1){setPlaying(false);setElapsed(total);}}}/>
  <div className="mt-3 flex items-center gap-3"><Button size="sm" disabled={!ranges.length} onClick={()=>void play()}>{playing?"Pause preview":"Play highlights"}</Button><span className="text-sm tabular-nums">{clock(elapsed)} / {clock(total)}</span></div>
  <input aria-label="Highlights preview timeline" className="mt-3 w-full" type="range" min="0" max={total||1} step="0.01" disabled={!ranges.length} value={elapsed} onChange={e=>seek(Number(e.target.value))}/>
  {!ranges.length?<p className="text-sm">Select clips to preview your highlights.</p>:null}
  {error?<p role="alert" className="text-sm text-risk">{error}</p>:null}
 </Panel>;
}

"use client";
import {useEffect,useRef,useState} from "react";
import {Button,Meter,Panel} from "../ui";
import {exportReel,releaseEngine} from "@/lib/video/ffmpeg";
import type {ReelRange} from "@/lib/video/reel-ranges";
/** Render a lightweight preview once. Native playback never seeks between source cuts. */
export function ReelPreview({file,ranges,frameCounts,disabled,onBusy}:{file:File;ranges:ReelRange[];frameCounts?:number[];disabled:boolean;onBusy:(v:boolean)=>void}){
 const [url,setUrl]=useState<string|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState("");
 const token=useRef(0),running=useRef(false);
 useEffect(()=>()=>{token.current++;if(running.current){releaseEngine();onBusy(false);}},[onBusy]);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 async function prepare(){
  const id=++token.current;setBusy(true);running.current=true;onBusy(true);setError("");setProgress(0);
  try{const blob=await exportReel(file,ranges,p=>{if(id===token.current)setProgress(p);},{precise:true,preview:true,frameCounts});
   if(id===token.current)setUrl(URL.createObjectURL(blob));
  }catch(e){if(id===token.current)setError(e instanceof Error?e.message:"Preview failed.");}
  finally{if(id===token.current){setBusy(false);running.current=false;onBusy(false);}}
 }
 return <Panel title="Preview highlights">
 <p className="mb-3 text-sm text-slate">Prepare a small 480p preview once, then play and scrub smoothly. It uses the same cuts as your final video.</p>
 {url?<video aria-label="Highlights preview" src={url} controls playsInline preload="auto" className="max-h-[55vh] w-full bg-navy-950"/>:<Button size="sm" disabled={disabled||busy||!ranges.length} onClick={()=>void prepare()}>{busy?"Preparing smooth preview…":"Prepare preview"}</Button>}
 {busy?<div role="status" className="mt-3"><p className="mb-2 text-sm">Preparing preview · {Math.round(progress*100)}%</p><Meter value={progress} max={1}/><Button size="sm" tone="ghost" onClick={()=>{token.current++;releaseEngine();setBusy(false);running.current=false;onBusy(false);}}>Cancel preview</Button></div>:null}
 {error?<p role="alert" className="mt-3 text-sm text-risk">{error}</p>:null}
 </Panel>;
}

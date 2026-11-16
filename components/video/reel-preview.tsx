"use client";
import {useEffect,useRef,useState} from "react";
import {Button,Meter,Panel} from "../ui";
import {exportReel,releaseEngine} from "@/lib/video/ffmpeg";
import {previewPlan} from "@/lib/video/preview-plan";
import type {ReelRange} from "@/lib/video/reel-ranges";
/** Render a lightweight preview once. Native playback never seeks between source cuts. */
export function ReelPreview({file,ranges,frameCounts,blockedReason,onBusy}:{file:File;ranges:ReelRange[];frameCounts?:number[];blockedReason:string|null;onBusy:(v:boolean)=>void}){
 const [url,setUrl]=useState<string|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState("");
 const plan=previewPlan(ranges,frameCounts);
 const token=useRef(0),running=useRef(false);
 useEffect(()=>()=>{token.current++;if(running.current){releaseEngine();onBusy(false);}},[onBusy]);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 async function prepare(){
  if(blockedReason){setError(blockedReason);return;}
  if(!plan.ranges.length){setError("Select clips below, or switch to Normal highlights if no hits fit the beat setting.");return;}
  const id=++token.current;setBusy(true);running.current=true;onBusy(true);setError("");setProgress(0);
  try{const blob=await exportReel(file,plan.ranges,p=>{if(id===token.current)setProgress(p);},{precise:true,preview:true,frameCounts:plan.frameCounts});
   if(id===token.current)setUrl(URL.createObjectURL(blob));
  }catch(e){if(id===token.current)setError(e instanceof Error?e.message:"Preview failed.");}
  finally{if(id===token.current){setBusy(false);running.current=false;onBusy(false);}}
 }
 return <Panel title="Preview highlights">
 <p className="mb-3 text-sm text-slate">Prepare a small 480p preview once, then play and scrub smoothly. It uses the same cuts as your final video.</p>
 {plan.limited?<p className="mb-3 text-sm">Previewing the first {Math.round(plan.seconds)} seconds of your highlights. Your full export selection is unchanged.</p>:null}
 {blockedReason?<p role="status" className="mb-3 text-sm">{blockedReason}</p>:null}
 {!ranges.length&&!blockedReason?<p className="mb-3 text-sm">Select clips below, or choose Normal highlights if no hits fit the beat setting.</p>:null}
 {url?<video aria-label="Highlights preview" src={url} controls playsInline preload="auto" className="max-h-[55vh] w-full bg-navy-950"/>:<Button size="sm" disabled={busy} onClick={()=>void prepare()}>{busy?"Preparing smooth preview…":"Prepare preview"}</Button>}
 {busy?<div role="status" className="mt-3"><p className="mb-2 text-sm">Preparing preview · {Math.round(progress*100)}%</p><Meter value={progress} max={1}/><Button size="sm" tone="ghost" onClick={()=>{token.current++;releaseEngine();setBusy(false);running.current=false;onBusy(false);}}>Cancel preview</Button></div>:null}
 {error?<p role="alert" className="mt-3 text-sm text-risk">{error}</p>:null}
 </Panel>;
}

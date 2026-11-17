"use client";
import {useEffect,useRef,useState} from "react";
import {Button,Meter,Panel} from "../ui";
import {exportReel,releaseEngine} from "@/lib/video/ffmpeg";
import {previewPlan} from "@/lib/video/preview-plan";
import type {ReelRange} from "@/lib/video/reel-ranges";
/** Render a lightweight preview once. Native playback never seeks between source cuts. */
export function ReelPreview({file,ranges,frameCounts,blockedReason,onBusy}:{file:File;ranges:ReelRange[];frameCounts?:number[];blockedReason:string|null;onBusy:(v:boolean)=>void}){
 const [url,setUrl]=useState<string|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState("");
 const [status,setStatus]=useState("Preparing preview");
 const plan=previewPlan(ranges,frameCounts);
 const token=useRef(0),running=useRef(false);
 useEffect(()=>()=>{token.current++;if(running.current){releaseEngine();onBusy(false);}},[onBusy]);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 async function prepare(){
  if(running.current)return;
  if(blockedReason){setError(blockedReason);return;}
  if(!plan.ranges.length){setError("Select clips below, or switch to Normal highlights if no hits fit the beat setting.");return;}
  const id=++token.current;setBusy(true);running.current=true;onBusy(true);setError("");setProgress(0);setStatus("Preparing preview");
  try{const blob=await exportReel(file,plan.ranges,p=>{if(id===token.current)setProgress(p);},{precise:true,preview:true,frameCounts:plan.frameCounts,onStatus:message=>{if(id===token.current)setStatus(message);}});
   if(id===token.current)setUrl(URL.createObjectURL(blob));
  }catch(e){if(id===token.current)setError(e instanceof Error?e.message:"Preview failed.");}
  finally{if(id===token.current){setBusy(false);running.current=false;onBusy(false);}}
 }
 return <Panel title="Your reel">
 <p className="mb-3 text-sm text-slate">A lightweight preview of your selected clips. Prepare it once, then play and scrub.</p>
 {plan.limited?<p className="mb-3 text-sm">Previewing the first {Math.round(plan.seconds)} seconds of your highlights. Your full export selection is unchanged.</p>:null}
 {blockedReason?<p role="status" className="mb-3 text-sm">{blockedReason}</p>:null}
 {!ranges.length&&!blockedReason?<p className="mb-3 text-sm">Select clips below, or choose Normal highlights if no hits fit the beat setting.</p>:null}
 {url?<video aria-label="Highlights preview" src={url} controls playsInline preload="auto" className="max-h-[55vh] w-full bg-navy-950"/>:<div className="preview-empty"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M17 10l22 14-22 14z" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg><p className="text-sm text-white/70">{ranges.length} clips · ready when you are</p><Button tone="gold" disabled={busy} onClick={()=>void prepare()}>{busy?"Preparing preview…":"Prepare preview"}</Button></div>}
 {busy?<div role="status" className="mt-3"><p className="mb-2 text-sm">{status} · {Math.round(progress*100)}%</p><Meter value={progress} max={1}/><Button size="sm" tone="ghost" onClick={()=>{token.current++;releaseEngine();setBusy(false);running.current=false;onBusy(false);}}>Cancel preview</Button></div>:null}
 {error?<p role="alert" className="mt-3 text-sm text-risk">{error}</p>:null}
 </Panel>;
}

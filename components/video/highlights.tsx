"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { canSaveToPhotos, download, exportReel, isApple, isTouchDevice, releaseEngine, prepareExport, saveToPhotos } from "@/lib/video/ffmpeg";
import { planExport, type ExportQuality } from "@/lib/video/export-plan";
import { Button, Meter, Panel } from "../ui";
import { Stage } from "./stage";
import { FileBar, VideoDrop, clock } from "./video-drop";
import {ReelPreview} from "./reel-preview";
import {beatReel} from "@/lib/video/beat-reel";
import {reelRanges} from "@/lib/video/reel-ranges";
import { useVideo } from "./video-context";

const subscribe = () => () => {};
const serverFalse = () => false;

function rejectionKey(file: File) { return `flipper:rejected:v1:${file.name}:${file.size}:${file.lastModified}`; }
function rejected(file: File | null): Set<string> {
  if (!file || typeof localStorage === "undefined") return new Set();
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(rejectionKey(file)) ?? "[]");
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch { return new Set(); }
}
function rememberRejection(file: File, id: string, remove = false) {
  const ids = rejected(file);
  if (remove) ids.delete(id); else ids.add(id);
  try { localStorage.setItem(rejectionKey(file), JSON.stringify([...ids])); } catch { /* Session exclusion still works when storage is unavailable. */ }
}


type Output = { url: string; blob: Blob; signature: string; name:string };
export function Highlights() {
  const v = useVideo();
  const { cancelScan } = v;
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [forFile, setForFile] = useState(v.file);
  const [output, setOutput] = useState<Output | null>(null);
  const [engineState,setEngineState]=useState("Preparing export engine…");
  const [previewing,setPreviewing]=useState(false);
  const [beatMode,setBeatMode]=useState(false),[bpmText,setBpmText]=useState("120"),[beats,setBeats]=useState(4);
  const [sideText,setSideText]=useState("1.5"),[offsetText,setOffsetText]=useState("0"),[visibleCount,setVisibleCount]=useState(100);
  const bpm=Number(bpmText);
  const validBpm=Number.isFinite(bpm)&&bpm>=40&&bpm<=240;
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [quality,setQuality]=useState<ExportQuality>("compact");
  const [undo,setUndo]=useState<string|null>(null);
  const shareable=useSyncExternalStore(subscribe,canSaveToPhotos,serverFalse);
  const [sourceOpen,setSourceOpen]=useState(false);
  const [showAll, setShowAll] = useState(false);
  const generation = useRef(0);
  const touch = useSyncExternalStore(subscribe, isTouchDevice, serverFalse);
  useEffect(() => () => { cancelScan(); generation.current++; releaseEngine(); }, [cancelScan]);
  useEffect(() => () => { if (output) URL.revokeObjectURL(output.url); }, [output]);
  useEffect(() => { generation.current++; }, [v.file]);
  useEffect(()=>{
    if(!v.file)return;
    let active=true;
    void prepareExport().then(()=>{if(active)setEngineState("Export engine ready");}).catch(()=>{if(active)setEngineState("Export engine will retry when you export");});
    return ()=>{active=false;};
  },[v.file]);
  if (forFile !== v.file) {
    setForFile(v.file); setSkip(new Set()); setPinned(new Set());
    setOutput(null); setExporting(false); setPreviewing(false); setError(null); setUndo(null); setVisibleCount(100);
  }
  if (!v.file) return <VideoDrop />;
  const file = v.file;
  const audioRunning = v.audio.status === "loading";
  const pending = audioRunning;
  const candidates = v.clips.filter(c => !skip.has(c.id) && (!c.reviewRequired || pinned.has(c.id)))
    .map(c=>({...c, priority: pinned.has(c.id) ? 100 : c.kind === "bat" ? 2 : 1}));
  const selected = candidates.sort((a,b)=>a.start-b.start);
  const selectedIds = new Set(selected.map(c=>c.id));
  const beatPlan=beatReel(selected,bpm,beats,v.meta?.duration??0,v.settings.offset);
  const ranges=beatMode?beatPlan.cuts:reelRanges(selected);
  const frameCounts=beatMode?beatPlan.cuts.map(c=>c.frames):undefined;
  const locked=exporting||previewing;
  const seconds = frameCounts?frameCounts.reduce((n,v)=>n+v/30,0):ranges.reduce((n,c)=>n+c.end-c.start,0);
  const duration = v.meta?.duration ?? 1;
  const beatReady=!beatMode||(validBpm&&!!v.meta&&Number.isFinite(v.meta.duration)&&v.meta.duration>0);
  const plan = planExport(file.size, duration, seconds, ranges.length, beatMode?"compact":quality, touch);
  const signature = (beatMode?`beat:${bpm}:${beats}:${v.settings.offset}|`:"normal|")+quality+"|"+selected.map(c=>`${c.id}:${c.start}:${c.end}`).join("|");
  const ready = output && (output.signature===signature || v.clips.some(c=>output.signature===`single:${c.id}|${signature}`)) ? output : null;
  const rows = showAll ? v.clips : v.clips.filter(c=>selectedIds.has(c.id));
  function toggle(id: string) {
    if (selectedIds.has(id)) setSkip(old=>new Set(old).add(id));
    else { setSkip(old=>{const n=new Set(old); n.delete(id); return n;}); setPinned(old=>new Set(old).add(id)); }
  }
  async function build(single?: (typeof v.clips)[number]) {
    if(previewing)return;
    const token = ++generation.current;
    setExporting(true); setProgress(0); setError(null);
    try {
      const beatCut=single&&beatMode?beatPlan.cuts.find(c=>c.id===single.id):undefined;
      const blob = await exportReel(file, single?[beatCut??single]:ranges, p=>{if(generation.current===token)setProgress(p);}, {precise: plan.precise,frameCounts:single?(beatCut?[beatCut.frames]:undefined):frameCounts});
      if (generation.current === token) setOutput({blob,url:URL.createObjectURL(blob),signature:single?`single:${single.id}|${signature}`:signature,name:`${file.name.replace(/\.[^.]+$/,"")}_${single?"clip_"+single.id:"highlights"}.mp4`});
    } catch(err) { if(generation.current===token)setError(err instanceof Error?err.message:"Export failed."); }
    finally { if(generation.current===token)setExporting(false); }
  }
  return <div className="space-y-5">
    <FileBar />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <ReelPreview key={signature} file={file} ranges={ranges} frameCounts={frameCounts} blockedReason={beatMode&&!validBpm?"Enter a tempo between 40 and 240 BPM.":beatMode&&!beatReady?"Reading the recording duration. Clips will be ready after sound analysis.":pending?`Sound analysis is still running (${Math.round(v.audio.progress*100)}%). Preview will be ready when it finishes.`:exporting?"An export is running. Finish or cancel it before preparing a preview.":null} onBusy={setPreviewing}/>
        <details className="editor-source" open={sourceOpen} onToggle={e=>setSourceOpen(e.currentTarget.open)}><summary>Original recording & frame controls</summary><div className="border-t border-line">        <Stage clip={v.clips.find(c=>c.id===v.selectedId)??null} showAnalysis={false}/></div></details>
        <Panel title="Clips" action={<Button size="sm" tone="ghost" onClick={()=>setShowAll(!showAll)}>{showAll?"Show chosen":"Show all candidates"}</Button>}>
          <p className="mb-3 text-sm text-slate">{selected.length} of {v.clips.length} clips selected. All sounds and overlaps are kept unless you exclude them.</p>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button size="sm" tone="ghost" disabled={locked} onClick={()=>{v.clips.forEach(c=>rememberRejection(file,c.id,true));setSkip(new Set());setPinned(new Set(v.clips.map(c=>c.id)));}}>Select all</Button>
            <Button size="sm" tone="ghost" disabled={locked} onClick={()=>setSkip(new Set(v.clips.map(c=>c.id)))}>Select none</Button>
            <Button size="sm" tone="ghost" disabled={locked} onClick={()=>{const c=v.addManualClip(v.playhead());v.select(c.id);setPinned(old=>new Set(old).add(c.id));}}>Add at playhead</Button>
            {undo?<Button size="sm" tone="ghost" disabled={locked} onClick={()=>{rememberRejection(file,undo,true);setSkip(old=>{const n=new Set(old);n.delete(undo);return n;});setUndo(null);}}>Undo exclusion</Button>:null}
          </div>
          <ol className="max-h-[540px] overflow-y-auto divide-y divide-line">{rows.slice(0,visibleCount).map((c,index)=><li key={c.id} className={`flex flex-wrap items-center gap-3 py-3 ${selectedIds.has(c.id)?"":"opacity-60"}`}>
            <input type="checkbox" aria-label={`Include clip ${index+1}`} disabled={locked} checked={selectedIds.has(c.id)} onChange={()=>toggle(c.id)}/>
            <button className="flex-1 text-left text-sm" onClick={()=>{setSourceOpen(true);v.select(c.id);v.seek(c.start,true);}}><span className="mr-2 text-xs text-mute">{String(index+1).padStart(2,"0")}</span><b>{clock(c.start)}</b> · {(c.end-c.start).toFixed(1)}s<span className="block text-xs text-mute">{beatMode?(beatPlan.cuts.some(b=>b.id===c.id)?"Included in beat reel":"Waiting for recording information"):c.manual?"Manually added clip":"Sound detected · review candidate"}</span></button>
            <Button size="sm" tone="ghost" disabled={locked||pending} onClick={()=>void build(c)}>Export clip</Button>
            <Button size="sm" tone="ghost" disabled={locked} onClick={()=>{setUndo(c.id);rememberRejection(file,c.id);setSkip(old=>new Set(old).add(c.id));}}>Not a delivery</Button>
          </li>)}</ol>
          {rows.length>visibleCount?<div className="mt-3 flex items-center justify-between gap-3 text-xs text-mute"><span>Showing {visibleCount} of {rows.length}. All selected clips stay in the export.</span><Button size="sm" tone="ghost" onClick={()=>setVisibleCount(n=>n+100)}>Show 100 more</Button></div>:null}
          {!rows.length ? <p className="text-sm">{pending?"Candidates will appear after analysis.":"No sound candidates selected. Show all candidates to review your choices."}</p> : null}
        </Panel>
      </div>
      <aside className="space-y-5">
        <Panel title="Edit style">
          <div className="flex flex-wrap gap-2"><Button size="sm" tone={beatMode?"ghost":"gold"} disabled={locked} onClick={()=>setBeatMode(false)}>Normal highlights</Button><Button size="sm" tone={beatMode?"gold":"ghost"} disabled={locked} onClick={()=>setBeatMode(true)}>Beat sync</Button></div>
          {beatMode?<div className="mt-4 space-y-3">
            <p className="text-sm">{validBpm?`${(beats*60/bpm).toFixed(2)}s per clip · ${(beats*30/bpm).toFixed(2)}s each side of the sound`:"Enter your song’s tempo below."}</p>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Tempo (BPM)<input aria-label="Tempo (BPM)" className="field mt-1" type="number" min="40" max="240" disabled={locked} value={bpmText} onChange={e=>setBpmText(e.target.value)}/></label><label className="text-sm">One hit every<select aria-label="One hit every" className="field mt-1" disabled={locked} value={beats} onChange={e=>setBeats(Number(e.target.value))}><option value="1">1 beat · quick cuts</option><option value="2">2 beats · fast</option><option value="4">4 beats · recommended</option><option value="8">8 beats · more buildup</option></select></label></div>
            <p className="text-sm">{beatReady?`${beatPlan.cuts.length} clips kept. The sound sits in the middle of every clip.`:"Reading timing… your selected clips are still kept."}</p>
            <p className="text-xs text-mute">For any song: enter its BPM, export, then align the first sound at {beatPlan.cuts[0]?.hitAt.toFixed(3)??"—"}s with a beat in your reel editor. The rest follow every {beats} beats. No song upload needed.</p>
          </div>:<p className="mt-3 text-sm text-slate">Keep the buildup and follow-through around each sound.</p>}
        </Panel>
        <Panel title="Cut timing">
          <p className="text-sm text-slate">Keep every detection. Overlapping footage stays in your reel.</p>
          {!beatMode?<label className="mt-4 block text-sm">Seconds each side of the sound<input aria-label="Seconds each side of the sound" className="field mt-1" type="number" min="0.1" max="15" step="0.05" disabled={locked} value={sideText} onChange={e=>{const text=e.target.value;setSideText(text);const n=Number(text);if(text!==""&&Number.isFinite(n)&&n>=.1&&n<=15)v.setSettings({...v.settings,leadIn:n,length:2*n});}} onBlur={()=>setSideText(String(v.settings.leadIn))}/><span className="mt-2 block text-xs text-mute">{v.settings.length.toFixed(2)}s total · equal buildup and follow-through. Recording edges use available footage.</span></label>:<p className="mt-3 text-sm">Your BPM sets equal time before and after each sound. Edge clips use held frames; no clips are dropped.</p>}
          <label className="mt-4 block text-sm">Offset (seconds)<input aria-label="Offset (seconds)" className="field mt-1" type="number" min="-15" max="15" step="0.05" disabled={locked} value={offsetText} onChange={e=>{const text=e.target.value;setOffsetText(text);const n=Number(text);if(text!==""&&Number.isFinite(n)&&n>=-15&&n<=15)v.setSettings({...v.settings,offset:n});}} onBlur={()=>setOffsetText(String(v.settings.offset))}/></label>
          <p className="mt-2 text-xs text-mute">Move cuts later (+) or earlier (−). For machine noise 1s before the hit, try +1.00 and reduce the time each side to leave the machine noise out.</p>
          <p className="mt-3 text-sm">No automatic filtering or skipped clips.</p>
          {audioRunning ? <div role="status" className="mt-3"><p className="mb-2 text-sm">Checking sound · {Math.round(v.audio.progress*100)}%</p><Meter value={v.audio.progress} max={1}/></div> : null}
          {v.audio.error ? <p role="alert" className="mt-3 text-sm text-risk">{v.audio.error}</p> : null}

        </Panel>
        <Panel title="Export reel">
          <p className="text-4xl font-semibold tracking-tight tabular-nums text-ink">{clock(seconds)}</p><p className="mt-2 text-sm">{beatMode?beatPlan.cuts.length:selected.length} {beatMode?"beat-timed hits":"selected clips"} · no time limit</p>
          <p className="mt-3 text-xs text-mute">{beatMode?"Hits follow your chosen beat spacing.":"Every selected clip is exported in full, including overlapping footage."} {plan.reason}.</p>
          <label className="mt-4 block text-sm">Export quality<select aria-label="Export quality" className="field mt-1" disabled={locked||beatMode} value={beatMode?"compact":quality} onChange={e=>setQuality(e.target.value as ExportQuality)}><option value="compact">Smaller 720p — exact cuts</option><option value="auto">Recommended — one file</option><option value="original">Original quality — faster</option></select></label>
          <p className="mt-2 text-xs text-mute">Estimated size: {Math.ceil(plan.estimatedBytes/1e6)} MB. {beatMode?"Beat mode always uses exact 30 fps cuts.":"Original-quality cuts may include extra footage near keyframes."}</p>
          <Button className="mt-4 w-full" tone="gold" disabled={pending || locked || !beatReady || !ranges.length || !plan.fits} onClick={()=>void build()}>{exporting?"Making your reel…":"Create highlights"}</Button>
          <p role="status" className="mt-2 text-xs text-mute">{exporting?`Creating MP4 · ${Math.round(progress*100)}%`:engineState}</p>
          {exporting ? <div className="mt-3"><Meter value={progress} max={1}/><Button className="mt-2" size="sm" tone="ghost" onClick={()=>{generation.current++;releaseEngine();setExporting(false);setError("Export canceled. Your choices are still here.");}}>Cancel export</Button></div> : null}
          {!plan.fits ? <p className="mt-3 text-sm text-risk">This output exceeds this device&apos;s memory budget. Exclude some candidates before exporting.</p> : null}
          {error ? <p role="alert" className="mt-3 text-sm text-risk">{error}</p> : null}
        </Panel>
        {ready ? <Panel title="Ready to save"><video controls playsInline src={ready.url} className="w-full bg-navy-950"/><p className="my-3 text-xs">One MP4 · {(ready.blob.size/1e6).toFixed(1)} MB</p><Button tone="gold" onClick={()=>download(ready.blob,ready.name)}>Save video</Button>{shareable?<Button tone="ghost" onClick={()=>{void saveToPhotos(ready.blob,ready.name).catch(err=>setError(err instanceof Error?err.message:"Sharing failed."));}}>{isApple()?"Save to Photos":"Share to gallery"}</Button>:null}</Panel> : null}
        <p className="text-xs text-mute">Everything runs on this device. No account, upload or per-clip downloads. Speed Check is still in progress.</p>
      </aside>
    </div>
  </div>;
}

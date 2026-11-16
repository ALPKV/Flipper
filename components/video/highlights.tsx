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
  const [skip, setSkip] = useState<Set<string>>(() => rejected(v.file));
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [forFile, setForFile] = useState(v.file);
  const [output, setOutput] = useState<Output | null>(null);
  const [engineState,setEngineState]=useState("Preparing export engine…");
  const [previewing,setPreviewing]=useState(false);
  const [beatMode,setBeatMode]=useState(false),[bpm,setBpm]=useState(127),[beats,setBeats]=useState(4);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [quality,setQuality]=useState<ExportQuality>("compact");
  const [undo,setUndo]=useState<string|null>(null);
  const shareable=useSyncExternalStore(subscribe,canSaveToPhotos,serverFalse);
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
    setForFile(v.file); setSkip(rejected(v.file)); setPinned(new Set());
    setOutput(null); setExporting(false); setError(null); setUndo(null);
  }
  if (!v.file) return <VideoDrop />;
  const file = v.file;
  const audioRunning = v.audio.status === "loading";
  const pending = audioRunning;
  const candidates = v.clips.filter(c => !skip.has(c.id) && (!c.reviewRequired || pinned.has(c.id)))
    .map(c=>({...c, priority: pinned.has(c.id) ? 100 : c.kind === "bat" ? 2 : 1}));
  const selected = candidates.sort((a,b)=>a.start-b.start);
  const selectedIds = new Set(selected.map(c=>c.id));
  const beatPlan=beatReel(selected,bpm,beats,v.meta?.duration??0);
  const ranges=beatMode?beatPlan.cuts:reelRanges(selected);
  const frameCounts=beatMode?beatPlan.cuts.map(c=>c.frames):undefined;
  const locked=exporting||previewing;
  const seconds = ranges.reduce((n,c)=>n+c.end-c.start,0);
  const duration = v.meta?.duration ?? 1;
  const plan = planExport(file.size, duration, seconds, ranges.length, beatMode?"compact":quality, touch);
  const signature = (beatMode?`beat:${bpm}:${beats}|`:"normal|")+quality+"|"+selected.map(c=>`${c.id}:${c.start}:${c.end}`).join("|");
  const ready = output && (output.signature===signature || v.clips.some(c=>output.signature===`single:${c.id}:${c.start}:${c.end}:${quality}`)) ? output : null;
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
      const blob = await exportReel(file, single?[single]:ranges, p=>{if(generation.current===token)setProgress(p);}, {precise: plan.precise,frameCounts:single?undefined:frameCounts});
      if (generation.current === token) setOutput({blob,url:URL.createObjectURL(blob),signature:single?`single:${single.id}:${single.start}:${single.end}:${quality}`:signature,name:`${file.name.replace(/\.[^.]+$/,"")}_${single?"clip_"+single.id:"highlights"}.mp4`});
    } catch(err) { if(generation.current===token)setError(err instanceof Error?err.message:"Export failed."); }
    finally { if(generation.current===token)setExporting(false); }
  }
  return <div className="space-y-5">
    <FileBar />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <Panel title="Reel style">
          <div className="flex flex-wrap gap-2"><Button size="sm" tone={beatMode?"ghost":"gold"} disabled={locked} onClick={()=>setBeatMode(false)}>Normal highlights</Button><Button size="sm" tone={beatMode?"gold":"ghost"} disabled={locked} onClick={()=>{setBeatMode(true);setBpm(127);}}>Waka Waka beat reel</Button></div>
          {beatMode?<div className="mt-4 space-y-3">
            <p className="text-sm">{bpm} BPM · {(60/bpm).toFixed(3)}s per beat. Each bat hit lands halfway through a clip, then repeats every {beats} beats. No song file needed.</p>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Tempo (BPM)<input aria-label="Tempo (BPM)" className="field mt-1" type="number" min="40" max="240" disabled={locked} value={bpm} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=40&&n<=240)setBpm(n);}}/></label><label className="text-sm">One hit every<select aria-label="One hit every" className="field mt-1" disabled={locked} value={beats} onChange={e=>setBeats(Number(e.target.value))}><option value="2">2 beats · fast</option><option value="4">4 beats · recommended</option><option value="8">8 beats · more buildup</option></select></label></div>
            <p className="text-sm">{beatPlan.cuts.length} hits ready · {beatPlan.skipped} omitted because they are too close together, near the video edges, or have no contact mark. Select genuine bat hits below.</p>
            <p className="text-xs text-mute">Add Waka Waka in your reel editor and align a song beat with the first hit at {beatPlan.cuts[0]?.hitAt.toFixed(3)??"—"}s. The remaining hits follow that beat grid. Remixes or sped-up versions may need a different BPM. <a className="underline" href="https://songbpm.com/@shakira/waka-waka-this-time-for-africa" target="_blank" rel="noreferrer">Tempo source</a></p>
          </div>:<p className="mt-3 text-sm text-slate">Use your before/after controls to keep the buildup and follow-through.</p>}
        </Panel>
        <Panel title="Find the deliveries">
          <p className="text-sm text-slate">Every detected sound peak becomes a clip candidate. Nearby sounds stay separate: their clips meet halfway, so nothing is skipped because it falls inside another cut. Review the candidates to remove speech, footsteps or net noise.</p>
          {!beatMode?<><div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Before sound (seconds)<input aria-label="Before sound (seconds)" className="field mt-1" type="number" min="0" max="15" step="0.1" disabled={locked} value={v.settings.leadIn} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=0&&n<=15)v.setSettings({...v.settings,leadIn:n,length:n+Math.max(.1,v.settings.length-v.settings.leadIn)});}}/></label>
            <label className="text-sm">After sound (seconds)<input aria-label="After sound (seconds)" className="field mt-1" type="number" min="0.1" max="30" step="0.1" disabled={locked} value={Number(Math.max(.1,v.settings.length-v.settings.leadIn).toFixed(2))} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=.1&&n<=30)v.setSettings({...v.settings,length:v.settings.leadIn+n});}}/></label>
          </div>
          <p className="mt-2 text-xs text-mute">Clip duration: {v.settings.length.toFixed(1)}s. Nearby sounds and the recording edges can shorten a cut. Changing these controls updates clips immediately.</p></>:<p className="mt-3 text-sm">Clip timing follows your beat setting above.</p>}
          <label className="mt-4 block text-sm">Find sounds<select aria-label="Find sounds" className="field mt-1" disabled={locked} value={v.settings.threshold} onChange={e=>v.setSettings({...v.settings,threshold:Number(e.target.value)})}><option value="-120">All sounds</option><option value="-35">Softer shots</option><option value="-25">Balanced</option><option value="-10">Big hits only</option>{![-120,-35,-25,-10].includes(v.settings.threshold)?<option value={v.settings.threshold}>Custom</option>:null}</select></label>
          <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" disabled={locked} checked={v.settings.noisy} onChange={e=>v.setSettings({...v.settings,noisy:e.target.checked})}/>Noisy hall — filter speech and weaker impacts (may miss shots)</label>
          <details className="mt-3 text-sm"><summary className="cursor-pointer">Fine-tune sensitivity</summary><label className="mt-2 block">Sensitivity: {v.settings.threshold===-120?"all sounds":`${v.settings.threshold} dB`}<input aria-label="Sensitivity" type="range" className="mt-2 w-full" min="-120" max="0" step="1" disabled={locked} value={v.settings.threshold} onChange={e=>v.setSettings({...v.settings,threshold:Number(e.target.value)})}/></label></details>
          {audioRunning ? <div role="status" className="mt-3"><p className="mb-2 text-sm">Checking sound · {Math.round(v.audio.progress*100)}%</p><Meter value={v.audio.progress} max={1}/></div> : null}
          {v.audio.error ? <p role="alert" className="mt-3 text-sm text-risk">{v.audio.error}</p> : null}

        </Panel>
        <Stage clip={v.clips.find(c=>c.id===v.selectedId)??null} showAnalysis={false}/>
        <ReelPreview key={signature} file={file} ranges={ranges} frameCounts={frameCounts} blockedReason={pending?`Sound analysis is still running (${Math.round(v.audio.progress*100)}%). Preview will be ready when it finishes.`:exporting?"An export is running. Finish or cancel it before preparing a preview.":null} onBusy={setPreviewing}/>
        <Panel title="Review the reel" action={<Button size="sm" tone="ghost" onClick={()=>setShowAll(!showAll)}>{showAll?"Show chosen":"Show all candidates"}</Button>}>
          <p className="mb-3 text-sm text-slate">{selected.length} chosen from {v.clips.length} candidates. Review before saving. “Not a delivery” remembers your correction for this recording on this device.</p>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button size="sm" tone="ghost" disabled={locked} onClick={()=>{v.clips.forEach(c=>rememberRejection(file,c.id,true));setSkip(new Set());setPinned(new Set(v.clips.map(c=>c.id)));}}>Select all</Button>
            <Button size="sm" tone="ghost" disabled={locked} onClick={()=>setSkip(new Set(v.clips.map(c=>c.id)))}>Select none</Button>
            <Button size="sm" tone="ghost" disabled={locked} onClick={()=>{const c=v.addManualClip(v.playhead());v.select(c.id);setPinned(old=>new Set(old).add(c.id));}}>Add at playhead</Button>
            {undo?<Button size="sm" tone="ghost" disabled={locked} onClick={()=>{rememberRejection(file,undo,true);setSkip(old=>{const n=new Set(old);n.delete(undo);return n;});setUndo(null);}}>Undo exclusion</Button>:null}
          </div>
          <ol className="divide-y divide-line">{rows.map(c=><li key={c.id} className={`flex flex-wrap items-center gap-3 py-3 ${selectedIds.has(c.id)?"":"opacity-60"}`}>
            <input type="checkbox" aria-label={`Include delivery at ${clock(c.start)}`} disabled={locked} checked={selectedIds.has(c.id)} onChange={()=>toggle(c.id)}/>
            <button className="flex-1 text-left text-sm" onClick={()=>{v.select(c.id);v.seek(c.start,true);}}><b>{clock(c.start)}</b> · {(c.end-c.start).toFixed(1)}s<span className="block text-xs text-mute">{beatMode?(beatPlan.cuts.some(b=>b.id===c.id)?"Included in beat reel":"Omitted from beat reel · too close, near an edge or no contact"):c.manual?"Manually added clip":"Sound detected · review candidate"}</span></button>
            <Button size="sm" tone="ghost" disabled={locked||pending} onClick={()=>void build(c)}>Export clip</Button>
            <Button size="sm" tone="ghost" disabled={locked} onClick={()=>{setUndo(c.id);rememberRejection(file,c.id);setSkip(old=>new Set(old).add(c.id));}}>Not a delivery</Button>
          </li>)}</ol>
          {!rows.length ? <p className="text-sm">{pending?"Candidates will appear after analysis.":"No sound candidates selected. Show all candidates to review your choices."}</p> : null}
        </Panel>
      </div>
      <aside className="space-y-5">
        <Panel title="One highlights video">
          <p className="display text-5xl font-extrabold text-navy">{clock(seconds)}</p><p className="mt-2 text-sm">{beatMode?beatPlan.cuts.length:selected.length} {beatMode?"beat-timed hits":"selected sound clips"} · no time limit</p>
          <p className="mt-3 text-xs text-mute">{beatMode?"Hits follow your chosen beat spacing.":"Nearby sounds share cut boundaries. Total duration follows your selection."} {plan.reason}.</p>
          <label className="mt-4 block text-sm">Export quality<select aria-label="Export quality" className="field mt-1" disabled={locked||beatMode} value={beatMode?"compact":quality} onChange={e=>setQuality(e.target.value as ExportQuality)}><option value="compact">Smaller 720p — exact cuts</option><option value="auto">Recommended — one file</option><option value="original">Original quality — faster</option></select></label>
          <p className="mt-2 text-xs text-mute">Estimated size: {Math.ceil(plan.estimatedBytes/1e6)} MB. {beatMode?"Beat mode always uses exact 30 fps cuts.":"Original-quality cuts may include extra footage near keyframes."}</p>
          <Button className="mt-4 w-full" tone="gold" disabled={pending || locked || !ranges.length || !plan.fits} onClick={()=>void build()}>{exporting?"Making your reel…":"Create highlights"}</Button>
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

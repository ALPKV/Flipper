"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { download, exportReel, isTouchDevice, releaseEngine } from "@/lib/video/ffmpeg";
import { planExport } from "@/lib/video/export-plan";
import { Button, Meter, Panel } from "../ui";
import { Stage } from "./stage";
import { FileBar, VideoDrop, clock } from "./video-drop";
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


type Output = { url: string; blob: Blob; signature: string };
export function Highlights() {
  const v = useVideo();
  const { cancelScan } = v;
  const [skip, setSkip] = useState<Set<string>>(() => rejected(v.file));
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [forFile, setForFile] = useState(v.file);
  const [output, setOutput] = useState<Output | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const generation = useRef(0);
  const touch = useSyncExternalStore(subscribe, isTouchDevice, serverFalse);
  useEffect(() => () => { cancelScan(); generation.current++; releaseEngine(); }, [cancelScan]);
  useEffect(() => () => { if (output) URL.revokeObjectURL(output.url); }, [output]);
  useEffect(() => { generation.current++; }, [v.file]);
  if (forFile !== v.file) {
    setForFile(v.file); setSkip(rejected(v.file)); setPinned(new Set());
    setOutput(null); setExporting(false); setError(null);
  }
  if (!v.file) return <VideoDrop />;
  const file = v.file;
  const audioRunning = v.audio.status === "loading";
  const pending = audioRunning;
  const candidates = v.clips.filter(c => !skip.has(c.id) && (!c.reviewRequired || pinned.has(c.id)))
    .map(c=>({...c, priority: pinned.has(c.id) ? 100 : c.kind === "bat" ? 2 : 1}));
  const selected = candidates.sort((a,b)=>a.start-b.start);
  const selectedIds = new Set(selected.map(c=>c.id));
  const seconds = selected.reduce((n,c)=>n+c.end-c.start,0);
  const duration = v.meta?.duration ?? 1;
  const plan = planExport(file.size, duration, seconds, selected.length, "compact", touch);
  const signature = selected.map(c=>`${c.id}:${c.start}:${c.end}`).join("|");
  const ready = output?.signature === signature ? output : null;
  const rows = showAll ? v.clips : v.clips.filter(c=>selectedIds.has(c.id));
  function toggle(id: string) {
    if (selectedIds.has(id)) setSkip(old=>new Set(old).add(id));
    else { setSkip(old=>{const n=new Set(old); n.delete(id); return n;}); setPinned(old=>new Set(old).add(id)); }
  }
  async function build() {
    const token = ++generation.current;
    setExporting(true); setProgress(0); setError(null);
    try {
      const blob = await exportReel(file, selected, p=>{if(generation.current===token)setProgress(p);}, {precise: plan.precise});
      if (generation.current === token) setOutput({blob,url:URL.createObjectURL(blob),signature});
    } catch(err) { if(generation.current===token)setError(err instanceof Error?err.message:"Export failed."); }
    finally { if(generation.current===token)setExporting(false); }
  }
  return <div className="space-y-5">
    <FileBar />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <Panel title="Find the deliveries">
          <p className="text-sm text-slate">Every detected sound peak becomes a clip candidate. Nearby sounds stay separate: their clips meet halfway, so nothing is skipped because it falls inside another cut. Review the candidates to remove speech, footsteps or net noise.</p>
          {audioRunning ? <div role="status" className="mt-3"><p className="mb-2 text-sm">Checking sound · {Math.round(v.audio.progress*100)}%</p><Meter value={v.audio.progress} max={1}/></div> : null}
          {v.audio.error ? <p role="alert" className="mt-3 text-sm text-risk">{v.audio.error}</p> : null}

        </Panel>
        <Stage clip={v.clips.find(c=>c.id===v.selectedId)??null} showAnalysis={false}/>
        <Panel title="Review the reel" action={<Button size="sm" tone="ghost" onClick={()=>setShowAll(!showAll)}>{showAll?"Show chosen":"Show all candidates"}</Button>}>
          <p className="mb-3 text-sm text-slate">{selected.length} chosen from {v.clips.length} candidates. Review before saving. “Not a delivery” remembers your correction for this recording on this device.</p>
          <ol className="divide-y divide-line">{rows.map(c=><li key={c.id} className={`flex flex-wrap items-center gap-3 py-3 ${selectedIds.has(c.id)?"":"opacity-60"}`}>
            <input type="checkbox" aria-label={`Include delivery at ${clock(c.start)}`} disabled={exporting} checked={selectedIds.has(c.id)} onChange={()=>toggle(c.id)}/>
            <button className="flex-1 text-left text-sm" onClick={()=>{v.select(c.id);v.seek(c.start,true);}}><b>{clock(c.start)}</b> · {(c.end-c.start).toFixed(1)}s<span className="block text-xs text-mute">Sound detected · review candidate</span></button>
            <Button size="sm" tone="ghost" disabled={exporting} onClick={()=>{rememberRejection(file,c.id);setSkip(old=>new Set(old).add(c.id));}}>Not a delivery</Button>
          </li>)}</ol>
          {!rows.length ? <p className="text-sm">{pending?"Candidates will appear after analysis.":"No sound candidates selected. Show all candidates to review your choices."}</p> : null}
        </Panel>
      </div>
      <aside className="space-y-5">
        <Panel title="One highlights video">
          <p className="display text-5xl font-extrabold text-navy">{clock(seconds)}</p><p className="mt-2 text-sm">{selected.length} selected sound clips · no time limit</p>
          <p className="mt-3 text-xs text-mute">Nearby sounds share cut boundaries. Total duration follows your selection. {plan.reason}.</p>
          <Button className="mt-4 w-full" tone="gold" disabled={pending || exporting || !selected.length || !plan.fits} onClick={()=>void build()}>{exporting?"Making your reel…":"Create highlights"}</Button>
          {exporting ? <div className="mt-3"><Meter value={progress} max={1}/><Button className="mt-2" size="sm" tone="ghost" onClick={()=>{generation.current++;releaseEngine();setExporting(false);setError("Export canceled. Your choices are still here.");}}>Cancel export</Button></div> : null}
          {!plan.fits ? <p className="mt-3 text-sm text-risk">This output exceeds this device&apos;s memory budget. Exclude some candidates before exporting.</p> : null}
          {error ? <p role="alert" className="mt-3 text-sm text-risk">{error}</p> : null}
        </Panel>
        {ready ? <Panel title="Ready to save"><video controls playsInline src={ready.url} className="w-full bg-navy-950"/><p className="my-3 text-xs">One MP4 · {(ready.blob.size/1e6).toFixed(1)} MB</p><Button tone="gold" onClick={()=>download(ready.blob,`${file.name.replace(/\.[^.]+$/,"")}_highlights.mp4`)}>Save video</Button></Panel> : null}
        <p className="text-xs text-mute">Everything runs on this device. No account, upload or per-clip downloads. Speed Check is still in progress.</p>
      </aside>
    </div>
  </div>;
}

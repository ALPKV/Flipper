"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { canSaveToPhotos, download, exportClip, exportReel, isApple, isTouchDevice, releaseEngine, saveToPhotos } from "@/lib/video/ffmpeg";
import { planExport, type ExportQuality } from "@/lib/video/export-plan";
import { Button, Empty, Meter, Panel } from "../ui";
import { Stage } from "./stage";
import { FileBar, VideoDrop, clock } from "./video-drop";
import { useVideo, type Clip } from "./video-context";

const subscribe = () => () => {};
const serverFalse = () => false;

type Output = { blob: Blob; url: string; name: string; signature: string };

export function Highlights() {
  const v = useVideo();
  const router = useRouter();
  const { scanVideo } = v;
  useEffect(() => {
    if (v.url && v.settings.visual && v.audio.status !== "loading" && v.deliveryScan.status === "idle") void scanVideo();
  }, [v.url, v.settings.visual, v.audio.status, v.deliveryScan.status, scanVideo]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<string | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [quality, setQuality] = useState<ExportQuality>("auto");
  const [tracking, setTracking] = useState(false);
  const touch = useSyncExternalStore(subscribe, isTouchDevice, serverFalse);
  const shareable = useSyncExternalStore(subscribe, canSaveToPhotos, serverFalse);
  const [trackProgress, setTrackProgress] = useState<string | null>(null);
  const generation = useRef(0);
  const currentFile = useRef(v.file);
  const trackingCanceled = useRef(false);
  useEffect(() => { currentFile.current = v.file; generation.current++; trackingCanceled.current = true; }, [v.file]);


  useEffect(() => () => {
    generation.current++;
    trackingCanceled.current = true;
  }, []);
  useEffect(() => () => { if (output) URL.revokeObjectURL(output.url); }, [output]);

  const [forFile, setForFile] = useState(v.file);
  if (forFile !== v.file) {
    setForFile(v.file); setSkip(new Set()); setApproved(new Set()); setOutput(null); setError(null); setBusy(null); setTrackProgress(null); setUndo(null);
  }

  if (!v.file) return <VideoDrop />;
  const file = v.file;
  const selected = v.clips.find((c) => c.id === v.selectedId) ?? null;
  const isIncluded = (c: Clip) => !skip.has(c.id) && (!c.reviewRequired || approved.has(c.id));
  const included = v.clips.filter(isIncluded);
  const seconds = included.reduce((sum, c) => sum + c.end - c.start, 0);
  const duration = v.meta?.duration ?? v.clips.at(-1)?.end ?? 1;
  const base = file.name.replace(/\.[^.]+$/, "");
  const plan = planExport(file.size, duration, seconds, included.length, quality, touch);
  const signature = `${quality}|${included.map((c) => `${c.id}:${c.start}:${c.end}`).join("|")}`;
  const ready = output?.signature === signature ? output : null;
  const scanning = v.audio.status === "loading";
  const visualScanning = v.deliveryScan.status === "running";
  const awaitingVideo = v.settings.visual && !v.deliveryScan.result;
  const scanResult = v.deliveryScan.result;
  const coveragePercent = scanResult ? Math.min(100, Math.round(100 * scanResult.covered.reduce((sum, [a, b]) => sum + b - a, 0) / scanResult.duration)) : 0;

  function toggle(id: string) {
    const clip = v.clips.find((c) => c.id === id);
    if (clip && !isIncluded(clip)) {
      setApproved((old) => new Set(old).add(id));
      setSkip((old) => { const next = new Set(old); next.delete(id); return next; });
    } else setSkip((old) => new Set(old).add(id));
  }
  function play(c: Clip) { v.select(c.id); v.seek(c.start, true); }
  async function run(label: string, job: () => Promise<void>) {
    const token = ++generation.current;
    setBusy(label); setError(null); setProgress(0);
    try { await job(); }
    catch (err) { if (generation.current === token) setError(err instanceof Error ? err.message : "Something went wrong. Try again."); }
    finally { if (generation.current === token) setBusy(null); }
  }
  function build() {
    const snapshot = [...included];
    void run("export", async () => {
      const token = generation.current;
      const blob = await exportReel(file, snapshot, (p) => {
        if (generation.current === token) setProgress(p);
      }, { precise: plan.precise });
      if (token !== generation.current || file !== currentFile.current) return;
      setOutput({ blob, url: URL.createObjectURL(blob), name: `${base}_highlights.mp4`, signature });
    });
  }
  function cancel() {
    generation.current++; setBusy(null); setProgress(0);
    releaseEngine();
    setError("Export canceled. Your clips are still here.");
  }
  function single(c: Clip, index: number) {
    void run("single", async () => {
      const token = generation.current;
      const blob = await exportClip(file, c.start, c.end - c.start);
      if (generation.current !== token || file !== currentFile.current) return;
      setOutput({ blob, url: URL.createObjectURL(blob), name: `${base}_clip${index + 1}.mp4`, signature: `single:${c.id}` });
    });
  }
  async function trackSelected() {
    trackingCanceled.current = false;
    const todo = included.filter((c) => v.analyses[c.id]?.status !== "done");
    try {
      for (let i = 0; i < todo.length; i++) {
        if (trackingCanceled.current || currentFile.current !== file) break;
        setTrackProgress(`Tracking ${i + 1} of ${todo.length}`);
        await v.analyze(todo[i]);
      }
    } finally { if (currentFile.current === file) setTrackProgress(null); }
  }
  const saving = output && (ready || output.signature.startsWith("single:")) ? output : null;

  return (
    <div className="space-y-5">
      <FileBar />
      <div className="flex flex-wrap items-center justify-between gap-4 border border-line bg-white p-4">
        <div><p className="display text-2xl font-bold text-navy">{scanning || visualScanning ? "Checking your deliveries…" : `${v.clips.length} clips to review`}</p>
          <p className="text-sm text-slate">Play a clip, untick any noise, then save one highlights video. No uploads.</p></div>
        <label className="flex max-w-sm items-start gap-3 text-sm">
          <input type="checkbox" role="switch" className="mt-1 accent-[#00175f]" checked={tracking} onChange={(e) => setTracking(e.target.checked)} />
          <span><b className="block">Ball tracking + timing estimates</b><span className="text-xs text-mute">Optional and experimental. Off by default so clipping stays fast.</span></span>
        </label>
      </div>
      {scanning ? <div role="status" className="space-y-2"><p className="text-sm text-slate">Reading audio and checking impacts · {Math.round(v.audio.progress * 100)}%. You can still use the player.</p><Meter value={v.audio.progress} max={1} /></div> : null}
      {v.audio.status === "error" || v.audio.status === "none" ? <p role="alert" className="border-l-4 border-warn bg-warn/5 p-3 text-sm">{v.audio.error ?? "No readable audio. You can add clips at the playhead."}</p> : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          {v.settings.visual ? <Panel title="Full-session delivery scan">
            <p className="text-sm text-slate">Checks movement through the whole recording, then combines action candidates with audio. Can include misses and leaves; movement can also produce false clips. Use a fixed camera with the bowling action in view.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button tone="gold" disabled={busy != null || scanning || visualScanning} onClick={() => void v.scanVideo()}>{visualScanning ? `Scanning ${Math.round(v.deliveryScan.progress * 100)}%` : scanResult ? "Scan again" : "Find deliveries in video"}</Button>
              {visualScanning ? <Button tone="ghost" onClick={v.cancelScan}>Cancel scan</Button> : null}
              {scanResult ? <span className="text-sm text-slate">{coveragePercent}% decoded coverage · {v.clips.filter((c) => c.kind === "motion").length} visual-only candidates</span> : null}
            </div>
            {visualScanning ? <div role="status" className="mt-3 space-y-2"><Meter value={v.deliveryScan.progress} max={1} /><p className="text-xs text-slate">Keep this tab visible. Checking video and repairing skipped intervals. No files are uploaded.</p></div> : null}
            {scanResult && coveragePercent < 95 ? <p className="mt-3 text-sm text-warn">Some intervals were not decoded densely enough. Missing video is not proof that no delivery happened; audio clips are retained in those intervals.</p> : null}
            {v.deliveryScan.error ? <p role="alert" className="mt-3 text-sm text-warn">{v.deliveryScan.error}</p> : null}
            {!scanResult && !visualScanning ? <p className="mt-3 text-xs text-mute">Preliminary audio candidates below. Wait for the video check before exporting, or choose the faster audio-only mode.</p> : null}
          </Panel> : null}
          <Stage clip={selected} showAnalysis={tracking} />
          <Panel title="Save your highlights">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-semibold">{included.length} selected · {clock(seconds)} · one MP4</p><p className="mt-1 text-sm text-slate">Review here first. Nothing downloads until you press Save.</p></div>
              <Button tone="gold" disabled={busy != null || scanning || visualScanning || awaitingVideo || !included.length || !plan.fits} onClick={build}>{busy === "export" ? `Creating ${Math.round(progress * 100)}%` : ready ? "Rebuild highlights" : "Create highlights video"}</Button>
            </div>
            <label className="mt-4 block text-sm"><span className="label">Export quality</span>
              <select className="field" value={quality} disabled={busy != null} onChange={(e) => setQuality(e.target.value as ExportQuality)}>
                <option value="auto">Recommended — one file</option><option value="original">Original quality — faster, larger file</option><option value="compact">Smaller 720p — slower, exact cuts</option>
              </select>
            </label>
            <p className="mt-2 text-xs text-mute">{plan.reason}. Estimated size: {Math.ceil(plan.estimatedBytes / 1e6)} MB.</p>
            {!plan.fits && included.length ? <p className="mt-2 text-sm text-warn">This selection is too large for a reliable single-file export on this device. {quality === "original" ? "Choose Recommended quality or " : ""}Untick some clips. We will not split it into surprise downloads.</p> : null}
            {busy === "export" ? <div role="status" className="mt-4 space-y-2"><Meter value={progress} max={1} tone="gold" /><p className="text-xs text-slate">{progress < included.length / (included.length + 1) ? `Cutting clip ${Math.min(included.length, Math.floor(progress * (included.length + 1)) + 1)} of ${included.length}` : "Joining clips"}. Keep this tab open.{plan.precise ? " Smaller files take longer to encode." : ""}</p><Button tone="ghost" size="sm" onClick={cancel}>Cancel export</Button></div> : null}
            {saving ? <div className="mt-4 space-y-3 border-t border-line pt-4"><video src={saving.url} controls playsInline className="max-h-64 w-full bg-navy-950" /><p className="text-sm"><b>Ready:</b> {saving.name} · {(saving.blob.size / 1e6).toFixed(1)} MB</p><div className="flex flex-wrap gap-2"><Button tone="gold" disabled={busy != null} onClick={() => download(saving.blob, saving.name)}>Save video</Button>{shareable ? <Button tone="ghost" disabled={busy != null} onClick={() => run("share", async () => { await saveToPhotos(saving.blob, saving.name); })}>{isApple() ? "Save to Photos" : "Share to gallery"}</Button> : null}</div></div> : null}
            {error ? <p role="alert" className="mt-3 border-l-4 border-risk bg-risk/5 p-3 text-sm text-risk">{error}{/memory/.test(error) && quality !== "compact" ? " Try Smaller 720p or select fewer clips." : ""}</p> : null}
          </Panel>
          <Panel title="Review clips" action={<Button size="sm" tone="ghost" disabled={busy != null} onClick={() => v.select(v.addManualClip(v.playhead()).id)}>Add at playhead</Button>}>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm"><Button size="sm" tone="ghost" disabled={busy != null} onClick={() => { setSkip(new Set()); setApproved(new Set(v.clips.map((c) => c.id))); }}>Select all</Button><Button size="sm" tone="ghost" disabled={busy != null} onClick={() => setSkip(new Set(v.clips.map((c) => c.id)))}>Select none</Button>{undo ? <Button size="sm" tone="ghost" disabled={busy != null} onClick={() => { setSkip((s) => { const n = new Set(s); n.delete(undo); return n; }); setUndo(null); }}>Undo exclusion</Button> : null}</div>
            {!v.clips.length && !scanning ? <Empty title="No shots found">Try the Softer shots preset, turn off Noisy hall filtering, or add a clip at the playhead. Audio detection can miss leaves and balls without bat contact.</Empty> : null}
            <ol className="divide-y divide-line">
              {v.clips.map((c, i) => <li key={c.id} className={`flex flex-wrap items-center gap-3 py-3 ${c.id === v.selectedId ? "bg-gold/10" : ""} ${!isIncluded(c) ? "opacity-60" : ""}`}>
                <input type="checkbox" className="accent-[#00175f]" disabled={busy != null} checked={isIncluded(c)} onChange={() => toggle(c.id)} aria-label={`Include clip ${i + 1}`} />
                <button className="min-w-0 flex-1 text-left" onClick={() => play(c)}><span className="block font-semibold text-navy">Clip {String(i + 1).padStart(2, "0")}</span><span className="text-xs tabular-nums text-slate">{clock(c.start)} · {(c.end - c.start).toFixed(1)}s · {c.kind === "motion" ? "Visual candidate — verify" : c.kind === "bat" ? (c.reviewRequired ? "Unverified sound — review to include" : "Audio + action candidate") : "Added manually"}{!isIncluded(c) ? " · excluded" : ""}</span></button>
                <div className="flex flex-wrap gap-1"><Button size="sm" tone="ghost" onClick={() => play(c)}>Play</Button>{tracking ? <Button size="sm" tone="ghost" onClick={() => { v.select(c.id); router.push("/tracking"); }}>{v.analyses[c.id]?.status === "done" ? "View track" : "Track"}</Button> : null}<Button size="sm" tone="ghost" disabled={busy != null || scanning || visualScanning || awaitingVideo} onClick={() => single(c, i)}>Export clip</Button><Button size="sm" tone="ghost" disabled={busy != null || !isIncluded(c)} onClick={() => { setSkip((s) => new Set(s).add(c.id)); setUndo(c.id); }}>Not a shot</Button></div>
              </li>)}
            </ol>
          </Panel>
        </div>
        <aside className="min-w-0 space-y-5">
          <Panel title="Detection">
            <label className="mb-4 block"><span className="label">Detection mode</span><select className="field" value={v.settings.visual ? "full" : "audio"} disabled={busy != null || visualScanning} onChange={(e) => v.setSettings({ ...v.settings, visual: e.target.value === "full" })}><option value="audio">Bat contacts — fastest</option><option value="full">Full session — audio + video</option></select></label>
            {v.settings.visual ? <label className="mb-4 block"><span className="label">Visual sensitivity</span><select className="field" value={String(v.settings.motionSensitivity)} disabled={busy != null} onChange={(e) => v.setSettings({ ...v.settings, motionSensitivity: Number(e.target.value) })}><option value="0.008">More candidates</option><option value="0.012">Balanced — higher recall</option><option value="0.04">Strong actions only</option></select><span className="mt-1 block text-xs text-mute">Updates cached results without scanning again. Review visual-only clips before exporting.</span></label> : null}
            <p className="text-sm text-slate">Start with Balanced. Settings update the results without rescanning your video.</p>
            <label className="mt-3 block"><span className="label">Find shots</span><select className="field" disabled={busy != null} value={String(v.settings.threshold)} onChange={(e) => v.setSettings({ ...v.settings, threshold: Number(e.target.value) })}><option value="-25">Balanced</option><option value="-35">Softer shots — more noise</option><option value="-10">Big hits only</option>{![-25, -35, -10].includes(v.settings.threshold) ? <option value={v.settings.threshold}>Custom</option> : null}</select></label>
            <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={busy != null} checked={v.settings.noisy} onChange={(e) => v.setSettings({ ...v.settings, noisy: e.target.checked })} /><span><b>Noisy hall</b><span className="block text-xs text-mute">Rejects weaker, less sudden sounds. Fewer false clips, but can miss soft shots.</span></span></label>
            <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm font-semibold text-navy">Fine-tune detection</summary><div className={busy ? "pointer-events-none opacity-50" : ""}><Slider label="Sensitivity" value={v.settings.threshold} min={-40} max={-5} step={1} unit=" dB" onChange={(threshold) => v.setSettings({ ...v.settings, threshold })} /><Slider label="Minimum gap" value={v.settings.gap} min={1} max={10} step={0.5} unit=" s" onChange={(gap) => v.setSettings({ ...v.settings, gap })} /><Slider label="Before contact" value={v.settings.leadIn} min={0.5} max={4} step={0.1} unit=" s" onChange={(leadIn) => v.setSettings({ ...v.settings, leadIn })} /><Slider label="Clip duration" value={v.settings.length} min={1} max={15} step={0.5} unit=" s" onChange={(length) => v.setSettings({ ...v.settings, length })} /></div></details>
          </Panel>
          {tracking ? <Panel title="Optional ball analysis"><p className="text-sm text-slate">Analyze selected clips after the audio scan. This is experimental; a path is not a verified speed measurement.</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={!!trackProgress || busy != null || scanning || visualScanning || !included.length} onClick={trackSelected}>{trackProgress ?? "Analyze selected clips"}</Button>{trackProgress ? <Button size="sm" tone="ghost" onClick={() => { trackingCanceled.current = true; }}>Stop after this clip</Button> : null}</div></Panel> : null}
          <Panel title="Private by design"><p className="text-sm text-slate">Your recording stays on this device. Review and playback need no downloads. Export only when you are happy with your selection.</p><p className="mt-3 text-xs text-mute">The video engine downloads on first use and is cached when browser storage permits. Closing this tab discards the session.</p></Panel>
        </aside>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (n: number) => void }) {
  return <label className="mt-4 block text-sm"><span className="flex justify-between gap-2"><span>{label}</span><span className="tabular-nums">{value}{unit}</span></span><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[#00175f]" /></label>;
}

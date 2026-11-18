"use client";
import { SPEED_CHECK } from "@/lib/features";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Button, Meter, Panel, Tag } from "../ui";
import { TimingControl } from "./video-timing";
import { NORMAL_TIMING, timingFactor, type VideoTiming } from "@/lib/tracking/video-timing";
import type { Gray } from "@/lib/tracking/core";
import { analyzeDelivery, type DeliveryAnalysis, type ReleaseCue, type Pt } from "@/lib/speed/analyze";
import { ASSUMPTIONS, isRefusal, kmhToMph } from "@/lib/speed/measure";
import { drawOverlay, type OverlayData } from "@/lib/speed/overlay";

/**
 * Speed Check: one delivery in -> an average release-to-bat speed with its range, or a specific
 * reason it cannot be measured. Everything runs on this device.
 */
export function SpeedCheck() { return SPEED_CHECK ? <SpeedCheckTool /> : null; }

type Setup = { base: Pt | null; top: Pt | null; pitchM: number; behind: [number, number] };
type Decoded = { frames: Gray[]; pts: number[]; start: number; end: number; w: number; h: number };
type Unit = "kmh" | "mph";
const SETUP_KEY = "flipper.speedcheck.setup";
const BEHIND: Record<string, [number, number]> = { "0-2": [0, 2], "2-5": [2, 5], "5-10": [5, 10] };
const MEMORY_BYTES = 350e6;

function loadSetup(): Setup {
  try {
    const saved = JSON.parse(localStorage.getItem(SETUP_KEY) ?? "null");
    if (saved && typeof saved.pitchM === "number") return saved;
  } catch { /* storage unavailable */ }
  return { base: null, top: null, pitchM: 20.12, behind: [2, 5] };
}

function SpeedCheckTool() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [timing, setTiming] = useState<VideoTiming>(NORMAL_TIMING);
  const factor = timingFactor(timing);
  const [setup, setSetupState] = useState<Setup>({ base: null, top: null, pitchM: 20.12, behind: [2, 5] });
  // Remembered per device (a convenience only); written on change, read when a video is chosen.
  const setSetup = (fn: (s: Setup) => Setup) => setSetupState((s) => {
    const next = fn(s);
    try { localStorage.setItem(SETUP_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  const [tap, setTap] = useState<null | "base" | "top" | "ball">(null);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<{ a: DeliveryAnalysis; w: number; h: number; cue: ReleaseCue | null } | null>(null);
  const [timeline, setTimeline] = useState<number[]>([]);
  const [unit, setUnit] = useState<Unit>("kmh");
  const [exported, setExported] = useState<{ url: string; name: string; audioKept: boolean } | null>(null);
  const player = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const job = useRef<AbortController | null>(null);
  const cache = useRef<{ decoded: Decoded | null; sounds: { t: number; rel: number }[] | null }>({ decoded: null, sounds: null });

  useEffect(() => () => { job.current?.abort(); }, []);
  // Development only: ?sample=<name> opens public/dev-samples/<name> (gitignored) for smoke tests.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const name = new URLSearchParams(location.search).get("sample");
    if (!name || !/^[\w.-]+$/.test(name)) return;
    let live = true;
    void fetch(`/dev-samples/${name}`).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (live && b) choose(new File([b], name, { type: b.type || "video/mp4" })); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on load
  }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { if (exported) URL.revokeObjectURL(exported.url); }, [exported]);

  const overlay = useMemo<OverlayData | null>(() => {
    if (!analysis) return null;
    const { a, w, h } = analysis;
    const r = a.result;
    const norm = (p: { pts: number; x: number; y: number; observed: boolean }) => ({ pts: p.pts, x: p.x / w, y: p.y / h, observed: p.observed });
    const val = (k: number) => Math.round(unit === "kmh" ? k : kmhToMph(k));
    const u = unit === "kmh" ? "km/h" : "mph";
    return {
      points: a.points.map(norm), bounce: a.bounce ? norm(a.bounce) : null,
      releasePts: a.release?.firstFreePts ?? null, endPts: a.points.length ? a.points[a.points.length - 1].pts : null,
      measured: !isRefusal(r),
      title: isRefusal(r) ? "Unable to measure reliably" : `${val(r.kmh)} ${u}`,
      subtitle: isRefusal(r) ? "Ball path shown only where it was seen" : `Average speed, release to bat · range ${val(r.low)}-${val(r.high)} ${u} · not release speed`,
    };
  }, [analysis, unit]);

  // Redraw the overlay (and calibration marks) for the frame on screen.
  const redraw = useCallback(() => {
    const c = canvas.current, v = player.current;
    if (!c || !v || !size) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    if (c.width !== size.w || c.height !== size.h) { c.width = size.w; c.height = size.h; }
    ctx.clearRect(0, 0, c.width, c.height);
    if (overlay) drawOverlay(ctx, c.width, c.height, overlay, v.currentTime);
    const mark = (p: Pt | null, label: string) => {
      if (!p) return;
      const x = p.x * c.width, y = p.y * c.height, s = Math.max(c.width, c.height) / 1280;
      ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.moveTo(x - 10 * s, y); ctx.lineTo(x + 10 * s, y); ctx.moveTo(x, y - 10 * s); ctx.lineTo(x, y + 10 * s); ctx.stroke();
      ctx.fillStyle = "#4ade80"; ctx.font = `600 ${Math.round(12 * s)}px system-ui`; ctx.fillText(label, x + 12 * s, y - 4 * s);
    };
    if (!overlay || tap === "base" || tap === "top") { mark(setup.base, "stumps base"); mark(setup.top, "stumps top"); }
  }, [overlay, size, setup.base, setup.top, tap]);

  useEffect(() => {
    const v = player.current;
    if (!v) return;
    let handle = 0, raf = 0;
    const tick = () => { redraw(); if ("requestVideoFrameCallback" in v) handle = v.requestVideoFrameCallback(tick); else raf = requestAnimationFrame(tick); };
    tick();
    v.addEventListener("seeked", redraw);
    return () => { v.removeEventListener("seeked", redraw); if (handle) v.cancelVideoFrameCallback(handle); cancelAnimationFrame(raf); };
  }, [redraw, url]);

  function choose(source?: File) {
    if (!source) return;
    job.current?.abort();
    cache.current = { decoded: null, sounds: null };
    setFile(source); setUrl(URL.createObjectURL(source)); setAnalysis(null); setError(null); setExported(null); setSize(null); setTimeline([]);
    const saved = setup.base && setup.top ? setup : loadSetup();
    setSetupState(saved);
    setTap(saved.base && saved.top ? null : "base");
  }

  function onTap(e: PointerEvent<HTMLDivElement>) {
    if (!tap || !player.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    if (tap === "base") { setSetup((s) => ({ ...s, base: p })); setTap("top"); }
    else if (tap === "top") { setSetup((s) => ({ ...s, top: p })); setTap(null); }
    else if (tap === "ball" && file && factor != null) {
      setTap(null);
      void run(file, { t: player.current.currentTime / factor, x: p.x, y: p.y, source: "manual" });
    }
    redraw();
  }

  /** Decodes (or reuses) the analysis window around `centre` (video seconds). */
  async function framesAround(source: File, centre: number, f: number, signal: AbortSignal, times: number[]): Promise<Decoded> {
    const start = Math.max(0, centre - 0.45 * f), end = centre + 1.7 * f;
    const c = cache.current.decoded;
    if (c && c.start <= start + 1e-3 && c.end >= end - 1e-3) return c;
    const { inspectRecording, flightFrames } = await import("@/lib/video/native-decode");
    const info = await inspectRecording(source, signal);
    const count = Math.max(1, times.filter((t) => t >= start && t <= end).length);
    const aspect = Math.max(info.width, info.height) / Math.max(1, Math.min(info.width, info.height));
    const longSide = Math.min(1280, Math.floor(Math.sqrt((MEMORY_BYTES / count) * aspect)));
    if (longSide < 480) throw new Error("This clip has too many frames to analyse on this device. Trim it closer to the delivery.");
    setStatus("Reading the delivery frames");
    const d = await flightFrames(source, start, Math.min(info.duration, end), signal, (p) => setProgress(0.4 + 0.3 * p), longSide, count + 10);
    if (d.frames.length < 5) throw new Error("Too few frames could be decoded around the release.");
    const out = { frames: d.frames, pts: d.times, start, end, w: d.frames[0].w, h: d.frames[0].h };
    cache.current.decoded = out;
    return out;
  }

  async function run(source: File, manualCue?: ReleaseCue, contactFrames?: [number, number]) {
    job.current?.abort();
    const controller = new AbortController(); job.current = controller;
    const signal = controller.signal;
    setError(null); setExported(null); setProgress(0); setStatus("Reading frame timestamps");
    try {
      if (factor == null) throw new Error("Real elapsed time is unknown for this recording. Choose normal speed, or enter the slow-motion settings.");
      if (!setup.base || !setup.top) throw new Error("Mark the base and top of the batter's stumps first.");
      const { frameTimeline } = await import("@/lib/video/native-decode");
      const times = timeline.length ? timeline : await frameTimeline(source, signal, 15 * factor);
      setTimeline(times);
      // 1. Release cue: the bowling arm-whip from pose, or the user's tap.
      let cueVideo: { t: number; x: number; y: number; source: "pose" | "manual" } | null = manualCue ? { ...manualCue, t: manualCue.t * factor } : null;
      if (!cueVideo) {
        setStatus("Finding the bowling action");
        const { scanPoses } = await import("@/lib/video/pose-scan");
        const poses = await scanPoses(source, signal, (p) => setProgress(0.05 + 0.3 * p), factor, 30);
        const whips = poses.events.filter((e) => e.kind !== "follow-through").sort((a, b) => b.confidence - a.confidence);
        const e = whips[0];
        if (e) {
          const wrist = e.joints[e.arm === "left" ? 4 : 5];
          cueVideo = { t: e.t, x: wrist.x, y: wrist.y, source: "pose" };
        }
      }
      if (signal.aborted) return;
      // 2. Frames around the release, at up to 1280 px (the ball is only a few pixels at the far end).
      const centre = cueVideo?.t ?? times[Math.floor(times.length / 3)];
      const d = await framesAround(source, centre, factor, signal, times);
      if (signal.aborted) return;
      // 3. Impact sounds (normal-speed footage only).
      if (!cache.current.sounds) {
        setStatus("Listening for bat contact");
        try {
          const { nativeAudio } = await import("@/lib/video/native-decode");
          const { findImpacts, refineContact, selectSounds, pickShots } = await import("@/lib/tracking/hits");
          const audio = await nativeAudio(source, signal, (p) => setProgress(0.7 + 0.15 * p), 15 * factor);
          const impacts = (await findImpacts(audio.pcm, audio.sampleRate)).filter((x) => x.riseDb > 10)
            .map((x) => ({ ...x, t: refineContact(audio.pcm, audio.sampleRate, x.t) }));
          cache.current.sounds = pickShots(selectSounds(impacts), -25, 0.25).map((s) => ({ t: s.t, rel: s.rel }));
        } catch (err) {
          if (signal.aborted) return;
          cache.current.sounds = []; // no readable audio: contact must be marked on the video
          console.warn(err);
        }
      }
      if (signal.aborted) return;
      setStatus("Following the ball"); setProgress(0.88);
      await new Promise((r) => setTimeout(r, 0));
      const cue: ReleaseCue | null = cueVideo ? { t: cueVideo.t / factor, x: cueVideo.x * d.w, y: cueVideo.y * d.h, source: cueVideo.source } : null;
      const input = {
        frames: d.frames, pts: d.pts, slowFactor: factor,
        farStumps: { base: { x: setup.base.x * d.w, y: setup.base.y * d.h }, top: { x: setup.top.x * d.w, y: setup.top.y * d.h } },
        release: cue, sounds: cache.current.sounds ?? [], contactFrames: contactFrames ?? null,
        calibration: { pitchM: setup.pitchM, cameraBehindM: setup.behind },
      };
      let a = analyzeDelivery(input);
      // 4. Confirm the release with the bowler's wrist in the two frames around it.
      if (a.release && cue?.source === "pose") {
        setStatus("Checking the ball leaves the hand");
        try {
          const { posesAt } = await import("@/lib/video/pose-scan");
          const res = await posesAt(source, [a.release.prevPts, a.release.firstFreePts], signal);
          const at = (t: number) => res.frames.find((f) => Math.abs(f.t - t) < 0.004);
          const wr = (t: number) => (at(t)?.people ?? []).flatMap((p) => p.wrists.filter((w) => w.visibility > 0.4).map((w) => ({ x: w.x * d.w, y: w.y * d.h })));
          const torso = Math.max(0, ...(at(a.release.prevPts)?.people ?? []).map((p) => p.torso * d.h));
          a = analyzeDelivery({ ...input, releaseConfirmation: { before: wr(a.release.prevPts), at: wr(a.release.firstFreePts), torsoPx: torso } });
        } catch (err) { if (signal.aborted) return; console.warn(err); }
      }
      if (signal.aborted) return;
      setAnalysis({ a, w: d.w, h: d.h, cue });
      setProgress(1);
      if (player.current && a.release) { player.current.pause(); player.current.currentTime = a.release.firstFreePts; }
    } catch (err) {
      if (!signal.aborted) setError(err instanceof Error ? err.message : "Could not analyse this clip.");
    } finally { if (job.current === controller) setStatus(""); }
  }

  function go(t: number | null | undefined) { if (t != null && player.current) { player.current.pause(); player.current.currentTime = t + 1e-4; } }
  function step(dir: -1 | 1) {
    const v = player.current;
    if (!v || !timeline.length) return;
    const i = timeline.findIndex((t) => t > v.currentTime + 1e-3) - 1;
    const cur = i < 0 ? (v.currentTime >= timeline[timeline.length - 1] ? timeline.length - 1 : 0) : i;
    go(timeline[Math.max(0, Math.min(timeline.length - 1, cur + dir))]);
  }
  function markContact() {
    const v = player.current;
    if (!v || !file || !timeline.length) return;
    const i = Math.max(1, timeline.findIndex((t) => t > v.currentTime + 1e-3) - 1);
    void run(file, analysis?.cue ? { ...analysis.cue, x: analysis.cue.x / analysis.w, y: analysis.cue.y / analysis.h } : undefined, [timeline[i - 1], timeline[i]]);
  }
  async function doExport() {
    if (!file || !overlay) return;
    job.current?.abort();
    const controller = new AbortController(); job.current = controller;
    setError(null); setStatus("Exporting MP4 with overlay"); setProgress(0);
    try {
      const { exportOverlayMp4 } = await import("@/lib/speed/export");
      const { blob, audioKept } = await exportOverlayMp4(file, overlay, setProgress, controller.signal);
      setExported({ url: URL.createObjectURL(blob), name: file.name.replace(/\.[^.]+$/, "") + "-speed-check.mp4", audioKept });
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Export failed.");
    } finally { if (job.current === controller) setStatus(""); }
  }

  const a = analysis?.a;
  const r = a?.result;
  const busy = !!status;
  const val = (k: number) => Math.round(unit === "kmh" ? k : kmhToMph(k));
  const u = unit === "kmh" ? "km/h" : "mph";
  const stage = !file ? 0 : !setup.base || !setup.top ? 1 : !a ? 2 : exported ? 4 : 3;

  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-2 text-xs font-semibold" aria-label="Steps">
        {["Upload delivery", "Mark stumps", "Analyze", "Review", "Export"].map((label, i) => <li key={label} className={`rounded-md border px-2 py-1 ${i === stage ? "border-navy bg-navy text-white" : i < stage ? "border-navy/30 text-navy" : "border-line text-mute"}`}>{i + 1}. {label}</li>)}
      </ol>
      <Panel title="One delivery">
        <p className="mb-3 text-sm text-slate">Camera behind the bowler, both ends in view, up to 15 seconds. 60 fps or more helps. The video never leaves this device.</p>
        <label className="block"><span className="label">Choose delivery video</span><input aria-label="Choose delivery video" type="file" accept="video/mp4,video/quicktime,video/webm" disabled={busy} onChange={(e) => choose(e.target.files?.[0])} className="field" /></label>
      </Panel>
      {url ? <div className="relative mx-auto w-full overflow-hidden bg-navy-950" style={{ aspectRatio: size ? `${size.w} / ${size.h}` : "9 / 16", maxHeight: "70vh", maxWidth: size ? `calc(70vh * ${size.w / size.h})` : undefined }}>
        <video ref={player} src={url} playsInline muted={false} controls={!tap} preload="auto" className="absolute inset-0 h-full w-full"
          onLoadedMetadata={(e) => { const v = e.currentTarget; setSize({ w: v.videoWidth, h: v.videoHeight }); }} />
        <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
        {tap ? <div role="button" aria-label="Tap position" tabIndex={0} onPointerDown={onTap} className="absolute inset-0 cursor-crosshair" /> : null}
      </div> : null}
      {tap ? <p role="status" className="border-l-4 border-gold bg-gold/10 p-3 text-sm">{tap === "base" ? "Tap the BASE of the batter's (far) stumps." : tap === "top" ? "Now tap the TOP of the same stumps." : "Tap the ball in this frame (it must have just left the hand)."}</p> : null}
      {url ? <div className="flex flex-wrap gap-2">
        <Button size="sm" tone="ghost" disabled={!timeline.length} onClick={() => step(-1)}>◀ Frame</Button>
        <Button size="sm" tone="ghost" disabled={!timeline.length} onClick={() => step(1)}>Frame ▶</Button>
        <Button size="sm" tone="ghost" disabled={!a?.release} onClick={() => go(a?.release?.firstFreePts)}>Release</Button>
        <Button size="sm" tone="ghost" disabled={!a?.points.length} onClick={() => go(a?.points[a.points.length - 1]?.pts)}>Last seen</Button>
        <Button size="sm" tone="ghost" disabled={busy} onClick={() => setTap("base")}>Re-mark stumps</Button>
      </div> : null}
      {status ? <Panel><p role="status" className="mb-3 text-sm">{status} · {Math.round(progress * 100)}%</p><Meter value={progress} max={1} /><Button size="sm" tone="ghost" className="mt-3" onClick={() => { job.current?.abort(); setStatus(""); }}>Cancel</Button></Panel> : null}
      {error ? <p role="alert" className="border-l-4 border-warn bg-warn/5 p-4 text-sm">{error}</p> : null}
    </div>
    <aside className="space-y-5">
      <Panel title="Speed" action={<div className="flex gap-1">{(["kmh", "mph"] as const).map((x) => <Button key={x} size="sm" tone={unit === x ? "navy" : "ghost"} onClick={() => setUnit(x)}>{x === "kmh" ? "km/h" : "mph"}</Button>)}</div>}>
        {!r ? <p className="text-sm text-slate">Mark the stumps, then Analyze. A delivery that cannot be measured gets a reason, not a guessed number.</p>
          : isRefusal(r) ? <><p className="text-xl font-bold text-navy">Unable to measure reliably</p><p className="mt-2 text-sm">{r.reason}</p></>
          : <>
            <p className="text-xs uppercase tracking-wide text-mute">Average speed, release to bat</p>
            <p className="display mt-2 text-6xl font-extrabold text-navy">{val(r.kmh)}<span className="ml-2 text-xl">{u}</span></p>
            <p className="mt-2 text-sm">Range {val(r.low)}–{val(r.high)} {u}. This is not release (radar) speed, which would be higher.</p>
            <p className="mt-3 text-xs text-mute">Measured: ball flight of {r.flightSeconds[0].toFixed(3)}–{r.flightSeconds[1].toFixed(3)} s between release and the bat-contact {a?.contact?.kind === "frame" ? "frame you marked" : `sound (minus ${Math.round(r.acousticDelayS[0] * 1000)}–${Math.round(r.acousticDelayS[1] * 1000)} ms for sound travel)`}. Assumed: {r.distanceM[0].toFixed(1)}–{r.distanceM[1].toFixed(1)} m between release and contact — your {setup.pitchM.toFixed(2)} m stumps-to-stumps, minus release {ASSUMPTIONS.releaseAheadM.join("–")} m and contact {ASSUMPTIONS.contactAheadM.join("–")} m in front of the stumps. The range covers these tolerances, not a wrong track.</p>
          </>}
        {a ? <ul className="mt-4 space-y-1 text-xs">{a.checks.map((c) => <li key={c.id} className="flex gap-2"><Tag tone={c.ok ? "ok" : "risk"}>{c.ok ? "OK" : "No"}</Tag><span><b>{c.label}:</b> {c.detail}</span></li>)}</ul> : null}
        {a?.points.length ? <p className="mt-3 text-xs text-mute">{a.points.filter((p) => p.observed).length} frames with the ball seen{a.points.some((p) => !p.observed) ? `, ${a.points.filter((p) => !p.observed).length} predicted (hollow rings)` : ", none predicted"}.</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={!file || busy || !setup.base || !setup.top} onClick={() => file && void run(file)}>{a ? "Analyze again" : "Analyze"}</Button>
          {a ? <Button tone="ghost" disabled={busy} onClick={() => setTap("ball")}>Mark release ball</Button> : null}
          {a?.release ? <Button tone="ghost" disabled={busy} onClick={markContact}>Bat contact is here</Button> : null}
        </div>
        {a ? <p className="mt-2 text-xs text-mute">Optional fixes: step to the first frame after the ball leaves the hand and use Mark release ball; or step to the first frame after bat contact and use Bat contact is here.</p> : null}
      </Panel>
      {a ? <Panel title="Export">
        <p className="mb-3 text-sm text-slate">One MP4 with the same overlay and label as the review, original sound kept.</p>
        <Button disabled={busy} onClick={() => void doExport()}>Export MP4</Button>
        {exported ? <p className="mt-3 text-sm"><a className="font-bold underline" href={exported.url} download={exported.name}>Save {exported.name}</a>{exported.audioKept ? "" : " (this browser could not keep the audio)"}</p> : null}
      </Panel> : null}
      <Panel title="Your setup">
        <TimingControl value={timing} disabled={busy} onChange={(t) => { setTiming(t); setAnalysis(null); cache.current = { decoded: null, sounds: null }; setTimeline([]); }} />
        <label className="mt-4 block text-sm">Stumps to stumps
          <select className="field mt-1" disabled={busy} value={setup.pitchM === 20.12 ? "full" : "custom"} onChange={(e) => setSetup((s) => ({ ...s, pitchM: e.target.value === "full" ? 20.12 : 18 }))}>
            <option value="full">Full pitch, 22 yards (20.12 m)</option><option value="custom">Different length (enter below)</option>
          </select></label>
        {setup.pitchM !== 20.12 ? <label className="mt-2 block text-sm">Measured distance (m)<input className="field mt-1" type="number" min="10" max="22" step="0.01" disabled={busy} value={setup.pitchM} onChange={(e) => setSetup((s) => ({ ...s, pitchM: Number(e.target.value) }))} /></label> : null}
        <label className="mt-4 block text-sm">Camera behind the bowler&apos;s stumps
          <select className="field mt-1" disabled={busy} value={Object.keys(BEHIND).find((k) => BEHIND[k][0] === setup.behind[0]) ?? "2-5"} onChange={(e) => setSetup((s) => ({ ...s, behind: BEHIND[e.target.value] }))}>
            <option value="0-2">0–2 m</option><option value="2-5">2–5 m</option><option value="5-10">5–10 m</option>
          </select></label>
        <p className="mt-3 text-xs text-mute">Nets are often shorter than a full pitch: measure stumps to stumps once. These settings are remembered on this device.</p>
      </Panel>
    </aside>
  </div>;
}

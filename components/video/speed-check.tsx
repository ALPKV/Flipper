"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Meter, Panel } from "../ui";
import { estimateSpeed } from "@/lib/tracking/speed-estimate";
import { PITCH_M, CREASE_M, CREASE_TO_CREASE_M } from "@/lib/tracking/metrics";

type Evidence = { release: number | null; contact: number | null; visualContact: boolean; frameSeconds: number; points: number; timestamps: number[]; note: string };

export function SpeedCheck() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [distance, setDistance] = useState(CREASE_TO_CREASE_M);
  const [behind, setBehind] = useState(4);
  const [reviewed, setReviewed] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const job = useRef<AbortController | null>(null);
  useEffect(() => () => { job.current?.abort(); }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const result = evidence?.release != null && evidence.contact != null ? estimateSpeed({ ...evidence, release: evidence.release, contact: evidence.contact, distanceM: distance, distanceErrorM: .5,
    soundDistanceM: evidence.visualContact ? 0 : behind + PITCH_M - CREASE_M }) : null;

  async function run(source: File) {
    job.current?.abort();
    const controller = new AbortController(); job.current = controller;
    setEvidence(null); setError(null); setReviewed(false); setStatus("Reading the delivery"); setProgress(0);
    try {
      const { nativeAudio, flightFrames, frameTimeline } = await import("@/lib/video/native-decode");
      const { findImpacts, selectSounds, pickShots, refineContact } = await import("@/lib/tracking/hits");
      const timeline = await frameTimeline(source, controller.signal);
      if (controller.signal.aborted) return;
      const deltas = timeline.slice(1).map((t,i)=>t-timeline[i]).sort((a,b)=>a-b);
      const frameStep = deltas[Math.floor(deltas.length/2)];
      if (!frameStep) throw new Error("No usable video timestamps.");
      setEvidence({ release: null, contact: null, visualContact: true, frameSeconds: frameStep, points: 0, timestamps: timeline,
        note: "Automatic detection is a first pass. You can step through the exact frames and mark release and bat contact here." });
      const audio = await nativeAudio(source, controller.signal, p => setProgress(p * .2), 15);
      if (audio.duration > 15) throw new Error("Upload one delivery, up to 15 seconds. Use Clip Farmer for a full session.");
      setStatus("Finding bat contact");
      const impacts = (await findImpacts(audio.pcm, audio.sampleRate)).filter(e => e.riseDb > 10)
        .map(e => ({ ...e, t: refineContact(audio.pcm, audio.sampleRate, e.t) }));
      const contacts = pickShots(selectSounds(impacts), -10, 2).sort((a, b) => b.rel - a.rel);
      if (!contacts.length) throw new Error("No clear bat contact found. Use a normal-speed clip with the release, bounce and bat contact visible and audible.");
      if (contacts.length > 1 && contacts[0].rel - contacts[1].rel < 3) throw new Error("Several equally strong impacts were found. Trim to one delivery with a clear bat contact.");
      if (controller.signal.aborted) return;
      const contact = contacts[0].t;
      // The microphone hears contact after light reaches the camera. Stop tracking at visual contact,
      // otherwise the struck ball or moving bat can contaminate the incoming flight.
      const visualContact = contact - (behind + PITCH_M - CREASE_M) / 343;
      setStatus("Following the incoming ball");
      const decoded = await flightFrames(source, Math.max(0, visualContact - 1.6), Math.min(audio.duration, visualContact + .08),
        controller.signal, p => setProgress(.3 + p * .65));
      if (controller.signal.aborted) return;
      const { analyzeFrames } = await import("@/lib/tracking/analyze");
      const tracked = analyzeFrames(decoded.frames, decoded.times, visualContact);
      const flightDeltas = decoded.times.slice(1).map((t, i) => t - decoded.times[i]).sort((a, b) => a - b);
      const frameSeconds = flightDeltas[Math.floor(flightDeltas.length / 2)];
      const points = tracked.points;
      if (tracked.release == null || points.length < 8 || !tracked.bounce || !frameSeconds || frameSeconds > 1/24)
        throw new Error("The incoming flight could not be measured reliably. Use the frame controls below to mark release and contact. A new recording at 60 fps or higher will help automatic tracking.");
      if (points.some((p, i) => i > 0 && p.t - points[i - 1].t > 3.1 * frameSeconds))
        throw new Error("The ball disappears for too many frames. Try a clearer delivery.");
      const value = { release: tracked.release, contact, visualContact: false, frameSeconds, points: points.length, timestamps: timeline,
        note: "Release is the earliest ball frame the detector found. Check that it is the actual release; a late first sighting inflates speed." };
      if (!estimateSpeed({ ...value, distanceM: distance, distanceErrorM: .5, soundDistanceM: behind + PITCH_M - CREASE_M }))
        throw new Error("The timings do not describe a plausible delivery. Check the distance and use footage that plays at real speed.");
      setEvidence(value); setProgress(1);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not measure this clip.");
    } finally { if (job.current === controller) setStatus(""); }
  }

  function choose(source?: File) {
    if (!source) return;
    setFile(source); setUrl(URL.createObjectURL(source)); void run(source);
  }
  function go(t: number | null) { if (t != null && player.current) { player.current.pause(); player.current.currentTime = Math.max(0, t); } }
  function step(direction: -1 | 1) {
    if (!player.current || !evidence) return;
    const frames = evidence.timestamps;
    let i = frames.findIndex(t=>t > player.current!.currentTime + .0001)-1;
    if (i < 0) i = player.current.currentTime >= frames.at(-1)! ? frames.length-1 : 0;
    go(frames[Math.max(0,Math.min(frames.length-1,i+direction))]+.00001);
  }
  function mark(which: "release" | "contact") {
    if (!player.current || !evidence) return;
    setEvidence({ ...evidence, [which]: player.current.currentTime, ...(which === "contact" ? { visualContact: true } : {}) });
    setReviewed(false);
  }

  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
    <div className="space-y-5">
      <Panel title="One delivery in. One speed estimate out.">
        <p className="mb-3 text-sm text-slate">Upload a normal-speed MP4 or MOV, up to 15 seconds. Camera behind the bowler; release, bounce and batter visible. 60–240 fps preferred. Your video stays on this device.</p>
        <label className="block"><span className="label">Choose delivery video</span><input aria-label="Choose delivery video" type="file" accept="video/mp4,video/quicktime,video/webm" onChange={e => choose(e.target.files?.[0])} className="field" /></label>
        {file ? <p className="mt-2 text-xs text-mute">{file.name}</p> : null}
      </Panel>
      {url ? <video ref={player} src={url} controls playsInline className="max-h-[65vh] w-full bg-navy-950" /> : null}
      {status ? <Panel><p role="status" className="mb-3 text-sm">{status} · {Math.round(progress * 100)}%</p><Meter value={progress} max={1} /><Button size="sm" tone="ghost" className="mt-3" onClick={() => { job.current?.abort(); setStatus(""); }}>Cancel</Button></Panel> : null}
      {error ? <p role="alert" className="border-l-4 border-warn bg-warn/5 p-4 text-sm">{error}</p> : null}
      {evidence ? <Panel title="Check the two moments">
        <p className="mb-3 text-sm text-slate">{evidence.note}</p><p className="mb-3 text-xs tabular-nums">Release: {evidence.release != null ? `${evidence.release.toFixed(3)}s` : "not set"} · Contact: {evidence.contact != null ? `${evidence.contact.toFixed(3)}s` : "not set"}{evidence.visualContact ? " · video frame" : " · sound, delay corrected"}</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" tone="ghost" disabled={evidence.release == null} onClick={() => go(evidence.release)}>Show release</Button><Button size="sm" tone="ghost" disabled={evidence.contact == null} onClick={() => evidence.contact != null && go(evidence.contact - (evidence.visualContact ? 0 : (behind + PITCH_M - CREASE_M)/343))}>Show contact</Button>
          <Button size="sm" tone="ghost" onClick={() => step(-1)}>Previous frame</Button><Button size="sm" tone="ghost" onClick={() => step(1)}>Next frame</Button></div>
        <div className="mt-4 flex gap-2"><Button size="sm" onClick={() => mark("release")}>Release is here</Button><Button size="sm" onClick={() => mark("contact")}>Contact is here</Button></div>
        <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" disabled={!result} checked={reviewed} onChange={e=>setReviewed(e.target.checked)} />I checked release, contact, distance and normal playback speed.</label>
      </Panel> : null}
    </div>
    <aside className="space-y-5">
      <Panel title="Speed">
        <p className="text-xs uppercase tracking-wide text-mute">Average flight speed · {reviewed ? "timings reviewed" : "unverified estimate"}</p>
        <p className="display mt-3 text-6xl font-extrabold text-navy">{result ? Math.round(result.kmh) : "—"}<span className="ml-2 text-xl">km/h</span></p>
        {result ? <><p className="mt-2 text-sm">Input-tolerance range: {Math.floor(result.low)}–{Math.ceil(result.high)} km/h</p><p className="mt-2 text-xs text-mute">{evidence?.points ? `${evidence.points} tracked frames` : "Frame-marked timing"} · flight {result.flightSeconds.toFixed(3)}s · sound delay {Math.round(result.acousticDelay*1000)}ms. Range assumes ±0.5m and ±1 frame at each event; it does not cover a wrong track or release.</p></> : <p className="mt-3 text-sm text-slate">Upload a clear delivery to start. A failed measurement produces an explanation, not a guessed number.</p>}
      </Panel>
      <Panel title="Your camera setup">
        <label className="block text-sm">Release-to-contact distance (m)<input className="field mt-1" type="number" min="5" max="30" step="0.1" disabled={!!status} value={distance} onChange={e=> { setDistance(Number(e.target.value)); setReviewed(false); }} /></label>
        <p className="mt-2 text-xs text-mute">17.68m is a starting assumption, not a measured distance. Change it for the actual hand release and contact positions.</p>
        <label className="mt-4 block text-sm">Camera behind bowler&apos;s stumps (m)<input className="field mt-1" type="number" min="0" max="15" step="0.5" value={behind} disabled={!!status} onChange={e=> { setBehind(Number(e.target.value)); setEvidence(null); setReviewed(false); }} /></label>
        {file ? <Button className="mt-4" disabled={!!status} onClick={()=>void run(file)}>Measure again</Button> : null}
      </Panel>
      <p className="text-xs text-mute">This is a calibrated timing estimate, not a validated radar gun or professional release-speed measurement. Slow-motion exports, occlusion and late ball detection can invalidate it.</p>
    </aside>
  </div>;
}

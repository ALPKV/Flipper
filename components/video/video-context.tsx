"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { BallAnalysis } from "@/lib/tracking/analyze";
import { coverage, type ScanResult } from "@/lib/tracking/visual-deliveries";
import { type DeliveryCategory } from "@/lib/tracking/pose-actions";
import { NORMAL_TIMING, timingFactor, type VideoTiming } from "@/lib/tracking/video-timing";
import { clipWindows, deliveryId, type Delivery } from "@/lib/tracking/deliveries";
import { soundEvents, type Sound } from "@/lib/tracking/hits";
import { DEFAULT_SETUP, lengthM, lineCm, speedKmh, type Setup } from "@/lib/tracking/metrics";
import { extractAudio, releaseEngine } from "@/lib/video/ffmpeg";
import { captureFrames } from "@/lib/video/frames";

/**
 * The loaded video and everything derived from it, shared by the Highlights and Ball Tracking
 * tabs so switching tabs keeps your work. Nothing here leaves the browser, and all of it is dropped
 * (and the video engine shut down) when the video is removed or the tab closes.
 */

export type ClipSettings = {
  /** How loud a sound must be to make a clip, in dB below the session's big hits (0 = only the loudest). */
  threshold: number;
  timing: VideoTiming;
  noisy: boolean;
  visual: boolean;
  motionSensitivity: number;
  /** After a clip, sounds within this many seconds are skipped (back-to-back noise from the same ball). */
  gap: number;
  offset:number;
  leadIn: number;
  length: number;
};

export type Clip = {
  id: string;
  start: number;
  end: number;
  /** Bat contact from the sound; null for clips added by hand. */
  contact: number | null;
  /** Sound strength against the session's big hits, in dB. */
  level: number | null;
  kind: "bat" | "motion" | "manual";
  manual: boolean;
  anchor?:number;
  reviewRequired?: boolean;
  category?: DeliveryCategory;
  poseConfidence?: number;
};

export type MarkKey = "release" | "bounce" | "contact";
export type Marks = Record<MarkKey, { t: number | null; source: "auto" | "manual" | null }>;

export type AnalysisState = {
  status: "idle" | "running" | "done" | "error";
  progress: number;
  result: BallAnalysis | null;
  error: string | null;
};

export type TrackingSetup = Setup & { stumps: { leftX: number; rightX: number } | null };

type AudioState = { status: "idle" | "loading" | "ready" | "error" | "none"; progress: number; error: string | null };
type DeliveryScan = { status: "idle" | "running" | "done" | "error"; progress: number; result: ScanResult | null; error: string | null; phase?: string };
const EMPTY_SCAN: DeliveryScan = { status: "idle", progress: 0, result: null, error: null };

type Ctx = {
  file: File | null;
  url: string | null;
  meta: { duration: number; width: number; height: number } | null;
  loadFile: (f: File) => void;
  clearFile: () => void;
  audio: AudioState;
  deliveryScan: DeliveryScan;
  scanVideo: () => Promise<void>;
  cancelScan: () => void;
  settings: ClipSettings;
  setSettings: (s: ClipSettings) => void;
  clips: Clip[];
  addManualClip: (time: number) => Clip;
  removeClip: (id: string) => void;
  selectedId: string | null;
  select: (id: string | null) => void;
  analyses: Record<string, AnalysisState>;
  analyze: (clip: Clip) => Promise<void>;
  marks: Record<string, Marks>;
  setMark: (clipId: string, key: MarkKey, t: number | null) => void;
  setup: TrackingSetup;
  setSetup: (s: TrackingSetup) => void;
  overlay: boolean;
  setOverlay: (on: boolean) => void;
  /** Shared <video> element of the visible stage, for seeking from lists. */
  playerRef: React.RefObject<HTMLVideoElement | null>;
  /** Moves the visible player to `t` seconds (and plays from there if asked). */
  seek: (t: number, play?: boolean) => void;
  /** Current playhead of the visible player, in seconds. */
  playhead: () => number;
};

const VideoCtx = createContext<Ctx | null>(null);

export function useVideo(): Ctx {
  const v = useContext(VideoCtx);
  if (!v) throw new Error("useVideo outside VideoProvider");
  return v;
}

const DEFAULT_SETTINGS: ClipSettings = { timing: NORMAL_TIMING, threshold: -120, noisy: false, visual: false, motionSensitivity: .012, gap: 3, offset:0, leadIn: 1.5, length: 5 };
const DEFAULT_TRACKING: TrackingSetup = { ...DEFAULT_SETUP, stumps: null };

const emptyMarks = (): Marks => ({
  release: { t: null, source: null },
  bounce: { t: null, source: null },
  contact: { t: null, source: null },
});

function loadSetup(): TrackingSetup {
  try {
    const raw = localStorage.getItem("flipper.trackingSetup");
    if (raw) return { ...DEFAULT_TRACKING, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_TRACKING;
}

export function VideoProvider({ children }: { children: React.ReactNode }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<Ctx["meta"]>(null);
  const [audio, setAudio] = useState<AudioState>({ status: "idle", progress: 0, error: null });
  const [sounds, setSounds] = useState<Sound[] | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [settings, setSettingsState] = useState<ClipSettings>(DEFAULT_SETTINGS);
  const [manual, setManual] = useState<Clip[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [selectedId, select] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisState>>({});
  const [marks, setMarks] = useState<Record<string, Marks>>({});
  const [setup, setSetupState] = useState<TrackingSetup>(DEFAULT_TRACKING);
  const [overlay, setOverlay] = useState(true);
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const loadToken = useRef(0);
  const scanner = useRef<Worker | null>(null);
  const audioAbort = useRef<AbortController | null>(null);
  const scanController = useRef<AbortController | null>(null);
  const [deliveryScan, setDeliveryScan] = useState<DeliveryScan>(EMPTY_SCAN);

  useEffect(() => setSetupState(loadSetup()), []);
  useEffect(() => () => { scanner.current?.terminate(); audioAbort.current?.abort(); scanController.current?.abort(); releaseEngine(); }, []);

  const setSetup = useCallback((s: TrackingSetup) => {
    setSetupState(s);
    try {
      localStorage.setItem("flipper.trackingSetup", JSON.stringify(s));
    } catch {}
  }, []);

  const clearFile = useCallback(() => {
    loadToken.current++;
    scanner.current?.terminate();
    audioAbort.current?.abort();
    scanner.current = null;
    scanController.current?.abort();
    scanController.current = null;
    setDeliveryScan(EMPTY_SCAN);
    setFile(null);
    setUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setMeta(null);
    setSounds(null);
    setFps(null);
    setAudio({ status: "idle", progress: 0, error: null });
    setManual([]);
    setRemoved(new Set());
    setAnalyses({});
    setMarks({});
    select(null);
    releaseEngine();
  }, []);

  const loadFile = useCallback(
    (f: File) => {
      clearFile();
      const token = ++loadToken.current;
      const u = URL.createObjectURL(f);
      setFile(f);
      setUrl(u);
      const probe = document.createElement("video");
      probe.preload = "metadata";
      probe.src = u;
      probe.onloadedmetadata = () => {
        if (token === loadToken.current) {
          setMeta({ duration: probe.duration, width: probe.videoWidth, height: probe.videoHeight });
        }
        probe.removeAttribute("src");
      };
      setAudio({ status: "loading", progress: 0, error: null });
      const progress = (p: number) => token === loadToken.current && setAudio((a) => ({ ...a, progress: p }));
      // Reading the sound is the first 60%, listening for impacts the rest. Only the list of
      // deliveries is kept; the audio itself is dropped as soon as it has been analysed.
      const audioController = new AbortController();
      audioAbort.current = audioController;
      import("@/lib/video/native-decode").then(async ({ nativeAudio }) => {
        try {
          const res = await nativeAudio(f, audioController.signal, (p) => progress(p * .6));
          return { ...res, fps: null as number | null };
        } catch (err) {
          if (audioController.signal.aborted) throw err;
          return extractAudio(f, (p) => progress(p * .6));
        }
      })
        .then(async (res) => {
          if (token !== loadToken.current) return;
          const impacts = await new Promise<Sound[]>((resolve, reject) => {
            const worker = new Worker(new URL("../../lib/video/audio-worker.ts", import.meta.url), { type: "module" });
            scanner.current = worker;
            const finish = () => { worker.terminate(); if (scanner.current === worker) scanner.current = null; };
            worker.onmessage = (event) => {
              if (event.data.progress != null) progress(0.6 + event.data.progress * 0.4);
              if (event.data.sounds) { finish(); resolve(event.data.sounds); }
              if (event.data.error) { finish(); reject(new Error(event.data.error)); }
            };
            worker.onerror = () => { finish(); reject(new Error("Audio scan stopped. Try opening the video again.")); };
            worker.postMessage({ pcm: res.pcm.buffer, sampleRate: res.sampleRate }, [res.pcm.buffer]);
          });
          if (token !== loadToken.current) return;
          setSounds(impacts);
          setFps(res.fps);
          setAudio({ status: "ready", progress: 1, error: null });
        })
        .catch((err: Error) => {
          if (token !== loadToken.current) return;
          setAudio({
            status: /no readable audio/.test(err.message) ? "none" : "error",
            progress: 0,
            error: err.message || "Could not read the audio.",
          });
        });
    },
    [clearFile],
  );

  const scanVideo = useCallback(async () => {
    if (!url || !file) return;
    scanController.current?.abort();
    const controller = new AbortController();
    scanController.current = controller;
    const token = loadToken.current;
    setDeliveryScan((s) => ({ ...s, status: "running", progress: 0, error: null }));
    try {
      const factor=timingFactor(settings.timing);
      if (factor==null) throw new Error("Choose known playback settings before pose analysis.");
      const { scanPoses } = await import("@/lib/video/pose-scan");
      const poses=await scanPoses(file,controller.signal,(progress,phase)=>{
        if(token===loadToken.current && scanController.current===controller) setDeliveryScan(s=>({...s,progress,phase}));
      },factor,12);
      if(token!==loadToken.current || scanController.current!==controller)return;
      const observed=coverage(poses.observed,.5*factor);
      if(observed[0] && observed[0][0]<.25*factor)observed[0][0]=0;
      const tail=observed.at(-1);
      if(tail && poses.duration-tail[1]<.25*factor)tail[1]=poses.duration;
      const result:ScanResult={series:{t:[],m:[]},duration:poses.duration,covered:observed,
        poseActions:poses.events,poseStats:{decoded:poses.decoded,withPose:poses.withPose}};
      setDeliveryScan({ status: "done", progress: 1, result, error: null });
    } catch (err) {
      if (token !== loadToken.current || scanController.current !== controller) return;
      setDeliveryScan((s) => ({ ...s, status: "error", progress: 0,
        error: err instanceof Error ? err.message : "Visual scan failed. Audio clips are unchanged." }));
    }
  }, [url, file, settings.timing]);
  const cancelScan = useCallback(() => scanController.current?.abort(), []);

  const setSettings = useCallback((next:ClipSettings)=>{
    if(JSON.stringify(next.timing)!==JSON.stringify(settings.timing)){
      scanController.current?.abort();setDeliveryScan(EMPTY_SCAN);
    }
    setSettingsState(next);
  },[settings.timing]);

  const deliveries = useMemo<Delivery[]>(() => {
    return sounds ? soundEvents(sounds) : [];
  }, [sounds]);

  const clips: Clip[] = useMemo(() => {
    const duration = meta?.duration ?? Infinity;
    const kept = deliveries.filter((d) => !removed.has(deliveryId(d)));
    const auto: Clip[] = clipWindows(kept, settings.leadIn*(timingFactor(settings.timing)??1), settings.length*(timingFactor(settings.timing)??1), duration,settings.offset).map(({ delivery: d, start, end }) => ({
      id: deliveryId(d),
      reviewRequired: false,
      category:d.category,poseConfidence:d.poseConfidence,
      start,
      end,
      contact: d.kind === "motion" ? null : d.t,
      level: d.rel,
      kind: d.kind === "motion" ? "motion" : "bat",
      manual: false,
    }));
    const adjustedManual=manual.map(c=>{
      const anchor=Math.min(c.anchor??c.start+settings.leadIn,duration-.000001);
      const w=clipWindows([{t:anchor,rel:0}],settings.leadIn,settings.length,duration,settings.offset)[0];
      return w?{...c,start:w.start,end:w.end}:c;
    });
    return [...auto, ...adjustedManual].sort((a, b) => a.start - b.start);
  }, [deliveries, manual, removed, settings.leadIn, settings.length, settings.timing, settings.offset, meta]);

  const addManualClip = useCallback(
    (time: number) => {
      const duration = meta?.duration ?? time + settings.length;
      const start = Math.max(0, time - settings.leadIn);
      const clip: Clip = {
        id: `m${time.toFixed(3)}`,
        start,
        end: Math.min(duration, time + Math.max(.1,settings.length-settings.leadIn)),
        contact: null,
        level: null,
        kind: "manual",
        manual: true,
        anchor:time,
      };
      setManual((m) => (m.some((c) => c.id === clip.id) ? m : [...m, clip]));
      return clip;
    },
    [meta,settings.leadIn,settings.length],
  );

  const removeClip = useCallback((id: string) => {
    setManual((m) => m.filter((c) => c.id !== id));
    setRemoved((r) => new Set(r).add(id));
  }, []);

  const setMark = useCallback((clipId: string, key: MarkKey, t: number | null) => {
    setMarks((all) => {
      const cur = all[clipId] ?? emptyMarks();
      return { ...all, [clipId]: { ...cur, [key]: { t, source: t == null ? null : "manual" } } };
    });
  }, []);

  const analyze = useCallback(
    async (clip: Clip) => {
      if (!url) return;
      if (analyses[clip.id]?.status === "running") return;
      const token = loadToken.current;
      const id = clip.id;
      setAnalyses((a) => ({ ...a, [id]: { status: "running", progress: 0, result: null, error: null } }));
      try {
        const duration = meta?.duration ?? clip.end;
        const anchor = clip.contact ?? clip.end;
        const start = Math.max(0, Math.min(clip.start, anchor - 1.6));
        const end = Math.min(duration, clip.contact != null ? clip.contact + 0.15 : clip.end);
        const { frames, times } = await captureFrames(
          url,
          start,
          end,
          360,
          (p) => { if (token === loadToken.current) setAnalyses((a) => ({ ...a, [id]: { ...a[id], progress: p * 0.9 } })); },
          fps,
        );
        if (frames.length < 6) throw new Error("Too few frames in this clip to track the ball.");
        if (token !== loadToken.current) return;
        const { analyzeFrames } = await import("@/lib/tracking/analyze");
        const result = analyzeFrames(frames, times, clip.contact);
        setAnalyses((a) => ({ ...a, [id]: { status: "done", progress: 1, result, error: null } }));
        setMarks((all) => {
          const cur = all[id] ?? emptyMarks();
          const auto = (k: MarkKey, t: number | null) =>
            cur[k].source === "manual" ? cur[k] : { t, source: t == null ? null : ("auto" as const) };
          return {
            ...all,
            [id]: {
              release: auto("release", result.release),
              bounce: auto("bounce", result.bounce?.t ?? null),
              contact: auto("contact", clip.contact),
            },
          };
        });
      } catch (err) {
        if (token !== loadToken.current) return;
        setAnalyses((a) => ({
          ...a,
          [id]: { status: "error", progress: 0, result: null, error: (err as Error).message || "Tracking failed." },
        }));
      }
    },
    [url, meta, fps, analyses],
  );

  const seek = useCallback((t: number, play = false) => {
    const p = playerRef.current;
    if (!p) return;
    p.currentTime = Math.max(0, t);
    if (play) void p.play();
    else p.pause();
  }, []);
  const playhead = useCallback(() => playerRef.current?.currentTime ?? 0, []);

  const value: Ctx = {
    file,
    url,
    meta,
    loadFile,
    clearFile,
    audio,
    deliveryScan,
    scanVideo,
    cancelScan,
    settings,
    setSettings,
    clips,
    addManualClip,
    removeClip,
    selectedId,
    select,
    analyses,
    analyze,
    marks,
    setMark,
    setup,
    setSetup,
    overlay,
    setOverlay,
    playerRef,
    seek,
    playhead,
  };
  return <VideoCtx.Provider value={value}>{children}</VideoCtx.Provider>;
}

/** Speed, length and line for a clip from its marks and the tracking setup. */
export function clipMetrics(m: Marks | undefined, a: BallAnalysis | null, setup: TrackingSetup) {
  const timing = { release: m?.release.t ?? null, bounce: m?.bounce.t ?? null, contact: m?.contact.t ?? null };
  const speed = speedKmh(timing, setup);
  const length = lengthM(timing, setup);
  let line: number | null = null;
  if (length != null && setup.stumps && a?.bounce && m?.bounce.source === "auto") {
    line = lineCm(a.bounce.x, setup.stumps, length, setup);
  }
  return { speed, length, line };
}

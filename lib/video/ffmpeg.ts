"use client";

import {reelRanges,type ReelRange} from "./reel-ranges";
import type { FFmpeg } from "@ffmpeg/ffmpeg";

/**
 * FFmpeg compiled to WebAssembly, running in a worker in the browser. The video file is mounted
 * read-only (WORKERFS), so even multi-gigabyte recordings are read in pieces, never copied whole.
 * The ~30 MB engine downloads once from a public CDN and is then cached by the browser.
 */

const CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
/** Served from public/ (see scripts/copy-ffmpeg.mjs) so its worker is same-origin. */
const FFMPEG_MODULE = "/vendor/ffmpeg/index.js";

type Engine = { promise: Promise<FFmpeg>; worker?: FFmpeg; controller: AbortController };
let instance: Engine | null = null;
let generation = 0;

async function toBlobURL(url: string, type: string, signal: AbortSignal): Promise<string> {
  // Rebuilding a worker after an export must not download another 30 MB engine.
  let cache: Cache | undefined;
  try { cache = await caches.open("flipper-ffmpeg-core-0.12.10"); } catch { /* private-mode fallback */ }
  let res = await cache?.match(url).catch(() => undefined);
  if (!res) {
    res = await fetch(url, { signal });
    if (res.ok) await cache?.put(url, res.clone()).catch(() => {});
  }
  if (!res.ok) throw new Error("Could not download the video engine. Check your connection.");
  const data = await res.arrayBuffer();
  signal.throwIfAborted();
  return URL.createObjectURL(new Blob([data], { type }));
}

function stopEngine(engine: Engine, reason: unknown = new DOMException("Video processing canceled.", "AbortError")) {
  if (instance === engine) instance = null;
  engine.controller.abort(reason);
  engine.worker?.terminate();
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (!instance) {
    const engine: Engine = { promise: null!, controller: new AbortController() };
    instance = engine;
    const { signal } = engine.controller;
    // A failed worker startup must not leave every subsequent export waiting forever.
    const timeout = setTimeout(() => stopEngine(engine, new Error("The video engine could not start. Check your connection and try again.")), 120_000);
    const urls: string[] = [];
    const load = (async () => {
      const { FFmpeg } = (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ FFMPEG_MODULE
      )) as typeof import("@ffmpeg/ffmpeg");
      signal.throwIfAborted();
      const ff = new FFmpeg();
      engine.worker = ff;
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${CORE}/ffmpeg-core.js`, "text/javascript", signal),
        toBlobURL(`${CORE}/ffmpeg-core.wasm`, "application/wasm", signal),
      ].map(async task => { const url = await task; urls.push(url); return url; }));
      signal.throwIfAborted();
      await ff.load({ coreURL, wasmURL }, { signal });
      return ff;
    })();
    let onAbort: () => void;
    const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener("abort", onAbort, { once: true }); });
    engine.promise = Promise.race([load, aborted]).catch((err) => {
      const reason = signal.aborted ? signal.reason : err;
      stopEngine(engine, reason);
      throw reason;
    }).finally(() => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      urls.forEach((url) => URL.revokeObjectURL(url));
    });
  }
  return instance.promise;
}

/** Load/cache the engine while the user reviews clips rather than after Export. */
export async function prepareExport(){await getFFmpeg();}

/**
 * Shuts the engine down. WebAssembly memory only grows, so after a big job the worker would keep
 * holding hundreds of megabytes (and a copy of whatever it last made); the next job starts fresh.
 */
export function releaseEngine() {
  generation++;
  const old = instance;
  if (old) stopEngine(old);
  // Canceled work belongs to the old worker; new work need not wait for its cleanup.
  queue = Promise.resolve();
}

type Mount = { files?: File[]; blobs?: { name: string; data: Blob }[] };

/**
 * Runs `fn` with the inputs mounted read-only at `dir`. Only one job at a time. The engine is shut
 * down afterwards when `release` is set, and always after a failure (it may have run out of memory).
 */
let queue: Promise<unknown> = Promise.resolve();
async function withMount<T>(dir: string, inputs: Mount, fn: (ff: FFmpeg) => Promise<T>, release = false): Promise<T> {
  const token = generation;
  const job = queue.then(async () => {
    if (token !== generation) throw new DOMException("Video processing canceled.", "AbortError");
    const ff = await getFFmpeg();
    const engine = instance;
    let ok = false;
    try {
      if (token !== generation) throw new DOMException("Video processing canceled.", "AbortError");
      await ff.createDir(dir).catch(() => {});
      await ff.mount("WORKERFS" as never, inputs, dir);
      const result = await fn(ff);
      if (token !== generation) throw new DOMException("Video processing canceled.", "AbortError");
      ok = true;
      return result;
    } catch (err) {
      if (token !== generation) throw new DOMException("Video processing canceled.", "AbortError");
      throw err;
    } finally {
      await ff.unmount(dir).catch(() => {});
      if ((release || !ok) && engine?.worker === ff) stopEngine(engine);
    }
  });
  queue = job.catch(() => {});
  return job;
}

/** Runs `fn` with `file` mounted at /in/<name>. */
function withFile<T>(file: File, fn: (ff: FFmpeg, path: string) => Promise<T>, release = false): Promise<T> {
  return withMount("/in", { files: [file] }, (ff) => fn(ff, `/in/${file.name}`), release);
}

function friendly(err: unknown): Error {
  if (err instanceof Error && err.name === "AbortError") return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/memory|abort|terminat|RuntimeError|OOM/i.test(msg)) {
    return new Error("This device ran out of memory making the video. Untick some clips, or tick Exact cuts for a smaller file.");
  }
  return err instanceof Error ? err : new Error(msg);
}

/**
 * Mono 16 kHz audio as 16-bit integers (enough for the 1.5–7.5 kHz click of bat on ball, at half the
 * memory of floats: about 2 MB a minute), plus the video frame rate FFmpeg reports.
 */
export async function extractAudio(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ pcm: Int16Array; sampleRate: number; fps: number | null }> {
  const sampleRate = 16000;
  return withFile(file, async (ff, path) => {
    const handler = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)));
    let fps: number | null = null;
    const logs = ({ message }: { message: string }) => {
      const m = fps == null && /Stream .*Video:.* ([\d.]+) fps/.exec(message);
      if (m) fps = Number(m[1]) || null;
    };
    ff.on("progress", handler);
    ff.on("log", logs);
    try {
      const code = await ff.exec(["-i", path, "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "/audio.pcm"]);
      if (code !== 0) throw new Error("This video has no readable audio track.");
      const data = (await ff.readFile("/audio.pcm")) as Uint8Array;
      await ff.deleteFile("/audio.pcm");
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      return { pcm: new Int16Array(copy.buffer), sampleRate, fps };
    } finally {
      ff.off("progress", handler);
      ff.off("log", logs);
    }
  });
}

/**
 * Cuts [start, start+duration). Fast mode copies the stream (seconds, original quality, but the cut
 * snaps to the keyframe before `start`). Precise mode re-encodes, so every clip starts on the exact
 * frame; it is slower and fits the output inside 1280×720 at a bounded bitrate.
 */
async function cut(ff: FFmpeg, path: string, start: number, duration: number, out: string, precise = false, edge=720, frames?:number,padBefore=0,padAfter=0) {
  // The last video frame can precede the file's reported duration. Hold it until the
  // requested frame count, and pad short audio too, so every beat slot stays full.
  const padding=frames?`,tpad=start_mode=clone:start_duration=${padBefore}:stop_mode=clone:stop=-1`:padBefore||padAfter?`,tpad=start_mode=clone:start_duration=${padBefore}:stop_mode=clone:stop_duration=${padAfter}`:"";
  const codec = precise
    ? ["-vf", `scale=w='min(${Math.round(edge*16/9)},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2${frames?",fps=30":""}${padding}`, "-c:v", "libx264", "-preset", "ultrafast", "-b:v", edge<=480?"700k":"1500k", "-maxrate", edge<=480?"700k":"1500k", "-bufsize", "3000k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-ac", "2"]
    : ["-c", "copy", "-avoid_negative_ts", "make_zero"];
  const code = await ff.exec([
    "-ss", start.toFixed(6), "-i", path, "-t", (frames?frames/30:duration).toFixed(6),
    "-map", "0:v:0", "-map", "0:a:0?", ...codec, ...(frames||padBefore||padAfter?["-af",`adelay=${Math.round(padBefore*1000)}:all=1,apad`]:[]), ...(frames?["-frames:v",String(frames)]:[]), "-movflags", "+faststart", out,
  ]);
  if (code !== 0) throw new Error("FFmpeg could not cut this clip.");
}

export async function exportClip(file: File, start: number, duration: number): Promise<Blob> {
  return withFile(file, async (ff, path) => {
    await cut(ff, path, start, duration, "/clip.mp4");
    const data = (await ff.readFile("/clip.mp4")) as Uint8Array;
    await ff.deleteFile("/clip.mp4");
    return new Blob([data.slice()], { type: "video/mp4" });
  });
}

/**
 * Joins the clips, in order, into one highlights video. Each piece is moved out of the engine as
 * soon as it is cut and read back from there for the join, so the engine never holds more than one
 * piece plus the finished video, and it is shut down afterwards to give that memory back.
 */
export async function exportReel(
  file: File,
  clips: ReelRange[],
  onProgress?: (fraction: number) => void,
  { precise = false, preview = false, frameCounts }: { precise?: boolean;preview?:boolean;frameCounts?:number[] } = {},
): Promise<Blob> {
  const token = generation;
  try {
    if(!frameCounts)clips=reelRanges(clips);
    if(frameCounts&&(frameCounts.length!==clips.length||frameCounts.some(n=>!Number.isInteger(n)||n<=0)))throw new Error("Invalid beat timing.");
    if(!clips.length)throw new Error("Select at least one clip to export.");
    if(clips.length===1)return await withFile(file,async(ff,path)=>{
      await cut(ff,path,clips[0].start,clips[0].end-clips[0].start,"/reel.mp4",precise||preview||!!frameCounts,preview?480:720,frameCounts?.[0],clips[0].padBefore,clips[0].padAfter);
      const data=await ff.readFile("/reel.mp4") as Uint8Array;
      const blob=new Blob([data.slice()],{type:"video/mp4"});
      await ff.deleteFile("/reel.mp4");onProgress?.(1);return blob;
    },true);
    const parts = await withFile(file, async (ff, path) => {
      const out: { name: string; data: Blob }[] = [];
      for (let k = 0; k < clips.length; k++) {
        await cut(ff, path, clips[k].start, clips[k].end - clips[k].start, "/part.mp4", precise||preview||!!frameCounts,preview?480:720,frameCounts?.[k],clips[k].padBefore,clips[k].padAfter);
        const data = (await ff.readFile("/part.mp4")) as Uint8Array;
        await ff.deleteFile("/part.mp4");
        out.push({ name: `p${k}.mp4`, data: new Blob([data.slice()], { type: "video/mp4" }) });
        onProgress?.((k + 1) / (clips.length + 1));
      }
      return out;
    });
    if (token !== generation) throw new DOMException("Video processing canceled.", "AbortError");
    return await withMount(
      "/parts",
      { blobs: parts },
      async (ff) => {
        await ff.writeFile("/list.txt", parts.map((p,i) => `file '/parts/${p.name}'${frameCounts?`\nduration ${(frameCounts[i]/30).toFixed(9)}`:""}`).join("\n"));
        const code = await ff.exec(["-f", "concat", "-safe", "0", "-i", "/list.txt", ...(frameCounts?["-c:v","copy","-c:a","aac","-af","aresample=async=1:first_pts=0","-t",String(frameCounts.reduce((n,v)=>n+v,0)/30)]:["-c","copy"]), "-movflags", "+faststart", "/reel.mp4"]);
        if (code !== 0) throw new Error("FFmpeg could not join the clips.");
        const data = (await ff.readFile("/reel.mp4")) as Uint8Array<ArrayBuffer>;
        onProgress?.(1);
        const blob = new Blob([data], { type: "video/mp4" });
        await ff.deleteFile("/reel.mp4");
        await ff.deleteFile("/list.txt");
        return blob;
      },
      true,
    );
  } catch (err) {
    throw friendly(err);
  }
}

/** Rough size of a highlights video, used to split one that would not fit in memory. */
export function estimateBytes(fileSize: number, duration: number, clipSeconds: number, clipCount: number, precise: boolean) {
  const rate = fileSize / Math.max(1, duration);
  // Fast cuts start at the keyframe before each clip, which adds about a second each.
  return precise ? Math.min(rate, 2.5e6) * clipSeconds : rate * (clipSeconds + clipCount);
}

/** Most parts a highlights video is split into. */
export const MAX_PARTS = 10;

/**
 * How big one part of a highlights video should be on this device. Making a part briefly needs a few
 * times its size (the cut pieces, the engine's copy, the copy handed back and the saved file), so
 * parts start small; for a long session they grow, up to a limit, to stay within MAX_PARTS. A part
 * that still runs out of memory is remade smaller (see Highlights).
 */
export function reelBudget(estimate: number, bigParts = false): number {
  // "Bigger parts" lets a phone use a computer's part sizes: fewer files, but an older phone may
  // close the tab instead of reporting that it ran out of memory.
  const [small, ceiling] = isTouchDevice() && !bigParts ? [100e6, 300e6] : [250e6, 750e6];
  return Math.min(ceiling, Math.max(small, (estimate / MAX_PARTS) * 1.1));
}

export function isTouchDevice(): boolean {
  return typeof window !== "undefined" && navigator.maxTouchPoints > 0 && matchMedia("(pointer: coarse)").matches;
}

export function isOutOfMemory(err: unknown): boolean {
  return err instanceof Error && /ran out of memory/.test(err.message);
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Phones and tablets that can hand a video to the system share sheet, which has Save Video on an
 * iPhone and the gallery apps on Android. Browsers only allow this straight after a tap.
 */
export function canSaveToPhotos(): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare || navigator.maxTouchPoints === 0) return false;
  try {
    return navigator.canShare({ files: [new File([], "clip.mp4", { type: "video/mp4" })] });
  } catch {
    return false;
  }
}

export function isApple(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
}

/** Opens the share sheet with the video. False if it was cancelled, which is not an error. */
export async function saveToPhotos(blob: Blob, filename: string): Promise<boolean> {
  const file = new File([blob], filename, { type: "video/mp4" });
  try {
    await navigator.share({ files: [file] });
    return true;
  } catch (err) {
    if ((err as Error).name === "AbortError") return false;
    throw new Error("Couldn't open the share sheet. Use Download instead.");
  }
}

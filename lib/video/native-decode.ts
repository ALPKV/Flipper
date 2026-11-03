"use client";

import { Input, ALL_FORMATS, BlobSource, CanvasSink, AudioBufferSink, EncodedPacketSink } from "mediabunny";
import { toGray, type Gray } from "../tracking/core";
import { coverage, motionFraction, type ScanResult } from "../tracking/visual-deliveries";

const open = (file: File) => new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
const check = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("Canceled", "AbortError"); };

/** Frame stepping reads the file's actual PTS values, including variable-frame-rate video. */
export async function frameTimeline(file: File, signal: AbortSignal, maxSeconds = 15) {
  const input = open(file);
  try {
    const duration = await input.computeDuration();
    if (duration > maxSeconds) throw new Error(`Choose one delivery, up to ${maxSeconds} video seconds for the selected playback settings.`);
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("No video track found.");
    const times: number[] = [];
    for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
      check(signal); times.push(packet.timestamp);
    }
    return [...new Set(times)].sort((a,b)=>a-b);
  } finally { input.dispose(); }
}

/** Demux + hardware decode, independent of playback speed, tab visibility and display refresh. */
export async function scanFileMotion(file: File, signal: AbortSignal, progress: (p: number) => void): Promise<ScanResult> {
  const input = open(file);
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    check(signal);
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw new Error("Fast video decoding is unavailable for this codec. Export an H.264 MP4 or use audio-only detection.");
    const duration = await input.computeDuration();
    const start = await track.getFirstTimestamp();
    const sink = new CanvasSink(track, { width: 160, height: 160, fit: "fill", poolSize: 2 });
    const timestamps = (function* () { for (let t = start; t < duration; t += .2) yield t; })();
    const series: ScanResult["series"] = { t: [], m: [] };
    const observed: number[] = [];
    let previous: Uint8Array | null = null;
    let last = -Infinity;
    let count = 0;
    for await (const frame of sink.canvasesAtTimestamps(timestamps)) {
      check(signal);
      if (!frame || frame.timestamp <= last) continue;
      const ctx = frame.canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!ctx) throw new Error("Cannot read decoded frames.");
      const gray = toGray(ctx.getImageData(0, 0, 160, 160).data, 160, 160).data;
      observed.push(frame.timestamp);
      if (previous && frame.timestamp - last <= .5) {
        series.t.push(frame.timestamp);
        series.m.push(motionFraction(previous, gray));
      }
      previous = gray;
      last = frame.timestamp;
      progress(Math.min(.99, last / duration));
      if (++count % 25 === 0) await new Promise(r => setTimeout(r, 0));
    }
    if (series.t.length < 3) throw new Error("Not enough decoded movement samples.");
    const covered = coverage(observed);
    if (covered[0] && covered[0][0] <= .25) covered[0][0] = 0;
    const end = covered.at(-1);
    if (end && duration - end[1] <= .3) end[1] = duration;
    progress(1);
    return { series, covered, duration };
  } finally { signal.removeEventListener("abort", abort); input.dispose(); }
}

/** Real presentation timestamps; no guessed frame rate or duplicated seek frames. */
export async function flightFrames(file: File, start: number, end: number, signal: AbortSignal, progress: (p: number) => void) {
  const input = open(file);
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw new Error("This browser cannot decode the clip. Try an H.264 MP4 in Chrome or Edge.");
    const scale = Math.min(1, 640 / Math.max(track.displayWidth, track.displayHeight));
    const w = Math.round(track.displayWidth * scale), h = Math.round(track.displayHeight * scale);
    const sink = new CanvasSink(track, { width: w, height: h, fit: "fill", poolSize: 1 });
    const frames: Gray[] = [], times: number[] = [];
    for await (const frame of sink.canvases(start, end)) {
      check(signal);
      if (frames.length >= 900) throw new Error("Too many frames. Trim to one delivery at normal playback speed.");
      const ctx = frame.canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      frames.push(toGray(ctx.getImageData(0, 0, w, h).data, w, h));
      times.push(frame.timestamp);
      progress(Math.min(1, (frame.timestamp - start) / (end - start)));
      if (frames.length % 20 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return { frames, times };
  } finally { signal.removeEventListener("abort", abort); input.dispose(); }
}

/** Stream audio into a small mono array; no FFmpeg download for supported codecs. */
export async function nativeAudio(file: File, signal: AbortSignal, progress: (p: number) => void, maxSeconds = 7200) {
  const input = open(file), sampleRate = 16000;
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("The recording has no usable duration.");
    if (duration > maxSeconds) throw new Error(`Use a recording no longer than ${maxSeconds} seconds for this tool.`);
    const track = await input.getPrimaryAudioTrack();
    if (!track || !await track.canDecode()) throw new Error("No supported audio track.");
    const pcm = new Int16Array(Math.ceil(duration * sampleRate));
    const sink = new AudioBufferSink(track);
    let seen = false;
    for await (const item of sink.buffers()) {
      check(signal); seen = true;
      const buffer = item.buffer;
      const channels = Array.from({length: buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i));
      const from = Math.max(0, Math.ceil(item.timestamp * sampleRate));
      const to = Math.min(pcm.length, Math.ceil((item.timestamp + buffer.duration) * sampleRate));
      for (let i = from; i < to; i++) {
        const pos = Math.max(0, (i / sampleRate - item.timestamp) * buffer.sampleRate);
        const a = Math.min(buffer.length - 1, Math.floor(pos)), b = Math.min(buffer.length - 1, a + 1);
        let value = 0;
        for (const channel of channels) value += channel[a] + (channel[b] - channel[a]) * (pos - a);
        pcm[i] = Math.max(-32768, Math.min(32767, Math.round(value / channels.length * 32767)));
      }
      progress(Math.min(1, (item.timestamp + buffer.duration) / duration));
    }
    if (!seen) throw new Error("No readable audio.");
    return { pcm, sampleRate, duration };
  } finally { signal.removeEventListener("abort", abort); input.dispose(); }
}

/**
 * Writes a synthetic behind-the-bowler delivery MP4 (H.264 + AAC, with a bat-contact click) for
 * browser smoke tests of Speed Check, using the pinned FFmpeg WASM in Node.
 *   node --experimental-strip-types scripts/speed-eval/synthetic-video.mts <out.mp4> [fps]
 * Synthetic footage checks the plumbing (decode, timestamps, overlay, export), not accuracy.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { synthDelivery } from "../../tests/speed-synthetic.ts";

const require = createRequire(import.meta.url);
const [out, fpsArg] = process.argv.slice(2);
const fps = Number(fpsArg ?? 60);
const s = synthDelivery({ fps, w: 720, h: 1280, distractors: true });
const rgb = Buffer.alloc(s.w * s.h * 3 * s.frames.length);
s.frames.forEach((f, i) => { for (let p = 0; p < f.data.length; p++) { const o = (i * f.data.length + p) * 3; rgb[o] = rgb[o + 1] = rgb[o + 2] = f.data[p]; } });
const rate = 48000, dur = s.frames.length / fps, pcm = Buffer.alloc(Math.ceil(dur * rate) * 4);
for (let i = 0; i < pcm.length / 4; i++) {
  const t = i / rate, d = t - s.soundT;
  // Sharp broadband crack with fast decay at the bat-contact sound time, plus faint noise.
  const crack = d >= 0 && d < 0.05 ? 0.8 * Math.exp(-d / 0.008) * Math.sin(2 * Math.PI * 2800 * d + 7 * Math.sin(2 * Math.PI * 900 * d)) : 0;
  pcm.writeFloatLE(crack + 0.003 * Math.sin(i * 12.9898), i * 4);
}
(globalThis as unknown as { self: unknown }).self = { location: { href: "file:///ffmpeg-core.js" } };
const core = await require("@ffmpeg/core")({ wasmBinary: readFileSync(require.resolve("@ffmpeg/core/wasm")) });
core.FS.writeFile("/v.rgb", rgb); core.FS.writeFile("/a.f32", pcm);
core.exec("-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", `${s.w}x${s.h}`, "-framerate", String(fps), "-i", "/v.rgb",
  "-f", "f32le", "-ar", String(rate), "-ac", "1", "-i", "/a.f32", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "/out.mp4");
writeFileSync(out, core.FS.readFile("/out.mp4"));
console.log(JSON.stringify({ out, fps, frames: s.frames.length, releaseT: s.releaseT, contactT: s.contactT, soundT: s.soundT, trueAverageKmh: +s.trueAverageKmh.toFixed(1), farBase: s.farBase, farTop: s.farTop, size: [s.w, s.h] }));
process.exit(0);

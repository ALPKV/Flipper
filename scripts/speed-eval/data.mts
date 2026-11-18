/** Shared loaders for the offline Speed Check evaluation (developer-only, local files). */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Gray } from "../../lib/tracking/core.ts";

export type Clip = { name: string; video: string; w: number; h: number; times: number[]; frames: Gray[] };

export function loadClip(dir: string, name: string): Clip {
  const meta = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
  const raw = readFileSync(join(dir, `${name}.gray`));
  const size = meta.w * meta.h;
  const frames: Gray[] = meta.times.map((_: number, i: number) => ({
    data: new Uint8Array(raw.buffer, raw.byteOffset + i * size, size), w: meta.w, h: meta.h,
  }));
  return { name, video: meta.video, w: meta.w, h: meta.h, times: meta.times, frames };
}

/** 2x2 area downscale, matching the old 640-pixel decode used by the existing Speed Check. */
export function half(g: Gray): Gray {
  const w = g.w >> 1, h = g.h >> 1, data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = 2 * y * g.w + 2 * x;
    data[y * w + x] = (g.data[p] + g.data[p + 1] + g.data[p + g.w] + g.data[p + g.w + 1] + 2) >> 2;
  }
  return { data, w, h };
}

export function sessionAudio(dir: string, session: string): Int16Array | null {
  const file = join(dir, `${session}.s16`);
  if (!existsSync(file)) return null;
  const buf = readFileSync(file);
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength >> 1);
}

export const sessionOf = (name: string) => (name.startsWith("A") ? "netsA" : "netsB");

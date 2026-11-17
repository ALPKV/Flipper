// Copies FFmpeg.wasm's browser files into public/ so its worker is served from this site
// (bundlers cannot follow the worker's dynamic URL). Runs before `dev` and `build`.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("public/vendor/ffmpeg", { recursive: true });
cpSync("node_modules/@ffmpeg/ffmpeg/dist/esm", "public/vendor/ffmpeg", { recursive: true });
mkdirSync("public/vendor/mediapipe", { recursive: true });
cpSync("node_modules/@mediapipe/tasks-vision/wasm", "public/vendor/mediapipe", { recursive: true });

// Pinned local core: no third-party runtime request and no recordings in this directory.
mkdirSync("public/vendor/ffmpeg-core/0.12.10", { recursive: true });
cpSync("node_modules/@ffmpeg/core/dist/esm", "public/vendor/ffmpeg-core/0.12.10", { recursive: true });

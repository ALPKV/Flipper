# Speed Check evaluation

Developer-only, local. Recordings are not in the repository; only annotations (coordinates and
times) and result summaries are. See `SPEED-CHECK.md` for what these numbers do and do not show.

Needs Node 22+, Python 3 with `opencv-python` (frame decoding only) and the repo's pinned
`@ffmpeg/core` (audio extraction, run in Node).

1. Decode delivery windows to 1280-px grayscale frames (all frames kept, repeats included):
   `python scripts/speed-eval/decode.py <video> <name> <t0> <t1> <frames-dir>`
   Windows used: A<nn> = labels.json netsA release + 0.05 … + 1.35 s; B<nn> = netsB release − 0.35 … + 0.8 s.
2. Extract 16 kHz mono audio per session to `<audio-dir>/<session>.s16` (e.g. with the pinned
   FFmpeg WASM: `-vn -ac 1 -ar 16000 -f s16le`).
3. New pipeline against `annotations.json`:
   `node --experimental-strip-types scripts/speed-eval/run.mts <frames-dir> <audio-dir> [tune|dev|holdout]`
4. Old Speed Check flow (no pose) and old tracker with the flight end given:
   `node --experimental-strip-types scripts/speed-eval/baseline.mts <frames-dir> <audio-dir>`
   `node --experimental-strip-types scripts/speed-eval/compare-baseline.mts <eval-dir>`
   `node --experimental-strip-types scripts/speed-eval/baseline-assisted.mts <frames-dir>`
5. Synthetic MP4 for a browser smoke test (put it in the gitignored `public/dev-samples/` and open
   `/tracking?sample=<file>` on the dev server with `NEXT_PUBLIC_SPEED_CHECK=1`):
   `node --experimental-strip-types scripts/speed-eval/synthetic-video.mts public/dev-samples/synthetic-delivery.mp4 60`

`results/`: `final.json` (frozen pipeline), `v1.json` (first version, including the A05 false
measurement), `baseline.json` (old flow). Pose is simulated in Node from the annotation (±0.1 s,
±20 px); MediaPipe was not run on these clips.

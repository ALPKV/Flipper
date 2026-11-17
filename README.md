# Flipper

**Live:** https://flipper-cricket.vercel.app/highlights

Flipper turns cricket net-session recordings into reviewable sound-triggered highlights. The
navigation calls the editor **Clip Farmer**; the page heading and browser title are **Flipper**.
Recordings, decoded audio and generated clips stay on your device. There are no active accounts,
upload endpoints or cloud video processing.

## Current workflow

1. Choose an MP4, MOV or other supported recording. H.264 MP4 has the widest browser compatibility.
2. Review sound candidates. They can include machine noise, speech, footsteps or net noise; this
   is not a validated bat-contact classifier and does not guarantee every delivery.
3. Nearby detections can be combined around the strongest sound (default 0.6 seconds). The gap
   is adjustable and switching grouping off restores raw detections. Manual clips stay separate.
4. Adjust equal time either side of the sound and the timing offset. Separate clips may overlap.
5. **Keep 1st, 3rd, 5th...** selects alternate entries from the full chronological clip list.
   It is repeatable without further halving the selection; **Select all** restores every entry.
6. Optionally enter a song's BPM and one hit every 1, 2, 4 or 8 beats. No song upload is needed.
   Add music later in a reel editor and align its beat with the first output hit time shown.
7. Prepare a local 480p preview (first 90 seconds only), then create and explicitly save one
   720p MP4. Full export selection is independent of the preview cap.

Exports re-encode exact 30 fps cuts. The old keyframe-copy option was removed after a synthetic
regression showed cuts starting 21-39 frames early. Intermediate clips use lossless ALAC audio in MOV;
AAC is encoded once at final assembly to avoid accumulating encoder delay. Video-only concat
copying is safe here because those intermediates have matching codec, dimensions and timebase.
Memory-bounded worker batches and one smaller 480p retry remain; these cannot remove a device's
hard memory limit. Progress and Cancel are available. Controls are locked while processing;
an immediate guard prevents a repeated Export invocation from queuing another job.

## Limits and compatibility

- Safety caps: **1 GiB input** and **2 hours**. Size is checked before opening a recording;
  container duration is checked before PCM allocation. These caps are safeguards, not proven
  capacity on all devices. Trim longer/larger files or re-save them at 1080p/720p locally.
- Actual prior browser smoke test: **3.2-second 1080x1920 H.264 MP4**. Maximum long-session
  capacity has not been benchmarked. No phone/browser hardware matrix is claimed.
- Native synthetic export check: **9-second 320x180 H.264**, 30 fps, 2-second GOP, numbered
  frames and synchronized beeps. See `RELIABILITY-CHECKS.md` for before/after measurements.
- Phone HEVC/MOV playback depends on browser codec support. Unsupported original playback
  shows a message and offers the local H.264 preview path; if export also cannot decode the
  source, convert it to H.264 MP4 on your device. No footage is uploaded for conversion.
- Container display dimensions include rotation. Exact exports let FFmpeg apply rotation and
  convert variable frame rate to 30 fps; duration comes from presentation timestamps.
- Recordings without audio show a specific message. They remain usable for manually added clips.
- The browser warns before closing/reloading a loaded session, where supported. It cannot
  guarantee recovery after a crash, forced shutdown or mobile app termination. Save your MP4.

## Experimental tools retained in the repo

`lib/features.ts` contains the single `EXPERIMENTAL_FEATURES = false` switch. Speed Check shows
an **In progress** page in production. The retained Speed Check/Ball Tracking components and
provider tracking entry points are gated by that switch; no tracking code was deleted. Tracking
and speed remain unvalidated timing estimates, not radar or calibrated 3D measurements.

No WillowFlow-specific code is present in this checkout. The old Python account/login code is
retained in `legacy/`, excluded from deployment by `.vercelignore`, and has no Next.js route or
import. Old `/login`, `/signup`, `/dashboard` and `/profile` URLs redirect to `/highlights`.
Earlier public commits contained Streamlit credentials: do not reuse those passwords.

## Run and verify

Node.js 22 or newer:

```bash
npm ci
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
```

The optional native command integration test requires a local FFmpeg executable:

```bash
npm run test:export-native -- /absolute/path/to/ffmpeg
# Same tests through the actual pinned WASM engine (in Node):
npm run test:export-native -- /absolute/path/to/ffmpeg --wasm
```

It generates synthetic fixtures under ignored `.scratch/`, runs the application's actual cut
and concat commands, and asserts crop/frame order, absence of black/frozen frames, total frame
count, audio/video duration and beep alignment within one 30 fps frame. The --wasm mode runs the identical WASM binary in Node. Neither mode validates browser UI or device memory limits. No private recordings are part of the build or test artifacts.

## Assets and deployment

Build/dev copies the pinned `@ffmpeg/ffmpeg` wrapper and **`@ffmpeg/core@0.12.10`** into
`public/vendor/`. The JavaScript core and roughly 31 MB WASM asset are served by this same site;
there is no jsDelivr runtime request. Browser caching stores engine assets, never recordings.
`package-lock.json` pins the package tarball integrity. See `THIRD-PARTY-NOTICES.md` for licenses
and source locations. Assets are generated, ignored by Git, and included in the deployed build.

MediaPipe runtime and the model remain local and gated with experimental tools. The retained
pose model is Google's float16 version 1 `pose_landmarker_lite.task`:
https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
SHA256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.

Vercel hosts the Next.js app. Historical implementation notes are in `FIX-VALIDATION.md`;
the current behavior above supersedes old experiments described there.

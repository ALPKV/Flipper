# Flipper

Drop in an unedited net session video and get a clip for every shot, then track the ball. It grew
out of Clip Farmer, an audio-based auto-clipper (the original Streamlit version is in `legacy/`).

**Live:** https://flipper-cricket.vercel.app

| Tab | What it does |
| --- | --- |
| **Clip Farmer** | Choose a video, review audio-detected clips, and export one highlights MP4. Optional Noisy hall filtering reduces false clips at the cost of softer shots. Exclusions are reversible. Tracking is off by default. |
| **Ball Tracking** | Follows the ball through a clip and draws it over the video (toggle on and off). Times speed and length from release, bounce and contact marks. Pitch map of the deliveries tracked in the session. |

Everything runs on your device: there are no accounts, no database and no uploads (FFmpeg compiled to
WebAssembly, plus a tracker written for this app).

## How shots are found

`lib/tracking/hits.ts`: sudden jumps in the 1.5–7.5 kHz band against the last 3 s of background (so
it works in a quiet net or a loud hall), talking dropped (a vowel follows a spoken "t" or "k"), then
the simple rule above. Results on labelled sessions are in `scripts/deliveries/README.md`.

## How speed is measured (and how accurate it is)

Speed is an **unvalidated timing estimate**, not radar: the calculation assumes a distance (17.68 m, crease to crease, by default) between release and contact. That assumed distance is not a measured 3D ball path. Contact comes from an audio impact, which may be a bat, net, or another sound and can include sound-travel delay. Release comes from the first frame the ball is seen, which is not necessarily the true release. **Check every auto mark** with
the frame-step buttons; one frame at 30 fps is about 5% of the speed. Film at 60 fps or more, on a
tripod, with the release and the batter both in view. Length assumes the ball keeps that speed to the
bounce. Line needs the camera behind the stumps and the stumps marked. All are estimates, not radar.

## Run it on your computer

Needs Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

```bash
npm test          # unit tests (shot finding, tracking, speed maths)
npm run lint
npm run typecheck
```

## Put it online for free

On [vercel.com](https://vercel.com) (free Hobby plan): **Add New → Project**, import **Flipper**,
**Deploy**. Every push to `main` redeploys. Nothing else to set up.

## Project layout

| Path | What it is |
| --- | --- |
| `app/` | Pages: `(app)/highlights`, `(app)/tracking`, `(legal)/privacy`, `(legal)/terms` |
| `components/video/` | Highlights, Ball Tracking, the player and clip bar |
| `lib/tracking/` | Shot finding from sound, ball detection and tracking, bounce, speed/length/line maths |
| `lib/video/` | FFmpeg.wasm (audio, clips and highlights video) and frame capture |
| `scripts/` | Evaluation of shot finding and ball-model training |
| `legacy/` | The original Streamlit version (then called Clip Farmer), kept for reference |

`config.yaml` (old Streamlit logins) is no longer tracked, but earlier commits of this public
repository still contain it. Don't reuse those passwords anywhere.

## Simplified workflow (24 October 2026)

- Audio features run in a dedicated worker so the page remains responsive. Changing detection settings reuses those features.
- No automatic multipart exports or downloads. Recommended quality copies small reels; larger ones use bounded-bitrate 720p encoding. Encoding takes longer.
- One explicit Save downloads one MP4. Save to Photos/gallery is a separate action.
- Selections that exceed a conservative device budget are blocked with an explanation; memory budgets are estimates, not guarantees.
- The FFmpeg core is explicitly cached where browser storage permits, even when its worker is restarted.
- Track association uses presentation-time differences; stalled frame capture is cleaned up and times out instead of hanging.
- Original-quality cuts can start at earlier keyframes and have variable-frame-rate boundary artifacts. Use Smaller 720p for exact cuts.
- No new ball model was trained in this change. Ball tracking and speed/length remain experimental and unvalidated against radar or calibrated bounce coordinates.

See `FIX-VALIDATION.md` for measured checks and remaining limits.


## Pose-first delivery analysis (3 November 2026)

Clip Farmer now samples body landmarks with MediaPipe Pose Landmarker Lite in a browser worker.
A same-person arm lift, whip and drop, or a cropped forward follow-through, creates an action candidate.
Audio only categorizes those candidates: contact-like sound, no clear contact, or ambiguous sound.
Audio cannot create a delivery in pose-first mode, including while the pose scan is pending.
The explicitly selected sound-only mode remains a manual-review fallback.

Speed Check combines arm-whip release candidates, ball flight/bounce and acoustic contact timing.
A cropped follow-through never supplies release time. Missing flight evidence withholds an automatic speed.
Speed is average distance/time, not radar release speed. Pose timing can precede actual ball release.
Known constant slow motion requires capture/export FPS; unknown or variable-speed edits withhold speed.

This is experimental, not a trained cricket-action classifier. Development recordings exposed missed
releases, identity fragmentation and other players' arm movements mistaken for bowling. Zero false
positives and complete delivery coverage have NOT been achieved. Local browser smoke testing found
one pose-defined, sound-matched candidate in a 3.2-second excerpt; this is not accuracy validation.

### Model provenance

`@mediapipe/tasks-vision` is pinned to 1.2.0. Build/dev copies its runtime into `/vendor/mediapipe`.
`public/models/pose_landmarker_lite.task` is the official Google MediaPipe float16 version 1 asset:
https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
SHA256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.
See Google's model documentation and applicable license:
https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
Neither videos nor body landmarks are uploaded. No GPU/cloud account is required.


## Sound-only Clip Farmer (10 November 2026)

The active clipper now uses all detected audio onsets directly: no pose scan, speech rejection,
relative-loudness filter or three-second shot cooldown. The onset detector still separates peaks
by 120 ms; continuous sound does not become a clip for every sample. Each distinct onset becomes
an initially selected review candidate. Adjacent cuts meet at their sound timestamps' midpoint,
so a sound inside another cut is retained without overlapping video. Speech, footsteps and net
noise may be included: review before exporting. One MP4 export and no duration quota remain.
Speed Check stays in the navigation with an In progress page; measurements are unavailable.

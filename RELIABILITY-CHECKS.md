# Reliability review (17 November 2026)

Every issue was checked against the current code or measured before changing behavior.

| Review item | Evidence / action |
| --- | --- |
| Keyframe-copy accuracy | Confirmed only in optional original mode: a 2-second-GOP source requested at 0.7/3.1/5.3s started 21/33/39 frames early. That mode produced 198 rather than 99 frames. Removed arbitrary source stream-copy cuts; all public exports now encode frame-bounded 30 fps spans. |
| Default exact cutting | Already started at the correct source frames in the baseline. Detection, grouping, offset logic and selected clip windows were preserved. |
| Concatenated audio / BPM drift | Confirmed: baseline normal reel beep errors 23/61/90ms; beat reel errors 23.667/43/62.333ms. Changed intermediate AAC to lossless ALAC MOV and encoded AAC once at assembly. After: normal 0/0/0ms; beat 0.667/0/0.333ms, within one frame (33.333ms). |
| Black or frozen initial frames | Not reproduced: baseline fixture had zero black/repeated adjacent frames. No separate speculative black-frame fix. Assertions protect the synthetic case. |
| Concat failure / mismatched parameters | No concat failure reproduced with a single source. Exact outputs now consistently use H.264/yuv420p, 30fps, fixed-size scaling and 44.1kHz stereo audio. Not claimed to validate every malformed input. |
| Export double invocation | Disabled buttons existed. A direct two-invocation test before re-render started two jobs in the baseline handler and now starts one; added an immediate in-flight guard. Preview gets the same guard. Settings were already disabled during processing; Change video is now disabled too. Existing cancellation/replacement-worker regressions still run. |
| Large inputs | Size was unbounded and the old duration guard could fall through into FFmpeg. Added 1GiB/2h checks before heavy decoding, actionable trim/lower-resolution guidance, and honest tested-capacity text. Not a claim that 1GiB/2h was browser-tested. |
| Tab memory / unload | No beforeunload handler existed; added one while a recording is open. Browsers control whether a dialog appears. No recovery or persistence is implied. |
| HEVC/MOV / playback | MOV was already selectable; unsupported original playback had no error handler. Added explicit guidance and a local H.264 preview fallback path. Browser-specific HEVC coverage remains unverified. |
| Rotation / VFR | The existing browser demuxer exposes rotated display dimensions, and FFmpeg autorotates during decode. No original rotation bug reproduced. VFR fixture initially lost one output frame; normalizing the decoded PTS origin before the 30fps filter fixes it. Generated rotation/HEVC/VFR/silent inputs pass metadata and export checks with native FFmpeg and the pinned WASM in Node. These are separate from browser playback support. |
| No audio | FFmpeg fallback already emitted a no-readable-audio error, so a total lack of messaging was not confirmed. Added direct no-track detection before decoding, explicit manual-clip guidance, and a distinct empty-list state instead of a generic zero-candidate message. |
| Tracking / accounts | Tracking route already displayed In progress. Added one explicit false feature switch covering retained tracking entry points/components. No WillowFlow-specific files found. Python login/account code remains archived and excluded from deployment. |
| FFmpeg third party | Core fetched jsDelivr at runtime; confirmed in source. Pinned core package is now copied to same-origin static assets at build/dev and the privacy text updated. |
| Branding | /highlights title/H1 used Clip Farmer. Both now use Flipper; nav retains Clip Farmer as requested. |

## Validation boundaries

The harness runs the actual application pipeline through a filesystem-backed native adapter or the pinned WASM engine in Node.
It verifies synthetic source frame IDs and beeps; it does not establish audio classification
accuracy, phone-browser codec support, UI rendering, WASM memory capacity or long-session limits.
New browser UI verification has not been performed because browser access was previously declined.
All video processing remains local; only generated synthetic test fixtures are used by the native check.

Actual WASM binary SHA256 (ESM, UMD and self-hosted build copy all match):
`9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7`.

Both engines pass the frame/beep checks after replacing the early video-frame termination with
a shared time bound, which permits the final lossless audio packet to finish. Compatibility fixtures
produce 33 frames for a 1.1-second export; rotation is 180x320, silence remains audio-free, and VFR
normalizes to 30fps. The 31MB WASM asset is generated at build time and fits the hosting static-file limit.

Final checks: 77 unit/regression tests, typecheck, lint, production build, native export integration, actual pinned WASM integration in Node, and a production-only dependency audit with zero reported vulnerabilities.

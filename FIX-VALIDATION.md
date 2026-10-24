# Clip Farmer simplification — 24 October 2026

Branch: `codex/simplify-clipping`. Everything remains browser-local and free; no accounts or uploads were added.

## Changes

- One explicitly saved MP4 replaces the multipart export loop. No automatic next-part creation or unsolicited downloads.
- Original stream-copy for smaller selections; automatic compact encoding for large estimates, with an explicit quality override.
- Conservative single-file budgets avoid likely memory failures. Over-budget selections explain how to reduce size rather than producing ten files.
- Preview before Save, cancel export, reversible exclusions, select all/none, and collapsed advanced detection settings.
- Optional tracking controls, disabled by default; selected clips can be analyzed sequentially.
- FFT and speech-feature extraction moved to a worker. UI remains usable while scanning. Settings reuse extracted features.
- Explicit FFmpeg core caching and object-URL cleanup reduce redundant downloads and memory retention across engine restarts.
- Frame capture no longer waits for a seek event when already at the requested time. Timed-out playback cancels callbacks and pauses the decoder. Incomplete captures retry instead of being accepted as complete.
- Track prediction and scoring use elapsed presentation time rather than assuming every frame is equally spaced. Overlay gaps are dashed.

## Recognition comparison

Re-ran the existing three labeled recordings with the existing evaluator's broad matching window (release −0.8s through release +2.6s). This measures delivery coverage, **not exact bat-contact timing**.

| Recording | Balanced: found / false | Noisy hall: found / false |
| --- | --- | --- |
| netsA, 19 deliveries | 17 / 0 | 14 / 0 |
| netsB, 21 deliveries | 20 / 0 | 20 / 0 |
| chatterW, 10 deliveries | 8 / 13 | 7 / 5 |

Noisy hall is an optional, uncalibrated heuristic: onset rise ≥15 dB and robust onset z ≥20, after the existing speech rejection. It is not a new trained recognition model. These recordings were inspected during development, so this is a regression/development comparison, not an independent held-out generalization claim. Balanced remains the default because noisy mode misses softer shots. A new full-session test is still needed.

Reproduce using 16 kHz mono signed 16-bit PCM named `netsA.s16`, `netsB.s16`, and `chatterW.s16`:

```sh
node --experimental-strip-types scripts/deliveries/eval.mts <audio-directory>
```

## Checks completed

- 13 unit/regression tests passed, including uneven frame timing, export budgets, and speech/noisy filtering.
- TypeScript, ESLint, and a webpack production build passed.
- Browser: local 138-second MP4 scanned successfully; noisy mode reduced displayed candidate clips from 21 to 12 without rescanning.
- Browser: original-quality highlights created and explicitly downloaded as one 3.7 MB MP4. Fast keyframe cuts expanded 30 selected seconds to about 36.5 seconds. Native validation reported a duplicate presentation timestamp at one boundary: use compact exact cuts when boundary fidelity matters.
- Browser: compact export produced a previewable 5.8 MB MP4. A low-bitrate source can become larger after re-encoding; “compact” is a bounded output mode, not a guarantee of reduction for every source.
- Browser: canceling a rebuild preserved the recording, clips, and prior completed export.
- Browser: tracking completed on a noisy sample and correctly reported no supported ball path instead of inventing a speed.

## Limits

No new ball weights were trained. Detection quality beyond the measured samples is unknown. Speed/length formulas still depend on assumed distance, first-visible-ball timing, and simplified flight dynamics, and are labeled as estimates. There is no radar validation, metric 3D reconstruction, or validated swing/spin measurement.

Large 4K/iPhone sessions and actual iOS memory behavior have not been verified in this environment. Compact exports cost CPU time. Browser codec support, available memory, and storage policy still vary by device.

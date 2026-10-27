# Clip Farmer and Speed Check

## Scope

Two independent visible tools. Clip Farmer keeps accepted shots from a long session and exports one MP4. Speed Check accepts one short delivery (up to 15 seconds). Pitch maps, line, length and the combined tracking dashboard are no longer in the user flow.

Five minutes is an example of output duration, **not a target, cap, quota or reason to discard good shots**. Sixty five-second shots would be about five minutes; actual selection duration determines the output.

## Clipping

Mediabunny reads local file ranges and uses WebCodecs to decode presentation-timestamped frames independently of video playback or screen refresh. Audio is decoded locally into mono 16kHz PCM; unsupported audio codecs retain the FFmpeg fallback. The source file is never uploaded. FFmpeg mounts it read-only for export and returns a single preview/download.

The strict pipeline finds audio onsets, measures motion, and checks incoming ball tracks around audio candidates. Only candidates passing the flight gate enter automatic selection. Unverified sounds and movement-only events stay in the optional review list. Explicitly including an unverified event is a user override, not model verification.

This prioritizes precision over recall. The existing small ball classifier misses many real deliveries. This change does **not** establish zero false positives or complete shot recall. The old audio/motion benchmark is not a validation of the new flight-verification pipeline. A labeled, held-out set including speech, footsteps, adjacent lanes, bat taps, returns and actual shots is required before making accuracy claims.

## Speed

Actual presentation timestamps replace playback sampling and nominal-fps guesses. Automatic incoming-ball analysis is attempted; when it cannot establish release, the user can step between the file's actual frame timestamps and mark release and visible bat contact. Manual timing remains available after an automatic failure or missing audio.

Speed is average release-to-contact distance divided by flight time. It is not radar release speed. Distance must be measured; 17.68m is an explicit starting assumption. Audio contact is corrected for microphone propagation delay using the configured behind-bowler camera location, approximately `(behind + 20.12 - 1.22)/343` seconds. Visually marked contact needs no acoustic correction. This simple axial camera/contact distance is itself approximate.

Displayed tolerance bounds assume ±0.5m and one frame at each event; they do not bound mistakes in track identity, first-visible-ball versus actual release, A/V offset, time-stretched recordings or camera geometry. No speed is radar validated. Automatic estimates are labeled unverified; reviewing marks does not make the detector independently validated.

## Reference principles

- Fulltrack publicly requires controlled phone/tripod placement and visible stumps: https://www.fulltrack.ai/faq
- Its proprietary full speed algorithm is not reproduced here. A published comparison used simultaneous radar and phone measurements across 1,081 deliveries: https://research.monash.edu/en/publications/a-comparison-of-fulltrack-ai-application-as-an-alternative-to-rad/
- Local, lazy file reading and frame-accurate decoding API: https://mediabunny.dev/guide/reading-media-files

## Checks

Unit checks cover speed arithmetic, acoustic correction, input tolerances and invalid inputs, alongside existing detection/tracking tests. Browser testing must distinguish successful file decoding/export from actual measurement accuracy. A generated excerpt of an existing recording is a local functional fixture, not new ground truth or a held-out accuracy benchmark.

### Browser observations for this revision

- A 2.5s excerpt of an existing indoor delivery passed the strict flight gate (1/1 candidate selected).
- The 2m18s noisy WhatsApp session decoded with 100% coverage. Strict mode selected just one candidate near 70s from 13 combined candidates. The existing annotations list ten real deliveries, so recall is currently poor; this is **not** a finished automatic clipping detector. The three user-rejected early clips were not auto-selected.
- Automatic speed failed safely on the first indoor delivery. Frame stepping reached actual PTS values 1.433343 and 1.833343 seconds, and manual timing produced the expected distance/time calculation. These were functional test marks, not radar-validated release/contact ground truth.
- Unit tests (26) and the production build pass. No 30-minute source session or radar-ground-truth test was available in this verification run.

Exact 720p cuts are the default for the strict clipper. The first export check showed that stream-copy cuts included about half a second of keyframe lead-in; strict mode therefore re-encodes cut boundaries instead of preserving that extra footage. This costs export time.

# Full-session delivery candidates

This adds the default detection mode to Clip Farmer. It watches a recording for action-sized motion, associates those candidates with audio impacts, and adds visual-only clips when no contact is heard. This can include misses and leaves, but it does not classify every action as a true bowling delivery. Walking, camera shake, other lanes, and returns can still cause false clips.

## Usage

1. Choose your recording.
2. The full video check starts after the audio pass. Keep the tab visible.
3. Use **Scan again** to retry, or select audio-only mode for a faster but noisier result.
4. Review candidates, especially those labeled **Visual candidate — verify**, before exporting.
5. Adjust Visual sensitivity using cached results, without re-decoding the session.

The scanner uses the browser native decoder at an initial 2x playback rate. It samples about five 160x160 grayscale images per second, keeps only two frame buffers, and retains a compact motion timeline. It slows down when decoding repeatedly drops samples. Full 4K decode still costs time; downsampling the canvas does not eliminate source decoding.

Coverage is reported. Missing decoded intervals do not count as evidence of no bowling action. The scan can be canceled, and decoder stalls fail with an actionable message instead of waiting indefinitely. No videos are uploaded.

## What is and is not measured

A visual motion peak is an **action candidate**, not a verified release or bat contact. Visual-only clips retain a null contact mark and therefore do not manufacture speed measurements. No contact timestamp is guessed by adding a flight-time constant.

There is no new neural network or Fulltrack implementation here. The existing audio detector is augmented with a lightweight temporal-motion heuristic. A robust bowling-action classifier needs more varied, independently labeled data.

## Reproducing regression checks

Prepare the existing named recordings using native FFmpeg:

```sh
ffmpeg -i session.mp4 -vn -ac 1 -ar 16000 -f s16le netsA.s16
ffmpeg -i session.mp4 -vf "fps=5,scale=160:160,format=gray" -f rawvideo netsA.motion
node --experimental-strip-types scripts/deliveries/eval-visual.mts <folder>
```

Repeat for netsB and chatterW. The evaluator reuses the existing broad release matching window; it measures delivery coverage, not precise contact detection. The recordings were used during development, so these are regression figures, not an independent generalization benchmark. Offline uniformly sampled video and browser-presented frames can produce different candidates.

## Development results

| Recording | Audio deliveries found | Combined deliveries found | Combined false candidates | Duplicates |
|---|---:|---:|---:|---:|
| netsA | 17/19 | 19/19 | 1 | 0 |
| netsB | 20/21 | 21/21 | 0 | 1 |
| chatterW | 8/10 | 9/10 | 4 | 1 |

These development recordings give 49/50 matched deliveries, with five false candidates and two duplicates. This is not a claim of 98% real-world accuracy.

User review identified audio-only clip starts 0.0, 8.6, and 13.1 seconds in chatterW as false on October 24. These corrections are retained separately in labels.json. Broad release matching alone is insufficient to validate individual clips. The current heuristic still needs review; whole-frame movement is not a bowling-action classifier.

## Reliability update

The native playback pass now slows immediately on dropped samples, then seeks through missing intervals with 2.2 seconds of overlap. Frame coverage is computed from observed timestamps. No new video files or model downloads are required.

Unmatched audio in missing or boundary intervals is labeled **Unverified sound — review to include** and excluded from the default export selection. It remains visible and can be explicitly included; missing frames cannot prove a sound was a real delivery. Visual motion within 1.5 seconds after a matched contact is suppressed as likely follow-through, with the tradeoff that exceptionally rapid successive deliveries could require review.

The evaluator now separately reports suggested exports and candidates needing review, and fails if a user-confirmed false clip returns to automatic selection. It does not hardcode those timestamps into the detector.

Current suggested automatic exports (excluding unverified audio) match 48/50 annotated deliveries across these development sessions, with four false candidates and two duplicates. One additional real delivery remains in the review-only group. This distinguishes finding a candidate from confidently selecting it; the feature is still a heuristic and is not independently validated.

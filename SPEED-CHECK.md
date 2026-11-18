# Speed Check (experimental)

Speed Check takes one delivery filmed from behind the bowler and returns either an **average speed
from release to bat contact, with a range**, or **"Unable to measure reliably" with a specific reason**.
It runs entirely on the device. It is not validated against radar and stays behind a flag:
`SPEED_CHECK` in `lib/features.ts` is off in production; set `NEXT_PUBLIC_SPEED_CHECK=1` in
`.env.local` to try it locally.

Flow: **Upload delivery → Mark stumps (two taps, remembered) → Analyze → Review → Export MP4**.

## What one camera can measure

| Quantity | Measurable? | How |
| --- | --- | --- |
| Time between frames | Yes | Presentation timestamps, after removing repeated frames (see below). Slow motion only with the user's capture/playback rates. |
| Bat-contact time | Usually | The crack's onset, minus the sound's travel time to the camera (≈ 55–75 ms behind the bowler), ± a stated 20 ms audio/video tolerance. Or a contact frame marked by the user. |
| Release time | Partly | First frame with the ball clear of the hand. Seen from behind, the ball can move almost straight away from the camera just after release and sit still on screen, so this sighting can be late (measured: up to ~0.1 s at 24 fps). |
| Distance between release and contact | **No, not from pixels** | Taken from pitch landmarks: stumps-to-stumps (confirmed by the user) minus release 0.8–2.3 m and contact 0.3–2.7 m in front of the stumps. Both ranges are shown with every result. |
| Release speed (radar) | No | Would need the ball's 3D position over the first metres of flight. |

**Why a ground-plane pitch calibration does not locate the airborne ball.** Marking the stumps and
creases gives a mapping between the image and the pitch *surface*. A ball in the air projects to a
ray from the camera; every point along that ray produces the same pixel, and its height is
unknown. From behind the bowler that ray runs almost along the pitch, so a ball 1 m above the turf at
the batter and a ball near the turf several metres short of the batter can land on the same pixel.
Only the bounce is on the ground, and from behind it moves only a few pixels per metre of length at
the far end. That is why distance comes from where release and contact happen relative to the
stumps, not from tracked pixels — and why the "reached the batter" check is deliberately tight and
also requires the contact sound to coincide with the last sighting.

**Average vs release speed.** The number is distance ÷ time over the whole flight. A ball slows in
the air and at the bounce, so radar release speed is higher. The UI and the exported label say
"Average speed, release to bat · not release speed" and never call it radar-equivalent.

## What the previous implementation assumed (and why that gave wrong speeds)

Audited on `codex/reliability-checks` before any change (`components/video/speed-check.tsx`,
`lib/tracking/*`):

1. **Distance silently assumed**: 17.68 m (crease to crease) with ±0.5 m. Release and contact
   positions vary by metres; nets are often shorter than 20.12 m.
2. **Release = arm-whip peak (pose) or first point of the ball track.** The arm-whip is a cue, not the
   release. The ball-track fallback started on whatever moving blob was found first.
3. **Contact = strongest impact sound**, without checking that this ball reached the batter. In
   delivery A02 the only nearby sound would imply ~167 km/h; the ball was still well short of the
   batter (hidden by the follow-through).
4. **Frames decoded at 640 px.** The ball at the far end is 1–2 px.
5. **Repeated frames treated as real instants.** Both supplied net sessions are 24 fps content in
   30 fps files (every fifth frame repeated; re-encoded repeats are not bit-identical). Their PTS are
   not capture times, and three-frame differencing sees no motion on a repeat.
6. **Bounce detector required "down then up" screen motion**, which is wrong from behind the
   bowler, where a receding, falling ball can move up the screen. It reported "first seen after
   bounce" on 7 of 9 real deliveries.

## Method (lib/speed)

- `cadence.ts` — removes frame-rate-conversion repeats only when they form a regular pattern,
  re-times unique frames evenly and adds the largest shift (≈13 ms here) to every timing tolerance;
  keeps real gaps (VFR, dropped frames); divides by a known slow-motion factor.
- `track.ts` — follows one ball, starting near the release cue:
  1. MediaPipe pose (existing, local) finds the arm-whip and wrist: a *search cue only*.
  2. Moving blobs (three-frame differencing at up to 1280 px) inside a pitch-shaped zone between the
     hand and the far stumps; netting, trees and neighbouring nets are excluded.
  3. Seeds must head towards the batter's end; each next point must fall in a tight gate around a
     short-history prediction; a chain is cut at the first point far from its prediction.
  4. Appearance: each point must still look like the ball seen one point earlier, so a track ends
     where the ball goes behind a head or shirt instead of sliding along its edge.
  5. Near the hand, the ball is found backwards by its own image patch (multi-scale) *and* only on
     the backward continuation of free flight, because a ball in the hand looks identical.
  6. Up to two missing frames may be bridged; bridged points stay "predicted" (hollow rings) and a
     track never starts or ends on one. One bounce is allowed as an abrupt upward change, and
     prediction restarts after it instead of fitting one curve through it.
- `analyze.ts` — the whole decision with a list of checks: timing, ball path, release (edge of
  picture, distance from the hand, optional pose confirmation of hand separation), reaching the
  batter, contact sound coinciding with arrival (missing, ambiguous, or long after the ball was lost
  → refused), plausibility.
- `measure.ts` — interval arithmetic: low = shortest distance ÷ longest time, high = longest distance
  ÷ shortest time. No confidence percentage is computed. Refuses when the range is wider than ±30 %.
- `overlay.ts`, `export.ts` — one drawing routine for review and export. Export re-encodes with
  WebCodecs via Mediabunny (already a dependency), keeps the original audio, bakes rotation in,
  and has progress and Cancel.

**Release bracket.** Without hand evidence the release is allowed from 0.1 s before the first free
sighting to one frame after it (dev clips: sightings 0–2 frames late, sometimes 1 early). If pose
wrists show the ball at the hand in the previous frame and clear of it at the sighting, the bracket
narrows to that one frame interval. On 24 fps footage, an unconfirmed release makes the range too
wide, so such clips are refused. That is intended.

### Open-source detectors considered

| Option | License / weights | Fit here |
| --- | --- | --- |
| TrackNetV3 (badminton) | MIT per mirrors (verify upstream); Google Drive checkpoints | Trained on broadcast side views of a shuttlecock; PyTorch, would need conversion and cricket retraining. Not used. |
| WASB-SBDT (BMVC 2023) | MIT | Strong multi-sport baseline (soccer, tennis, badminton, volleyball, basketball); no cricket weights; heavy for phone browsers. A candidate if behind-bowler cricket data is collected. |
| Ultralytics YOLO "sports ball" | AGPL-3.0 (commercial use needs a paid licence) | Licence conflicts with a free closed deployment; generic COCO balls are poor on 2–5 px blurred balls. Not used. |
| Existing blob classifier (`ball-model.json`) | in-repo | Trained at 640 px; kept for Ball Tracking, not used by Speed Check. |

No new dependency or model was added. The behind-bowler problem here was not appearance (the ball
was found within ~1 px in most frames) but association, occlusion and release timing.

## Evaluation (scripts/speed-eval)

Evidence: two behind-the-bowler net sessions (outdoor TSIL5070 "A", indoor "B"; iPhone HEVC,
24 fps content in 30 fps files, one with a dropped frame). Ball positions, release frames and
occlusion were annotated by eye on full-resolution crops. Where the tracker proposed a point it was
recorded only if it visibly sat on the ball. The annotator was an AI agent, not an independent human
reviewer. **No radar or other speed reference exists for any clip, so speed accuracy is not
established.**

Splits: `tune` (A02, B01) designed the tracker. `dev` (A03, A05, A07) was v1's holdout, then used to
fix v1's failures; A09/A10 were viewed while fixing release timing. `holdout` (A11, A12) was
annotated and scored only with the frozen final tracker.

| | Old tracker (flight end *given*) | New tracker |
| --- | --- | --- |
| Annotated ball frames found (≤6 px) | 39 / 86 | **78 / 86** |
| Tracked points not on the ball | 7 | **0** (incl. 0 on frames where the ball was hidden) |
| Median position error | – | 0.25–1.16 px per delivery (1280-px frames) |
| Release frame located | 0 / 9 ("first seen after bounce") | 8 / 8 with hand visible: error −1, 0, 0, 0, +1, +1, +2, +2 frames |
| Holdout A11/A12 | 6/9, 7/9 | 9/9, 9/9; max error 0.6 px; release 0 and +1 frame |

End-to-end decisions with real audio and simulated pose cues (MediaPipe cannot run in Node; cues are
taken from the annotation ±0.1 s/±20 px): **9/9 correctly refused, 0 measured.**

- Outdoor (A): the follow-through hides the ball before the batter on every reviewed delivery.
- Indoor (B): the bowler's hand is out of frame at release.

The old flow (no-pose path) refused 39 of 40 windows and produced one number (B17, 95.7 km/h)
from a release 0.28 s before the labelled time, on a session where the release is not visible.

Representative v1 failure (found on the then-holdout, now fixed): **A05 reported 82 km/h.** After the
ball went behind the bowler's head, the motion chain slid onto the shirt and ended inside the batter
zone; the release was also 2 frames late. v2 added the appearance-continuity check and the
sound-after-sighting rule.

Synthetic regression tests (`tests/speed-check.test.ts`) check maths and decisions, not real-world
accuracy:

- **Measured, truth inside the range:** clean 60 fps; 24 fps in a 30 fps file with confirmed
  release; 4× slow motion with a marked contact.
- **Refused:** occlusion, release out of view, missing/ambiguous sound, lone-still-frame handling.

Browser smoke test (dev server, synthetic 60 fps MP4 with a click):

- Pose ran and found no action, so the tool refused.
- After the manual "Mark release ball" step: 101 km/h (78–131), true 108.
- Export produced H.264 + AAC with the overlay burned in (pixel-checked).
- The mph toggle and the Clip Farmer page also worked.

Reproduce: see `scripts/speed-eval/README.md`.

## Filming guidance

- Tripod behind the bowler's end, **about 1 m to the side of the stumps and 2–2.5 m high**, so the
  follow-through does not hide the batter. Keep the bowler's whole arm at release and the batter's
  stumps in frame.
- Record at **60 fps or more at normal speed**. If you use slow motion, enter its capture and playback
  rates and mark the contact frame.
- Use the original camera file. Messaging and social apps re-encode, convert frame rates (repeated
  frames) and add music.
- Measure stumps-to-stumps once, especially in nets.
- Keep the bat contact audible; one delivery per clip, up to 15 s.
- Both supplied phone recordings are HEVC. Browsers without HEVC decoding cannot analyse them.

## Limitations and blockers

- No speed reference: accuracy against radar is unknown. Validating needs synchronized radar
  readings (or a calibrated second camera) for a set of deliveries, at several speeds and frame rates.
- Real footage that passes every check has not been seen yet: all real deliveries were refused.
- Pose release confirmation (narrow bracket) is implemented and synthetic-tested, but not validated
  on real clips with annotated hand separation. MediaPipe pose was not run on the evaluation clips.
- Release and contact distance ranges are generic. Measuring the bowler's front foot and the
  batter's position would narrow them.
- The 20 ms audio/video tolerance is assumed, not measured per device. Rolling shutter, motion blur,
  camera movement (handheld) and low resolution are not modelled. The camera must be still.
- Only one ball colour type (white) and two sessions were evaluated. Red/pink balls on turf,
  floodlights and more bowlers need data.
- Phone-browser performance and memory for 60–240 fps clips are not benchmarked. Frames are capped
  at ~350 MB.

## Swing (deferred)

Not included. Sideways screen movement from behind is not swing: perspective (the ball recedes
towards the vanishing point), the bowling angle (wide of or close to the stumps), camera offset or
motion, and the bounce all bend the 2D path. A defensible measurement needs the ball's **3D**
trajectory:

- a calibrated camera (intrinsics plus pose from known pitch marks);
- ideally a second synchronized view (side-on) or a high-mounted view;
- ≥120 fps;
- a physics fit with gravity and drag where lateral acceleration is the residual;
- validation against a reference system on known deliveries.

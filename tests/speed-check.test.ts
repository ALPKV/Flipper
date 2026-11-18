import assert from "node:assert/strict";
import { test } from "node:test";
import type { Gray } from "../lib/tracking/core.ts";
import { analyzeCadence } from "../lib/speed/cadence.ts";
import { ASSUMPTIONS, isRefusal, kmhToMph, measureSpeed, type SpeedResult } from "../lib/speed/measure.ts";
import { analyzeDelivery, inBatterZone, LATE_SIGHTING_ALLOWANCE_S, type DeliveryInput } from "../lib/speed/analyze.ts";
import { drawOverlay, type OverlayData } from "../lib/speed/overlay.ts";
import { synthDelivery, type Synth } from "./speed-synthetic.ts";

const cal = { pitchM: 20.12, cameraBehindM: [2, 4] as const };

// ---------- Frame timing ----------

function noisy(n: number, w = 40, h = 30, seed = 1): Gray[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return Array.from({ length: n }, () => ({ data: Uint8Array.from({ length: w * h }, () => 60 + Math.floor(rnd() * 40)), w, h }));
}

test("repeated frames from 24->30 fps conversion are removed and unique frames re-timed at the capture rate", () => {
  // 24 fps capture shown at 30 fps: every 5th frame repeats the previous one.
  const unique = noisy(24);
  const frames: Gray[] = [], pts: number[] = [];
  let u = 0;
  for (let i = 0; i < 30; i++) {
    frames.push(i % 5 === 4 ? frames[frames.length - 1] : unique[u++]);
    pts.push(i / 30);
  }
  const c = analyzeCadence(frames, pts);
  assert.equal(c.repeats, 6);
  assert.equal(c.unique.length, 24);
  assert.ok(Math.abs(1 / c.frameSeconds - 24) < 0.6, `capture rate ${1 / c.frameSeconds}`);
  assert.ok(c.retimeError > 0 && c.retimeError < 1 / 30);
  assert.match(c.notes.join(" "), /converted from about 24 fps/);
});

test("a lone still frame is not mistaken for frame-rate conversion", () => {
  const frames = noisy(12);
  frames[6] = frames[5]; // one identical frame in an otherwise normal clip (a still moment)
  const c = analyzeCadence(frames, frames.map((_, i) => i / 30));
  assert.equal(c.repeats, 0);
  assert.equal(c.retimeError, 0);
  assert.match(c.notes.join(" "), /kept/);
});

test("variable frame rate keeps real gaps instead of assuming a fixed fps", () => {
  const frames = noisy(10);
  const pts = [0, 1, 2, 3, 5, 6, 7, 8, 9, 10].map((k) => k / 30); // one dropped frame
  const c = analyzeCadence(frames, pts);
  assert.equal(c.repeats, 0);
  assert.equal(c.retimeError, 0);
  assert.ok(Math.abs(c.maxGap - 2 / 30) < 1e-9);
  assert.deepEqual(c.times, pts);
  assert.match(c.notes.join(" "), /dropped frames/);
});

test("known slow motion divides video time into real time", () => {
  const c = analyzeCadence(noisy(8), [0, 1, 2, 3, 4, 5, 6, 7].map((k) => k / 30), 8);
  assert.ok(Math.abs(c.frameSeconds - 1 / 240) < 1e-12);
  assert.throws(() => analyzeCadence(noisy(4), [0, 0.1, 0.1, 0.2]), /increase/);
  assert.throws(() => analyzeCadence(noisy(4), [0, 0.1, 0.2, 0.3], 0.5), /Slow-motion/);
});

// ---------- Measurement ----------

test("average speed uses the measured interval, the sound delay and stated distance tolerances", () => {
  const r = measureSpeed({ release: [1.0, 1.0], contact: { kind: "sound", t: 1.6 }, retimeError: 0 }, { pitchM: 20.12, cameraBehindM: [3, 3] }) as SpeedResult;
  assert.ok(!isRefusal(r));
  const [ra0, ra1] = ASSUMPTIONS.releaseAheadM, [ca0, ca1] = ASSUMPTIONS.contactAheadM;
  const Dm = 20.12 - (ra0 + ra1) / 2 - (ca0 + ca1) / 2;
  // Sound path from contact back to the camera, then the A/V tolerance on both sides.
  const delayMid = ((20.12 - ca1 + 3) / 343 + (20.12 - ca0 + 3) / 343) / 2;
  assert.ok(Math.abs(r.kmh - 3.6 * Dm / (0.6 - delayMid)) < 1e-6);
  assert.ok(r.low < r.kmh && r.kmh < r.high);
  assert.deepEqual(r.distanceM, [20.12 - ra1 - ca1, 20.12 - ra0 - ca0]);
});

test("a contact frame marked on the video needs no sound-travel correction", () => {
  const r = measureSpeed({ release: [1, 1.0167], contact: { kind: "frame", bracket: [1.6, 1.6167] }, retimeError: 0 }, cal) as SpeedResult;
  assert.deepEqual(r.acousticDelayS, [0, 0]);
  assert.ok(Math.abs(r.flightSeconds[0] - (1.6 - 1.0167)) < 1e-9 && Math.abs(r.flightSeconds[1] - 0.6167) < 1e-9);
});

test("wider timing evidence widens the range; it never narrows it", () => {
  const tight = measureSpeed({ release: [1, 1.004], contact: { kind: "frame", bracket: [1.6, 1.604] }, retimeError: 0 }, cal) as SpeedResult;
  const loose = measureSpeed({ release: [0.96, 1.04], contact: { kind: "frame", bracket: [1.6, 1.604] }, retimeError: 0.01 }, cal) as SpeedResult;
  assert.ok(loose.high - loose.low > tight.high - tight.low);
});

test("implausible or too-uncertain timings are refused with a reason, never a number", () => {
  const cases: [Parameters<typeof measureSpeed>[0], Parameters<typeof measureSpeed>[1], RegExp][] = [
    [{ release: [1, 1], contact: { kind: "sound", t: 1.2 }, retimeError: 0 }, cal, /too soon/],
    [{ release: [1, 1], contact: { kind: "sound", t: 3.5 }, retimeError: 0 }, cal, /too far apart/],
    [{ release: [1, 1], contact: { kind: "sound", t: 1.33 }, retimeError: 0 }, cal, /not a plausible delivery/],
    [{ release: [0.8, 1.2], contact: { kind: "sound", t: 1.6 }, retimeError: 0 }, cal, /too uncertain/],
    [{ release: [1, 1], contact: { kind: "sound", t: 1.6 }, retimeError: 0 }, { pitchM: 40, cameraBehindM: [2, 4] }, /between 10 and 22/],
    [{ release: [1.1, 1], contact: { kind: "sound", t: 1.6 }, retimeError: 0 }, cal, /invalid/],
    [{ release: [1, 1], contact: { kind: "sound", t: NaN }, retimeError: 0 }, cal, /Missing/],
  ];
  for (const [e, c, re] of cases) {
    const r = measureSpeed(e, c);
    assert.ok(isRefusal(r), `expected refusal for ${JSON.stringify(e)}`);
    assert.match(r.reason, re);
  }
  assert.ok(Math.abs(kmhToMph(160.9344) - 100) < 1e-9);
});

// ---------- Tracking and the whole decision on synthetic deliveries ----------

function input(s: Synth, over: Partial<DeliveryInput> = {}): DeliveryInput {
  const ri = s.pts.findIndex((t) => t >= s.releaseT);
  return {
    frames: s.frames, pts: s.pts, slowFactor: 1, farStumps: { base: s.farBase, top: s.farTop },
    release: { t: s.releaseT - 0.03, x: s.hand[ri].x, y: s.hand[ri].y, source: "pose" },
    sounds: [{ t: s.soundT, rel: 0 }], calibration: { pitchM: s.pitchM, cameraBehindM: [s.behind - 1, s.behind + 1] }, ...over,
  };
}

test("a clean synthetic delivery is tracked from release to the batter and measured with the truth inside the range", () => {
  const s = synthDelivery({ distractors: true });
  const a = analyzeDelivery(input(s));
  assert.ok(!isRefusal(a.result), isRefusal(a.result) ? a.result.reason : "");
  const r = a.result as SpeedResult;
  assert.ok(r.low <= s.trueAverageKmh && s.trueAverageKmh <= r.high, `${r.low}-${r.high} vs ${s.trueAverageKmh}`);
  // Every observed point lies on the true ball (no net knot or other net's ball).
  for (const p of a.points.filter((q) => q.observed)) {
    const i = s.pts.findIndex((t) => Math.abs(t - p.pts) < 1e-6);
    const tr = s.truth[i];
    assert.ok(tr && tr.free, `point at ${p.pts} on a frame without a free ball`);
    assert.ok(Math.hypot(tr.x - p.x, tr.y - p.y) < 2.5, `point at ${p.pts} is ${Math.hypot(tr.x - p.x, tr.y - p.y).toFixed(1)} px off`);
  }
  // First free sighting within one frame of the true release; bounce found near the true bounce.
  assert.ok(Math.abs(a.release!.firstFreePts - s.releaseT) <= 1 / 60 + 1e-9);
  assert.ok(a.bounce && Math.abs(a.bounce.pts - s.bounceT) <= 2 / 60, `bounce ${a.bounce?.pts} vs ${s.bounceT}`);
  assert.equal(a.points.filter((p) => !p.observed).length, 0);
});

test("pose wrists showing the ball leave the hand narrow the release bracket to one frame", () => {
  const s = synthDelivery();
  const loose = analyzeDelivery(input(s));
  const k = s.pts.findIndex((t) => Math.abs(t - loose.release!.firstFreePts) < 1e-6);
  // Wrist at the ball in the frame before the first free sighting, well clear of it at that sighting.
  const prevBall = s.truth[k - 1]!;
  const confirmed = analyzeDelivery(input(s, { releaseConfirmation: { before: [{ x: prevBall.x, y: prevBall.y + 3 }], at: [{ x: s.hand[k].x, y: s.hand[k].y + 40 }], torsoPx: 20 } }));
  assert.equal(confirmed.release!.confirmed, true);
  assert.ok(Math.abs(confirmed.release!.bracket[1] - confirmed.release!.bracket[0] - 1 / 60) < 1e-6);
  assert.ok(loose.release!.bracket[1] - loose.release!.bracket[0] >= LATE_SIGHTING_ALLOWANCE_S);
  const a = confirmed.result as SpeedResult, b = loose.result as SpeedResult;
  assert.ok(a.high - a.low < b.high - b.low);
});

test("24 fps footage in a 30 fps file: repeats removed; refused unless the release is confirmed at the hand", () => {
  const s = synthDelivery({ fps: 30, repeatEvery: 5, speed: 28 });
  const loose = analyzeDelivery(input(s));
  assert.ok(loose.cadence.repeats > 0);
  assert.ok(Math.abs(1 / loose.cadence.frameSeconds - 24) < 1);
  assert.match((loose.result as { reason: string }).reason, /too uncertain/);
  const k = loose.cadence.unique.findIndex((i) => Math.abs(s.pts[i] - loose.release!.firstFreePts) < 1e-6);
  const prevBall = s.truth[loose.cadence.unique[k - 1]]!, atHand = s.hand[loose.cadence.unique[k]];
  const a = analyzeDelivery(input(s, { releaseConfirmation: { before: [{ x: prevBall.x, y: prevBall.y + 3 }], at: [{ x: atHand.x, y: atHand.y + 40 }], torsoPx: 20 } }));
  assert.ok(!isRefusal(a.result), isRefusal(a.result) ? a.result.reason : "");
  const r = a.result as SpeedResult;
  assert.ok(r.low <= s.trueAverageKmh && s.trueAverageKmh <= r.high, `${r.low}-${r.high} vs ${s.trueAverageKmh}`);
});

test("a ball hidden by the follow-through before the batter is refused, and nothing is drawn behind the body", () => {
  const s = synthDelivery({ occludeFrom: 0.8 });
  const a = analyzeDelivery(input(s));
  assert.ok(isRefusal(a.result));
  assert.match(a.result.reason, /lost before it reached the batter/);
  assert.ok(a.points.every((p) => p.pts < 0.8 + 1e-6), "tracked points after the ball was hidden");
});

test("a release outside the picture is refused, not guessed", () => {
  const s = synthDelivery({ releaseOutOfView: true });
  const noCue = analyzeDelivery(input(s, { release: null }));
  assert.match((noCue.result as { reason: string }).reason, /No bowling action/);
});

test("missing or ambiguous bat contact sounds are refused", () => {
  const s = synthDelivery();
  assert.match((analyzeDelivery(input(s, { sounds: [] })).result as { reason: string }).reason, /No bat-contact sound/);
  assert.match((analyzeDelivery(input(s, { sounds: [{ t: s.soundT, rel: 0 }, { t: s.soundT + 0.05, rel: -1 }] })).result as { reason: string }).reason, /ambiguous/);
  // A loud sound long before the ball arrives is not used as contact.
  assert.match((analyzeDelivery(input(s, { sounds: [{ t: s.releaseT + 0.2, rel: 0 }] })).result as { reason: string }).reason, /No bat-contact sound/);
});

test("slow motion needs a marked contact frame and then uses real time", () => {
  const s = synthDelivery();
  // Pretend the 60 fps clip is 4x slow motion: video time is 4x real time.
  const slow = { ...s, pts: s.pts.map((t) => t * 4) };
  const base = input(s);
  const cue = { ...base.release!, t: s.releaseT - 0.03 };
  const noFrame = analyzeDelivery({ ...base, pts: slow.pts, slowFactor: 4, release: cue });
  assert.match((noFrame.result as { reason: string }).reason, /slow-motion/i);
  const ci = s.pts.findIndex((t) => t >= s.contactT);
  const marked = analyzeDelivery({ ...base, pts: slow.pts, slowFactor: 4, release: cue, contactFrames: [slow.pts[ci - 1], slow.pts[ci]] });
  assert.ok(!isRefusal(marked.result), isRefusal(marked.result) ? marked.result.reason : "");
  const r = marked.result as SpeedResult;
  assert.ok(r.low <= s.trueAverageKmh && s.trueAverageKmh <= r.high);
});

test("the batter zone is tight vertically, because height and distance are confused from behind", () => {
  const base = { x: 100, y: 200 }, top = { x: 100, y: 180 };
  assert.ok(inBatterZone({ x: 110, y: 170 }, base, top));
  assert.ok(!inBatterZone({ x: 110, y: 140 }, base, top)); // higher than ~1.6 m above the stumps' base
  assert.ok(!inBatterZone({ x: 160, y: 190 }, base, top));
});

// ---------- Overlay ----------

test("the overlay never draws a point before its frame or a predicted point as a filled dot", () => {
  const calls: { kind: string; x: number; y: number }[] = [];
  let pending: { x: number; y: number } | null = null;
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, fillRect() {}, fillText() {},
    arc(x: number, y: number) { pending = { x, y }; },
    stroke() { if (pending) calls.push({ kind: "ring", ...pending }); pending = null; },
    fill() { if (pending) calls.push({ kind: "dot", ...pending }); pending = null; },
    measureText: () => ({ width: 10 }),
    lineWidth: 1, strokeStyle: "", fillStyle: "", globalAlpha: 1, font: "", textBaseline: "top", lineJoin: "round", lineCap: "round",
  } as unknown as Parameters<typeof drawOverlay>[0];
  const data: OverlayData = {
    points: [{ pts: 1, x: 0.1, y: 0.1, observed: true }, { pts: 1.1, x: 0.2, y: 0.2, observed: false }, { pts: 1.2, x: 0.3, y: 0.3, observed: true }],
    releasePts: 1, bounce: null, endPts: 1.2, title: "100 km/h", subtitle: "x", measured: true,
  };
  drawOverlay(ctx, 100, 100, data, 1.15);
  assert.deepEqual(calls.map((c) => c.kind), ["dot", "ring"]);
  assert.ok(calls.every((c) => c.x <= 20.0001));
});

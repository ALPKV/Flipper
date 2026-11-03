import assert from "node:assert/strict";
import { test } from "node:test";
import { timingFactor } from "../lib/tracking/video-timing.ts";
import { estimateSpeed } from "../lib/tracking/speed-estimate.ts";
test("normal, known slowdown and unknown playback remain distinct",()=>{
  assert.equal(timingFactor({mode:"normal",captureFps:240,playbackFps:30}),1);
  assert.equal(timingFactor({mode:"slow",captureFps:240,playbackFps:30}),8);
  assert.equal(timingFactor({mode:"slow",captureFps:120,playbackFps:25}),4.8);
  assert.equal(timingFactor({mode:"unknown",captureFps:120,playbackFps:30}),null);
  assert.equal(timingFactor({mode:"slow",captureFps:30,playbackFps:0}),null);
});
test("a known 8x slowdown yields the same physical speed and acoustic correction",()=>{
  const normal={release:1,contact:1.6+24/343,frameSeconds:1/120,distanceM:17.68,distanceErrorM:.5,soundDistanceM:24};
  const a=estimateSpeed(normal)!,b=estimateSpeed({...normal,release:8,contact:normal.contact*8,frameSeconds:normal.frameSeconds*8,videoTimeFactor:8})!;
  assert.ok(Math.abs(a.kmh-b.kmh)<1e-8);assert.ok(Math.abs(a.low-b.low)<1e-8);
  assert.equal(estimateSpeed({...normal,videoTimeFactor:null}),null);
});
test("pose release uncertainty widens bounds instead of pretending frame precision",()=>{
  const input={release:1,contact:1.6,frameSeconds:1/120,distanceM:17.68,distanceErrorM:.5,soundDistanceM:0};
  const a=estimateSpeed(input)!,b=estimateSpeed({...input,releaseUncertainty:.08})!;
  assert.equal(a.kmh,b.kmh);assert.ok(b.high-b.low>a.high-a.low);
});

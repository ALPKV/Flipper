import {test} from "node:test";
import assert from "node:assert/strict";
import {recordingMetadata} from "../lib/video/recording-metadata.ts";
import {beatReel} from "../lib/video/beat-reel.ts";
test("infinite or missing browser metadata cannot leave selected beat clips at zero",()=>{
 for(const current of [null,{duration:Infinity,width:1080,height:1920},{duration:NaN}]){
  const meta=recordingMetadata(current,{duration:30,width:1080,height:1920});
  assert.equal(meta?.duration,30);
  assert.equal(beatReel([{id:"sound",contact:3}],120,4,meta!.duration).cuts.length,1);
 }
});
test("known video metadata survives fallback and unknown duration stays explicit",()=>{
 assert.deepEqual(recordingMetadata({duration:40,width:1920,height:1080},{duration:35}),{duration:40,width:1920,height:1080});
 assert.equal(recordingMetadata({duration:Infinity},{duration:NaN}),null);
});

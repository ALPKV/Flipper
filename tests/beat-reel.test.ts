import assert from "node:assert/strict";
import {test} from "node:test";
import {beatReel} from "../lib/video/beat-reel.ts";
test("Waka Waka hits follow a 127 BPM grid without cumulative frame drift",()=>{
 const clips=Array.from({length:100},(_,i)=>({id:String(i),contact:3+i*4}));
 const {cuts,skipped}=beatReel(clips,127,4,405);
 assert.equal(cuts.length,100);assert.equal(skipped,0);
 let frames=0;
 for(let i=0;i<cuts.length;i++){
  const c=cuts[i];assert.ok(Math.abs(c.hitAt-(i+.5)*240/127)<=1/60+1e-8);
  assert.ok(Math.abs((frames/30)+(clips[i].contact-c.start)-c.hitAt)<1e-8);
  frames+=c.frames;
 }
 assert.ok(Math.abs(frames/30-100*240/127)<=1/60);
});
test("edge and overlapping candidates are reported rather than repeating source footage",()=>{
 const result=beatReel([{id:"early",contact:.1},{id:"a",contact:3},{id:"close",contact:3.2},{id:"b",contact:6},{id:"late",contact:9.9},{id:"manual",contact:null}],127,4,10);
 assert.deepEqual(result.cuts.map(c=>c.id),["a","b"]);assert.equal(result.skipped,4);
 assert.ok(result.cuts[1].start>=result.cuts[0].end);
});
test("invalid tempo and intervals cannot create a beat export",()=>{
 for(const [bpm,beats] of [[0,4],[NaN,4],[127,3],[300,4]])assert.equal(beatReel([{id:"a",contact:3}],bpm,beats,10).cuts.length,0);
});

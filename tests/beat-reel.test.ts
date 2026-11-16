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
test("all edge, close and manual candidates survive beat planning",()=>{
 const clips=[{id:"early",contact:.1},{id:"a",contact:3},{id:"close",contact:3.2},{id:"b",contact:6},{id:"late",contact:9.9},{id:"manual",contact:null,start:2,end:4}];
 const result=beatReel(clips,127,4,10);
 assert.deepEqual(result.cuts.map(c=>c.id),clips.map(c=>c.id));assert.equal(result.skipped,0);
 assert.ok(result.cuts[0].padBefore>0);assert.ok(result.cuts[4].padAfter>0);
 assert.ok(result.cuts[2].start<result.cuts[1].end);
 assert.ok(result.cuts.every(c=>c.start>=0&&c.end<=10&&c.end>c.start));
});
test("beat offset shifts the target without dropping clips or changing beat slots",()=>{
 const clips=[{id:"a",contact:3},{id:"b",contact:3.1}];
 const original=beatReel(clips,127,4,10),shifted=beatReel(clips,127,4,10,1);
 assert.equal(shifted.cuts.length,2);
 shifted.cuts.forEach((c,i)=>{assert.ok(Math.abs(c.start-original.cuts[i].start-1)<1e-8);assert.equal(c.hitAt,original.cuts[i].hitAt);});
});
test("invalid tempo and intervals cannot create a beat export",()=>{
 for(const [bpm,beats] of [[0,4],[NaN,4],[127,3],[300,4]])assert.equal(beatReel([{id:"a",contact:3}],bpm,beats,10).cuts.length,0);
});

test("edge padding fills every beat slot even when the recording is shorter than one slot",()=>{
 const clips=[{id:"first",contact:0},{id:"last",contact:.2},{id:"repeat",contact:.2}];
 for(const offset of [-15,0,15]){
  const {cuts,skipped}=beatReel(clips,127,8,.2,offset);
  assert.equal(skipped,0);assert.deepEqual(cuts.map(c=>c.id),clips.map(c=>c.id));
  for(const c of cuts)assert.ok(Math.abs(c.end-c.start+c.padBefore+c.padAfter-c.frames/30)<1e-8);
 }
});

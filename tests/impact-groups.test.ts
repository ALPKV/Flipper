import assert from "node:assert/strict";
import {test} from "node:test";
import {groupImpacts} from "../lib/video/impact-groups.ts";

test("one short burst uses its strongest sound without changing original detections",()=>{
 const sounds=[{t:2.3,levelDb:-30},{t:2,levelDb:-25},{t:2.15,levelDb:-5},{t:2.5,levelDb:-20}];
 const copy=sounds.map(s=>({...s}));
 const grouped=groupImpacts(sounds);
 assert.deepEqual(grouped,[sounds[2]]);
 assert.equal(grouped[0],sounds[2]);
 assert.deepEqual(sounds,copy);
 assert.equal(groupImpacts(sounds,0).length,4);
});

test("burst grouping never chains through a sequence of closely spaced detections",()=>{
 const sounds=Array.from({length:6},(_,i)=>({t:i*.4,levelDb:-30+i}));
 assert.deepEqual(groupImpacts(sounds),[sounds[1],sounds[3],sounds[5]]);
 const bridged=[{t:0,levelDb:-5},{t:.4,levelDb:-30},{t:.8,levelDb:-6}];
 assert.deepEqual(groupImpacts(bridged),[bridged[0],bridged[2]]);
});

test("separate deliveries survive even when their full clip windows overlap",()=>{
 const sounds=[{t:5,levelDb:-20},{t:5.1,levelDb:-30},{t:5.7,levelDb:-15},{t:5.8,levelDb:-35},{t:7,levelDb:-25}];
 assert.deepEqual(groupImpacts(sounds).map(s=>s.t),[5,5.7,7]);
});

test("the burst gap is configurable and equal levels choose the earliest onset",()=>{
 const sounds=[{t:1,levelDb:-10},{t:1.4,levelDb:-10},{t:1.6,levelDb:-5},{t:1.61,levelDb:-6}];
 assert.deepEqual(groupImpacts(sounds,.6).map(s=>s.t),[1.6]);
 assert.deepEqual(groupImpacts(sounds,.3).map(s=>s.t),[1,1.6]);
 assert.deepEqual(groupImpacts(sounds,.4).map(s=>s.t),[1,1.6]);
});

test("strongest-first grouping cannot leave duplicate anchors across a time-bucket boundary",()=>{
 const sounds=[{t:1,levelDb:-30},{t:1.59,levelDb:-8},{t:1.61,levelDb:-5},{t:2.3,levelDb:-6}];
 assert.deepEqual(groupImpacts(sounds),[sounds[0],sounds[2],sounds[3]]);
 for(const gap of [.4,.6,.8]){
  const grouped=groupImpacts(sounds,gap);
  for(let i=1;i<grouped.length;i++)assert.ok(grouped[i].t-grouped[i-1].t>gap);
 }
});

test("invalid timing is retained separately and invalid levels cannot displace a measured hit",()=>{
 const sounds=[{t:0,levelDb:NaN},{t:.2,levelDb:-10},{t:NaN,levelDb:-1},{t:Infinity,levelDb:0}];
 const grouped=groupImpacts(sounds);
 assert.equal(grouped.length,3);assert.equal(grouped[0],sounds[1]);
 assert.equal(grouped[1],sounds[2]);assert.equal(grouped[2],sounds[3]);
 assert.deepEqual(groupImpacts(sounds,NaN),sounds);
 assert.deepEqual(groupImpacts([]),[]);
});

import assert from "node:assert/strict";
import {test} from "node:test";
import {groupImpacts} from "../lib/video/impact-groups.ts";
import {clipWindows,deliveryId} from "../lib/tracking/deliveries.ts";
import {beatReel} from "../lib/video/beat-reel.ts";

test("echo reduction shortens a reel without moving the kept hits or changing beat timing",()=>{
 const sounds=[0,.15,.3,.45].flatMap(t=>[{t:5+t,levelDb:t===.15?-5:-30},{t:8+t,levelDb:t===.15?-7:-35}]);
 const kept=groupImpacts(sounds);
 assert.deepEqual(kept.map(s=>s.t),[5.15,8.15]);
 const windows=clipWindows(kept.map(s=>({t:s.t,rel:s.levelDb})),1.5,3,30,.2);
 const clips=windows.map(w=>({id:deliveryId(w.delivery),contact:w.delivery.t,start:w.start,end:w.end}));
 // A manually selected moment stays independent of automatic sound grouping.
 clips.push({id:"manual",contact:5.25,start:3.75,end:6.75});
 const reel=beatReel(clips,120,4,30,.2);
 assert.equal(reel.cuts.length,3);
 assert.equal(reel.cuts.reduce((n,c)=>n+c.frames,0)/30,6);
 for(let i=0;i<clips.length;i++)assert.ok(Math.abs(reel.cuts[i].start+1-clips[i].contact-.2)<1e-9);
 assert.equal(sounds.length,8,"original detections remain available when grouping is switched off");
});

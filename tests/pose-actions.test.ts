import assert from "node:assert/strict";
import { test } from "node:test";
import { bowlingActions, categorizeDeliveries, followThroughActions, type BodyFrame, type Joint, type PoseAction } from "../lib/tracking/pose-actions.ts";
const joint=(x:number,y:number):Joint=>({x,y,visibility:1});
function sequence(factor=1,slow=false):BodyFrame[] {
  const angles=[0,-.5,-1,-1.57,-2.3,-3,-3.8,-4.2];
  return angles.map((a,i)=>({t:i*(slow?.5:.1)*factor,id:1,joints:[
    joint(.45,.4),joint(.55,.4),joint(.45+.125*Math.cos(a),.4+.125*Math.sin(a)),joint(.6,.5),
    joint(.45+.25*Math.cos(a),.4+.25*Math.sin(a)),joint(.65,.6),joint(.46,.6),joint(.54,.6),
  ]}));
}
test("a multi-frame arm whip produces one action",()=>{
  const events=bowlingActions(sequence());assert.equal(events.length,1);
  assert.ok(Math.abs(events[0].t-.3)<.01);assert.equal(events[0].kind,"arm-whip");
});
test("a held raised arm and a gentle lift do not count as bowling",()=>{
  const raised=sequence().map(f=>({...f,joints:f.joints.map((j,k)=>k===4?joint(.45,.15):j)}));
  assert.equal(bowlingActions(raised).length,0);assert.equal(bowlingActions(sequence(1,true)).length,0);
});
test("identity switches and hidden wrists cannot stitch together a delivery",()=>{
  assert.equal(bowlingActions(sequence().map((f,i)=>({...f,id:i<3?1:2}))).length,0);
  assert.equal(bowlingActions(sequence().map(f=>({...f,joints:f.joints.map((j,k)=>k===4?{...j,visibility:.1}:j)}))).length,0);
});
test("known slow motion preserves the physical action and unknown scaling does not",()=>{
  const slow=sequence(8);assert.equal(bowlingActions(slow,8).length,1);assert.equal(bowlingActions(slow,1).length,0);
});
const action:PoseAction={t:1,id:1,arm:"left",confidence:.9,angularSpeed:8,uncertainty:.1,joints:[],kind:"arm-whip"};
test("sounds classify existing pose events, never create deliveries",()=>{
  assert.equal(categorizeDeliveries([],[{t:1.6,rel:0}]).length,0);
  assert.equal(categorizeDeliveries([action],[{t:1.6,rel:0}])[0].category,"contact");
  assert.equal(categorizeDeliveries([action],[{t:8,rel:0}])[0].category,"no-clear-contact");
  assert.equal(categorizeDeliveries([action],[{t:1.6,rel:0},{t:1.9,rel:-1}])[0].category,"ambiguous-sound");
});
test("walking back toward the camera is not a forward follow-through cue",()=>{
  const rows=sequence().map((f,i)=>({...f,joints:f.joints.map(j=>({...j,y:j.y+i*.01}))}));
  assert.equal(followThroughActions(rows).length,0);
});

test("competing people cannot claim the same contact",()=>{
 const events=categorizeDeliveries([action,{...action,id:2,t:1.1}],[{t:1.6,rel:0}]);
 assert.ok(events.every(e=>e.category==="ambiguous-sound"));
});

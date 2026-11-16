import {test} from "node:test";
import assert from "node:assert/strict";
import {previewPlan} from "../lib/video/preview-plan.ts";
import {planExport} from "../lib/video/export-plan.ts";
test("large full exports still get a bounded preview",()=>{
 const ranges=[{start:10,end:1810}];
 assert.equal(planExport(2e9,1800,1800,1,"compact",true).fits,false);
 const p=previewPlan(ranges);
 assert.deepEqual(p.ranges,[{start:10,end:100}]);assert.equal(p.limited,true);
 assert.deepEqual(ranges,[{start:10,end:1810}]);
});
test("preview preserves gaps and only includes complete beat slots",()=>{
 assert.deepEqual(previewPlan([{start:0,end:1},{start:5,end:7}],undefined,2).ranges,[{start:0,end:1},{start:5,end:6}]);
 const p=previewPlan([{start:0,end:2},{start:5,end:7}],[60,60],3);
 assert.deepEqual(p.ranges,[{start:0,end:2}]);assert.deepEqual(p.frameCounts,[60]);
});
test("empty selection produces an empty preview plan",()=>assert.equal(previewPlan([]).ranges.length,0));

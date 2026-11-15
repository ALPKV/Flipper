import {test} from "node:test";
import assert from "node:assert/strict";
import {reelRanges,reelPosition} from "../lib/video/reel-ranges.ts";
test("adjacent sound cuts become one render without losing selected footage",()=>{
 assert.deepEqual(reelRanges([{start:2,end:3},{start:0,end:1},{start:1,end:2},{start:2.5,end:4}]),[{start:0,end:4}]);
});
test("excluded gaps remain excluded and invalid ranges do not enter exports",()=>{
 assert.deepEqual(reelRanges([{start:0,end:1},{start:3,end:5},{start:5,end:5},{start:NaN,end:6}]),[{start:0,end:1},{start:3,end:5}]);
});
test("preview seek maps highlights time to source spans across cuts and the end",()=>{
 const ranges=[{start:10,end:12},{start:20,end:23}];
 assert.deepEqual(reelPosition(ranges,1),{index:0,time:11});
 assert.deepEqual(reelPosition(ranges,2),{index:1,time:20});
 assert.deepEqual(reelPosition(ranges,100),{index:1,time:23});
});

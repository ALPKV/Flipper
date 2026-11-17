import assert from "node:assert/strict";
import {test} from "node:test";
import {validateRecording,MAX_INPUT_BYTES,MAX_INPUT_SECONDS,RecordingInputError,NO_AUDIO_MESSAGE,PLAYBACK_MESSAGE} from "../lib/video/input-policy.ts";
test("file size and duration are bounded before allocating decoded audio",()=>{
 assert.doesNotThrow(()=>validateRecording(MAX_INPUT_BYTES,MAX_INPUT_SECONDS));
 for(const size of [0,NaN,Infinity,MAX_INPUT_BYTES+1])assert.throws(()=>validateRecording(size),RecordingInputError);
 for(const duration of [0,NaN,Infinity,MAX_INPUT_SECONDS+1])assert.throws(()=>validateRecording(100,duration),RecordingInputError);
 assert.throws(()=>validateRecording(MAX_INPUT_BYTES+1),/trim|1080p/i);
 assert.throws(()=>validateRecording(100,MAX_INPUT_SECONDS+1),/shorter sessions/i);
});
test("silent recording and unsupported playback have actionable, separate guidance",()=>{
 const error=new RecordingInputError("no-audio",NO_AUDIO_MESSAGE);
 assert.equal(error.code,"no-audio");assert.match(error.message,/manually/i);
 assert.match(PLAYBACK_MESSAGE,/H.264/);assert.match(PLAYBACK_MESSAGE,/Prepare preview/);
});

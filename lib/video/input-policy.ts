export const MAX_INPUT_BYTES=1024**3;
export const MAX_INPUT_SECONDS=7200;
export const INPUT_GUIDANCE="Safety limits: 1 GiB and 2 hours. For larger recordings, trim first or export at 1080p or 720p. Limits do not guarantee that every device can finish export.";
export const NO_AUDIO_MESSAGE="This video has no audio track, so sounds cannot be detected. Choose a recording with sound, or add clips manually using the original recording controls.";
export const PLAYBACK_MESSAGE="This browser cannot play the original video (some iPhone HEVC/MOV recordings need codec support). Sound analysis may still work: use Prepare preview for a local H.264 preview. If that also fails, convert the recording to H.264 MP4 on your device.";
export class RecordingInputError extends Error{
 code:"size"|"duration"|"video"|"no-audio";
 constructor(code:"size"|"duration"|"video"|"no-audio",message:string){super(message);this.code=code;this.name="RecordingInputError";}
}
export function validateRecording(size:number,duration?:number){
 if(!Number.isFinite(size)||size<=0)throw new RecordingInputError("size","This video is empty or unreadable. Choose another recording.");
 if(size>MAX_INPUT_BYTES)throw new RecordingInputError("size","This recording is larger than the 1 GiB safety limit. Trim it first or export it at 1080p or 720p, then try again. Nothing has been uploaded.");
 if(duration!==undefined&&(!Number.isFinite(duration)||duration<=0))throw new RecordingInputError("duration","The video duration could not be read. Re-save it as an H.264 MP4 on your device and try again.");
 if(duration!==undefined&&duration>MAX_INPUT_SECONDS)throw new RecordingInputError("duration","This recording is longer than the 2-hour safety limit. Trim it into shorter sessions on your device and try again.");
}

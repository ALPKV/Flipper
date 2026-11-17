export type RecordingMetadata={duration:number;width:number;height:number};
const positive=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n)&&n>0;
/** Some phone/WebM metadata reports Infinity or never fires. Decoding already knows duration. */
export function recordingMetadata(current:Partial<RecordingMetadata>|null,decoded:Partial<RecordingMetadata>):RecordingMetadata|null{
 const duration=positive(current?.duration)?current.duration:positive(decoded.duration)?decoded.duration:null;
 if(duration==null)return null;
 return {duration,width:positive(current?.width)?current.width:positive(decoded.width)?decoded.width:0,height:positive(current?.height)?current.height:positive(decoded.height)?decoded.height:0};
}

"use client";
import { timingFactor, type VideoTiming } from "@/lib/tracking/video-timing";
export function TimingControl({value,onChange,disabled=false}:{value:VideoTiming;onChange:(t:VideoTiming)=>void;disabled?:boolean}) {
  const factor=timingFactor(value);
  return <div className="space-y-3">
    <label className="block text-sm">Recording playback<select className="field mt-1" disabled={disabled} value={value.mode} onChange={e=>onChange({...value,mode:e.target.value as VideoTiming["mode"]})}><option value="normal">Normal speed</option><option value="slow">Constant slow motion — I know the recording settings</option><option value="unknown">Unknown or mixed-speed edit</option></select></label>
    {value.mode==="slow" ? <div className="grid grid-cols-2 gap-3"><label className="text-sm">Captured at (fps)<input className="field mt-1" type="number" min="1" max="960" disabled={disabled} value={value.captureFps} onChange={e=>onChange({...value,captureFps:Number(e.target.value)})}/></label><label className="text-sm">Export plays at (fps)<input className="field mt-1" type="number" min="1" max="240" disabled={disabled} value={value.playbackFps} onChange={e=>onChange({...value,playbackFps:Number(e.target.value)})}/></label></div> : null}
    <p className="text-xs text-mute">{factor==null?"Real elapsed time is unknown. Speed cannot be calculated. Use the original recording or a constant-speed section.":factor===1?"Normal footage: presentation timestamps represent real elapsed time.":`${factor.toFixed(2)}× slowdown: ${factor.toFixed(2)} video seconds represent one real second.`} A file&apos;s FPS alone cannot identify slow motion.</p>
  </div>;
}

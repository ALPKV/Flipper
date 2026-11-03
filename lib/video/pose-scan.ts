"use client";
import type { PoseAction } from "../tracking/pose-actions";
export type PoseScan={events:PoseAction[];duration:number;decoded:number;withPose:number;observed:number[]};

/** Terminating the worker also cancels its decoder and inference; no video or frames leave this device. */
export function scanPoses(file:File,signal:AbortSignal,progress:(p:number,phase:string)=>void,factor=1,hz=12):Promise<PoseScan> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException("Canceled","AbortError"));return;}
    const worker=new Worker(new URL("./pose-worker.ts",import.meta.url),{type:"module"});
    let timer:ReturnType<typeof setTimeout>;
    const finish=(result?:PoseScan,error?:Error)=>{clearTimeout(timer);signal.removeEventListener("abort",abort);worker.terminate();if(error)reject(error);else resolve(result!);};
    const abort=()=>finish(undefined,new DOMException("Canceled","AbortError"));
    const reset=()=>{clearTimeout(timer);timer=setTimeout(()=>finish(undefined,new Error("Pose analysis stalled. Try a shorter H.264 clip or a desktop browser.")),60000);};
    worker.onmessage=({data})=>{reset();if(data.error)finish(undefined,new Error(data.error));else if(data.result)finish(data.result);else if(data.progress!=null)progress(data.progress,data.phase);};
    worker.onerror=event=>finish(undefined,new Error(event.message||"The pose worker could not start. Try Chrome or Edge."));
    signal.addEventListener("abort",abort,{once:true});reset();worker.postMessage({file,factor,hz});
  });
}

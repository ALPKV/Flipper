import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { bowlingActions, followThroughActions, type BodyFrame, type PoseAction } from "../tracking/pose-actions";

const scope=self as unknown as { onmessage: ((event:MessageEvent)=>void)|null; postMessage:(v:unknown)=>void; location:Location };
scope.onmessage=async ({data}:{data:{file:File;factor:number;hz:number}})=> {
  let detector:PoseLandmarker|undefined;
  const input=new Input({formats:ALL_FORMATS,source:new BlobSource(data.file)});
  try {
    scope.postMessage({phase:"Loading pose model",progress:0});
    const root=scope.location.origin;
    const files=await FilesetResolver.forVisionTasks(`${root}/vendor/mediapipe`);
    detector=await PoseLandmarker.createFromOptions(files,{
      baseOptions:{modelAssetPath:`${root}/models/pose_landmarker_lite.task`,delegate:"CPU"},
      canvas:new OffscreenCanvas(256,256),runningMode:"VIDEO",numPoses:3,
      minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5,
    });
    const track=await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw new Error("Pose analysis needs a browser-supported video codec. Try an H.264 MP4.");
    const duration=await input.computeDuration();
    if (!Number.isFinite(duration)||duration<=0||duration>7200) throw new Error("Choose a recording shorter than two hours.");
    const scale=Math.min(1,720/Math.max(track.displayWidth,track.displayHeight));
    const sink=new CanvasSink(track,{width:Math.round(track.displayWidth*scale),height:Math.round(track.displayHeight*scale),fit:"fill",poolSize:1});
    const step=data.factor/data.hz;
    const start=await track.getFirstTimestamp();
    const timestamps=(function*(){for(let t=start;t<duration;t+=step)yield t;})();
    let last=-Infinity,nextId=1,decoded=0,withPose=0;
    const histories=new Map<number,BodyFrame[]>();
    const identities=new Map<number,{x:number;y:number;size:number;t:number}>();
    const events:PoseAction[]=[];
    const observed:number[]=[];
    for await(const frame of sink.canvasesAtTimestamps(timestamps)) {
      if (!frame || frame.timestamp<=last) continue;
      last=frame.timestamp;decoded++;observed.push(last);
      const result=detector.detectForVideo(frame.canvas,last*1000);
      if(result.landmarks.length)withPose++;
      const assigned=new Set<number>();
      for(const landmarks of result.landmarks) {
        const joints=[11,12,13,14,15,16,23,24].map(i=>({x:landmarks[i].x,y:landmarks[i].y,visibility:landmarks[i].visibility??0}));
        const x=(joints[6].x+joints[7].x)/2,y=(joints[6].y+joints[7].y)/2;
        const size=Math.hypot(x-(joints[0].x+joints[1].x)/2,y-(joints[0].y+joints[1].y)/2);
        let id=-1,cost=Infinity;
        for(const [candidate,old] of identities) {
          if(assigned.has(candidate)||(last-old.t)/data.factor>.6)continue;
          const jump=Math.hypot(x-old.x,y-old.y),ratio=Math.abs(Math.log(size/old.size));
          if(jump>.22||ratio>.5)continue;
          const distance=jump+.15*ratio;
          if(distance<cost){cost=distance;id=candidate;}
        }
        if(id<0)id=nextId++;
        assigned.add(id);identities.set(id,{x,y,size,t:last});
        const history=(histories.get(id)??[]).filter(f=>(last-f.t)/data.factor<=3);
        history.push({t:last,id,joints,aspect:track.displayWidth/track.displayHeight}); histories.set(id,history);
        for(const event of [...bowlingActions(history,data.factor),...followThroughActions(history,data.factor)]) {
          const nearby=events.findIndex(e=>e.id===event.id&&Math.abs(e.t-event.t)<1.8*data.factor);
          if(nearby<0)events.push(event);
          else if(event.confidence>events[nearby].confidence)events[nearby]=event;
        }
      }
      // Bound memory for full sessions. Only short body histories and detected event snapshots survive.
      for(const [id,old] of identities)if((last-old.t)/data.factor>3){identities.delete(id);histories.delete(id);}
      if(decoded%8===0)scope.postMessage({phase:"Following bowling actions",progress:Math.min(.99,last/duration),decoded,withPose});
    }
    scope.postMessage({result:{events:events.sort((a,b)=>a.t-b.t),duration,decoded,withPose,observed}});
  }catch(error){scope.postMessage({error:error instanceof Error?error.message:"Pose analysis failed."});}
  finally{detector?.close();input.dispose();}
};

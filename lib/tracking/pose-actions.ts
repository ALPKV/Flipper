export type Joint = { x: number; y: number; visibility: number };
export type BodyFrame = { t: number; id: number; joints: Joint[]; aspect?: number };
// Compact order: left/right shoulder, elbow, wrist, hip.
export type PoseAction = { t: number; id: number; arm: "left" | "right"; confidence: number;
  angularSpeed: number; uncertainty: number; joints: Joint[]; kind?: "arm-whip" | "follow-through" };

/** Raised arm -> rapid rotation -> downward follow-through, on the SAME person and arm. */
export function bowlingActions(frames: BodyFrame[], factor = 1): PoseAction[] {
  if (!(factor > 0)) return [];
  const events: PoseAction[] = [];
  for (const id of new Set(frames.map(f=>f.id))) for (const side of [0,1]) {
    const series = frames.filter(f=>f.id===id).map(f=> {
      const s=f.joints[side], e=f.joints[2+side], w=f.joints[4+side];
      const shoulders={x:(f.joints[0].x+f.joints[1].x)/2,y:(f.joints[0].y+f.joints[1].y)/2};
      const hips={x:(f.joints[6].x+f.joints[7].x)/2,y:(f.joints[6].y+f.joints[7].y)/2};
      const aspect=f.aspect??1;
      const scale=Math.hypot((shoulders.x-hips.x)*aspect,shoulders.y-hips.y);
      return { f, t:f.t/factor, scale, x:(w.x-s.x)*aspect/scale, y:(w.y-s.y)/scale,
        angle:Math.atan2(w.y-s.y,(w.x-s.x)*aspect), visibility:Math.min(s.visibility,e.visibility,w.visibility) };
    }).filter(p=>p.scale>.035 && p.visibility>=.55 && Number.isFinite(p.angle));
    for (let i=2;i<series.length-2;i++) {
      const p=series[i], before=series[i-1], after=series[i+1];
      if (after.t-before.t > .45 || before.t>=p.t || after.t<=p.t) continue;
      // The high point must be local, preceded by an arm lift and followed by a substantial drop.
      if (p.y > -.45 || p.y > before.y || p.y > after.y) continue;
      const pre=series.slice(Math.max(0,i-5),i).filter(q=>p.t-q.t<=.75);
      const post=series.slice(i+1,i+6).filter(q=>q.t-p.t<=.65);
      if (pre.length<2 || post.length<2 || !pre.some(q=>q.y-p.y>=.45) || !post.some(q=>q.y-p.y>=.7)) continue;
      const delta = (a:number,b:number) => Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
      const velocity=Math.max(...post.map((q,j)=> {
        const prev=j===0?p:post[j-1];
        return q.t>prev.t && q.t-prev.t<=.3 ? delta(q.angle,prev.angle)/(q.t-prev.t) : 0;
      }));
      if (velocity < 4) continue;
      // Reject a teleport or person-identity swap masquerading as an arm whip.
      if ([...pre,p,...post].some((q,j,all)=>j>0 && Math.abs(Math.log(q.scale/all[j-1].scale))>.45)) continue;
      events.push({t:p.f.t,id,arm:side===0?"left":"right", confidence:Math.min(.95,.55+.025*velocity+.15*p.visibility),
        angularSpeed:velocity,uncertainty:Math.max(p.t-before.t,after.t-p.t)*factor,joints:p.f.joints,kind:"arm-whip"});
    }
  }
  const kept: PoseAction[]=[];
  for (const e of events.sort((a,b)=>b.confidence-a.confidence)) if (kept.every(p=>p.id!==e.id||Math.abs(e.t-p.t)>1.8*factor)) kept.push(e);
  return kept.sort((a,b)=>a.t-b.t);
}

/** Cropped releases can supply a delivery cue, but NEVER a speed-release measurement. */
export function followThroughActions(frames:BodyFrame[],factor=1):PoseAction[] {
  const events:PoseAction[]=[];
  for(const id of new Set(frames.map(f=>f.id))) {
    const rows=frames.filter(f=>f.id===id).map(f=>{
      const j=f.joints,aspect=f.aspect??1;
      const sx=(j[0].x+j[1].x)/2,sy=(j[0].y+j[1].y)/2,hx=(j[6].x+j[7].x)/2,hy=(j[6].y+j[7].y)/2;
      const scale=Math.hypot((sx-hx)*aspect,sy-hy);
      return {f,t:f.t/factor,hx,hy,scale,lean:Math.abs((sx-hx)*aspect)/scale,
        visibility:Math.min(j[0].visibility,j[1].visibility,j[6].visibility,j[7].visibility)};
    }).filter(p=>p.visibility>=.55&&p.scale>.06);
    for(let i=0;i<rows.length-3;i++) {
      const start=rows[i];
      const segment=rows.slice(i,i+12).filter(p=>p.t-start.t<=.85);
      if(segment.length<4)continue;
      const end=segment.at(-1)!,dt=end.t-start.t;
      if(dt<.25||dt>.85||segment.some((p,k)=>k>0&&p.t-segment[k-1].t>.31))continue;
      const scale=segment.reduce((n,p)=>n+p.scale,0)/segment.length;
      if((start.hy-end.hy)/scale<.45 || (start.hy-end.hy)/scale/dt<.65 || start.lean<.15)continue;
      if(Math.abs(Math.log(end.scale/start.scale))>.4)continue;
      const arm=[0,1].find(side=>{
        const a=start.f.joints,b=end.f.joints;
        return Math.min(a[4+side].visibility,b[4+side].visibility)>=.35
          && ((b[4+side].y-b[side].y)-(a[4+side].y-a[side].y))/scale>.5;
      });
      if(arm==null)continue;
      events.push({t:start.f.t,id,arm:arm===0?"left":"right",confidence:.72,angularSpeed:0,
        uncertainty:dt*factor,joints:start.f.joints,kind:"follow-through"});
      i+=segment.length-1;
    }
  }
  return events;
}

export type DeliveryCategory = "contact" | "no-clear-contact" | "ambiguous-sound";
export type PoseDelivery = PoseAction & { contact: number | null; category: DeliveryCategory };

/** Audio classifies pose-defined deliveries. Unmatched sounds NEVER manufacture a delivery. */
export function categorizeDeliveries(actions: PoseAction[], sounds: {t:number;rel:number}[], factor=1): PoseDelivery[] {
  const used=new Set<number>();
  return actions.map(action=> {
    const minimum=action.kind==="follow-through"?-.15:.12;
    const possible=sounds.map((s,i)=>({...s,i,lag:(s.t-action.t)/factor})).filter(s=>!used.has(s.i)&&s.lag>=minimum&&s.lag<=1.8);
    possible.sort((a,b)=>b.rel-a.rel);
    if (!possible.length) return {...action,contact:null,category:"no-clear-contact" as const};
    // Multiple comparable impacts within one flight remain ambiguous rather than choosing one.
    if (possible.length>1 && possible[0].rel-possible[1].rel<3) return {...action,contact:null,category:"ambiguous-sound" as const};
    // A sound cannot identify the bowler when two visible people have competing actions.
    if(actions.some(other=>other!==action&&other.id!==action.id&&Math.abs(other.t-action.t)/factor<.6))
      return {...action,contact:null,category:"ambiguous-sound" as const};
    used.add(possible[0].i);
    return {...action,contact:possible[0].t,category:"contact" as const};
  });
}

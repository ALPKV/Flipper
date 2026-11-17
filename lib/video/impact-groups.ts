/** One strongest onset per short burst. Original detections are never mutated. */
export function groupImpacts<T extends {t:number;levelDb:number}>(sounds:readonly T[],gap=.6):T[]{
 if(!Number.isFinite(gap)||gap<=0)return [...sounds];
 const level=(sound:T)=>Number.isFinite(sound.levelDb)?sound.levelDb:-Infinity;
 const ordered=sounds.filter(sound=>Number.isFinite(sound.t)).sort((a,b)=>level(b)-level(a)||a.t-b.t);
 const groups:T[]=[];
 for(const sound of ordered){
  // Only kept, stronger onsets suppress a neighbor. An ignored echo cannot extend
  // the group, and a fixed time bucket cannot leave two near-identical anchors.
  let lo=0,hi=groups.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(groups[mid].t<sound.t)lo=mid+1;else hi=mid;}
  if(lo>0&&sound.t-groups[lo-1].t<=gap+1e-9)continue;
  if(lo<groups.length&&groups[lo].t-sound.t<=gap+1e-9)continue;
  groups.splice(lo,0,sound);
 }
 return [...groups,...sounds.filter(sound=>!Number.isFinite(sound.t))];
}

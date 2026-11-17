import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import {jsx,jsxs,Fragment} from "react/jsx-runtime";
import {beatReel} from "../lib/video/beat-reel.ts";
import {reelRanges} from "../lib/video/reel-ranges.ts";
import {planExport} from "../lib/video/export-plan.ts";

function harness(source:string){
 let calls=0,finish!:(value:Blob)=>void;
 const pending=new Promise<Blob>(resolve=>{finish=resolve;});
 const file={name:"session.mp4",size:1000};
 const context={file,clips:[{id:"one",start:1,end:4,contact:2.5}],meta:{duration:10},settings:{offset:0,leadIn:1.5,length:3,groupEchoes:true,echoGap:.6},audio:{status:"ready"},playerRef:{current:null}};
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const api={} as {Highlights:()=>unknown};
 runInNewContext(compiled,{exports:api,URL,Blob,Set,Map,require:(id:string)=>{
  if(id==="react")return {useState:(v:unknown)=>[v,()=>{}],useRef:(v:unknown)=>({current:v}),useEffect:()=>{},useSyncExternalStore:()=>false};
  if(id==="react/jsx-runtime")return {jsx,jsxs,Fragment};
  if(id.endsWith("/ffmpeg"))return {exportReel:()=>{calls++;return pending;}};
  if(id.endsWith("/export-plan"))return {planExport};
  if(id.endsWith("/beat-reel"))return {beatReel};
  if(id.endsWith("/reel-ranges"))return {reelRanges};
  if(id==="./video-context")return {useVideo:()=>context};
  if(id==="../ui")return {Button:"Button",Panel:"Panel",Meter:"Meter"};
  if(id==="./stage")return {Stage:"Stage"};
  if(id==="./video-drop")return {FileBar:"FileBar",VideoDrop:"VideoDrop",clock:String};
  if(id==="./reel-preview")return {ReelPreview:"ReelPreview"};
  throw new Error(id);
 }});
 const walk=(node:unknown):{props:{children?:unknown;onClick?:()=>void}}[]=>{
  if(Array.isArray(node))return node.flatMap(walk);
  if(!node||typeof node!=="object"||!("props" in node))return [];
  const element=node as {props:{children?:unknown;onClick?:()=>void}};
  return [element,...walk(element.props.children)];
 };
 const button=walk(api.Highlights()).find(n=>n.props.children==="Create highlights")!;
 assert.ok(button,"find the actual export handler");
 return {click:()=>button.props.onClick!(),calls:()=>calls,finish:()=>finish(new Blob(["video"]))};
}

test("two export clicks before a re-render start only one job",async()=>{
 const current=harness(readFileSync(new URL("../components/video/highlights.tsx",import.meta.url),"utf8"));
 current.click();current.click();assert.equal(current.calls(),1);
 current.finish();await new Promise(resolve=>setImmediate(resolve));
});

export {harness};

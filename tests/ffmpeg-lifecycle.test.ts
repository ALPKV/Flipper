import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import {reelRanges} from "../lib/video/reel-ranges.ts";

function deferred<T>(){
 let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const source=ts.transpileModule(readFileSync(new URL("../lib/video/ffmpeg.ts",import.meta.url),"utf8"),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;

function harness(options:{autoLoad?:boolean;exec?:(args:string[],worker:number,log:(message:string)=>void)=>number|Promise<number>}={}){
 const workers:FakeWorker[]=[];
 class FakeWorker{
  commands:string[][]=[];
  writes:{path:string;data:unknown}[]=[];
  logListeners=new Set<(event:{message:string})=>void>();
  terminated=false;
  loadGate=deferred<boolean>();
  execGate:ReturnType<typeof deferred<number>>|null=null;
  unmountGate:ReturnType<typeof deferred<void>>|null=null;
  constructor(){workers.push(this);if(options.autoLoad)this.loadGate.resolve(true);}
  async load(){return this.loadGate.promise;}
  terminate(){this.terminated=true;this.loadGate.reject(new Error("called FFmpeg.terminate()"));this.execGate?.reject(new Error("called FFmpeg.terminate()"));}
  async createDir(){}
  async mount(){if(this.terminated)throw new Error("terminated");}
  async unmount(){await this.unmountGate?.promise;}
  async exec(args:string[]){this.commands.push(args);return this.execGate?this.execGate.promise:options.exec?options.exec(args,workers.indexOf(this),message=>this.logListeners.forEach(fn=>fn({message}))):0;}
  async readFile(){return new Uint8Array([0,1,2]);}
  async writeFile(path:string,data:unknown){this.writes.push({path,data});}
  async deleteFile(){}
  on(event:string,listener:(event:{message:string})=>void){if(event==="log")this.logListeners.add(listener);}
  off(event:string,listener:(event:{message:string})=>void){if(event==="log")this.logListeners.delete(listener);}
 }
 const api={} as typeof import("../lib/video/ffmpeg.ts");
 runInNewContext(source,{
  exports:api,
  require:(id:string)=>id==="./reel-ranges"?{reelRanges}:{FFmpeg:FakeWorker},
  fetch:async()=>new Response(new Uint8Array([0])),
  URL,Blob,Response,DOMException,AbortController,Error,Uint8Array,Int16Array,setTimeout,clearTimeout,
 });
 return {api,workers};
}
const file={name:"recording.mp4"} as File;

test("canceling an unfinished engine load rejects promptly and a replacement stays usable",async()=>{
 const {api,workers}=harness();
 const first=api.prepareExport();
 const canceled=assert.rejects(first,{name:"AbortError"});
 await tick();assert.equal(workers.length,1);
 api.releaseEngine();
 assert.equal(workers[0].terminated,true);
 const second=api.prepareExport();
 await tick();assert.equal(workers.length,2);
 workers[1].loadGate.resolve(true);
 await Promise.all([canceled,second]);
 await api.prepareExport();
 assert.equal(workers.length,2);assert.equal(workers[1].terminated,false);
 api.releaseEngine();
});

test("old canceled cleanup cannot block or terminate a replacement export",async()=>{
 const {api,workers}=harness();
 const ready=api.prepareExport();await tick();workers[0].loadGate.resolve(true);await ready;
 workers[0].execGate=deferred<number>();
 workers[0].unmountGate=deferred<void>();
 const first=api.exportReel(file,[{start:0,end:1}],undefined,{precise:true});
 const canceled=assert.rejects(first,{name:"AbortError"});
 await tick();api.releaseEngine();
 const second=api.exportClip(file,1,1);
 await tick();assert.equal(workers.length,2);workers[1].loadGate.resolve(true);
 assert.equal((await second).size,3);
 workers[0].unmountGate.resolve();await canceled;
 assert.equal(workers[1].terminated,false);
 await api.prepareExport();assert.equal(workers.length,2);
 api.releaseEngine();
});

test("canceling a busy engine also cancels jobs already queued behind it",async()=>{
 const {api,workers}=harness();
 const ready=api.prepareExport();await tick();workers[0].loadGate.resolve(true);await ready;
 workers[0].execGate=deferred<number>();
 const first=api.exportClip(file,0,1),second=api.exportClip(file,2,1);
 const checks=[assert.rejects(first,{name:"AbortError"}),assert.rejects(second,{name:"AbortError"})];
 await tick();api.releaseEngine();await Promise.all(checks);
 assert.equal(workers.length,1);
});

test("a failed load terminates its worker and can be retried",async()=>{
 const {api,workers}=harness();
 const first=api.prepareExport(),failed=assert.rejects(first,/bad engine/);
 await tick();workers[0].loadGate.reject(new Error("bad engine"));await failed;
 assert.equal(workers[0].terminated,true);
 const retry=api.prepareExport();await tick();workers[1].loadGate.resolve(true);await retry;
 assert.equal(workers[1].terminated,false);api.releaseEngine();
});

test("a memory retry keeps every overlapping candidate and its exact beat slot",async()=>{
 let cutCount=0;
 const {api,workers}=harness({autoLoad:true,exec:args=>{
  if(args.includes("-ss")&&++cutCount===2)throw new Error("Out of memory");
  return 0;
 }});
 const ranges=[{start:2,end:4},{start:2.1,end:4.1},{start:4,end:6}],frameCounts=[57,56,57];
 const result=await api.exportReel(file,ranges,undefined,{precise:true,frameCounts});
 assert.equal(result.size,3);
 const commands=workers.flatMap(w=>w.commands),cuts=commands.filter(c=>c.includes("-ss"));
 assert.deepEqual(cuts.map(c=>Number(c[c.indexOf("-ss")+1])),[2,2.1,2,2.1,4]);
 assert.deepEqual(cuts.slice(2).map(c=>Number(c[c.indexOf("-frames:v")+1])),frameCounts);
 assert.ok(cuts.slice(2).every(c=>c[c.indexOf("-vf")+1].includes("min(480,ih)")));
 assert.ok(workers.every(w=>w.terminated),"each failed or completed batch must release its worker");
 const joinWorker=workers.find(w=>w.commands.some(c=>c.includes("concat")))!;
 assert.equal(joinWorker.commands.length,1,"joining must use a fresh worker without decoder buffers");
 const list=workers.flatMap(w=>w.writes).find(w=>w.path==="/list.txt")?.data;
 assert.equal(typeof list,"string");
 assert.equal((String(list).match(/^file /gm)??[]).length,3);
 const join=commands.find(c=>c.includes("concat"))!;
 assert.ok(Math.abs(Number(join[join.indexOf("-t")+1])-170/30)<1e-8);
});

test("generic worker crashes are reported without falsely claiming memory exhaustion",async()=>{
 for(const failure of [new WebAssembly.RuntimeError("unreachable"),new Error("RuntimeError: unreachable"),new Error("Aborted: decoder failed"),new Error("called FFmpeg.terminate()")]){
  const {api,workers}=harness({autoLoad:true,exec:()=>{throw failure;}});
  await assert.rejects(api.exportReel(file,[{start:0,end:1}],undefined,{precise:true}),error=>{
   assert.ok(error instanceof Error);
   assert.equal(api.isOutOfMemory(error),false);
   assert.doesNotMatch(error.message,/ran out of memory/i);
   return true;
  });
  assert.equal(workers.length,failure.name==="RuntimeError"||failure.message.startsWith("RuntimeError")?2:1);
 }
});

test("large selections release decoder batches while retaining every clip",async()=>{
 const {api,workers}=harness({autoLoad:true});
 const clips=Array.from({length:17},(_,i)=>({start:i,end:i+1}));
 await api.exportReel(file,clips,undefined,{precise:true});
 const batches=workers.filter(w=>w.commands.some(c=>c.includes("-ss")));
 assert.deepEqual(batches.map(w=>w.commands.length),[8,8,1]);
 assert.deepEqual(batches.flatMap(w=>w.commands.map(c=>Number(c[c.indexOf("-ss")+1]))),clips.map(c=>c.start));
 assert.ok(workers.every(w=>w.terminated));
});

test("canceling from a retry notification starts no replacement export",async()=>{
 const {api,workers}=harness({autoLoad:true,exec:()=>{throw new Error("Out of memory");}});
 await assert.rejects(api.exportReel(file,[{start:0,end:1}],undefined,{precise:true,onStatus:()=>api.releaseEngine()}),{name:"AbortError"});
 assert.equal(workers.length,1);
});

test("a logged allocation failure with a nonzero exit still retries at lower memory",async()=>{
 let attempts=0;
 const {api,workers}=harness({autoLoad:true,exec:(_args,_worker,log)=>{
  if(++attempts===1){log("Error allocating the decoder: Cannot allocate memory");return 1;}
  return 0;
 }});
 const result=await api.exportReel(file,[{start:0,end:1}],undefined,{precise:true});
 assert.equal(result.size,3);assert.equal(workers.length,2);
 assert.ok(workers[1].commands[0].includes("700k"));
 assert.ok(workers.every(w=>w.logListeners.size===0));
});

test("decoder batch duration is checked before adding another long clip",async()=>{
 const {api,workers}=harness({autoLoad:true});
 await api.exportReel(file,[{start:0,end:20},{start:5,end:25},{start:10,end:30}],undefined,{precise:true});
 const batches=workers.filter(w=>w.commands.some(c=>c.includes("-ss")));
 assert.deepEqual(batches.map(w=>w.commands.length),[1,1,1]);
});

test("a persistent allocation failure gets only one smaller retry",async()=>{
 const {api,workers}=harness({autoLoad:true,exec:()=>{throw new Error("Out of memory");}});
 await assert.rejects(api.exportReel(file,[{start:0,end:1}],undefined,{precise:true}));
 assert.equal(workers.length,2);
 assert.ok(workers.every(w=>w.terminated));
});

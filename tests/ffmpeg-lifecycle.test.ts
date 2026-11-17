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

function harness(){
 const workers:FakeWorker[]=[];
 class FakeWorker{
  terminated=false;
  loadGate=deferred<boolean>();
  execGate:ReturnType<typeof deferred<number>>|null=null;
  unmountGate:ReturnType<typeof deferred<void>>|null=null;
  constructor(){workers.push(this);}
  async load(){return this.loadGate.promise;}
  terminate(){this.terminated=true;this.loadGate.reject(new Error("called FFmpeg.terminate()"));this.execGate?.reject(new Error("called FFmpeg.terminate()"));}
  async createDir(){}
  async mount(){if(this.terminated)throw new Error("terminated");}
  async unmount(){await this.unmountGate?.promise;}
  async exec(){return this.execGate?this.execGate.promise:0;}
  async readFile(){return new Uint8Array([0,1,2]);}
  async deleteFile(){}
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

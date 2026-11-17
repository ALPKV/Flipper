/* eslint-disable @typescript-eslint/no-require-imports -- Native Node integration harness. */
/*
 * Optional native integration check; never uploads footage or changes application code.
 * Run: node scripts/verify-native-export.cjs [path/to/ffmpeg]
 * Uses FFMPEG_PATH or the local imageio FFmpeg executable when no argument is supplied.
 * Synthetic fixtures, exact app commands, and measurements go to .scratch/native-export-check/.
 * --wasm executes the identical package WASM in Node. Neither mode controls a browser.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const wasm=process.argv.includes('--wasm');
const binary = process.argv.slice(2).find(arg=>!arg.startsWith('--')) || process.env.FFMPEG_PATH || path.join(root, '.tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
const output = path.join(root, wasm?'.scratch/wasm-export-check':'.scratch/native-export-check');
fs.mkdirSync(output, { recursive: true });
const width = 320, height = 180, fps = 30, sourceSeconds = 9, sampleRate = 48000;
const beeps = [1.2, 3.5, 5.9, 8.4];
const commands = [];
function run(args, capture = false) {
  const result = cp.spawnSync(binary, ['-hide_banner', '-nostdin', '-y', ...args], { maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return capture ? result : result.stderr.toString();
}

// Draw readable 5x7 decimal digits and nine robust binary patches on every frame.
const digits = ['11111100011000110001100011000111111', '00100011000010000100001000010001110', '11111000010000111111100001000011111', '11111000010000101111000010000111111', '10001100011000111111000010000100001', '11111100001000011111000010000111111', '11111100001000011111100011000111111', '11111000010001000100010001000010000', '11111100011000111111100011000111111', '11111100011000111111000010000111111'];
function fixture() {
  const videoPath = path.join(output, 'source.rgb'), audioPath = path.join(output, 'source.f32');
  const fd = fs.openSync(videoPath, 'w');
  for (let frame = 0; frame < sourceSeconds * fps; frame++) {
    const rgb = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      rgb[at] = 25 + (x + frame * 3) % 60; rgb[at + 1] = 40 + (y + frame) % 70; rgb[at + 2] = 90;
    }
    const box = (x, y, w, h, value) => {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) rgb.fill(value, (yy * width + xx) * 3, (yy * width + xx) * 3 + 3);
    };
    [...String(frame).padStart(3, '0')].forEach((digit, i) => {
      [...digits[Number(digit)]].forEach((value, k) => { if (value === '1') box(20 + i * 40 + k % 5 * 6, 40 + Math.floor(k / 5) * 6, 6, 6, 245); });
    });
    for (let bit = 0; bit < 9; bit++) box(10 + bit * 32, 145, 24, 24, frame & (1 << bit) ? 245 : 10);
    if (beeps.some(t => frame >= Math.round(t * fps) && frame < Math.round((t + .08) * fps))) box(235, 40, 60, 60, 245);
    fs.writeSync(fd, rgb);
  }
  fs.closeSync(fd);
  const samples = Buffer.alloc(sourceSeconds * sampleRate * 4);
  for (let i = 0; i < sourceSeconds * sampleRate; i++) {
    const t = i / sampleRate;
    const onset = beeps.find(start => t >= start && t < start + .08);
    const value = onset == null ? 0 : .75 * Math.min(1, (t - onset) / .002) * Math.sin(2 * Math.PI * 1000 * (t - onset));
    samples.writeFloatLE(value, i * 4);
  }
  fs.writeFileSync(audioPath, samples);
  const source = path.join(output, 'source.mp4');
  run(['-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`, '-framerate', String(fps), '-i', videoPath, '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1', '-i', audioPath, '-c:v', 'libx264', '-threads', '1', '-preset', 'medium', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-bf', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', source]);
  return source;
}

function moduleExports(filename, requireModule) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: requireModule, fetch: async () => new Response(new Uint8Array([0])), URL, Blob, File, Response, DOMException, AbortController, Error, Uint8Array, Int16Array, setTimeout, clearTimeout });
  return exports;
}
const rangesModule = moduleExports('lib/video/reel-ranges.ts', () => ({}));
const beatModule = moduleExports('lib/video/beat-reel.ts', () => ({}));

async function renderCase(name, source, ranges, options) {
  const directory = path.join(output, name); fs.mkdirSync(directory, { recursive: true });
  let workerCount = 0;
  const parts = [];
  class NativeFFmpeg {
    constructor() { this.dir = path.join(directory, `worker-${++workerCount}`); fs.mkdirSync(this.dir, { recursive: true }); this.paths = new Map(); this.logs = new Set(); this.lastArgs = []; }
    resolve(p) { return this.paths.get(p) || path.join(this.dir, p.replace(/^\//, '')); }
    async load() {
      if(wasm){
        global.self={location:{href:'file:///ffmpeg-core.js'}};
        this.core=await require('@ffmpeg/core')({wasmBinary:fs.readFileSync(require.resolve('@ffmpeg/core/wasm'))});
        this.core.setLogger(({message})=>this.logs.forEach(fn=>fn({message})));
      }
      return true;
    }
    terminate() {this.core=null;}
    on(event, fn) { if (event === 'log') this.logs.add(fn); }
    off(event, fn) { if (event === 'log') this.logs.delete(fn); }
    async createDir(p) { fs.mkdirSync(this.resolve(p), { recursive: true });if(this.core){try{this.core.FS.mkdir(p);}catch{/* Existing root. */}} }
    async mount(_type, inputs, p) {
      for (const file of inputs.files || []) {this.paths.set(`${p}/${file.name}`, source);if(this.core)this.core.FS.writeFile(`${p}/${file.name}`,fs.readFileSync(source));}
      for (const blob of inputs.blobs || []) {const data=Buffer.from(await blob.data.arrayBuffer());fs.writeFileSync(this.resolve(`${p}/${blob.name}`),data);if(this.core)this.core.FS.writeFile(`${p}/${blob.name}`,data);}
    }
    async unmount() {}
    async writeFile(p, data) {
      if(this.core)this.core.FS.writeFile(p,data);
      if (typeof data === 'string') data = data.replace(/file '(\/[^']+)'/g, (_, filename) => `file '${this.resolve(filename).replaceAll('\\', '/')}'`);
      fs.writeFileSync(this.resolve(p), data);
    }
    async deleteFile(p) {if(this.core)this.core.FS.unlink(p);else fs.unlinkSync(this.resolve(p)); }
    async readFile(p) {
      const data = this.core?Buffer.from(this.core.FS.readFile(p)):fs.readFileSync(this.resolve(p));
      if (this.lastArgs.includes('-ss')) {
        const filename = path.join(directory, `part-${parts.length}.mp4`); fs.writeFileSync(filename, data);
        parts.push({ filename, args: this.lastArgs });
      }
      return new Uint8Array(data);
    }
    async exec(args) {
      this.lastArgs = [...args]; commands.push({ case: name, args: [...args] });
      if(this.core){const code=this.core.exec(...args);this.core.reset();return code;}
      const translated = args.map(a => a.startsWith('/') ? this.resolve(a) : a);
      const log = run(translated); log.split(/\r?\n/).forEach(message => this.logs.forEach(fn => fn({ message })));
      return 0;
    }
  }
  const api = moduleExports('lib/video/ffmpeg.ts', id => id === './reel-ranges' ? rangesModule : { FFmpeg: NativeFFmpeg });
  const blob = await api.exportReel({ name: 'source.mp4' }, ranges, undefined, options);
  const filename = path.join(directory, 'reel.mp4'); fs.writeFileSync(filename, Buffer.from(await blob.arrayBuffer()));
  api.releaseEngine();
  return { name, filename, parts, workerCount };
}

function inspect(filename) {
  const decoded = run(['-copyts', '-i', filename, '-map', '0:v:0', '-vf', 'showinfo', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], true);
  const bytes = width * height * 3, ids = [], black = [];
  assert.equal(decoded.stdout.length % bytes, 0, 'fixture dimensions changed');
  for (let start = 0; start < decoded.stdout.length; start += bytes) {
    const frame = decoded.stdout.subarray(start, start + bytes);
    let id = 0;
    for (let bit = 0; bit < 9; bit++) {
      let sum = 0;
      for (let y = 151; y < 163; y++) for (let x = 16 + bit * 32; x < 28 + bit * 32; x++) sum += frame[(y * width + x) * 3];
      if (sum / 144 > 128) id |= 1 << bit;
    }
    ids.push(id);
    if (frame.reduce((sum, v) => sum + v, 0) / bytes < 15) black.push(ids.length - 1);
  }
  const times = [...decoded.stderr.toString().matchAll(/\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:([\d.e+-]+)/g)].map(m => Number(m[1]));
  assert.equal(times.length, ids.length, 'showinfo must supply a timestamp for every frame');
  const pcm = run(['-copyts', '-i', filename, '-map', '0:a:0', '-af', 'aresample=async=1:first_pts=0', '-ar', String(sampleRate), '-ac', '1', '-f', 'f32le', 'pipe:1'], true).stdout;
  const audioEvents = []; let active = false, quiet = 0;
  const window = sampleRate / 1000;
  for (let from = 0; from < pcm.length / 4; from += window) {
    let energy = 0;
    for (let i = from; i < Math.min(from + window, pcm.length / 4); i++) energy += pcm.readFloatLE(i * 4) ** 2;
    const loud = Math.sqrt(energy / window) > .1;
    if (loud) { if (!active) audioEvents.push(from / sampleRate); active = true; quiet = 0; }
    else if (++quiet > 30) active = false;
  }
  return { frames: ids.length, ids, times, blackFrames: black.length, repeatedAdjacentFrames: ids.filter((id, i) => i > 0 && id === ids[i - 1]).length, videoStart: times[0], videoEnd: times.at(-1) + 1 / fps, audioEnd: pcm.length / 4 / sampleRate, audioEvents };
}
async function phoneChecks(source){
 const policy=moduleExports('lib/video/input-policy.ts',()=>({}));
 const native=moduleExports('lib/video/native-decode.ts',id=>id==='mediabunny'?require('mediabunny'):id==='./input-policy'?policy:{});
 const files={silent:path.join(output,'silent.mp4'),rotated:path.join(output,'rotated.mov'),hevc:path.join(output,'hevc.mov'),vfr:path.join(output,'vfr.mp4')};
 run(['-i',source,'-an','-c:v','copy',files.silent]);
 run(['-display_rotation','90','-i',source,'-c','copy',files.rotated]);
 run(['-i',source,'-c:v','libx265','-threads','1','-x265-params','pools=none:frame-threads=1','-preset','ultrafast','-tag:v','hvc1','-c:a','copy',files.hevc]);
 run(['-i',source,'-vf',"select='not(mod(n,2))+not(mod(n,5))'",'-fps_mode','vfr','-c:v','libx264','-threads','1','-preset','ultrafast','-c:a','copy',files.vfr]);
 const results=[];
 for(const [name,filename] of Object.entries(files)){
  const file=new File([fs.readFileSync(filename)],path.basename(filename));
  const signal=new AbortController().signal;
  const info=await native.inspectRecording(file,signal);
  assert.equal(info.hasAudio,name!=='silent');
  assert.equal(info.width,name==='rotated'?height:width);
  assert.equal(info.height,name==='rotated'?width:height);
  const timeline=await native.frameTimeline(file,signal);
  if(name==='vfr')assert.ok(new Set(timeline.slice(1).map((t,i)=>Math.round((t-timeline[i])*fps))).size>1,'fixture really is VFR');
  const rendered=await renderCase(name,filename,[{start:.7,end:1.8}],{precise:true});
  const exported=await native.inspectRecording(new File([fs.readFileSync(rendered.filename)],'export.mp4'),signal);
  const outputTimes=await native.frameTimeline(new File([fs.readFileSync(rendered.filename)],'export.mp4'),signal);
  assert.equal(outputTimes.length,33,`${name}: output frame count`);
  assert.equal(exported.width,info.width);assert.equal(exported.height,info.height);
  assert.equal(exported.hasAudio,info.hasAudio);
  assert.ok(outputTimes.slice(1).every((t,i)=>Math.abs(t-outputTimes[i]-1/30)<.00001),'output normalizes to 30fps');
  results.push({name,input:info,output:exported,outputFrames:outputTimes.length});
 }
 return results;
}

const round = value => Math.round(value * 1000000) / 1000000;

(async () => {
  const source = fixture(), sourceData = inspect(source);
  assert.deepEqual(sourceData.ids, Array.from({ length: sourceSeconds * fps }, (_, i) => i), 'machine-readable frame indices must survive source encoding');
  const ranges = [{ start: .7, end: 1.8 }, { start: 3.1, end: 4 }, { start: 5.3, end: 6.6 }];
  const beatPlan = beatModule.beatReel(beeps.slice(0, 3).map((contact, i) => ({ id: String(i), contact })), 123, 3, sourceSeconds);
  const cases = [
    await renderCase('original', source, ranges, { precise: false }),
    await renderCase('precise', source, ranges, { precise: true }),
    await renderCase('beat', source, beatPlan.cuts, { precise: true, frameCounts: beatPlan.cuts.map(c => c.frames) }),
  ];
  const summary = { engine:wasm?'actual @ffmpeg/core@0.12.10 in Node (not browser worker)':'native FFmpeg',nativeVersion: run(['-version'],true).stdout.toString().split('\n')[0], source: { seconds: sourceSeconds, fps, keyframeIntervalSeconds: 2, beeps, frames: sourceData.frames }, cases: [] };
  for (const item of cases) {
    const planned = item.name === 'beat' ? beatPlan.cuts : ranges;
    const joined = inspect(item.filename), parts = item.parts.map(p => inspect(p.filename));
    const expectedBeepTimes = item.name === 'beat' ? beatPlan.cuts.map(c => c.hitAt) : ranges.map((c, i) => beeps[i] - c.start + ranges.slice(0, i).reduce((n, p) => n + p.end - p.start, 0));
    const starts = parts.map((p, i) => ({ wantedSeconds: planned[i].start, actualSourceFrame: p.ids[0], errorFrames: round(p.ids[0] - planned[i].start * fps), frames: p.frames }));
    const flattened = parts.flatMap(p => p.ids);
    const partBeepErrors = parts.map((p, i) => round((p.audioEvents[0] ?? NaN) - (beeps[i] - planned[i].start)));
    const data = {
      name: item.name, starts, startsWithinOneFrame: starts.every(p => Math.abs(p.errorFrames) <= 1.00001),
      expectedFrames: item.name === 'beat' ? beatPlan.cuts.reduce((n, c) => n + c.frames, 0) : Math.round(ranges.reduce((n, c) => n + c.end - c.start, 0) * fps),
      actualFrames: joined.frames, videoStart: round(joined.videoStart), videoEnd: round(joined.videoEnd), audioEnd: round(joined.audioEnd),
      blackFrames: joined.blackFrames, repeatedAdjacentFrames: joined.repeatedAdjacentFrames,
      joinPreservesPartFrameSequence: JSON.stringify(joined.ids) === JSON.stringify(flattened),
      expectedBeepTimes: expectedBeepTimes.map(round), actualBeepTimes: joined.audioEvents,
      beepErrorsSeconds: joined.audioEvents.map((t, i) => round(t - expectedBeepTimes[i])), partBeepErrorsSeconds: partBeepErrors,
      framesAtEachJoin: parts.slice(0, -1).map((p, i) => ({ precedingSourceFrame: p.ids.at(-1), followingSourceFrame: parts[i + 1].ids[0] })),
    };
    summary.cases.push(data);
    console.log(JSON.stringify(data, null, 2));
  }
  summary.phoneCompatibility=await phoneChecks(source);
  fs.writeFileSync(path.join(output, 'commands.json'), JSON.stringify(commands, null, 2));
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(output, 'README.txt'), 'Local synthetic integration check. Source has readable frame numbers, binary frame IDs, and beeps synchronized with a white flash. report.json contains measured results; commands.json captures the exact app FFmpeg arguments. Native FFmpeg command behavior does not establish browser/WASM memory or UI behavior.\n');
  for(const result of summary.cases){
    assert.ok(result.startsWithinOneFrame,`${result.name}: every cut starts within one frame`);
    assert.equal(result.actualFrames,result.expectedFrames,`${result.name}: frame count`);
    assert.equal(result.blackFrames,0,`${result.name}: no black frames`);
    assert.equal(result.repeatedAdjacentFrames,0,`${result.name}: no frozen first frames`);
    assert.ok(result.joinPreservesPartFrameSequence,`${result.name}: concat preserves exact frame order`);
    assert.equal(result.actualBeepTimes.length,result.expectedBeepTimes.length);
    assert.ok(result.beepErrorsSeconds.every(error=>Math.abs(error)<=1/fps),`${result.name}: beeps within one frame`);
    assert.ok(Math.abs(result.videoEnd-result.audioEnd)<=1/fps,`${result.name}: audio/video duration within one frame`);
  }
  console.log(`All export assertions pass. Report: ${path.join(output, 'report.json')}`);
})().catch(error => { console.error(error); process.exitCode = 1; });

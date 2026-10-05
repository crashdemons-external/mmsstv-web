'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {Resampler,readWav,readMmv,bmp}=require('../web/audio.js');
for(const rate of [8000,11025,22050,44100,48000,96000]){
  const input=Float32Array.from({length:rate},(_,i)=>Math.sin(2*Math.PI*1900*i/rate));
  const once=new Resampler(rate).push(input,true),pieces=[],stream=new Resampler(rate);
  for(let n=0;n<input.length;n+=777)pieces.push(...stream.push(input.subarray(n,n+777),n+777>=input.length));
  assert.equal(once.length,11025);assert.equal(pieces.length,once.length);
  for(let i=0;i<once.length;i++)assert.ok(Math.abs(once[i]-pieces[i])<1e-6,'continuous across chunk boundaries');
  let error=0;for(let i=200;i<10000;i++)error+=(once[i]-Math.sin(2*Math.PI*1900*i/11025))**2;
  assert.ok(Math.sqrt(error/9800)<.01,'SSTV tones preserved at '+rate+' Hz');
}
const high=Float32Array.from({length:48000},(_,i)=>Math.sin(2*Math.PI*9000*i/48000)),filtered=new Resampler(48000).push(high,true);
assert.ok(Math.sqrt(filtered.slice(100,10000).reduce((n,x)=>n+x*x,0)/9900)<.01,'anti-aliasing rejects out-of-band tones');
const bytes=new ArrayBuffer(52),v=new DataView(bytes),ascii=(p,s)=>[...s].forEach((c,i)=>v.setUint8(p+i,c.charCodeAt(0)));
ascii(0,'RIFF');v.setUint32(4,44,true);ascii(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,48000,true);v.setUint32(28,192000,true);v.setUint16(32,4,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,8,true);v.setInt16(44,16384,true);v.setInt16(46,-16384,true);v.setInt16(48,8192,true);v.setInt16(50,-8192,true);
assert.deepEqual([...readWav(bytes,'left').samples],[.5,.25]);assert.deepEqual([...readWav(bytes,'right').samples],[-.5,-.25]);assert.deepEqual([...readWav(bytes,'mix').samples],[0,0]);
assert.throws(()=>readWav(bytes.slice(0,49)),/truncated/);
const mmv=new Uint8Array([0x55,0xaa,9,0,0,64,0,192]);
assert.equal(readMmv(mmv.buffer).rate,48000);assert.deepEqual([...readMmv(mmv.buffer).samples],[.5,-.5]);
assert.equal(readMmv(mmv.slice(4).buffer).rate,11025,'legacy headerless MMV');
assert.throws(()=>readMmv(mmv.slice(0,7).buffer),/truncated/);
assert.throws(()=>readMmv(new Uint8Array([0x55,0xaa,10,0,0,0]).buffer),/header/);
const picture=bmp(new Uint8Array([255,0,0,255,0,0,255,255]),1,2);
assert.equal(new DataView(picture.buffer).getUint32(2,true),62);assert.deepEqual([...picture.slice(54,57)],[255,0,0]);assert.deepEqual([...picture.slice(58,61)],[0,0,255]);
let Processor;
vm.runInNewContext(fs.readFileSync(require.resolve('../web/mic-worklet.js'),'utf8'),{
  AudioWorkletProcessor:class {constructor(){this.frames=[];this.port={postMessage:frame=>this.frames.push(frame)};}},
  registerProcessor:(name,implementation)=>{assert.equal(name,'mmsstv-input');Processor=implementation;}
});
for(const [channel,expected] of [['left',.5],['right',-.25],['mix',.125]]){
  const microphone=new Processor({processorOptions:{channel}}),output=new Float32Array(128).fill(1);
  for(let n=0;n<33;n++)microphone.process([[new Float32Array(128).fill(.5),new Float32Array(128).fill(-.25)]],[[output]]);
  assert.equal(microphone.frames.length,2,'microphone buffers emitted continuously');
  for(const frame of microphone.frames){assert.equal(frame.length,2048);assert.ok(frame.every(value=>value===expected),'selected microphone channel');}
  assert.ok(output.every(value=>value===0),'microphone input never goes to speakers');
}
console.log('WAV/MMV, malformed files, BMP export, 6 resampling rates, anti-aliasing and microphone worklet routing passed.');

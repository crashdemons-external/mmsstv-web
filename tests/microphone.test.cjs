'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),MMSAudio=require('../web/audio.js');
const code=fs.readFileSync('web/features.js','utf8'),start=code.indexOf('function recordInput'),end=code.indexOf("for(const id of ['digital-file'",start),downloads=[];
const state={settings:{recordAudio:true,recordLimit:1},input:null};
const {recordInput,finishRecording}=vm.runInNewContext(code.slice(start,end)+'\n({recordInput,finishRecording});',{state,MMSAudio,Int16Array,Math,Blob,download:(blob,name)=>downloads.push({blob,name}),timestamp:()=> 'capture',status:()=>{}});
const input={kind:'mic'};
recordInput(Float32Array.from([.25,-.5,.75]),48000,input);
finishRecording(input);
assert.equal(downloads.length,1,'stopping a detached input still saves its recorded PCM');
assert.equal(downloads[0].name,'microphone_capture.wav');
(async()=>{
  const wav=MMSAudio.readWav(await downloads[0].blob.arrayBuffer());
  assert.equal(wav.rate,48000);
  assert.deepEqual([...wav.samples],[8192/32768,-16383/32768,24575/32768],'partial worklet samples remain in the saved recording');
  console.log('Microphone shutdown preserves and saves the final partial PCM samples.');
})().catch(error=>{console.error(error);process.exitCode=1;});

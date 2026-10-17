'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),MMSAudio=require('../web/audio.js');
const source=fs.readFileSync('web/app.js','utf8'),start=source.indexOf('function queueMicrophoneSamples'),end=source.indexOf('async function readAudio',start),events=[];
const state={token:1,input:null,paused:false,elapsed:0,engine:{call:async(action,args)=>{events.push(action==='process'?`analog:${args.samples.length}`:action);return {};}}};
let micQueue=Promise.resolve(),pendingMic=0,inputStop=null;
const context={state,digital:{engine:{call:async(action,args)=>{events.push(`digital:${args.samples.length}`);return {};}}},MMSAudio,micQueue,pendingMic,inputStop,Float32Array,Promise,setTimeout,clearTimeout,console,
  recordInput:(samples,rate,input)=>events.push(`record:${samples.length}:${rate}:${input.kind}`),
  renderSnapshot:result=>events.push('render'),renderDigital:()=>{},failure:error=>{throw error;},status:()=>{},
  updateInputButtons:()=>{},finishRecording:()=>events.push('recording-finished'),duration:()=>'',
  $:()=>({textContent:'',disabled:false}),notifyView:()=>{}};
const {stopInput,receiveMicrophoneMessage}=vm.runInNewContext(source.slice(start,end)+'\n({stopInput,receiveMicrophoneMessage});',context);
const samplesResampler=new MMSAudio.Resampler(48000),drmResampler=new MMSAudio.Resampler(48000,12000);
const input={kind:'mic',name:'test',worklet:true,stopping:false,accepting:true,flushId:0,flushResolve:null,context:{sampleRate:48000,close:async()=>events.push('context-closed')},
  source:{disconnect:()=>events.push('source-disconnected')},stream:{getTracks:()=>[{stop:()=>events.push('track-stopped')}]},
  resampler:samplesResampler,drmResampler,node:{port:{onmessage:null,postMessage(message){
    if(message.type==='flush'){
      events.push('flush-command');this.onmessage({data:Float32Array.from({length:128},()=>.5)});
      events.push('flush-ack');
      this.onmessage({data:{type:'flush-ack',id:message.id}});
    }
  }},onaudioprocess:()=>events.push('late-fallback'),disconnect:()=>events.push('node-disconnected')}};
state.input=input;input.node.port.onmessage=event=>receiveMicrophoneMessage(input,1,event.data);
(async()=>{
  receiveMicrophoneMessage(input,1,Float32Array.from({length:2048},()=>.25));
  const firstStop=stopInput(),secondStop=stopInput();
  assert.strictEqual(firstStop,secondStop,'concurrent stop calls share one shutdown');
  await firstStop;
  assert.equal(state.input,null,'stopping detaches the input before asynchronous flush');
  const drainedCount=events.length;receiveMicrophoneMessage(input,1,Float32Array.of(.75));
  assert.equal(events.length,drainedCount,'late worklet messages are ignored after resampler drain');
  assert.equal(input.node.onaudioprocess,null,'fallback callback is detached before the resampler finishes');
  const analogCount=events.filter(event=>event.startsWith('analog:')).reduce((n,event)=>n+Number(event.slice(7)),0);
  const digitalCount=events.filter(event=>event.startsWith('digital:')).reduce((n,event)=>n+Number(event.slice(8)),0);
  assert.equal(analogCount,Math.round(2176/(48000/11025)),'captured mic PCM plus final resampler tail reaches the decoder');
  assert.equal(digitalCount,Math.round(2176/(48000/12000)),'captured mic PCM plus digital resampler tail reaches DRM');
  assert.ok(events.indexOf('flush-ack')<events.indexOf('context-closed'),'worklet acknowledgement precedes teardown');
  const lastDecoderCall=events.reduce((last,event,index)=>event.startsWith('analog:')||event.startsWith('digital:')?index:last,-1);
  assert.ok(events.indexOf('context-closed')>lastDecoderCall,'decoder queue drains before context teardown');
  assert.ok(events.indexOf('context-closed')<events.indexOf('finish'),'receiver finish follows context teardown');
  assert.ok(events.indexOf('context-closed')<events.indexOf('recording-finished'),'recording is saved after capture teardown');
  state.token=4;
  const fallbackResampler=new MMSAudio.Resampler(48000),fallbackInput={kind:'mic',worklet:false,stopping:false,accepting:true,context:{sampleRate:48000,close:async()=>{}},
    source:{disconnect(){}},stream:{getTracks:()=>[{stop(){}}]},resampler:{push:(samples,final)=>{if(final)assert.equal(fallbackInput.node.onaudioprocess,null,'fallback callback is detached before tail flush');return fallbackResampler.push(samples,final);}},
    drmResampler:new MMSAudio.Resampler(48000,12000),node:{onaudioprocess:()=>{},disconnect(){}}};
  state.input=fallbackInput;await stopInput();
  const fallbackEventCount=events.length;receiveMicrophoneMessage(fallbackInput,4,Float32Array.of(.75));
  assert.equal(events.length,fallbackEventCount,'fallback messages are ignored after stop');
  console.log('Microphone shutdown accepts flush data, drains resampler and decoder queues, then finishes once.');
})().catch(error=>{console.error(error);process.exitCode=1;});

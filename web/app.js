/* MMSSTV browser UI. Original DSP and image rendering live in mmsstv-core.wasm. */
'use strict';
const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const defaults={afc:true,lms:false,bpf:1,demodulator:2,sensitivity:1,autoStop:true,autoSync:true,autoSlant:false,autoHistory:true,differentiator:false,fftGain:1,fskId:false,txFskId:false,channel:'left',speed:'max',historyLimit:32,myCall:'',deviceId:'',interface:'mmsstv',imageFormat:'png',stretch:true,imageBackground:'#000080',galleryRows:4,galleryColumns:4,savePercent:40,recordAudio:false,recordLimit:100};
function saved(key,fallback) {try{return JSON.parse(localStorage.getItem('mmsstv.'+key))??fallback;}catch{return fallback;}}
const state={engine:null,modes:[],settings:{...defaults,...saved('settings',{})},mode:-1,tab:'rx',snapshot:null,pixels:null,width:320,height:256,hasImage:false,history:[],stocks:[],historyIndex:0,stockPage:0,logs:saved('logs',[]),profiles:saved('profiles',{}),input:null,token:0,elapsed:0,paused:false,phase:0,ppm:0,completed:0,serial:0,locked:false,waterfallColor:false,db:null};
const optionMap={afc:0,lms:1,bpf:2,demodulator:3,sensitivity:4,autoStop:5,autoSync:6,autoSlant:7,differentiator:9,fftGain:10,fskId:11};
const tx={mode:Number.isInteger(Number(state.settings.txMode))&&Number(state.settings.txMode)>=0&&Number(state.settings.txMode)<46?Number(state.settings.txMode):7,source:null,name:'',fit:state.settings.txFit||'stretch',encoder:null,busy:false,token:0,wave:null,waveName:'',waveUrl:null};
const digital={engine:null,encoder:null,protocol:'sstv',snapshot:null,files:[],source:null,picture:null,settings:{mode:2,bandwidth:1,qam:1,protection:0,interleave:0,rs:0,...saved('digital',{})}};
function notifyView(){$('sample-status').textContent=(digital.protocol==='drm'?12000:11025)+' Hz';window.QSSTVUI?.refresh();}
Object.assign(defaults,{operatorName:'',operatorQth:'',operatorLocator:'',backgroundColor:'#dfe5e6',slowCpu:false,confirmDelete:false,confirmClose:false,lowResolution:false,cwWpm:15,cwFrequency:800,waterfallMax:-25,waterfallRange:35,waterfallAverage:.9});
state.settings={...defaults,txVox:false,txCw:false,digitalImageSize:640,...state.settings};
let lastVisual=0, micQueue=Promise.resolve(), pendingMic=0;
function persist(key,value){try{localStorage.setItem('mmsstv.'+key,JSON.stringify(value));}catch(error){console.warn('Browser preferences could not be saved.',error);}}
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('loading-error',error);notifyView();}
function duration(seconds){seconds=Math.max(0,Math.floor(seconds));return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function timestamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
function imageName(){const mode=(state.tab==='tx'?state.modes[tx.mode]?.name:state.tab==='history'?state.history[state.historyIndex]?.mode:state.modes[state.snapshot?.mode]?.name)||'SSTV';return `${mode.replace(/[^a-z0-9-]/gi,'_')}_${timestamp()}`;}
function paint(canvas,pixels,w,h){canvas.width=w;canvas.height=h;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),w,h),0,0);}
function clearCanvas(canvas,color='#fff'){const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,canvas.width,canvas.height);}
function closeMenus(){document.querySelectorAll('.menu.open').forEach(menu=>{menu.classList.remove('open');menu.querySelector('button').setAttribute('aria-expanded','false');});}
function dialog(title,body,buttons='<button data-dialog="close">Close</button>'){
  closeMenus();$('dialog-title').textContent=title;$('dialog-content').innerHTML=body+`<div class="dialog-buttons">${buttons}</div>`;
  if(!$('modal').open)$('modal').showModal();
  $('dialog-content').querySelectorAll('[data-dialog="close"]').forEach(button=>button.onclick=()=>$('modal').close());
}
function failure(error){status(error.message||String(error),true);}
async function applySettings(){
  for(const [key,id] of Object.entries(optionMap))await state.engine.call('option',{id,value:Number(state.settings[key])});
  await state.engine.call('option',{id:8,value:Number(state.locked)});
  $('afc').setAttribute('aria-pressed',String(state.settings.afc));$('lms').setAttribute('aria-pressed',String(state.settings.lms));
  $('auto-history').checked=state.settings.autoHistory;$('auto-slant').checked=state.settings.autoSlant;
  $('rx-id').setAttribute('aria-pressed',String(state.settings.fskId));
  $('tx-id').setAttribute('aria-pressed',String(state.settings.txFskId));
}
async function resetReceiver(mode=state.mode){
  state.mode=mode;state.hasImage=digital.protocol==='drm'&&!!digital.picture;state.phase=0;state.ppm=0;
  renderSnapshot(await state.engine.call('reset',{mode}),true);await applySettings();updateModeButtons();
  if(digital.engine)renderDigital(await digital.engine.call('reset'));
}
function updateModeButtons(){
  const isTx=state.tab==='tx',selected=isTx?tx.mode:state.mode;
  document.querySelectorAll('[data-mode]').forEach(b=>{b.setAttribute('aria-pressed',String(Number(b.dataset.mode)===selected));b.disabled=digital.protocol==='drm'||isTx && (Number(b.dataset.mode)<0 || tx.busy);});
  $('mode-more')&&($('mode-more').disabled=digital.protocol==='drm'||isTx && tx.busy);
  $('mode-legend').textContent=isTx?'TX Mode':'RX Mode';$('mode-legend').style.color=isTx?'#000080':'';
  $('afc').disabled=$('lms').disabled=isTx||digital.protocol==='drm';
  const name=digital.protocol==='drm'?'DRM':selected<0?'Auto':state.modes[selected]?.name;$('mode-status').textContent=isTx?'TX: '+name:name;
}
function selectTab(tab){
  state.tab=tab;
  for(const name of ['rx','sync','history','tx']){$('panel-'+name).hidden=name!==tab;$('tab-'+name).setAttribute('aria-selected',String(name===tab));$(name+'-toolbar').hidden=name!==tab;}
  if(tab==='history')drawHistory();updateImageButtons();updateModeButtons();
  notifyView();
}
function updateImageButtons(){
  const has=state.tab==='tx'?!!tx.source:state.tab==='history'?state.history.length>0:state.hasImage;
  document.querySelectorAll('.needs-image').forEach(button=>button.disabled=!has);
  for(const b of document.querySelectorAll('[data-action^=phase-],[data-action^=sync-]'))b.disabled=digital.protocol==='drm'||state.snapshot?.mode===45;
  if(state.tab==='tx')document.querySelectorAll('[data-action=add-history]').forEach(button=>button.disabled=true);
  document.querySelectorAll('.needs-tx-image').forEach(button=>button.disabled=tx.busy||!(tx.source||button.dataset.action==='generate-wav'&&digital.protocol==='drm'&&digital.source));
}
function currentCanvas(){return state.tab==='tx'?$('tx-picture'):state.tab==='history' && state.history.length?$('history-picture'):$('rx-picture');}

async function openDatabase(){
  if(!globalThis.indexedDB)return;
  try{
    state.db=await new Promise((resolve,reject)=>{const request=indexedDB.open('mmsstv-web',1);request.onupgradeneeded=()=>{request.result.createObjectStore('images',{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const rows=await new Promise((resolve,reject)=>{const request=state.db.transaction('images').objectStore('images').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    digital.files=await Promise.all(rows.filter(r=>r.kind==='digital-file').sort((a,b)=>a.created.localeCompare(b.created)).map(async r=>({...r,bytes:new Uint8Array(await r.blob.arrayBuffer())})));
    state.history=rows.filter(r=>r.kind==='history').sort((a,b)=>a.created.localeCompare(b.created));state.stocks=rows.filter(r=>r.kind==='stock');
    renderStock();drawHistory();
  }catch(error){console.warn('History will be retained for this session.',error);state.db=null;}
}
async function storeImage(image,remove=false){
  if(!state.db)return;
  try{await new Promise((resolve,reject)=>{const tx=state.db.transaction('images','readwrite'),store=tx.objectStore('images');if(remove)store.delete(image.id);else store.put(image);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
  catch(error){status('Image is in session history; browser storage could not save it.',true);console.warn(error);}
}
function addHistory(force=false,picture=null){
  if(!picture && !state.hasImage)return;
  if(!picture&&digital.protocol==='drm')picture={serial:'drm-'+digital.snapshot?.status[13],modeName:'DRM',width:$('rx-picture').width,height:$('rx-picture').height,pixels:$('rx-picture').getContext('2d').getImageData(0,0,$('rx-picture').width,$('rx-picture').height).data};
  const serial=picture?picture.serial:state.serial;
  const existing=state.history.find(image=>image.serial===serial && image.session===sessionId);
  if(existing && !force)return;
  const canvas=picture?document.createElement('canvas'):$('rx-picture'),created=new Date().toISOString();
  if(picture)paint(canvas,picture.pixels,picture.width,picture.height);
  const image={id:globalThis.crypto?.randomUUID?.()||created+'-'+Math.random(),kind:'history',session:sessionId,serial,created,mode:picture?.modeName||state.modes[picture?picture.mode:state.snapshot.mode].name,width:canvas.width,height:canvas.height,url:canvas.toDataURL('image/png'),call:$('call').value};
  state.history.push(image);state.historyIndex=state.history.length-1;storeImage(image);
  while(state.history.length>state.settings.historyLimit){const old=state.history.shift();storeImage(old,true);state.historyIndex--;}
  renderStock();drawHistory();
}
const sessionId=timestamp();
function drawHistory(){
  state.historyIndex=Math.max(0,Math.min(state.history.length-1,state.historyIndex));
  const item=state.history[state.historyIndex];$('history-number').textContent=`${item?state.historyIndex+1:0} / ${state.history.length}`;
  if(!item){clearCanvas($('history-picture'));$('history-caption').textContent='';return;}
  const image=new Image();image.onload=()=>{if(state.history[state.historyIndex]?.id!==item.id)return;const canvas=$('history-picture');canvas.width=item.width;canvas.height=item.height;canvas.getContext('2d').drawImage(image,0,0);notifyView();};image.src=item.url;
  $('history-caption').textContent=`${item.mode} · ${new Date(item.created).toLocaleString()}`;
}
function renderStock(){
  const entries=state.stockKind==='templates'?saved('templates',[]):[...state.history,...state.stocks];state.stockPage=Math.max(0,Math.min(Math.max(0,Math.ceil(entries.length/12)-1),state.stockPage));
  $('stock-count').textContent=`${state.history.length}/${state.settings.historyLimit}`;$('stock-grid').replaceChildren();
  for(let i=0;i<12;i++){
    const cell=document.createElement('button');cell.className='stock-cell';const item=entries[state.stockPage*12+i];
    if(item){const img=document.createElement('img');img.src=item.url;img.alt=item.mode||item.name||'Stock picture';cell.append(img);const caption=document.createElement('span');caption.textContent=`${item.width}×${item.height} ${item.call||item.mode||item.name||''}`;cell.append(caption);cell.title=`${item.mode||item.name} — ${new Date(item.created).toLocaleString()}`;
      cell.onclick=()=>{if(state.stockKind==='templates'){templateSettings=item.settings||templateSettings;state.settings.useTemplate=true;persist('template',templateSettings);persist('settings',state.settings);drawTxImage();templateDialog();}else if(state.tab==='tx')setTxImage(item.url,item.name||item.mode).catch(failure);else if(item.kind==='history'){state.historyIndex=state.history.findIndex(r=>r.id===item.id);selectTab('history');}else zoomImage(item.url,item.name);};
    }else{cell.setAttribute('aria-label','Empty stock picture slot');cell.onclick=()=>$('image-file').click();}
    $('stock-grid').append(cell);
  }
  notifyView();
}
function drawScale(){
  const canvas=$('frequency-scale'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#000';ctx.font='12px Times New Roman';ctx.textAlign='center';
  for(const f of [1200,1500,1900,2300])ctx.fillText(f,(f-700)/2000*canvas.width,13);
}
function drawSignal(snapshot){
  const canvas=$('spectrum'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  ctx.fillStyle='#ff823c';ctx.fillRect(0,0,w,h);
  for(const f of [1200,1500,1900,2300]){ctx.strokeStyle=f===1900?'#fff6':'#fff';ctx.setLineDash(f===1900?[3,3]:[]);ctx.beginPath();const x=(f-700)/2000*w;ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  ctx.setLineDash([]);ctx.strokeStyle='#00f';ctx.lineWidth=1;ctx.beginPath();
  const levels=new Uint8ClampedArray(w);
  for(let x=0;x<w;x++){
    const hz=700+x/w*2000, bin=Math.round(hz*2048/11025), value=snapshot.spectrum[bin]||0;
    // Original FFT gain produces plot heights in pixels.
    const level=Math.max(0,Math.min(1,value/h));levels[x]=Math.round(level*255);
    const y=h-2-level*(h-4);if(!x)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  }ctx.stroke();
  ctx.fillStyle='#00f';const marker=(1500-700)/2000*w;ctx.beginPath();ctx.moveTo(marker,0);ctx.lineTo(marker-3,6);ctx.lineTo(marker+3,6);ctx.fill();
  const wf=$('waterfall'),wc=wf.getContext('2d');wc.drawImage(wf,0,1);
  const row=wc.createImageData(w,1);
  for(let x=0;x<w;x++){const d=levels[x];row.data[x*4]=state.waterfallColor?Math.max(0,(d-100)*2):d;row.data[x*4+1]=state.waterfallColor?Math.min(255,d*2):d;row.data[x*4+2]=state.waterfallColor?Math.min(255,d*3):d;row.data[x*4+3]=255;}
  wc.putImageData(row,0,0);
  $('audio-level').style.height=Math.min(100,Math.max(1,snapshot.level*200))+'%';
}
function renderSnapshot(snapshot,force=false){
  const previous=state.snapshot;state.snapshot=snapshot;
  if(snapshot.serial!==state.serial){state.serial=snapshot.serial;state.phase=0;state.ppm=0;}
  if(snapshot.pixels){state.pixels=snapshot.pixels;state.width=snapshot.width;state.height=snapshot.height;if(digital.protocol==='sstv')paint($('rx-picture'),snapshot.pixels,snapshot.width,snapshot.height);paint($('sync-picture'),snapshot.sync,320,256);}
  if(digital.protocol==='sstv')state.hasImage=state.hasImage||snapshot.line>0;
  if(snapshot.completed>state.completed){state.completed=snapshot.completed;if(state.settings.autoHistory && snapshot.finished && 100*snapshot.finished.fraction>=state.settings.savePercent)addHistory(false,snapshot.finished);}
  const name=state.modes[snapshot.mode]?.name||'Auto';
  $('rx-info').textContent=snapshot.receiving?`${name} · ${snapshot.line}`:snapshot.fsk||'Ready';
  if(state.tab!=='tx')$('mode-status').textContent=digital.protocol==='drm'?'DRM':state.mode<0?(snapshot.receiving?`Auto: ${name}`:'Auto'):state.modes[state.mode]?.name;
  if(snapshot.fsk && snapshot.fsk!==previous?.fsk){$('rx-id').title=`Received FSK ID: ${snapshot.fsk}`;if(state.settings.fskId)$('call').value=snapshot.fsk;}
  if(force || performance.now()-lastVisual>(state.settings.slowCpu?250:80)){drawSignal(snapshot);lastVisual=performance.now();}
  updateImageButtons();
  notifyView();
}
async function renderDigital(snapshot){
  digital.snapshot=snapshot;
  if(snapshot.call && digital.protocol==='drm')$('call').value=snapshot.call;
  if(snapshot.file){
    if(state.input)state.input.receivedDigital=true;const file=snapshot.file,blob=new Blob([file.bytes]),item={...file,id:crypto.randomUUID(),kind:'digital-file',blob,created:new Date().toISOString(),call:snapshot.call};digital.files.push(item);storeImage({...item,bytes:undefined});while(digital.files.length>state.settings.historyLimit)storeImage(digital.files.shift(),true);
    const url=URL.createObjectURL(blob);
    try{const image=await decodePicture(blob);if(image.width*image.height>40000000)throw Error('Image exceeds 40 million pixels.');const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);digital.picture=canvas;image.close?.();if(digital.protocol==='drm'){$('rx-picture').width=canvas.width;$('rx-picture').height=canvas.height;$('rx-picture').getContext('2d').drawImage(canvas,0,0);state.hasImage=true;}if(state.settings.autoHistory)addHistory(false,{serial:'drm-'+snapshot.status[13],modeName:'DRM',width:canvas.width,height:canvas.height,pixels:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data});}catch{/* Binary and unsupported image formats remain downloadable. */}finally{URL.revokeObjectURL(url);}
    status('DRM file received: '+file.name+' ('+file.bytes.length+' bytes).');
  }
  notifyView();
}
function setProtocol(protocol){
  digital.protocol=protocol;drawTxImage();state.hasImage=protocol==='drm'?!!digital.picture:!!state.snapshot?.line;document.querySelectorAll('[data-action^=protocol-]').forEach(b=>b.classList.toggle('selected',b.dataset.action==='protocol-'+protocol));
  if(protocol==='drm'){if(digital.picture){const c=$('rx-picture');c.width=digital.picture.width;c.height=digital.picture.height;c.getContext('2d').drawImage(digital.picture,0,0);}else clearCanvas($('rx-picture'),state.settings.imageBackground);}
  else if(state.pixels)paint($('rx-picture'),state.pixels,state.width,state.height);
  updateImageButtons();updateModeButtons();
  notifyView();
}
function updateInputButtons(){
  const active=!!state.input;$('pause-button').disabled=!active||state.input.kind!=='file';$('stop-button').disabled=!active;
  $('pause-button').textContent=state.paused?'Resume':'Pause';$('mic-button').setAttribute('aria-pressed',String(state.input?.kind==='mic'));
  notifyView();
}
async function stopInput(finish=true){
  ++state.token;const input=state.input;state.input=null;state.paused=false;
  if(input?.kind==='mic'){
    input.node.port&&(input.node.port.onmessage=null);input.node.onaudioprocess=null;input.node.disconnect();input.source.disconnect();input.stream.getTracks().forEach(track=>track.stop());await input.context.close();await micQueue;
    finishRecording(input);
  }
  if(finish && state.engine){renderSnapshot(await state.engine.call('finish'),true);}
  updateInputButtons();$('source-name').textContent=input?'Stopped — '+input.name:'No audio input';
  if(input)status('Sound input stopped.');
}

async function readAudio(file){
  if(file.size>256*1024*1024)throw new Error('This recording exceeds the 256 MB audio file limit.');
  const bytes=await file.arrayBuffer();if(/\.mmv$/i.test(file.name))return MMSAudio.readMmv(bytes);
  const wav=MMSAudio.readWav(bytes,state.settings.channel);if(wav)return wav;
  const context=new (window.AudioContext||window.webkitAudioContext)();
  try{const audio=await context.decodeAudioData(bytes);return {samples:MMSAudio.downmix(audio,state.settings.channel),rate:audio.sampleRate,duration:audio.duration,channels:audio.numberOfChannels};}
  catch{throw new Error('The browser could not decode this audio file. Try uncompressed PCM WAV or MMSSTV MMV.');}
  finally{await context.close();}
}
async function loadAudio(file){
  await stopInput();const token=++state.token;$('source-name').textContent='Loading '+file.name+'…';status('Reading audio file…');
  try{
    const audio=await readAudio(file);if(token!==state.token)return;
    await resetReceiver();if(token!==state.token)return;
    state.elapsed=0;state.input={kind:'file',name:file.name,file,audio,position:0};state.paused=false;$('file-progress').value=0;
    $('source-name').textContent=`${file.name} · ${audio.rate} Hz · ${duration(audio.duration)}`;$('window-title').textContent=`${file.name} — MMSSTV Ver 1.13A (Web)`;
    updateInputButtons();status('Playing sound file into the receiver…');runFile(token).catch(failure);
  }catch(error){if(token===state.token){$('source-name').textContent='No audio input';failure(error);}}
}
async function runFile(token){
  const input=state.input, audio=input.audio;let resampler=new MMSAudio.Resampler(audio.rate),drmResampler=new MMSAudio.Resampler(audio.rate,12000), started=performance.now();
  while(token===state.token && input.position<audio.samples.length){
    if(state.paused){await new Promise(resolve=>setTimeout(resolve,60));started=performance.now()-input.position/audio.rate*1000/(Number(state.settings.speed)||1);continue;}
    if(input.seek!==undefined){input.position=Math.floor(input.seek*audio.rate);delete input.seek;resampler=new MMSAudio.Resampler(audio.rate);drmResampler=new MMSAudio.Resampler(audio.rate,12000);await resetReceiver();if(token!==state.token)return;started=performance.now()-input.position/audio.rate*1000/(Number(state.settings.speed)||1);}
    const start=input.position,length=Math.min(4096,Math.ceil(audio.rate*.35)),end=Math.min(audio.samples.length,start+length);
    const raw=audio.samples.subarray(start,end),samples=resampler.push(raw,end===audio.samples.length),drmSamples=drmResampler.push(raw,end===audio.samples.length);input.position=end;
    if(samples.length)renderSnapshot(await state.engine.call('process',{samples}));
    if(drmSamples.length&&digital.engine)await renderDigital(await digital.engine.call('process',{samples:drmSamples}));
    if(token!==state.token)return;
    state.elapsed=end/audio.rate;$('time-status').textContent=duration(state.elapsed);$('file-progress').value=end/audio.samples.length;
    if($('play-time')){$('play-time').textContent=`NowTime ${duration(state.elapsed)} [s]`;$('play-slider').value=state.elapsed;}
    const speed=Number(state.settings.speed);const delay=speed?Math.max(0,started+state.elapsed*1000/speed-performance.now()):0;
    await new Promise(resolve=>setTimeout(resolve,Math.min(350,Math.max(0,delay))));
  }
  if(token!==state.token)return;
  renderSnapshot(await state.engine.call('finish'),true);
  state.input=null;updateInputButtons();$('source-name').textContent=`Finished — ${input.name}`;$('file-progress').value=1;status(digital.protocol==='drm'?input.receivedDigital?'Audio complete — DRM file recovered.':`Audio complete — ${digital.snapshot?.status[11]||0}/${digital.snapshot?.status[12]||0} DRM segments.`:state.hasImage?'Audio file complete. Picture ready to save.':'Audio file complete. No SSTV image detected.');
}
async function startMicrophone(deviceId){
  await stopInput();const token=++state.token;let stream,context;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone input requires HTTPS or localhost in this browser.');
    stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:deviceId?{exact:deviceId}:undefined,echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:2},video:false});
    if(token!==state.token){stream.getTracks().forEach(track=>track.stop());return;}
    context=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});await context.resume();await resetReceiver();
    if(token!==state.token){stream.getTracks().forEach(track=>track.stop());await context.close();return;}
    const source=context.createMediaStreamSource(stream), resampler=new MMSAudio.Resampler(context.sampleRate),drmResampler=new MMSAudio.Resampler(context.sampleRate,12000);let node;
    const feed=values=>{
      if(token!==state.token)return;
      recordInput(values,context.sampleRate);
      if(pendingMic>12){stopInput().then(()=>status('Microphone stopped: receiver could not keep up with input.',true)).catch(failure);return;}
      const samples=resampler.push(values),drmSamples=drmResampler.push(values);state.elapsed+=values.length/context.sampleRate;$('time-status').textContent=duration(state.elapsed);
      if(!samples.length)return;pendingMic++;
      micQueue=micQueue.then(async()=>{if(token===state.token){renderSnapshot(await state.engine.call('process',{samples}));if(digital.engine&&drmSamples.length)await renderDigital(await digital.engine.call('process',{samples:drmSamples}));}}).catch(failure).finally(()=>pendingMic--);
    };
    try{
      if(!context.audioWorklet)throw new Error('AudioWorklet unavailable');
      await context.audioWorklet.addModule(new URL('mic-worklet.js',location.href));
      node=new AudioWorkletNode(context,'mmsstv-input',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{channel:state.settings.channel}});node.port.onmessage=event=>feed(event.data);
    }catch(error){
      // Direct file:// use may restrict worklet scripts. Keep an input-only fallback.
      node=context.createScriptProcessor(4096,2,1);node.onaudioprocess=event=>{feed(MMSAudio.downmix(event.inputBuffer,state.settings.channel));event.outputBuffer.getChannelData(0).fill(0);};
    }
    const silent=context.createGain();silent.gain.value=0;source.connect(node);node.connect(silent);silent.connect(context.destination);
    state.input={kind:'mic',name:stream.getAudioTracks()[0].label||'Microphone',context,source,node,stream};state.elapsed=0;updateInputButtons();$('file-progress').value=0;$('source-name').textContent=state.input.name;status('Receiving audio from microphone…');
    stream.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(token===state.token)stopInput().catch(failure);}));
  }catch(error){stream?.getTracks().forEach(track=>track.stop());if(context && context.state!=='closed')await context.close();failure(error.name==='NotAllowedError'?new Error('Microphone permission was denied. Allow this page to use the microphone and try again.'):error);}
}
async function microphoneDialog(){
  if(state.input?.kind==='mic'){await stopInput();return;}
  dialog('Audio input from microphone',`<div class="dialog-body"><fieldset><legend>Sound input</legend><div class="form-row"><label for="mic-device">Input device</label><select id="mic-device"><option value="">Default audio input</option></select></div><div class="form-row"><label for="mic-channel">Channel</label><select id="mic-channel"><option value="left">Left / mono</option><option value="right">Right</option><option value="mix">Average channels</option></select></div></fieldset><p>Connect microphone or line-input audio. Your browser will request access when you press Start.</p></div>`,'<button id="mic-start">Start</button><button data-dialog="close">Cancel</button>');
  $('mic-channel').value=state.settings.channel;
  try{const devices=await navigator.mediaDevices?.enumerateDevices();for(const device of devices||[])if(device.kind==='audioinput')$('mic-device')?.add(new Option(device.label||'Audio input '+($('mic-device').length),device.deviceId));if($('mic-device'))$('mic-device').value=state.settings.deviceId;}catch{}
  if($('mic-start'))$('mic-start').onclick=()=>{const device=$('mic-device').value;state.settings.channel=$('mic-channel').value;state.settings.deviceId=device;persist('settings',state.settings);$('modal').close();startMicrophone(device).catch(failure);};
}

function settingsDialog(tab='rx'){
  const s=state.settings;
  dialog('Setup MMSSTV',`<div class="dialog-tabs tabs"><button data-setting-tab="rx">RX</button><button disabled>TX</button><button data-setting-tab="misc">Misc</button></div>
  <div class="settings-panel" id="settings-rx"><div class="settings-columns">
    <fieldset><legend>Reception</legend><label><input id="set-autoStop" type="checkbox">Auto stop</label><label><input id="set-autoSync" type="checkbox">Auto sync</label><label><input id="set-autoSlant" type="checkbox">Auto slant</label><label><input id="set-afc" type="checkbox">AFC</label><label><input id="set-lms" type="checkbox">LMS</label><label><input id="set-differentiator" type="checkbox">Differentiator</label></fieldset>
    <div><fieldset><legend>Demodulator</legend><label><input type="radio" name="demodulator" value="0">PLL</label><label><input type="radio" name="demodulator" value="1">Zero-crossing</label><label><input type="radio" name="demodulator" value="2">Hilbert transform</label></fieldset>
    <fieldset><legend>RX BPF</legend><select id="set-bpf" aria-label="Receive band-pass filter"><option value="0">OFF</option><option value="1">Wide</option><option value="2">Middle</option><option value="3">Narrow</option></select></fieldset></div>
  </div><fieldset><legend>Auto start sensitivity</legend><div class="form-row"><label for="set-sensitivity">Sensitivity</label><select id="set-sensitivity"><option value="0">Lowest</option><option value="1">Normal</option><option value="2">High</option><option value="3">Highest</option></select></div></fieldset>
  <fieldset><legend>RX buffer</legend><label><input type="radio" checked disabled>Browser memory</label><label class="unavailable"><input type="radio" disabled>Windows buffer file</label><div class="settings-note">Received signal is retained for phase and slant adjustment.</div></fieldset></div>
  <div class="settings-panel" id="settings-misc" hidden><fieldset><legend>Sound card / browser input</legend><div class="form-row"><label>Sampling frequency</label><input value="11025 Hz" disabled></div><div class="form-row"><label for="set-channel">Audio channel</label><select id="set-channel"><option value="left">Left / mono</option><option value="right">Right</option><option value="mix">Average channels</option></select></div><div class="form-row"><label for="set-speed">File play speed</label><select id="set-speed"><option value="max">Fast decode</option><option value="1">Real time</option><option value="8">8×</option></select></div></fieldset>
  <fieldset><legend>History</legend><label><input id="set-autoHistory" type="checkbox">Automatically copy received pictures to history</label><div class="form-row"><label for="set-historyLimit">Maximum pictures</label><select id="set-historyLimit"><option>16</option><option>32</option><option>64</option><option>128</option></select></div></fieldset>
  <fieldset><legend>Spectrum</legend><div class="form-row"><label for="set-fftGain">FFT gain</label><select id="set-fftGain"><option value="0">Low</option><option value="1">Normal</option><option value="2">High</option><option value="3">Highest</option></select></div></fieldset>
  <fieldset disabled><legend>Radio control</legend><div class="form-row"><label>PTT port</label><select><option>None</option></select></div><label><input type="checkbox" disabled>Use CAT control</label></fieldset></div>`, '<button id="settings-ok">OK</button><button data-dialog="close">Cancel</button>');
  for(const key of ['autoStop','autoSync','autoSlant','afc','lms','differentiator','autoHistory'])$('set-'+key).checked=!!s[key];
  for(const key of ['bpf','sensitivity','channel','speed','historyLimit','fftGain'])$('set-'+key).value=s[key];
  document.querySelector(`[name=demodulator][value="${s.demodulator}"]`).checked=true;
  const changeTab=name=>{for(const value of ['rx','misc']){$('settings-'+value).hidden=value!==name;document.querySelector(`[data-setting-tab=${value}]`).classList.toggle('selected',value===name);}};
  document.querySelectorAll('[data-setting-tab]').forEach(b=>b.onclick=()=>changeTab(b.dataset.settingTab));changeTab(tab);
  $('settings-ok').onclick=async()=>{
    for(const key of ['autoStop','autoSync','autoSlant','afc','lms','differentiator','autoHistory'])s[key]=$('set-'+key).checked;
    for(const key of ['bpf','sensitivity','historyLimit','fftGain'])s[key]=Number($('set-'+key).value);
    for(const key of ['channel','speed'])s[key]=$('set-'+key).value;
    s.demodulator=Number(document.querySelector('[name=demodulator]:checked').value);persist('settings',s);$('modal').close();await applySettings();status('MMSSTV settings saved. Audio channel changes apply to the next input.');
  };
}
function saveImageDialog(){
  // Prepare a real download link before the click. This keeps the browser's
  // trusted user gesture attached to the download, including embedded browsers.
  const canvas=currentCanvas();dialog('Save picture',`<div class="dialog-body"><div class="form-row"><label for="save-name">File name</label><input id="save-name" value="${escapeHtml(imageName())}"></div><div class="form-row"><label for="save-format">Save as type</label><select id="save-format"><option value="png">PNG image (*.png)</option><option value="jpeg">JPEG image (*.jpg)</option><option value="bmp">Windows bitmap (*.bmp)</option></select></div><p>${canvas.width} × ${canvas.height} pixels</p></div>`,'<a class="dialog-button" id="save-download" download>Save</a><button data-dialog="close">Cancel</button>');
  const link=$('save-download');
  const prepare=()=>{
    const format=$('save-format').value;
    if(format==='bmp'){
      const bytes=MMSAudio.bmp(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);let binary='';
      for(let n=0;n<bytes.length;n+=8192)binary+=String.fromCharCode(...bytes.subarray(n,n+8192));
      link.href='data:image/bmp;base64,'+btoa(binary);
    }else link.href=canvas.toDataURL('image/'+format,.92);
    updateName();
  };
  const updateName=()=>{const format=$('save-format').value,name=($('save-name').value||imageName()).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');link.download=name+(format==='jpeg'?'.jpg':'.'+format);};
  $('save-format').onchange=prepare;$('save-name').oninput=updateName;prepare();
  $('save-format').value=state.settings.imageFormat;prepare();
  link.onclick=()=>{const format=$('save-format').value;setTimeout(()=>$('modal').close(),0);status('Picture download requested as '+format.toUpperCase()+'.');};
}
function zoomImage(url=currentCanvas().toDataURL(),title='Received picture'){
  dialog(title,`<div class="dialog-body"><img class="zoom-picture" src="${escapeHtml(url)}" alt="Full-size SSTV picture"></div>`,'<button data-action="copy-to-tx">Copy to TX</button><button data-action="save-image">Save picture…</button><button data-dialog="close">Close</button>');
}
function playPositionDialog(){
  const input=state.input;
  if(input?.kind!=='file'){dialog('Adjust play position','<div class="dialog-body"><p>Open an audio file to use the playback controls.</p></div>');return;}
  dialog('Adjust play position',`<div class="dialog-body"><p>${escapeHtml(input.name)}</p><p>RecTime ${duration(input.audio.duration)} [min:sec]</p><p id="play-time">NowTime ${duration(state.elapsed)} [s]</p><input class="play-slider" id="play-slider" type="range" min="0" max="${input.audio.duration}" step="0.1" value="${state.elapsed}" aria-label="Audio playback position"><label><input id="play-paused" type="checkbox" ${state.paused?'checked':''}>Pause</label></div>`,'<button id="play-stop">Stop</button><button data-dialog="close">Hide</button>');
  $('play-slider').onchange=()=>{if(state.input?.kind==='file')state.input.seek=Number($('play-slider').value);};
  $('play-paused').onchange=()=>{state.paused=$('play-paused').checked;updateInputButtons();status(state.paused?'Sound file paused.':'Playing sound file…');};$('play-stop').onclick=()=>{stopInput().catch(failure);$('modal').close();};
}
function syncAdjustDialog(){
  dialog('Adjust phase and slant',`<div class="dialog-body"><fieldset><legend>RX synchronization</legend><div class="form-row"><label for="adjust-phase">Phase (pixels)</label><input id="adjust-phase" type="number" min="-1000" max="1000" step="1" value="${state.phase}"></div><div class="form-row"><label for="adjust-slant">Clock correction (ppm)</label><input id="adjust-slant" type="number" min="-30000" max="30000" step="1" value="${state.ppm}"></div></fieldset><p>Adjust the retained received signal, then redraw the picture.</p></div>`,'<button id="adjust-apply">Apply</button><button data-dialog="close">Close</button>');
  $('adjust-apply').onclick=async()=>{state.phase=Math.max(-1000,Math.min(1000,Number($('adjust-phase').value)||0));state.ppm=Math.max(-30000,Math.min(30000,Number($('adjust-slant').value)||0));renderSnapshot(await state.engine.call('redraw',{ppm:state.ppm,phase:state.phase}),true);status('Received picture redrawn.');};
}

function paintTxPicture(canvas){
  clearCanvas(canvas);if(!tx.source)return;const ctx=canvas.getContext('2d'),source=tx.source;if(tx.fit==='stretch')ctx.drawImage(source,0,0,canvas.width,canvas.height);else{const scale=(tx.fit==='crop'?Math.max:Math.min)(canvas.width/source.width,canvas.height/source.height);const w=source.width*scale,h=source.height*scale;ctx.drawImage(source,(canvas.width-w)/2,(canvas.height-h)/2,w,h);}
}
function drawTxImage(){
  const mode=state.modes[tx.mode];if(!mode)return;
  const canvas=$('tx-picture');canvas.width=mode.width;canvas.height=mode.txHeight;if(digital.protocol==='drm'&&tx.source){const scale=Math.min(1,(state.settings.digitalImageSize||640)/Math.max(tx.source.width,tx.source.height));canvas.width=Math.max(2,Math.round(tx.source.width*scale));canvas.height=Math.max(2,Math.round(tx.source.height*scale));}
  paintTxPicture(canvas);if(state.settings.useTemplate&&typeof applyTemplate==='function')applyTemplate(canvas);
  $('tx-caption').textContent=tx.source?`${canvas.width}×${canvas.height} ${tx.name}`:'Open a picture to generate SSTV audio';
  updateImageButtons();
  notifyView();
}
function setTxMode(mode){if(tx.busy || mode<0 || !state.modes[mode])return;tx.mode=mode;state.settings.txMode=mode;state.settings.txFit=tx.fit;persist('settings',state.settings);drawTxImage();updateModeButtons();}
async function setTxImage(source,name='Picture'){
  if(tx.busy)throw new Error('Wait for audio generation to finish before changing the picture.');
  let bitmap;
  if(typeof source==='string'){const image=new Image();image.src=source;await image.decode();bitmap=await createImageBitmap(image);}
  else bitmap=source instanceof Blob?await decodePicture(source):await createImageBitmap(source);
  if(bitmap.width*bitmap.height>40000000){bitmap.close();throw new Error('This picture is too large. Resize it below 40 million pixels.');}
  tx.source?.close?.();tx.source=bitmap;tx.name=name;selectTab('tx');drawTxImage();status('TX picture ready — choose a mode, then Generate WAV.');
}
function generateWavDialog(){
  if(!tx.source || tx.busy)return;
  selectTab('tx');
  dialog('Generate SSTV audio',`<div class="dialog-body"><fieldset><legend>Picture / mode</legend><div class="form-row"><label for="encode-mode">SSTV mode</label><select id="encode-mode">${state.modes.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select></div><div class="form-row"><label for="encode-fit">Picture resizing</label><select id="encode-fit"><option value="stretch">Stretch to mode size</option><option value="fit">Fit with white borders</option><option value="crop">Fill and crop</option></select></div><p id="encode-size"></p></fieldset><fieldset><legend>Identification</legend><label><input id="encode-id" type="checkbox">Include FSK callsign</label><label><input id="encode-vox" type="checkbox">VOX lead-in tone</label><label><input id="encode-cw" type="checkbox">Append CW ID</label><div class="form-row"><label for="encode-call">My callsign</label><input id="encode-call" maxlength="18" value="${escapeHtml(state.settings.myCall)}"></div></fieldset><p>Generate a mono, 16-bit PCM WAV at 11025 Hz.</p></div>`,'<button id="encode-start">Generate</button><button data-dialog="close">Cancel</button>');
  $('encode-mode').value=tx.mode;$('encode-fit').value=tx.fit;$('encode-id').checked=state.settings.txFskId;$('encode-vox').checked=state.settings.txVox;$('encode-cw').checked=state.settings.txCw;
  const describe=()=>{const mode=state.modes[Number($('encode-mode').value)];$('encode-size').textContent=`${mode.width} × ${mode.txHeight} pixels`;};
  $('encode-mode').onchange=describe;describe();
  $('encode-start').onclick=()=>{
    const call=$('encode-call').value.trim().toUpperCase(),include=$('encode-id').checked;
    if(include && !/^[A-Z0-9 /-]{1,18}$/.test(call)){status('Enter a callsign using letters, digits, spaces, / or -.',true);$('encode-call').focus();return;}
    tx.fit=$('encode-fit').value;setTxMode(Number($('encode-mode').value));
    state.settings.txVox=$('encode-vox').checked;state.settings.txCw=$('encode-cw').checked;state.settings.txFskId=include;if(call)state.settings.myCall=call;persist('settings',state.settings);$('tx-id').setAttribute('aria-pressed',String(include));
    generateWav(include?call:'').catch(failure);
  };
}
async function generateWav(call){
  tx.busy=true;const token=++tx.token,mode=state.modes[tx.mode],canvas=$('tx-picture');
  const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  updateImageButtons();updateModeButtons();
  dialog('Generate SSTV audio',`<div class="dialog-body"><p>${escapeHtml(mode.name)} · ${canvas.width} × ${canvas.height} pixels</p><progress id="encode-progress" max="1" value="0" aria-label="SSTV audio generation progress"></progress><p id="encode-status">Preparing audio encoder…</p></div>`,'<button data-dialog="close">Cancel</button>');
  const cancel=()=>{if(token===tx.token)++tx.token;};$('modal').addEventListener('close',cancel);
  try{
    if(!tx.encoder)tx.encoder=await MMSEncoderEngine.create();
    if(token!==tx.token)return;
    await tx.encoder.call('start',{mode:mode.id,width:canvas.width,height:canvas.height,pixels:new Uint8Array(pixels),call});
    const chunks=[];let count=0,block;
    do{
      if(token!==tx.token)return;
      block=await tx.encoder.call('read');chunks.push(block.pcm);count+=block.pcm.length/2;
      if(token!==tx.token)return;
      $('encode-progress').value=block.progress;$('encode-status').textContent=`Generating ${mode.name}… ${Math.round(block.progress*100)}%`;
      await new Promise(resolve=>setTimeout(resolve,0));
    }while(!block.done);
    tx.wave=await finishGeneratedAudio(chunks,11025);count=(tx.wave.size-44)/2;tx.waveName=mode.name.replace(/[^a-z0-9-]/gi,'_')+'_'+timestamp()+'.wav';
    if(tx.waveUrl)URL.revokeObjectURL(tx.waveUrl);tx.waveUrl=URL.createObjectURL(tx.wave);
    $('modal').removeEventListener('close',cancel);
    dialog('Save SSTV audio',`<div class="dialog-body"><p><b>${escapeHtml(mode.name)}</b> · ${canvas.width} × ${canvas.height} pixels</p><p>${duration(count/11025)} · 11025 Hz · 16-bit mono · ${(tx.wave.size/1024/1024).toFixed(2)} MB</p><div class="form-row"><label for="wave-name">File name</label><input id="wave-name" value="${escapeHtml(tx.waveName)}"></div></div>`,'<a class="dialog-button" id="wave-download" download>Save WAV</a><button id="wave-decode">Decode WAV</button><button data-dialog="close">Close</button>');
    const link=$('wave-download');link.href=tx.waveUrl;link.download=tx.waveName;
    $('wave-name').oninput=()=>{const name=$('wave-name').value.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')||tx.waveName;link.download=/\.wav$/i.test(name)?name:name+'.wav';};
    link.onclick=()=>status('SSTV WAV download requested.');
    $('wave-decode').onclick=async()=>{try{$('modal').close();setProtocol('sstv');selectTab('rx');await stopInput();await resetReceiver(mode.id===45?45:-1);await loadAudio(new File([tx.wave],link.download,{type:'audio/wav'}));}catch(error){failure(error);}};
    status('SSTV audio generated — Save WAV to download the file.');
  }catch(error){if(token===tx.token){$('modal').removeEventListener('close',cancel);dialog('SSTV audio generation failed',`<div class="dialog-body"><p>${escapeHtml(error.message)}</p></div>`);throw error;}}
  finally{
    $('modal').removeEventListener('close',cancel);
    try{await tx.encoder?.call('cancel');}catch(error){tx.encoder?.worker?.terminate();tx.encoder=null;console.warn('Audio encoder was reset.',error);}
    tx.busy=false;updateImageButtons();updateModeButtons();
    if(token!==tx.token)status('SSTV audio generation canceled.');
  }
}

function moreModesDialog(){
  const isTx=state.tab==='tx';
  dialog(isTx?'TX Mode':'RX Mode',`<div class="dialog-body"><fieldset><legend>SSTV mode</legend><select id="all-modes" size="12" style="height:250px;width:100%"></select></fieldset><p id="mode-size"></p></div>`,'<button id="mode-select">Select</button><button data-dialog="close">Cancel</button>');
  if(!isTx)$('all-modes').add(new Option('Auto',-1));for(const mode of state.modes)$('all-modes').add(new Option(mode.name,mode.id));$('all-modes').value=isTx?tx.mode:state.mode;
  const describe=()=>{const mode=state.modes[Number($('all-modes').value)];$('mode-size').textContent=mode?`${mode.width} × ${isTx?mode.txHeight:mode.height} pixels`:'Automatic VIS and sync detection (FAX480 requires manual selection)';};$('all-modes').onchange=describe;describe();
  $('mode-select').onclick=()=>{const mode=Number($('all-modes').value);$('modal').close();if(isTx)setTxMode(mode);else resetReceiver(mode).catch(failure);};$('all-modes').ondblclick=()=>$('mode-select').click();
}
function logFields(){return {call:$('call').value.trim().toUpperCase(),name:$('name').value,qth:$('qth').value,note:$('note').value,qsl:$('qsl').value,his:$('his-rst').value,my:$('my-rst').value,frequency:$('frequency').value,mode:digital.protocol==='drm'?'DRM':state.modes[state.snapshot?.mode]?.name||'SSTV',time:new Date().toISOString()};}
function logList(){
  dialog('Log data',`<div class="dialog-body"><div class="dialog-scroll"><table><thead><tr><th>UTC</th><th>Call</th><th>His</th><th>MHz</th><th>Mode</th></tr></thead><tbody>${state.logs.map(r=>`<tr><td>${escapeHtml(r.time.replace('T',' ').slice(0,19))}</td><td>${escapeHtml(r.call)}</td><td>${escapeHtml(r.his)}</td><td>${escapeHtml(r.frequency)}</td><td>${escapeHtml(r.mode)}</td></tr>`).join('')||'<tr><td colspan="5">No log entries.</td></tr>'}</tbody></table></div></div>`,'<button id="log-export">Save…</button><button data-dialog="close">Close</button>');$('log-export').onclick=exportLogDialog;
}
function exportLogDialog(){
  dialog('Save log data',`<div class="dialog-body"><div class="form-row"><label for="log-format">Save as type</label><select id="log-format"><option value="adi">ADIF amateur radio log (*.adi)</option><option value="csv">CSV table (*.csv)</option><option value="json">JSON data (*.json)</option></select></div><p>${state.logs.length} log entries</p></div>`,'<button id="log-download">Save</button><button data-dialog="close">Cancel</button>');
  $('log-download').onclick=()=>{
    const format=$('log-format').value;let content;
    if(format==='json')content=JSON.stringify(state.logs,null,2);
    else if(format==='csv'){const keys=['time','call','name','qth','his','my','frequency','mode','note','qsl'];const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';content=keys.join(',')+'\r\n'+state.logs.map(row=>keys.map(k=>cell(row[k])).join(',')).join('\r\n');}
    else{const field=(key,value)=>value?`<${key}:${String(value).length}>${value}`:'';content='MMSSTV web\n<ADIF_VER:5>3.1.4 <PROGRAMID:10>MMSSTV web <EOH>\n'+state.logs.map(r=>field('CALL',r.call)+field('QSO_DATE',r.time.slice(0,10).replaceAll('-',''))+field('TIME_ON',r.time.slice(11,19).replaceAll(':',''))+field('MODE',r.mode==='FAX480'?'FAX':'SSTV')+field('APP_MMSSTV_WEB_MODE',r.mode)+field('FREQ',r.frequency)+field('RST_RCVD',r.his)+field('RST_SENT',r.my)+field('NAME',r.name)+field('QTH',r.qth)+field('COMMENT',r.note)+field('STATION_CALLSIGN',state.settings.myCall)+'<EOR>').join('\n');}
    download(new Blob([content],{type:format==='json'?'application/json':format==='csv'?'text/csv':'text/plain'}),'MMSSTV-log-'+timestamp()+'.'+format);$('modal').close();status('Log data saved.');
  };
}
function logSettingsDialog(){
  dialog('Setup logging',`<div class="dialog-body"><fieldset><legend>Station</legend><div class="form-row"><label for="my-call">My callsign</label><input id="my-call" maxlength="30" value="${escapeHtml(state.settings.myCall)}"></div></fieldset><fieldset disabled><legend>External log link</legend><label><input type="checkbox" disabled>Link to MMLOG / HAMLOG</label></fieldset><p>Log entries are saved in this browser. Use Save log data to download ADIF, CSV, or JSON.</p></div>`,'<button id="log-settings-ok">OK</button><button data-dialog="close">Cancel</button>');$('log-settings-ok').onclick=()=>{state.settings.myCall=$('my-call').value.trim().toUpperCase();persist('settings',state.settings);$('modal').close();};
}
function about(){
  dialog('About MMSSTV',`<div class="dialog-body"><p><img src="assets/mmsstv.ico" width="32" height="32" alt="MMSSTV" style="float:left;margin-right:10px"><b>MMSSTV Ver 1.13A — Web</b><br>Original program by JE3HHT Makoto Mori<br>English translation by JA7UDE Nobuyuki Oba</p><hr><p>Original MMSSTV receiver and audio encoder plus the QSSTV HAMDRM modem compiled to WebAssembly. 46 analog modes and DRM A/B/E with 4/16/64-QAM and optional Reed–Solomon protection. Audio and pictures are processed locally in your browser.</p><p>Switchable MMSSTV and QSSTV interfaces share microphone/audio files, images, templates, history, settings and logs. Generate SSTV or DRM WAV files and download decoded digital files. Radio control and PTT are disabled.</p><p>Combined browser application: GNU General Public License, version 3 or later. The independent MMSSTV core retains LGPL-3.0-or-later terms.</p><div class="link-row"><a href="COPYING.txt" target="_blank" rel="noopener">License</a><a href="THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener">Notices</a><a href="https://github.com/crashdemons-external/mmsstv-web" target="_blank" rel="noopener">Source code</a></div></div>`);
}
function help(){
  dialog('MMSSTV web help',`<div class="dialog-body"><p><b>Receiving SSTV</b></p><p>Select Auto for automatic mode detection, then use Mic or Open audio. PCM WAV and MMSSTV MMV are supported directly; other formats use your browser's audio codecs. Select a specific RX mode to start reception manually.</p><p><b>Picture and history</b></p><p>Images appear progressively on the RX tab. Auto history saves received pictures in this browser. Select History or a stock thumbnail to view them. Save exports the full resolution as PNG, JPEG, or BMP.</p><p><b>Generate SSTV audio</b></p><p>Select TX, then Open to load a picture. Choose a TX mode and Generate WAV. Set the resizing method and optional FSK callsign, then Generate and Save WAV. Decode WAV feeds the generated recording into the receiver. The disabled TX and Tune buttons represent live sound/radio output.</p><p><b>Sync</b></p><p>The Sync tab shows the demodulated sync signal. Phase / Slant redraws the retained received signal. ReSync restarts in the current mode. Lock prevents automatic receiver restart and mode changes.</p><p><b>Sound files</b></p><p>Use View → Adjust play position to seek or pause a recording. Fast decode is the default; choose real time or 8× in Option → Setup MMSSTV → Misc. Audio is fed to the receiver without speaker playback.</p><p><b>DRM / digital files</b></p><p>Choose DRM in either interface. Open a digital file or a TX image, then Generate DRM WAV. Receive DRM images and binary files from uploaded audio or the microphone. Received files, BSR requests and FIX retransmission are available in File/DRM controls. Configuration shares operator, gallery, sound, waterfall and DRM settings. The template editor adds text with callsign and QSO substitutions.</p><p><b>Browser access</b></p><p>Serve web/ over HTTP(S), then open index.html. Microphone and camera access require localhost or HTTPS. Nothing is uploaded to a server. Disabled controls identify features not available in this port.</p></div>`);
}

const actions={
  'open-audio':()=>$('audio-file').click(),microphone:microphoneDialog,stop:()=>stopInput(),pause:()=>{state.paused=!state.paused;updateInputButtons();status(state.paused?'Sound file paused.':'Playing sound file…');},
  'tx-open':()=>{if(tx.busy)return;selectTab('tx');$('tx-image-file').click();},'generate-wav':generateWavDialog,
  'copy-to-tx':()=>setTxImage(currentCanvas(),imageName()),'view-tx':()=>selectTab('tx'),
  'save-image':saveImageDialog,'add-history':()=>{addHistory(true);status('Picture copied to history.');},zoom:()=>zoomImage(),
  'copy-image':async()=>{const canvas=currentCanvas();if(navigator.clipboard?.write && globalThis.ClipboardItem){try{const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);status('Picture copied to clipboard.');return;}catch{}}saveImageDialog();},
  'clear-image':async()=>{if(digital.protocol==='drm'){digital.picture=null;if(digital.engine)await renderDigital(await digital.engine.call('reset',{clear:true}));setProtocol('drm');}else await resetReceiver();status('RX picture cleared.');},
  resync:async()=>{const mode=state.mode<0?state.snapshot.mode:state.mode;await resetReceiver(mode);status('Receiver synchronized in '+state.modes[mode].name+'.');},
  'view-rx':()=>selectTab('rx'),'view-sync':()=>selectTab('sync'),'view-history':()=>selectTab('history'),
  settings:settingsDialog,'log-settings':logSettingsDialog,'play-position':playPositionDialog,
  'spectrum-view':()=>{state.waterfallColor=!state.waterfallColor;clearCanvas($('waterfall'),'#000');},
  'phase-left':async()=>{state.phase--;renderSnapshot(await state.engine.call('redraw',{phase:state.phase,ppm:state.ppm}),true);},
  'phase-right':async()=>{state.phase++;renderSnapshot(await state.engine.call('redraw',{phase:state.phase,ppm:state.ppm}),true);},
  'sync-adjust':syncAdjustDialog,'sync-reset':async()=>{state.phase=state.ppm=0;renderSnapshot(await state.engine.call('redraw',{phase:0,ppm:0}),true);},
  'history-prev':()=>{state.historyIndex--;drawHistory();},'history-next':()=>{state.historyIndex++;drawHistory();},
  'delete-history':()=>{const image=state.history.splice(state.historyIndex,1)[0];if(image)storeImage(image,true);drawHistory();renderStock();updateImageButtons();},
  'stock-pictures':renderStock,'stock-import':()=>$('image-file').click(),'stock-prev':()=>{state.stockPage--;renderStock();},'stock-next':()=>{state.stockPage++;renderStock();},
  'clear-log':()=>{for(const key of ['call','name','qth','note','qsl','my-rst'])$(key).value='';$('his-rst').value='595';},
  'log-data':()=>{const record=logFields();dialog('QSO data',`<div class="dialog-body"><table>${Object.entries(record).map(([key,value])=>`<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table></div>`);},
  'log-list':logList,'export-log':exportLogDialog,
  'export-history':()=>{download(new Blob([JSON.stringify({format:'MMSSTV-web-history',version:1,pictures:state.history},null,2)],{type:'application/json'}),'MMSSTV-history-'+timestamp()+'.json');status('History data saved.');},
  'save-profile':()=>{dialog('Save profile','<div class="dialog-body"><div class="form-row"><label for="profile-name">Profile name</label><input id="profile-name" maxlength="40"></div></div>','<button id="profile-save">Save</button><button data-dialog="close">Cancel</button>');$('profile-save').onclick=()=>{const name=$('profile-name').value.trim();if(!name)return;state.profiles[name]={...state.settings};persist('profiles',state.profiles);renderProfiles();$('modal').close();};},help,about
};
function renderProfiles(){
  document.querySelectorAll('[data-custom-profile]').forEach(button=>button.remove());
  for(const name of Object.keys(state.profiles)){const b=document.createElement('button');b.textContent=name;b.dataset.customProfile=name;$('profiles-menu').append(b);}
}
document.addEventListener('click',event=>{
  const top=event.target.closest('.menu>button');if(top && !top.disabled){const menu=top.parentElement,open=menu.classList.contains('open');closeMenus();if(!open){menu.classList.add('open');top.setAttribute('aria-expanded','true');}return;}
  const button=event.target.closest('button');
  if(button?.dataset.action && !button.disabled){closeMenus();if(!state.engine && !['help','about'].includes(button.dataset.action))return;Promise.resolve().then(()=>actions[button.dataset.action]?.()).catch(failure);}
  else if(button?.dataset.tab)selectTab(button.dataset.tab);
  else if(button?.dataset.mode){if(state.tab==='tx')setTxMode(Number(button.dataset.mode));else resetReceiver(Number(button.dataset.mode)).catch(failure);}
  else if(button?.dataset.profile || button?.dataset.customProfile){
    const name=button.dataset.profile;const profile=name==='default'?defaults:name==='weak'?{...defaults,sensitivity:2,bpf:3,lms:true}:name==='clean'?{...defaults,autoStop:false}:state.profiles[button.dataset.customProfile];
    state.settings={...state.settings,...profile};persist('settings',state.settings);applySettings().catch(failure);status('Receiver profile loaded.');closeMenus();
  }else if(!event.target.closest('.menu'))closeMenus();
});
$('dialog-close').onclick=()=>$('modal').close();
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenus();if((event.ctrlKey||event.metaKey)&&!$('modal').open){if(event.key.toLowerCase()==='o'){event.preventDefault();if(state.engine)$(state.tab==='tx'?'tx-image-file':'audio-file').click();}if(event.key.toLowerCase()==='s'){event.preventDefault();if(state.tab==='tx'?tx.source:state.tab==='history'?state.history.length:state.hasImage)saveImageDialog();}}});
$('audio-file').onchange=()=>{const file=$('audio-file').files[0];$('audio-file').value='';if(file)loadAudio(file).catch(failure);};
$('tx-image-file').onchange=()=>{const file=$('tx-image-file').files[0];$('tx-image-file').value='';if(file){if(file.size>16*1024*1024){failure(new Error('TX picture exceeds 16 MB.'));return;}setTxImage(file,file.name).catch(failure);}};
$('image-file').onchange=async()=>{
  for(const file of $('image-file').files){
    try{if(file.size>16*1024*1024)throw new Error('Stock image exceeds 16 MB.');const bitmap=await decodePicture(file);const canvas=document.createElement('canvas');const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      const item={id:globalThis.crypto?.randomUUID?.()||timestamp()+'-'+Math.random(),kind:'stock',name:file.name,created:new Date().toISOString(),width:canvas.width,height:canvas.height,url:canvas.toDataURL('image/png')};state.stocks.push(item);await storeImage(item);
    }catch(error){failure(error);}
  }$('image-file').value='';renderStock();
};
$('lock').onclick=async()=>{state.locked=!state.locked;$('lock').setAttribute('aria-pressed',String(state.locked));await state.engine.call('option',{id:8,value:Number(state.locked)});};
for(const key of ['afc','lms'])$(key).onclick=async()=>{state.settings[key]=!state.settings[key];persist('settings',state.settings);await applySettings();};
$('auto-history').onchange=()=>{state.settings.autoHistory=$('auto-history').checked;persist('settings',state.settings);};
$('auto-slant').onchange=async()=>{state.settings.autoSlant=$('auto-slant').checked;persist('settings',state.settings);await applySettings();};
$('rx-id').onclick=async()=>{state.settings.fskId=!state.settings.fskId;persist('settings',state.settings);await applySettings();status(state.settings.fskId?'Receive FSK ID enabled.':'Receive FSK ID disabled.');};
$('tx-id').onclick=()=>{state.settings.txFskId=!state.settings.txFskId;persist('settings',state.settings);$('tx-id').setAttribute('aria-pressed',String(state.settings.txFskId));status(state.settings.txFskId?'FSK callsign enabled for generated WAV files.':'FSK callsign disabled for generated WAV files.');};
$('save-qso').onclick=()=>{const record=logFields();if(!record.call){$('call').focus();status('Enter a callsign to save the log entry.');return;}state.logs.push(record);persist('logs',state.logs);status('Log entry saved for '+record.call+'.');};
document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
document.addEventListener('drop',event=>{if(event.dataTransfer?.files.length){event.preventDefault();const file=event.dataTransfer.files[0];if(state.engine){if(state.tab==='tx' && (file.type.startsWith('image/')||/\.(jp2|j2k)$/i.test(file.name))){if(file.size>16*1024*1024)failure(new Error('TX picture exceeds 16 MB.'));else setTxImage(file,file.name).catch(failure);}else loadAudio(file).catch(failure);}}});
window.addEventListener('pagehide',()=>{state.input?.stream?.getTracks().forEach(track=>track.stop());});

(async function initialize(){
  clearCanvas($('rx-picture'));clearCanvas($('sync-picture'));clearCanvas($('history-picture'));clearCanvas($('tx-picture'));clearCanvas($('waterfall'),'#000');drawScale();renderStock();renderProfiles();openDatabase();
  try{
    state.engine=await MMSDecoderEngine.create();state.modes=state.engine.modes;
    try{digital.engine=await QSSTVDigitalEngine.create();}catch(error){console.warn('Digital modem unavailable.',error);}
    const favorites=[-1,0,1,2,3,4,5,6,7,9];
    for(const id of favorites){const button=document.createElement('button');button.textContent=id<0?'Auto':state.modes[id].name;button.dataset.mode=id;button.setAttribute('aria-pressed',String(id===-1));$('rx-modes').append(button);}
    const more=document.createElement('button');more.id='mode-more';more.textContent='More modes…';more.onclick=moreModesDialog;$('rx-modes').append(more);
    await applySettings();renderSnapshot(await state.engine.call('snapshot'),true);
    drawTxImage();updateModeButtons();
    $('mic-button').disabled=false;$('open-button').disabled=false;$('source-name').textContent='No audio input';status('Ready — select microphone or open an audio file.');
  }catch(error){$('source-name').textContent='Receiver unavailable';failure(new Error('Could not initialize MMSSTV: '+error.message));}
})();

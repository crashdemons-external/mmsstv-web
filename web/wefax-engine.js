/* Shared WEFAX boundary: native fldigi DSP, existing MMSSTV pictures/audio. */
(function(root) {
  'use strict';
  const modes=[{id:46,name:'WEFAX IOC576',width:1809},{id:47,name:'WEFAX IOC288',width:904}].map(m=>({...m,height:0,txHeight:512,family:'WEFAX'}));
  const isFax=mode=>mode===46||mode===47;
  let loading;
  async function loadCore() {
    const version=root.MMSAssetVersion||(typeof location!=='undefined'?new URLSearchParams(location.search).get('v'):'')||'';
    if(!root.createWEFAX) {
      loading ||= new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='wefax-core.js?v='+version;script.onload=resolve;script.onerror=()=>reject(Error('Could not load WEFAX core.'));document.head.append(script);});
      await loading;
    }
    return root.createWEFAX({locateFile:(name,dir)=>dir+name+(version?'?v='+version:'')});
  }
  class FaxCore {
    static async create(encoder=false) { const m=await loadCore();return new FaxCore(m,encoder); }
    constructor(core,encoder) { this.core=core;this.encoder=encoder;this.mode=46;this.pointer=core._malloc(65536*4);this.revision=-1;this.completed=core._fax_completed();if(!encoder)core._fax_reset(0); }
    call(action,args={}) {
      const m=this.core;
      if(action==='reset') { this.mode=args.mode;m._fax_reset(this.mode-46);this.revision=-1;this.completed=m._fax_completed(); }
      if(action==='option') { m._fax_option(args.id,args.value);if([0,1,5].includes(args.id))return {}; }
      if(action==='finish')m._fax_finish(args.automatic?0:1);
      if(action==='process')for(let i=0;i<args.samples.length;i+=65536) {const part=args.samples.subarray(i,i+65536);m.HEAPF32.set(part,this.pointer/4);m._fax_process(this.pointer,part.length);}
      if(action==='start') {
        if(!isFax(args.mode)||!Number.isInteger(args.width)||!Number.isInteger(args.height)||args.height<1||args.height>8192||!Number.isInteger(args.lpm??1)||!args.pixels||args.pixels.length!==args.width*args.height*4)throw Error('Invalid WEFAX image.');
        const p=m._malloc(args.pixels.length);
        try {m.HEAPU8.set(args.pixels,p);if(!m._fax_encode_start(args.mode-46,p,args.width,args.height,args.lpm??1))throw Error('Invalid WEFAX dimensions, line speed, or duration (maximum 30 minutes).');}
        finally {m._free(p);}return {};
      }
      if(action==='read') {const count=m._fax_encode_read(this.pointer,32768);return {pcm:m.HEAPU8.slice(this.pointer,this.pointer+count*2),progress:m._fax_encode_progress(),done:!!m._fax_encode_done()};}
      if(action==='cancel') {m._fax_encode_cancel();return {};}
      const result=this.snapshot();
      // Native APT can already have opened an empty next page. Keep the most
      // recently completed picture visible when the file/input ends.
      if((action==='finish'||action==='option'&&args.id===4)&&!result.line&&m._fax_finished_width()&&46+m._fax_finished_mode()===this.mode) {
        result.width=m._fax_finished_width();result.height=m._fax_finished_height();result.line=result.height;
        result.pixels=m.HEAPU8.slice(m._fax_finished_pixels(),m._fax_finished_pixels()+result.width*result.height*4);
        result.serial=m._fax_finished_serial();
      }
      return result;
    }
    snapshot() {
      const m=this.core,width=m._fax_width(),height=m._fax_height(),revision=m._fax_revision();
      const result={mode:this.mode,width,height,revision,serial:m._fax_serial(),completed:m._fax_completed(),line:m._fax_line(),receiving:m._fax_state()===3,faxState:m._fax_state(),level:m._fax_level(),afc:m._fax_frequency()-1900,fsk:'',spectrum:m.HEAP32.slice(m._fax_spectrum()/4,m._fax_spectrum()/4+1024)};
      if(revision!==this.revision) {this.revision=revision;result.pixels=m.HEAPU8.slice(m._fax_pixels(),m._fax_pixels()+width*height*4);}
      if(result.completed!==this.completed) {
        this.completed=result.completed;const w=m._fax_finished_width(),h=m._fax_finished_height();
        result.finished={width:w,height:h,line:h,fraction:1,mode:46+m._fax_finished_mode(),serial:m._fax_finished_serial(),pixels:m.HEAPU8.slice(m._fax_finished_pixels(),m._fax_finished_pixels()+w*h*4)};
      }
      return result;
    }
  }
  async function createFaxEngine(encoder=false) {
    if(typeof Worker!=='undefined'&&typeof location!=='undefined'&&location.protocol!=='file:') {
      const worker=new Worker('wefax-worker.js?v='+(root.MMSAssetVersion||''));
      const engine=encoder?new MMSEncoderEngine(worker):new MMSDecoderEngine(worker);
      try {await engine.call('init',{encoder});return engine;}catch(error){worker.terminate();console.warn('Using main-thread WEFAX.',error);}
    }
    const local=await FaxCore.create(encoder);return encoder?new MMSEncoderEngine(null,local):new MMSDecoderEngine(null,local);
  }
  class SharedDecoder {
    static async create() {const analog=await MMSDecoderEngine.create();return new SharedDecoder(analog);}
    constructor(analog) {this.analog=analog;this.modes=[...analog.modes,...modes];this.mode=-1;this.completed=0;this.options={};this.faxOptions={1:1};this.queue=Promise.resolve();}
    call(action,args={}) {
      // Loading a new worker must finish before input/settings reach that mode.
      const pending=this.queue.then(()=>this.handle(action,args));
      this.queue=pending.catch(()=>{});return pending;
    }
    async handle(action,args) {
      if(action==='reset')this.mode=args.mode;
      if(action==='fax-option') {
        if([1,5,6].includes(args.id))this.faxOptions[args.id]=args.value;
        if(!isFax(this.mode))return {};
        return this.adapt(await this.fax.call('option',args));
      }
      if(action==='option') {
        this.options[args.id]=args.value;
        if(isFax(this.mode))return args.id===0?this.adapt(await this.fax.call('option',{id:0,value:args.value})):{};
      }
      let engine=this.analog;
      if(isFax(this.mode)) {
        this.fax ||= await createFaxEngine();engine=this.fax;
        if(action==='reset') {await engine.call('reset',args);for(const [id,value]of Object.entries(this.faxOptions))await engine.call('option',{id:Number(id),value});await engine.call('option',{id:0,value:this.options[0]??1});return this.adapt(await engine.call('snapshot'));}
      }
      return this.adapt(await engine.call(action,args));
    }
    adapt(result) {
      if(result.serial===undefined)return result;
      const prefix=isFax(this.mode)?'wefax-':'sstv-';result.serial=prefix+result.serial;
      if(result.finished) {result.finished.serial=prefix+result.finished.serial;++this.completed;}
      result.completed=this.completed;return result;
    }
  }
  class SharedEncoder {
    static async create() {return new SharedEncoder();}
    async call(action,args={}) {
      if(action==='start') {this.active=isFax(args.mode)?(this.fax ||= await createFaxEngine(true)):(this.analog ||= await MMSEncoderEngine.create());}
      return this.active?this.active.call(action,args):{};
    }
  }
  Object.assign(root,{WEFAXCore:FaxCore,WEFAXModes:modes,isWEFAXMode:isFax,MMSSharedDecoder:SharedDecoder,MMSSharedEncoder:SharedEncoder});
})(globalThis);

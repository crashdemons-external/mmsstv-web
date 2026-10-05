'use strict';
class MMSSTVInput extends AudioWorkletProcessor {
  constructor(options) {
    super();this.channel=options.processorOptions?.channel||'left';this.values=new Float32Array(2048);this.position=0;
  }
  process(inputs,outputs) {
    const channels=inputs[0];
    if(channels && channels.length) {
      const length=channels[0].length;
      for(let i=0;i<length;i++) {
        let value=0;
        if(this.channel==='mix') for(const channel of channels)value+=channel[i]/channels.length;
        else value=channels[this.channel==='right' && channels.length>1 ? 1 : 0][i];
        this.values[this.position++]=value;
        if(this.position===this.values.length) {this.port.postMessage(this.values,[this.values.buffer]);this.values=new Float32Array(2048);this.position=0;}
      }
    }
    // The input is never monitored or transmitted through the speakers.
    for(const output of outputs)for(const channel of output)channel.fill(0);
    return true;
  }
}
registerProcessor('mmsstv-input',MMSSTVInput);

/* Optional validation of the color-bar images exported through the browser UI. */
'use strict';
const fs=require('node:fs'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const base=process.argv[2]||'out/export-test';
const png=fs.readFileSync(base+'.png');
assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
let width,height,channels;const chunks=[];
for(let p=8;p<png.length;){
  const length=png.readUInt32BE(p),tag=png.toString('ascii',p+4,p+8),data=png.subarray(p+8,p+8+length);
  if(tag==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);assert.ok([2,6].includes(data[9]));channels=data[9]===6?4:3;assert.equal(data[12],0);}
  if(tag==='IDAT')chunks.push(data);
  p+=length+12;
}
assert.equal(width,320);assert.equal(height,256);
const raw=zlib.inflateSync(Buffer.concat(chunks)),stride=width*channels,pixels=Buffer.alloc(stride*height);
assert.equal(raw.length,(stride+1)*height);
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb && pa<=pc?a:pb<=pc?b:c;};
for(let y=0;y<height;y++){
  const filter=raw[y*(stride+1)];assert.ok(filter<=4);
  for(let x=0;x<stride;x++){
    const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y && x>=channels?pixels[i-stride-channels]:0;
    const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
    pixels[i]=(raw[y*(stride+1)+1+x]+predictor)&255;
  }
}
function colors(read){for(let c=0;c<3;c++){const color=read(30+c*80,80);assert.ok(color[c]>180);assert.ok(color[(c+1)%3]<80);}}
colors((x,y)=>pixels.subarray((y*width+x)*channels,(y*width+x)*channels+3));
const bmp=fs.readFileSync(base+'.bmp');assert.equal(bmp.toString('ascii',0,2),'BM');assert.equal(bmp.readUInt32LE(2),bmp.length);assert.equal(bmp.readInt32LE(18),width);assert.equal(bmp.readInt32LE(22),height);
assert.equal(bmp.readUInt16LE(28),24);assert.equal(bmp.readUInt32LE(30),0);
const row=(width*3+3)&~3,start=bmp.readUInt32LE(10);
colors((x,y)=>{const p=start+(height-1-y)*row+x*3;return [bmp[p+2],bmp[p+1],bmp[p]];});
const jpeg=fs.readFileSync(base+'.jpg');assert.equal(jpeg.readUInt16BE(0),0xffd8);assert.equal(jpeg.readUInt16BE(jpeg.length-2),0xffd9);
let found=false;
for(let p=2;p<jpeg.length;){
  assert.equal(jpeg[p],0xff);const marker=jpeg[p+1],length=jpeg.readUInt16BE(p+2);
  if(marker===0xc0 || marker===0xc2){assert.equal(jpeg.readUInt16BE(p+5),height);assert.equal(jpeg.readUInt16BE(p+7),width);found=true;break;}
  p+=length+2;
}
assert.ok(found,'JPEG image dimensions');
console.log('Browser PNG and BMP pixels/dimensions, PNG compression, and JPEG header/dimensions passed.');

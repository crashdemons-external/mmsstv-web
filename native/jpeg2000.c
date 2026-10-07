/* Bounded memory-only OpenJPEG adapter. BSD-2-Clause. */
#include <openjpeg.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>
typedef struct { unsigned char *data; size_t size,pos,cap; int writable; } Memory;
static unsigned char *pixels=NULL;
static int width=0,height=0;
static Memory encoded={0};
static OPJ_SIZE_T read_bytes(void *buffer,OPJ_SIZE_T length,void *user){Memory *m=user;if(m->pos>=m->size)return (OPJ_SIZE_T)-1;if(length>m->size-m->pos)length=m->size-m->pos;memcpy(buffer,m->data+m->pos,length);m->pos+=length;return length;}
static OPJ_BOOL seek_bytes(OPJ_OFF_T position,void *user){Memory *m=user;if(position<0 || (uint64_t)position>(m->writable?32*1024*1024:m->size))return OPJ_FALSE;m->pos=(size_t)position;return OPJ_TRUE;}
static OPJ_OFF_T skip_bytes(OPJ_OFF_T length,void *user){Memory *m=user;return seek_bytes((OPJ_OFF_T)m->pos+length,user)?length:-1;}
static OPJ_SIZE_T write_bytes(void *buffer,OPJ_SIZE_T length,void *user){Memory *m=user;if(m->pos>32*1024*1024 || length>32*1024*1024-m->pos)return (OPJ_SIZE_T)-1;size_t needed=m->pos+length;if(needed>m->cap){size_t cap=needed*2;if(cap>32*1024*1024)cap=32*1024*1024;void *p=realloc(m->data,cap);if(!p)return (OPJ_SIZE_T)-1;m->data=p;m->cap=cap;}memcpy(m->data+m->pos,buffer,length);m->pos+=length;if(m->pos>m->size)m->size=m->pos;return length;}
static opj_stream_t *stream(Memory *m){opj_stream_t *s=opj_stream_create(65536,!m->writable);opj_stream_set_user_data(s,m,NULL);opj_stream_set_user_data_length(s,m->size);opj_stream_set_read_function(s,read_bytes);opj_stream_set_write_function(s,write_bytes);opj_stream_set_skip_function(s,skip_bytes);opj_stream_set_seek_function(s,seek_bytes);return s;}
static void quiet(const char *message,void *user){(void)message;(void)user;}
static void handlers(opj_codec_t *c){opj_set_error_handler(c,quiet,NULL);opj_set_warning_handler(c,quiet,NULL);opj_set_info_handler(c,quiet,NULL);}
static int clamp(int v){return v<0?0:v>255?255:v;}
static int value(opj_image_comp_t *c,int x,int y){int cx=x/c->dx,cy=y/c->dy;if(cx>=(int)c->w)cx=c->w-1;if(cy>=(int)c->h)cy=c->h-1;int v=c->data[cy*c->w+cx];if(c->sgnd)v+=1<<(c->prec-1);return clamp((int)((int64_t)v*255/((1<<c->prec)-1)));}
int jp2_decode(const unsigned char *bytes,int count){
 free(pixels);pixels=NULL;width=height=0;if(count<2 || count>16*1024*1024)return 0;
 Memory mem={(unsigned char*)bytes,(size_t)count,0,0,0};opj_image_t *image=NULL;
 opj_codec_t *codec=opj_create_decompress(bytes[0]==255&&bytes[1]==79?OPJ_CODEC_J2K:OPJ_CODEC_JP2);opj_dparameters_t params;opj_set_default_decoder_parameters(&params);handlers(codec);opj_stream_t *s=stream(&mem);int ok=0;
 if(!opj_setup_decoder(codec,&params)||!opj_read_header(s,codec,&image)||!image)goto done;
 if(image->x0||image->y0||image->x1<1||image->y1<1||(uint64_t)image->x1*image->y1>40000000 || image->numcomps<1 || image->numcomps>4 || image->color_space==OPJ_CLRSPC_CMYK)goto done;
 for(unsigned i=0;i<image->numcomps;i++)if(!image->comps[i].dx||!image->comps[i].dy||!image->comps[i].w||!image->comps[i].h||image->comps[i].prec<1||image->comps[i].prec>16||(uint64_t)image->comps[i].w*image->comps[i].h>40000000)goto done;
 if(!opj_decode(codec,s,image)||!opj_end_decompress(codec,s))goto done;
 width=image->x1;height=image->y1;pixels=malloc((size_t)width*height*4);if(!pixels)goto done;
 for(int y=0;y<height;y++)for(int x=0;x<width;x++){
  int r=value(&image->comps[0],x,y),g=r,b=r,a=255;
  if(image->numcomps>=3){g=value(&image->comps[1],x,y);b=value(&image->comps[2],x,y);if(image->color_space==OPJ_CLRSPC_SYCC){int cb=g-128,cr=b-128;g=clamp(r-.344136*cb-.714136*cr);b=clamp(r+1.772*cb);r=clamp(r+1.402*cr);}}
  if(image->numcomps==4)a=value(&image->comps[3],x,y);else if(image->numcomps==2)a=value(&image->comps[1],x,y);
  size_t p=((size_t)y*width+x)*4;pixels[p]=r;pixels[p+1]=g;pixels[p+2]=b;pixels[p+3]=a;
 }ok=1;
 done:if(image)opj_image_destroy(image);opj_stream_destroy(s);opj_destroy_codec(codec);if(!ok){free(pixels);pixels=NULL;width=height=0;}return ok;
}
int jp2_width(){return width;}int jp2_height(){return height;}const unsigned char *jp2_pixels(){return pixels;}
int jp2_encode(const unsigned char *rgba,int w,int h,float ratio){
 free(encoded.data);memset(&encoded,0,sizeof(encoded));encoded.writable=1;if(!rgba||w<2||h<2||(uint64_t)w*h>40000000||ratio<1||ratio>1000)return 0;
 opj_image_cmptparm_t cp[3];memset(cp,0,sizeof(cp));for(int i=0;i<3;i++){cp[i].dx=cp[i].dy=1;cp[i].w=w;cp[i].h=h;cp[i].prec=8;}
 opj_image_t *image=opj_image_create(3,cp,OPJ_CLRSPC_SRGB);if(!image)return 0;image->x1=w;image->y1=h;
 for(int i=0;i<w*h;i++)for(int c=0;c<3;c++)image->comps[c].data[i]=rgba[i*4+c];
 opj_cparameters_t params;opj_set_default_encoder_parameters(&params);params.tcp_numlayers=1;params.tcp_rates[0]=ratio==1?0:ratio;params.cp_disto_alloc=1;params.tcp_mct=1;params.irreversible=ratio>1;params.numresolution=1;int min=w<h?w:h;while(params.numresolution<6 && min>=2){params.numresolution++;min/=2;}
 opj_codec_t *codec=opj_create_compress(OPJ_CODEC_JP2);handlers(codec);opj_stream_t *s=stream(&encoded);
 int ok=opj_setup_encoder(codec,&params,image)&&opj_start_compress(codec,image,s)&&opj_encode(codec,s)&&opj_end_compress(codec,s);
 opj_stream_destroy(s);opj_destroy_codec(codec);opj_image_destroy(image);if(!ok){free(encoded.data);memset(&encoded,0,sizeof(encoded));return 0;}return encoded.size;
}
const unsigned char *jp2_file(){return encoded.data;}

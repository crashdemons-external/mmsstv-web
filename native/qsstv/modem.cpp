// Browser boundary for the QSSTV / PA0MBO / Dream GPL-2.0-or-later modem.
#include "compat.h"
#include "drmtx/common/CDrmTransmitter.h"
#include "drmtx/common/csoundout.h"
#include "drmrx/demodulator.h"
#include "drmrx/drm.h"
#include "drmtransmitter.h"
#include "hilbert.inc"
#include <map>
#include <memory>
#include "rs.h"

extern float browserFAC[130], MSC_cells_sequence[2*2959];
extern int lMSC;
QList<int> fixBlockList;
int numTxFrames=0, browserTransportID=0;
static std::vector<short> audio;
static size_t audioPos=0;
CSoundOut::CSoundOut() {}
CSoundOut::~CSoundOut() {}
bool CSoundOut::Write(CVector<short>& samples) {
  for(size_t i=0;i+1<samples.size();i+=2) audio.push_back(samples[i]);
  return true;
}
class BrowserTransmitter: public CDRMTransmitter {
public:
  void step() {
    AudioSourceEncoder.ProcessData(TransmParam,AudSrcBuf);
    MSCMLCEncoder.ProcessData(TransmParam,AudSrcBuf,MLCEncBuf);
    SymbInterleaver.ProcessData(TransmParam,MLCEncBuf,IntlBuf);
    GenerateFACData.ReadData(TransmParam,GenFACDataBuf);
    FACMLCEncoder.ProcessData(TransmParam,GenFACDataBuf,FACMapBuf);
    OFDMCellMapping.ProcessData(TransmParam,IntlBuf,FACMapBuf,CarMapBuf);
    OFDMModulation.ProcessData(TransmParam,CarMapBuf,OFDMModBuf);
    TransmitData.WriteData(TransmParam,OFDMModBuf);
  }
};
static std::unique_ptr<BrowserTransmitter> transmitter;
static QByteArray payload;
static int txSteps=0;
struct Transport {
  std::string name;
  std::map<int,std::vector<unsigned char>> segments, headers;
  int total=0, bytes=0, segmentSize=0, allocated=0, modeCode=0;
  bool last=false, delivered=false;
};
static std::map<int,Transport> transports;
static std::vector<unsigned char> holding, received;
static std::string receivedName;
static int continuity=-1, fileSerial=0, validPackets=0;
static std::vector<double> hilbertHistory(153,0);
static std::vector<float> iq;
static int stripeFill=0;
static float stripe[1024];
static std::vector<unsigned char> rsOutput;
static std::string bsr;
static int rsDataSize(int type) { return type==1?224:type==2?192:type==3?160:type==4?128:0; }
static bool recoverRS(Transport& t, std::vector<unsigned char>& bytes,std::string& name) {
  auto dot=t.name.find_last_of('.'); auto ext=dot==std::string::npos?"":t.name.substr(dot+1);
  int type=ext.size()==3&&ext.substr(0,2)=="rs"?ext[2]-'0':0, dataSize=rsDataSize(type);
  if(!dataSize) return false;
  int rows=(t.bytes+254)/255;
  if(rows<=0 || rows>65535 || !t.segmentSize) return false;
  init_rs(dataSize); std::vector<unsigned char> decoded;
  for(int row=0;row<rows;row++) {
    unsigned char block[255]={0}; int erasures[255],count=0;
    for(int j=0;j<255;j++) {
      int p=j*rows+row,seg=p/t.segmentSize,off=p%t.segmentSize;
      if(t.segments.count(seg)&&size_t(off)<t.segments[seg].size()) block[j]=t.segments[seg][off];
      else erasures[count++]=j;
    }
    if(count>255-dataSize || eras_dec_rs(block,erasures,count)<0) return false;
    decoded.insert(decoded.end(),block,block+dataSize);
  }
  if(decoded.size()<7 || (decoded[1]|(decoded[2]<<8))!=rows) return false;
  int size=rows*dataSize-decoded[0]; if(size<0 || size_t(size+7)>decoded.size()) return false;
  std::string format((char*)decoded.data()+3,3); format.resize(format.find('\0')==std::string::npos?format.size():format.find('\0'));
  name=t.name.substr(0,dot)+"."+format;
  bytes.assign(decoded.begin()+7,decoded.begin()+7+size); return true;
}

// Bounded MOT packet assembly based on QSSTV sourcedecoder.cpp. Files are
// returned as bytes; paths supplied by senders never become filesystem paths.
bool sourceDecoder::decode() {
  int n=length_decoded_data/8;
  if(channel_decoded_data_buffer_data_valid!=1 || audio_data_flag==0 || n<3 || n>512) return false;
  std::vector<unsigned char> packet(n);
  bits2bytes(channel_decoded_data_buffer,n*8,packet.data());
  double crc; crc16_bytewise(&crc,packet.data(),n);
  if(std::abs(crc)>DBL_EPSILON) { msc_valid=INVALID; continuity=-1; return false; }
  validPackets++;
  int h=packet[0], ci=h&7, offset=(h&8)?2:1, length=(h&8)?packet[1]:n-3;
  if(offset+length>n-2) return false;
  if(h&128) { holding.clear(); continuity=ci; }
  else if(continuity<0 || ci!=(continuity+1)%8) { continuity=-1; holding.clear(); return false; }
  continuity=ci;
  if(holding.size()+length>16384) { continuity=-1; return false; }
  holding.insert(holding.end(),packet.begin()+offset,packet.begin()+offset+length);
  if(!(h&64)) return false;
  auto& b=holding;
  if(b.size()<4) return false;
  h=b[0]; int type=h&7;
  if(h&64) { crc16_bytewise(&crc,b.data(),b.size()); if(std::abs(crc)>DBL_EPSILON) return false; b.resize(b.size()-2); }
  size_t p=2+(h&128?2:0);
  int segment=0, transport=65535; bool last=false;
  if(h&32) { if(p+2>b.size()) return false; last=b[p]&128; segment=((b[p]&127)<<8)|b[p+1]; p+=2; }
  if(h&16) { if(p>=b.size()) return false; int user=b[p++], len=user&15; if(p+len>b.size()) return false; if((user&16)&&len>=2) transport=(b[p]<<8)|b[p+1]; p+=len; }
  if(p+2>b.size()) return false;
  int size=((b[p]&31)<<8)|b[p+1]; p+=2;
  if(p+size>b.size() || segment>8191 || (type!=3&&type!=4)) return false;
  if(!transports.count(transport) && transports.size()>=16) transports.erase(transports.begin());
  Transport& t=transports[transport];
  // QSSTV reserves three rotating IDs for BSR requests; they are reused.
  if(t.delivered && transport<=2 && type==3 && segment==0) t=Transport{};
  if(t.delivered) { msc_valid=ALREADYRECEIVED; return true; }
  t.modeCode=robustness_mode*10000+spectrum_occupancy_new*1000+(multiplex_description.PL_PartB==1?100:0)+(msc_mode_new==3?0:msc_mode_new==0?20:10)+interleaver_depth_new;
  rxTransportID=transport; currentSegmentNumber=segment; msc_valid=VALID;
  auto& segments=type==3?t.headers:t.segments;
  if(!segments.count(segment)) {
    if(t.allocated+size>16*1024*1024+65536 || (type==3 && segment>15)) { transports.erase(transport); return false; }
    t.allocated+=size; segments[segment]={b.begin()+p,b.begin()+p+size};
  }
  if(type==3) {
    std::vector<unsigned char> header;
    for(int i=0;t.headers.count(i);i++) header.insert(header.end(),t.headers[i].begin(),t.headers[i].end());
    if(header.size()>=7) {
      t.bytes=(header[0]<<20)|(header[1]<<12)|(header[2]<<4)|(header[3]>>4);
      if(t.bytes>16*1024*1024) { transports.erase(transport); return false; }
      for(size_t k=7;k<header.size();) {
        int pi=header[k++], len=0;
        switch(pi>>6) { case 1:len=1;break;case 2:len=4;break;case 3:if(k>=header.size()) return false;len=header[k++];if(len&128){if(k>=header.size())return false;len=((len&127)<<8)|header[k++];} }
        if(k+len>header.size()) break;
        if((pi&63)==12&&len>1) t.name.assign((char*)header.data()+k+1,len-1);
        k+=len;
      }
    }
  } else {
    if(!last) t.segmentSize=size;
    if(!t.segmentSize) t.segmentSize=size;
    t.total=std::max(t.total,segment+1); if(last) { t.total=segment+1; t.last=true; }
  }
  bodyTotalSegments=t.total; rxSegments=t.segments.size();
  if(t.last && t.bytes>0 && !t.name.empty() && recoverRS(t,received,receivedName)) { t.delivered=true; fileSerial++; }
  else if(t.last && t.bytes>0 && !t.name.empty() && t.segments.size()==size_t(t.total)) {
    std::vector<unsigned char> complete;
    for(int i=0;i<t.total;i++) { if(!t.segments.count(i)) return true; complete.insert(complete.end(),t.segments[i].begin(),t.segments[i].end()); }
    if(complete.size()<size_t(t.bytes)) return true;
    complete.resize(t.bytes); t.delivered=true;
    if(transport>2 || receivedName!=t.name || received!=complete) { received=std::move(complete); receivedName=t.name; fileSerial++; }
  }
  return true;
}
extern "C" {
void drm_rx_reset(int clear) {
  if(!demodulatorPtr) demodulatorPtr=new demodulator;
  if(!srcDecoder) srcDecoder=new sourceDecoder;
  demodulatorPtr->init(); initGetmode(DRMBUFSIZE/4);
  runstate=RUN_STATE_POWER_ON; channel_decoding(); runstate=RUN_STATE_INIT; channel_decoding(); runstate=RUN_STATE_NORMAL;
  if(clear) { transports.clear(); received.clear(); receivedName.clear(); rxTransportID=currentSegmentNumber=0; }
  holding.clear(); continuity=-1;
  rxSegments=bodyTotalSegments=validPackets=0; stripeFill=0;
  std::fill(hilbertHistory.begin(),hilbertHistory.end(),0);
}
void drm_rx_process(const float* input,int count) {
  for(int i=0;i<count;i++) {
    stripe[stripeFill++]=input[i]*32767;
    if(stripeFill!=1024) continue;
    stripeFill=0; iq.resize(2048);
    for(int k=0;k<1024;k++) {
      memmove(hilbertHistory.data()+1,hilbertHistory.data(),152*sizeof(double)); hilbertHistory[0]=stripe[k];
      double q=0; for(int j=0;j<153;j++) q+=hilbertHistory[j]*hilbert[j];
      iq[2*k]=q/1.569749; iq[2*k+1]=hilbertHistory[76];
    }
    if(input_samples_buffer_request==0) demodulatorPtr->demodulate(iq.data(),0);
    demodulatorPtr->demodulate(iq.data(),1024);
  }
}
int drm_rx_status(int key) {
  switch(key) {
    case 0:return demodulatorPtr&&demodulatorPtr->isTimeSync(); case 1:return demodulatorPtr&&demodulatorPtr->isFrameSync();
    case 2:return fac_valid==1; case 3:return msc_valid!=INVALID; case 4:return robustness_mode; case 5:return msc_mode_new;
    case 6:return spectrum_occupancy_new; case 7:return interleaver_depth_new; case 8:return multiplex_description.PL_PartB;
    case 9:return rxTransportID; case 10:return currentSegmentNumber; case 11:return rxSegments; case 12:return bodyTotalSegments;
    case 13:return fileSerial; case 14:return validPackets;
  } return 0;
}
const float* drm_rx_constellation(int kind) { return kind?MSC_cells_sequence:browserFAC; }
int drm_rx_constellation_count(int kind) { return kind?std::clamp(lMSC,0,2959):std::clamp(lFAC,0,65); }
float drm_rx_snr() { return WMERFAC; }
float drm_rx_offset() { return freqOffset-350; }
const char* drm_rx_call() { return drmCallsign.c_str(); }
const char* drm_rx_name() { return receivedName.c_str(); }
const unsigned char* drm_rx_file() { return received.data(); }
int drm_rx_size() { return received.size(); }
const char* drm_rx_bsr() {
  bsr.clear(); auto it=transports.find(rxTransportID); if(it==transports.end()||it->second.delivered) return bsr.c_str();
  auto& t=it->second; bsr=std::to_string(rxTransportID)+"\nH_OK\n"+std::to_string(t.segmentSize)+"\n";
  for(int i=0;i<t.total;i++) if(!t.segments.count(i)) bsr+=std::to_string(i)+"\n";
  std::string profile=std::to_string(std::clamp(t.modeCode,0,99999));profile.insert(0,5-profile.size(),'0');
  bsr+="-99\n"+t.name+"\n"+profile+"\n"; return bsr.c_str();
}
int drm_rs_encode(const unsigned char* bytes,int count,const char* extension,int type) {
  int dataSize=rsDataSize(type); if(!dataSize || count<1 || count>16*1024*1024) return 0;
  int rows=(count+7+dataSize-1)/dataSize; if(rows>65535) return 0;
  std::vector<unsigned char> data(rows*dataSize,0), encoded(rows*255,0);
  data[0]=rows*dataSize-count; data[1]=rows&255; data[2]=rows>>8;
  for(int i=0;i<3&&extension[i];i++) data[3+i]=extension[i];
  std::copy_n(bytes,count,data.begin()+7); init_rs(dataSize);
  for(int i=0;i<rows;i++) { std::copy_n(data.begin()+i*dataSize,dataSize,encoded.begin()+i*255); encode_rs(encoded.data()+i*255,encoded.data()+i*255+dataSize); }
  rsOutput.resize(rows*255); for(int i=0;i<rows;i++)for(int j=0;j<255;j++) rsOutput[j*rows+i]=encoded[i*255+j];
  return rsOutput.size();
}
const unsigned char* drm_rs_file() { return rsOutput.data(); }
int drm_rs_size() { return rsOutput.size(); }
int drm_tx_start(const unsigned char* bytes,int count,const char* name,const char* call,int mode,int bandwidth,int qam,int protection,int interleave,int transport) {
  if(count<1 || count>16*1024*1024 || mode<0||mode>2||qam<0||qam>2 || bandwidth<0 || bandwidth>1 || protection<0 || protection>1 || interleave<0 || interleave>1) return 0;
  transmitter.reset(new BrowserTransmitter); audio.clear(); audioPos=0; txSteps=0; stopDRM=false;
  browserTransportID=transport>2?transport&65535:0;payload=QByteArray((const char*)bytes,count); txTransportID=transport&65535;
  std::string filename(name), stem=filename, extension="bin"; auto dot=filename.find_last_of('.');
  if(dot!=std::string::npos) { stem=filename.substr(0,dot); extension=filename.substr(dot+1); }
  transmitter->init_base();
  transmitter->GetAudSrcEnc()->ClearPicFileNames(); transmitter->GetAudSrcEnc()->SetPicFileName(&payload,QString(stem),QString(extension));
  auto* p=transmitter->GetParameters();
  p->InitCellMapTable(mode==0?RM_ROBUSTNESS_MODE_A:mode==1?RM_ROBUSTNESS_MODE_B:RM_ROBUSTNESS_MODE_E,bandwidth?SO_1:SO_0);
  p->SetInterleaverDepth(interleave?CParameter::SI_SHORT:CParameter::SI_LONG);
  p->SetMSCCodingScheme(qam==0?CS_1_SM:qam==1?CS_2_SM:CS_3_SM);
  CMSCProtLev level; level.iPartA=0; level.iPartB=protection?1:0; level.iHierarch=0; p->SetMSCProtLev(level,false);
  CService service=p->Service[0]; service.strLabel=call; p->SetServiceParameters(0,service);
  transmitter->Init(); return numTxFrames;
}
int drm_tx_read(short* output,int capacity) {
  if(!transmitter) return 0;
  while(audioPos==audio.size() && !stopDRM) {
    audio.clear(); audioPos=0; transmitter->step(); if(++txSteps>10000000) { stopDRM=true; return -1; }
  }
  int n=std::min<size_t>(capacity,audio.size()-audioPos);
  std::copy_n(audio.data()+audioPos,n,output); audioPos+=n; return n;
}
float drm_tx_progress() { return stopDRM?1:std::min(.99, double(txSteps)/std::max(1,numTxFrames*24)); }
void drm_tx_cancel() { stopDRM=true; transmitter.reset(); audio.clear(); audioPos=0; }
void drm_tx_fix(const int* blocks,int count) { fixBlockList.clear(); for(int i=0;i<count&&i<8192;i++) if(blocks[i]>=0&&blocks[i]<8192) fixBlockList.append(blocks[i]); }
}

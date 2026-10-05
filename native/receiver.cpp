// MMSSTV browser receiver adapter. LGPL-3.0-or-later.
#include "receiver.h"
#include <emscripten/emscripten.h>

double SampFreq = 11025, SampBase = 11025, FFTSamp = 11025;
int FFT_SIZE = 2048, FFTSampType = 0;
BrowserSettings sys;

WebReceiver::WebReceiver() { reset(-1); }

void WebReceiver::reset(int mode) {
    selected = mode;
    dem = std::make_unique<CSSTVDEM>();
    pDem = dem.get();
    dem->m_OverFlow = 0;
    dem->m_fskcall[0] = 0;
    dem->m_fskNRS[0] = 0;
    dem->Start(mode < 0 ? smSCT1 : mode, mode >= 0);
    if (mode < 0) dem->m_SyncMode = 0;
    image.resize(320, 256);
    sync.resize(320, 256);
    stored.clear(); storedSync.clear();
    active = false;
    m_AY = -5; m_AX = -1;
    m_SyncPos = m_SyncRPos = -1;
    m_AutoSyncCount = m_AutoSyncDis = 0;
    InitAutoStop();
    fft.InitFFT();
    fft.m_CollectFFT = 0;
    ++revision;
}

void WebReceiver::begin() {
    int w, h;
    SSTVSET.GetBitmapSize(w, h, SSTVSET.m_Mode);
    image.resize(w, h);
    sync.resize(320, 256);
    stored.clear(); storedSync.clear();
    dem->m_fskcall[0] = 0;
    m_DSEL = 0; m_AX = -1; m_AY = -5;
    m_SyncPos = m_SyncRPos = -1;
    m_AutoSyncCount = m_AutoSyncDis = 0;
    std::memset(m_Y36, 0, sizeof(m_Y36));
    std::memset(m_D36, 0, sizeof(m_D36));
    InitAutoStop();
    dem->m_wBgn = 1;
    active = true;
    ++serial; ++revision;
}

void WebReceiver::finish() {
    if (active) {
        // Auto detection can start another picture in the remainder of the
        // current block. Preserve the completed bitmap for browser history.
        completedImage.resize(image.Width, image.Height);
        completedImage.data = image.data;
        completedMode = SSTVSET.m_Mode; completedSerial = serial;
        ++completed; ++revision;
    }
    active = false;
    dem->Stop();
    if (!locked) {
        dem->Start(selected < 0 ? SSTVSET.m_Mode : selected, 0);
        if (selected < 0) dem->m_SyncMode = 0;
    }
}

void WebReceiver::drain() {
    if (!dem->m_Sync || dem->m_wPage == dem->m_rPage) return;
    if (dem->m_wBgn) {
        if (dem->m_wBgn != 1) begin();
        SyncSSTV();
        if (dem->m_wBgn) return;
    }
    while (dem->m_Sync && dem->m_wPage != dem->m_rPage) {
        short* ip = dem->m_Buf + dem->m_rPage * dem->m_BWidth;
        short* sp = dem->m_B12 + dem->m_rPage * dem->m_BWidth;
        // Bound the retained receive buffer to the largest supported picture.
        if (stored.size() < size_t(11025*600)) {
            stored.insert(stored.end(), ip, ip + SSTVSET.m_WD);
            storedSync.insert(storedSync.end(), sp, sp + SSTVSET.m_WD);
        }
        if (sys.m_Differentiator && SSTVSET.m_Mode != smSCTDX) DrawSSTVDiff(ip, sp);
        else DrawSSTVNormal(ip, sp);
        dem->m_rBase += SSTVSET.m_WD;
        dem->m_rPage = (dem->m_rPage + 1) % SSTVDEMBUFMAX;
        ++revision;
        if (m_AY > SSTVSET.m_L) { finish(); break; }
    }
}

void WebReceiver::process(const float* data, int count) {
    double fftData[256];
    int offset = 0;
    while (offset < count) {
        int length = std::min(256, count-offset);
        for (int i = 0; i < length; ++i) {
            double value = std::isfinite(data[offset+i]) ? std::clamp(double(data[offset+i]), -1.0, 1.0)*32767 : 0;
            if (useLms) value = lms.Do(value);
            fftData[i] = value;
            dem->Do(value);
            dem->m_lvl.Fix();
            if (dem->m_LevelType) dem->m_SyncLvl.Fix();
            // Drain at every line boundary; no dropped ring-buffer pages at high file speeds.
            if (dem->m_wPage != dem->m_rPage) drain();
        }
        fft.CollectFFT(fftData, length);
        const double gains[] = {30,34,42,54};
        while (fft.IsData()) fft.CalcFFT(FFT_SIZE/2-1, gains[sys.m_FFTGain&3], 2);
        offset += length;
    }
    if (m_ReqSampChg) {
        double corrected = SSTVSET.m_SampFreq;
        m_ReqSampChg = 0;
        redraw((corrected / sys.m_SampFreq - 1)*1e6, 0);
    }
}

void WebReceiver::redraw(double ppm, double phase) {
    if (stored.empty()) return;
    SSTVSET.m_SampFreq = sys.m_SampFreq * (1 + std::clamp(ppm, -30000.0, 30000.0)*1e-6);
    SSTVSET.SetSampFreq();
    int base = SSTVSET.m_IOFS + int(phase * SSTVSET.m_KS / image.Width);
    int savedBase = dem->m_rBase;
    bool receiving = dem->m_Sync;
    dem->m_Sync = 0;
    m_AX = -1; m_AY = -5; m_DSEL = 0;
    std::fill(image.data.begin(), image.data.end(), 255);
    std::fill(sync.data.begin(), sync.data.end(), 255);
    InitAutoStop();
    m_ASDis = 1;
    // Original drawing functions sample slightly ahead for black-level correction.
    std::vector<short> values = stored;
    values.resize(values.size() + SSTVSET.m_KSB*2 + 4, -16384);
    for (size_t n = 0; n + SSTVSET.m_WD <= stored.size(); n += SSTVSET.m_WD) {
        dem->m_rBase = base + int(n);
        if (sys.m_Differentiator && SSTVSET.m_Mode != smSCTDX) DrawSSTVDiff(values.data()+n, storedSync.data()+n);
        else DrawSSTVNormal(values.data()+n, storedSync.data()+n);
    }
    m_ASDis = 0;
    dem->m_Sync = receiving;
    dem->m_rBase = base + savedBase - SSTVSET.m_OFS;
    SSTVSET.m_OFS = base;
    ++revision;
}

#include "receive_image.inc"

static std::unique_ptr<WebReceiver> receiver;
static std::vector<BYTE> rgba, syncRgba, completedRgba;
static BYTE* convert(const Bitmap& bitmap, std::vector<BYTE>& output) {
    output.resize(size_t(bitmap.Width)*bitmap.Height*4);
    for (size_t i = 0, j = 0; i < bitmap.data.size(); i += 3, j += 4) {
        output[j] = bitmap.data[i+2]; output[j+1] = bitmap.data[i+1];
        output[j+2] = bitmap.data[i]; output[j+3] = 255;
    }
    return output.data();
}
extern "C" {
EMSCRIPTEN_KEEPALIVE void web_init() { receiver = std::make_unique<WebReceiver>(); }
EMSCRIPTEN_KEEPALIVE void web_reset(int mode) { if (mode >= -1 && mode < smEND) receiver->reset(mode); }
EMSCRIPTEN_KEEPALIVE void web_process(const float* values, int count) {
    if (values && count > 0 && count <= 65536) receiver->process(values, count);
}
EMSCRIPTEN_KEEPALIVE int web_mode_count() { return smEND; }
EMSCRIPTEN_KEEPALIVE const char* web_mode_name(int mode) { return mode >= 0 && mode < smEND ? SSTVModeList[mode] : "Auto"; }
EMSCRIPTEN_KEEPALIVE int web_mode() { return SSTVSET.m_Mode; }
EMSCRIPTEN_KEEPALIVE int web_width() { return receiver->image.Width; }
EMSCRIPTEN_KEEPALIVE int web_height() { return receiver->image.Height; }
EMSCRIPTEN_KEEPALIVE int web_mode_width(int mode) { int w=0,h=0; if(mode>=0 && mode<smEND) SSTVSET.GetBitmapSize(w,h,mode); return w; }
EMSCRIPTEN_KEEPALIVE int web_mode_height(int mode) { int w=0,h=0; if(mode>=0 && mode<smEND) SSTVSET.GetBitmapSize(w,h,mode); return h; }
EMSCRIPTEN_KEEPALIVE BYTE* web_pixels() { return convert(receiver->image, rgba); }
EMSCRIPTEN_KEEPALIVE BYTE* web_sync_pixels() { return convert(receiver->sync, syncRgba); }
EMSCRIPTEN_KEEPALIVE int web_revision() { return receiver->revision; }
EMSCRIPTEN_KEEPALIVE int web_serial() { return receiver->serial; }
EMSCRIPTEN_KEEPALIVE int web_completed() { return receiver->completed; }
EMSCRIPTEN_KEEPALIVE BYTE* web_completed_pixels() { return convert(receiver->completedImage, completedRgba); }
EMSCRIPTEN_KEEPALIVE int web_completed_width() { return receiver->completedImage.Width; }
EMSCRIPTEN_KEEPALIVE int web_completed_height() { return receiver->completedImage.Height; }
EMSCRIPTEN_KEEPALIVE int web_completed_mode() { return receiver->completedMode; }
EMSCRIPTEN_KEEPALIVE int web_completed_serial() { return receiver->completedSerial; }
EMSCRIPTEN_KEEPALIVE int web_receiving() { return receiver->dem->m_Sync; }
EMSCRIPTEN_KEEPALIVE int web_line() { return std::max(0, receiver->m_AY); }
EMSCRIPTEN_KEEPALIVE double web_level() { return receiver->dem->m_lvl.m_CurMax / 32768; }
EMSCRIPTEN_KEEPALIVE int web_afc() { return receiver->dem->m_AFCFQ; }
EMSCRIPTEN_KEEPALIVE const char* web_fsk() { return receiver->dem->m_fskcall; }
EMSCRIPTEN_KEEPALIVE int* web_spectrum() { return receiver->fft.m_fft; }
EMSCRIPTEN_KEEPALIVE void web_finish() { receiver->finish(); }
EMSCRIPTEN_KEEPALIVE void web_redraw(double ppm, double phase) { receiver->redraw(ppm, phase); }
EMSCRIPTEN_KEEPALIVE void web_option(int option, double value) {
    auto& r = *receiver;
    switch(option) {
    case 0: r.dem->m_afc = value != 0; break;
    case 1: r.useLms = value != 0; break;
    case 2: r.dem->SetBPF(std::clamp(int(value),0,3)); break;
    case 3: r.dem->m_Type = std::clamp(int(value),0,2); break;
    case 4: r.dem->m_SenseLvl = std::clamp(int(value),0,3); r.dem->SetSenseLvl(); break;
    case 5: sys.m_AutoStop = value != 0; break;
    case 6: sys.m_AutoSync = value != 0; break;
    case 7: r.slant.Checked = value != 0; break;
    case 8: r.locked = value != 0; r.dem->m_MSync = r.locked ? 0 : 1; r.dem->m_SyncRestart = r.locked ? 0 : 1; break;
    case 9: sys.m_Differentiator = value != 0; break;
    case 10: sys.m_FFTGain = std::clamp(int(value),0,3); break;
    case 11: r.dem->m_fskdecode = value != 0; break;
    }
}
}

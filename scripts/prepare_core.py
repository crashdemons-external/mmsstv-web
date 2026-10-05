"""Prepare portable copies. The checked-in MMSSTV source is never modified."""
from pathlib import Path
import re
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'mmsstv-src'
OUT = ROOT / 'build/generated'

def read(name):
    return (SRC / name).read_bytes().decode('cp932').replace('\r\n', '\n')

def function(text, signature):
    start = text.index(signature)
    opening = text.index('{', start)
    depth = 1
    end = opening + 1
    while depth:
        if text[end] == '{': depth += 1
        elif text[end] == '}': depth -= 1
        end += 1
    return text[start:end]

def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    for name in ['sstv.cpp', 'sstv.h', 'fir.cpp', 'fir.h', 'Fft.cpp', 'Fft.h']:
        text = read(name)
        text = text.replace('#include <vcl.h>', '#include "web_compat.h"')
        text = text.replace('#include <inifiles.hpp>', '#include "web_compat.h"')
        text = text.replace('#include "ComLib.h"', '#include "web_compat.h"')
        text = text.replace('"Fir.h"', '"fir.h"').replace('"fft.h"', '"Fft.h"')
        # No serialized DSP structs cross the JS boundary. Use natural alignment
        # instead of Borland's 4-byte packing for double arrays.
        text = re.sub(r'^#pragma pack\(.*?\)\s*$', '', text, flags=re.M)
        for variable in ['Z', 'D', 'm_MSyncList']:
            text = text.replace('memcpy(' + variable + ', &' + variable + '[1]', 'memmove(' + variable + ', &' + variable + '[1]')
        if name == 'fir.cpp':
            for signature in ['void DrawGraph(', 'void DrawGraphIIR(']:
                while signature in text:
                    text = text.replace(function(text, signature), '')
            # Use the standard library's asinh, avoiding Borland's local replacement.
            text = text.replace(function(text, 'double asinh('), '')
            text = text.replace('memcpy(zp, &zp[1]', 'memmove(zp, &zp[1]')
        if name == 'sstv.cpp':
            # Retain SSTV audio modulation for offline WAV export; omit CW.
            text = text.replace(function(text, 'void CSSTVMOD::WriteCWID('), '')
            text = text.replace('m_TXBuf = NULL;\n\n\tm_bpf',
                                'm_TXBuf = NULL;\n\tm_TXBufLen = 0;\n\tm_VariR = 298; m_VariG = 588; m_VariB = 110;\n\n\tm_bpf')
        if name == 'fir.h':
            text = re.sub(r'^void DrawGraph.*?;\s*$', '', text, flags=re.M)
        # Correct original array deallocations for standard C++ (Borland tolerated them).
        arrays = ['ptbl[0]', 'ptbl[1]', 'pSinTbl', 'pScopeData', 'bp', 'op',
                  'm_B12', 'm_Buf', 'm_StgB12', 'm_StgBuf', 'Z', 'D', 'H', 'A', 'B',
                  'm_pZ', 'm_pH', 'm_tSinCos', 'm_tWindow', 'pStgBuf', 'm_Work', 'm_TXBuf']
        for variable in arrays:
            text = text.replace('delete ' + variable + ';', 'delete[] ' + variable + ';')
        text = text.replace('memcpy(m_AutoStopAPos, &m_AutoStopAPos[1]', 'memmove(m_AutoStopAPos, &m_AutoStopAPos[1]')
        (OUT / name).write_text(text, encoding='utf-8')
    main = read('Main.cpp')
    names = ['SyncSSTV', 'InitAutoStop', 'GetSqerrPos', 'AutoStopJob', 'GetPixelLevel',
             'GetPictureLevel', 'GetPictureLevelDiff', 'DrawSSTVNormal', 'DrawSSTVDiff']
    chunks = []
    for name in names:
        match = re.search(r'(?:void|int) __fastcall TMmsstv::' + name + r'\(', main)
        chunks.append(function(main, match.group(0)).replace('TMmsstv::', 'WebReceiver::'))
    drawing = read('ComLib.cpp')
    for name in ['Limit256', 'LimitRGB', 'YCtoRGB']:
        match = re.search(r'(?:void|int) __fastcall ' + name + r'\(', drawing)
        chunks.append(function(drawing, match.group(0)))
    text = '\n\n'.join(chunks).replace('delete bp;', 'delete[] bp;')
    text = text.replace('memcpy(m_AutoStopAPos, &m_AutoStopAPos[1]', 'memmove(m_AutoStopAPos, &m_AutoStopAPos[1]')
    (OUT / 'receive_image.inc').write_text('// Extracted from MMSSTV Main.cpp and ComLib.cpp. LGPL-3.0-or-later.\n' + text, encoding='utf-8')
    # Keep the original image scan functions and the exact VIS/extended/narrow
    # headers. Device/PTT/GUI scheduling in ToTX/SendSSTV is replaced by a file
    # sample pump, with no sound output or hardware linked.
    tx_names = ['LineR24','LineR36','LineR72','LineAVT','LineSCT','LineMRT',
                'LineSC2180','LinePD','LineP','LineMP','LineMR','LineRM','LineMN','LineMC']
    tx = [function(main, 'void __fastcall TMmsstv::' + name + '(').replace('TMmsstv::','WebEncoder::') for name in tx_names]
    for name, signature in [('ColorToFreq','int __fastcall ColorToFreq('),
                            ('ColorToFreqNarrow','int __fastcall ColorToFreqNarrow('),
                            ('GetRY','void __fastcall GetRY(')]:
        tx.insert(0, function(drawing, signature))
    start_tx = function(main, 'void __fastcall TMmsstv::ToTX(')
    header = start_tx[start_tx.index('// VIS'):start_tx.index('mp->m_sCnt =')]
    tx.append('void WebEncoder::writeHeader() { CSSTVMOD *mp = mod.get();\n' + header + '}')
    send = function(main, 'void __fastcall TMmsstv::SendSSTV(')
    selector = function(send, 'switch(SSTVSET.m_TxMode)')
    tx.append('void WebEncoder::writeLine() { CSSTVMOD *mp = mod.get();\n' + selector + '\nmp->m_wLine++;\n}')
    (OUT / 'encode_image.inc').write_text('// Extracted from MMSSTV Main.cpp and ComLib.cpp. LGPL-3.0-or-later.\n' + '\n\n'.join(tx), encoding='utf-8')
    manifest = {name: hashlib.sha256((SRC / name).read_bytes()).hexdigest()
                for name in ['sstv.cpp', 'sstv.h', 'fir.cpp', 'fir.h', 'Fft.cpp', 'Fft.h', 'Main.cpp', 'ComLib.cpp']}
    (OUT / 'source-hashes.json').write_text(json.dumps(manifest, indent=2) + '\n')

if __name__ == '__main__': prepare()

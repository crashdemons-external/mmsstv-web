"""Compile QSSTV's DSP using an existing official Emscripten installation."""
from pathlib import Path
import os, sys, subprocess, json, shutil
from prepare_qsstv import prepare, RX, ROOT

def build(command, env, debug=False):
    dst=prepare()
    includes=[ROOT/'native/qsstv',dst,dst/'utils',dst/'drmrx',dst/'drmtx/common']
    files=[ROOT/'native/qsstv/modem.cpp',dst/'utils/rs.cpp']
    files += [p for p in (dst/'drmtx/common').rglob('*.cpp') if p.name!='csoundout.cpp']
    files += [dst/'drmrx'/(name+'.cpp') for name in RX]
    names=['rx_reset','rx_process','rx_status','rx_snr','rx_offset','rx_call','rx_name','rx_file','rx_size','rx_bsr','rx_constellation','rx_constellation_count','tx_start','tx_read','tx_progress','tx_cancel','tx_fix','rs_encode','rs_file','rs_size']
    flags=['-std=c++17','-DHAVE_STDINT_H=1','-Wno-narrowing','-Wno-constant-conversion','-Wno-unused-value']
    flags += ['-I'+str(p) for p in includes]
    flags += ['-O1','-g3','-sASSERTIONS=2','-sSAFE_HEAP=1'] if debug else ['-O3']
    flags += ['-sMODULARIZE=1','-sEXPORT_NAME=createQSSTV','-sENVIRONMENT=web,worker,node','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=67108864','-sSTACK_SIZE=4194304','-sFILESYSTEM=0','-sEXPORTED_FUNCTIONS='+json.dumps(['_drm_'+n for n in names]+['_malloc','_free']),'-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPF32","HEAPU8","HEAP16"]']
    subprocess.run(command+flags+[str(p) for p in files]+['-o',str(ROOT/'web/qsstv-core.js')],env=env,check=True,cwd=ROOT)

if __name__=='__main__':
    # Reuse the project's inspected toolchain configuration, without installing anything.
    env=os.environ.copy(); env['EM_CONFIG']=str(ROOT/'build/emscripten-config.py')
    compiler=Path(sys.argv[1])/'upstream/emscripten/em++.py'
    build([sys.executable,str(compiler)],env,'--debug' in sys.argv)

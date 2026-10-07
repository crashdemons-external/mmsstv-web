"""Compile the selected fldigi WEFAX DSP with the project's existing SDK."""
from pathlib import Path
import json, subprocess, os, sys
from prepare_wefax import prepare, ROOT

def build(command, env, debug=False):
    dst=prepare()
    files=[ROOT/'native/wefax/core.cpp',ROOT/'native/wefax/web_modem.cpp']
    files += [dst/name for name in ['wefax.cxx','filters.cxx','fftfilt.cxx','strutil.cxx','mode_table.cpp']]
    names='reset process option finish state detected width height line serial revision completed pixels finished_pixels finished_width finished_height finished_mode finished_serial level frequency spectrum encode_start encode_read encode_done encode_progress encode_cancel'.split()
    flags=['-std=c++17','-I'+str(ROOT/'native/wefax'),'-I'+str(dst/'include'),'-Wno-unused-value']
    flags += ['-O1','-g3','-sASSERTIONS=2','-sSAFE_HEAP=1'] if debug else ['-O3']
    flags += ['-sMODULARIZE=1','-sEXPORT_NAME=createWEFAX','-sENVIRONMENT=web,worker,node','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=33554432','-sSTACK_SIZE=2097152','-sFILESYSTEM=0','-sEXPORTED_FUNCTIONS='+json.dumps(['_fax_'+n for n in names]+['_malloc','_free']),'-sEXPORTED_RUNTIME_METHODS=["HEAPF32","HEAPU8","HEAP32"]']
    subprocess.run(command+flags+[str(p) for p in files]+['-o',str(ROOT/'web/wefax-core.js')],env=env,check=True,cwd=ROOT)
    (ROOT/'web/licenses/Fldigi-COPYING.txt').write_bytes((ROOT/'third_party/fldigi/COPYING').read_bytes())

if __name__=='__main__':
    env=os.environ.copy();env['EM_CONFIG']=str(ROOT/'build/emscripten-config.py')
    build([sys.executable,str(Path(sys.argv[1])/'upstream/emscripten/em++.py')],env,'--debug' in sys.argv)

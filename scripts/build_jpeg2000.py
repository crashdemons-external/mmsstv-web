"""Build the official OpenJPEG library directly, without package hooks or CMake."""
from pathlib import Path
import json,subprocess,shutil
ROOT=Path(__file__).resolve().parents[1]
def build(command,env,debug=False):
 src=ROOT/'third_party/openjpeg/src/lib/openjp2';cfg=ROOT/'build/openjpeg';cfg.mkdir(parents=True,exist_ok=True)
 (cfg/'opj_config.h').write_text('#define OPJ_VERSION_MAJOR 2\n#define OPJ_VERSION_MINOR 5\n#define OPJ_VERSION_BUILD 4\n')
 (cfg/'opj_config_private.h').write_text('#define OPJ_PACKAGE_VERSION "2.5.4"\n#define OPJ_HAVE_STDINT_H 1\n#define OPJ_HAVE_INTTYPES_H 1\n#define OPJ_HAVE_FSEEKO 1\n#define OPJ_HAVE_POSIX_MEMALIGN 1\n')
 names='thread bio cio dwt event ht_dec image invert j2k jp2 mct mqc openjpeg opj_clock pi t1 t2 tcd tgt function_list opj_malloc sparse_array'.split()
 flags=['-x','c','-std=c11','-DOPJ_STATIC','-D_POSIX_C_SOURCE=200112L','-I'+str(src),'-I'+str(cfg),'-sMODULARIZE=1','-sEXPORT_NAME=createJPEG2000','-sENVIRONMENT=web,worker,node','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=33554432','-sSTACK_SIZE=2097152','-sFILESYSTEM=0','-sEXPORTED_FUNCTIONS='+json.dumps(['_jp2_'+n for n in ['decode','width','height','pixels','encode','file']]+['_malloc','_free']),'-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]']
 flags+=['-O1','-g3','-sASSERTIONS=2','-sSAFE_HEAP=1'] if debug else ['-O3']
 subprocess.run(command+flags+[str(ROOT/'native/jpeg2000.c')]+[str(src/(n+'.c')) for n in names]+['-o',str(ROOT/'web/jpeg2000-core.js')],env=env,check=True,cwd=ROOT)
 shutil.copyfile(ROOT/'third_party/openjpeg/LICENSE',ROOT/'web/licenses/OpenJPEG.txt')

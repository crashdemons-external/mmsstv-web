"""Build original MMSSTV receive/encode DSP with the official Emscripten SDK."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from prepare_core import prepare
from version_assets import version_assets
from prepare_assets import prepare as prepare_assets
from build_qsstv import build as build_qsstv
from build_jpeg2000 import build as build_jpeg2000
from build_wefax import build as build_wefax

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--emsdk', type=Path, help='Path to an existing official emsdk installation')
    parser.add_argument('--debug', action='store_true')
    args = parser.parse_args()
    prepare()
    prepare_assets()
    env = os.environ.copy()
    executable = shutil.which('em++') or shutil.which('em++.bat')
    sdk = args.emsdk or Path(env.get('EMSDK', str(ROOT / '.tools/emsdk')))
    if args.emsdk or not executable:
        upstream = sdk.resolve() / 'upstream'
        compiler = upstream / 'emscripten/em++.py'
        compiler_root = compiler.parent
        if not compiler.exists(): raise SystemExit('Activate Emscripten or specify --emsdk PATH. No packages are installed by this build.')
        node = shutil.which('node')
        if not node: raise SystemExit('Emscripten requires Node.js.')
        config = ROOT / 'build/emscripten-config.py'
        config.write_text(f'LLVM_ROOT = {str(upstream / "bin")!r}\nBINARYEN_ROOT = {str(upstream)!r}\nNODE_JS = [{node!r}]\nCACHE = {str(ROOT / "build/emcache")!r}\n')
        env['EM_CONFIG'] = str(config)
        command = [sys.executable, str(compiler)]
    else:
        command = [executable]
        compiler_root = Path(executable).resolve().parent
    names = ['init', 'reset', 'process', 'mode_count', 'mode_name', 'mode', 'width', 'height',
             'pixels', 'sync_pixels', 'revision', 'serial', 'completed', 'receiving', 'line',
             'level', 'afc', 'fsk', 'spectrum', 'option', 'redraw', 'finish', 'mode_width', 'mode_height',
             'completed_pixels', 'completed_width', 'completed_height', 'completed_mode', 'completed_serial', 'completed_line', 'completed_fraction',
             'mode_tx_height','encode_start','encode_read','encode_progress','encode_cancel']
    exports = ['_web_' + name for name in names] + ['_malloc', '_free']
    flags = ['-std=c++17', '-I' + str(ROOT / 'native'), '-I' + str(ROOT / 'build/generated'),
             '-Wno-unknown-pragmas', '-Wno-unused-value', '-Wno-parentheses', '-Wno-delete-non-abstract-non-virtual-dtor']
    flags += ['-O1', '-g3', '-sASSERTIONS=2', '-sSAFE_HEAP=1'] if args.debug else ['-O3']
    files = [ROOT / 'native/receiver.cpp', ROOT / 'native/encoder.cpp'] + [ROOT / 'build/generated' / name for name in ['sstv.cpp', 'fir.cpp', 'Fft.cpp']]
    # Emit JavaScript loader and WebAssembly as separate files in web/.
    flags += ['-sMODULARIZE=1', '-sEXPORT_NAME=createMMSSTV',
              '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432',
              '-sSTACK_SIZE=2097152', '-sFILESYSTEM=0', '-sEXPORTED_FUNCTIONS=' + json.dumps(exports),
              '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPF32","HEAPU8","HEAP32"]']
    subprocess.run(command + flags + [str(p) for p in files] + ['-o', str(ROOT / 'web/mmsstv-core.js')], env=env, check=True, cwd=ROOT)
    build_qsstv(command,env,args.debug)
    build_jpeg2000(command,env,args.debug)
    build_wefax(command,env,args.debug)
    for name in ['mmsstv-core.js','qsstv-core.js','jpeg2000-core.js','wefax-core.js']:
        path=ROOT/'web'/name
        path.write_text(path.read_text(encoding='utf-8').rstrip()+'\n',encoding='utf-8')
    version = subprocess.check_output(command + ['--version'], env=env, text=True).splitlines()[0]
    info = {'upstream': 'MMSSTV 1.13A + QSSTV AVT24/94 and FAX480 + fldigi 4.2.13 WEFAX', 'compiler': version, 'modeCount': 46, 'imageModeCount': 48,
            'sources': json.loads((ROOT / 'build/generated/source-hashes.json').read_text()),
            'coreSha256': hashlib.sha256((ROOT / 'web/mmsstv-core.js').read_bytes()).hexdigest(),
            'wasmSha256': hashlib.sha256((ROOT / 'web/mmsstv-core.wasm').read_bytes()).hexdigest()}
    info['qsstv']={'version':'9.5.11','commit':json.loads((ROOT/'docs/qsstv-upstream.json').read_text())['commit'],
                   'coreSha256':hashlib.sha256((ROOT/'web/qsstv-core.js').read_bytes()).hexdigest(),
                   'wasmSha256':hashlib.sha256((ROOT/'web/qsstv-core.wasm').read_bytes()).hexdigest()}
    info['openjpeg']={'version':'2.5.4','coreSha256':hashlib.sha256((ROOT/'web/jpeg2000-core.js').read_bytes()).hexdigest(),'wasmSha256':hashlib.sha256((ROOT/'web/jpeg2000-core.wasm').read_bytes()).hexdigest()}
    info['assetVersion']=version_assets()
    info['wefax']={'version':'fldigi 4.2.13','modes':['IOC576','IOC288'],
                   'sources':json.loads((ROOT/'docs/fldigi-wefax-upstream.json').read_text()),
                   'coreSha256':hashlib.sha256((ROOT/'web/wefax-core.js').read_bytes()).hexdigest(),
                   'wasmSha256':hashlib.sha256((ROOT/'web/wefax-core.wasm').read_bytes()).hexdigest()}
    (ROOT / 'web/build-info.json').write_text(json.dumps(info, indent=2) + '\n')
    licenses = ROOT / 'web/licenses'
    licenses.mkdir(exist_ok=True)
    for source, name in [('LICENSE','Emscripten.txt'),('system/lib/libc/musl/COPYRIGHT','musl.txt'),
                         ('system/lib/libcxx/LICENSE.TXT','libcxx.txt'),('system/lib/libcxxabi/LICENSE.TXT','libcxxabi.txt'),
                         ('system/lib/compiler-rt/LICENSE.TXT','compiler-rt.txt')]:
        if (compiler_root / source).exists():
            shutil.copyfile(compiler_root / source, licenses / name)
    print('Built web/mmsstv-core.js and web/mmsstv-core.wasm.')

if __name__ == '__main__': main()

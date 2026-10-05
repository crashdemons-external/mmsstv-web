# Third-party notices

MMSSTV 1.13A source code and original icon/toolbar artwork:
Copyright 2000–2013 Makoto Mori (JE3HHT) and Nobuyuki Oba (JA7UDE).
GNU Lesser General Public License, version 3 or later.
The checked-in original source is in `mmsstv-src/`.

The browser receiver reuses the original demodulator, FIR/IIR/LMS filters,
Hilbert demodulator, FFT, mode tables, synchronization, received-image drawing,
and original image-to-audio encoder/modulator.
Portable copies are generated during the build. The browser's About dialog
links to the [source repository](https://github.com/crashdemons-external/mmsstv-web),
which contains the original source and the port/build files.

See `COPYING.LESSER.txt` and `COPYING.txt` for license terms.

Emscripten and LLVM are official build tools; their generated runtime glue is
distributed with the compiled receiver under their applicable permissive
licenses. No third-party JavaScript UI or audio packages are used.

The corresponding Emscripten, musl, LLVM compiler-rt, libc++ and libc++abi
copyright/license texts are provided in `web/licenses/` (the built app's
`licenses/` directory). Their unmodified upstream sources are available from
the official [Emscripten project](https://github.com/emscripten-core/emscripten)
and [LLVM project](https://github.com/llvm/llvm-project).

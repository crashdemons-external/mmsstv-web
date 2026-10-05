# MMSSTV web

A browser port of **MMSSTV 1.13A** for receiving SSTV and generating SSTV audio
files. The original MMSSTV C++ demodulator, encoder, filters, FFT,
synchronization and RGB/YUV image drawing run in
WebAssembly. The HTML/CSS interface follows the supplied desktop screenshots,
VCL forms and original toolbar artwork.

## Run

The built application is **`web/index.html`**. Serve the `web/` directory
over HTTP(S) so the browser can load the separate WebAssembly file:

```powershell
python scripts/serve.py
```

Open <http://localhost:8080>. Microphone input uses browser permissions and
requires a secure context such as localhost or HTTPS. See the
[browser microphone documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
No server processes audio. There are no remote scripts, fonts, telemetry or
runtime package dependencies.

## Features

- Microphone / sound-card input, without speaker monitoring.
- Audio uploads and drag-and-drop: MMSSTV MMV and PCM/float WAV directly; MP3, FLAC, Ogg and
  other formats when supported by the browser's Web Audio decoder.
- Original 43 mode definitions, automatic VIS / sync detection, manual mode
  start, AFC, LMS, selectable BPF and demodulator, and optional received FSK ID.
- Progressive RX picture, original FFT spectrum, waterfall and Sync display.
- Phase/slant redraw from retained demodulated signal; automatic sync/stop/slant.
- History and stock pictures stored locally using IndexedDB. Session history
  still works if browser storage is unavailable.
- Full-resolution PNG, JPEG and BMP downloads; history JSON; local receive log
  with ADIF, CSV and JSON exports; receiver profiles.
- Overlay dialogs with neutral slate title bars and rounded window frames;
  controls retain the original layout and artwork.
- TX picture preparation and offline WAV export using the original 43-mode
  encoder, with resize/crop options and an optional FSK callsign.

Live radio TX, PTT/CAT, radio commands, repeaters, external logging programs, printing and
transmit template editing are grayed out. These Windows features have no
browser implementation. The TX tab generates files without speaker playback.
The fixed desktop layout preserves the original window
geometry; small screens can scroll horizontally.

## Generate SSTV audio from an image

1. Select **TX**, then **Open…** to load a picture. You can also click a stock
   picture on the TX tab or use Edit → Copy picture to TX from RX/History.
2. Choose a TX mode, then **Generate WAV…**. Select stretching, fitting with
   borders or cropping, and optionally include your callsign as an FSK ID.
3. Press **Generate**, then **Save WAV**. The file is 11025 Hz, mono, 16-bit PCM.
   **Decode WAV** feeds the generated file into the browser receiver for inspection.

## Build

Python 3, Node.js and the official
[Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) are
the only build requirements. The build never installs packages or runs package
installation hooks.

```powershell
python scripts/build.py
# Or use an existing SDK explicitly:
python scripts/build.py --emsdk D:\path\to\emsdk
# Assertions and checked WASM heap access:
python scripts/build.py --debug --emsdk D:\path\to\emsdk
```

The compiler emits `web/mmsstv-core.js` (JavaScript loader) and
`web/mmsstv-core.wasm` (WebAssembly binary). Deploy both beside `index.html`;
configure the server to serve `.wasm` as `application/wasm`. The supplied
preview server handles this automatically. Decoding and encoding use workers
when available, with a main-thread fallback. Direct `file://` opening is no
longer supported because browsers restrict loading the separate binary.

`scripts/prepare_core.py` creates portable copies under `build/generated/`.
**`mmsstv-src/` is unchanged.** See [docs/porting.md](docs/porting.md) for the
platform boundary and compatibility changes. `scripts/prepare_assets.py`
converts original bitmaps using Python's standard library. License notices
are included in `web/`. The About dialog links to the
[source repository](https://github.com/crashdemons-external/mmsstv-web)
for source and build instructions. The build does not create a source ZIP.

## Validation

```powershell
npm test
# Optional browser fixture (generated locally, ignored by Git):
node tests/signal.cjs
# Optional: validate color-bar files saved from the browser as out/export-test.*
node tests/exports.test.cjs
```

Tests initialize all 43 original modes, reject silence, recover complete
Martin 2 / Scottie 1 / Robot 36 / PD120 images, check color and resolution,
redraw phase and decode FSK ID. Audio tests cover sample-rate conversion,
anti-aliasing, stereo channel selection, MMV, malformed recordings and BMP export.
Encoder tests produce audio in all 43 modes and perform complete original
encoder → WAV → original decoder color-image round trips in the same four modes,
including an FSK callsign. Both release and checked-heap builds run these tests.

The browser workflow has been exercised with a 48 kHz generated WAV, pause,
seek, resume, FSK ID, persistent history and modal settings. The preview
browser does not report generated-data downloads; generated-file download
behavior still needs a normal-browser check. PNG/JPEG/BMP export contents are checked directly.
Worklet tests check left/right/mixed channel routing and silent speaker output.
Actual microphone audio quality and the remaining modes
still need testing with real off-air recordings; compiling a mode does not
establish reception performance under noise and clock drift.

TX image upload, generation of a Martin 2 WAV with FSK callsign, and decoding
that generated WAV back into the expected color image have been exercised in
the browser without console errors.

## License

MMSSTV copyright 2000–2013 Makoto Mori and Nobuyuki Oba. Distributed under
GNU LGPL version 3 or later. See `COPYING.LESSER.txt`, `COPYING.txt` and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

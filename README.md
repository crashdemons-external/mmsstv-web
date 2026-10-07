# MMSSTV / QSSTV web

A browser application with switchable **MMSSTV 1.13A** and **QSSTV 9.5.11**
interfaces. The original MMSSTV analog DSP and QSSTV HAMDRM modem run locally
in WebAssembly. Receive microphone/audio files, prepare images and templates,
generate audio files, and save received images or binary files. No radio
hardware, CAT or PTT control is used.

Live demo: <https://crashdemons-external.github.io/mmsstv-web/>

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
- 46 analog modes: the original 43 plus AVT24, AVT94 and FAX480; automatic VIS / sync detection, manual mode
  start, AFC, LMS, selectable BPF and demodulator, and optional received FSK ID.
- WEFAX IOC576/IOC288 reception and grayscale WAV generation through fldigi,
  with four line speeds, APT/phasing and manual reception of partial recordings.
  Selectable from the existing RX/TX mode lists in both interfaces.
- Progressive RX picture, original FFT spectrum, waterfall and Sync display.
- Phase/slant redraw from retained demodulated signal; automatic sync/stop/slant.
- History and stock pictures stored locally using IndexedDB. Session history
  still works if browser storage is unavailable.
- Full-resolution PNG, JPEG and BMP downloads; history JSON; local receive log
  with ADIF, CSV and JSON exports; receiver profiles.
- Overlay dialogs with neutral slate title bars and rounded window frames;
  controls retain the original layout and artwork.
- TX picture preparation and offline WAV export in all 46 analog modes,
  with resize/crop, rotation/mirroring, color adjustment, templates, and FSK ID.
- QSSTV HAMDRM reception and generation: A/B/E, 4/16/64-QAM, 2.2/2.5 kHz,
  high/normal protection and long/short interleaving; all 72 combinations.
- Exact binary-file transfer, RS1–RS4 protection/recovery, BSR files/audio and
  FIX retransmission that retains incomplete received transfers.
- JPEG 2000 import, compression and received-image display through official
  OpenJPEG 2.5.4, with separate JavaScript/WASM files and an image worker.
- Shared galleries, digital-file storage, operator/settings profiles and logs;
  caption links switch interfaces without restarting active audio or decoding.
- Text templates with callsign/QSO substitutions and JSON save/import,
  camera snapshots, microphone WAV recording, tones/sweep, CW identification,
  waterfall text, optional VOX/CW WAV identification, printing and log search.

Hardware control, PTT and live radio/speaker output are disabled. Native FTP
and QSSTV's FTP-based hybrid server/“Who is on” features are grayed out because
browsers do not expose FTP sockets. DRM and offline digital transmission work.
FAX480 has no VIS and requires selecting it manually before opening a recording;
WEFAX also requires selecting its IOC mode before opening audio; use WEFAX settings
for recordings without an APT/phasing preamble. Phase/slant redraw applies to the
original analog modes. Original desktop
configuration/history/template binary formats are not imported; browser JSON
backups/templates are supported. See [the capability notes](docs/qsstv-port.md).

## Generate SSTV audio from an image

1. Select **TX**, then **Open…** to load a picture. You can also click a stock
   picture on the TX tab or use Edit → Copy picture to TX from RX/History.
2. Choose a TX mode, then **Generate WAV…**. Select stretching, fitting with
   borders or cropping, and optionally include your callsign as an FSK ID.
3. Press **Generate**, then **Save WAV**. The file is 11025 Hz, mono, 16-bit PCM.
   **Decode WAV** feeds the generated file into the browser receiver for inspection.

## Switch interfaces and use DRM

Use **Switch to QSSTV** / **Switch to MMSSTV** in the caption bar. RX/TX pictures,
current mode/protocol, templates, galleries, settings, log and active audio are
shared. Choose **DRM** in either layout to display digital receive status.

For digital generation, open a TX picture or **Open DRM file…**, choose the
modem/RS settings, then **Generate DRM WAV…**. Pictures can use PNG, JPEG or
JPEG 2000; the compression ratio controls JPEG 2000 size (1 is lossless).
**Decode WAV** tests the result locally. Received digital files can be downloaded
from **Received files…**. Use **BSR** to export missing segments and **FIX** to
repair an incomplete transfer; the last generated original payload is retained
for exact retransmission. A BSR from another receiver also supplies its transport
ID; received BSR files can open FIX directly. Use the same original file, modem
settings and RS choice for repair. BSR generation preserves that original payload.

Images/stock and received digital files live in the site's IndexedDB database.
Settings, profiles, logs and templates use `mmsstv.*` localStorage keys. Both
interfaces use these same records. Current TX source, active audio, incomplete
MOT assemblies and the last generated payload remain in memory until reload.
Clearing site data removes saved data. Use JSON history/log/template exports for
backups; binary files and WAVs use normal browser downloads.

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
`web/mmsstv-core.wasm` (WebAssembly binary), plus corresponding
`qsstv-core`, `jpeg2000-core` and `wefax-core` loader/binary pairs. Deploy all of `web/`;
configure the server to serve `.wasm` as `application/wasm`. The supplied
preview server handles this automatically. Decoding and encoding use workers
for DSP and JPEG 2000. MMSSTV also supports a main-thread fallback. Direct `file://` opening is no
longer supported because browsers restrict loading the separate binary.

`scripts/prepare_core.py` creates portable copies under `build/generated/`.
**`mmsstv-src/`, `qsstv-src/`, `third_party/openjpeg/` and `third_party/fldigi/` remain unchanged.**
QSSTV, OpenJPEG and fldigi source provenance and file hashes are recorded in `docs/`. See [docs/porting.md](docs/porting.md) for the
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

Tests initialize all 46 analog modes; verify complete color-image round trips
for Martin 2, Scottie 1, Robot 36, PD120, AVT90, AVT24 and AVT94; and verify
FAX480 grayscale reception. The digital suite recovers exact bytes and callsigns
in all 72 profiles, exercises RS1–RS4, missing-segment recovery, BSR and FIX,
retained transfers, and input bounds. WEFAX tests cover both IOC widths at all four line speeds, decoded grayscale,
manual reception, growing images, cancellation and switching to/from SSTV.
See [the WEFAX port notes](docs/wefax-port.md). Image tests cover JPEG 2000 lossless/lossy
round trips and malformed files. Audio tests cover resampling, channel routing,
MMV/WAV, BMP, tones and Morse timing/silence.

The browser workflow exercises shared history/TX images, JPEG 2000 DRM+RS audio
generation/reception, and switching interfaces during paused/active reception.
Native DSP round trips do not establish performance on every noisy recording or
browser/device. Microphone/camera permission and real-device capture need testing
on the user's equipment. The preview browser does not report generated-data
download events; normal-browser download/print dialogs need a browser check.

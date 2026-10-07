# QSSTV interface and shared browser core

The original source was copied before implementation to `qsstv-src/` from
[ON4QZ/QSSTV](https://github.com/ON4QZ/QSSTV), revision
`8c27d6d169d8c6c197eb47c2089870e39bc06a02`. Its declared version is 9.5.11.
`qsstv-upstream.json` records the archive and every original file's SHA-256.
Build changes occur only in `build/qsstv/`, never in the original tree.

## Coverage

| Capability | MMSSTV layout | QSSTV layout |
| --- | --- | --- |
| 43 original MMSSTV analog RX/TX modes | Shared core | Shared core |
| AVT24, AVT94, FAX480 | Added | Added |
| HAMDRM A/B/E, 4/16/64-QAM, 2.2/2.5 kHz, high/normal protection, long/short interleave | Protocol buttons and file dialogs | Native-style RX/TX controls |
| RS1–RS4 encoding and missing-segment recovery | Shared | Shared |
| Binary MOT transfer, decoded-file downloads, BSR/FIX | File menu | DRM controls/file dialogs |
| JPEG 2000 input, compression and display | Shared | Shared |
| Microphone, stereo selection, input WAV recording, audio upload/pause/seek | Shared | Shared |
| RX history, TX stock pictures, templates, settings and QSO log | Shared storage | Gallery and shared storage |
| TX text templates, substitutions, JSON import/export | Template tab/library | Template editor/gallery |
| Resize/crop, rotate/mirror, brightness/contrast/saturation | TX editor | TX editor |
| Camera snapshot | Shared action | Camera toolbar |
| CW, tone/sweep and waterfall-text WAV, VOX/CW WAV identification | Option/shared dialogs | TX toolbar/bottom controls |
| Image PNG/JPEG/BMP download, clipboard, print, log search/exports | Shared | Shared actions |
| Rig/CAT/PTT/serial control, live radio/speaker output | Disabled | Disabled |
| Native FTP, FTP-based hybrid and “Who is on” directory | Disabled | Disabled |

FAX480 has no VIS. Select it manually before loading a complete FAX480
recording. It uses QSSTV's 512×500 grayscale timing and 5.002-second preamble,
with the original MMSSTV Hilbert FM demodulator and a small sync/line boundary.
Its sync display and phase/slant redraw are not implemented; those controls
are disabled. The 43 original modes retain the original receive/draw paths.
AVT24/94 extend those AVT paths using the original QSSTV timing parameters.
The AVT90 sync word is corrected to `0xbf40`; the decoder still accepts legacy
MMSSTV `0x5fa0` recordings. See the
[original MMSSTV AVT report](https://github.com/n5ac/mmsstv/issues/3).

DRM is real encoding/decoding, not a visual simulation. Original QSSTV
channel estimation, synchronization, FAC/MSC mapping, Viterbi decoding and
Dream OFDM/MLC modulation are compiled into `qsstv-core.wasm`. Constellation
plots use actual FAC/MSC cells; offset display uses QSSTV's 350 Hz correction.
The adapter replaces Qt buffers/logging and device sound output with bounded
memory and PCM/file bytes. A small in-tree mixed-radix FFT implements the
required FFTW-compatible calls; FFTW itself is not linked.

MOT packet CRC/continuity checks and bounded header/segment assembly follow
QSSTV's sourcedecoder. Original Phil Karn Reed–Solomon code and QSSTV's
file packing/transposition are retained. An incomplete transport survives
receiver resync/audio-file changes so a later FIX recording can fill gaps.
BSR uses the QSSTV `H_OK`/segment-list format. Newly generated transfers get
distinct MOT IDs; FIX preserves the original requested ID and encoded source.
Received BSR files can open FIX directly. BSR WAVs use QSSTV's reserved
rotating IDs without RS wrapping; repeated headers do not duplicate files,
and generating a BSR preserves the original payload needed for repair.

Generated portable copies correct four upstream issues: the unallocated
format string passed to `std::transform`, the uninitialized FIX counter,
padded packet payloads exceeding the eight-bit PPI length, and unaligned
integer comparisons over byte buffers in the iterative decoder. The FIX selector
also rejects indices beyond the file's segment count. The transmitter's
sound-output allocation is released by its portable destructor.

JPEG 2000 uses the official
[OpenJPEG 2.5.4 library](https://github.com/uclouvain/openjpeg/tree/v2.5.4).
Unmodified library sources/license are in `third_party/openjpeg/`, with
provenance/hashes in `openjpeg-upstream.json`. The build invokes Emscripten
directly; it does not run upstream CMake/install scripts. The adapter accepts
bounded grayscale/RGB/YCC images and performs lossless/lossy RGB encoding.
CMYK, unusual origins and ICC color management are not implemented; the
original received file remains downloadable if image display is unsupported.

## Interface and state

`interfaces.js` presents QSSTV's Receive/Transmit/Gallery organization,
SSTV/DRM controls, meters, spectrum/waterfall, and overlay configuration
windows using the supplied screenshots. It uses the same slate caption,
rounded borders and teal accent as MMSSTV-web. Source MMSSTV glyphs are
preferred; matching QSSTV source glyphs supply additional controls. No new
icon package, font CDN or JavaScript framework is used.

Both layouts bind to one application session in `app.js`/`features.js`.
Switching changes visibility and active view; it does not recreate a decoder,
stop microphone capture, reset an audio file, or discard an image/template.
Settings/profiles/logs/templates use the same `mmsstv.*` localStorage keys;
image history/stock and received digital files use the existing `mmsstv-web`
IndexedDB `images` store. Local-storage/IndexedDB failures retain session
functionality. Digital files are retained up to the configured history limit.
TX source, active audio, incomplete MOT transfers and the last generated
original digital payload live in memory and are lost on reload.

`features.js` supplies template substitutions, binary/BSR/FIX dialogs,
configuration, recording, CW/tones, history import, and print/search actions.
`editor.js` applies basic picture transforms without changing the source until
Apply. Browser templates are text overlays with styling/position controls;
native MMSSTV/QSSTV template/configuration binary formats and the desktop's
full object/layer editor are not imported.

ADIF exports use SSTV (FAX for FAX480) and retain the precise analog/DRM
label in `APP_MMSSTV_WEB_MODE`. HAMDRM is not an enumerated submode in the
[ADIF specification](https://adif.org/315/ADIF_315.htm#Mode_Enumeration).

The native FTP/hybrid functions depend on FTP sockets or a configured server.
A fully static browser app has no FTP socket API. They stay visibly disabled;
no proxy/server or external upload is silently substituted. Native external
logging programs and automatic radio repeaters also remain disabled. Offline
replay, file logging and audio generation are available.

## Build and validation

Build all three cores with `python scripts/build.py --emsdk PATH` and run
`npm test`. Each core has a separate `.js` loader and `.wasm` binary. The build
records binary hashes and versions, copies notices, and versions HTML assets,
worker imports and WASM requests so browser caches cannot mix builds. The
preview server uses `Cache-Control: no-store`. Deploy the complete `web/` tree.
No source ZIP is built or deployed.

Tests cover all 46 mode initializations and audio encoders; complete analog
round trips in seven color modes and FAX480; exact digital file/callsign
recovery in all 72 profiles; RS1–RS4 and an omitted MOT segment; BSR/FIX repairs
across retained transfers and invalid FIX bounds; JPEG 2000 lossless/lossy and
malformed inputs; original audio/resampler/worklet tests; and CW/tone timing.
The digital adapter tests reserved BSR ID reuse and single notifications;
BSR parsing tests compressed ranges and rejects malformed requests.
Browser tests exercise shared history/TX images, JPEG 2000+RS2 DRM generation
and receive, and pausing/switching/resuming the same transfer between layouts.
Real microphone/camera capture, print/download dialogs on normal browsers,
noisy/off-frequency radio captures and interoperability with physical desktop
QSSTV installations remain external verification tasks.

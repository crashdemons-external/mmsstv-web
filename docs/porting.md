# MMSSTV browser platform boundary

## Preserved code

The build reads the checked-in `mmsstv-src/` files, preserving their copyright
and license comments. It compiles `sstv.cpp`, `fir.cpp` and `Fft.cpp`, with their
headers, and extracts these complete original methods from `Main.cpp`:

`SyncSSTV`, `InitAutoStop`, `GetSqerrPos`, `AutoStopJob`, `GetPixelLevel`,
`GetPictureLevel`, `GetPictureLevelDiff`, `DrawSSTVNormal`, `DrawSSTVDiff`.

Original `Limit256`, `LimitRGB` and `YCtoRGB` from `ComLib.cpp` provide the color
conversion. All 43 mode names, dimensions, timing definitions, VIS and FSK
logic come from MMSSTV. The generated `receive_image.inc` is included in the
browser adapter, where bitmap scanlines are backed by byte arrays.

For offline audio generation, the original `CSSTVMOD` oscillator, output filter
and frequency queue are retained. `encode_image.inc` extracts all 14 original
`Line*` scan functions, the complete VIS/extended/narrow-mode header section
from `ToTX`, and the 43-mode scan selector from `SendSSTV`. Original `GetRY`,
`ColorToFreq` and `ColorToFreqNarrow` provide pixel conversion.

## Generated compatibility edits

- Replace VCL and desktop configuration includes with `native/web_compat.h`.
- Normalize header filename case for builds on case-sensitive systems.
- Convert CP932 source text to UTF-8 for Clang, retaining the original comments.
- Omit FIR graph drawing and CW identification. No hardware, sound-output
  device, serial ports, DLL/plugin loading, sockets or radio transmitter are linked.
- Initialize the modulator's buffer length and RGB gain factors before use,
  avoiding reads of uninitialized original constructor fields.
- Use standard `asinh` instead of the original Borland replacement.
- Use `delete[]` for original array allocations, and `memmove` for overlapping
  sample/history shifts. These are standard C++ compatibility corrections.
- Remove 4-byte structure packing. DSP structures never cross a serialized
  boundary; natural alignment permits checked access to double arrays.
- Windows `VirtualLock`/`VirtualUnlock` and FFT window notifications have no-op
  browser implementations. A minimal settings structure supplies the existing
  receiver's configuration fields.

`web/build-info.json` records the SHA-256 of every original input, the JavaScript
loader and the separate WebAssembly binary. The original source tree remains byte-for-byte unchanged.

## New adapter

`native/receiver.cpp` drains each completed original demodulator ring-buffer
page immediately, calls the original synchronization/drawing methods, retains
signal pages for redraw, and converts the original BGR bitmap to canvas RGBA.
It drives AGC level updates on audio sample time, rather than the desktop paint
timer. Original auto-stop hooks end the current browser image; completion and
revision counters notify JavaScript. A completed-image copy keeps history
intact if the receiver starts another image during the same processing block.

`native/encoder.cpp` replaces the desktop TX/device scheduler with a PCM sample
pump. It retains the default attention tones, original headers/scan timing,
footer and optional FSK callsign. Footer length uses TX timing independently
of the selected receiver mode. RGBA canvases provide the original bitmap
`Canvas->Pixels[x][y]` interface. No PTT or audio-output APIs are called.
`web/encoder-worker.js` processes chunks in a separate WASM instance, so audio
generation does not change the receiver's settings or input. The same encoder
has a main-thread fallback when workers are unavailable. JavaScript only wraps the
generated 16-bit PCM in a WAV header.

Manual phase and clock corrections redraw the retained signal with the original
renderer. The original automatic slant estimator is retained; a requested clock
change causes a redraw after processing the current audio block. The full
desktop high-precision/manual mouse-line calibration utilities are not ported.

`web/audio.js` reads WAV and original/legacy MMV samples, selects a channel and performs a continuous,
windowed-sinc anti-alias resampling to the original 11025 Hz receiver rate.
Other audio formats use browser codecs. Mic capture uses an AudioWorklet with
echo cancellation, noise suppression and automatic gain requests disabled.
An input-only ScriptProcessor fallback supports browsers without AudioWorklet.

`web/decoder-worker.js` keeps decoding off the UI thread. `web/engine.js`
also supports a main-thread fallback when workers are unavailable. The generated
classic script `web/mmsstv-core.js` loads the adjacent `web/mmsstv-core.wasm`
binary. Both paths require HTTP(S); direct `file://` opening reports instructions
for starting the local static preview server.

## Web interface and storage

The UI follows `Main.dfm`, the English configuration and reference screenshots,
using the actual `mmsstv-src/res/` toolbar glyphs and MMSSTV application icon.
The browser audio controls are added beneath the original stock-image pane.
Hardware controls remain disabled. The shared QSSTV/digital extension is
described in [qsstv-port.md](qsstv-port.md).

History contains PNG snapshots and metadata, with IndexedDB persistence per
origin. Settings, profiles and log entries use localStorage. No data leaves the
browser except explicit user downloads. Clearing site data clears local history;
the history JSON download is an external backup. Browser history and text-template JSON can be exported and imported. Import
of original `History.bin`, desktop template files and desktop configuration
files is not implemented.

## Verification limits

Complete generated recordings exercise four widely used modes with known
pixel colors and dimensions, plus FSK ID. All mode definitions initialize and
process samples. Resampling is tested at 8, 11.025, 22.05, 44.1, 48 and 96 kHz,
including chunk boundaries and rejection of a 9 kHz tone. MMV headers and
legacy raw recordings, microphone worklet channel routing and silent output,
FFT tone location, input level, and retained completed images are also tested.
Checked heap builds exercise the same full-image suite. Browser-generated
PNG/BMP pixels and JPEG dimensions are checked from the prepared download links.
These tests do not establish every mode's
behavior with real noisy radio signals or every browser/device combination.

The original 43 modes now also share QSSTV AVT24/AVT94 and FAX480 extensions.
The original source trees stay immutable; timing changes are applied to
prepared copies by `scripts/extend_modes.py`.

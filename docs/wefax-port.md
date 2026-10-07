# WEFAX decoder and encoder

The browser uses the original fldigi 4.2.13 WEFAX DSP for IOC576 (1809 pixels)
and IOC288 (904 pixels), with 240, 120, 90 and 60 lines/minute. It processes
11025 Hz mono audio. WEFAX is separate from the existing QSSTV FAX480 mode.
No fldigi interface, sound-device backend or radio controls are imported.

Select a WEFAX mode before opening audio: **More modes…** in MMSSTV, or the
Receive **Mode** selector in QSSTV. **Auto** still detects SSTV. Both perspectives
share the active receiver, images, history, settings and WAV generation.
**WEFAX settings…** supplies receive line speed, carrier (1900 Hz by default),
Skip APT, Skip phasing and End page. For recordings starting inside a picture,
enable **Recording starts in the image** before loading audio. This bypasses
APT/phasing and automatic stopping; Stop or the end of the recording finishes
the partial page. Disable it for normal broadcasts with start/stop sequences.

Both TX selectors and the Generate WAV dialog include the IOC modes. Images
are resized to IOC width while retaining their aspect ratio, converted to
grayscale using fldigi-web's 31/61/8 weighting, and transmitted with fldigi's
original APT/phasing/image/stop sequence at 1900 Hz. Transparent pixels become
white. Choose the line speed in the generation dialog. WEFAX has no SSTV FSK
callsign header. Optional browser VOX/CW additions still work. Generated audio
is limited to 30 minutes. Receive buffers are limited to 8192 rows; TX image
height is bounded to 8192 before the duration check.

The selected, unmodified upstream files live in `third_party/fldigi/`; their
hashes are in `fldigi-wefax-upstream.json`. `scripts/prepare_wefax.py` creates
the portable overlay under `build/wefax/`. The compiler emits separate
`web/wefax-core.js` and `web/wefax-core.wasm`. Workers load this module only
when WEFAX is selected or encoded; main-thread fallback is also supported.
Normal builds require no access to the original `fldigi-web` checkout.

The port reuses fldigi-web's resumable native transmit loop and the modem
output envelope/limiter. Receive history that desktop stores in method
statics is moved to each modem instance so source and mode resets are clean.
The selected LPM also updates the native correlation/AFC timing estimate.
Native page-end callbacks retain RGBA images for the shared gallery, including
partial pages. Brief near-black phasing/stop-tone artifacts are excluded from
automatic history and file completion; explicit Stop/End page and manual
reception can retain blank pages. Reception follows
fldigi's native phasing alignment and may include transition rows.

`tests/wefax.test.cjs` checks both IOC modes at all four speeds, grayscale pixel
values, native sequence duration, pull-size independence, missing-preamble
reception, image growth, bounds, cancellation and shared SSTV/WEFAX routing.
These generated-signal tests do not establish behavior on every noisy broadcast.
Live microphone capture and noisy/off-frequency recordings need device testing.

Copyright and license notices remain in the upstream files. Fldigi is
GPL-3.0-or-later; WEFAX also contains HAMFAX code under GPL-2.0-or-later, and
the FFT header uses LGPL-3.0-or-later. See the web third-party notices and
`web/licenses/Fldigi-COPYING.txt`.

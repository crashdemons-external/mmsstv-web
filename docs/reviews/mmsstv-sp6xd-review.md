# MMSSTV-SP6XD commit review

Reviewed 2026-10-04 using Git, against the committed `mmsstv-src` tree in local commit `745bd59`.

## Verdict

**Yes: there are real desktop workflow enhancements on `devel`, but no decoder enhancements. The implementation is not suitable for wholesale adoption.** The useful ideas are automatic ADIF export to Log4OM and PSK Reporter submissions. They need repairs or fresh implementations before reuse. For this web decoder, the fork offers no improved SSTV signal processing, additional receive modes, or better image decoding.

`master` is much more limited: it contains a small compiler compatibility patch, accompanied by personal configuration, regenerated build artifacts, and damaged Japanese resource strings.

## Scope and baseline

- All **553** entries in our committed `mmsstv-src` tree have the same paths and Git blob IDs as the fork's `8060b5f1e9727b0052d74108081c6db7b26babad` tree. This establishes an exact committed baseline, including binary resources.
- Reviewed `master` at `a66e49dd2af3348c55f82ef711aff14872275691` and `devel` at `7fc23400a0e736ca360966b413a41e1d35af999b`.
- Reviewed all 11 commits after the shared baseline, their net source changes, configuration and project files. Parsed all five changed binary DFM form resources as data to inspect properties and event wiring.
- `sstv.cpp`, `sstv.h`, `Sound.cpp`, `Sound.h`, `fir.cpp`, `fir.h`, `Fft.cpp`, `Fft.h`, `Wave.cpp`, and `Wave.h` are byte-identical to the baseline on both branches. Changes in `Main.cpp`'s image-processing sections are whitespace only.
- This is a review of the fork's changes, not an audit of inherited MMSSTV code. Existing functions were read only to establish contracts used by the new code.
- The fork was fetched into a temporary **bare repository**. No checkout, build, application, DLL, install hook, or fork-provided script was executed. No dependency was installed.

## Commit assessment

| Commit | What it actually adds | Assessment |
|---|---|---|
| [a66e49d](https://github.com/d3cker/mmsstv-sp6xd/commit/a66e49dd2af3348c55f82ef711aff14872275691) | Explicit floating-point arguments to `pow`, `sqrt`, and `atan2`; starts the initially suspended audio thread with `Start()`; resaves three forms. | Useful compiler maintenance; no DSP improvement. Form encoding regresses. This is the entire `master` delta. |
| [2021c22](https://github.com/d3cker/mmsstv-sp6xd/commit/2021c221b0a299f7bf994ac2540af041791d9e59) | Log4OM settings, INI persistence, option controls, and modern project adjustments. | Infrastructure for a new feature; does not yet export contacts. |
| [2b70429](https://github.com/d3cker/mmsstv-sp6xd/commit/2b70429ba62d2c70846e9b7a1d7fec327fa08f7b) | Sends an ADIF UDP datagram when a QSO finishes; adds date format `yyyymmdd`. | Real enhancement, with timestamp bugs. Its new UDP source initially lacks its header. |
| [4a1b55c](https://github.com/d3cker/mmsstv-sp6xd/commit/4a1b55c5228925f0c4a22bc184f212989b13d7b9) | Supplies `UDPSender.h`. | Repairs the preceding commit, no separate user feature. |
| [f401867](https://github.com/d3cker/mmsstv-sp6xd/commit/f401867caae6ecd4aeab2edfa80377069019fcfb) | PSK Reporter API header, settings, manual button, initialization and periodic tickle. | Real integration, but dependent on an external implementation and imperfect state handling. |
| [669b27d](https://github.com/d3cker/mmsstv-sp6xd/commit/669b27d2c3b85257ae3ff14e4e59d6fc0d1936da) | Numeric MHz-to-Hz conversion and reporting helper; QSO report controls. | Fixes the fork's own frequency conversion. QSO submission is still commented out before the next commit. |
| [0968ead](https://github.com/d3cker/mmsstv-sp6xd/commit/0968ead0e017d5cdd9afe79c90797ab75330722c) | Enables QSO reporting and reports FSK IDs when they update the remote callsign field; adds timed status windows. | Real automation, but introduces callback lifetime problems. Much of its large diff is line-ending churn. |
| [562d973](https://github.com/d3cker/mmsstv-sp6xd/commit/562d973c47f2f781c085f485f465a5ec23689380) | Moves logging into `XDOptions`, changes reporter lifecycle handling, deletes old project/entry-point files. | Refactor and attempted fixes, with remaining defects. Replacement project files arrive in the next commit. |
| [d90dc8e](https://github.com/d3cker/mmsstv-sp6xd/commit/d90dc8ee8a6a3c28eea5099afa6a56e707b8fb4a) | Adds renamed project and entry-point files. | Packaging/branding, not a decoding or reporting improvement. |
| [e4cc9fb](https://github.com/d3cker/mmsstv-sp6xd/commit/e4cc9fbddd59ff0dd54d146a658c0db7faa14713) | Normalizes line endings. | No functional enhancement. |
| [7fc2340](https://github.com/d3cker/mmsstv-sp6xd/commit/7fc23400a0e736ca360966b413a41e1d35af999b) | Reverts that normalization. | No net change: its full tree equals `d90dc8e`'s tree. |

The raw `devel` diff reports 19,916 insertions and 17,879 deletions. Ignoring whitespace reduces the `Main.cpp` delta to 147 changed lines and `Option.cpp` to 330 additions. Most remaining volume is project metadata, declaration reordering, or newly added integration files.

## Findings that affect adoption

### 1. Invalid frequencies can interrupt QSO finalization

**High confidence.** [`XDOptions.cpp:62`](https://github.com/d3cker/mmsstv-sp6xd/blob/7fc23400a0e736ca360966b413a41e1d35af999b/XDOptions.cpp#L62) calls `StrToFloat(freq, formatSettings)` without validation or a catch. The inherited UI permits unset/unknown frequency values, and `GetFreqString` can return a split-band string containing `/`. These are not valid floating-point inputs.

When QSO reporting is enabled, [`Main.cpp:8050`](https://github.com/d3cker/mmsstv-sp6xd/blob/7fc23400a0e736ca360966b413a41e1d35af999b/Main.cpp#L8050) calls this helper **before** advancing the current record, clearing the current QSO, and calling `AutoLogSave`. A conversion exception therefore exits that handler after `Log.PutData` but before normal finalization. Manual and automatic FSK reporting also propagate conversion errors. This is a new integration defect, not a finding against the original logger.

Repair: validate frequency before reporting and isolate reporting failures from contact finalization. Manage the helper with scoped ownership.

### 2. Log4OM export collapses contact start/end times

**High confidence.** [`XDOptions.cpp:145`](https://github.com/d3cker/mmsstv-sp6xd/blob/7fc23400a0e736ca360966b413a41e1d35af999b/XDOptions.cpp#L145) passes `GetTimeString(btime)` and `GetTimeString(etime)` into the same formatting call. The inherited helper returns a pointer to **one static buffer**. All returned time pointers alias that buffer, so the two exported values resolve to the same final contents; evaluation order determines which time wins. A contact starting at 1200 and finishing at 1205 cannot reliably export those two distinct values.

Repair: copy each formatted field into a separate string before constructing ADIF. The field lengths alone do not prevent this bug.

The same exporter also calls `JSTtoUTC(&Log.m_sd)` at line 129, mutating the application's live record after it has already been written to the log. The subsequently copied `Log.m_asd` snapshot is then in a different timezone from the saved record. This does **not** demonstrate corruption of the already written contact, but is an unnecessary state inconsistency. Convert a local copy instead.

### 3. Reporter settings bypass OK/Cancel and desynchronize runtime state

**High confidence.** [`Option.cpp:1484`](https://github.com/d3cker/mmsstv-sp6xd/blob/7fc23400a0e736ca360966b413a41e1d35af999b/Option.cpp#L1484) and subsequent `OnExit` handlers write global settings and initialize/uninitialize the reporter while the dialog is still open. The binary `Option.dfm` binds these handlers. Cancel cannot undo these side effects.

For example, disabling PSK Reporter, moving focus, and then cancelling can leave the library uninitialized while the retained `sys.m_PSKEnable` flag remains true. The disabled path leaves `m_PSKIsEnabled` unchanged. Conversely, an initialization failure does not reliably disable later report submission: `UpdateUI`, the timer, and automatic/QSO paths check the requested enable flag rather than successful initialization. The enable handler also warns about repeated initialization and then performs another initialization anyway.

Repair: validate dialog-local settings, commit them only on OK, and maintain one explicit reporter lifecycle tied to initialization success.

### 4. Timed success messages outlive their callback receiver

**High confidence for the ownership defect; runtime crash not tested.** [`XDOptions.cpp:52`](https://github.com/d3cker/mmsstv-sp6xd/blob/7fc23400a0e736ca360966b413a41e1d35af999b/XDOptions.cpp#L52) creates an ownerless timer whose `OnTimer` targets an instance method on the current `XDOptions`. The caller deletes that instance immediately after `SendPSKReport` returns, whereas the callback is scheduled three seconds later. The event retains a receiver pointer to a destroyed object. Its current callback body does not read instance fields, so this static finding should not be described as a demonstrated crash or exploitable vulnerability.

Line 59 additionally stores a form pointer through `reinterpret_cast<int>`. This assumes a 32-bit pointer and is incompatible with the project's advertised 64-bit configurations: it can be rejected by the compiler or lose address bits under a permissive conversion.

Repair: give the timer and callback a durable form/application owner; use a pointer-sized property or direct ownership rather than storing the pointer through `int`.

### 5. Committed configuration enables reporting with the author's identity

**High confidence.** [`Mmsstv.ini:1096`](https://github.com/d3cker/mmsstv-sp6xd/blob/7fc23400a0e736ca360966b413a41e1d35af999b/Mmsstv.ini#L1096) enables Log4OM and automatic PSK reporting, with `PSKMyLocator=JO81`; the main station callsign is `SP6XD`. It also includes the author's log path and a particular virtual audio device. Code defaults disable reporting when the section is absent, but the checked-in INI overrides those defaults.

If that INI is used to run the application unchanged, new reporting uses the author's station identity and locator. This is unsuitable distributable configuration, and the new outbound behavior needs explicit user configuration. The differing configured/default reporter ports (14739 versus 4739) are also unexplained in the repository; this review does not infer that either service port is invalid.

Repair: distribute a clean configuration with blank identity/location and integrations disabled.

### 6. Resaved forms damage Japanese labels and fonts

**High confidence from resource data.** In `a66e49d`, `PicFilte.dfm` changes the Auto button caption from Japanese `自動` to Unicode characters `U+017D U+00A9 U+201C U+00AE`. Its Japanese font name is similarly converted into unrelated characters. These are substantive string changes, not just binary serialization differences. `VerDsp.dfm` contains similar damage on `devel`.

Many other resource edits are harmless default-property removals or sizing adjustments, and the new reporting button, options, and 5000 ms timer are correctly present and wired. The damaged strings still conflict with preserving the original application's behavior and presentation. Actual rendering and any later English-label replacement were not tested.

Repair: retain/recover the original text with its intended encoding before resaving the resources.

## Dependency and trust limits

[`MmsstvXD.cbproj:636`](https://github.com/d3cker/mmsstv-sp6xd/blob/7fc23400a0e736ca360966b413a41e1d35af999b/MmsstvXD.cbproj#L636) references `PSKReporter.dll` and `PSKReporter.lib`, and lines 84/101 add an absolute directory on the author's desktop. Neither binary appears in either branch or any fetched commit history. The added header declares imported functions; it does not implement the reporter. Consequently the source tree alone does not provide a self-contained reporter build or allow review of its actual network implementation. The header's copyright/license text does not authenticate whichever DLL a user might supply.

The added UDP sender is short Winsock code that sends a constructed ADIF datagram to the configured IPv4 address. The added source has no evident unrelated shell launch, downloader, or file-upload routine. This is a bounded observation, **not a safety certification**: the external reporter binary and regenerated `.tds` debug artifact were not validated, and inherited MMSSTV code was outside scope. No fork build or runtime integration tests were performed. No tests were added by these commits.

## Relevance to this project

1. Keep our decoder baseline. There is no receive/DSP improvement to import.
2. If modern native C++Builder compatibility is needed, consider the small type/thread-start edits separately after checking the target runtime. Exclude personal INI data, corrupted DFM strings, and generated debug files.
3. Treat Log4OM export and FSK-ID reporting as feature ideas for a later phase. Reimplement or repair their boundaries and error handling before reuse. The native Winsock/VCL/DLL implementation cannot be carried directly into a browser decoder; any web integration needs an appropriate browser-compatible transport.
4. Do not merge the entire `devel` branch. Its useful features are separable from its defects, branding, and build/configuration churn.

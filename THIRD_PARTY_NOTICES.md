# Third-Party Notices

This inventory covers the runtime crate versions listed below from
`crates/vtracer_wasm/Cargo.lock`, the VTracer-derived converter/SVG code, and
notices from the locally installed Rust standard library. It is not an inventory
of every build tool or every package in the lockfile.

MIT is selected wherever an MIT OR Apache-2.0 choice is available. Additional
Unicode terms remain applicable. The files linked below preserve local upstream
license texts without changing copyright names, years, or template placeholders.
Author metadata is not a replacement copyright notice.

## Browser studio additions (2026-11-11)

All runtime assets are self-hosted; no Vectorizer.AI source or API is used.
Pinned npm dependency identities are recorded in package-lock.json.

| Component | Version | License / provenance | Included license |
| --- | --- | --- | --- |
| UpscalerJS | 1.0.0 | MIT, Kevin Scott | licenses/browser/upscaler-MIT.txt |
| ESRGAN Slim converted models x2/x4 | @upscalerjs/esrgan-slim 1.0.0 | Package distributes weights under MIT notice, not all ESRGAN models | licenses/browser/esrgan-slim-MIT.txt |
| TensorFlow.js | 4.11.0 | Apache-2.0 | licenses/browser/tensorflow-Apache-2.0.txt |
| Schibsted Grotesk webfont | Google Fonts distribution | SIL Open Font License 1.1, Schibsted-Grotesk Project Authors | licenses/browser/Schibsted-Grotesk-OFL.txt |
| ONNX Runtime Web | 1.31.1 | MIT, Microsoft; third-party notices retained | licenses/browser/onnxruntime-MIT.txt, licenses/browser/onnxruntime-ThirdPartyNotices.txt |
| U²-Net compact weights (u2netp) | SHA-256 below | Upstream U-2-Net Apache-2.0; ONNX hosted by rembg, not relicensed by rembg | licenses/browser/U2Net-Apache-2.0.txt |
| jsPDF | 4.2.1 | MIT | licenses/browser/jspdf-MIT.txt |
| svg2pdf.js | 2.9.0 | MIT | licenses/browser/svg2pdf-MIT.txt |

U²-Net source: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx

SHA-256: `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`.
Asset copied unmodified and checksum-checked. Historical conversion checkpoint
and toolchain are not independently established. Upstream:
https://github.com/xuebinqin/U-2-Net . Credit Xuebin Qin, Zichen Zhang,
Chenyang Huang, Masood Dehghan, Osmar R. Zaiane, Martin Jagersand,
“U2-Net: Going Deeper with Nested U-Structure for Salient Object Detection”,
Pattern Recognition 106 (2020), 107404.

Browser preprocessing is independently written: max-normalized RGB/ImageNet
statistics and resized saliency; bilinear resize differs from rembg's Pillow
Lanczos implementation. AI does not guarantee accurate restoration. Keep model
and runtime licenses distinct and retain all notices when redistributing.
Bundle legal comments are preserved by scripts/vendor.mjs. esbuild is a build
tool, not an application runtime.

## Components

| Component | Version | Selected license | Local license copy |
| --- | --- | --- | --- |
| VTracer-derived code | Local upstream license; version not established by license file | MIT | [VTRACER-LICENSE.txt](licenses/VTRACER-LICENSE.txt) |
| vtracer_buffer-derived converter/SVG code | 0.6.5 | MIT | [LICENSE-vtracer_buffer.txt](licenses/LICENSE-vtracer_buffer.txt) |
| visioncortex | 0.8.10 | MIT | [LICENSE-visioncortex.txt](licenses/LICENSE-visioncortex.txt) |
| bit-vec | 0.6.3 | MIT | [LICENSE-bit-vec.txt](licenses/LICENSE-bit-vec.txt) |
| flo_curves | 0.3.1 | Apache-2.0 | [LICENSE-flo_curves.txt](licenses/LICENSE-flo_curves.txt) |
| itertools | 0.8.2 | MIT | [LICENSE-itertools.txt](licenses/LICENSE-itertools.txt) |
| either | 1.19.0 | MIT | [LICENSE-either.txt](licenses/LICENSE-either.txt) |
| roots | 0.0.6 | BSD-2-Clause | [LICENSE-roots.txt](licenses/LICENSE-roots.txt) |
| smallvec | 1.16.3 | MIT | [LICENSE-smallvec.txt](licenses/LICENSE-smallvec.txt) |
| num-traits | 0.2.19 | MIT | [LICENSE-num-traits.txt](licenses/LICENSE-num-traits.txt) |
| wasm-bindgen | 0.2.129 | MIT | [LICENSE-wasm-bindgen.txt](licenses/LICENSE-wasm-bindgen.txt) |
| cfg-if | 1.0.5 | MIT | [LICENSE-cfg-if.txt](licenses/LICENSE-cfg-if.txt) |
| once_cell | 1.21.4 | MIT | [LICENSE-once_cell.txt](licenses/LICENSE-once_cell.txt) |
| wasm-bindgen-shared | 0.2.129 | MIT | [LICENSE-wasm-bindgen-shared.txt](licenses/LICENSE-wasm-bindgen-shared.txt) |
| unicode-ident | 1.0.27 | MIT AND Unicode-3.0 | [LICENSE-unicode-ident.txt](licenses/LICENSE-unicode-ident.txt), [LICENSE-UNICODE.txt](licenses/LICENSE-UNICODE.txt) |

## Local provenance and attribution

### VTracer

`licenses/VTRACER-LICENSE.txt` is an exact copy of
`C:/Users/admin/Desktop/Claude/vtracer-desktop/THIRD-PARTY-LICENSES/VTRACER-LICENSE.txt`.
Its copyright notice is:

> Copyright (c) 2024 TSANG, Hao Fung

### vtracer_buffer 0.6.5

Converter/SVG code is adapted from `vtracer_buffer` 0.6.5. Its MIT license is
included independently of whether the package appears as a runtime dependency.
`licenses/LICENSE-vtracer_buffer.txt` is an exact copy of
`vtracer_buffer-0.6.5/LICENSE-MIT` in the registry directory below. Its copyright
notice is:

> Copyright (c) 2023 Tsang Hao Fung

The package manifest lists Chris Tsang as author and declares
`MIT OR Apache-2.0`; MIT is selected here. The separate 2024 VTracer notice is
retained as well.

### Runtime crates

Registry source directory:

`C:/Users/admin/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f`

For each runtime crate other than `flo_curves` and `roots`, the linked MIT file
is copied exactly from `<name>-<version>/LICENSE-MIT`. For `roots`, it is copied
from `roots-0.0.6/LICENSE`. The additional `unicode-ident` notice is copied exactly
from `unicode-ident-1.0.27/LICENSE-UNICODE`, including its 1991-2023 Unicode
copyright notice.

### flo_curves 0.3.1

Attribution: Andrew Hunter, as listed in `flo_curves-0.3.1/Cargo.toml`.
The manifest declares `Apache-2.0`. No separate license or NOTICE file was found
in the local crate package. The complete standard Apache License 2.0 text,
including its appendix, is copied exactly from
`bit-vec-0.6.3/LICENSE-APACHE` into `licenses/LICENSE-flo_curves.txt`.
No copyright statement has been invented for `flo_curves`; the unfilled appendix
example belongs to the standard license text.

## Rust standard library

Local toolchain identified with `rustc --print sysroot` and `rustc --version`:

- `rustc 1.97.1 (8bab26f4f 2026-07-14)`
- `C:/Users/admin/.rustup/toolchains/stable-x86_64-pc-windows-msvc`

Exact copies from that sysroot's `share/doc/rust/` directory:

| Upstream file | Included copy |
| --- | --- |
| `COPYRIGHT-library.html` | [COPYRIGHT-rust-library.html](licenses/COPYRIGHT-rust-library.html) |
| `licenses/MIT.txt` | [LICENSE-rust-std.txt](licenses/LICENSE-rust-std.txt) |
| `licenses/Unicode-3.0.txt` | [LICENSE-rust-UNICODE.txt](licenses/LICENSE-rust-UNICODE.txt) |
| `licenses/BSD-2-Clause.txt` | [LICENSE-rust-BSD-2-Clause.txt](licenses/LICENSE-rust-BSD-2-Clause.txt) |

MIT is selected for the standard library's dual-licensed portions. The full
upstream library copyright inventory is retained without filtering: it includes
in-tree copyright notices, exceptions, and dependency license texts, including
platforms not necessarily present in the WebAssembly output. Its inclusion does
not imply that all listed dependencies are shipped. The upstream MIT and BSD
text placeholders are preserved, not filled with guessed copyright data; the
copyright inventory supplies the corresponding upstream notices.

## Redistribution and verification scope

Distribute this notice and its linked license files with the application and
WebAssembly output. Retain the MIT notices, roots BSD conditions/disclaimer,
applicable Unicode notices, and Apache-2.0 license. For modified Apache-licensed
files, retain applicable upstream notices and identify modifications as required
by that license; preserve any applicable upstream NOTICE file if one is supplied.

This documentation-only change does not verify deployment packaging, audit
modified-file markings, or establish which compiler built an existing binary.
Before release, confirm these files accompany the deployed application and that
Rust notices match the toolchain used for that release. Recheck this inventory
when dependencies or adapted upstream sources change. Build-only dependencies
and redistributed development tools require a separate review if shipped.

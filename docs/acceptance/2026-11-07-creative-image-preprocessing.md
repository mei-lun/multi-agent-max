# Creative image preprocessing acceptance — 2026-11-07

This is an independently installable **partial image port (M2/S1)**: local solid-background removal from PNG/JPEG images. It does not complete the image workbench, cloud image generation, Spine workbench or the full M1 milestone. Backend persistent jobs/assets (B2) are an independent service slice; this browser-local operation does not claim to exercise B2.

## Source and packaging

- Original algorithm: `vendor/levelup/baseline-6542241/src/lib/spineMatting.ts`, function `matteSpineSolidBackground`.
- Upstream commit: `6542241e440dead6cee60440afd8e658dd0ce0ca`.
- Exact original source SHA-256: `05790da9a444b1881243fec2ac13e0fc21d8c084b026a6c9b8ec9145f427f994`.
- `config/scripts/build-creative-image.mjs` checks this source hash against vendored provenance and transpiles the original TypeScript using transpileModule, without rewriting the algorithm. Output records source attribution and hashes actual HTML/CSS/JS/provenance assets.
- Generated install directory: `.mam-local/component-packages/creative-image`. Manifest: `creative.image` version `0.1.0`, host API `1.0.0`, minimum host `0.1.40`, operation `image.removeSolidBackground`, browser-local description and no required capabilities/resources. Installed output has no vendor path dependency, remote scripts, fonts or assets.

## Actual verification

Executed build, `packages/creative-image/verify.mjs`, and native Electron harness `config/scripts/verify-creative-image.mjs` successfully. The algorithm verifier checks manifest content hashes, enclosed green detail preservation, unchanged input pixels, transparent output, invalid empty dimensions and blank transparent input.

Native QA launches an isolated hidden sandboxed Electron renderer, creates a real PNG File and assigns its FileList to the browser input, waits for createImageBitmap decoding, clicks apply, compares original and processed canvas bytes, and verifies enclosed detail remains opaque. It clicks export, intercepts the real session will-download event into the QA directory, decodes the resulting PNG using nativeImage and checks transparent edge and opaque enclosed detail. Restore returns exact original canvas bytes. Light/dark media emulation at a 720px outer window confirms visible canvases and no horizontal overflow. Both screenshots were visually inspected; controls and side-by-side previews remain readable. A tiny 15×15 fixture appears at native size, not scaled into a photographic preview.

Local-only, generated evidence (not tracked acceptance attachments):

- `.mam-local/creative-image-qa/result.json` — successful native checks.
- `.mam-local/creative-image-qa/processed.png` — actual exported PNG.
- `.mam-local/creative-image-qa/light.png` and `dark.png` — inspected captures.
- `.mam-local/creative-image-qa/light.json` and `dark.json` — viewport, overflow, canvas and background-color metrics.

## Lifecycle and verification boundary

Native package QA loads the built file URL directly. It proves browser processing/download behavior, **not** the complete registry install/enable/custom-protocol/lease lifecycle. The host lifecycle smoke must independently install this package, open its hashed custom-protocol window, verify local file selection and blob download under that session, and release its registry lease on close. The host currently permits blob/data requests and denies remote requests, navigation, popups and permissions; this package needs no privileged IPC. Browser download must remain a user-directed save, never an arbitrary renderer filesystem write.

The local UI's “图片仅在本机处理” and “不包含 AI 生成或云端上传” text accurately describes its user-facing behavior; it does not expose implementation details or pretend to offer cloud controls. No network/API calls or API credits were used. No LevelUp source was modified. Full native file-dialog automation and JPEG-specific browser fixture coverage are not included in this harness.

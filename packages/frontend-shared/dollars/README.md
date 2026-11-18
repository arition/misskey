# Dollars typography

This module is the Inter customization for the Dollars fork. The main and embedded frontend each import `typography.scss` with one `@use` statement. Keep font behavior here rather than modifying upstream global font rules or compiled bundles.

## Behavior

- Inter is the inherited default UI font, with normal and italic variable weights.
- Fonts are self-hosted; Vite emits content-hashed WOFF2 assets and rewrites their URLs.
- The explicit `useSystemFont` preference is preserved.
- CJK and emoji use the existing system fallbacks.
- Icon fonts, code, and explicit MFM font styling are not overridden.
- `font-display: swap` keeps text readable while fonts download.

## Font provenance

The files in `fonts/` are unmodified official Inter 4.1 files from:

https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip

Release archive SHA-256:
`9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`

Font checksums are asserted by `scripts/dollars/typography.test.mjs`. `fonts/LICENSE.txt` is the accompanying SIL Open Font License. Do not relabel the font binaries as AGPL.

## Checks

Run the Node test at `scripts/dollars/typography.test.mjs`, compile both frontends using the normal source build, and verify actual font rendering in a browser. Include normal and italic text, CJK, icons, code, and the system-font preference. No database is needed for the source-level tests.

## Rebase surface

Only the two `@use` statements touch existing upstream source files. If a future release moves either global stylesheet, move its import to the new entry point and rerun the checks. The remaining feature files stay isolated in this directory and its test script.

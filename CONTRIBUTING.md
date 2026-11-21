# Contributing to FluoForge

Thank you for your interest in FluoForge.

## Contributor License Agreement

FluoForge is offered under AGPL-3.0-only and, separately, under a commercial licence (see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)). To keep offering the commercial licence, the project needs the right to relicense every contribution.

For that reason, **every outside contribution needs a signed Contributor License Agreement** ([CLA.md](CLA.md)) before it can be merged. This applies to code, documentation, tests and assets.

To sign it:

1. Read [CLA.md](CLA.md).
2. Fill in your details and sign it.
3. Send it to the maintainer at remybonnavion42@gmail.com.
4. Tick the CLA box in the pull request template.

If your employer has rights to your work, your employer must agree to the contribution as well.

## Working on the code

- Work on a branch made from `dev`, and open the pull request against `dev`.
- FluoForge runs in the browser without a build step:
  - Serve the folder with `python3 -m http.server 8765 --bind 127.0.0.1`.
  - Open `http://127.0.0.1:8765/`.
- Run `npm test` before opening a pull request, and add checks for new behaviour (see [Tests](#tests)).
- A user-visible change updates [README.md](README.md) only if the pitch or quick start changes, [docs/MANUAL.md](docs/MANUAL.md) for how to use it, and the "Unreleased" section of [CHANGELOG.md](CHANGELOG.md).
- New source files start with this header, in the comment syntax of the file type:

  ```
  SPDX-License-Identifier: AGPL-3.0-only
  Copyright (C) 2026 Remy Bonnavion
  ```

- If you add a third-party library or font, add it to [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) with its version, licence and source. Its licence must be compatible with both AGPL-3.0 and the commercial licence; in practice, a permissive licence. Vendor it in `assets/vendor/` and pin it in `assets/vendor/VERSIONS.md` (version, source URL, SHA-256): the app makes no third-party requests.

## Tests

Node is used only for development; the app itself needs no build and no Node.

```bash
npm ci                                          # Playwright and pdf.js, development only
npx playwright install chromium firefox         # once; add --with-deps on a fresh Linux machine
npm test
```

`npm test` runs `tests/run-headless.mjs`, which:

1. In Node: checks that the version is the same everywhere (`npm run release -- --check`, see [Releasing](#releasing)) and runs the release script's own tests (`tests/release-regression.mjs`); then tests the project-format migrations, the fixture library and the format lock (`tests/migrations-regression.mjs`).
2. Generates the test images with `tests/generate-fixtures.mjs` (pure Node, no Python).
3. Serves the repository on a local port.
4. Runs every suite of the browser runner in headless Chromium and Firefox, blocking and reporting every request to another origin.
5. Checks the exports of the reference figure (see below).
6. Exits non-zero on any failure.

Useful options, passed after `--`:

- `--browser=chromium`
- `--suite=zstack-regression`
- `--skip-reference`
- `--reference-only`

GitHub Actions runs `npm test` on every push and pull request (`.github/workflows/test.yml`), and deploys `main` to GitHub Pages (`.github/workflows/pages.yml`).

### Reference exports

- `tests/fixtures/reference.mfcproj.zip` is a two-page figure that uses every object type: a multichannel TIFF, a raster image, an inset and its outline, a scale bar, text boxes, a rectangle, an ellipse, a line, a pen path with arrowheads, a group, and an image cropped to a shape.
- Its exports are stored next to it as `reference.svg`, `reference.tif` and `reference.pdf`.
- `tests/reference-check.js` reopens the project, exports it again and compares the results:
  - SVG structurally: the same element tree and attributes, numbers within 0.02 px, generated ids normalised, embedded images compared by pixels; it must also be byte-identical after renumbering Fabric's clip-path ids;
  - TIFF by pixel difference;
  - PDF by pixel difference after rendering both files with pdf.js.
- The tolerances are at the top of that file. The references are Chromium renders.
- After an intended export change, run `npm run make-reference` and explain the difference in the pull request.

### Old projects

A project saved by any release since v0.1.0, or in a legacy format, must open, look the same and export the same in every later version. [docs/PROJECT-FORMAT.md](docs/PROJECT-FORMAT.md) describes the format, the migrations and the fixtures; in short:

- `tests/compat/` holds one folder per fixture (listed in `tests/compat/index.json`): the project file, its `expected.json` and its SVG export. The `compat-regression` suite checks every one.
- A change to what a saved state means bumps the schema and adds a pure migration in `js/migrations/`. `tests/migrations-regression.mjs` tests each migration alone and fails if one is missing.
- A pull request that changes `serializeObject`, `restoreObject` or `captureState` must add a migration or explain why none is needed: `npm test` fails until `tests/compat/format-lock.json` is recorded again with `node tests/migrations-regression.mjs --update-lock`.
- Each release adds its own fixture before it ships (see [Releasing](#releasing)).

### The browser suites

Open [the browser regression runner](tests/browser-regression.html) on the local server to run one suite by hand. Each run uses a fresh app frame and isolated recovery storage. `npm test` runs the same suites.

| Suite | What it covers |
|---|---|
| `dev-interface-regression` | Empty startup, document creation and opening, themes, collapsible panels, and native mouse events for nodes, handles and insets: node drag positions at several zoom levels on rotated, scaled, skewed and flipped paths; drawing an inset keeps its source image fixed. |
| `path-regression` | Progressive drawing, mixed straight and cubic segments, node editing and insertion, corner/smooth conversion, Alt handle separation, closure, arrowheads, persistence, copy/paste, legacy curve migration, vector SVG/PDF export. |
| `regression` | Linked insets, scale bars, mixed copy and duplication, text borders, curve controls, keyboard movement. |
| `project-export-regression` | Three editable versions, source deduplication, legacy ZIP/JSON/gzip migration, recovery drafts and retention, storage errors, native PDF paths and selectable text, clipping and opacity, explicit font failures, source-resolution image export. Needs the large test TIFF from `npm run fixtures`. |
| `ui-fixes-regression` | Stable inspector panels, the selection bar, font size and text box sizing, vertical text alignment, 45° rotation snapping, selection-centred zoom, both lock types, undo/redo and loading, visibility icons, exact-size insets, export file names, ImageJ swatches, the v0.22 project. |
| `v024-regression` | A v0.18-format project, the live inset size readout, scale bar previews and metadata, multi-image and multi-shape edits, transform-free dashed SVG outlines, crop to shape, multi-page export, the close warning. |
| `zstack-regression` | ImageJ hyperstacks: channel/slice/frame split, max and mean projections, slice and frame controls, history labels, undo/redo, saved projects. |
| `about-regression` | The About dialog: version, copyright, licence links, a source link containing the running version, keyboard focus, Escape and Close. |
| `offline-regression` | The Content-Security-Policy, same-origin scripts and styles, no request to another origin, a blocked third-party image and fetch, each vendored file's SHA-256, bundled licence files. |
| `module-api-regression` | The `window.MFC` API keeps exactly its names, no global leaks, no module over 600 lines, every tool exports `activate`, `deactivate` and `refreshPanel`, the app version matches the module entry's `?v=`. |
| `image-info-regression` | Quiet import, the `?debug=1` logger, the Image info dialog. |
| `compat-regression` | Every fixture in `tests/compat/` opens, matches its `expected.json` and SVG export, keeps its source images byte for byte, keeps its original version when migrated, and reopens identically; saving as `.fluoforge`; a damaged source; a project from a newer version. |
| `errors-storage-regression` | The error message and Copy details, damaged TIFFs, the memory warning, a full IndexedDB, the storage line. |
| `lut-calibration-regression` | The 14 LUTs (groups, matplotlib endpoints, Fire as ImageJ builds it), ImageJ LUTs recognised in full or kept as "From file", the LUT popover with mouse and keyboard, and a viridis image with a calibration bar through save, reopen, undo and the SVG, PDF and TIFF exports. |
| `histogram-display-regression` | Histograms (exact for integers, binned for float) computed once per plane in the worker, Auto against ImageJ 1.54p values and the exact 0.175 % percentiles, slider limits (8-bit, 12-bit in 16, float), the log-scale histogram behind the sliders, Auto / Full range / Reset to file as single undo steps, also after save and reopen and on two images; Copy / Paste display settings by channel number in one undo step, from the selection bar and the right-click menu (mouse, Shift+F10, Menu key). |
| `comparison-regression` | Comparison groups: Link and Unlink, members matched to the first image, linked range, LUT, gamma and Auto edits from every control as one undo step, invert left per image, a member inside a group of objects, divergence after a paste with the layers badge and the channel panel warning, matching again, save and reopen. |
| `file-formats-regression` | The fixtures in `tests/fixtures/formats/` (8-bit RGB, 16-bit, 32-bit float and a hyperstack from ImageJ, an OME-TIFF from Bio-Formats, the Fiji macro's output, signed 16-bit, packed 12-bit, planar 16-bit RGB): dimensions, pixel size, channel names and colours, bit depth and pixel values; the OME-XML parser (six dimension orders, TiffData, units, Color, fallbacks); float planes in the compositor; the import errors for CZI/LIF/ND2, BigTIFF and 16-bit float with the macro link. |
| `figure-report-regression` | The figure report of `tests/fixtures/reference.mfcproj.zip` against `tests/fixtures/reference-report.json`, `.md` and `.csv` (rewrite them with `node tests/run-headless.mjs --make-report` after an intended change); SHA-256, crop in source pixels, insets, shape masks, pages, effective resolution; Z projection, slice and frame, gamma, invert, brightness and contrast; CSV and Markdown escaping; the report embedded in SVG `<metadata>` and the PDF Subject; the dialog's downloads, keyboard path and themes. |
| `figure-check-regression` | Every figure check rule on synthetic contexts (fires and stays quiet); the reference project's findings; clipping on real pixels; inset outlines, the pasteboard and a diverged comparison group; selecting a finding; dismissing with a note through undo, save and reopen and into the figure report; Restore; the Export menu summary; titles, keyboard and themes. |
| `vision-preview-regression` | The Vision selector and its four filters (Machado et al. matrices, rows summing to 1); colours rendered through them (red and green in one hue for deuteranopia and protanopia, blue towards teal for tritanopia, R = G = B for grey-scale); state, history, canvas pixels and SVG export unchanged with every preview; the badge, keyboard use and themes. |
| `snapping-regression` | `computeSnap` (edge choices, threshold, nearest wins); real mouse drags that land exactly on a neighbour's edges over several moves; guides while dragging, cleared on release and never exported; snapping off, page or objects only, chosen edges, distance at two zooms, guides off, hidden targets, Alt, project override, keyboard nudges. |
| `preferences-regression` | The registry (valid defaults, value checks, precedence, storage, unknown keys, damaged storage, copies); project values through undo, save and reopen and Document *Apply*; new text uses the defaults; the dialog (above the canvas and panels, rows from the registry, *This project only*, Reset, Esc, Ctrl+, focus trap, shortcuts blocked, titles, themes, ticks disabled without a figure). |
| `export-upgrades-regression` | The TIFF writer (Deflate, LZW, none; RGB and RGBA; read back by UTIF), the compressed TIFF and PNG exports against the rendered page, 600 dpi, transparency, page ranges and a PDF page subset (pdf.js), the report next to an export, the Export dialog, and the panels zip (letters, merge at source resolution, grey channels, pixel size, README). |
| `compositor-regression` | The compositor against the previous one (1:1 and enlarged), the 8 presets as LUTs, gamma and invert, area averaging (no moiré on a shrunk checkerboard) in the preview and in export, worker and main-thread fallback byte for byte, a 4096 px 4-channel recomposite under 100 ms with the main thread free, one composite per frame during a slider drag, the gamma and invert controls. |

The suites can also be run from the browser console with the app open, for example:

```js
const script = document.createElement('script');
script.src = '/tests/path-regression.js';
document.head.append(script);
script.onload = async () => console.log(await runPathRegressions());
```

The supplied `image1.tif` and `image2.tif` can be imported to exercise real four-channel TIFF decoding.

## Releasing

The version is written in **one place**: `MFC_VERSION` in `js/core/state.js`. Never edit the copies by hand; `scripts/release.mjs` writes them:

- the `?v=` cache-busting query strings in `index.html` (the vendored libraries have none: their files never change);
- `"version"` in `package.json` and `package-lock.json`.

```bash
npm run release -- 0.1.5     # set the version, copy it everywhere, date the CHANGELOG
npm run release              # copy the current version everywhere again
npm run release -- --check   # change nothing; fail and list every copy that differs
```

With a version number, the script also renames the CHANGELOG's `## Unreleased` notes to `## v0.1.5 (<today>)` and leaves a new empty `## Unreleased` above them. It refuses a malformed version, an empty "Unreleased" section or a version that is already in the CHANGELOG, and then changes nothing.

To release: describe the changes under "Unreleased", run `npm run release -- <version>`, then `npm run compat-fixture -- --ref=worktree` to save that version's fixture (add its folder to `tests/compat/index.json`), run `npm test`, and commit. `npm test` fails while the current version has no fixture. A local script or stylesheet added to `index.html` must carry a `?v=` query; the check reports one that does not.

## Project notes

- `assets/vendor/svg2pdf.umd.min.js` carries one local fix (marked at the top of the file): its data-URL pattern no longer overflows the call stack on very large embedded images, which made PDF export fail with "Maximum call stack size exceeded".
- The README logo is `assets/FluoForge-logo-Github-viridis.svg`. The app icons (SVG, PNG from 16 to 512 px, `favicon.ico` and the Apple touch icon) are in `assets/FluoForge-app-icons/`; the page uses them as its favicon, in the top bar and on the empty workspace.

# Changelog

Each release lists what changed for users first, then development changes. New notes go under "Unreleased"; `npm run release -- <version>` dates them (see [CONTRIBUTING.md](CONTRIBUTING.md#releasing)).

## Unreleased

## v0.1.7 (2026-11-19)

- **LUT library.** Besides the 8 single colours, channels can use viridis, cividis, magma and inferno (perceptually uniform and colour-blind safe), Fire (as in ImageJ) and inverted grey. All are generated in code.
- **LUT picker.** The colour menu is now a popover of gradient swatches grouped as "Colour-blind safe", "Classic" and "Intensity". It works with the keyboard (arrows, Enter, Escape) and applies to every selected image.
- **LUTs from ImageJ files.** A LUT in an ImageJ TIFF is now compared in full with the library, so Fire or viridis are recognised (Fire used to open as grey). A LUT that matches nothing is kept with the project and offered as "From file"; Image info says so.
- **Calibration bar.** A new ▮ button on each channel adds a bar showing that channel's colour table from its min to its max, with both values as labels. It follows the channel's range, LUT, gamma and invert, and is saved, undone and exported like any object (frame and labels as vectors, the gradient as a small image).
- **Project format 3.** Projects store the new LUT names, a file's own LUT and calibration bars; older projects open unchanged.

### Development

- `js/image/luts.js`: the LUT library (matplotlib 3.9.2 tables for viridis, magma, inferno and cividis; ImageJ's Fire control points); the compositor reads every table from it. `js/tools/calibration-bar.js`: the calibration bar.
- Licences: `assets/vendor/LICENSE-mpl-colormaps.txt` (CC0) and `LICENSE-matplotlib.txt`, listed in THIRD-PARTY-NOTICES.md.
- **Tests:** the new `lut-calibration-regression` suite; `migrations-regression` tests `schema-2-to-3.js`; the colour checks in `v024-regression` and `ui-fixes-regression` now use the popover.

## v0.1.6 (2026-11-19)

- **Gamma and invert per channel.** Each channel in the Channels panel has a **gamma** field (0.1 to 5, default 1) and an **invert** box. Like *min* and *max* they change only the display, never the data; they apply to every selected image, appear in the History panel and are saved with the project.
- **Smoother, faster colours.** The colours of an image are now computed in background workers, so dragging a slider stays smooth: a 4096 px, 4-channel image updates in about 55 ms (Chromium) and the page never freezes. A slider drag redraws at most once per screen frame.
- **No moiré when shrinking.** An image shown or exported smaller than its pixels is now averaged down (each pixel is the mean of the source pixels it covers) instead of sampled, so fine regular detail no longer turns into false patterns. Images shown at their size or larger are unchanged: every source pixel stays a sharp square.
- **Colours computed the Fiji and QuPath way.** Each channel's value is mapped to one of 256 levels of its colour (a 256-entry LUT), and the channels are added as whole numbers. Compared with 0.1.5, at 1:1 a 16-bit image can differ by 1 level out of 255 in a few pixels: where two channels add up at an exact rounding tie (0.05 % of the values in the reference figure), and in the green half of orange. 8-bit images and single grey, red, green, blue, cyan, magenta and yellow channels are identical.
- **Project format 2.** Projects store each channel's gamma and invert flag; older projects are converted on opening (`schema-1-to-2.js`) and keep their original version on the first save.

### Development

- `js/image/composite-core.js` holds the compositor as pure functions (LUTs, level tables, area averaging, Z projection), run in a pool of up to 4 module workers (`js/image/composite-worker.js`), each compositing a band of rows, or on the main thread when workers are unavailable. Pixel data is copied to the workers once; they keep the resampled preview planes, so a display change sends no pixels.
- `MFC_TIFF.composite()` and `MFC_TIFF.selectPlane()` are asynchronous; `MFC_TIFF.whenIdle()` waits for pending composites.
- The reference exports (`tests/fixtures/reference.svg`, `.tif`, `.pdf`) were re-exported from the unchanged reference project: 191 of 393,660 colour values in its three 16-bit TIFF panels changed by 1 level (above).
- The import memory estimate now includes the copy of the shown planes sent to the workers.
- **Tests:** the new `compositor-regression` suite; `migrations-regression` tests `schema-1-to-2.js`.

## v0.1.5 (2026-11-18)

- **Old projects open in every new version, and this is now tested.** Every project saved by FluoForge 0.1.0 or later, and the older `.mfcproj.json`, gzip and `.mfcproj.zip` formats, must open, look the same and export the same in every later version.
- **Your original is kept.** The first time you save a project that had to be converted from an older format, the version you opened stays in the file unchanged, and the converted figure is saved as a new version next to it (**Versions** lists both).
- **Projects from a newer FluoForge open.** This version loads what it understands and says "Saved by FluoForge v…; some content may not display". When you save, what it did not understand is kept unchanged. Export refuses with a clear message rather than leave anything out.
- **Damaged images inside a project are detected.** Each image in a project is named after its SHA-256 checksum; a copy whose bytes no longer match is refused with a message naming the image.
- **Recovery drafts no longer miss a change.** When a draft was requested while the background draft save was still running (every 15 s), the request was skipped. Creating a new figure or restoring a version could then replace the figure without a draft of your latest changes. Draft saves now wait for each other, and the latest state is always saved. This also caused an occasional test failure on GitHub.

### Development

- **Project format documented:** `docs/PROJECT-FORMAT.md` describes `manifest.json`, `versions/` and `sources/`, every object type and its saved fields, and every format change with its date and version.
- **Migrations:** `state.schema` is the format version. Each format change adds one pure migration in `js/migrations/` (`schema-<n>-to-<n+1>.js`), and opening, restoring a version and recovering a draft run the chain up to the current schema. The legacy loaders now produce schema 0, and their two remaining fixes (a v0.18 scale bar's length from its label, inset outlines in source pixels) are `schema-0-to-1.js`.
- **Fixture library:** `tests/compat/` holds the reference figure saved by every release from v0.1.0 (built by that release with `npm run compat-fixture`), and the legacy formats, each with an `expected.json` and its SVG export. The rewritten `compat-regression` suite checks all of them.
- **Format lock:** `tests/compat/format-lock.json` records `serializeObject`, `restoreObject` and `captureState`. Changing one fails `npm test` until a migration is added or the lock is updated with an explanation.

- **One version number.** The version is written only in `js/core/state.js` (`MFC_VERSION`). The new `npm run release` script (`scripts/release.mjs`) copies it into the `?v=` cache-busting strings of `index.html`, `package.json` and `package-lock.json`, and dates this changelog's "Unreleased" notes. `npm test` fails if any copy differs, and names the file and line.
- **Documentation split.**
  - The README now keeps only the pitch, a screenshot, the live link and a quick start.
  - The test instructions moved to `CONTRIBUTING.md`, with a table of every test suite and the release steps.
  - The feature details that were only in the README moved to `docs/MANUAL.md`.
- **Tests:** the new `tests/release-regression.mjs` (run by `npm test`) checks the release script on a copy of the repository and checks that every link in the README, CONTRIBUTING, CHANGELOG and the manual leads to an existing file and heading.

## v0.1.4 (2026-11-18)

- **Unexpected errors are shown.** A script error or an unhandled promise rejection now shows a message that stays until dismissed.
  - **Copy details** copies a report: message, place, version, browser and stack.
  - The figure stays editable, and a stuck "Saving…" overlay is closed. Nothing is printed to the console unless `?debug=1` is on.
- **Damaged files are refused clearly.** Instead of a decoder error, a bad TIFF gives a message saying why, and nothing is added to the figure:
  - "*name* is not a TIFF file";
  - "*name* is empty";
  - "*name* is damaged or incomplete: page 2 of 3 has 1234 of its 9437184 bytes of pixel data…".
  - Import errors use the same message with **Copy details**.
- **Memory warning.** Before decoding, FluoForge estimates the memory an image needs (width × height × planes × bytes per sample, plus one RGBA composite). If that is more than the browser seems to have left, it asks first. Declining imports nothing.
- **Browser storage.**
  - The project panel shows the storage used and available, next to the recovery status.
  - After the first recovery draft, FluoForge asks the browser to keep its data (`navigator.storage.persist()`).
  - A full IndexedDB gives a clear message and a one-time notice. Editing and saving to a file keep working, and drafts resume when space is back.
- **Tests:** the new `errors-storage-regression` suite covers the error handlers, five kinds of damaged TIFF, the memory warning, a full IndexedDB and the storage line.

## v0.1.3 (2026-11-18)

- **Projects are saved as `.fluoforge`.** It is the same zip format as before (`manifest.format` is `"FluoForge"`); only the file name changes. Older projects keep opening: `.mfcproj.zip`, `.mfcproj.json` and `.gz`.
- **Open project** in Chrome and Edge now also offers the older `.json` and `.gz` project files, not only `.mfcproj.zip`.
- **Tests:**
  - New fixture `tests/compat/v0.1.0-project.mfcproj.zip`, saved by FluoForge 0.1.0.
  - The new `compat-regression` suite opens it and the legacy `main-v0.22` project, saves each as `.fluoforge` (through the file picker and through the download fallback) and checks that they reopen identically.

## v0.1.2 (2026-11-18)

- **Image info.** A new **Image info** button in the Channels panel shows what was read from the selected image's file: format, dimensions, bit depth, channels with their display range and its source, Z slices, time frames and Z step, pixel size and its source, and the raw ImageJ header. It also explains when an ImageJ header does not match the number of pages.
- **Quiet import.** Importing an image no longer prints the TIFF metadata to the browser console. The detailed log is still available: open the app with `?debug=1`, or set `localStorage.fluoforgeDebug` to `1` (new `js/debug.js` logger).
- **Tests:** the new `image-info-regression` suite checks the quiet import, the debug switch and the dialog's content and keyboard behaviour.

### Development

- **Headless tests:** `npm test` runs every regression suite in Chromium and Firefox with Playwright. It also compares the SVG, TIFF and PDF exports of a reference figure (`tests/fixtures/reference.mfcproj.zip`) with stored references.
- **Test images:** they are generated in Node (`tests/generate-fixtures.mjs`), so the tests no longer need Python.
- **GitHub Actions:** the tests run on every push and pull request, and `main` deploys to GitHub Pages.
- **ES modules (P1-T3):**
  - The editor now loads from one module entry, `js/app.js`, which publishes the same `window.MFC` API as before.
  - `canvas-app.js` (3,375 lines) is split into 21 modules: `js/core/` (state, canvas events, history, pages, zoom, clipboard), `js/image/` (import, channels), `js/tools/` (crop, text, shape, path, inset, scale bar, tool switching), `js/layout/` (align, grid, snap) and `js/ui/` (layers, selection bar, locks). None is longer than 600 lines.
  - Each tool exports `activate`, `deactivate` and `refreshPanel`, which tool switching calls in the same order as before.
  - The app must be served over HTTP, as the README already says. Opening `index.html` directly from disk (`file://`) no longer works, because browsers do not load modules from `file://`.
- **New tests:**
  - `module-api-regression` checks that `MFC` keeps exactly its 121 names, that no global name appears or disappears, that no module is longer than 600 lines, and that every tool exports `activate`, `deactivate` and `refreshPanel`.
  - The reference check now also requires the SVG export to be byte-identical to `reference.svg`, after renumbering Fabric's clip-path ids.
- **No change to the app.**

## v0.1.1 (2026-11-18)

- **Works offline.**
  - Fabric.js, UTIF.js, jsPDF and JSZip now live in `assets/vendor/` with their licence files, instead of loading from cdnjs and jsDelivr.
  - `assets/vendor/VERSIONS.md` pins every vendored library by version, source URL and SHA-256.
- **No third-party requests.** A strict Content-Security-Policy `<meta>` tag lets the page load only its own files.
- **Legacy projects under the new policy.** Projects with images embedded as `data:` URLs (the v0.18-era format) are decoded directly instead of through `fetch()`, which the policy blocks. They open as before.
- **Fabric version corrected.** The copy loaded from cdnjs under the 5.3.0 path is Fabric 5.1.0, so the vendored file and the notices now say 5.1.0. The code itself is unchanged.

## v0.1.0 (2026-11-17)

### Licence

- FluoForge is now licensed under the **GNU Affero General Public License v3.0 only** (AGPL-3.0-only), replacing the MIT licence. `LICENSE` holds the official AGPL-3.0 text.
- A separate commercial licence is available from the copyright holder for organisations; see `COMMERCIAL-LICENSE.md` (draft).
- Every source file now starts with an `SPDX-License-Identifier: AGPL-3.0-only` header and a copyright line.
- `THIRD-PARTY-NOTICES.md` lists the bundled and CDN-loaded libraries and fonts, with their versions, licences and sources.
- Outside contributions need a signed Contributor License Agreement. See `CONTRIBUTING.md`, `CLA.md` (draft) and the pull request template.

### App

- Clicking the FluoForge name in the top bar opens an **About** dialog. It shows:
  - the version and copyright;
  - the licence;
  - a link to the source code of the running version;
  - links to the commercial licence and the third-party notices.
- The version restarts at 0.1.0 for the new repository.

## Before v0.1.0

FluoForge was developed in an earlier repository (versions up to v0.24) before the history was restarted at 0.1.0 on 2026-11-17; that history is not part of this repository. Projects saved by those versions keep opening:

- `.mfcproj.zip` projects (the v0.22 format), covered by `tests/compat/main-v0.22-project.mfcproj.zip`;
- `.mfcproj.json` and gzip projects from v0.18–v0.19, covered by the synthetic projects in `tests/v024-regression.js` and `tests/project-export-regression.js`.

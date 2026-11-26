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

1. In Node: checks that the version is the same everywhere (`npm run release -- --check`, see [Releasing](#releasing)) and runs the release script's own tests (`tests/release-regression.mjs`); then tests the project-format migrations, the fixture library and the format lock (`tests/migrations-regression.mjs`), the layout grid's model (`tests/grid-model-regression.mjs`), the panel letters' model (`tests/letters-model-regression.mjs`) and the journal presets file with print units (`tests/journal-presets-regression.mjs`), the templates' pure part (`tests/templates-model-regression.mjs`), rulers, guides and equal spacing (`tests/guides-model-regression.mjs`), annotation labels, stamps and the special-character palette (`tests/annotate-model-regression.mjs`), the planes (range and step, or a typed list) and shape of series montages (`tests/series-model-regression.mjs`), the calibration warnings (`tests/calibration-model-regression.mjs`), and vector panels' size, fonts, CSS scoping and id renaming (`tests/vector-model-regression.mjs`).
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

GitHub Actions runs `npm test` on every push and pull request (`.github/workflows/test.yml`), and deploys `main` to GitHub Pages (`.github/workflows/pages.yml`). That workflow has a `build` job, which uploads the site, and a `deploy` job: if a deployment fails, use **Re-run failed jobs** (it reruns only `deploy`) or start a new run with **Run workflow**, rather than **Re-run all jobs**, which would upload a second artifact into the same run.

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
| `arrowhead-regression` | Arrowhead size on the page at 0.25×, 0.4×, 1× and 3×, the 10 px minimum, uneven stretching, inside a scaled group, paths whose line scales (unchanged), 1× geometry unchanged; line ends pulled back inside the head along the path for all caps (straight, curved, short end segments, a node next to the tip); on curves, the head's base on the curve and the line's end inside the head (four shapes, three sizes, widths 6 and 10); the double-click that finishes a path adds no node; no pixel outside the head near the tip at widths 6 and 10; rendered pixels (nothing past the tip, head wider than the line); resizing with the W field; the SVG export's polygons and trimmed path. |
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
| `export-upgrades-regression` | The TIFF writer (Deflate, LZW, none; RGB and RGBA; read back by UTIF), the compressed TIFF and PNG exports against the rendered page, 600 dpi, transparency, page ranges and a PDF page subset (pdf.js), the report next to an export, the SVG file's physical page size, the Export dialog (with the resolution units dpi, ppi, dpc and ppc, and TIFF resolution tags per centimetre), and the panels zip (letters, merge at source resolution, grey channels, pixel size, README). |
| `copy-external-regression` | Copy for other software with a recording clipboard: SVG picture, PNG, both and SVG code for the page and for a selection (cropped, only its objects), resolution and transparency, the same rendering as Export; fallbacks without SVG on the clipboard, without clipboard access, with nothing selected and when the write is refused; the dialog, Ctrl+Shift+C, keyboard and themes. |
| `copy-entry-points-regression` | The Copy out button (title with the shortcut, disabled without a figure, starting with the page or the selection) and the right-click menu: on an image, on a shape, on the empty page 2 and on the pasteboard (browser menu); Shift+F10 and the Menu key; focus return; themes. |
| `letters-regression` | Panel letters (P3-T3): one click (Letters) on selected panels and on a grid, in reading order; the document style (case, bold, pt, corner, inside/outside, offset, colour) on every letter; letters follow a dragged panel and renumber after a drag, a grid swap, paste and delete; skip, own letter (panel field and editing the letter), deleting a letter, remove letters; undo; save and reopen; SVG export; titles, focus, themes. |
| `print-size-regression` | Journal presets and print sizes (P3-T4): the Create figure dialog lists the families of `presets/journals.json`, width presets fill the size in cm (height capped), the figure keeps its preset through save and reopen; the figure check uses the journal's text limits (none above when the journal states no maximum) and an older project keeps the defaults; size fields in mm and pt (typing sets the right px, exact read-back, steps), the px preference, a dpi change; fonts named by what they replace; titles and focus. |
| `page-units-regression` | The page size follows the unit (`js/ui/page-units.js`) in the Create a figure dialog and the Document Properties panel: cm → in → px → cm (21 × 29.7 cm, 8.27 × 11.69 in, 2480 × 3508 px at 300 DPI) without drift; creating or applying a converted size keeps the page's pixels; a typed number is converted from its unit; a journal preset's cm is followed; the pixel preview; an empty field and a missing DPI are left alone. |
| `templates-regression` | Templates and image replacement (P3-T6): Replace image keeps the panel's frame, letter, grid cell, scale bar and insets and swaps the source (undo, redo); dropping a file on a panel replaces it; the channel settings dialog (keep by name, the new file's, keyboard); a quick-figure row is replaced as a whole; Save as template keeps no image data; From template opens empty frames, which fill by drop (with their inset), are not exported and are listed by the figure check; the five built-in templates (split channels from one file, comparison group, time and Z strips with their labels, image with inset); the dialog and the Fill frame button. |
| `guides-regression` | Rulers, guides and smart snapping (P3-T7): rulers in the document unit and the Rulers button; guides made by dragging from a ruler, moved on the canvas and deleted onto a ruler (undo, redo, save and reopen, not exported); snapping to guides, the Snap button, the snap-to-guides and equal-spacing preferences; margin guides and the journal preset's column guides; the Guides dialog (add, move, delete by position, margin, columns, show guides, focus and Esc). |
| `annotate-regression` | Microscopy annotations (P3-T8): the frame interval read from ImageJ and its time unit; the Annotate tool (button, A key, titles); filled and open arrows, arrowhead, asterisk and marker stamps placed by a click, in SVG and PDF export; dashed ROI boxes and ellipses with numbered labels that follow them (delete, undo); channel, Z, time and inset magnification labels that follow their image, update with it (slice, frame, typed interval, channel name, inset size), keep an edited text, survive save and reopen, and go with their image; superscript and subscript (toggle, switch, SVG shift once, font size change); the special-character palette (insert at the caret, replace a range) and every palette character in PDF in all twelve Liberation faces. |
| `series-regression` | Series montages (P3-T9): the Series button and dialog (axes with their counts, range and step or specific planes typed as a list (P3-T9b), summary, errors, strip or grid, keyboard and focus); a time strip, a Z grid and a strip of typed frames in their order, each panel showing its plane from one source stored once, labelled with its time or Z position, fitted to the page, in one History step; linked crop, range, channel on/off and the shared axis, a frame of its own per panel; save and reopen; SVG, PDF and TIFF export; copy and paste; replace image and template frames keep each plane; refusals. |
| `calibration-regression` | Calibration fields (P3-T9a): Z step and frame interval next to the pixel size, for stacks only; warnings when a value differs from the file, "Use file value"; the Z and time labels follow; undo and redo; save and reopen; a file without values; several images; a series montage shares a typed value; Image info; no interval field in the Annotate panel. |
| `vector-regression` | Vector panels (P3-T10): SVG plots (matplotlib-like, svglite-like) imported at their size on paper and drawn on the canvas; SVG export of their own elements (ids renamed, CSS scoped, Liberation text, no image), PDF export kept vector (no image XObject, real text, drawn where the canvas draws it), PNG and TIFF; crop and uncrop, copy and paste, undo, save and reopen, letters, templates; refused SVGs; a PDF page rasterised and labelled (page dialog, size, figure check, a standard font, a broken PDF). |
| `grid-regression` | Layout grid (P3-T2): the Grid panel makes a persistent grid (mm, bands, labels); row labels turned 90° and centred, bands one gutter from the panels (a bordered label touches no panel), both options switched in the panel, a grid saved before them keeps its layout when opened and edited; real mouse drags swap panels, take one out, add a free image, move the grid (panels and labels follow) and resize it by its handle; width 85 mm with gutters kept; insert and delete rows, spans, fit and fill around the crop centre; labels return to their band; SVG, PDF, TIFF and PNG exports without the grid; save and load, undo, copy and paste, remove; `MFC.arrangeGrid` on a project without a grid; montage panels in a fill grid; titles, focus, themes. |
| `montage-regression` | Quick figure (P3-T1): a 4-channel image gives 5 linked panels (views of one source); cropping one crops all, the row is laid out again, uncrop, undo; the project stores the source once; save and reopen keep the links; a pasted copy is a montage of its own; range, gamma, LUT, invert and brightness reach every panel, a grey panel stays grey; grey, merge first, gap in mm, channel choice, two rows; headers named and coloured; refusals; the dialog (titles, errors, Tab, Esc, themes). |
| `crop-regression` | Crop tool Square mode on a non-square image: Square fits the shorter side inside the image; real mouse drags of the right, bottom, left and corner handles keep it square with the opposite side in place; typed sizes; Apply gives a square, also when the region overhangs the image; undo; Rectangle mode still free; Width field without the outline's extra pixel. |
| `legend-regression` | Channel legend tool: names and colours of the shown channels (LUT at max, grey and yellow fall back on black or white), width above the image or height turned 90° on its left side at its displayed size, long names shrink to one line, background black, white or transparent, border on and off, a plain text box (no legend fields, Text panel) whose edits the options never change, no image selected, undo, save and reopen, SVG and PDF exports, the L key, titles, focus, themes. |
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

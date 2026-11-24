# FluoForge project format

This document describes what a FluoForge project file contains, how the format is versioned, and the rule that keeps old projects opening: **a project saved by any released version since v0.1.0, or in one of the legacy formats from before the 0.1.0 reset, must open in every later version, look the same and export the same.**

The code is in `js/project.js` (reading and writing), `js/migrations/` (format changes) and `tests/compat/` (the fixtures that prove it).

## Contents

1. [The file](#1-the-file)
2. [manifest.json](#2-manifestjson)
3. [versions/: figure states](#3-versions-figure-states)
4. [Objects and their saved fields](#4-objects-and-their-saved-fields)
5. [sources/: original images](#5-sources-original-images)
6. [Format versions and migrations](#6-format-versions-and-migrations)
7. [Legacy formats](#7-legacy-formats)
8. [Projects from a newer version](#8-projects-from-a-newer-version)
9. [Format history](#9-format-history)
10. [Changing the format](#10-changing-the-format)
11. [The fixture library](#11-the-fixture-library)

## 1. The file

A project is a zip archive, stored without compression (the images inside are already compressed or raw), named `<project>.fluoforge`. Versions up to 0.1.2 named the same file `<project>.mfcproj.zip`.

```
manifest.json                 what the project contains (section 2)
versions/<version id>.json    one editable figure state per saved version (section 3)
sources/src-<sha256>.bin      one copy of every distinct original image, byte for byte (section 5)
```

Opening detects the content from its first bytes (zip, gzip or JSON), not from the file name, so every older name keeps working.

## 2. manifest.json

| Field | Meaning |
|---|---|
| `format` | Always `"FluoForge"`. |
| `version` | The container format: `3` since before 0.1.0. Versions 1 and 2 are the legacy formats (section 7). |
| `projectId` | A random UUID, kept across saves. Recovery drafts are filed under it. |
| `appVersion` | The FluoForge version that wrote the file, for information only (see section 8). |
| `savedAt` | Time of the save, in milliseconds since 1970. |
| `currentVersionId` | The version that opens by default. |
| `versions` | The saved versions, oldest first: `{ id, timestamp, updatedAt, name, parentVersionId, statePath }`. **Save Project** updates the current version; **Save As** adds a version whose `parentVersionId` is the version it started from. |
| `sources` | The original images: `{ id, path, name, type, format }`, where `format` is `"tiff"` or `"raster"` (PNG, JPEG, BMP). |

Any other field is kept unchanged when the project is saved again.

## 3. versions/: figure states

Each `versions/<id>.json` is one figure state. States hold no pixels: images refer to their source by id.

| Field | Meaning |
|---|---|
| `schema` | The state format (section 6). Currently `7`. |
| `documentOpen` | `false` only for an empty workspace. |
| `docProps` | The page: `name`, `width`, `height`, `unit` (`"px"`, `"cm"` or `"in"`), `dpi` and `pages` (missing in projects from before multi-page figures, which have one page). Optional `checkDismissals` (since 0.1.12): figure check findings dismissed in this project, each `{ key, rule, severity, objects, message, note }`; absent means none. Optional `preferences` (since 0.1.14): the project's own values of preferences (Preferences → This project only), `{ key: value }`, overriding the global ones; absent means none, and keys a version does not know are kept. |
| `nextId` | The counter for new object ids. |
| `objects` | The objects, back to front (section 4). |

The same state is used for undo history and browser recovery drafts.

## 4. Objects and their saved fields

Every object is Fabric.js 5.1 JSON (`Object.toObject`: `type`, `left`, `top`, `width`, `height`, `scaleX`, `scaleY`, `angle`, `skewX`, `skewY`, `flipX`, `flipY`, `originX`, `originY`, `opacity`, `visible`, `fill`, `stroke`, `strokeWidth`, `strokeDashArray`, `strokeUniform` and the rest of Fabric's standard properties) plus FluoForge's own fields, all named `mfc…`. Positions are in page pixels at the document DPI; pages sit one below the other. Every top-level object has an `mfcId` and an `mfcType`.

Fields used by every type:

| Field | Meaning |
|---|---|
| `mfcId` | Unique id; links (insets, scale bars) refer to it. |
| `mfcType` | The kind of object (below). |
| `mfcLocked` | Layer lock: cannot be selected, edited or deleted. |
| `mfcPositionLocked` | Position lock: cannot be moved, resized or rotated. |
| `clipPath` | An object used as a clipping path (crop to shape), saved the same way, with `inverted` and `absolutePositioned`. |

### Image: `type: "image"`, `mfcType: "mfcImage"`

| Field | Meaning |
|---|---|
| `sourceId` | The source in `sources/`. |
| `mfcFileName` | The original file name. |
| `width`, `height`, `cropX`, `cropY` | The visible region, in working pixels. |
| `workingScale` | Working pixels per source pixel (below 1 for images over 2048 px, which are previewed at reduced size). |
| `mfcRawWidth`, `mfcRawHeight` | The source size in pixels. |
| `display.channels[]` | Per channel: `enabled`, `color`, `min`, `max` (display range in raw values), `name`; since schema 2 `gamma` (display gamma, 0.1 to 5, default 1) and `invert` (inverted display, default false); since schema 3 `lut`. `color` is one of the 8 single colours (`grey`, `red`, `green`, `blue`, `cyan`, `magenta`, `yellow`, `orange`), since schema 3 also `viridis`, `cividis`, `magma`, `inferno`, `fire`, `grey-inverted`, or `file`. `lut` holds the 768 bytes (256 × R, G, B interleaved, base64) of a LUT read from the image file that matches none of the library; it is kept whichever `color` is shown, and used when `color` is `file`. |
| `display.brightness`, `display.contrast` | The tone curve on the composite (0 = none). |
| `display.alphaEnabled` | Keep PNG transparency. |
| `display.voxelSizeUm` | Pixel size in µm (null when unknown). |
| `display.zMode`, `zIndex`, `tIndex` | Stacks only: `"max"`, `"mean"` or `"slice"`, and the slice and frame shown. |
| `display.decoder` | Since schema 5, TIFF sources only: the TIFF decoder that made the channels, used again when the project opens. `1`: how every version up to 0.1.9 read a TIFF (no OME-XML; RGB pages give their first sample only; 16-bit samples read as unsigned; other bit depths read as 8- or 16-bit). `2` (0.1.10): OME-XML dimensions, names, colours and pixel size; RGB pages as three channels; float, signed and packed samples. `display.channels` lists the channels that decoder produces, so the two are never mixed. Missing means 1. |
| `filters` | Fabric image filters, when any. |
| `mfcIsInset`, `mfcInsetSourceId`, `mfcInsetContourId` | For an inset: it is a view of image `mfcInsetSourceId`, through outline `mfcInsetContourId`. |
| `mfcCompareGroup` | Since schema 4: the number of the comparison group the image belongs to (absent when none). The images of a group keep the same `min`, `max`, `color`, `lut` and `gamma` on each channel number; an edit to one is applied to all. A group may have diverged (after a paste); opening does not change it. |
| `mfcPreShapeCrop` | After **Crop to shape**: the frame before the crop, restored by **Remove shape crop**. |

### Inset outline: `type: "rect"`, `mfcType: "insetContour"`

| Field | Meaning |
|---|---|
| `mfcInsetSourceId`, `mfcInsetTargetId` | The image the outline is drawn on, and the inset it feeds. |
| `mfcCropX`, `mfcCropY`, `mfcCropW`, `mfcCropH` | The region, in source pixels. |
| `mfcRelX`, `mfcRelY`, `mfcRelW`, `mfcRelH` | The same region as fractions of the image (older form, still written). |

### Scale bar: `type: "group"`, `mfcType: "scalebar"`

| Field | Meaning |
|---|---|
| `mfcAttachedTo` | The image it measures. |
| `mfcLengthUm` | Length in µm. |
| `mfcCorner`, `mfcMarginPct` | Corner of the image (`"bottom-right"`, …) and margin in % of the image. |
| `objects` | The bar (`rect`) and its label (`text`), in group coordinates. |

### Text: `type: "textbox"`, `mfcType: "text"`

Fabric text fields (`text`, `styles` for per-character styling, `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `underline`, `textAlign`, `fill`, `backgroundColor`) and:

| Field | Meaning |
|---|---|
| `mfcBoxHeight` | The box height, independent of the text. |
| `mfcVAlign` | `"top"`, `"middle"` or `"bottom"` inside the box. |
| `mfcBorderWidth`, `mfcBorderColor` | The box border. |

### Shape: `type: "rect" | "ellipse" | "path"`, `mfcType: "shape"`

| Field | Meaning |
|---|---|
| `mfcShapeKind` | `"rect"`, `"ellipse"`, `"line"` or `"path"`. Projects from before editable paths say `"curve"` or `"polyline"`; they are converted to `"path"` when opened (`installPathControls`). |
| `path` | Fabric path commands (lines and paths). |
| `mfcPathNodes` | The editable nodes of a pen path: anchors with optional `handleIn`/`handleOut`. |
| `mfcPathClosed` | Closed path. |
| `mfcArrowStart`, `mfcArrowEnd` | Arrowheads. |

### Calibration bar: `type: "group"`, `mfcType: "calibrationBar"` (schema 3)

| Field | Meaning |
|---|---|
| `mfcCalImageId`, `mfcCalChannel` | The image and the channel (index) it shows. |
| `mfcCalWidth`, `mfcCalHeight`, `mfcCalFontSize`, `mfcCalGap`, `mfcCalColor`, `mfcCalStrokeWidth` | The bar's size, the labels' size and distance, and the colour of the frame and labels. |
| `objects` | The gradient (an `image`, 1 × 256 px, the max at the top), the frame (`rect`) and the max and min labels (`text`). They are rebuilt from the channel whenever its display changes; when the image is gone, the bar keeps its last state. |

### Split-channel montage (Quick figure, schema 6)

A montage is not an object of its own: its panels are images and its column headers are text boxes, linked by these fields.

| Field | On | Meaning |
|---|---|---|
| `mfcMontageGroup` | panels and headers | The montage's id (a string such as `"mtg12"`), shared by every panel of one row and the headers above it. |
| `mfcMontageChannel` | panels and headers | The channel number the panel shows (or the header names); `-1` for the merge. |
| `mfcMontageColumn` | panels and headers | The column, from 0 on the left. Cropping a panel lays the row out again by column. |
| `mfcMontageGrey` | panels | The channel panels show their channel in grey (their `color` is `grey`); a LUT change on another panel does not reach them. |
| `mfcMontageGap` | panels | The gap between panels, in page pixels. |

Every panel is an ordinary image with its own `display` (which channels are on, and their settings). The channel panels use the same source (`sourceId`) as the merge, so the source is stored once. While editing, range, LUT, gamma and invert of a channel, brightness and contrast, and the crop are kept equal on every panel of a montage; this is not checked when a project opens.

### Layout grid: `type: "rect"`, `mfcType: "layoutGrid"` (schema 7)

An invisible rectangle under its panels, as large as the grid. Exports leave it out; the editor draws its cells as dashed guides.

| Field | Meaning |
|---|---|
| `mfcGrid` | The grid, in mm: `rows`, `cols`, `cellW`, `cellH` (one cell), `gutter` (between cells), `margin` (around them), `colBand` (height of the column label band above the cells, 0: none), `rowBand` (width of the row label band on their left, 0: none), and `areas`. |
| `mfcGrid.areas[]` | `{ row, col, rowSpan, colSpan, panel, mode, base, last }`: the cells an area covers (from 0), the image it holds (`mfcId`, or null for an empty spanned area), `"fit"` or `"fill"`, and for fill the crop it starts from and the crop it last gave (`{ cropX, cropY, width, height }` in the image's preview pixels). Cells no area covers are empty. |

Its panels are ordinary images with `mfcGridId` (the grid's `mfcId`); the grid's `areas` decide which images are in it. Its labels are text boxes with `mfcGridId`, `mfcGridLabel` (`"col"` or `"row"`) and `mfcGridIndex` (the column or row, from 0). The grid's top-left corner is its position; panels and labels are placed from it whenever the grid changes.

### Group: `type: "group"`, `mfcType: "group"`

`objects` holds the children, saved the same way, in group coordinates. Children of a scale bar or a group may be plain Fabric objects without `mfcType`.

The page frames (`mfcIsPageBounds`), scale bar previews (`mfcIsPreview`) and pen helpers (`mfcIsPathHelper`, `mfcIsPathDraft`) only exist while editing and are not saved; `mfcGrabOffset` belongs to a drag in progress, not to an object.

## 5. sources/: original images

Every imported file is stored once, unchanged, as `sources/src-<sha256>.bin`, where `<sha256>` is the SHA-256 of its bytes. Opening a project checks every source against its name and refuses a damaged copy with a message naming the image. Images are never re-encoded: not when importing, saving, migrating, or converting a legacy project (whose embedded or archived image bytes become the source as they are).

## 6. Format versions and migrations

`state.schema` is the format version of a figure state. The container (`manifest.version`, section 2) has been `3` since before 0.1.0.

- **Every change to what a state means** (a new field that changes how something is drawn, a renamed field, a new object type) **bumps the schema and adds one migration** in `js/migrations/`, named `schema-<n>-to-<n+1>.js` and registered in `js/migrations/index.js`.
- **A migration is a pure function** on plain JSON: it takes a state of schema *n* and returns a new state of schema *n + 1*, without changing its input. It never touches Fabric, the page or the images, so it can be tested alone (`tests/migrations-regression.mjs`).
- **Opening runs the chain** from the file's schema up to the current one. So do restoring an older version from **Versions** and recovering a browser draft.
- **The first save of a migrated project keeps the original.** The version that was opened stays in `versions/` exactly as it was read, and the migrated figure is saved as a new version named "Updated by FluoForge x.y.z", whose parent is the original. The user can go back to it from **Versions**.
- **Migrations are never deleted or edited** once released. Deleting one makes `npm test` fail: the chain has a gap, and the fixtures that need it no longer open.

Schemas:

| Schema | Meaning |
|---|---|
| 0 | What the legacy loaders produce from a project in manifest version 1 or 2 (section 7). It is never written to a new file, except as the kept original of a converted legacy project. |
| 1 | The state format written from before 0.1.0 to 0.1.5. |
| 2 | 0.1.6: image channels also store `gamma` and `invert`. `schema-1-to-2.js` adds gamma 1 and invert false, which is how schema-1 figures were always drawn. |
| 3 | 0.1.7: the LUT library's names in `color`, a file's LUT in `lut`, and calibration bars. All additions, so `schema-2-to-3.js` only changes the number. |
| 4 | 0.1.9: images may carry `mfcCompareGroup` (comparison groups). An addition, so `schema-3-to-4.js` only changes the number. |
| 5 | 0.1.10: images record their TIFF decoder in `display.decoder`. `schema-4-to-5.js` sets `decoder: 1` on every image (also inside groups), which is how schema-4 figures were decoded, so they open exactly as before. |
| 6 | 0.1.25: split-channel montages (Quick figure): images and text boxes may carry the `mfcMontage…` fields (section 4). An addition, so `schema-5-to-6.js` only changes the number. |
| 7 | The current state format, since 0.1.26: the layout grid (section 4), a new object type, with `mfcGridId` on its panels and labels. An addition (the former one-shot grid saved no object), so `schema-6-to-7.js` only changes the number. |

## 7. Legacy formats

Projects saved by v0.18 and v0.19 (before the 0.1.0 reset) use **manifest version 2**: one JSON document holding `docProps`, `nextId` and `objects`, either as a plain `.mfcproj.json` file, gzip-compressed, or as `manifest.json` in a zip with the images in `images/`. Their objects carry the image data and settings directly: `fileBase64` (a `data:` URL) or `imageArchivePath`, `fileName`, `sourceFormat`, `channels`, `voxelSizeUm`, `brightness`, `contrast`, `alphaEnabled`; scale bars and groups keep their Fabric JSON in `fabricJSON`.

The legacy loader (`migrateLegacy` in `js/project.js`) stays forever. It stores each image as a source, rebuilds the objects as Fabric JSON and returns a schema-0 state; `schema-0-to-1.js` then recovers a v0.18 scale bar's length from its label and converts inset outlines given as fractions to source pixels.

v0.22 already wrote manifest version 3 with schema 1, the format FluoForge 0.1.0 kept.

## 8. Projects from a newer version

A project whose `manifest.version` or `schema` is higher than this version knows opens anyway:

- it loads every object it understands and shows "Saved by FluoForge v*x*; some content may not display";
- an object of a type it cannot draw is left off the canvas, and kept;
- when the project is saved, unknown manifest fields, unknown state and page fields, unknown fields on known objects, the objects it could not draw (in their place) and the higher format numbers are all written back unchanged. Undo, redo and recovery drafts keep them too;
- export refuses with a message naming the object rather than leave it out, because an export must reproduce the figure faithfully.

`appVersion` alone does not make a project "newer": versions from before the 0.1.0 reset were numbered 0.18 to 0.24, higher than today's 0.1.x, and any new kind of content bumps the schema anyway.

## 9. Format history

| Date | Version | Change |
|---|---|---|
| before 2026-11-17 | v0.18, v0.19 | Manifest version 2: JSON, gzip or zip with `images/` (section 7). Exact dates are in the history of the earlier repository, which is not part of this one. |
| before 2026-11-17 | by v0.22 | Manifest version 3 with `versions/`, `sources/` and states of schema 1. |
| 2026-11-17 | 0.1.0 | Repository restarted; format 3, schema 1 unchanged. Files named `.mfcproj.zip`. |
| 2026-11-18 | 0.1.3 | New projects are named `.fluoforge`. The content is unchanged. |
| 2026-11-21 | 0.1.14 | No schema change: `docProps` may hold `preferences`, the project's own preference values. Older versions open such a project unchanged and ignore them; their Document properties *Apply* drops them. |
| 2026-11-21 | 0.1.12 | No schema change: `docProps` may hold `checkDismissals`, an optional list of dismissed figure check findings with their notes. Older versions open such a project unchanged; their Document properties *Apply* drops the list. |
| 2026-11-20 | 0.1.10 | Schema 5: images record the TIFF decoder that made their channels (`display.decoder`, `schema-4-to-5.js`); new imports use decoder 2 (OME-TIFF, RGB, float, signed and packed samples). 0.1.5 to 0.1.9 open such a project with "some content may not display" and decode with their own reader: images that decoder 2 reads differently (RGB, OME-TIFF stacks, float, signed or packed samples) show only the settings of the channels that reader finds. |
| 2026-11-20 | 0.1.9 | Schema 4: images may carry `mfcCompareGroup`, the comparison group whose range, LUT and gamma they share (`schema-3-to-4.js`). 0.1.5 to 0.1.8 open such a project with "some content may not display" and show it unchanged, but do not link edits. |
| 2026-11-19 | 0.1.7 | Schema 3: channel colours may name any LUT of the library or `file`, with a file's own LUT kept in `lut`; new object type `calibrationBar` (`schema-2-to-3.js`). 0.1.5 and 0.1.6 open such a project with "some content may not display": a channel in a new LUT is shown in grey, and the bar keeps its last colours and labels. |
| 2026-11-19 | 0.1.6 | Schema 2: each image channel stores a display `gamma` and an `invert` flag (`schema-1-to-2.js`). 0.1.5 opens such a project with "some content may not display"; 0.1.0 to 0.1.4 do not check the schema and open it without a notice. All of them ignore gamma and invert. |
| 2026-11-18 | 0.1.5 | No change to what is written. Schema 0 is defined for the legacy loaders' output and migrated by `schema-0-to-1.js`; sources are checked against their SHA-256 when opened; the first save of a migrated project keeps its original version; projects from a newer format open and keep what they do not understand. |

## 10. Changing the format

A pull request that changes `serializeObject`, `restoreObject` or `captureState` in `js/project.js` must either add a migration or explain in its description why none is needed. `tests/compat/format-lock.json` holds a hash of each of these functions, and `npm test` fails when one changes until the lock is recorded again.

To change the format:

1. Bump `CURRENT_SCHEMA` in `js/migrations/index.js` and `SCHEMA` in `js/project.js`.
2. Add `js/migrations/schema-<n>-to-<n+1>.js`, register it in `js/migrations/index.js`, and test it alone in `tests/migrations-regression.mjs`.
3. Add a row to the history table above.
4. Run `node tests/migrations-regression.mjs --update-lock`.
5. Run `npm test`: every fixture must still open and export the same.

If the functions changed without a format change (a refactor, a bug fix that writes the same JSON), run step 4 only and say why in the pull request.

## 11. The fixture library

`tests/compat/` holds one folder per fixture, listed in `tests/compat/index.json`:

```
tests/compat/<name>/project.fluoforge (or .mfcproj.zip, .mfcproj.json, .mfcproj.json.gz)
tests/compat/<name>/expected.json     object count, types, positions, sizes, channel settings, text…
tests/compat/<name>/export.svg        the SVG export of page 1
```

- **Releases** (`v0.1.0`, `v0.1.1`, …): the reference figure (`tests/reference-figure.js`), built and saved **by that release**, with its `expected.json` and SVG export recorded by that release too. `npm run compat-fixture -- --ref=<tag or commit>` checks the release out into a temporary folder, runs it headless and writes the folder. v0.1.2 to v0.1.4 have no git tag; their fixtures were built from their release commits (`8830445`, `48f86e3`, `e4790e0`). v0.1.0 loaded its libraries from CDNs; its script tags are pointed at the vendored copies, which are byte-identical.
- **Legacy formats**: `legacy-v0.22` (saved by v0.22), `legacy-v0.18-zip` and the three `legacy-format2-*` files (the synthetic old-format projects of `tests/v024-regression.js` and `tests/project-export-regression.js`, written to files). No version of this repository saved them, so their `expected.json` and `export.svg` were recorded by 0.1.5 and checked against 0.1.4, which opened all five identically.
- **Each new release adds its own fixture before it ships**: after `npm run release -- <version>`, run `npm run compat-fixture -- --ref=worktree` and add the folder to `index.json`. `npm test` fails while a release in `CHANGELOG.md`, or the current version, has no fixture.

The `compat-regression` suite opens every fixture and checks that it matches its `expected.json`, that its SVG export matches `export.svg` (structurally, numbers within 0.02 px, embedded images by pixels), that saving copies its sources byte for byte, that a migrated project keeps its original version, and that the saved file reopens identically. It runs in `npm test`, so in CI on every push and pull request.

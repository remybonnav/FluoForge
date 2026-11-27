# Changelog

Each release lists what changed for users first, then development changes. New notes go under "Unreleased"; `npm run release -- <version>` dates them (see [CONTRIBUTING.md](CONTRIBUTING.md#releasing)).

## Unreleased

## v0.1.48 (2026-11-27)

- **Text boxes drawn to size, and text that snaps (PI-T6).** With the Text tool, drag a rectangle to make a text box of that size; its text wraps inside it and it keeps its size when you type. A click still inserts a text box as before. Resizing a text box (its width, its height, or its text with a corner handle) now snaps the moving edge to guides, page edges and other objects, as moving it does; the Text panel's new **Snap when resizing** option (on by default, also in Preferences ▸ Text) turns it off, and Alt resizes freely. A selected object's handle lying on a guide is now grabbed instead of the guide.

## v0.1.47 (2026-11-27)

- **Selecting only what is fully inside (PI-T4).** With the Select tool, hold **Ctrl** (**Cmd** on a Mac) while dragging a selection rectangle to select only the objects entirely inside it; the rectangle turns dashed while the key is held. A plain drag still selects every object it touches.

## v0.1.46 (2026-11-27)

- **Document Properties takes less room (PI-T3).** It folds to one line, its title and the page size (for example *1200×800 px · 300 dpi*), as soon as another Inspector panel is opened, receives the keyboard focus, or becomes active by selecting an object or choosing a tool. Its header or the **Document** button opens it again; its state is remembered like the other panels'.

## v0.1.45 (2026-11-27)

- **The Legend tool button only opens its panel (PI-T17).** Choosing **Legend** (`L`) no longer adds a legend to the selected image at once: it opens the Channel legend panel, and **Add legend to selected image** adds it (greyed out until an image is selected). No tool button adds anything by itself.

## v0.1.44 (2026-11-27)

- **The Channels panel fits its frame (PI-T2).** The min and max fields no longer run past the panel's right edge (they were 120 px wide, from a general panel rule), the sliders shrink to make room, the fields show values up to 8 characters (65535, -32768, -1234567) whole, Auto / Full range / Reset to file keep their labels on one line (the buttons go onto two rows in a narrow Inspector), and the histogram stays behind the sliders.

## v0.1.43 (2026-11-27)

- **The Inspector follows the selection (PI-T1).** Clicking straight from one object to another (an image, then another image, a vector panel or a text box) now shows the new object's name in the Inspector title at once; before, it kept the first image's name until the canvas was clicked to deselect.

## v0.1.42 (2026-11-27)

- **EPS plots as vector panels (P3-T10c).**
  - **Import Image** takes EPS files (`.eps`, `.epsf`, `.epsi`), as R, GraphPad Prism, matplotlib, gnuplot and cairo write them. FluoForge runs them with its own PostScript reader and they become vector panels, like SVG, PDF, EMF and WMF plots: vector in SVG and PDF export.
  - Lines, dashes, fills, clipping, curves, colours (grey, RGB, CMYK, indexed, spot), images and shadings are kept. Text in Helvetica, Times or Courier stays text in the Liberation face with the same widths, each word where the program places it; text in fonts the file embeds (Type 1, Type 3, TrueType) is drawn with their own outlines.
  - A file that uses something FluoForge cannot reproduce (composite fonts, unknown PostScript…) is not imported silently: a dialog lists it, to import anyway or cancel.
  - Repeating pattern fills, such as matplotlib's hatching, are now drawn as patterns in PDF and EPS plots (before, a PDF page with them was offered only as an image).
  - No new library: the PostScript and TrueType readers are FluoForge's own code.

## v0.1.41 (2026-11-27)

- **EMF and WMF plots as vector panels (P3-T10b).**
  - **Import Image** takes Windows metafiles: `.emf` and `.wmf` (and gzipped `.emz`, `.wmz`), as GraphPad Prism, Office and R's devEMF write them. They are converted to SVG and become vector panels, like SVG and PDF plots: vector in SVG and PDF export.
  - Lines, dashes, fills (solid and hatched), shapes, arcs, curves, clipping, transforms, bitmaps and text are kept; text stays text, each word where the file places it, and Symbol-font Greek becomes real Greek letters. EMF+ (GDI+) drawing is read too, so devEMF's default files work.
  - A file that uses something FluoForge cannot reproduce (colour-combining drawing modes, bitmap pattern fills…) is not imported silently: a dialog lists it, to import anyway or cancel.
  - No new library: the reader is FluoForge's own code.

## v0.1.40 (2026-11-27)

- **PDF pages as vector panels (P3-T10a).**
  - A PDF imported with **Import Image** is converted to SVG and becomes a vector panel, like an SVG plot: it stays vector in SVG and PDF export. Plots saved as PDF by R, Python or Prism no longer need to be exported again as SVG.
  - Lines, dashes, fills, transparency, clipping, curves, gradients, images inside the page (kept pixel for pixel) and rotated pages are kept. Text in Arial/Helvetica, Times or Courier stays text, in the Liberation font with the same widths; text in other fonts is drawn with the PDF's own glyph outlines, so it looks exactly the same.
  - The page dialog (for a PDF of several pages) asks how to import the page: **Vector** (the default) or **Image**, rasterised at the document's dpi as before.
  - A page that uses something a vector panel cannot reproduce faithfully (blend modes, soft masks, pattern fills, mesh gradients…) is not converted silently: a dialog lists what it uses and offers the labelled rasterised import instead.

## v0.1.39 (2026-11-26)

- **Vector panels from other tools (P3-T10).**
  - **Import Image** takes SVG plots from R, Python, Prism and other tools. A plot becomes a vector panel at its size on paper and stays vector in SVG and PDF export: its own paths and text, not a picture. It moves, resizes, rotates, crops, takes a panel letter and is saved in the project once, like an image.
  - Its text is set in the embedded Liberation fonts (Arial and other sans-serif fonts become Liberation Sans, Times Liberation Serif, Courier Liberation Mono), so the canvas and every export look the same; a message names the fonts replaced.
  - SVG files with scripts, event handlers, HTML content, animation or links to files outside them are refused with a message.
  - A PDF page can be imported as a fallback: it is rasterised at the document's dpi (a dialog asks which page) and labelled as rasterised in its name, a message and the figure check.
  - pdf.js 6.5.438 (Apache-2.0) is bundled for reading PDF pages; it is loaded only when a PDF is imported.

## v0.1.38 (2026-11-26)

- **Specific frames or slices in a series montage (P3-T9b).** The Series dialog's **Show** choice adds **Specific frames** (or **Specific slices**): type the planes as `1, 2, 5, 10` or `1, 5, 12-20`, and the panels follow your order. Mistakes are named ("Frame 130 is outside the series…") and turn **Create** off.

## v0.1.37 (2026-11-26)

- **Calibration fields with warnings (P3-T9a).**
  - The Channels panel has **Z step (µm)** for Z stacks and **Frame interval (s)** for time series, next to **Pixel size**. They start with the file's values; a typed value changes the Z and time labels, is saved with the project, and reaches every panel of a quick figure or series montage.
  - When the pixel size, Z step or frame interval is not the one in the file, a warning under the field gives the file's value, with **Use file value** to put it back.
  - The Annotate panel's **Frame interval** field is gone: the interval is set in the Channels panel only. Projects with an interval typed there keep it.
  - Image info lists the frame interval and where a typed Z step or interval came from; the figure report gives the Z step in use.

## v0.1.36 (2026-11-26)

- **Series montages (P3-T9).**
  - **Series** in the top bar turns a Z stack or time series into a strip or grid of linked panels: choose Z slices or time frames, the first and last plane and a step, a strip or a number of columns, and the gap. The dialog says how many panels and which planes before you create them.
  - Each panel is labelled with its time ("t = 1:30 min") or Z position ("z = 3.5 µm"), with the labels linked to the panel from P3-T8; they follow the panel and change with its plane.
  - The panels are views of one source, stored once. Crop, display range, LUT, gamma, invert, channel on/off, brightness and contrast are edited once for all of them, and so is the other axis (the Z display of a time series, the frame of a Z series). The montage fits the page and is one History step.
  - Replace image keeps each panel's plane; Save as template keeps each panel's place in the series.

## v0.1.35 (2026-11-26)

- **Microscopy annotations (P3-T8).**
  - Pen paths have **Open arrow** ends (a stroked chevron) besides filled ones.
  - The **Annotate** tool (`A`) works on the selected image: a click places a filled or open arrow pointing at the point, an arrowhead alone, an asterisk, or a dot, triangle or star marker, in the panel's colour (yellow by default) and size. A drag draws a dashed ROI box or ellipse with a numbered label ("ROI 1") that follows it. Marks and ROIs are linked to the image: they move with it and keep their place on it when it is resized.
  - Labels linked to an image: channel names in their colours, Z position in µm (or the projection's depth), time stamp (the frame interval read from ImageJ `finterval` or OME `TimeIncrement`, or typed once) and the magnification of an inset. They follow the image, update when the slice, frame, channel names or inset size change, keep an edited text, and go with their image.
  - The Text panel has **Superscript** and **Subscript** toggles and a **Special characters** palette (µ, °, ±, Greek letters, arrows…); every palette character is embedded in PDF in all twelve Liberation faces.
  - SVG, PDF and TIFF exports put a superscript or subscript at the same height: the SVG no longer carries a second, `baseline-shift` copy of the shift, which Chromium added to the first.
  - Changing a text box's font size keeps its superscripts and subscripts in proportion instead of resetting their size.

## v0.1.34 (2026-11-25)

- **Rulers, guides and smart snapping (P3-T7).**
  - Rulers along the canvas, in the document unit (cm, in or px), counting from each page's corner and shading the selection. The **Rulers** button shows or hides them.
  - Drag from a ruler to make a guide, drag a guide to move it, drag it onto a ruler to delete it. **Guides…** does the same by typing positions (the keyboard path).
  - Margin guides (mm), and column guides at the journal preset's column widths.
  - Objects snap to guides and to equal spacing (the same gap as two other objects, or centred between neighbours), with markers on the equal gaps. The **Snap** button turns snapping on and off.
  - Guides are saved with the project (`docProps.guides`, `docProps.layoutGuides`), follow undo, and are never exported.

### Development
- The P3-T6 test that empty frames are not exported now checks the SVG text: `buildSVG` returns an object, so the old check could not fail.

## v0.1.33 (2026-11-25)

- **Templates and image replacement (P3-T6).**
  - **Replace image…** in the selection bar, or dropping a file onto an image, swaps the image and keeps the panel: its place and size, letter, labels, grid cell, scale bar and insets. The new file is cropped from its centre to fill the frame. Inset outlines stay where they are and their insets show the new image. Scale bars are recalibrated, with a warning when the new file has no pixel size. A quick-figure row is replaced as a whole.
  - When the new file's channels have the same names as the old ones, a dialog offers to keep their settings.
  - **Save as template** saves a figure's layout, styles and labels as a `.fftemplate.json` file, every image an empty frame and no image data. **From template** opens one, or one of five built-in templates (single image with inset, split channels, 2 × 3 comparison, time series strip, Z series strip), with empty frames to drop files into.
  - Frames of a split-channel or series template fill together from one file, each with its channel, time point or Z slice. An inset frame fills from its outline.
  - Empty frames are not exported, and the figure check lists them.

## v0.1.32 (2026-11-24)

- **The page size follows the unit.** In **Create figure** and **Document Properties**, choosing another unit converts the width and height: 21 × 29.7 cm become 8.27 × 11.69 inches, or 2480 × 3508 pixels at 300 DPI. Before, the numbers stayed the same and the page changed size. The fields show two decimals but keep the exact size, so switching back gives the same numbers and applying keeps the page's pixels.

### Development
- **Pages workflow in two jobs.** `.github/workflows/pages.yml` now has a `build` job that uploads the site and a `deploy` job that publishes it. When only the deployment fails, **Re-run failed jobs** reruns just `deploy` with the artifact already uploaded, so a run no longer collects several `github-pages` artifacts. `release-regression` checks the split.

## v0.1.31 (2026-11-24)

- **Journal presets and print sizes (P3-T4).** **Create figure** offers a journal and one of its figure widths (single column, 1.5 column, double column, full page; or generic 85, 114 and 174 mm) and fills the page size in. The journals are Nature, Science, the Cell Press journals (Cell, Cancer Cell, Molecular Cell, Cell Metabolism and the others, which share one set of figure guidelines), PNAS, the Journal of Clinical Investigation, PLOS ONE and the Journal of Cell Biology, with only the values their current author guidelines state, each with its source and the date it was read. The figure check then uses the journal's text limits, and says which limits it uses. Size fields now show print units: positions and sizes in mm in the selection bar; stroke and outline widths, scale bar thickness, text border and font sizes in pt. **Preferences → Units → Size units** keeps document px. The bundled fonts are named by what they replace, for example "Liberation Sans (Arial metrics)".

### Development

- New `presets/journals.json` (format 1: families with widths in mm, optional height, text and dpi limits, formats, `source` and `checked`), `js/core/journal-presets.js` (checks, preset, page, limits; pure) and `js/ui/journal-choice.js` (the dialog's choices, loaded by `js/main.js` on demand); `docProps.journalPreset` (optional, no schema change); `activePreset()` in `js/ui/figure-check.js` reads it. New `js/core/units.js` (pure px ↔ mm/pt) and `js/ui/size-units.js` (each size field's `value` converts between the px the code uses and the unit shown; refreshed on a dpi change from `applyDocProps`); the `units.size` preference. The text panel keeps font sizes to 0.01 px instead of whole px. `fontLabel` in `js/core/preferences.js`. The Pages workflow publishes `presets/`. New `journal-presets-regression` (Node) and `print-size-regression` (browser) suites; `preferences-regression` expects the Units section.

## v0.1.30 (2026-11-24)

- **A handle to select the grid.** Clicking on a layout grid usually picked one of its panels or labels. Each grid now has a small blue **Grid** tab above its top-left corner: a click selects the grid itself, even when something lies over the tab, and a drag moves it with its panels and labels. The tab keeps its size at any zoom and is never exported. With a panel or label of a grid selected, **Select grid** in the Grid panel selects the grid too (also from the keyboard).

### Development

- `js/layout/grid.js`: the handle is drawn with the grid's guides (`gridHandleBox`, `gridAtHandle`); the canvas's `findTarget` is wrapped once so a handle finds its grid with the Select tool, after the selected object's controls. `grid-select` button in the Grid panel. Tests in `grid-regression` (real clicks and drags on the tab, zoom, other tools, Select grid, SVG export). No format change. New MANUAL screenshot of the grid, with its tab.

## v0.1.29 (2026-11-24)

- **Panel letters (P3-T3).** Select panels (or a grid) and click **Letters**: they are lettered A, B, C in reading order. The style is set once for the whole document in the Panel letters panel: upper or lower case, bold, size in pt, corner, inside or outside the panel, offset in mm and colour. Letters stay on their panel when it moves, and renumber themselves when panels are reordered, added, pasted or deleted. A panel can be skipped or given its own letter (in the panel, or by editing the letter).

### Development

- New `js/layout/letters-model.js` (pure: letter sequence, reading order by vertical overlap, skip and own text, placement), `js/layout/letters.js` (letters as text boxes with `mfcLetterFor`, panels with `mfcLetter`, style in `docProps.letterStyle`; renumbered before every History step through the new `onBeforeHistoryStep` hook in `js/core/history.js`; follow their panel through `syncAttachments`) and `js/layout/letters-panel.js`. Hooks in `canvas-events.js`, `clipboard.js` (pasted letters re-linked or unlinked). Schema 9 (`schema-8-to-9.js`, number only); format lock recorded again (format functions unchanged). New `letters-model-regression` (Node) and `letters-regression` (browser) suites; `migrations-regression` checks 8→9.

## v0.1.28 (2026-11-24)

- **Grid labels: row labels turned 90°, and a gutter between the labels and the panels.** Row labels of a layout grid now read from bottom to top along their row, centred in a band one line wide. The column and row label bands are one gutter away from the panels, so a label with a border or a background no longer touches the images. The Grid panel can switch both off or on for the selected grid. Grids made with 0.1.26 or 0.1.27 keep their layout (labels flat, no gap) until you tick the options.

### Development

- `js/layout/grid-model.js`: `labelGap` and `rowLabelTurn` in the grid (`colBandGap`, `rowBandGap`, `setLabels`; sizes, cells and resizing count the gap). `js/layout/grid.js`: turned row labels (−90°, centred), `setGridLabels`; `MFC.arrangeGrid` keeps the former layout. Grid panel checkboxes. Schema 8 (`schema-7-to-8.js` writes `labelGap: false` and `rowLabelTurn: false` into existing grids); format lock recorded again (format functions unchanged). Tests in `grid-model-regression`, `grid-regression` and `migrations-regression`. New MANUAL screenshot.

## v0.1.27 (2026-11-24)

- **Pasted Quick-figure panels are a separate montage.** Copying and pasting panels of a quick figure (also with Duplicate, or with a grid holding them) left the copies linked to the original panels: a crop or a display change on one changed both. The copies now form a montage of their own, linked to each other only.

### Development

- `js/core/clipboard.js`: `pasteSelection` gives pasted objects one new `mfcMontageGroup` per original montage (panels and headers). `montage-regression` checks it (copy of a whole montage, range and crop edits both ways, a single pasted panel).

## v0.1.26 (2026-11-24)

- **The Grid is now a real layout grid (P3-T2).** **Make grid** puts the selected images in a grid that stays on the page: rows, columns, gutters and margins in mm, and optional bands for column and row labels that belong to the grid. Drag a panel onto another cell to swap them (onto an empty cell to move it, out of the grid to take it out); drag the grid to move everything. Insert or delete rows and columns, let a cell span the empty cell next to it, and choose per panel whether it fits its cell or fills it (cropped around its centre). Typing a width in mm (or dragging the grid's side handle) rescales the panels and keeps the gutters. The grid survives saving, undo, copy and paste; exports show its panels and labels, not the grid. The previous one-shot arrangement and its placeholder "Label" boxes are gone; projects arranged with it open as before.

### Development

- New `js/layout/grid-model.js` (pure: sizes in mm, cells, labels, place/drop/swap, insert/delete rows and columns, spans, fit/fill, resize to a width), `js/layout/grid.js` (the `layoutGrid` object: layout, drag handling, guides, labels, copy and paste) and `js/layout/grid-panel.js` (the Grid panel). Wired in `canvas-events.js` (modified, moving, scaling, added, removed), `crop.js` and `selection-bar.js` (a cropped panel stays in its cell), `clipboard.js` (a grid is copied with its members; pasted links are remapped), `export.js` (the grid object is not exported), `figure-check.js`, `layers.js`, `history.js`. `MFC.arrangeGrid` keeps its signature and placement and now makes a grid.
- Project format: schema 7 (`schema-6-to-7.js`, number only) for the `layoutGrid` object and the `mfcGrid…` fields; format lock recorded again (the format functions are unchanged). New `grid-model-regression` (Node) and `grid-regression` (browser) suites; `migrations-regression` checks 6→7.

## v0.1.25 (2026-11-23)

- **Quick figure: split-channel montages in one click (P3-T1).** Select one or more images and click **Quick figure**: each image becomes a row of panels, one per channel plus the merge, with column headers naming each channel in its colour. Options: channels in colour or grey, merge first or last, the gap in mm, and which channels to include. The panels are linked views of one image, stored once in the project: a change to a channel's range, LUT, gamma or invert, to brightness or contrast, or to the crop on one panel applies to the whole row.

### Development

- New `js/image/montage.js` (`quickFigure`, `cropMontageLike`) and `js/ui/quick-figure-dialog.js`. Channel panels are built like insets (own registry entry, shared pixel arrays and `sourceId`). `js/image/comparison.js` links montage panels (`montageOf`, `montageMembers`, `withMontageMembers`; `propagate` and `withGroupMembers` reach them, a grey panel keeps grey; comparison groups still link only range, LUT and gamma). `js/image/channels.js` passes invert and brightness/contrast to the montage; `applyCrop` and `uncropImage` crop the whole row.
- Project format: schema 6 (`schema-5-to-6.js`, number only) for the `mfcMontage…` fields; format lock recorded again (the format functions are unchanged). New `montage-regression` suite; `migrations-regression` checks 5→6; `file-formats-regression` accepts schema 5 or later for the decoder check.

## v0.1.24 (2026-11-23)

- **Square crops stay square.** In the Crop tool's Square mode, resizing the region on a non-square image made it spring back to the image's rectangle. It now stays square: a side handle sets both sides, a corner resizes from the opposite corner. Square now starts from the image's shorter side, so the square fits inside the image, and a square that reaches past the image's edge is applied as a square of the part that fits instead of being cut to a rectangle.
- The crop region's Width and Height no longer count its 1 px outline (a 480 px wide image showed 481, and Apply cropped one pixel more than asked).

### Development

- `js/tools/crop.js`: `setCropSquare` and `keepCropSquare` size the square by the region's box (a different scale per axis, since the region's own width and height are the image's), keeping the side opposite the dragged handle in place; used by the `object:scaling` handler in `js/core/canvas-events.js`. The region is measured as `width × scaleX` (no outline). `applyCrop` keeps a square in Square mode. New `crop-regression` suite with real mouse drags of the handles.

## v0.1.23 (2026-11-23)

- **Channel legend tool.** Select an image and choose **Legend** (`L`): a text box lists its shown channels, each name in its channel's colour ("FLAG" in green, "WGA" in red). It is as wide as the image is displayed, right above it, or as long as it is tall, turned 90° on its left side. The Channel legend panel sets up the next legend: background (black, white or transparent), border (on by default, black) and which side of the image sizes the box. The result is an ordinary text box, not linked to the image: rename channels or change its look with the Text panel, and the legend options never overwrite those edits.

### Development

- New `js/tools/legend.js` (`addChannelLegend`, `setLegendOption`, `legendColor`, `legendEntries`; the tool interface `activate`, `deactivate`, `refreshPanel`), wired in `tool-switch.js`, `locks.js` (images stay selectable with the tool), `selection-bar.js`, `app.js` and `main.js` (panel, `L`). A legend is a plain text box (`mfcType: "text"`, no extra fields), so the saved format is unchanged. New `legend-regression` suite; `module-api-regression` checks the new tool's interface.

## v0.1.22 (2026-11-23)

- **SVG exports open at the right size in Inkscape and Illustrator.** The SVG gave its page size in pixels without a unit, which these programs read as 96 pixels per inch. A figure at 300 dpi opened about 3 times too large, and one at 600 dpi 6.25 times too large, so a PDF saved from Inkscape had a huge page with low-resolution images. The SVG now states the page's real size (for example 210 mm × 297 mm for A4); everything inside is unchanged. TIFF, PNG and PDF exports are unchanged.

### Development

- `js/export.js`: new `svgWithPhysicalSize` (exported on `MFC_EXPORT`) writes the root `width` and `height` in mm (or the document's cm or in) and keeps the `viewBox` in document pixels; `exportWith` applies it to SVG files only. `buildSVG`, rasterising, the PDF, Copy out and the stored reference SVGs are unchanged. `export-upgrades-regression` checks the exported file's size, that nothing else in it changes, how a browser sizes it, the units, and the refusal of an SVG without a viewBox.

## v0.1.21 (2026-11-23)

- **Export resolution in dpi, ppi, dpc or ppc.** The Export… dialog has a unit list next to the resolution: dots or pixels per inch, or per centimetre. Changing the unit converts the value (300 dpi is 118.11 ppc), and the limits and messages use the chosen unit. A TIFF exported per centimetre stores its resolution in pixels per centimetre; a PNG stores pixels per metre as before. The dialog remembers the unit.

### Development

- `js/ui/export-dialog.js`: `RESOLUTION_UNITS`, `dpiInUnit`; `readExportOptions` returns `dpi` (still pixels per inch) and `resolutionUnit` (`'inch'` or `'cm'`). `MFC_EXPORT.exportWith` and `buildTIFF` take `resolutionUnit`; `encodeTIFF` takes `unit: 'inch' | 'cm'` (ResolutionUnit 2 or 3). `export-upgrades-regression` checks the units, conversion, limits, the TIFF tags per centimetre, the PNG pHYs and the remembered unit.

## v0.1.20 (2026-11-23)

- **Arrowheads on curves follow the line.** On a curved arrow the head used to follow the direction of the curve at the very tip. On small or tightly bent arrows it then pointed away from the line, and could even look detached from it. The head now follows the line drawn under it: the middle of its base sits on the curve. Straight arrows are unchanged. Arrows drawn with earlier versions are fixed too, without changing the saved project.

### Development

- New `js/tools/path-arrows.js` holds the arrowhead geometry (`pathArrowGeometry`, `pathStrokeCommands`, re-exported by `js/tools/path.js`, which had grown past 600 lines). The head is aimed from the point of the path one head length (straight distance) before the tip; the line is cut where it comes within 3/4 of the head length of the tip (straight distance), at most half the path from each end. `arrowhead-regression` checks four curve shapes at three sizes and widths 6 and 10: the head's base on the curve, the line's end inside the head.

## v0.1.19 (2026-11-23)

- **Arrow lines no longer run through their arrowhead.** The line now stops inside the arrowhead, near its base, instead of running up to the tip. Before, the line showed through the head, and a round or square line cap bulged out of the narrow tip. This applies on screen and in every export, for all line caps. Arrows drawn with earlier versions are fixed too, without changing the saved project.
- **Finishing a path with a double-click no longer adds a node.** The double-click also inserted a node just before the end of the new path and opened node editing. That hidden node kept the line running into the tip of the arrowhead.

### Development

- `js/tools/path.js`: `pathStrokeCommands` shortens the line along the path by 3/4 of the arrowhead length (at most half the path), for all caps, dropping or splitting short end segments, instead of moving the end node back by half a line width for round and square caps. The double-click that finishes a path is no longer handled again as a node-inserting double-click (`takePathFinishDoubleClick`, used by `js/core/canvas-events.js`). `arrowhead-regression` checks the new ends, nodes next to a tip, the double-click finish, and that no pixel shows outside the head near the tip at widths 6 and 10.

## v0.1.18 (2026-11-21)

- **Arrowheads fixed when a path is resized.** Arrowheads shrank or grew with the path while its line kept its width, so a smaller arrow got a head thinner than its line, which seemed to grow out of the tip. They now keep their size on the page (4 × the line width, at least 10 px) at any size, when stretched unevenly and inside resized groups, on screen and in exports. With round or square caps, the line no longer sticks out past the tip. Arrows at their original size are unchanged.

### Development

- `js/tools/path.js`: `pathArrowGeometry` sizes arrowheads in page units for `strokeUniform` paths; new `pathStrokeCommands` pulls capped arrow ends back by half the line width (used when drawing, in the path's SVG, and by `js/export.js` for baked uniform strokes). New `arrowhead-regression` suite.

## v0.1.17 (2026-11-21)

- **Copy out button and right-click menu.** Copy for other software has its own button in the top bar (next to Export) and an item in the right-click menu: on an image after its display settings, on any other object (it is selected and copied), and on an empty part of a page (that page is copied). The menu also opens with the Menu key or Shift+F10. The pasteboard keeps the browser's own menu.

### Development

- `openImageMenu(x, y, copy)` builds the canvas menu for images, other objects and the page; `showCopyDialog({ scope, page })` takes what to start with. New `copy-entry-points-regression` suite; `histogram-display-regression` expects the new menu item.

## v0.1.16 (2026-11-21)

- **Copy for other software** (Export ▸ Copy for other software…, Ctrl+Shift+C): copies the page or the selection (cropped to it) to the clipboard as an SVG picture, a PNG at the chosen resolution, both, or SVG code, to paste into PowerPoint, Word, Keynote, Inkscape, Illustrator or Figma. Rendered from the source data like an export. Browsers without SVG on the clipboard (Firefox) copy the SVG code or the PNG instead and say so.

### Development

- `js/ui/copy-external.js` (`copyFigure`, `showCopyDialog`); `MFC_EXPORT.buildSVG` and `buildPNG` take `bounds` and `only` to draw a selection cropped to its box (page exports unchanged). New `copy-external-regression` suite (the clipboard is replaced by a recorder); the export menu assertion of `export-upgrades-regression` includes the new item.

## v0.1.15 (2026-11-21)

- **Export dialog** (Export ▸ Export…): format, pages (all, current or a range such as `1-3, 5`), resolution for TIFF and PNG, transparent background, TIFF compression and the figure report, with the figure check summary.
- **PNG export**, with its DPI in the file.
- **Compressed TIFF.** TIFF exports are now losslessly compressed (Deflate by default, or LZW), several times smaller, with the same pixels and resolution tags.
- **Export panels (zip)**: each image panel at source resolution as displayed, and each shown channel in grey, named from the panel letter and channel name, with the figure report and a README.

### Development

- `js/image/raster-encoders.js`: `encodeTIFF` (Deflate with pako, or LZW; horizontal predictor; RGB or RGBA), `pngWithPhys`, `readPhys`. `MFC_EXPORT` gains `buildPNG`, `parsePageRange`, `exportWith`, and `scale` and `transparent` options (the default SVG is unchanged). New `export-upgrades-regression` suite; the figure check's menu assertion follows the new menu.

## v0.1.14 (2026-11-21)

- **Snapping fixed.** A dragged object now lands exactly on the edges and centre lines of the page and of the other objects. It used to measure the object where the drag started, so it stopped a few pixels off or did not snap at all. A dashed guide shows the edge it snapped to (on screen only); Alt still moves freely; hidden objects are no longer targets.
- **Preferences** (top bar, or Ctrl+,): a window above the canvas and the panels. Snapping: on or off, to the page, to other objects, which edges (left, centre, right, top, middle, bottom), distance and guides. Text: default font, size and colour of new text boxes. Each preference is global (saved in this browser) unless *This project only* is ticked, which gives the open project its own value, saved with it and undoable.

### Development

- `js/core/preferences.js`: a registry of preferences (one entry each: key, section, label, type, default, limits, help), checked values, project value > global value > default, change events, unknown keys kept. The dialog (`js/ui/preferences-dialog.js`) builds its rows from it. Project values are an optional `docProps.preferences` (no schema change). `js/layout/snap.js`: pure `computeSnap`, live bounding boxes, guides drawn in `after:render`. New suites `snapping-regression` and `preferences-regression`.

## v0.1.13 (2026-11-21)

- **Colour-vision and grey-scale preview.** **Vision** in the top bar shows the canvas as seen with deuteranopia, protanopia or tritanopia, or in grey-scale. It is view only: the figure, the project, undo and exports do not change, and a badge over the canvas says when a preview is on.

### Development

- `js/ui/vision-preview.js` puts an SVG `feColorMatrix` filter (in `index.html`: Machado et al. 2009 at full severity, Rec. 709 luminance for grey-scale, in linear RGB) on `#canvas-scroll`. The new `vision-preview-regression` suite checks the filters by rendering colours through them, and that state, history, canvas pixels and the SVG export are unchanged.

## v0.1.12 (2026-11-21)

- **Check figure.** A new Inspector panel reviews the figure: missing scale bars and pixel sizes, red and green in one panel, panels without a label, comparison groups that diverged (error), channels with more than 1 % of pixels clipped, gamma, brightness or contrast to report, panels enlarged or below 300 dpi, text outside 5–8 pt at print size, inset outlines hidden or deleted, and objects on the pasteboard. The Export menu shows the same summary with a Review button, without blocking anything. Click a finding to select its object; dismiss one with a note, which is saved with the project and listed in the figure report.

### Development

- Each rule is a pure function in `js/image/figure-check-rules.js` over a plain context built by `js/ui/figure-check.js`. Dismissals are an optional `docProps.checkDismissals` (no schema change). `figure-report.js` exports `panelGeometry` (shared with the check) and adds `checkDismissals` to the report when there are any. The new `figure-check-regression` suite tests every rule and the panel.

## v0.1.11 (2026-11-20)

- **Figure report (Methods and adjustments).** *Export ▸ Figure report…* lists every image panel: source file name and SHA-256, dimensions, bit depth and pixel size; crop in source pixels and shape mask; Z projection, slice and frame; each channel's LUT, display range, gamma and invert; brightness and contrast; printed size and effective resolution at the document DPI. Copy the ready-made Methods paragraph, or download the report as Markdown, CSV or JSON. SVG exports embed the report of their page in `<metadata>`, PDF exports the whole report in their *Subject* property.
- The download link to the Fiji macro in import errors now works on the published site: the Pages workflow did not publish `tools/`.

### Development

- `js/ui/figure-report.js` (`window.MFC_REPORT`: `buildReport`, `toJSON`, `toMarkdown`, `toCSV`, `methodsParagraph`, `toEmbeddedJSON`). The new `figure-report-regression` suite compares the reference project's report with `tests/fixtures/reference-report.json`, `.md` and `.csv`; `node tests/run-headless.mjs --make-report` rewrites them. The reference and compat SVG comparisons leave the embedded report out (stored exports predate it).
- `release-regression` checks that the Pages workflow publishes the files the app links to.

## v0.1.10 (2026-11-20)

- **More TIFF types.** 32-bit float and signed 16-bit images open with their exact values (negative ones included), and the compositor maps them through min, max and gamma as other images. Packed 12-bit (and 1- to 15-bit) files are unpacked and report their real bit depth. RGB TIFFs (8- or 16-bit, interleaved or planar) give three channels, Red, Green and Blue, instead of only the first sample.
- **OME-TIFF.** The OME-XML of a `.ome.tif` file gives the channels, Z slices and time frames (in any dimension order), the pixel size with its unit, the Z step, channel names and colours, and the bit depth it states. Image info says where the dimensions came from.
- **Fiji macro for microscope formats.** `tools/Export_for_FluoForge.ijm` converts a folder of CZI, LIF, ND2 (or any Bio-Formats) files to OME-TIFF with their metadata. Importing a CZI, LIF or ND2 file, a BigTIFF or an unsupported sample type now says so and links to the macro.
- ImageJ hyperstacks take a channel's name from its slice labels when they are all the same.
- **Project format 5.** Each image records which TIFF reader made its channels. Projects saved by earlier versions keep the previous reader, so they open exactly as before (an RGB TIFF in an old project stays one channel).

### Development

- `js/tiff.js`: `parseOmeXml`, `pageLayout` (OME-XML, then the ImageJ header, then one channel per page), `pageSamples` (sample formats, packed bits, RGB), `decodePage` (planar files, which UTIF lays out wrongly). Only the pages an image uses are decoded. `composite-core.js`: `floatLevels` for float planes; float averages and mean projections are no longer rounded. `MFC_ERRORS.report` takes an optional `link`.
- Schema 5 with `schema-4-to-5.js` (marks every existing image `display.decoder: 1`); `MFC_TIFF.decodeFile(file, { decoder: 1 })` reproduces the reader of 0.1.9 for old projects. Format lock recorded again for schema 5 (`serializeObject` and `restoreObject` changed).
- **geotiff.js evaluated, not adopted**: see [docs/GEOTIFF-EVALUATION.md](docs/GEOTIFF-EVALUATION.md). UTIF stays for reading and writing.
- **Tests:** the new `file-formats-regression` suite and the fixtures in `tests/fixtures/formats/`, with the scripts that made them; `migrations-regression` tests `schema-4-to-5.js`; the comparison suite's schema check accepts schema 4 or later.

## v0.1.9 (2026-11-20)

- **Comparison groups.** Select images (control and treated, for example) and click **Link** in the selection bar: their channel range, LUT and gamma become linked, channel by number, so changing one image changes all of them, in one undo step. The Layers panel shows a chain icon on each member, and a ⚠ badge when the settings have diverged (after pasting display settings onto one of them); clicking it matches the group again. **Unlink** takes images out. Groups are saved with the project.
- **Project format 4.** Projects store which comparison group each image belongs to; older projects open unchanged.

### Development

- `js/image/comparison.js`: groups (`mfcCompareGroup` on images), linked edits (`propagate`), divergence and matching. Schema 4 with `schema-3-to-4.js` (number only); format lock recorded again for schema 4 (the locked functions did not change).
- **Tests:** the new `comparison-regression` suite; `migrations-regression` tests `schema-3-to-4.js`.

## v0.1.8 (2026-11-19)

- **Histogram behind the min and max sliders.** Each channel shows the histogram of the plane on screen, on a log scale, with the display range shaded. It is computed in the background.
- **Auto, Full range and Reset to file.** Three buttons under each channel's sliders. **Auto** sets the range as ImageJ's Auto and Enhance Contrast (saturated 0.35 %) do, and gives the same values. **Full range** shows the whole range of the data. **Reset to file** goes back to the range stored in the file. Each is one undo step and works on several selected images.
- **Sliders follow the data.** For 16-bit files they cover the bits the data uses (0 to 4095 for 12-bit camera images, instead of 0 to 65535); float images will use their data range.
- **Copy and paste display settings.** **Copy display** and **Paste display** in the selection bar, and a new right-click menu on images (also Menu key or Shift+F10), copy every channel's LUT, range, gamma, invert and on/off, plus brightness and contrast, from one image to others, channel by number, in one undo step.

### Development

- `js/image/composite-core.js`: `planeHistogram`, `autoRange`, `sliderLimits`, `logBins`; the worker answers `histogram` messages; `MFC_TIFF.histogram(plane)` caches one per displayed plane; the channel panel asks with `{ background: true }`, which waits until pending composites are done. `js/image/display-settings.js`: copy, paste and the image context menu.
- Channels remember the range found on import (`fileMin`, `fileMax`). It is not saved: a project decodes its source again on opening, so the project format is unchanged.
- **Tests:** the new `histogram-display-regression` suite, with Auto checked against values from ImageJ 1.54p.

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

<p align="center">
  <img src="assets/FluoForge-logo-Github-viridis.svg" alt="FluoForge logo" width="420">
</p>

# FluoForge

A browser-based figure editor for multichannel microscopy images.

Import TIFF stacks straight from ImageJ/Fiji, choose which channels to show and how bright they are, lay the panels out on a page, add scale bars, insets, arrows, shapes and labels, and export a publication figure as TIFF, SVG or PDF. The original image data stays inside the project, so every display setting remains editable, and exports are recomposited from it at full resolution.

**[Open FluoForge](https://remybonnav.github.io/FluoForge/)**: nothing to install, nothing uploaded. Your images never leave your browser.

![A figure made in FluoForge: single channels and merges for two cohorts, magnified insets with an arrow, scale bars and labels](docs/images/19-final-figure.jpg)

## Quick start

1. Open the [live app](https://remybonnav.github.io/FluoForge/) in Chrome, Edge or Firefox, or run it locally (below).
2. Click **Create figure** and choose the page size and DPI (changing the unit converts the size, e.g. 21 × 29.7 cm to 8.27 × 11.69 in), or a journal's figure width (Nature, Science, Cell Press journals, PNAS, JCI, PLOS ONE, JCB, or generic 85, 114 and 174 mm), whose text limits the figure check then uses. Sizes are typed in mm and pt (px if you prefer). **From template** starts from a built-in layout (image with inset, split channels, 2 × 3 comparison, time or Z series strip) or your own: drop a file on each empty frame.
3. **Import Image**: multichannel TIFFs (8, 12, 16 or 32-bit float, RGB), ImageJ hyperstacks and OME-TIFFs (Z, time), or JPEG, PNG and BMP. For CZI, LIF and ND2, the Fiji macro `tools/Export_for_FluoForge.ijm` converts a folder to OME-TIFF.
4. **Rulers** (in the document unit) and **guides** dragged from them, margin and journal column guides, and smart snapping to edges, guides and equal spacing (the **Snap** button turns it off) help line panels up. Set each image's channels, colours and display range in the **Channels** panel (with a histogram and ImageJ-style **Auto** contrast), then arrange the panels with the **Grid**: it stays on the page (its **Grid** tab selects and moves it), so panels can be swapped by dragging, rows and columns added, row labels turned 90°, and the figure resized to a journal column width in mm with the gutters kept.
5. **Replace image…** (or dropping a file on a panel) swaps a panel's image and keeps its frame, letter, labels, grid cell, scale bar and insets; **Save as template** keeps a figure's layout, styles and labels without its images. **Annotate** places, on the selected image and linked to it (they move with it), filled and open arrows, arrowheads, asterisks and markers with a click, dashed ROIs with numbered labels, and labels linked to an image that update with it: channel names in their colours, Z position in µm, time stamp and an inset's magnification. The Text panel has superscript and subscript and a palette of µ, °, ±, Greek letters and arrows. **Letters** labels the selected panels A, B, C in reading order, in one style for the whole figure; they renumber themselves when panels move. **Quick figure** turns a multichannel image into a row of linked panels (each channel and the merge, with coloured column headers) in one click. **Series** turns a Z stack or time series into a strip or grid of linked panels, one per chosen slice or frame, each labelled with its Z position or time. Add scale bars, insets, text, shapes and arrows, and a channel legend (each channel's name in its colour) with the **Legend** tool.
6. **Save Project** (a `.fluoforge` file you can reopen and edit), then **Export** as TIFF, PNG, SVG (at the page's real size, for Inkscape and Illustrator) or PDF (the **Export…** dialog sets pages, resolution in dpi, ppi, dpc or ppc, transparency, TIFF compression and the figure report). **Export panels (zip)** gives each panel at source resolution and each channel in grey, as journals ask. **Copy out** (top bar, right-click menu or Ctrl+Shift+C) puts the page or the selection on the clipboard as an SVG picture, a PNG or SVG code, to paste into PowerPoint, Word, Inkscape, Illustrator or Figma. **Export ▸ Figure report…** lists each panel's source file (with its SHA-256), crop, projection and channel display settings as Markdown, CSV or JSON, with a ready-to-paste Methods paragraph; SVG and PDF exports embed it. The **Check figure** panel flags missing scale bars and labels, red-green merges, clipped channels, low resolution, text outside 5–8 pt (or the journal's limits) and more before you export. **Vision** in the top bar previews the canvas with deuteranopia, protanopia, tritanopia or in grey-scale, without changing the figure. **Preferences** (Ctrl+,) sets snapping (which edges, distance, guides) and default text, globally or for one project only.

The **[user manual](docs/MANUAL.md)** explains every tool step by step, with screenshots.

### Run it locally

FluoForge is a static page with no build step. From the project folder:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/`. It works offline: every library and font is bundled in `assets/vendor/`, and a strict Content-Security-Policy stops the page from loading anything from another site. Any static host works (GitHub Pages, an intranet folder). Opening `index.html` directly from disk does not, because browsers do not load modules from `file://`.

## Contributing

Tests, the release script and the project layout are described in [CONTRIBUTING.md](CONTRIBUTING.md). What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

## Licence

From v0.1.0, FluoForge is licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (AGPL-3.0-only). Copyright (C) 2026 Remy Bonnavion.

A commercial licence is available for organisations that want to use, modify, embed or host FluoForge without the AGPL obligations, or that need an invoice, support or deployment help. See [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

Third-party libraries and fonts keep their own licences; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Contributions need a signed Contributor License Agreement; see [CONTRIBUTING.md](CONTRIBUTING.md). Click the FluoForge name in the app's top bar to see the version, licence and a link to its source code.

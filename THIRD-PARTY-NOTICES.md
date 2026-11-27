# Third-party notices

FluoForge is licensed under AGPL-3.0-only (see [LICENSE](LICENSE)). It uses the third-party components below, which keep their own licences. All of them are bundled in this repository; the app loads nothing from a CDN. `assets/vendor/VERSIONS.md` pins each file by SHA-256.

Each licence was checked on 2026-11-17 against the component's licence file and `package.json` at the exact version used, or against its bundled licence file and file header.

| Component | Version | Licence | How FluoForge gets it | Source |
|---|---|---|---|---|
| Fabric.js | 5.1.0 | MIT | Bundled: `assets/vendor/fabric.min.js` (licence: `assets/vendor/LICENSE-fabric.txt`) | https://github.com/fabricjs/fabric.js |
| UTIF.js | 3.1.0 | MIT | Bundled: `assets/vendor/UTIF.js` (licence: `assets/vendor/LICENSE-utif.txt`) | https://github.com/photopea/UTIF.js |
| jsPDF | 2.5.1 | MIT | Bundled: `assets/vendor/jspdf.umd.min.js` (licence: `assets/vendor/LICENSE-jspdf.txt`) | https://github.com/parallax/jsPDF |
| JSZip | 3.10.1 | MIT or GPL-3.0-or-later (dual licence; FluoForge uses it under MIT) | Bundled: `assets/vendor/jszip.min.js` (licence: `assets/vendor/LICENSE-jszip.txt`) | https://github.com/Stuk/jszip |
| pako | 2.1.0 | MIT AND Zlib | Bundled: `assets/vendor/pako.min.js` | https://github.com/nodeca/pako |
| svg2pdf.js | 2.5.0, with one local fix | MIT | Bundled: `assets/vendor/svg2pdf.umd.min.js` | https://github.com/yWorks/svg2pdf.js |
| pdf.js (pdfjs-dist), with its worker | 6.5.438 | Apache-2.0 | Bundled: `assets/vendor/pdfjs/pdf.min.mjs` and `pdf.worker.min.mjs` (licence: `assets/vendor/LICENSE-pdfjs.txt`); loaded only to import a PDF page (converted to SVG, or rasterised) | https://github.com/mozilla/pdf.js |
| pdf.js standard fonts (Foxit) | from pdfjs-dist 6.5.438 | BSD-3-Clause (PDFium) | Bundled: `assets/vendor/pdfjs/standard_fonts/Foxit*.pfb` (licence: `LICENSE_FOXIT` in that folder); the Liberation Sans files there are copies of the app's own (below) | https://github.com/mozilla/pdf.js |
| Liberation Fonts (Sans, Serif, Mono) | 2.1.5 | SIL Open Font License 1.1 | Bundled: `assets/fonts/*.ttf` | https://github.com/liberationfonts/liberation-fonts |
| viridis, magma, inferno colour maps | matplotlib 3.9.2 tables | CC0 1.0 (public domain) | Data in `js/image/luts.js` (licence: `assets/vendor/LICENSE-mpl-colormaps.txt`) | https://github.com/BIDS/colormap |
| cividis colour map | matplotlib 3.9.2 table | Matplotlib License (PSF-style, permissive) | Data in `js/image/luts.js` (licence: `assets/vendor/LICENSE-matplotlib.txt`) | https://github.com/matplotlib/matplotlib |
| Fire LUT | ImageJ 1.x | Public domain | 32 control points in `js/image/luts.js` | https://github.com/imagej/ImageJ |

## How each licence was confirmed

- **Fabric.js 5.1.0**
  - The file cdnjs serves under `fabric.js/5.3.0/` is byte-identical to npm `fabric@5.1.0/dist/fabric.min.js` and reports version 5.1.0. That build is the one vendored.
  - The npm `package.json` declares `"license": "MIT"`, and the package's `LICENSE` file (bundled as `LICENSE-fabric.txt`) is the MIT licence ("Copyright (c) 2008-2015 Printio (Juriy Zaytsev, Maxim Chernyak)").
- **UTIF.js 3.1.0**
  - `package.json` declares MIT, and the `LICENSE` file is the MIT licence ("Copyright (c) 2017 Photopea").
- **jsPDF 2.5.1**
  - `package.json` declares MIT. The `LICENSE` file and the `@license` header of the CDN file credit James Hall, yWorks GmbH and other contributors.
  - The UMD build embeds fflate 0.4.8, which is also MIT.
- **JSZip 3.10.1**
  - `package.json` declares `(MIT OR GPL-3.0-or-later)`. The CDN file's header reads "Dual licenced under the MIT license or GPLv3".
  - The minified build embeds pako 1.0.x, licensed `(MIT AND Zlib)`.
- **pako 2.1.0**
  - The bundled file is byte-identical to `pako@2.1.0/dist/pako.min.js`. Its header reads `@license (MIT AND Zlib)`.
  - `assets/vendor/LICENSE-pako.txt` is identical to the package's MIT `LICENSE`.
- **svg2pdf.js 2.5.0**
  - Apart from the local fix, the bundled file is identical to `svg2pdf.js@2.5.0/dist/svg2pdf.umd.min.js`. The fix changes the regular expression for data URLs from `((?:.|\s)*)` to `([\s\S]*)`, and a comment at the top of the file marks it.
  - `package.json` declares MIT. `assets/vendor/LICENSE-svg2pdf.txt` matches the upstream `LICENSE` ("Copyright (c) 2015-2026 yWorks GmbH, Copyright (c) 2013-2015 by Vitaly Puzrin").
  - The build embeds cssesc 3.0.0, font-family-papandreou 0.2.0-patch2, specificity 0.4.1 and svgpath 2.x, all MIT.
- **pdf.js 6.5.438** (checked on 2026-11-26)
  - The files are byte-identical to `build/pdf.min.mjs` and `build/pdf.worker.min.mjs` of the npm package `pdfjs-dist@6.5.438`, whose `package.json` declares `"license": "Apache-2.0"`. Both files start with Mozilla's Apache 2.0 notice. `assets/vendor/LICENSE-pdfjs.txt` is the package's `LICENSE` (Apache License 2.0).
  - `assets/vendor/pdfjs/standard_fonts/` is the package's `standard_fonts` folder with one change. Its `LICENSE_FOXIT` is PDFium's BSD-3-Clause licence for the Foxit fonts. The package's Liberation Sans files are Liberation 1.x under GPL-2.0 with a font exception; they were replaced by the identically named Liberation Sans 2.1.5 files FluoForge already bundles (SIL OFL 1.1, `LICENSE_LIBERATION_OFL.txt`), so no GPL-licensed file is shipped.
- **Liberation Fonts 2.1.5**
  - The version comes from the fonts' own name tables ("Version 2.1.5").
  - `assets/fonts/LICENSE.txt` gives the SIL Open Font License 1.1, with copyright held by Google Corporation (Arimo, Tinos, Cousine) and Red Hat, Inc. (Reserved Font Name "Liberation").
  - Exports embed the fonts in SVG and PDF files.

- **viridis, magma, inferno and cividis** (checked on 2026-11-19)
  - The tables were taken from matplotlib 3.9.2, `lib/matplotlib/_cm_listed.py`. Each value (0 to 1) was multiplied by 255 and rounded to a byte. That is the only change, and it is the summary of changes the Matplotlib License asks for.
  - viridis, magma and inferno were created by Nathaniel Smith and Stéfan van der Walt and released under CC0 (`LICENSE.txt` of the BIDS/colormap repository, bundled as `LICENSE-mpl-colormaps.txt`).
  - cividis (Nuñez, Anderton and Renslow, PLoS ONE 2018) is distributed with matplotlib under the Matplotlib License, bundled as `LICENSE-matplotlib.txt` with its notice "Copyright (c) 2012- Matplotlib Development Team; All Rights Reserved".
- **Fire** (checked on 2026-11-19)
  - The 32 control points are those of `ij/plugin/LutLoader.java` in ImageJ 1.x, interpolated to 256 entries the same way. ImageJ 1.x is in the public domain.

## Compatibility with AGPL-3.0 and items to watch

- **No incompatible licence was found.**
  - MIT, Zlib, BSD-3-Clause and the MIT option of JSZip are permissive and compatible with AGPL-3.0. Apache-2.0 (pdf.js) is compatible with GPL-3.0 and AGPL-3.0 when, as here, the combined work is distributed under the (A)GPL; its NOTICE-free licence only asks that the licence and notices be kept. So are CC0, the public domain (ImageJ) and the Matplotlib License, which only asks that its notice be kept and changes summarised.
  - The fonts stay under the OFL 1.1 as separate works. The OFL allows bundling them with software under any licence, provided the fonts themselves are not relicensed and derivative fonts do not use the reserved name "Liberation".
- **Licence files.** Every bundled library has its licence file next to it in `assets/vendor/`.
- **JSZip is dual-licensed.** FluoForge uses the MIT option. The GPL-3.0 option is not needed.
- **svg2pdf.js is modified locally.** The MIT licence allows this. The change is marked in the file, and the original copyright notice is kept in `assets/vendor/LICENSE-svg2pdf.txt`.
- **Commercial licence.** All of the licences above are permissive, so these components can also be shipped under FluoForge's separate commercial licence, provided their own notices are kept.

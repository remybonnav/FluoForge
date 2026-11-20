/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P2-T6: figure report ("Methods and adjustments").
   - The report of tests/fixtures/reference.mfcproj.zip matches the stored expected files
     tests/fixtures/reference-report.json, .md and .csv ({{version}} stands for the app version).
     After an intended change, rewrite them with `node tests/run-headless.mjs --make-report`.
   - Its values: SHA-256 of the sources, crop in source pixels, insets, shape masks, pages, printed
     size and effective resolution; a Z stack's projection, slice and frame; gamma, invert, brightness
     and contrast; Markdown and CSV escaping.
   - SVG exports embed the report of their page in <metadata>, PDF exports the whole report in their
     Subject (read back with pdf.js).
   - The dialog (Export menu → Figure report…): its paragraph, downloads, keyboard path and themes. */

const figureReportModule = () => import(new URL('js/ui/figure-report.js', document.baseURI).href);

async function figureReportOutputs() {
  const MFC_REPORT = await figureReportModule();
  const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
  await MFC_TIFF.whenIdle();
  const report = MFC_REPORT.buildReport(), version = MFC.getAppVersion();
  const generic = text => text.split('FluoForge ' + version).join('FluoForge {{version}}');
  return { report, json: generic(MFC_REPORT.toJSON(report)), md: generic(MFC_REPORT.toMarkdown(report)), csv: generic(MFC_REPORT.toCSV(report)) };
}

/** Used by `node tests/run-headless.mjs --make-report`. */
async function makeFigureReportOutputs() {
  const { json, md, csv } = await figureReportOutputs();
  return { json, md, csv };
}

async function runFigureReportRegressions() {
  const checks = [];
  const MFC_REPORT = await figureReportModule();
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const firstDifference = (a, b) => {
    const x = a.split('\n'), y = b.split('\n');
    for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return `line ${i + 1}: "${(x[i] ?? '').slice(0, 160)}" expected "${(y[i] ?? '').slice(0, 160)}"`;
    return '';
  };

  // ---- The reference project against the stored expected files ----
  const out = await figureReportOutputs(), report = out.report;
  for (const [ext, text] of [['json', out.json], ['md', out.md], ['csv', out.csv]]) {
    const expected = await (await fetch('tests/fixtures/reference-report.' + ext, { cache: 'no-store' })).text();
    assert(`The report of the reference project matches tests/fixtures/reference-report.${ext} (${text.length} characters)`, text === expected, firstDifference(text, expected));
  }

  const manifest = JSON.parse(await (await JSZip.loadAsync(await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer()))
    .file('manifest.json').async('string'));
  const hashes = manifest.sources.map(s => s.id.replace(/^src-/, ''));
  const panels = report.panels;
  assert('Every image panel is reported once, in figure order: 4 panels from 2 source files', panels.length === 4 &&
    panels.map(p => p.panel).join() === '1,2,3,4' && new Set(panels.map(p => p.source.sha256)).size === 2);
  assert('Each source carries the SHA-256 of its original file, as stored in the project', panels.every(p => hashes.includes(p.source.sha256)));
  const [cells, raster, inset, masked] = panels;
  assert('Source: file name, format, dimensions, bit depth and pixel size',
    cells.source.fileName === 'reference-cells.tif' && cells.source.format === 'TIFF' && cells.source.width === 320 && cells.source.height === 240 &&
    cells.source.channels === 3 && cells.source.bitDepth === 16 && cells.pixelSizeUm === 0.5 &&
    raster.source.format === 'Raster image' && raster.source.bitDepth === 8 && raster.pixelSizeUm === null, JSON.stringify(cells.source));
  assert('Panel 1: the whole image, printed 1.5× at 300 dpi: 40.64 mm wide, 200 ppi, exported at its 320 × 240 source pixels',
    cells.crop.wholeImage && cells.printed.widthMm === 40.64 && cells.effectivePpi.x === 200 && cells.exportedPx.width === 320 && cells.belowDocumentDpi,
    JSON.stringify([cells.printed, cells.effectivePpi, cells.exportedPx]));
  assert('The inset is marked, and its crop is in source pixels (60 × 46.67 at 74.33, 47.67; 30 × 23.33 µm)',
    inset.inset && inset.crop.x === 74.33 && inset.crop.y === 47.67 && inset.crop.width === 60 && inset.crop.height === 46.67 &&
    inset.fieldOfViewUm.width === 30 && !inset.crop.wholeImage, JSON.stringify(inset.crop));
  assert('The shape-cropped panel reports its mask (an ellipse) and its crop; every panel is on page 1',
    masked.shapeMask === 'ellipse' && masked.crop.x === 31.5 && masked.crop.width === 180 && masked.crop.height === 180 && panels.every(p => p.page === 1 && !p.alsoOnPages), JSON.stringify([masked.shapeMask, masked.crop, masked.page]));
  assert('Channels: name, LUT, display range, gamma and invert', cells.channels.map(c => `${c.name}:${c.lut}:${c.min}-${c.max}:${c.gamma}:${c.invert}`).join() ===
    'Ch 1:grey:0-60000:1:false,Ch 2:red:0-50000:1:false,Ch 3:green:0-60000:1:false');
  assert('The figure: name, pages, size in px and mm, DPI', report.figure.pages === 2 && report.figure.dpi === 300 && report.figure.widthPx === 1200 &&
    report.figure.widthMm === 101.6 && report.generator === 'FluoForge ' + MFC.getAppVersion());
  const again = MFC_REPORT.toJSON(MFC_REPORT.buildReport());
  assert('The report has no date or random value: the same figure gives the same report', again === MFC_REPORT.toJSON(report));

  // ---- Embedded in SVG (per page) and PDF (whole figure) ----
  for (const page of [0, 1]) {
    const svg = await MFC_EXPORT.buildSVG({ page });
    const doc = new DOMParser().parseFromString(svg.svg, 'image/svg+xml');
    const node = doc.querySelector('metadata#fluoforge-report');
    const embedded = node && JSON.parse(node.textContent);
    assert(`SVG page ${page + 1} embeds the report of that page in <metadata>, as ASCII-only JSON (${page === 0 ? 4 : 0} panels)`,
      embedded && JSON.stringify(embedded) === JSON.stringify(MFC_REPORT.buildReport({ page })) && embedded.figure.page === page + 1 &&
      /^[\x20-\x7e]*$/.test(node.textContent) && embedded.panels.length === (page === 0 ? 4 : 0));
  }
  if (typeof pdfjsLib === 'undefined') await new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = 'node_modules/pdfjs-dist/build/pdf.min.js'; s.onload = resolve; s.onerror = () => reject(new Error('pdf.js is not installed (npm install)'));
    document.head.append(s);
  });
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'node_modules/pdfjs-dist/build/pdf.worker.min.js';
  const pdfBytes = new Uint8Array(await (await MFC_EXPORT.buildPDF()).blob.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes, isEvalSupported: false }).promise;
  const { info } = await pdf.getMetadata(); await pdf.destroy();
  assert('PDF document properties: the whole report as JSON in Subject, the figure name as Title, FluoForge as Creator',
    JSON.stringify(JSON.parse(info.Subject)) === JSON.stringify(report) && info.Title === 'FluoForge reference figure' &&
    info.Creator === 'FluoForge ' + MFC.getAppVersion(), (info.Subject || '').slice(0, 120));

  // ---- Methods paragraph ----
  const methods = MFC_REPORT.methodsParagraph(report);
  assert('Methods paragraph: the tool, every panel with its file, dimensions, pixel size, crop and channel display ranges',
    methods.startsWith('Figure panels were assembled in FluoForge ' + MFC.getAppVersion() + ' (4 image panels from 2 source files).') &&
    methods.includes('Panel 1 shows reference-cells.tif (320 × 240 px, 3 channels, 16-bit, 0.5 µm/px); Ch 1 in grey (display range 0–60000), Ch 2 in red (display range 0–50000) and Ch 3 in green (display range 0–60000).') &&
    methods.includes('Panel 3 (an inset) shows reference-cells.tif') && methods.includes('cropped to 60 × 46.67 px (30 × 23.333 µm)') &&
    methods.includes('masked to a') && methods.includes('exported at 300 dpi'), methods);

  // ---- A Z stack with every adjustment: slice, frame, gamma, invert, brightness, contrast ----
  const stackFile = new File([await (await fetch('tests/fixtures/formats/hyperstack.tif', { cache: 'no-store' })).arrayBuffer()], 'hyperstack.tif', { type: 'image/tiff' });
  await MFC.importFiles([stackFile]); await MFC_TIFF.whenIdle();
  const stackImage = MFC.getCanvas().getObjects().filter(o => o.mfcType === 'mfcImage').at(-1);
  stackImage.set({ left: 20, top: 20 }); stackImage.setCoords();
  const raw = MFC.getRegistry()[stackImage.mfcId].rawImage;
  let entry = MFC_REPORT.buildReport().panels.find(p => p.source.fileName === 'hyperstack.tif');
  assert('A Z stack defaults to a maximum intensity projection of all slices, with its Z step',
    entry && entry.projection.mode === 'max' && entry.projection.firstSlice === 1 && entry.projection.lastSlice === 3 &&
    entry.projection.sizeT === 2 && entry.projection.frame === 1 && entry.projection.zStepUm === 1.5 && entry.source.sizeZ === 3, JSON.stringify(entry && entry.projection));
  Object.assign(raw, { zMode: 'slice', zIndex: 1, tIndex: 1, brightness: 10, contrast: -5 });
  Object.assign(raw.channels[0], { gamma: 0.5, invert: true });
  raw.channels[1].enabled = false;
  entry = MFC_REPORT.buildReport().panels.find(p => p.source.fileName === 'hyperstack.tif');
  assert('Single slice and frame, gamma, invert, a hidden channel, brightness and contrast are reported',
    entry.projection.mode === 'slice' && entry.projection.firstSlice === 2 && entry.projection.lastSlice === 2 && entry.projection.frame === 2 &&
    entry.channels[0].gamma === 0.5 && entry.channels[0].invert && !entry.channels[1].shown && entry.brightness === 10 && entry.contrast === -5);
  const stackMethods = MFC_REPORT.methodsParagraph(MFC_REPORT.buildReport());
  assert('The Methods paragraph states the slice, frame, gamma, inversion and tone curve, and leaves out the hidden channel',
    stackMethods.includes('showing Z slice 2 of 3, time frame 2 of 2') && stackMethods.includes('DAPI in blue (display range') &&
    stackMethods.includes(', gamma 0.5, inverted)') && !/GFP in/.test(stackMethods.split('hyperstack.tif')[1]) &&
    stackMethods.includes('brightness +10 and contrast −5 applied to the composite') && stackMethods.includes('with the gamma stated'), stackMethods);

  // ---- Escaping: names from files ----
  const savedName = raw.fileName, savedChannel = raw.channels[0].name;
  raw.fileName = '=HYPERLINK("x"),a|b.tif'; raw.channels[0].name = 'DAPI *bold* <b>';
  const tricky = MFC_REPORT.buildReport();
  const csv = MFC_REPORT.toCSV(tricky), md = MFC_REPORT.toMarkdown(tricky);
  const lines = csv.trimEnd().split('\r\n');
  assert('CSV: one header and one row per channel of each panel, every row with every column',
    lines.length === 1 + tricky.panels.reduce((n, p) => n + p.channels.length, 0) && lines[0] === MFC_REPORT.toCSV({ panels: [], figure: {} }).trimEnd());
  assert('CSV: a name with quotes and commas is quoted, and one that starts like a formula is prefixed with \'',
    csv.includes(`"'=HYPERLINK(""x""),a|b.tif"`), lines.at(-1).slice(0, 200));
  assert('Markdown: | * < > in names are escaped, so a file name cannot break the tables',
    md.includes('=HYPERLINK("x"),a\\|b.tif') && md.includes('DAPI \\*bold\\* \\<b\\>') && !md.includes('<b>'));
  raw.fileName = savedName; raw.channels[0].name = savedChannel;
  const unicode = MFC_REPORT.toEmbeddedJSON({ name: 'µm × ]]> </metadata> &' });
  assert('Embedded JSON escapes non-ASCII, <, > and &, and parses back to the same text',
    /^[\x20-\x7e]*$/.test(unicode) && !unicode.includes('<') && JSON.parse(unicode).name === 'µm × ]]> </metadata> &');

  // ---- The dialog ----
  const menuButton = document.querySelector('#export-menu [data-export="report"]');
  assert('The Export menu has a "Figure report…" item with a title', menuButton && menuButton.textContent === 'Figure report…' && menuButton.title.length > 20);
  document.getElementById('btn-export').click(); menuButton.click();
  for (let i = 0; i < 50 && !document.querySelector('.figure-report-modal'); i++) await new Promise(resolve => setTimeout(resolve, 10)); // the module loads on demand
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const dialog = document.querySelector('.figure-report-modal');
  const area = document.getElementById('figure-report-methods');
  assert('It opens a dialog with the Methods paragraph, read-only, and focus on "Copy paragraph"',
    dialog && dialog.getAttribute('role') === 'dialog' && area.readOnly && area.value === MFC_REPORT.methodsParagraph(MFC_REPORT.buildReport()) &&
    document.activeElement.id === 'figure-report-copy' && document.getElementById('export-menu').classList.contains('hidden'), document.activeElement.tagName);
  const controls = [...dialog.querySelectorAll('button, textarea')];
  assert('Every control of the dialog has a title', controls.length === 6 && controls.every(c => c.title.length > 5));
  const downloads = [], realDownload = MFC_EXPORT.download;
  MFC_EXPORT.download = (blob, name) => downloads.push({ blob, name });
  try { for (const id of ['figure-report-md', 'figure-report-csv', 'figure-report-json']) document.getElementById(id).click(); }
  finally { MFC_EXPORT.download = realDownload; }
  const texts = await Promise.all(downloads.map(d => d.blob.text()));
  const now = MFC_REPORT.buildReport(), base = MFC_EXPORT.exportBaseName() + '_report';
  assert('Markdown, CSV and JSON download as <figure name>_report.md, .csv and .json with the report',
    downloads.map(d => d.name).join() === [base + '.md', base + '.csv', base + '.json'].join() &&
    texts[0] === MFC_REPORT.toMarkdown(now) && texts[1].replace(/^﻿/, '') === MFC_REPORT.toCSV(now) && texts[2] === MFC_REPORT.toJSON(now) &&
    downloads[1].blob.type === 'text/csv', downloads.map(d => d.name).join());
  const key = (target, k, shift = false) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }));
  document.getElementById('figure-report-json').focus(); key(document.activeElement, 'Tab');
  const wrapped = document.activeElement === area;
  key(area, 'Tab', true);
  assert('Tab and Shift+Tab stay inside the dialog', wrapped && document.activeElement.id === 'figure-report-json');
  const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const savedTheme = document.documentElement.dataset.theme, ratios = [];
  for (const theme of ['light', 'sage', 'dark', 'slate']) {
    document.documentElement.dataset.theme = theme;
    const style = getComputedStyle(area), button = getComputedStyle(document.getElementById('figure-report-copy'));
    ratios.push(Math.min(contrast(style.color, style.backgroundColor), contrast(button.color, button.backgroundColor)));
  }
  if (savedTheme) document.documentElement.dataset.theme = savedTheme; else delete document.documentElement.dataset.theme;
  assert('The paragraph and buttons are readable in all four themes (contrast ≥ 4.5)', ratios.every(r => r >= 4.5), ratios.map(r => r.toFixed(1)).join());
  const focusRule = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
    .some(r => /\.figure-report-methods:focus-visible/.test(r.selectorText || '') && /outline/.test(r.cssText));
  assert('The paragraph and the buttons have a visible focus outline', focusRule);
  key(area, 'Escape');
  assert('Escape closes the dialog', !document.querySelector('.figure-report-backdrop'));
  return checks;
}

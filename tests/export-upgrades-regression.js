/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P2-T9: export upgrades.
   - TIFF writer: Deflate, LZW and uncompressed, RGB and RGBA, read back by UTIF with the same pixels,
     resolution tags and predictor; LZW on random data, long runs and code-width changes.
   - The TIFF export is compressed and has the same pixels as before; PNG export with its DPI (pHYs),
     at a higher resolution, with a transparent background; page ranges; a PDF of chosen pages;
     the figure report next to the export.
   - The export dialog: its fields per format, the figure check line, errors, Esc, focus, themes; the
     resolution unit (dpi, ppi, dpc, ppc): conversion, limits, TIFF tags in px/cm, remembered.
   - Export panels: the zip's PNGs at source resolution as displayed and each channel in grey, named
     from the panel letter and channel name, with the pixel size, the figure report and a README. */

const nextExportFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function runExportUpgradesRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const E = await import(new URL('js/image/raster-encoders.js', document.baseURI).href);
  const decodeTiff = bytes => { const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); const ifd = UTIF.decode(buf)[0]; UTIF.decodeImage(buf, ifd); return { ifd, rgba: UTIF.toRGBA8(ifd) }; };
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  // ---- TIFF writer ----
  const patterns = {
    random: (x, y) => [Math.random() * 256, Math.random() * 256, Math.random() * 256, 255],
    smooth: (x, y) => [x % 256, y % 256, (x + y) % 256, 255],
    runs: (x) => [x < 400 ? 255 : 0, 7, 7, 255],
    alpha: (x, y) => [x % 256, 40, y % 256, (x * 3) % 256]
  };
  for (const [kind, fn] of Object.entries(patterns)) {
    const w = kind === 'random' ? 301 : 800, h = kind === 'random' ? 211 : 120, rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set(fn(i % w, (i / w) | 0).map(v => v | 0), i * 4);
    for (const compression of ['deflate', 'lzw', 'none']) {
      const alpha = kind === 'alpha', bytes = E.encodeTIFF(rgba, w, h, { dpi: 600, compression, alpha });
      const { ifd, rgba: back } = decodeTiff(bytes);
      const expect = alpha ? rgba : rgba.map((v, i) => (i % 4 === 3 ? 255 : v));
      assert(`TIFF ${compression}, ${kind} ${w} × ${h}${alpha ? ' RGBA' : ''}: UTIF reads back every pixel, ${ifd.t277[0]} samples, 600 dpi, compression ${E.TIFF_COMPRESSION[compression]}`,
        same(back, expect) && ifd.t259[0] === E.TIFF_COMPRESSION[compression] && Math.abs(ifd.t282[0] - 600) < 1e-6 && ifd.t296[0] === 2 && ifd.t277[0] === (alpha ? 4 : 3) &&
        (compression === 'none' || ifd.t317[0] === 2) && (!alpha || ifd.t338[0] === 2), `${ifd.t259} ${ifd.t282} ${ifd.t277}`);
    }
  }
  const big = new Uint8Array(20000); for (let i = 0; i < big.length; i++) big[i] = (Math.random() * 256) | 0;
  const lzwRgba = new Uint8Array(100 * 100 * 4); for (let i = 0; i < lzwRgba.length; i++) lzwRgba[i] = i % 4 === 3 ? 255 : big[i % big.length];
  assert('LZW: codes widen to 12 bits and the table is cleared, still read back exactly (100 × 100 random)', same(decodeTiff(E.encodeTIFF(lzwRgba, 100, 100, { compression: 'lzw' })).rgba, lzwRgba));
  assert('LZW of an empty input is a clear code and an end code', E.lzwEncode(new Uint8Array(0)).length === 3);
  const cmTiff = decodeTiff(E.encodeTIFF(lzwRgba, 100, 100, { dpi: 600, unit: 'cm' })).ifd;
  assert('TIFF with unit cm: ResolutionUnit 3 (centimetre) and 236.22 px/cm for 600 dpi', cmTiff.t296[0] === 3 && Math.abs(cmTiff.t282[0] - 600 / 2.54) < 1e-4 && Math.abs(cmTiff.t283[0] - 600 / 2.54) < 1e-4, `${cmTiff.t296} ${cmTiff.t282}`);
  let badUnit = ''; try { E.encodeTIFF(lzwRgba, 100, 100, { unit: 'mm' }); } catch (e) { badUnit = e.message; }
  assert('An unknown TIFF resolution unit is refused', /resolution unit/.test(badUnit), badUnit);

  // ---- Exports of the reference figure ----
  const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
  await MFC_TIFF.whenIdle(); await document.fonts.ready;
  const tiff = await MFC_EXPORT.buildTIFF();
  const tBytes = new Uint8Array(await tiff.blob.arrayBuffer()), { ifd: tIfd, rgba: tRgba } = decodeTiff(tBytes);
  const svg = await MFC_EXPORT.buildSVG(), canvasRef = await MFC_EXPORT.renderSVG(svg), refRgba = canvasRef.getContext('2d').getImageData(0, 0, canvasRef.width, canvasRef.height).data;
  assert('The TIFF export is Deflate-compressed with the predictor, at 300 dpi, and has exactly the pixels of the rendered page',
    tIfd.t259[0] === 8 && tIfd.t317[0] === 2 && Math.abs(tIfd.t282[0] - 300) < 1e-6 && tIfd.t296[0] === 2 && tIfd.width === 1200 && same(tRgba, refRgba));
  const stored = await (await fetch('tests/fixtures/reference.tif', { cache: 'no-store' })).arrayBuffer();
  assert(`The compressed TIFF is much smaller than the uncompressed reference.tif (${tBytes.length} against ${stored.byteLength} bytes)`, tBytes.length < stored.byteLength / 2);
  const perCm = decodeTiff(new Uint8Array(await (await MFC_EXPORT.buildTIFF({ resolutionUnit: 'cm' })).blob.arrayBuffer()));
  assert('A TIFF export in pixels per centimetre has the same pixels, 118.11 px/cm and ResolutionUnit 3',
    perCm.ifd.t296[0] === 3 && Math.abs(perCm.ifd.t282[0] - 300 / 2.54) < 1e-4 && same(perCm.rgba, refRgba), `${perCm.ifd.t296} ${perCm.ifd.t282}`);
  const lzw = decodeTiff(new Uint8Array(await (await MFC_EXPORT.buildTIFF({ compression: 'lzw' })).blob.arrayBuffer()));
  assert('An LZW TIFF export has the same pixels', lzw.ifd.t259[0] === 5 && same(lzw.rgba, refRgba));

  const pngOut = await MFC_EXPORT.buildPNG(), pngBytes = new Uint8Array(await pngOut.blob.arrayBuffer());
  const phys = E.readPhys(pngBytes), decodePng = async blob => { const bmp = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data }; };
  const png = await decodePng(pngOut.blob);
  assert('PNG export: the page at 300 dpi (pHYs 11811 px/m), same pixels as the TIFF', phys && phys.unit === 1 && phys.ppmX === Math.round(300 / 0.0254) &&
    png.w === 1200 && png.h === 800 && same(png.data, refRgba), JSON.stringify(phys));
  const hi = await MFC_EXPORT.buildPNG({ dpi: 600 }), hiPng = await decodePng(hi.blob), hiPhys = E.readPhys(new Uint8Array(await hi.blob.arrayBuffer()));
  assert('At 600 dpi the PNG has twice the pixels each way and says 600 dpi', hiPng.w === 2400 && hiPng.h === 1600 && hiPhys.ppmX === Math.round(600 / 0.0254));
  const hiTiff = await MFC_EXPORT.buildTIFF({ dpi: 600 });
  assert('At 600 dpi the TIFF has twice the pixels and 600 dpi tags', hiTiff.pixelWidth === 2400 && Math.abs(decodeTiff(new Uint8Array(await hiTiff.blob.arrayBuffer())).ifd.t282[0] - 600) < 1e-6);
  // A panel printed smaller than its source (320 px source at 0.5 × = 160 document px) gains pixels at 600 dpi.
  const first = MFC.getCanvas().getObjects().find(o => o.mfcType === 'mfcImage'), savedScale = [first.scaleX, first.scaleY];
  first.set({ scaleX: 0.5, scaleY: 0.5 }); first.setCoords();
  const lo = (await MFC_EXPORT.buildSVG()).imageDetails[0], hiDetails = (await MFC_EXPORT.buildSVG({ scale: 2 })).imageDetails;
  first.set({ scaleX: savedScale[0], scaleY: savedScale[1] }); first.setCoords();
  assert('At 600 dpi, a panel printed smaller than its source is recomposited with twice the pixels (160 → 320), and no image goes beyond its source',
    lo.width === 160 && hiDetails[0].width === 320 && hiDetails.every(d => d.width <= Math.ceil(d.region.width) && d.height <= Math.ceil(d.region.height)), `${lo.width} → ${hiDetails[0].width}`);
  const clear = await decodePng((await MFC_EXPORT.buildPNG({ transparent: true })).blob);
  const alphaAt = (img, x, y) => img.data[(y * img.w + x) * 4 + 3];
  assert('Transparent PNG: the empty page is transparent, the panels are opaque', alphaAt(clear, 1190, 790) === 0 && alphaAt(png, 1190, 790) === 255 &&
    alphaAt(clear, Math.round(svg.imageDetails[0].width / 2) + 70, 120) === 255);
  const clearTiff = decodeTiff(new Uint8Array(await (await MFC_EXPORT.buildTIFF({ transparent: true })).blob.arrayBuffer()));
  assert('Transparent TIFF: RGBA with unassociated alpha, transparent where the page is empty', clearTiff.ifd.t277[0] === 4 && clearTiff.ifd.t338[0] === 2 && clearTiff.rgba[(790 * 1200 + 1190) * 4 + 3] === 0);
  const clearSvg = (await MFC_EXPORT.buildSVG({ transparent: true })).svg;
  const background = /<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/;
  assert('Transparent SVG: no white page background', background.test(svg.svg) && !background.test(clearSvg));
  const defaultSvg = (await MFC_EXPORT.buildSVG()).svg.replace(/(CLIPPATH|SVGID)_\d+/g, '$1');
  assert('The default SVG is unchanged by the new options (scale 1, white background)', defaultSvg === svg.svg.replace(/(CLIPPATH|SVGID)_\d+/g, '$1'));

  // ---- Pages ----
  const range = text => { try { return MFC_EXPORT.parsePageRange(text, 5).join(); } catch (e) { return 'error: ' + e.message; } };
  assert('Page ranges: "1-3, 5", "2", "3-3,1" and duplicates', range('1-3, 5') === '0,1,2,4' && range('2') === '1' && range('3-3,1') === '0,2' && range('2,2,1-2') === '0,1');
  assert('Page ranges: empty, reversed, out of range or text are refused with a message', /^error: Enter/.test(range(' ')) && /^error: Pages 3-1/.test(range('3-1')) &&
    /^error: Pages 6/.test(range('6')) && /not a page/.test(range('two')) && /not a page/.test(range('0.5')));
  const downloads = [], realDownload = MFC_EXPORT.download;
  MFC_EXPORT.download = (blob, name) => downloads.push({ blob, name });
  try {
    await MFC_EXPORT.exportWith({ format: 'pdf', pages: [1] });
    await MFC_EXPORT.exportWith({ format: 'svg', pages: [0, 1] });
    await MFC_EXPORT.exportWith({ format: 'png', pages: [1], includeReport: true });
  } finally { MFC_EXPORT.download = realDownload; }
  const base = MFC_EXPORT.exportBaseName();
  assert('exportWith writes one PDF, one SVG per page, and the report next to a PNG when asked',
    downloads.map(d => d.name).join() === [base + '.pdf', base + '_page-1.svg', base + '_page-2.svg', base + '_page-2.png', base + '_report.md', base + '_report.json'].join(),
    downloads.map(d => d.name).join() + ' / status: ' + document.getElementById('project-status').textContent);
  if (typeof pdfjsLib === 'undefined') await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'node_modules/pdfjs-dist/build/pdf.min.js'; s.onload = resolve; s.onerror = reject; document.head.append(s); });
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'node_modules/pdfjs-dist/build/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await downloads[0].blob.arrayBuffer()), isEvalSupported: false }).promise;
  const pageText = (await (await pdf.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
  assert('The PDF of page 2 only has one page, the second page of the figure', pdf.numPages === 1 && /Page 2/.test(pageText), pageText.slice(0, 80));
  await pdf.destroy();
  const report = await downloads[5].blob.text();
  assert('The report next to the export is the figure report', JSON.parse(report).report === 'FluoForge figure report');

  // ---- Dialog ----
  document.getElementById('btn-export').click();
  const menu = document.getElementById('export-menu');
  assert('The Export menu has Export…, TIFF, PNG, SVG, PDF, Copy for other software, Export panels and Figure report, all with titles',
    [...menu.querySelectorAll('[data-export]')].map(b => b.dataset.export).join() === 'dialog,tiff,png,svg,pdf,copy,panels,report' && [...menu.querySelectorAll('[data-export]')].every(b => b.title.length > 10));
  menu.querySelector('[data-export="dialog"]').click();
  for (let i = 0; i < 50 && !document.querySelector('.export-modal'); i++) await new Promise(r => setTimeout(r, 10));
  await nextExportFrame();
  const dialog = document.querySelector('.export-modal'), $ = sel => dialog.querySelector(sel);
  assert('Export… opens a dialog focused on the format, with the figure check line', dialog && dialog.getAttribute('role') === 'dialog' && document.activeElement === $('#export-format') &&
    /^Figure check: .*never blocked/.test($('.export-check-line').textContent));
  const setFormat = f => { $('#export-format').value = f; $('#export-format').dispatchEvent(new Event('change')); };
  setFormat('pdf');
  assert('PDF: no resolution, transparency or TIFF compression', $('#export-dpi').disabled && $('#export-transparent').disabled && $('#export-compression').closest('label').hidden);
  setFormat('svg');
  assert('SVG: transparency yes, resolution no', $('#export-dpi').disabled && $('#export-dpi-unit').disabled && !$('#export-transparent').disabled);
  setFormat('tiff');
  assert('TIFF: resolution, transparency and compression (Deflate by default), starting at the document DPI',
    !$('#export-dpi').disabled && !$('#export-transparent').disabled && !$('#export-compression').closest('label').hidden && $('#export-compression').value === 'deflate' && $('#export-dpi').value === '300');
  const unit = $('#export-dpi-unit'), setUnit = u => { unit.value = u; unit.dispatchEvent(new Event('change')); };
  assert('The resolution has a unit list: dpi, ppi, dpc, ppc, dpi first, with a title, enabled for TIFF',
    [...unit.options].map(o => o.value).join() === 'dpi,ppi,dpc,ppc' && unit.value === 'dpi' && unit.title.length > 10 && !unit.disabled && $('#export-dpi').step === '1');
  setUnit('ppc');
  assert('Choosing ppc converts 300 dpi to 118.11 and gives the limits and the note in ppc',
    $('#export-dpi').value === '118.11' && $('#export-dpi').min === '11.81' && $('#export-dpi').max === '944.88' && $('#export-dpi').step === '0.01' &&
    /^118\.11 ppc \(300 dpi\) is the document's resolution/.test($('.export-note').textContent), `${$('#export-dpi').value} ${$('#export-dpi').min}-${$('#export-dpi').max} ${$('.export-note').textContent}`);
  const readOptions = (await import(new URL('js/ui/export-dialog.js', document.baseURI).href)).readExportOptions;
  let o = readOptions(dialog);
  assert('118.11 ppc exports at 300 dpi (within 0.01) with the TIFF tags in centimetres', Math.abs(o.dpi - 300) < 0.01 && o.resolutionUnit === 'cm', JSON.stringify(o));
  setUnit('dpc');
  assert('dpc is the same number as ppc', $('#export-dpi').value === '118.11' && readOptions(dialog).resolutionUnit === 'cm');
  setUnit('ppi');
  o = readOptions(dialog);
  assert('Back to ppi: 300 again, the same as dpi, with the TIFF tags in inches', $('#export-dpi').value === '300' && o.dpi === 300 && o.resolutionUnit === 'inch' && $('#export-dpi').step === '1', $('#export-dpi').value);
  setUnit('ppc'); $('#export-dpi').value = '5'; $('#export-ok').click(); await nextExportFrame();
  assert('Out of range in ppc: the error gives the limits in ppc', document.querySelector('.export-modal') && /between 11\.81 and 944\.88 ppc/.test($('.export-error').textContent), $('.export-error').textContent);
  $('#export-dpi').value = '11.81';
  assert('The lowest value shown in ppc (11.81) is accepted, as 30 dpi', readOptions(dialog).dpi === 30);
  $('#export-dpi').value = '1e2';
  let refused = ''; try { readOptions(dialog); } catch (e) { refused = e.message; }
  assert('A resolution that is not a plain number is refused', /between 11\.81 and 944\.88 ppc/.test(refused), refused);
  setFormat('pdf');
  assert('PDF: the unit list is disabled too', unit.disabled);
  setFormat('tiff'); setUnit('dpi'); $('#export-dpi').value = '300';
  $('#export-range').value = '9'; $('#export-range').dispatchEvent(new Event('input'));
  $('#export-ok').click(); await nextExportFrame();
  assert('A bad page range shows an error and keeps the dialog open', document.querySelector('.export-modal') && /not in this figure/.test($('.export-error').textContent));
  $('#export-dpi').value = '10'; $('#export-pages-all').checked = true; $('#export-ok').click(); await nextExportFrame();
  assert('A resolution out of range is refused', document.querySelector('.export-modal') && /between 30 and 2400/.test($('.export-error').textContent), $('.export-error').textContent + ' / open ' + !!document.querySelector('.export-modal'));
  const controls = [...dialog.querySelectorAll('input, select, button')];
  assert('Every control has a title (its own or its field\'s)', controls.every(c => (c.title || c.closest('[title]')?.title || '').length > 5));
  const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (x, y) => { const [h, l] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (h + 0.05) / (l + 0.05); };
  const savedTheme = document.documentElement.dataset.theme, ratios = [];
  for (const theme of ['light', 'sage', 'dark', 'slate']) {
    document.documentElement.dataset.theme = theme;
    const d = getComputedStyle(dialog), f = getComputedStyle($('.export-field')), sel = getComputedStyle($('#export-format')), line = getComputedStyle($('.export-check-line'));
    const unitStyle = getComputedStyle($('#export-dpi-unit'));
    ratios.push(contrast(f.color, d.backgroundColor), contrast(sel.color, sel.backgroundColor), contrast(line.color, line.backgroundColor), contrast(unitStyle.color, unitStyle.backgroundColor));
  }
  if (savedTheme) document.documentElement.dataset.theme = savedTheme; else delete document.documentElement.dataset.theme;
  assert('The dialog is readable in all four themes (contrast ≥ 4.5)', ratios.every(r => r >= 4.5), ratios.map(r => r.toFixed(1)).join());
  const last = $('#export-ok'); last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert('Tab from Export wraps to the format', document.activeElement === $('#export-format'));
  // A real export from the dialog.
  const viaDialog = []; MFC_EXPORT.download = (blob, name) => viaDialog.push(name);
  try {
    $('#export-dpi').value = '150'; $('#export-pages-current').checked = true; $('#export-report').checked = false;
    $('#export-ok').click();
    for (let i = 0; i < 200 && !viaDialog.length; i++) await new Promise(r => setTimeout(r, 20));
  } finally { MFC_EXPORT.download = realDownload; }
  assert('Export writes the chosen format and page, and closes the dialog', viaDialog.length === 1 && /_page-1\.tiff$/.test(viaDialog[0]) && !document.querySelector('.export-modal'), viaDialog.join());
  document.getElementById('btn-export').click(); menu.querySelector('[data-export="dialog"]').click();
  for (let i = 0; i < 50 && !document.querySelector('.export-modal'); i++) await new Promise(r => setTimeout(r, 10));
  assert('The dialog remembers the last choices', document.querySelector('#export-dpi').value === '150' && document.querySelector('#export-pages-current').checked);
  // A real export in pixels per centimetre: 59.06 ppc is 150 dpi, half the document's pixels.
  const inCm = []; MFC_EXPORT.download = (blob, name) => inCm.push({ blob, name });
  try {
    const d2 = document.querySelector('.export-modal'), u2 = d2.querySelector('#export-dpi-unit');
    u2.value = 'ppc'; u2.dispatchEvent(new Event('change'));
    const converted = d2.querySelector('#export-dpi').value; d2.querySelector('#export-ok').click();
    for (let i = 0; i < 200 && !inCm.length; i++) await new Promise(r => setTimeout(r, 20));
    const t = decodeTiff(new Uint8Array(await inCm[0].blob.arrayBuffer())).ifd;
    assert('Exporting at 59.06 ppc (150 dpi converted) writes a 600 px wide TIFF tagged 59.06 px/cm',
      converted === '59.06' && t.width === 600 && t.t296[0] === 3 && Math.abs(t.t282[0] - 59.06) < 1e-4, `${converted} ${t.width} ${t.t296} ${t.t282}`);
  } finally { MFC_EXPORT.download = realDownload; }
  const pngCm = E.readPhys(new Uint8Array(await (await MFC_EXPORT.buildPNG({ dpi: 59.06 * 2.54 })).blob.arrayBuffer()));
  assert('A PNG at 59.06 ppc says 5906 px/m (pHYs is always per metre)', pngCm.ppmX === 5906 && pngCm.unit === 1, JSON.stringify(pngCm));
  document.getElementById('btn-export').click(); menu.querySelector('[data-export="dialog"]').click();
  for (let i = 0; i < 50 && !document.querySelector('.export-modal'); i++) await new Promise(r => setTimeout(r, 10));
  assert('The dialog remembers the unit and the value in it', document.querySelector('#export-dpi-unit').value === 'ppc' && document.querySelector('#export-dpi').value === '59.06');
  document.querySelector('.export-modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert('Escape closes it without exporting', !document.querySelector('.export-modal'));

  // ---- Export panels ----
  const P = await import(new URL('js/ui/export-panels.js', document.baseURI).href);
  const { blob: zipBlob, files } = await P.buildPanelsZip();
  const zip = await JSZip.loadAsync(zipBlob), names = Object.keys(zip.files);
  const images = MFC.getCanvas().getObjects().filter(o => o.mfcType === 'mfcImage');
  const letters = P.panelLetters();
  assert('The first panel is named after the label "A" next to it; panels without a label get panel-N', letters.get(images[0].mfcId) === 'A' &&
    [...letters.values()].filter(l => l !== 'A').every(l => /^panel-\d+$/.test(l)), JSON.stringify([...letters.values()]));
  assert('The zip has a merge and one grey PNG per shown channel for each panel, the figure report and a README',
    names.includes('A_merge.png') && names.includes('A_Ch_1.png') && names.includes('A_Ch_2.png') && names.includes('A_Ch_3.png') &&
    names.filter(n => n.endsWith('_merge.png')).length === 4 && names.includes('figure-report.json') && names.includes('README.txt') && files.length === names.length, names.join());
  const readPng = async name => decodePng(new Blob([await zip.file(name).async('uint8array')], { type: 'image/png' }));
  const merge = await readPng('A_merge.png'), c2 = await readPng('A_Ch_2.png');
  const reg = MFC.getRegistry()[images[0].mfcId].rawImage;
  assert('The merge is at source resolution (320 × 240), as displayed', merge.w === reg.width && merge.h === reg.height);
  let greyOk = true; for (let i = 0; i < c2.data.length; i += 4 * 97) if (c2.data[i] !== c2.data[i + 1] || c2.data[i + 1] !== c2.data[i + 2]) greyOk = false;
  const ch2 = reg.channels[1], v = ch2.data[120 * reg.width + 160], expected = Math.round(Math.min(1, Math.max(0, (v - ch2.min) / (ch2.max - ch2.min))) * 255);
  assert('Each channel PNG is grey, through that channel\'s display range', greyOk && Math.abs(c2.data[(120 * c2.w + 160) * 4] - expected) <= 1, `${c2.data[(120 * c2.w + 160) * 4]} vs ${expected}`);
  const phys2 = E.readPhys(await zip.file('A_merge.png').async('uint8array'));
  assert('The PNGs carry the pixel size: 0.5 µm/px is 2,000,000 px/m', phys2 && phys2.ppmX === 2000000 && phys2.unit === 1);
  const inset = images.find(o => o.mfcIsInset), insetLetter = letters.get(inset.mfcId), insetPng = await readPng(insetLetter + '_merge.png');
  assert('The inset panel is exported at the source pixels of its crop (60 × 47)', insetPng.w === 60 && insetPng.h === 47, `${insetPng.w} × ${insetPng.h}`);
  const readme = await zip.file('README.txt').async('string'), rep = JSON.parse(await zip.file('figure-report.json').async('string'));
  assert('The README describes every PNG; the figure report lists every panel', names.filter(n => n.endsWith('.png')).every(n => readme.includes(n)) && rep.panels.length === 4);
  return checks;
}

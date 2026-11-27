/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T10: vector panels from other tools (the pure part: tests/vector-model-regression.mjs).
   - An SVG plot (matplotlib-like, svglite-like) becomes a vector panel at its size on paper, its
     source stored once; it is drawn on the canvas, in the Layers panel and History by name;
   - SVG export writes its own elements (no <image>), ids renamed and CSS limited to the panel, text
     in the embedded Liberation faces; PDF export keeps it vector (no image XObject, real text) and
     draws it where the canvas does; TIFF/PNG export draws it;
   - crop, uncrop, copy and paste, undo, save and reopen, panel letters, templates (a frame);
   - refusals: scripts, event handlers, HTML, links to other files, no size, not an SVG;
   - a PDF page as an image (the fallback): rasterised at the document dpi as a labelled image panel
     (name, mfcRasterised, figure check), the page dialog, a PDF that cannot be read. A PDF page as a
     vector panel (P3-T10a): tests/pdf-vector-regression.js. */
async function runVectorRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const VEC = await import(new URL('js/image/vector.js', document.baseURI).href);
  const PDFI = await import(new URL('js/image/pdf-import.js', document.baseURI).href);
  const LET = await import(new URL('js/layout/letters.js', document.baseURI).href);
  const TM = await import(new URL('js/layout/template-model.js', document.baseURI).href);
  const RULES = await import(new URL('js/image/figure-check-rules.js', document.baseURI).href);
  const CHECK = await import(new URL('js/ui/figure-check.js', document.baseURI).href);
  const pdfjs = await import(new URL('assets/vendor/pdfjs/pdf.min.mjs', document.baseURI).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
  const idle = async () => { await MFC_TIFF.whenIdle(); await frame(); };
  const svgFile = (name, text) => new File([text], name, { type: 'image/svg+xml' });
  const vectors = () => canvas.getObjects().filter(o => o.mfcType === 'mfcVector');
  const toasts = [], errors = [];
  const toast = MFC_UI.toast, report = MFC_ERRORS.report;
  MFC_UI.toast = m => { toasts.push(m); toast(m); };
  MFC_ERRORS.report = (e, o) => { errors.push((o && o.title ? o.title + ': ' : '') + e.message); };
  const pixel = (ctx, x, y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data];
  const isBlue = ([r, g, b]) => b > 150 && r < 90 && b - r > 80; // #1f77b4
  const isWhite = ([r, g, b]) => r > 240 && g > 240 && b > 240;

  // A matplotlib-like SVG: 230.4 × 172.8 pt (3.2 × 2.4 in), a global "*" rule, a clip path and markers
  // by id, text in the font shorthand with 'DejaVu Sans', a bold title.
  const MPL = `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<svg xmlns:xlink="http://www.w3.org/1999/xlink" width="230.4pt" height="172.8pt" viewBox="0 0 230.4 172.8" xmlns="http://www.w3.org/2000/svg" version="1.1">
 <defs><style type="text/css">*{stroke-linejoin: round; stroke-linecap: butt}</style>
  <clipPath id="p1a2b"><rect x="28.8" y="17.28" width="178.56" height="133.056"/></clipPath>
  <path id="m0" d="M 0 3 L 3 0 L 0 -3 L -3 0 z" style="stroke: #d62728"/></defs>
 <g id="figure_1"><g id="patch_1"><path d="M 0 172.8 L 230.4 172.8 L 230.4 0 L 0 0 z" style="fill: #ffffff"/></g>
  <g id="line2d_1"><path d="M 36.9 144.3 L 117.1 83.8 L 199.2 23.3" clip-path="url(#p1a2b)" style="fill: none; stroke: #1f77b4; stroke-width: 3; stroke-linecap: square"/></g>
  <g id="line2d_2" clip-path="url(#p1a2b)"><use xlink:href="#m0" x="36.9" y="144.3" style="fill: #d62728"/><use xlink:href="#m0" x="199.2" y="23.3" style="fill: #d62728"/></g>
  <g id="text_1"><text style="font: 10px 'DejaVu Sans'; text-anchor: middle" x="118.08" y="165">Time (min) µ</text></g>
  <g id="text_2"><text style="font-weight: bold; font-size: 12px; font-family: 'DejaVu Sans'; text-anchor: middle" x="118.08" y="12">Growth</text></g></g>
</svg>`;
  // An svglite-like SVG: a class on the root and rules on it, Arial in a style attribute.
  const SVGLITE = `<?xml version='1.0' encoding='UTF-8' ?>
<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' class='svglite' width='144.00pt' height='108.00pt' viewBox='0 0 144.00 108.00'>
<defs><style type='text/css'><![CDATA[ .svglite polyline, .svglite circle { fill: none; stroke: #000000; stroke-linecap: round; } ]]></style></defs>
<rect width='100%' height='100%' style='stroke: none; fill: #FFFFFF;'/>
<polyline points='20,90 120,20' style='stroke-width: 4;' />
<text x='72' y='104' text-anchor='middle' style='font-size: 9.00px; font-family: "Arial";'>Dose (mg)</text>
</svg>`;

  try {
    await MFC_PROJECT.createProject({ name: 'Vectors', width: 1200, height: 900, unit: 'px', dpi: 300 });
    await frame();

    // ================= Import =================
    assert('The import button and file picker take SVG plots and PDF pages', /SVG, PDF, EMF or WMF plots \(they stay vector\)/.test($('btn-import').title) && /\.svg/.test($('file-input').accept) && /\.pdf/.test($('file-input').accept));
    const steps = MFC.getHistory().labels.length;
    await MFC.importFiles([svgFile('growth.svg', MPL)]); await idle();
    let plot = vectors()[0];
    assert('An SVG becomes one vector panel, named by its file', vectors().length === 1 && plot.mfcFileName === 'growth.svg' && !errors.length, errors.join(' | '));
    assert('…at its size on paper: 3.2 × 2.4 in is 960 × 720 px at 300 dpi', plot.width === 960 && plot.height === 720 && plot.scaleX === 1 && plot.mfcVectorDpi === 300);
    assert('…its file stored once as a project source', /^src-[0-9a-f]{64}$/.test(plot.mfcVectorSource) && MFC_PROJECT.sources.get(plot.mfcVectorSource).format === 'svg');
    assert('…in one History step, named by the file', MFC.getHistory().labels.length === steps + 1 && /growth\.svg/.test(MFC.getHistory().labels.at(-1)), MFC.getHistory().labels.at(-1));
    assert('The Layers panel says it is vector', /growth\.svg \(vector\)/.test($('layers-list') ? $('layers-list').textContent : document.body.textContent));
    assert('A message says it stays vector, and which fonts the embedded faces replace', toasts.some(m => /growth\.svg is a vector panel: it stays vector in SVG and PDF export/.test(m) && /Liberation fonts \(instead of DejaVu Sans\)/.test(m)), toasts.at(-1));
    const el = plot.getElement();
    const drawn = document.createElement('canvas'); drawn.width = 960; drawn.height = 720;
    const dctx = drawn.getContext('2d'); dctx.drawImage(el, 0, 0);
    const k = 960 / 230.4; // document pixels per SVG unit
    assert('It is drawn on the canvas: the blue line at its place, white beside it', el.width === 960 && isBlue(pixel(dctx, 117.1 * k, 83.8 * k)) && isWhite(pixel(dctx, 60 * k, 40 * k)), pixel(dctx, 117.1 * k, 83.8 * k).join());
    plot.set({ left: 100, top: 100 }); plot.setCoords(); MFC.pushHistory();

    // ================= SVG export =================
    let out = await MFC_EXPORT.buildSVG({ page: 0 });
    const prefix = 'v' + plot.mfcId + '-';
    assert('SVG export writes the plot\'s own elements, not an image', !/<image /.test(out.svg) && /<path d="M 36\.9 144\.3 L 117\.1 83\.8 L 199\.2 23\.3"/.test(out.svg));
    assert('…its ids renamed for the panel, and their references', out.svg.includes(`id="${prefix}p1a2b"`) && out.svg.includes(`clip-path="url(#${prefix}p1a2b)"`) &&
      out.svg.includes(`href="#${prefix}m0"`) && !/id="p1a2b"/.test(out.svg));
    assert('…its CSS limited to the panel: "*" does not reach the rest of the figure', out.svg.includes(`#${prefix}scope *{stroke-linejoin: round`) &&
      out.svg.split('*{stroke-linejoin').length === out.svg.split(`#${prefix}scope *{stroke-linejoin`).length);
    assert('…its text as text, in the embedded Liberation Sans', /<text[^>]*font-family: 'Liberation Sans'[^>]*>Time \(min\) µ<\/text>/.test(out.svg) &&
      /@font-face\{font-family:'Liberation Sans';font-style:normal;font-weight:400/.test(out.svg) && /font-family:'Liberation Sans';font-style:normal;font-weight:700/.test(out.svg));
    assert('…and the export\'s fonts list its characters (for the PDF glyph check)', out.fonts.some(f => f.family === 'Liberation Sans' && f.style === 'normal' && f.text.includes('µ')) && out.fonts.some(f => f.style === 'bold' && f.text === 'Growth'));
    const png = await MFC_EXPORT.buildPNG({ page: 0 });
    const bitmap = await createImageBitmap(png.blob), pc = document.createElement('canvas'); pc.width = bitmap.width; pc.height = bitmap.height;
    const pctx = pc.getContext('2d'); pctx.drawImage(bitmap, 0, 0);
    assert('A raster export (PNG, as TIFF) draws the plot where the canvas does', isBlue(pixel(pctx, 100 + 117.1 * k, 100 + 83.8 * k)) && isWhite(pixel(pctx, 100 + 60 * k, 100 + 40 * k)), pixel(pctx, 100 + 117.1 * k, 100 + 83.8 * k).join());
    const tiff = await MFC_EXPORT.buildTIFF({ page: 0 });
    assert('TIFF export builds', tiff.blob.size > 1000 && tiff.pixelWidth === 1200);

    // ================= PDF export =================
    const pdfOut = await MFC_EXPORT.buildPDF({});
    const pdfBytes = new Uint8Array(await pdfOut.blob.arrayBuffer()), pdfText = new TextDecoder('latin1').decode(pdfBytes);
    assert('PDF export keeps it vector: no image in the file', !/\/Subtype\s*\/Image/.test(pdfText));
    const doc = await pdfjs.getDocument({ data: pdfBytes, isEvalSupported: false, standardFontDataUrl: new URL('assets/vendor/pdfjs/standard_fonts/', document.baseURI).href }).promise;
    const page = await doc.getPage(1), words = (await page.getTextContent()).items.map(i => i.str).join(' ');
    assert("…its text is real text in the PDF (pdf.js reads the micro sign as μ)", /Time \(min\) [µμ]/.test(words) && /Growth/.test(words), words);
    const vp = page.getViewport({ scale: 300 / 72 }), rc = document.createElement('canvas'); rc.width = Math.round(vp.width); rc.height = Math.round(vp.height);
    const rctx = rc.getContext('2d'); await page.render({ canvas: rc, canvasContext: rctx, viewport: vp }).promise;
    assert('…and it is drawn where the canvas draws it', isBlue(pixel(rctx, 100 + 117.1 * k, 100 + 83.8 * k)) && isWhite(pixel(rctx, 100 + 60 * k, 100 + 40 * k)), pixel(rctx, 100 + 117.1 * k, 100 + 83.8 * k).join());
    await doc.destroy?.();

    // ================= Editing =================
    assert('A vector panel takes a panel letter', LET.isPanel(plot));
    plot.set({ cropX: 120, cropY: 0, width: 600, height: 720, left: 100 + 120 }); plot.setCoords(); MFC.pushHistory();
    out = await MFC_EXPORT.buildSVG({ page: 0 });
    assert('A crop: the export clips to it and shifts the plot', out.svg.includes(`<rect x="-300" y="-360" width="600" height="720"/>`) && out.svg.includes('translate(-420 -360)'));
    canvas.setActiveObject(plot); MFC.uncropImage(plot); await idle();
    assert('Uncrop gives the whole plot back', plot.cropX === 0 && plot.width === 960 && near(plot.left, 100));
    // Copy and paste: a second panel of the same source, with its own ids in an export.
    canvas.setActiveObject(plot); MFC.copySelection(); await MFC.pasteSelection(); await idle();
    const [first, copy] = vectors();
    assert('Copy and paste makes a second vector panel of the same source', vectors().length === 2 && copy.mfcVectorSource === first.mfcVectorSource && copy.mfcId !== first.mfcId);
    copy.set({ left: 100, top: 100, scaleX: 0.5, scaleY: 0.5 }); copy.setCoords(); first.set({ left: 600 }); first.setCoords(); MFC.pushHistory();
    out = await MFC_EXPORT.buildSVG({ page: 0 });
    const idsOf = s => [...s.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
    assert('…and in an export, every id stays unique', idsOf(out.svg).length === new Set(idsOf(out.svg)).size && out.svg.includes(`id="v${copy.mfcId}-p1a2b"`));
    await MFC.undo(); await MFC.undo(); await idle();
    assert('Undo takes the copy away', vectors().length === 1);

    // ---- a second kind: svglite ----
    await MFC.importFiles([svgFile('dose.svg', SVGLITE)]); await idle();
    const dose = vectors().find(o => o.mfcFileName === 'dose.svg');
    assert('An svglite plot: 2 × 1.5 in, 600 × 450 px', dose && dose.width === 600 && dose.height === 450);
    out = await MFC_EXPORT.buildSVG({ page: 0 });
    assert('…its root class rules still apply inside the panel (scoped to it)', out.svg.includes(`#v${dose.mfcId}-scope .svglite polyline, #v${dose.mfcId}-scope .svglite circle`) && /class="svglite"/.test(out.svg));
    assert('…and its Arial text uses Liberation Sans', /<text[^>]*font-family: 'Liberation Sans'[^>]*>Dose \(mg\)<\/text>/.test(out.svg));

    // ---- save and reopen ----
    const plotId = plot.mfcId;
    plot = vectors().find(o => o.mfcId === plotId); // undo made the canvas objects again
    plot.set({ cropX: 120, width: 600 }); plot.setCoords(); MFC.pushHistory();
    const next = MFC_PROJECT.prepareSave(true, 'vectors'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
    const zip = await JSZip.loadAsync(archive), sources = Object.keys(zip.files).filter(n => n.startsWith('sources/') && !zip.files[n].dir);
    const state = JSON.parse(await zip.file('versions/' + next.currentVersionId + '.json').async('string'));
    const saved = state.objects.find(o => o.mfcId === plotId);
    assert('The saved project stores each SVG once, and the panel by its source (no picture of it)', sources.length === 2 && saved && saved.type === 'mfcVector' && saved.sourceId === plot.mfcVectorSource && !('src' in saved) && saved.cropX === 120,
      JSON.stringify({ sources, saved: saved && { type: saved.type, cropX: saved.cropX, src: 'src' in saved } }));
    await MFC.closeDocument();
    await MFC_PROJECT.loadProject(new File([archive], 'vectors.fluoforge'));
    document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
    await idle();
    plot = vectors().find(o => o.mfcId === plotId);
    assert('Reopened: the vector panels, their place, size and crop', vectors().length === 2 && plot && plot.cropX === 120 && plot.width === 600 && plot.height === 720 && plot.getElement().width === 960);
    out = await MFC_EXPORT.buildSVG({ page: 0 });
    assert('…and they still export as vector', !/<image /.test(out.svg) && out.svg.includes('Dose (mg)'));

    // ---- templates ----
    const template = TM.templateFromState(MFC_PROJECT.captureState(), 'With plots', '0');
    assert('Save as template turns a plot into an empty frame, without its source', template.objects.filter(o => o.mfcType === 'imageFrame').length === 2 && !TM.holdsImageData(template.objects) && !template.objects.some(o => o.mfcVectorSource),
      JSON.stringify(template.objects.map(o => o.mfcType)));

    // ================= Refusals =================
    const before = vectors().length;
    errors.length = 0;
    const bad = [
      ['script.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>', /contains scripts, which a figure cannot carry/],
      ['onload.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><rect width="5" height="5"/></svg>', /event handlers/],
      ['html.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject width="5" height="5"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>', /HTML content \(foreignObject\)/],
      ['link.svg', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><image xlink:href="https://example.org/a.png" width="5" height="5"/></svg>', /links to files outside it \(https:\/\/example\.org\/a\.png\)/],
      ['css.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>@import url("x.css");</style><rect width="5" height="5"/></svg>', /links to files outside it \(x\.css\)/],
      ['nosize.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>', /has no size/],
      ['broken.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect', /not a readable SVG file/],
      ['html.svg', '<html><body>no</body></html>', /not a readable SVG file/]
    ];
    for (const [name, text, re] of bad) {
      errors.length = 0;
      await MFC.importFiles([svgFile(name, text)]);
      assert(`${name} is refused with a message`, errors.length === 1 && re.test(errors[0]), errors[0]);
    }
    assert('…and nothing was added', vectors().length === before);

    // ================= A PDF page as an image (the fallback) =================
    const { jsPDF } = window.jspdf;
    const made = new jsPDF({ unit: 'pt', format: [144, 72], orientation: 'landscape' });
    made.setFillColor(31, 119, 180); made.rect(0, 0, 72, 72, 'F'); made.setFont('helvetica', 'normal'); made.setFontSize(28); made.setTextColor(0, 0, 0); made.text('Ab', 84, 48); /* Helvetica: not embedded */ made.addPage([144, 72], 'landscape'); made.setFillColor(214, 39, 40); made.rect(72, 0, 72, 72, 'F');
    const pdfFile = new File([made.output('blob')], 'plots.pdf', { type: 'application/pdf' });
    // Two pages: a dialog asks which; Escape imports nothing.
    errors.length = 0;
    let settled = false;
    const asked = MFC.importFiles([pdfFile]).then(() => { settled = true; });
    for (let i = 0; i < 400 && !document.querySelector('.pdf-page-modal') && !errors.length && !settled; i++) await new Promise(r => setTimeout(r, 30));
    const dialog = document.querySelector('.pdf-page-modal');
    assert('A PDF of two pages: a dialog asks which, and as vector or as an image rasterised at 300 dpi', dialog && $('pdf-page').max === '2' && /rasterised at the document's 300 dpi/.test(dialog.textContent) &&
      [...dialog.querySelectorAll('input, select, button')].every(e => e.title || e.closest('label')?.title) && document.activeElement === $('pdf-page'), JSON.stringify({ settled, errors, toast: toasts.at(-1) }));
    $('pdf-page').value = '3'; $('pdf-page').dispatchEvent(new Event('input'));
    assert('…a page that does not exist is refused', $('pdf-page-ok').disabled && /between 1 and 2/.test(dialog.querySelector('.export-error').textContent));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await asked; await idle();
    assert('…Escape imports nothing', !document.querySelector('.pdf-page-modal') && !canvas.getObjects().some(o => o.mfcRasterised));
    toasts.length = 0;
    const raster = await PDFI.importPDF(pdfFile, { page: 2, as: 'image' }); await idle();
    assert('Page 2 becomes an image panel, labelled as rasterised', raster && raster.mfcType === 'mfcImage' && raster.mfcFileName === 'plots.pdf, page 2 (rasterised at 300 dpi)' &&
      JSON.stringify(raster.mfcRasterised) === '{"from":"pdf","file":"plots.pdf","page":2,"pages":2,"dpi":300}', raster && raster.mfcFileName);
    assert('…at the page\'s size on paper (2 × 1 in at 300 dpi)', near(raster.getScaledWidth(), 600, 1) && near(raster.getScaledHeight(), 300, 1) && MFC.getRegistry()[raster.mfcId].rawImage.width === 600);
    const rr = MFC.getRegistry()[raster.mfcId].rawImage, at = (x, y) => rr.channels.map(c => c.data[y * rr.width + x]);
    assert('…showing that page (red on its right half, white on its left)', at(450, 150).every((v, i) => Math.abs(v - [214, 39, 40][i]) <= 3) && at(100, 150).join() === '255,255,255', at(450, 150).join() + ' / ' + at(100, 150).join());
    assert('…and a message says it is not vector, and that vector is the default', toasts.some(m => /rasterised at 300 dpi: it is an image, not vector/.test(m) && /Import it as vector \(the default\)/.test(m)));
    raster.set({ left: 50, top: 500 }); raster.setCoords();
    const findings = RULES.runChecks(CHECK.buildCheckContext()).filter(f => f.rule === 'rasterised');
    assert('The figure check lists it as rasterised', findings.length === 1 && findings[0].severity === 'info' && /page 2 of a PDF, rasterised at 300 dpi/.test(findings[0].message));
    assert('The Layers panel names it as rasterised', /plots\.pdf, page 2 \(rasterised at 300 dpi\)/.test(document.body.textContent));
    const one = await PDFI.importPDF(pdfFile, { page: 1, as: 'image' }); await idle();
    const r1 = MFC.getRegistry()[one.mfcId].rawImage;
    let dark = 0;
    for (let y = 60; y < 240; y++) for (let x = 330; x < 590; x++) if (r1.channels[0].data[y * r1.width + x] < 100) dark++;
    assert('A standard font the PDF does not embed (Helvetica) is drawn, with the bundled faces', dark > 500 && r1.channels[2].data[150 * r1.width + 100] > 150, dark);
    errors.length = 0;
    await MFC.importFiles([new File(['not a pdf'], 'broken.pdf', { type: 'application/pdf' })]);
    assert('A file that is not a PDF is refused with a message', errors.length === 1 && /broken\.pdf is not a readable PDF file/.test(errors[0]), errors[0]);
  } finally {
    MFC_UI.toast = toast; MFC_ERRORS.report = report;
    document.querySelectorAll('.pdf-page-backdrop').forEach(b => b.remove());
  }
  return checks;
}

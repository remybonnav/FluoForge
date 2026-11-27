/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T10a: a PDF page imported as a vector panel (the pure part: tests/pdf-vector-model-regression.mjs).
   Small PDFs are written here, each drawing what plotting tools draw:
   - fills, a dashed stroke, a clip, 50 % transparency, a curve and Helvetica text become SVG paths,
     a clip, opacity and text; the panel is drawn where pdf.js draws the page; it is at the page's
     size on paper, named by the file, `mfcConverted` records where it came from, its source is SVG;
   - SVG export writes it as elements (text as text, in Liberation Sans), PDF export keeps it vector
     (no image, real text) and draws it in place; save and reopen keep it;
   - a font Liberation does not stand in for (Symbol) is drawn by its outlines; an image in the page
     is embedded; a rotated page, a form XObject (clipped to its box) and a gradient;
   - several pages: the dialog asks which page and how (vector or image); a page as image is the
     labelled rasterised fallback;
   - what it cannot reproduce (a blend mode): a dialog offers the page as an image instead, or the
     import fails with a message when vector was asked for. */
async function runPdfVectorRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const PDFI = await import(new URL('js/image/pdf-import.js', document.baseURI).href);
  const pdfjs = await import(new URL('assets/vendor/pdfjs/pdf.min.mjs', document.baseURI).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
  const idle = async () => { await MFC_TIFF.whenIdle(); await frame(); };
  const toasts = [], errors = [];
  const toast = MFC_UI.toast, report = MFC_ERRORS.report;
  MFC_UI.toast = m => { toasts.push(m); toast(m); };
  MFC_ERRORS.report = (e, o) => { errors.push((o && o.title ? o.title + ': ' : '') + e.message); };
  const vectors = () => canvas.getObjects().filter(o => o.mfcType === 'mfcVector');
  const K = 300 / 72; // document pixels per point at 300 dpi

  /** A PDF file of one page: `content` (its drawing operators), `resources`, extra objects from 5 on. */
  function makePDF(name, { width = 144, height = 72, content, resources = '', extra = [], rotate = 0 }) {
    const objects = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} ${height}]${rotate ? `/Rotate ${rotate}` : ''}/Resources<<${resources}>>/Contents 4 0 R>>`,
      `<</Length ${content.length}>>\nstream\n${content}\nendstream`, ...extra];
    let out = '%PDF-1.4\n';
    const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
    return new File([Uint8Array.from(out, c => c.charCodeAt(0))], name, { type: 'application/pdf' });
  }
  const stream = (dict, body) => `<<${dict}/Length ${body.length}>>\nstream\n${body}\nendstream`;
  /** The panel as the canvas draws it, on white, at its natural size. */
  function drawn(obj) {
    const el = obj.getElement(), c = document.createElement('canvas'); c.width = el.width; c.height = el.height;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(el, 0, 0);
    return (xPt, yPt) => [...ctx.getImageData(Math.round(xPt * K), Math.round(yPt * K), 1, 1).data];
  }
  const sourceText = async obj => (await MFC_PROJECT.sources.get(obj.mfcVectorSource).blob.text());
  const is = (rgb, want, tol = 40) => want.every((v, i) => Math.abs(rgb[i] - v) <= tol);
  const BLUE = [31, 119, 180], RED = [214, 39, 40], GREEN = [0, 153, 0], WHITE = [255, 255, 255];

  // A plot-like page, 2 × 1 in. y goes up in PDF: SVG y = 72 - PDF y.
  const PLOT = [
    'q 0.1216 0.4667 0.7059 rg 0 0 72 72 re f Q', // blue square on the left half
    'q 0.8392 0.1529 0.1569 RG 4 w [6 3] 0 d 80 60 m 140 60 l S Q', // red dashed line
    'q 80 30 m 140 30 l 140 45 l 80 45 l h W n 0 0.6 0 rg 0 0 144 72 re f Q', // green, clipped to a band
    'q /GA gs 0 0 0 rg 80 5 20 10 re f Q', // 50 % black
    'q 0 0 0 RG 0.5 w 76 48 m 90 56 120 56 138 48 c S Q', // a curve
    'BT /F1 12 Tf 1 0 0 1 104 8 Tm (Dose) Tj ET'
  ].join('\n');
  const plotFile = makePDF('dose.pdf', { content: PLOT, resources: '/Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>/ExtGState<</GA<</ca 0.5>>>>' });

  try {
    await MFC_PROJECT.createProject({ name: 'PDF vectors', width: 1200, height: 900, unit: 'px', dpi: 300 });
    await frame();

    // ================= One page: a vector panel, no question =================
    const steps = MFC.getHistory().labels.length;
    await MFC.importFiles([plotFile]); await idle();
    let plot = vectors()[0];
    assert('A one-page PDF becomes a vector panel at once, named by its file', vectors().length === 1 && plot.mfcFileName === 'dose.pdf' && !errors.length && !document.querySelector('.pdf-page-modal'), errors.join(' | '));
    assert('…at the page\'s size on paper: 2 × 1 in is 600 × 300 px at 300 dpi', plot.width === 600 && plot.height === 300 && plot.mfcVectorDpi === 300);
    assert('…recording where it came from (mfcConverted), and not as rasterised', JSON.stringify(plot.mfcConverted) === '{"from":"pdf","file":"dose.pdf","page":1,"pages":1}' && !plot.mfcRasterised);
    assert('…its project source is the page as SVG', MFC_PROJECT.sources.get(plot.mfcVectorSource).format === 'svg' && MFC_PROJECT.sources.get(plot.mfcVectorSource).name === 'dose.pdf');
    assert('…in one History step, and a message says it stays vector', MFC.getHistory().labels.length === steps + 1 && toasts.some(m => /^dose\.pdf is a vector panel: it stays vector in SVG and PDF export/.test(m)), toasts.at(-1));
    const svg = await sourceText(plot);
    assert('The SVG has the page\'s size in points', /<svg [^>]*width="144pt" height="72pt" viewBox="0 0 144 72"/.test(svg), svg.slice(0, 200));
    assert('…paths with their colours, the dash and the curve', /fill="#1f77b4"/.test(svg) && /stroke="#d62728" stroke-width="4"[^>]*stroke-dasharray="6 3"/.test(svg) && /C\d/.test(svg), svg.slice(0, 600));
    assert('…the clip and the transparency', /<clipPath id="c\d+" clipPathUnits="userSpaceOnUse"><path d="M80 42L140 42L140 27L80 27Z"\/><\/clipPath>/.test(svg) && /fill-opacity="0\.5"/.test(svg));
    assert('…and the text as text, in Helvetica (Liberation Sans has its widths)', /<text transform="matrix\(1 0 0 1 104 64\)" font-family="Helvetica" font-size="12" fill="#000000">Dose<\/text>/.test(svg), svg.match(/<text[^>]*>[^<]*<\/text>/)?.[0]);
    let px = drawn(plot);
    assert('It is drawn on the canvas as the PDF is: blue on the left, white beside it', is(px(36, 36), BLUE) && is(px(110, 26), WHITE), px(36, 36).join() + ' / ' + px(110, 26).join());
    assert('…green inside the clip only', is(px(110, 34.5), GREEN) && is(px(110, 22), WHITE) && is(px(77, 34.5), WHITE), px(110, 34.5).join() + ' / ' + px(77, 34.5).join());
    assert('…the dashed line: a dash, then a gap', is(px(110, 12), RED) && is(px(87.5, 12), WHITE), px(110, 12).join() + ' / ' + px(87.5, 12).join());
    assert('…the 50 % black as grey', is(px(90, 62), [128, 128, 128], 12), px(90, 62).join());
    let dark = 0;
    for (let y = 58; y < 66; y += 0.5) for (let x = 104; x < 130; x += 0.5) if (px(x, y)[0] < 100) dark++;
    assert('…and the text', dark > 20, dark);
    plot.set({ left: 100, top: 100 }); plot.setCoords(); MFC.pushHistory();

    // ---- exports ----
    const out = await MFC_EXPORT.buildSVG({ page: 0 });
    assert('SVG export writes the page as elements, its text as text in Liberation Sans', !/<image /.test(out.svg) && /<text [^>]*font-family="'Liberation Sans'"[^>]*>Dose<\/text>/.test(out.svg) &&
      out.fonts.some(f => f.family === 'Liberation Sans' && f.text.includes('Dose')), out.svg.match(/<text[^>]*>Dose<\/text>/)?.[0]);
    const pdfOut = await MFC_EXPORT.buildPDF({});
    const bytes = new Uint8Array(await pdfOut.blob.arrayBuffer());
    assert('PDF export keeps it vector: no image in the file', !/\/Subtype\s*\/Image/.test(new TextDecoder('latin1').decode(bytes)));
    const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, standardFontDataUrl: new URL('assets/vendor/pdfjs/standard_fonts/', document.baseURI).href }).promise;
    const page = await doc.getPage(1), words = (await page.getTextContent()).items.map(i => i.str).join(' ');
    assert('…its text is real text', /Dose/.test(words), words);
    const vp = page.getViewport({ scale: 300 / 72 }), rc = document.createElement('canvas'); rc.width = Math.round(vp.width); rc.height = Math.round(vp.height);
    const rctx = rc.getContext('2d'); await page.render({ canvas: rc, canvasContext: rctx, viewport: vp }).promise;
    const at = (xPt, yPt) => [...rctx.getImageData(Math.round(100 + xPt * K), Math.round(100 + yPt * K), 1, 1).data];
    assert('…drawn where the canvas draws it (blue, green in the clip, the dash)', is(at(36, 36), BLUE) && is(at(110, 34.5), GREEN) && is(at(110, 12), RED) && is(at(110, 22), WHITE), [at(36, 36), at(110, 34.5), at(110, 12)].join(' / '));
    await doc.destroy?.();

    // ---- save and reopen ----
    const plotId = plot.mfcId;
    const next = MFC_PROJECT.prepareSave(true, 'pdf-vectors'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
    await MFC.closeDocument();
    await MFC_PROJECT.loadProject(new File([archive], 'pdf-vectors.fluoforge'));
    document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
    await idle();
    plot = vectors().find(o => o.mfcId === plotId);
    assert('Saved and reopened: the panel, its place and where it came from', plot && near(plot.left, 100) && plot.width === 600 && plot.mfcConverted && plot.mfcConverted.file === 'dose.pdf');
    px = drawn(plot);
    assert('…drawn again from its SVG source', is(px(36, 36), BLUE) && is(px(110, 34.5), GREEN));

    // ================= Fonts, images, rotation, forms, gradients =================
    const symbol = makePDF('greek.pdf', { width: 72, height: 72, content: 'BT /F2 48 Tf 1 0 0 1 12 20 Tm (m) Tj ET', resources: '/Font<</F2<</Type/Font/Subtype/Type1/BaseFont/Symbol>>>>' });
    const greek = await PDFI.importPDF(symbol); await idle();
    const greekSVG = await sourceText(greek);
    assert('A font Liberation does not stand in for (Symbol) is drawn by its own outlines, not as text', greek.mfcType === 'mfcVector' && !/<text/.test(greekSVG) && /<path d="M[^"]{40,}" fill="#000000"\/>/.test(greekSVG), greekSVG.slice(0, 300));
    px = drawn(greek); dark = 0;
    for (let y = 20; y < 70; y++) for (let x = 12; x < 45; x++) if (px(x, y)[0] < 100) dark++;
    assert('…and the glyph (µ) is drawn', dark > 100, dark);

    const { jsPDF } = window.jspdf;
    const tile = document.createElement('canvas'); tile.width = 2; tile.height = 1;
    const tctx = tile.getContext('2d'); tctx.fillStyle = '#d62728'; tctx.fillRect(0, 0, 1, 1); tctx.fillStyle = '#1f77b4'; tctx.fillRect(1, 0, 1, 1);
    const withImage = new jsPDF({ unit: 'pt', format: [144, 72], orientation: 'landscape' });
    withImage.addImage(tile, 'PNG', 0, 0, 144, 72);
    const heat = await PDFI.importPDF(new File([withImage.output('blob')], 'heat.pdf', { type: 'application/pdf' })); await idle();
    const heatSVG = await sourceText(heat);
    assert('An image in the page (a heat map) is embedded as PNG, its pixels kept sharp', heat.mfcType === 'mfcVector' && /<image [^>]*style="image-rendering:pixelated" href="data:image\/png;base64,/.test(heatSVG), heatSVG.slice(0, 300));
    px = drawn(heat);
    assert('…drawn in place: its left pixel red, its right one blue', is(px(30, 36), RED) && is(px(110, 36), BLUE), px(30, 36).join() + ' / ' + px(110, 36).join());

    const form = stream('/Type/XObject/Subtype/Form/BBox[0 0 10 10]', '0.1216 0.4667 0.7059 rg 0 0 20 20 re f');
    const rotated = makePDF('turned.pdf', { content: 'q 1 0 0 1 100 20 cm /X1 Do Q', resources: '/XObject<</X1 5 0 R>>', extra: [form], rotate: 90 });
    const turned = await PDFI.importPDF(rotated); await idle();
    assert('A page turned by 90° (/Rotate) is imported upright: 1 × 2 in', turned.width === 300 && turned.height === 600, turned.width + ' × ' + turned.height);
    const ref = await PDFI.renderPage(await pdfjs.getDocument({ data: new Uint8Array(await rotated.arrayBuffer()), isEvalSupported: false }).promise, 1, 300);
    const rpx = (x, y) => [...ref.getContext('2d').getImageData(Math.round(x * K), Math.round(y * K), 1, 1).data];
    px = drawn(turned);
    assert('…a form XObject drawn where pdf.js draws it, clipped to its box', is(rpx(25, 105), BLUE) && is(px(25, 105), BLUE) && is(rpx(25, 113), WHITE) && is(px(25, 113), WHITE) && is(px(33, 105), WHITE),
      [rpx(25, 105), px(25, 105), px(25, 113), px(33, 105)].join(' / '));

    const shade = '<</ShadingType 2/ColorSpace/DeviceRGB/Coords[0 0 144 0]/Function<</FunctionType 2/Domain[0 1]/C0[1 0 0]/C1[0 0 1]/N 1>>/Extend[true true]>>';
    const graded = await PDFI.importPDF(makePDF('ramp.pdf', { content: '/Pattern cs /P1 scn 0 0 144 72 re f', resources: `/Pattern<</P1<</PatternType 2/Shading ${shade}>>>>` })); await idle();
    const rampSVG = await sourceText(graded);
    px = drawn(graded);
    assert('A gradient fill becomes an SVG gradient, red to blue', /<linearGradient [^>]*gradientUnits="userSpaceOnUse"/.test(rampSVG) && px(4, 36)[0] > 200 && px(140, 36)[2] > 200 && px(140, 36)[0] < 60, px(4, 36).join() + ' / ' + px(140, 36).join());

    const cell = stream('/PatternType 1/PaintType 1/TilingType 1/BBox[0 0 10 10]/XStep 10/YStep 10/Resources<<>>', '0.8392 0.1529 0.1569 rg 0 0 5 10 re f');
    const hatched = await PDFI.importPDF(makePDF('stripes.pdf', { content: '/Pattern cs /P1 scn 0 0 144 72 re f', resources: '/Pattern<</P1 5 0 R>>', extra: [cell] })); await idle();
    const stripesSVG = await sourceText(hatched);
    px = drawn(hatched);
    assert('A tiling pattern (as matplotlib\'s hatching) becomes an SVG pattern of its cell: red stripes 5 pt wide every 10 pt', hatched.mfcType === 'mfcVector' && /<pattern id="p\d+" patternUnits="userSpaceOnUse"/.test(stripesSVG) &&
      is(px(2.5, 36), RED) && is(px(7.5, 36), WHITE) && is(px(12.5, 36), RED) && is(px(102.5, 36), RED), [px(2.5, 36), px(7.5, 36), px(12.5, 36)].join(' / '));

    // ================= Several pages: which, and how =================
    const made = new jsPDF({ unit: 'pt', format: [144, 72], orientation: 'landscape' });
    made.setFillColor(31, 119, 180); made.rect(0, 0, 72, 72, 'F'); made.addPage([144, 72], 'landscape'); made.setFillColor(214, 39, 40); made.rect(72, 0, 72, 72, 'F');
    const twoPages = new File([made.output('blob')], 'plots.pdf', { type: 'application/pdf' });
    errors.length = 0;
    let settled = false;
    let asked = MFC.importFiles([twoPages]).then(() => { settled = true; });
    for (let i = 0; i < 400 && !document.querySelector('.pdf-page-modal') && !errors.length && !settled; i++) await new Promise(r => setTimeout(r, 30));
    let dialog = document.querySelector('.pdf-page-modal');
    assert('Two pages: a dialog asks which page, and as vector or as an image', dialog && $('pdf-page').max === '2' && $('pdf-as').value === 'vector' &&
      [...$('pdf-as').options].map(o => o.value).join() === 'vector,image' && /rasterised at the document's 300 dpi/.test(dialog.textContent) &&
      [...dialog.querySelectorAll('input, select, button')].every(e => e.title || e.closest('label')?.title), JSON.stringify({ settled, errors }));
    $('pdf-page').value = '2'; $('pdf-page').dispatchEvent(new Event('input'));
    $('pdf-page-ok').click();
    await asked; await idle();
    const second = vectors().at(-1);
    assert('Page 2 as vector: named by file and page', second.mfcFileName === 'plots.pdf, page 2' && JSON.stringify(second.mfcConverted) === '{"from":"pdf","file":"plots.pdf","page":2,"pages":2}' &&
      toasts.some(m => /^Page 2 of plots\.pdf is a vector panel/.test(m)), second.mfcFileName);
    px = drawn(second);
    assert('…showing that page (red on its right half)', is(px(110, 36), RED) && is(px(36, 36), WHITE), px(110, 36).join());
    settled = false;
    asked = MFC.importFiles([twoPages]).then(() => { settled = true; });
    for (let i = 0; i < 400 && !document.querySelector('.pdf-page-modal') && !settled; i++) await new Promise(r => setTimeout(r, 30));
    $('pdf-as').value = 'image';
    $('pdf-page-ok').click();
    await asked; await idle();
    const image = canvas.getActiveObject();
    assert('"Image" in the dialog: the labelled rasterised fallback', image.mfcType === 'mfcImage' && image.mfcFileName === 'plots.pdf, page 1 (rasterised at 300 dpi)' &&
      toasts.some(m => /rasterised at 300 dpi: it is an image, not vector\. Import it as vector \(the default\)/.test(m)), image.mfcFileName);

    // ================= What it cannot reproduce =================
    const blend = makePDF('blend.pdf', { width: 72, height: 72, content: '/GB gs 1 0 0 rg 0 0 72 72 re f', resources: '/ExtGState<</GB<</BM/Multiply>>>>' });
    const before = canvas.getObjects().length;
    settled = false; errors.length = 0;
    asked = MFC.importFiles([blend]).then(() => { settled = true; });
    for (let i = 0; i < 400 && !document.querySelector('.pdf-page-modal') && !errors.length && !settled; i++) await new Promise(r => setTimeout(r, 30));
    dialog = document.querySelector('.pdf-page-modal');
    assert('A page with a blend mode: a dialog says what cannot be reproduced and offers an image', dialog && /Import this PDF page as an image\?/.test(dialog.textContent) &&
      [...dialog.querySelectorAll('.pdf-issues li')].map(li => li.textContent).join() === 'blend modes other than normal' && $('pdf-page-ok').textContent === 'Import as image' && document.activeElement === $('pdf-page-ok'),
      JSON.stringify({ settled, errors, text: dialog && dialog.textContent }));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await asked; await idle();
    assert('…Escape imports nothing', canvas.getObjects().length === before && !document.querySelector('.pdf-page-modal'));
    settled = false;
    asked = MFC.importFiles([blend]).then(() => { settled = true; });
    for (let i = 0; i < 400 && !document.querySelector('.pdf-page-modal') && !settled; i++) await new Promise(r => setTimeout(r, 30));
    $('pdf-page-ok').click();
    await asked; await idle();
    const fallback = canvas.getActiveObject();
    assert('…"Import as image": rasterised and labelled, the message says why', fallback.mfcType === 'mfcImage' && fallback.mfcRasterised && fallback.mfcRasterised.file === 'blend.pdf' &&
      toasts.some(m => /blend\.pdf was rasterised at 300 dpi: it is an image, not vector\. The vector import could not reproduce its blend modes other than normal\./.test(m)), toasts.at(-1));
    let thrown = null;
    try { await PDFI.importPDF(blend, { as: 'vector' }); } catch (e) { thrown = e; }
    assert('Asked for vector only, such a page fails with a message instead', thrown && /blend\.pdf cannot be imported as vector: it uses blend modes other than normal/.test(thrown.message), thrown && thrown.message);
  } finally {
    MFC_UI.toast = toast; MFC_ERRORS.report = report;
    document.querySelectorAll('.pdf-page-backdrop').forEach(b => b.remove());
  }
  return checks;
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T10c: EPS files imported as vector panels (the interpreter itself: tests/postscript-regression.mjs).
   - an R-like EPS (a filled bar, a dashed line, Helvetica and Times-Bold text re-encoded in ISO Latin 1,
     an image from hex data after the image operator) becomes a vector panel at its bounding box's
     size, named by its file, `mfcConverted` saying where it came from, its source an SVG; it is drawn
     where the program draws; the Liberation faces it needs are loaded for their widths; SVG export
     writes its text as text, PDF export keeps it vector; save and reopen keep it;
   - a file using what cannot be reproduced (the outline of a stroke): the dialog lists it; Escape imports
     nothing, "Import anyway" imports it and says what is missing; asked not to, it fails;
   - a file that is not EPS is refused with a message. */
async function runEpsImportRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const EI = await import(new URL('js/image/eps-import.js', document.baseURI).href);
  const pdfjs = await import(new URL('assets/vendor/pdfjs/pdf.min.mjs', document.baseURI).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
  const idle = async () => { await MFC_TIFF.whenIdle(); await frame(); };
  const toasts = [], errors = [];
  const toast = MFC_UI.toast, report = MFC_ERRORS.report;
  MFC_UI.toast = m => { toasts.push(m); toast(m); };
  MFC_ERRORS.report = (e, o) => { errors.push((o && o.title ? o.title + ': ' : '') + e.message); };
  const vectors = () => canvas.getObjects().filter(o => o.mfcType === 'mfcVector');
  const is = (rgb, want, tol = 40) => want.every((v, i) => Math.abs(rgb[i] - v) <= tol);
  const BLUE = [31, 119, 180], RED = [214, 39, 40], WHITE = [255, 255, 255];
  const K = 300 / 72; // document pixels per point
  /** The panel as the canvas draws it, on white: px(x, y) in points from the top left. */
  function drawn(obj) {
    const el = obj.getElement(), c = document.createElement('canvas'); c.width = el.width; c.height = el.height;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(el, 0, 0);
    return (x, y) => [...ctx.getImageData(Math.round(x * K), Math.round(y * K), 1, 1).data];
  }
  const file = (name, text) => new File([Uint8Array.from(text, c => c.charCodeAt(0) & 0xff)], name, { type: 'application/postscript' });

  // An R-like EPS, 288 × 144 pt (4 × 2 in). y goes up: a point (x, y) is drawn at (x, 144 - y) from the top.
  const PLOT = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 288 144
%%EndComments
/m { moveto } bind def /l { rlineto } bind def /cp { closepath } bind def
/Helvetica findfont dup length dict begin { 1 index /FID ne { def } { pop pop } ifelse } forall /Encoding ISOLatin1Encoding def currentdict end /Font1 exch definefont pop
/Font1 findfont 14 scalefont setfont
0.1216 0.4667 0.7059 setrgbcolor 20 20 m 60 0 l 0 80 l -60 0 l cp fill
0.8392 0.1529 0.1569 setrgbcolor 4 setlinewidth [12 4] 0 setdash 100 120 m 160 0 l stroke [] 0 setdash
0 setgray 100 80 m (Dose \\351) show
/Times-Bold findfont 14 scalefont setfont 100 60 m (Bold) dup stringwidth pop neg 0 rmoveto show
gsave 200 20 translate 60 30 scale 2 1 8 [2 0 0 -1 0 1] { <d62728 1f77b4> } false 3 colorimage grestore
%%EOF
`;
  try {
    await MFC_PROJECT.createProject({ name: 'EPS', width: 1500, height: 1000, unit: 'px', dpi: 300 });
    await frame();
    assert('Import Image takes EPS files', /\.eps/.test($('file-input').accept) && /EPS/.test($('btn-import').title));

    await MFC.importFiles([file('growth.eps', PLOT)]); await idle();
    let panel = vectors()[0];
    assert('An EPS becomes a vector panel, named by its file', vectors().length === 1 && panel.mfcFileName === 'growth.eps' && !errors.length, errors.join(' | '));
    assert('…at its bounding box\'s size: 4 × 2 in is 1200 × 600 px at 300 dpi', near(panel.width, 1200) && near(panel.height, 600), panel.width + ' × ' + panel.height);
    assert('…recording where it came from; its project source is SVG', JSON.stringify(panel.mfcConverted) === '{"from":"eps","file":"growth.eps"}' && MFC_PROJECT.sources.get(panel.mfcVectorSource).format === 'svg');
    assert('…and a message says it stays vector, naming the fonts set in Liberation', toasts.some(m => /^growth\.eps is a vector panel: it stays vector in SVG and PDF export\. Its text is set in the embedded Liberation fonts \(instead of Helvetica, Times\)/.test(m)), toasts.at(-1));
    let px = drawn(panel);
    assert('It is drawn as the program draws: the blue bar, white beside it', is(px(50, 84), BLUE) && is(px(90, 84), WHITE), px(50, 84).join());
    assert('…the dashed red line: a dash, then a gap', is(px(106, 24), RED) && is(px(114, 24), WHITE), px(106, 24).join() + ' / ' + px(114, 24).join());
    assert('…the image: red on its left, blue on its right', is(px(215, 109), RED) && is(px(245, 109), BLUE), px(215, 109).join() + ' / ' + px(245, 109).join());
    const source = await MFC_PROJECT.sources.get(panel.mfcVectorSource).blob.text();
    const bold = /<text transform="matrix\(1 0 0 1 ([\d.]+) 84\)" font-family="Times" font-weight="bold"[^>]*>Bold<\/text>/.exec(source);
    assert('…its text: words where the faces\' widths put them (right-aligned with stringwidth), é from ISO Latin 1', /<text transform="matrix\(1 0 0 1 100 64\)" font-family="Helvetica" font-size="14" fill="#000000">Dose<\/text>/.test(source) &&
      /<text [^>]*>é<\/text>/.test(source) && bold && near(Number(bold[1]), 100 - 14 * (0.667 + 0.5 + 0.278 + 0.556), 0.05), source.match(/<text[^>]*>[^<]*<\/text>/g)?.join(' | '));
    panel.set({ left: 50, top: 50 }); panel.setCoords(); MFC.pushHistory();
    const out = await MFC_EXPORT.buildSVG({ page: 0 });
    assert('SVG export writes its text as text, in Liberation Sans and Serif', /<text [^>]*font-family="'Liberation Sans'"[^>]*>Dose<\/text>/.test(out.svg) && /<text [^>]*font-family="'Liberation Serif'"[^>]*>Bold<\/text>/.test(out.svg));
    const pdfOut = await MFC_EXPORT.buildPDF({});
    const bytes = new Uint8Array(await pdfOut.blob.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: new URL('assets/vendor/pdfjs/standard_fonts/', document.baseURI).href }).promise;
    const page = await doc.getPage(1), words = (await page.getTextContent()).items.map(i => i.str).join(' ');
    assert('PDF export keeps its text as text', /Dose/.test(words) && /Bold/.test(words), words);
    const vp = page.getViewport({ scale: 300 / 72 }), rc = document.createElement('canvas'); rc.width = Math.round(vp.width); rc.height = Math.round(vp.height);
    const rctx = rc.getContext('2d'); await page.render({ canvas: rc, canvasContext: rctx, viewport: vp }).promise;
    const at = (x, y) => [...rctx.getImageData(Math.round(50 + x * K), Math.round(50 + y * K), 1, 1).data];
    assert('…and draws it where the canvas does', is(at(50, 84), BLUE) && is(at(106, 24), RED) && is(at(90, 84), WHITE), [at(50, 84), at(106, 24)].join(' / '));
    await doc.destroy?.();

    // ---- save and reopen ----
    const id = panel.mfcId;
    const next = MFC_PROJECT.prepareSave(true, 'eps'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
    await MFC.closeDocument();
    await MFC_PROJECT.loadProject(new File([archive], 'eps.fluoforge'));
    document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
    await idle();
    panel = vectors().find(o => o.mfcId === id);
    assert('Saved and reopened: the panel and where it came from', panel && near(panel.left, 50) && panel.mfcConverted.from === 'eps');
    px = drawn(panel);
    assert('…drawn again from its SVG source', is(px(50, 84), BLUE) && is(px(215, 109), RED));

    // ================= What cannot be reproduced =================
    const tiled = file('tiled.eps', `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 72 72\n0 0 moveto 72 72 lineto 4 setlinewidth strokepath fill 10 10 20 20 rectfill\n`);
    const before = canvas.getObjects().length;
    let settled = false; errors.length = 0;
    let asked = MFC.importFiles([tiled]).then(() => { settled = true; });
    for (let i = 0; i < 300 && !document.querySelector('.metafile-modal') && !settled && !errors.length; i++) await new Promise(r => setTimeout(r, 20));
    await frame();
    const dialog = document.querySelector('.metafile-modal');
    assert('The outline of a stroke (strokepath): the dialog says what cannot be reproduced', dialog && /Import this EPS with parts missing\?/.test(dialog.textContent) &&
      [...dialog.querySelectorAll('.pdf-issues li')].map(li => li.textContent).join() === 'outlines of strokes (strokepath) and reversed paths' && document.activeElement === $('metafile-cancel'), JSON.stringify({ settled, errors }));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await asked; await idle();
    assert('…Escape imports nothing', canvas.getObjects().length === before && !document.querySelector('.metafile-modal'));
    settled = false;
    asked = MFC.importFiles([tiled]).then(() => { settled = true; });
    for (let i = 0; i < 300 && !document.querySelector('.metafile-modal') && !settled; i++) await new Promise(r => setTimeout(r, 20));
    $('metafile-ok').click();
    await asked; await idle();
    const anyway = canvas.getActiveObject();
    assert('…"Import anyway": the panel, recording and saying what is missing', anyway.mfcFileName === 'tiled.eps' && anyway.mfcConverted.missing.join() === 'outlines of strokes (strokepath) and reversed paths' &&
      toasts.some(m => /^tiled\.eps is a vector panel.*Left out or drawn differently: outlines of strokes \(strokepath\)/.test(m)), toasts.at(-1));
    let thrown = null;
    try { await EI.importEPS(tiled, { anyway: false }); } catch (e) { thrown = e; }
    assert('Asked not to import such a file, it fails with a message', thrown && /tiled\.eps cannot be imported exactly: it uses outlines of strokes/.test(thrown.message), thrown && thrown.message);
    errors.length = 0;
    await MFC.importFiles([file('notes.eps', 'just some text')]);
    assert('A file that is not EPS is refused with a message', errors.length === 1 && /notes\.eps is not a readable EPS file/.test(errors[0]), errors[0]);
  } finally {
    MFC_UI.toast = toast; MFC_ERRORS.report = report;
    document.querySelectorAll('.metafile-backdrop').forEach(b => b.remove());
  }
  return checks;
}

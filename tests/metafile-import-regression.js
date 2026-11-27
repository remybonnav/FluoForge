/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T10b: EMF and WMF files imported as vector panels (the conversion itself: tests/metafile-regression.mjs).
   Files are written by tests/metafile-writer.js:
   - an EMF plot (a filled bar, a dashed line, Arial text, a bitmap) becomes a vector panel at its size
     on paper, named by its file, `mfcConverted` saying where it came from, its source an SVG; it is
     drawn where the file draws; SVG export writes it as elements and text, PDF export keeps it vector;
     save and reopen keep it; a gzipped .emz opens too;
   - a WMF with a placeable header, at its size;
   - a file using what cannot be reproduced (an exclusive-or drawing mode): a dialog lists it; Escape
     imports nothing, "Import anyway" imports it and says what is missing; asked not to, it fails;
   - a file that is not a metafile is refused with a message. */
async function runMetafileImportRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const W = await import(new URL('tests/metafile-writer.js', document.baseURI).href);
  const MI = await import(new URL('js/image/metafile-import.js', document.baseURI).href);
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
  /** The panel as the canvas draws it, on white; px(x, y) in the file's device pixels (96 dpi) → its colour. */
  function drawn(obj, perUnit) {
    const el = obj.getElement(), c = document.createElement('canvas'); c.width = el.width; c.height = el.height;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(el, 0, 0);
    return (x, y) => [...ctx.getImageData(Math.round(x * perUnit), Math.round(y * perUnit), 1, 1).data];
  }
  const rgb = ([r, g, b]) => r | g << 8 | b << 16; // a COLORREF
  const nullPen = w => w.rec(37, ['u32', 0x80000008]);
  const poly16 = (type, pts) => [type, ['i32', 0], ['i32', 0], ['i32', 0], ['i32', 0], ['u32', pts.length], ...pts.flatMap(([x, y]) => [['i16', x], ['i16', y]])];

  // A plot-like EMF, 100 × 50 mm on a 96 dpi device (378 × 189 device pixels).
  const plot = new W.EMFWriter({ widthMM: 100, heightMM: 50, dpi: 96 });
  plot.rec(39, ['u32', 1], ['u32', 0], ['u32', rgb(BLUE)], ['u32', 0]).rec(37, ['u32', 1]); nullPen(plot);
  plot.rec(...poly16(86, [[20, 40], [120, 40], [120, 160], [20, 160]])); // blue bar
  plot.rec(95, ['u32', 2], ['u32', 0], ['u32', 0], ['u32', 0], ['u32', 0], ['u32', 0x10000 | 0x200 | 1], ['u32', 4], ['u32', 0], ['u32', rgb(RED)], ['u32', 0], ['u32', 0]).rec(37, ['u32', 2]);
  plot.rec(...poly16(87, [[150, 30], [350, 30]])); // red dashes: 12 on, 4 off
  plot.rec(82, ['u32', 3], ['i32', -24], ['i32', 0], ['i32', 0], ['i32', 0], ['i32', 400], ['u8', 0], ['u8', 0], ['u8', 0], ['u8', 0], ['u8', 0], ['u8', 0], ['u8', 0], ['u8', 0], ['utf16', 'Arial', 64]).rec(37, ['u32', 3]);
  plot.rec(22, ['u32', 24]).rec(18, ['u32', 1]);
  W.textW(plot, 150, 120, 'Dose mg', [13, 13, 13, 13, 7, 20, 13]);
  W.stretchDIBits(plot, W.dib24([[RED, BLUE]]), 250, 60, 100, 40); // a 2 × 1 bitmap: red, blue
  const plotFile = new File([plot.bytes()], 'bars.emf', { type: 'image/emf' });
  const K = 300 / 96; // document pixels per device pixel

  try {
    await MFC_PROJECT.createProject({ name: 'Metafiles', width: 1500, height: 1000, unit: 'px', dpi: 300 });
    await frame();
    assert('Import Image takes EMF and WMF files', /\.emf/.test($('file-input').accept) && /\.wmf/.test($('file-input').accept) && /\.emz/.test($('file-input').accept) && /EPS, EMF or WMF/.test($('btn-import').title));

    // ================= An EMF =================
    await MFC.importFiles([plotFile]); await idle();
    let panel = vectors()[0];
    assert('An EMF becomes a vector panel, named by its file', vectors().length === 1 && panel.mfcFileName === 'bars.emf' && !errors.length, errors.join(' | '));
    assert('…at its size on paper: 100 × 50 mm is 1181 × 591 px at 300 dpi', near(panel.width, 1181) && near(panel.height, 591), panel.width + ' × ' + panel.height);
    assert('…recording where it came from; its project source is SVG', JSON.stringify(panel.mfcConverted) === '{"from":"emf","file":"bars.emf"}' && MFC_PROJECT.sources.get(panel.mfcVectorSource).format === 'svg');
    assert('…and a message says it stays vector', toasts.some(m => /^bars\.emf is a vector panel: it stays vector in SVG and PDF export/.test(m)), toasts.at(-1));
    let px = drawn(panel, K);
    assert('It is drawn where the file draws: the blue bar, white beside it', is(px(70, 100), BLUE) && is(px(140, 100), WHITE), px(70, 100).join());
    assert('…the dashed red line: a dash, then a gap', is(px(156, 30), RED) && is(px(164, 30), WHITE), px(156, 30).join() + ' / ' + px(164, 30).join());
    assert('…the bitmap, sharp: red on its left, blue on its right', is(px(275, 80), RED) && is(px(325, 80), BLUE), px(275, 80).join() + ' / ' + px(325, 80).join());
    let dark = 0;
    for (let y = 104; y < 122; y += 0.5) for (let x = 150; x < 230; x += 0.5) if (px(x, y)[0] < 100) dark++;
    assert('…and its text', dark > 20, dark);
    panel.set({ left: 50, top: 50 }); panel.setCoords(); MFC.pushHistory();
    const out = await MFC_EXPORT.buildSVG({ page: 0 });
    assert('SVG export writes it as elements, its text as text in Liberation Sans, its bitmap as an image', /<text [^>]*font-family="'Liberation Sans'"[^>]*>Dose<\/text>/.test(out.svg) && /<text [^>]*>mg<\/text>/.test(out.svg) &&
      (out.svg.match(/<image /g) || []).length === 1, out.svg.match(/<text[^>]*>Dose<\/text>/)?.[0]);
    const pdfOut = await MFC_EXPORT.buildPDF({});
    const bytes = new Uint8Array(await pdfOut.blob.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: new URL('assets/vendor/pdfjs/standard_fonts/', document.baseURI).href }).promise;
    const page = await doc.getPage(1), words = (await page.getTextContent()).items.map(i => i.str).join(' ');
    assert('PDF export keeps its text as text', /Dose/.test(words) && /mg/.test(words), words);
    const vp = page.getViewport({ scale: 300 / 72 }), rc = document.createElement('canvas'); rc.width = Math.round(vp.width); rc.height = Math.round(vp.height);
    const rctx = rc.getContext('2d'); await page.render({ canvas: rc, canvasContext: rctx, viewport: vp }).promise;
    const at = (x, y) => [...rctx.getImageData(Math.round(50 + x * K), Math.round(50 + y * K), 1, 1).data];
    assert('…and draws it where the canvas does', is(at(70, 100), BLUE) && is(at(156, 30), RED) && is(at(140, 100), WHITE), [at(70, 100), at(156, 30)].join(' / '));
    await doc.destroy?.();

    // ---- save and reopen ----
    const id = panel.mfcId;
    const next = MFC_PROJECT.prepareSave(true, 'metafiles'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
    await MFC.closeDocument();
    await MFC_PROJECT.loadProject(new File([archive], 'metafiles.fluoforge'));
    document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
    await idle();
    panel = vectors().find(o => o.mfcId === id);
    assert('Saved and reopened: the panel and where it came from', panel && near(panel.left, 50) && panel.mfcConverted.from === 'emf');
    px = drawn(panel, K);
    assert('…drawn again from its SVG source', is(px(70, 100), BLUE) && is(px(275, 80), RED));

    // ---- .emz, WMF ----
    await MFC.importFiles([new File([pako.gzip(plot.bytes())], 'bars.emz')]); await idle();
    assert('A gzipped EMF (.emz) opens too', canvas.getActiveObject().mfcFileName === 'bars.emz' && canvas.getActiveObject().mfcType === 'mfcVector' && near(canvas.getActiveObject().width, 1181));
    const wmf = new W.WMFWriter({ box: [0, 0, 1440, 720], inch: 1440 });
    wmf.rec(0x02fc, ['u16', 0], ['u32', rgb(RED)], ['u16', 0]).rec(0x012d, ['u16', 0]).rec(0x02fa, ['u16', 5], ['i16', 0], ['i16', 0], ['u32', 0]).rec(0x012d, ['u16', 1]);
    wmf.rec(0x041b, ['i16', 720], ['i16', 720], ['i16', 0], ['i16', 0]); // left half red
    await MFC.importFiles([new File([wmf.bytes()], 'half.wmf')]); await idle();
    const half = canvas.getActiveObject();
    assert('A WMF: a vector panel at its size (1 × 0.5 in is 300 × 150 px)', half.mfcFileName === 'half.wmf' && half.mfcConverted.from === 'wmf' && near(half.width, 300) && near(half.height, 150), half.width + ' × ' + half.height);
    px = drawn(half, 1);
    assert('…drawn as the file says: red on the left, white on the right', is(px(75, 75), RED) && is(px(225, 75), WHITE), px(75, 75).join());

    // ================= What cannot be reproduced =================
    const xor = new W.EMFWriter({ widthMM: 20, heightMM: 20 });
    xor.rec(20, ['u32', 7]).rec(39, ['u32', 1], ['u32', 0], ['u32', 0], ['u32', 0]).rec(37, ['u32', 1]); nullPen(xor);
    xor.rec(...poly16(86, [[0, 0], [50, 0], [50, 50]]));
    const xorFile = new File([xor.bytes()], 'xor.emf');
    const before = canvas.getObjects().length;
    let settled = false; errors.length = 0;
    let asked = MFC.importFiles([xorFile]).then(() => { settled = true; });
    for (let i = 0; i < 300 && !document.querySelector('.metafile-modal') && !settled && !errors.length; i++) await new Promise(r => setTimeout(r, 20));
    await frame();
    let dialog = document.querySelector('.metafile-modal');
    assert('A file with an exclusive-or drawing mode: a dialog says what cannot be reproduced', dialog && /Import this EMF with parts missing\?/.test(dialog.textContent) &&
      [...dialog.querySelectorAll('.pdf-issues li')].map(li => li.textContent).join() === 'drawing modes that invert or combine colours (raster operations)' &&
      $('metafile-ok').title && $('metafile-cancel').title && document.activeElement === $('metafile-cancel'),
      JSON.stringify({ settled, errors, text: dialog && dialog.textContent, focus: document.activeElement && (document.activeElement.id || document.activeElement.tagName) }));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await asked; await idle();
    assert('…Escape imports nothing', canvas.getObjects().length === before && !document.querySelector('.metafile-modal'));
    settled = false;
    asked = MFC.importFiles([xorFile]).then(() => { settled = true; });
    for (let i = 0; i < 300 && !document.querySelector('.metafile-modal') && !settled; i++) await new Promise(r => setTimeout(r, 20));
    $('metafile-ok').click();
    await asked; await idle();
    const anyway = canvas.getActiveObject();
    assert('…"Import anyway": the panel, recording and saying what is missing', anyway.mfcFileName === 'xor.emf' && anyway.mfcConverted.missing.length === 1 &&
      toasts.some(m => /^xor\.emf is a vector panel.*Left out or drawn differently: drawing modes that invert or combine colours/.test(m)), toasts.at(-1));
    let thrown = null;
    try { await MI.importMetafile(xorFile, { anyway: false }); } catch (e) { thrown = e; }
    assert('Asked not to import such a file, it fails with a message', thrown && /xor\.emf cannot be imported exactly: it uses drawing modes/.test(thrown.message), thrown && thrown.message);
    errors.length = 0;
    await MFC.importFiles([new File([new Uint8Array(200)], 'broken.wmf')]);
    assert('A file that is not a metafile is refused with a message', errors.length === 1 && /broken\.wmf is not a readable EMF or WMF file/.test(errors[0]), errors[0]);
  } finally {
    MFC_UI.toast = toast; MFC_ERRORS.report = report;
    document.querySelectorAll('.metafile-backdrop').forEach(b => b.remove());
  }
  return checks;
}

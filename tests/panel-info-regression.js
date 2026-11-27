/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* PI-T8: an info view for every panel kind, by right-click and from the Inspector.
   - Images (the reference figure's image, its inset): right-click > Image info… opens the Image info dialog;
     the Channels panel's Image info button still does;
   - plots: an SVG (its fonts replaced), an EPS converted with a part left out, a PDF page converted to vector,
     each clicked with the mouse: the Inspector shows a Plot section named after it, with its file, format
     (and page), size on paper, what it was kept as and the message shown at import; right-click > Plot info…
     and the Plot info button open the same in a dialog; Escape closes it, focus goes back;
   - a PDF page rasterised: Image info says where it came from and repeats its import message;
   - after save and reopen, the converted plot's import message and its left-out parts read the same;
   - a plot from before 0.1.51 (no message kept) says so. */
async function runPanelInfoRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = () => MFC.getCanvas();
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const settle = async () => { await MFC_TIFF.whenIdle(); for (let i = 0; i < 5; i++) await frame(); };
  const el = () => canvas().upperCanvasEl;
  const client = (x, y) => { const r = el().getBoundingClientRect(), v = canvas().viewportTransform, k = r.width / canvas().getWidth(); return { clientX: r.left + (x * v[0] + v[4]) * k, clientY: r.top + (y * v[3] + v[5]) * k }; };
  const centre = o => { const c = o.getCenterPoint(); return client(c.x, c.y); };
  const clickOn = async o => { const at = centre(o); el().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, ...at })); document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, ...at })); await frame(); };
  const menuOn = async o => { el().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, buttons: 2, ...centre(o) })); await frame();
    const menu = document.querySelector('.context-menu'); return Object.fromEntries([...(menu ? menu.querySelectorAll('.context-item') : [])].map(b => [b.textContent, b])); };
  const dialogRows = () => { const d = document.querySelector('.image-info-modal'); return d ? Object.fromEntries([...d.querySelectorAll('.image-info-list dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent])) : null; };
  const panelRows = () => Object.fromEntries([...$('plot-info-list').querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]));
  const closeDialog = async () => { document.querySelector('.image-info-backdrop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frame(); };
  const byId = id => canvas().getObjects().find(o => o.mfcId === id);
  const toasts = []; const toastEl = $('toast'), watch = new MutationObserver(() => toasts.push(toastEl.textContent)); watch.observe(toastEl, { childList: true, characterData: true, subtree: true });

  try {
    const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
    await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
    document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
    await settle();
    MFC.setTool('select');

    // ================= images =================
    const img = byId('img1');
    canvas().discardActiveObject(); await frame();
    let items = await menuOn(img);
    assert('Right-click on an image offers Image info…, first', Object.keys(items)[0] === 'Image info…' && !!items['Copy display settings'], Object.keys(items).join('|'));
    items['Image info…'].click(); await frame();
    let rows = dialogRows();
    assert('…which opens the Image info dialog of that image', rows && rows.File === MFC.getRegistry().img1.rawImage.fileName && !!rows['Bit depth'] && document.querySelector('.image-info-modal h2').textContent === 'Image info', JSON.stringify(rows));
    await closeDialog();
    assert('…Escape closes it', !document.querySelector('.image-info-backdrop'));
    const inset = byId('img3');
    items = await menuOn(inset);
    assert('An inset (another image kind) has Image info… too', !!items['Image info…'], Object.keys(items).join('|'));
    document.querySelectorAll('.context-menu').forEach(m => m.remove());
    canvas().setActiveObject(img); await frame(); $('btn-image-info').click(); await frame();
    assert('The Channels panel\'s Image info button still opens it', !!dialogRows());
    await closeDialog();

    // ================= an SVG plot =================
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="1in" viewBox="0 0 200 100"><rect x="10" y="10" width="120" height="70" fill="#36c"/><text x="20" y="95" font-family="Arial" font-size="12">Growth</text></svg>';
    await MFC.importFiles([new File([svg], 'growth.svg', { type: 'image/svg+xml' })]); await settle();
    const plot = canvas().getObjects().find(o => o.mfcType === 'mfcVector' && o.mfcFileName === 'growth.svg');
    const svgMessage = toasts.filter(t => /growth\.svg is a vector panel/.test(t)).at(-1);
    assert('An SVG plot is imported, with its message', plot && svgMessage && /Liberation/.test(svgMessage), svgMessage);
    canvas().discardActiveObject(); await frame();
    await clickOn(plot);
    assert('Clicking the plot shows it in the Inspector: a Plot section named after it', canvas().getActiveObject() === plot && !$('panel-plot').classList.contains('hidden') &&
      $('plot-name').textContent === '— growth.svg' && $('inspector-context').textContent === 'Plot — growth.svg', $('inspector-context').textContent);
    rows = panelRows();
    const dpi = MFC.getDocProps().dpi, mm = v => (Math.round(v / dpi * 25.4 * 10) / 10).toFixed(1);
    assert('…with its file, format, size on paper and how it is kept', rows.File === 'growth.svg' && rows.Format === 'SVG' && rows['Size on paper'] === `${mm(plot.getScaledWidth())} × ${mm(plot.getScaledHeight())} mm` &&
      rows['Size of the plot'] === '50.8 × 25.4 mm' && rows['Kept as'] === 'Vector: the original SVG', JSON.stringify(rows));
    assert('…and the message shown at import, word for word', rows['Import message'] === svgMessage, rows['Import message']);
    plot.set({ scaleX: plot.scaleX / 2, scaleY: plot.scaleY / 2 }); plot.setCoords(); canvas().fire('object:modified', { target: plot }); await frame();
    assert('Resized, its size on paper follows', panelRows()['Size on paper'] === `${mm(plot.getScaledWidth())} × ${mm(plot.getScaledHeight())} mm`, panelRows()['Size on paper']);
    items = await menuOn(plot);
    assert('Right-click on the plot offers Plot info…, first', Object.keys(items)[0] === 'Plot info…' && document.querySelector('.context-menu').getAttribute('aria-label') === 'Plot', Object.keys(items).join('|'));
    items['Plot info…'].click(); await frame();
    assert('…which opens Plot info with the same rows', document.querySelector('.image-info-modal h2').textContent === 'Plot info' && JSON.stringify(dialogRows()) === JSON.stringify(panelRows()), JSON.stringify(dialogRows()));
    assert('…as a modal dialog with the focus on Close', document.querySelector('.image-info-modal').getAttribute('aria-modal') === 'true' && document.activeElement === $('image-info-close'));
    await closeDialog();
    $('btn-plot-info').focus(); $('btn-plot-info').click(); await frame();
    assert('The Plot section\'s Plot info button opens it too, with a title', !!dialogRows() && /import/.test($('btn-plot-info').title));
    await closeDialog();
    assert('…and closing it gives the focus back to the button', document.activeElement === $('btn-plot-info'));
    canvas().setActiveObject(img); canvas().fire('selection:updated', { selected: [img] }); await frame();
    assert('Selecting an image hides the Plot section', $('panel-plot').classList.contains('hidden'));

    // ================= an EPS, converted with a part left out =================
    const eps = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 144 72\nnewpath 10 10 moveto 130 60 lineto reversepath 0 0 1 setrgbcolor 2 setlinewidth stroke\n0 0 0 setrgbcolor /Helvetica findfont 12 scalefont setfont 10 50 moveto (Dose) show\nshowpage\n%%EOF\n';
    const { importEPS } = await import(new URL('js/image/eps-import.js', document.baseURI).href);
    const epsPlot = await importEPS(new File([new TextEncoder().encode(eps)], 'dose.eps', { type: 'application/postscript' }), { anyway: true }); await settle();
    const epsMessage = toasts.filter(t => /dose\.eps is a vector panel/.test(t)).at(-1);
    assert('An EPS with a part it cannot convert is imported anyway', epsPlot && epsPlot.mfcConverted && epsPlot.mfcConverted.missing && epsPlot.mfcConverted.missing.length && /Left out/.test(epsMessage), epsMessage);
    canvas().discardActiveObject(); await frame(); await clickOn(epsPlot);
    rows = panelRows();
    assert('Its Plot section: EPS, converted to SVG on import, its message and what was left out', rows.Format === 'EPS (PostScript)' && rows['Kept as'] === 'Vector: converted from EPS (PostScript) to SVG on import' &&
      rows['Import message'] === epsMessage && rows['Left out or drawn differently'] === epsPlot.mfcConverted.missing.join(', '), JSON.stringify(rows));
    const epsId = epsPlot.mfcId, epsRows = JSON.stringify(rows);

    // ================= a PDF page: as vector, and rasterised =================
    const { jsPDF } = window.jspdf;
    const made = new jsPDF({ unit: 'pt', format: [144, 72], orientation: 'landscape' });
    made.setFillColor(214, 39, 40); made.rect(0, 0, 72, 72, 'F'); made.addPage([144, 72], 'landscape'); made.setFillColor(44, 160, 44); made.rect(72, 0, 72, 72, 'F');
    const pdfFile = () => new File([made.output('blob')], 'panels.pdf', { type: 'application/pdf' });
    const { importPDF } = await import(new URL('js/image/pdf-import.js', document.baseURI).href);
    const pdfPlot = await importPDF(pdfFile(), { page: 2, as: 'vector' }); await settle();
    canvas().discardActiveObject(); await frame(); await clickOn(pdfPlot);
    rows = panelRows();
    assert('A PDF page converted to vector: PDF, its page, converted to SVG', rows.File === 'panels.pdf' && rows.Format === 'PDF' && rows.Page === '2 of 2' && /converted from PDF/.test(rows['Kept as']) && /Page 2 of panels\.pdf is a vector panel/.test(rows['Import message']), JSON.stringify(rows));
    const raster = await importPDF(pdfFile(), { page: 1, as: 'image' }); await settle();
    const rasterMessage = toasts.filter(t => /rasterised at/.test(t)).at(-1);
    items = await menuOn(raster);
    items['Image info…'].click(); await frame();
    rows = dialogRows();
    assert('A PDF page rasterised: Image info says where it came from, that it was rasterised, and its import message', rows && rows['Imported from'] === 'PDF panels.pdf, page 1 of 2' && /^Rasterised at \d+ dpi/.test(rows['Kept as']) && rows['Import message'] === rasterMessage, JSON.stringify(rows));
    await closeDialog();

    // ================= save and reopen =================
    const next = MFC_PROJECT.prepareSave(true, 'info'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
    await MFC.closeDocument();
    await MFC_PROJECT.loadProject(new File([archive], 'info.fluoforge'));
    document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
    await settle();
    const reopened = byId(epsId);
    canvas().discardActiveObject(); await frame(); await clickOn(reopened);
    assert('Saved and reopened: the converted plot\'s import message and left-out parts read the same', JSON.stringify(panelRows()) === epsRows, JSON.stringify(panelRows()));
    items = await menuOn(reopened); items['Plot info…'].click(); await frame();
    assert('…in its Plot info dialog too', dialogRows()['Import message'] === epsMessage);
    await closeDialog();

    // ================= a plot from before 0.1.51 =================
    delete reopened.mfcImportMessage;
    canvas().discardActiveObject(); await frame(); await clickOn(reopened);
    assert('A plot imported before 0.1.51 (no message kept) says so, and still lists what was left out', /Not recorded/.test(panelRows()['Import message']) && !!panelRows()['Left out or drawn differently'], panelRows()['Import message']);
  } finally {
    watch.disconnect();
    document.querySelectorAll('.context-menu, .image-info-backdrop').forEach(m => m.remove());
  }
  return checks;
}

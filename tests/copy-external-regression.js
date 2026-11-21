/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Copy for other software (Export ▸ Copy for other software…, Ctrl+Shift+C).
   The system clipboard is replaced by a recorder (tests cannot paste into PowerPoint); the
   ClipboardItems written are opened and checked:
   - SVG picture, PNG, both, SVG code; the page, or the selection cropped to its box with only its
     objects; resolution and transparency; the same rendering as Export.
   - Fallbacks: no SVG on the clipboard (SVG code instead, or the PNG for "both"), no clipboard at all,
     nothing selected, a failed write.
   - The dialog: menu item, shortcut, default scope, PNG fields, Esc, focus, titles, themes. */

const nextCopyFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function runCopyExternalRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const C = await import(new URL('js/ui/copy-external.js', document.baseURI).href);
  const E = await import(new URL('js/image/raster-encoders.js', document.baseURI).href);
  const realClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
  const realSupports = typeof ClipboardItem !== 'undefined' ? ClipboardItem.supports : undefined;
  let written = [], refuse = false;
  const recorder = {
    write: async items => { if (refuse) throw new Error('Write permission denied.'); for (const item of items) { const out = {}; for (const type of item.types) out[type] = await item.getType(type); written.push(out); } },
    writeText: async text => { written.push({ 'text/plain': new Blob([text], { type: 'text/plain' }) }); }
  };
  const useClipboard = value => Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
  const setSupports = fn => { if (typeof ClipboardItem !== 'undefined') ClipboardItem.supports = fn; };
  const decodePng = async blob => { const bmp = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data }; };
  const parseSvg = text => { const doc = new DOMParser().parseFromString(text, 'image/svg+xml'); return doc.querySelector('parsererror') ? null : doc.documentElement; };
  try {
    useClipboard(recorder);
    setSupports(type => ['image/png', 'image/svg+xml', 'text/plain', 'text/html'].includes(type));
    const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
    await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
    await MFC_TIFF.whenIdle(); await document.fonts.ready;
    const canvas = MFC.getCanvas();
    canvas.discardActiveObject();

    // ---- Page ----
    let result = await C.copyFigure({ scope: 'page', page: 0, format: 'both' });
    let item = written.at(-1);
    assert('Both: one clipboard item with an SVG picture and a PNG', Object.keys(item).sort().join() === 'image/png,image/svg+xml' && result.types.length === 2 && !result.note);
    const svgText = await item['image/svg+xml'].text(), svgRoot = parseSvg(svgText);
    const exportSvg = (await MFC_EXPORT.buildSVG({ page: 0 })).svg;
    assert('The SVG is page 1 as exported: same size and viewBox, the same drawing', svgRoot && svgRoot.getAttribute('viewBox') === '0 0 1200 800' &&
      svgText.replace(/(CLIPPATH|SVGID)_\d+/g, '$1') === exportSvg.replace(/(CLIPPATH|SVGID)_\d+/g, '$1'));
    const png = await decodePng(item['image/png']), phys = E.readPhys(new Uint8Array(await item['image/png'].arrayBuffer()));
    assert('The PNG is page 1 at the document resolution (1200 × 800, 300 dpi), white background', png.w === 1200 && png.h === 800 && phys.ppmX === Math.round(300 / 0.0254) && png.data[(790 * 1200 + 1190) * 4 + 3] === 255);
    await C.copyFigure({ scope: 'page', page: 1, format: 'png', dpi: 150, transparent: true });
    item = written.at(-1);
    const png2 = await decodePng(item['image/png']);
    assert('PNG only: page 2 at 150 dpi (600 × 400), transparent where empty', Object.keys(item).join() === 'image/png' && png2.w === 600 && png2.h === 400 && png2.data[(390 * 600 + 590) * 4 + 3] === 0);
    await C.copyFigure({ scope: 'page', page: 0, format: 'svg' });
    assert('SVG picture only', Object.keys(written.at(-1)).join() === 'image/svg+xml');
    await C.copyFigure({ scope: 'page', page: 0, format: 'svg-text' });
    item = written.at(-1);
    assert('SVG code: the SVG source as text', Object.keys(item).join() === 'text/plain' && parseSvg(await item['text/plain'].text())?.getAttribute('viewBox') === '0 0 1200 800');

    // ---- Selection ----
    const images = canvas.getObjects().filter(o => o.mfcType === 'mfcImage' && !o.mfcIsInset);
    const pick = [images[0], images[1]];
    canvas.setActiveObject(new fabric.ActiveSelection(pick, { canvas })); canvas.requestRenderAll();
    const area = C.selectionArea(), box = canvas.getActiveObject().getBoundingRect(true, true);
    assert('The selection area is the selected objects\' box, rounded outwards', area.count === 2 && area.bounds.left <= box.left && area.bounds.left > box.left - 1 &&
      area.bounds.left + area.bounds.width >= box.left + box.width && area.only.has(pick[0].mfcId) && area.only.has(pick[1].mfcId));
    await C.copyFigure({ scope: 'selection', format: 'both' });
    item = written.at(-1);
    const selSvg = parseSvg(await item['image/svg+xml'].text()), selPng = await decodePng(item['image/png']);
    assert('A copied selection is cropped to its box, with only its two images and no text', selSvg.getAttribute('viewBox') === `0 0 ${area.bounds.width} ${area.bounds.height}` &&
      selSvg.querySelectorAll('image').length === 2 && !selSvg.querySelector('text') && !selSvg.querySelector('metadata') && selPng.w === area.bounds.width && selPng.h === area.bounds.height,
      `${selSvg.getAttribute('viewBox')} ${selSvg.querySelectorAll('image').length} images, PNG ${selPng.w}×${selPng.h}`);
    assert('The selection stays selected and the figure is unchanged', canvas.getActiveObjects().length === 2 && canvas.getObjects().filter(o => o.mfcType === 'mfcImage').length === 4);
    canvas.discardActiveObject();
    let error = await C.copyFigure({ scope: 'selection', format: 'png' }).then(() => null, e => e.message);
    assert('Copying the selection with nothing selected says so', /Select the objects/.test(error || ''));
    const pageSvg = (await MFC_EXPORT.buildSVG({ page: 0 })).svg;
    assert('Exporting a page is unchanged by the selection options', pageSvg.replace(/(CLIPPATH|SVGID)_\d+/g, '$1') === exportSvg.replace(/(CLIPPATH|SVGID)_\d+/g, '$1'));

    // ---- Fallbacks ----
    setSupports(type => ['image/png', 'text/plain', 'text/html'].includes(type));
    result = await C.copyFigure({ scope: 'page', page: 0, format: 'svg' });
    item = written.at(-1);
    assert('Without SVG on the clipboard, "SVG picture" copies the SVG code as text and says why', Object.keys(item).join() === 'text/plain' && /cannot copy SVG pictures/.test(result.note));
    result = await C.copyFigure({ scope: 'page', page: 0, format: 'both' });
    assert('…and "Both" copies the PNG alone, saying so', Object.keys(written.at(-1)).join() === 'image/png' && /PNG is on the clipboard/.test(result.note));
    setSupports(type => ['image/png', 'image/svg+xml', 'text/plain'].includes(type));
    refuse = true;
    error = await C.copyFigure({ scope: 'page', page: 0, format: 'png' }).then(() => null, e => e.message);
    refuse = false;
    assert('A refused clipboard write gives a clear message', /clipboard refused the figure.*Write permission denied/.test(error || ''), error);
    useClipboard(undefined);
    error = await C.copyFigure({ scope: 'page', page: 0, format: 'png' }).then(() => null, e => e.message);
    assert('Without clipboard access (a file:// page), it explains and points to Export', /https:\/\/ or localhost.*Export/.test(error || ''), error);
    useClipboard(recorder);

    // ---- Dialog ----
    document.getElementById('btn-export').click();
    const item1 = document.querySelector('#export-menu [data-export="copy"]');
    assert('The Export menu has "Copy for other software…" with a title naming the formats and Ctrl+Shift+C', item1 && /PowerPoint/.test(item1.title) && /Ctrl\+Shift\+C/.test(item1.title));
    item1.click();
    for (let i = 0; i < 50 && !document.querySelector('.copy-modal'); i++) await new Promise(r => setTimeout(r, 10));
    await nextCopyFrame();
    let dialog = document.querySelector('.copy-modal');
    const $ = sel => dialog.querySelector(sel);
    assert('It opens a dialog focused on Copy; with nothing selected, Page is chosen and Selection is disabled', dialog && document.activeElement === $('#copy-ok') &&
      $('#copy-scope-page').checked && $('#copy-scope-selection').disabled && $('#copy-format-both').checked);
    $('#copy-format-svg').click();
    assert('The resolution only applies to PNG and Both', $('#copy-dpi').disabled);
    $('#copy-format-png').click(); $('#copy-dpi').value = '5'; $('#copy-ok').click(); await nextCopyFrame();
    assert('A bad resolution is refused in the dialog', /between 30 and 1200/.test($('.copy-status').textContent) && $('.copy-status').classList.contains('copy-error'));
    $('#copy-dpi').value = '100'; const before = written.length; $('#copy-ok').click();
    for (let i = 0; i < 200 && written.length === before; i++) await new Promise(r => setTimeout(r, 20));
    for (let i = 0; i < 50 && !/Copied/.test($('.copy-status').textContent); i++) await new Promise(r => setTimeout(r, 10));
    const viaDialog = await decodePng(written.at(-1)['image/png']);
    assert('Copy writes the chosen format and says what was copied; the dialog stays open', viaDialog.w === 400 && /Copied PNG/.test($('.copy-status').textContent) && document.querySelector('.copy-modal'));
    const controls = [...dialog.querySelectorAll('input, button')];
    assert('Every control has a title (its own or its group\'s)', controls.every(c => (c.title || c.closest('[title]')?.title || '').length > 5));
    const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const contrast = (x, y) => { const [h, l] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (h + 0.05) / (l + 0.05); };
    const savedTheme = document.documentElement.dataset.theme, ratios = [];
    for (const theme of ['light', 'sage', 'dark', 'slate']) {
      document.documentElement.dataset.theme = theme;
      const d = getComputedStyle(dialog), label = getComputedStyle($('.copy-choices label')), st = getComputedStyle($('.copy-status'));
      ratios.push(contrast(label.color, d.backgroundColor), contrast(st.color, d.backgroundColor));
    }
    if (savedTheme) document.documentElement.dataset.theme = savedTheme; else delete document.documentElement.dataset.theme;
    assert('The dialog is readable in all four themes (contrast ≥ 4.5)', ratios.every(r => r >= 4.5), ratios.map(r => r.toFixed(1)).join());
    const focusRule = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } }).some(r => /\.copy-modal input:focus-visible/.test(r.selectorText || '') && /outline/.test(r.cssText));
    assert('Controls have a visible focus outline', focusRule);
    const lastBtn = $('#copy-ok'); lastBtn.focus(); lastBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert('Tab from Copy wraps to the first control', document.activeElement === dialog.querySelector('input:not([disabled])'));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert('Escape closes the dialog', !document.querySelector('.copy-modal'));
    canvas.setActiveObject(images[1]); canvas.requestRenderAll();
    document.body.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    for (let i = 0; i < 50 && !document.querySelector('.copy-modal'); i++) await new Promise(r => setTimeout(r, 10));
    dialog = document.querySelector('.copy-modal');
    assert('Ctrl+Shift+C opens it; with a selection, Selection is chosen', dialog && dialog.querySelector('#copy-scope-selection').checked && !dialog.querySelector('#copy-scope-selection').disabled &&
      dialog.querySelector('#copy-format-png').checked);
    dialog.querySelector('#copy-close').click();
    canvas.discardActiveObject();
  } finally {
    if (realClipboard) delete navigator.clipboard; // back to the prototype's clipboard
    if (typeof ClipboardItem !== 'undefined') { if (realSupports) ClipboardItem.supports = realSupports; else delete ClipboardItem.supports; }
  }
  return checks;
}

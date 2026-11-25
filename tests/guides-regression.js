/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T7: rulers, guides and smart snapping in the editor (the pure part: tests/guides-model-regression.mjs).
   - Rulers in the document unit, shown and hidden with the Rulers button;
   - dragging from a ruler makes a guide, dragging a guide moves it, dragging it onto a ruler deletes it;
     guides are saved, follow undo and redo, and never reach an export;
   - objects snap to guides; the Snap button turns snapping off and on; equal spacing snaps and marks
     the gaps;
   - margin guides, and column guides from the journal preset;
   - the Guides dialog (the keyboard path): add, move and delete guides by position, margin, columns. */
async function runGuidesRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const P = await import(new URL('js/core/preferences.js', document.baseURI).href);
  const G = await import(new URL('js/layout/guides.js', document.baseURI).href);
  const SN = await import(new URL('js/layout/snap.js', document.baseURI).href);
  const J = await import(new URL('js/core/journal-presets.js', document.baseURI).href);
  P.resetGlobalPreferences();
  const guides = () => JSON.stringify(MFC.getDocProps().guides || []);
  /** Client coordinates of a document point. */
  const client = (x, y) => {
    const el = canvas.upperCanvasEl, rect = el.getBoundingClientRect(), vpt = canvas.viewportTransform, k = rect.width / canvas.getWidth();
    return { clientX: rect.left + (x * vpt[0] + vpt[4]) * k, clientY: rect.top + (y * vpt[3] + vpt[5]) * k };
  };
  const mouse = (target, type, at) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...at }));
  const centreOf = el => { const r = el.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; };

  try {
    await MFC_PROJECT.createProject({ name: 'Guides', width: 1200, height: 800, unit: 'px', dpi: 300, pages: 2 });
    MFC.zoomReset && MFC.zoomReset();
    canvas.requestRenderAll(); await frame();

    // ---- rulers ----
    const rulers = $('rulers');
    assert('Rulers show along the top and left in the document unit (px)', !rulers.hidden && $('ruler-top').width > 0 && $('ruler-left').height > 0 && $('ruler-corner').textContent === 'px');
    assert('The Rulers, Guides… and Snap buttons have titles; Rulers and Snap say whether they are on', ['btn-rulers', 'btn-guides', 'btn-snap'].every(id => $(id).title) &&
      $('btn-rulers').getAttribute('aria-pressed') === 'true' && $('btn-snap').getAttribute('aria-pressed') === 'true' && $('btn-snap').textContent === 'Snap on');
    $('btn-rulers').click(); await frame();
    assert('Rulers off: hidden, the button says so', rulers.hidden && $('btn-rulers').getAttribute('aria-pressed') === 'false');
    $('btn-rulers').click(); await frame();
    assert('Rulers on again', !rulers.hidden);
    await MFC_PROJECT.restoreState({ ...MFC_PROJECT.captureState(), docProps: { ...MFC.getDocProps(), unit: 'cm', width: 10, height: 8 } }); await frame();
    assert('The rulers follow the document unit (cm)', $('ruler-corner').textContent === 'cm');
    await MFC_PROJECT.restoreState({ ...MFC_PROJECT.captureState(), docProps: { ...MFC.getDocProps(), unit: 'px', width: 1200, height: 800 } }); await frame();

    // ---- dragging guides ----
    const svgBefore = (await MFC_EXPORT.buildSVG({ page: 0 })).svg;
    mouse($('ruler-left'), 'mousedown', centreOf($('ruler-left')));
    mouse(window, 'mousemove', client(300, 200));
    mouse(window, 'mouseup', client(300, 200));
    let list = MFC.getDocProps().guides || [];
    assert('Dragging from the left ruler onto the page makes a vertical guide where it is dropped', list.length === 1 && list[0].axis === 'v' && near(list[0].pos, 300, 1), guides());
    mouse($('ruler-top'), 'mousedown', centreOf($('ruler-top')));
    mouse(window, 'mousemove', client(500, 250));
    mouse(window, 'mouseup', client(500, 250));
    list = MFC.getDocProps().guides;
    assert('…from the top ruler, a horizontal guide', list.length === 2 && list[1].axis === 'h' && near(list[1].pos, 250, 1), guides());
    mouse(canvas.upperCanvasEl, 'mousedown', client(300, 400));
    mouse(window, 'mousemove', client(420, 400));
    mouse(window, 'mouseup', client(420, 400));
    assert('Dragging a guide on the canvas moves it', near(MFC.getDocProps().guides[0].pos, 420, 1) && !canvas.getActiveObject(), guides());
    await MFC.undo();
    assert('Undo puts it back', near(MFC.getDocProps().guides[0].pos, 300, 1), guides());
    await MFC.redo();
    assert('Redo moves it again', near(MFC.getDocProps().guides[0].pos, 420, 1));
    mouse(canvas.upperCanvasEl, 'mousedown', client(800, 250));
    mouse(window, 'mousemove', client(800, 600));
    mouse(window, 'mouseup', centreOf($('ruler-top')));
    assert('Dragging a guide onto a ruler deletes it', MFC.getDocProps().guides.length === 1 && MFC.getDocProps().guides[0].axis === 'v', guides());
    const svgAfter = (await MFC_EXPORT.buildSVG({ page: 0 })).svg;
    { let i = 0; while (i < svgAfter.length && svgAfter[i] === svgBefore[i]) i++; assert('Guides are never exported: the SVG is the same with them', svgAfter === svgBefore, svgBefore.slice(i - 80, i + 80) + ' ### ' + svgAfter.slice(i - 80, i + 80)); }
    const state = MFC_PROJECT.captureState();
    await MFC_PROJECT.restoreState(JSON.parse(JSON.stringify(state))); await frame();
    assert('Saved and reopened, the guide is there', guides() === JSON.stringify(state.docProps.guides));

    // ---- snapping ----
    const box = new fabric.Rect({ left: 100, top: 300, width: 80, height: 60, fill: '#88f', strokeWidth: 0 });
    Object.assign(box, { mfcId: 'shp901', mfcType: 'shape' });
    canvas.add(box);
    box.set({ left: 416 }); box.setCoords(); SN.snapObjectPosition(box);
    assert('An object dragged near a guide snaps its edge to it (left 416 → 420)', near(box.left, 420), box.left);
    $('btn-snap').click(); await frame();
    assert('The Snap button turns snapping off, and says so', P.getPreference('snap.enabled') === false && $('btn-snap').getAttribute('aria-pressed') === 'false' && $('btn-snap').textContent === 'Snap off');
    box.set({ left: 416 }); box.setCoords(); SN.snapObjectPosition(box);
    assert('Snapping off: it stays where it is dropped', near(box.left, 416));
    $('btn-snap').click(); await frame();
    P.setGlobalPreference('snap.toGuides', false);
    box.set({ left: 416 }); box.setCoords(); SN.snapObjectPosition(box);
    assert('"Snap to guides" off: no snapping to the guide', near(box.left, 416));
    P.setGlobalPreference('snap.toGuides', true);
    canvas.remove(box);

    // Equal spacing: two boxes 50 px apart, a third dropped about 50 px after the second.
    const rect = (id, left) => { const r = new fabric.Rect({ left, top: 600, width: 60, height: 60, fill: '#8c8', strokeWidth: 0 }); Object.assign(r, { mfcId: id, mfcType: 'shape' }); canvas.add(r); return r; };
    const r1 = rect('shp902', 600), r2 = rect('shp903', 710), r3 = rect('shp904', 824);
    P.setGlobalPreference('snap.toPage', false);
    SN.snapObjectPosition(r3);
    const marks = SN.snapGuides() && SN.snapGuides().marks;
    assert('Equal spacing: the third box takes the same 50 px gap (824 → 820), and both gaps are marked', near(r3.left, 820) && marks && marks.x.length === 2, `${r3.left} ${JSON.stringify(marks)}`);
    P.setGlobalPreference('snap.spacing', false);
    r3.set({ left: 824 }); r3.setCoords(); SN.snapObjectPosition(r3);
    assert('"Snap to equal spacing" off: it stays', near(r3.left, 824));
    P.resetGlobalPreferences();
    [r1, r2, r3].forEach(o => canvas.remove(o));
    canvas.requestRenderAll(); await frame();

    // ---- margin and journal column guides ----
    const families = await J.loadJournalPresets(), nature = families.find(f => f.id === 'nature');
    await MFC_PROJECT.createProject({ name: 'Nature', width: 21, height: 12, unit: 'cm', dpi: 300, pages: 1, journalPreset: J.makePreset(nature, 'single') }); await frame();
    const mm = v => (v / 25.4) * 300;
    let layout = G.layoutGuideLines();
    assert('A Nature figure gets column guides at 89, 120 and 183 mm', layout.filter(g => g.kind === 'column').map(g => Math.round(g.pos / mm(1))).join() === '89,120,183', JSON.stringify(layout));
    G.setLayoutGuides({ marginMm: 10 });
    layout = G.layoutGuideLines();
    assert('A 10 mm margin: margin guides, and the columns start at it', layout.filter(g => g.kind === 'margin').length === 4 && layout.filter(g => g.kind === 'column').map(g => Math.round(g.pos / mm(1))).join() === '99,130,193' &&
      MFC.getDocProps().layoutGuides.marginMm === 10);
    const panel = new fabric.Rect({ left: mm(10) + 3, top: 200, width: 100, height: 100, fill: '#f88', strokeWidth: 0 }); Object.assign(panel, { mfcId: 'shp905', mfcType: 'shape' }); canvas.add(panel);
    P.setGlobalPreference('snap.toPage', false);
    panel.set({ left: mm(99) - 100 + 4 }); panel.setCoords(); SN.snapObjectPosition(panel);
    assert('Objects snap to the column guides (right edge onto 99 mm)', near(panel.left + 100, mm(99)), panel.left);
    P.resetGlobalPreferences();
    $('btn-guides').focus(); $('btn-guides').click(); // as a user does: the button has the focus
    let dialog = document.querySelector('.guides-backdrop');
    const columns = dialog.querySelector('#guides-columns');
    assert('The dialog names the journal\'s columns', columns && /Nature/.test(columns.closest('label').textContent) && /89, 120, 183 mm/.test(columns.closest('label').textContent));
    columns.click();
    assert('Its checkbox turns the column guides off', G.layoutGuideLines().every(g => g.kind !== 'column') && MFC.getDocProps().layoutGuides.columns === false);
    await MFC.undo();
    assert('Undo turns them on again', G.layoutGuideLines().some(g => g.kind === 'column'));

    // ---- the Guides dialog: keyboard path ----
    dialog = document.querySelector('.guides-backdrop');
    assert('The dialog takes the focus; every control has a title or label', dialog && document.activeElement === dialog.querySelector('#guides-show') &&
      [...dialog.querySelectorAll('input, select, button')].every(c => c.title || (c.closest('label') && c.closest('label').title)));
    dialog.querySelector('#guides-add-axis').value = 'h'; dialog.querySelector('#guides-add-axis').dispatchEvent(new Event('change'));
    dialog.querySelector('#guides-add-pos').value = '2.5';
    dialog.querySelector('#guides-add').click();
    list = MFC.getDocProps().guides;
    assert('Add guide: a horizontal guide 2.5 cm from the top of the page', list.length === 1 && list[0].axis === 'h' && near(list[0].pos, 2.5 * 300 / 2.54), guides());
    const pos = dialog.querySelector('#guides-pos-0');
    assert('It is listed with its position in cm', pos && pos.value === '2.5' && /Horizontal/.test(pos.closest('.guides-row').textContent));
    pos.value = '3'; pos.dispatchEvent(new Event('change'));
    assert('Typing a position moves it', near(MFC.getDocProps().guides[0].pos, 3 * 300 / 2.54));
    dialog.querySelector('#guides-margin').value = '4'; dialog.querySelector('#guides-margin').dispatchEvent(new Event('change'));
    assert('Typing a margin sets it', MFC.getDocProps().layoutGuides.marginMm === 4);
    dialog.querySelector('#guides-delete-0').click();
    assert('Delete removes the guide; the focus stays in the dialog', !(MFC.getDocProps().guides || []).length && dialog.contains(document.activeElement));
    dialog.querySelector('#guides-show').click();
    assert('Show guides off: guides hidden and not snapped to', P.getPreference('view.guides') === false && G.snapGuideLines().length === 0);
    dialog.querySelector('#guides-show').click();
    const last = [...dialog.querySelectorAll('input, select, button')].filter(x => !x.disabled).pop();
    last.focus(); dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    assert('Tab stays inside the dialog', document.activeElement === dialog.querySelector('#guides-show'));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert('Esc closes it and gives the focus back to the button', !document.querySelector('.guides-backdrop') && document.activeElement === $('btn-guides'), document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  } finally {
    P.resetGlobalPreferences();
    document.querySelectorAll('.guides-backdrop').forEach(d => d.remove());
  }
  return checks;
}

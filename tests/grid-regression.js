/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T2: the persistent layout grid, in the editor (the model alone: tests/grid-model-regression.mjs).
   - The Grid panel makes a grid object: rows, columns, gutters and margins in mm, label bands; panels fit
     their cells; labels belong to the grid;
   - real mouse drags: a panel onto another cell swaps them; out of the grid it leaves; a free image onto
     an empty cell joins; dragging the grid moves panels and labels; its side handle resizes it;
   - insert and delete rows and columns, spans, fit and fill (keeping the crop centre), width in mm with
     gutters kept; montage panels in a grid;
   - acceptance: the grid survives save, load, undo, copy and all exports; the old Grid button (and
     MFC.arrangeGrid) still works on a project without a Grid object. */
async function runGridRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 0.75) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const load = async (blob, name) => { await MFC_PROJECT.loadProject(new File([blob], name)); document.querySelectorAll('.recovery-modal').forEach(m => m.remove()); await MFC_TIFF.whenIdle(); };
  const reference = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await load(reference, 'reference.mfcproj.zip');
  const Gm = await import(new URL('js/layout/grid-model.js', document.baseURI).href);
  const dpi = MFC.getDocProps().dpi, px = mm => mm / 25.4 * dpi;
  const grids = () => canvas.getObjects().filter(o => o.mfcType === 'layoutGrid');
  const byId = id => canvas.getObjects().find(o => o.mfcId === id);
  const labels = grid => canvas.getObjects().filter(o => o.type === 'textbox' && o.mfcGridId === grid.mfcId && o.mfcGridLabel);
  const tl = o => o.getPointByOrigin('left', 'top');
  const boxPx = (grid, b) => { const o = tl(grid); return { left: o.x + px(b.left), top: o.y + px(b.top), width: px(b.width), height: px(b.height) }; };
  const shown = o => { const p = tl(o); return { left: p.x, top: p.y, width: o.getScaledWidth(), height: o.getScaledHeight() }; };
  const fits = (img, box) => { const s = shown(img); return s.left >= box.left - 0.75 && s.top >= box.top - 0.75 && s.left + s.width <= box.left + box.width + 0.75 && s.top + s.height <= box.top + box.height + 0.75 &&
    (near(s.width, box.width) || near(s.height, box.height)) && near(s.left + s.width / 2, box.left + box.width / 2) && near(s.top + s.height / 2, box.top + box.height / 2); };
  const panelAt = (grid, row, col) => { const a = Gm.areaAt(grid.mfcGrid, row, col); return a && a.panel ? byId(a.panel) : null; };
  // A real mouse drag from one page point to another.
  const drag = (from, to, { shift = false } = {}) => {
    canvas.renderAll(); canvas.calcOffset();
    const box = canvas.upperCanvasEl.getBoundingClientRect(), v = canvas.viewportTransform;
    const screen = p => ({ x: box.left + p.x * v[0] + v[4], y: box.top + p.y * v[3] + v[5] });
    const a = screen(from), b = screen(to), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    canvas.upperCanvasEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: a.x, clientY: a.y, buttons: 1, shiftKey: shift }));
    for (const p of [mid, b]) document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: p.x, clientY: p.y, buttons: 1, shiftKey: shift, altKey: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: b.x, clientY: b.y, altKey: true }));
  };
  const centre = o => o.getCenterPoint();
  const field = (id, value) => { const el = document.getElementById(id); if (el.type === 'checkbox') el.checked = value; else el.value = String(value); el.dispatchEvent(new Event('change', { bubbles: true })); };

  // ---- Making a grid with the Grid panel ----
  const images = canvas.getObjects().filter(o => o.mfcType === 'mfcImage');
  assert('The reference project has no Grid object and 4 images', grids().length === 0 && images.length === 4);
  canvas.discardActiveObject();
  document.getElementById('btn-grid').click();
  const panel = document.getElementById('panel-grid');
  assert('The Grid button opens the Grid panel on "Make grid"', !panel.classList.contains('hidden') && !document.getElementById('grid-create').classList.contains('hidden'));
  field('grid-rows', 2); field('grid-cols', 2); field('grid-width', 100); field('grid-gutter', 2); field('grid-margin', 1);
  field('grid-header-row', true); field('grid-header-col', true); document.getElementById('grid-mode').value = 'fit';
  document.getElementById('grid-arrange').click();
  let grid = grids()[0];
  assert('Make grid adds one Grid object: 2 × 2, gutter 2 mm, margin 1 mm, 100 mm wide, inside the page', grids().length === 1 && tl(grid).x >= -0.5 && tl(grid).y >= -0.5 && grid.mfcGrid.rows === 2 && grid.mfcGrid.cols === 2 &&
    grid.mfcGrid.gutter === 2 && grid.mfcGrid.margin === 1 && near(Gm.gridSize(grid.mfcGrid).width, 100, 1e-6) && near(grid.width, px(100)), JSON.stringify(grid.mfcGrid));
  assert('The four images are its panels, in reading order, each fitted and centred in its cell', grid.mfcGrid.areas.length === 4 &&
    grid.mfcGrid.areas.every(a => fits(byId(a.panel), boxPx(grid, Gm.areaBox(grid.mfcGrid, a))) && byId(a.panel).mfcGridId === grid.mfcId && byId(a.panel).angle === 0));
  const lab = labels(grid);
  assert('Labels belong to the grid: one per column above, one per row on the left, in their bands', lab.length === 4 &&
    lab.filter(l => l.mfcGridLabel === 'col').map(l => l.text).sort().join() === 'Column 1,Column 2' &&
    lab.every(l => { const b = boxPx(grid, l.mfcGridLabel === 'col' ? Gm.colLabelBox(grid.mfcGrid, l.mfcGridIndex) : Gm.rowLabelBox(grid.mfcGrid, l.mfcGridIndex)); return near(tl(l).x, b.left) && near(l.width, b.width); }) &&
    !canvas.getObjects().some(o => o.type === 'textbox' && o.text === 'Label'));
  assert('The grid lies under its panels, and the panel switches to editing it', canvas.getObjects().indexOf(grid) < Math.min(...grid.mfcGrid.areas.map(a => canvas.getObjects().indexOf(byId(a.panel)))) &&
    !document.getElementById('grid-edit').classList.contains('hidden') && /Grid of 2 × 2 cells/.test(document.getElementById('grid-info').textContent));
  assert('The Layers panel names it', [...document.querySelectorAll('.layer-name')].some(n => n.textContent === 'Grid (2 × 2)'));

  // ---- Real mouse drags ----
  const a00 = panelAt(grid, 0, 0), a01 = panelAt(grid, 0, 1);
  canvas.setActiveObject(a00); drag(centre(a00), centre(a01));
  assert('Dragging a panel onto another cell swaps the two panels', panelAt(grid, 0, 1) === a00 && panelAt(grid, 0, 0) === a01 &&
    fits(a00, boxPx(grid, Gm.cellBox(grid.mfcGrid, 0, 1))) && fits(a01, boxPx(grid, Gm.cellBox(grid.mfcGrid, 0, 0))));
  const leaving = panelAt(grid, 1, 1), gb = grid.getBoundingRect(true, true);
  canvas.setActiveObject(leaving); drag(centre(leaving), { x: gb.left + gb.width + 150, y: centre(leaving).y });
  assert('Dragging a panel out of the grid takes it out (it stays where it was dropped)', !leaving.mfcGridId && !Gm.areaOf(grid.mfcGrid, leaving.mfcId) && Gm.areaAt(grid.mfcGrid, 1, 1) === null && centre(leaving).x > gb.left + gb.width,
    `gridId ${leaving.mfcGridId}, area ${JSON.stringify(Gm.areaOf(grid.mfcGrid, leaving.mfcId))}, left ${leaving.left}, centre ${JSON.stringify(centre(leaving))}, grid ${JSON.stringify(gb)}, zoom ${canvas.viewportTransform[0]}, canvas ${canvas.width}x${canvas.height}, active ${canvas.getActiveObject() && canvas.getActiveObject().mfcId}`);
  const empty = boxPx(grid, Gm.cellBox(grid.mfcGrid, 1, 1));
  canvas.setActiveObject(leaving); drag(centre(leaving), { x: empty.left + empty.width / 2, y: empty.top + empty.height / 2 });
  assert('Dragging a free image onto an empty cell adds it to the grid', panelAt(grid, 1, 1) === leaving && fits(leaving, empty));
  const g1 = Gm.cellBox(grid.mfcGrid, 0, 0), gutterPoint = boxPx(grid, { left: g1.left + g1.width + 1, top: g1.top + g1.height / 2, width: 0, height: 0 });
  const before = { grid: tl(grid), p: tl(a01), l: tl(lab[0]) };
  canvas.discardActiveObject(); drag({ x: gutterPoint.left, y: gutterPoint.top }, { x: gutterPoint.left + 60, y: gutterPoint.top + 30 });
  const moved = tl(grid);
  assert('Dragging the grid (by a gutter) moves its panels and labels with it', near(moved.x - before.grid.x, 60, 2) && near(moved.y - before.grid.y, 30, 2) &&
    near(tl(a01).x - before.p.x, moved.x - before.grid.x) && near(tl(lab[0]).y - before.l.y, moved.y - before.grid.y), `${moved.x - before.grid.x}, ${moved.y - before.grid.y}`);

  // ---- Width, gutters, handles ----
  canvas.setActiveObject(grid); MFC.refreshSelectionBar && MFC.refreshSelectionBar(); canvas.fire('selection:created', { selected: [grid] });
  document.getElementById('grid-edit-width').value = '85'; document.getElementById('grid-apply-width').click();
  assert('Width 85 mm (one journal column): the panels rescale, gutters and margins stay', near(Gm.gridSize(grid.mfcGrid).width, 85, 1e-6) && grid.mfcGrid.gutter === 2 && grid.mfcGrid.margin === 1 &&
    near(grid.getScaledWidth(), px(85)) && grid.mfcGrid.areas.every(a => fits(byId(a.panel), boxPx(grid, Gm.areaBox(grid.mfcGrid, a)))));
  const w85 = grid.width; grid.setCoords();
  const mr = grid.oCoords.mr, v = canvas.viewportTransform, mrPage = { x: (mr.x - v[4]) / v[0], y: (mr.y - v[5]) / v[3] };
  canvas.setActiveObject(grid); drag(mrPage, { x: mrPage.x + 120, y: mrPage.y });
  assert('Dragging the grid\'s right handle makes it wider; gutters stay 2 mm and the panels refit', grid.width > w85 + 50 && grid.scaleX === 1 && grid.mfcGrid.gutter === 2 &&
    grid.mfcGrid.areas.every(a => fits(byId(a.panel), boxPx(grid, Gm.areaBox(grid.mfcGrid, a)))), `${w85} → ${grid.width}`);
  field('grid-edit-gutter', 4);
  assert('Changing the gutter in the panel lays the grid out again', grid.mfcGrid.gutter === 4 &&
    near(boxPx(grid, Gm.cellBox(grid.mfcGrid, 0, 1)).left - boxPx(grid, Gm.cellBox(grid.mfcGrid, 0, 0)).left, px(grid.mfcGrid.cellW + 4)) &&
    grid.mfcGrid.areas.every(a => fits(byId(a.panel), boxPx(grid, Gm.areaBox(grid.mfcGrid, a)))));

  // ---- Rows, columns, spans, fit and fill ----
  canvas.setActiveObject(panelAt(grid, 0, 0));
  document.getElementById('grid-row-below').click();
  assert('Insert a row below the selected panel: 3 rows, the second row moves down, a third row label', grid.mfcGrid.rows === 3 && panelAt(grid, 2, 1) === leaving && panelAt(grid, 1, 0) === null &&
    labels(grid).filter(l => l.mfcGridLabel === 'row').length === 3);
  const lonely = panelAt(grid, 2, 0);
  canvas.setActiveObject(panelAt(grid, 0, 1)); document.getElementById('grid-span-down').click();
  const span = Gm.areaOf(grid.mfcGrid, a00.mfcId);
  assert('Span down: the panel takes the empty cell below and fits the larger area', span.rowSpan === 2 && fits(a00, boxPx(grid, Gm.areaBox(grid.mfcGrid, span))));
  canvas.setActiveObject(a00); document.getElementById('grid-unspan').click();
  assert('Unspan: back to one cell', Gm.areaOf(grid.mfcGrid, a00.mfcId).rowSpan === 1);
  canvas.setActiveObject(lonely); document.getElementById('grid-row-delete').click();
  assert('Delete the selected panel\'s row: 2 rows again; its panel leaves the grid and stays on the page', grid.mfcGrid.rows === 2 && !lonely.mfcGridId && canvas.contains(lonely) &&
    labels(grid).filter(l => l.mfcGridLabel === 'row').length === 2);
  canvas.setActiveObject(lonely); drag(centre(lonely), centre(lonely)); // a click-drag in place: still free
  const fillTarget = panelAt(grid, 0, 0), cropBefore = { cx: (fillTarget.cropX || 0) + fillTarget.width / 2, cy: (fillTarget.cropY || 0) + fillTarget.height / 2, w: fillTarget.width, h: fillTarget.height };
  canvas.setActiveObject(fillTarget); canvas.fire('selection:created', { selected: [fillTarget] });
  field('grid-cell-mode', 'fill');
  const cb = boxPx(grid, Gm.cellBox(grid.mfcGrid, 0, 0));
  assert('Fill: the panel covers its cell exactly, cropped around the same centre', near(fillTarget.getScaledWidth(), cb.width) && near(fillTarget.getScaledHeight(), cb.height) &&
    near((fillTarget.cropX || 0) + fillTarget.width / 2, cropBefore.cx, 1e-6) && near((fillTarget.cropY || 0) + fillTarget.height / 2, cropBefore.cy, 1e-6) && near(tl(fillTarget).x, cb.left));
  field('grid-cell-mode', 'fit');
  assert('Back to fit: the crop it had comes back', near(fillTarget.width, cropBefore.w, 1e-6) && near(fillTarget.height, cropBefore.h, 1e-6) && fits(fillTarget, cb));
  const label0 = labels(grid).find(l => l.mfcGridLabel === 'col' && l.mfcGridIndex === 0);
  label0.set('text', 'DAPI'); canvas.fire('object:modified', { target: label0 });
  canvas.setActiveObject(label0); drag(centre(label0), { x: centre(label0).x + 80, y: centre(label0).y + 80 });
  assert('A label is ordinary text (renamed DAPI) and goes back to its band when dragged', label0.text === 'DAPI' && near(tl(label0).x, boxPx(grid, Gm.colLabelBox(grid.mfcGrid, 0)).left));

  // ---- Exports ----
  const svg = (await MFC_EXPORT.buildSVG()).svg;
  const count = (s, re) => (s.match(re) || []).length;
  const page1 = MFC.pageBounds(0), onPage = canvas.getObjects().filter(o => o.mfcType === 'mfcImage' && o.visible !== false).filter(o => { const b = o.getBoundingRect(true, true);
    return b.left < page1.left + page1.width && b.left + b.width > page1.left && b.top < page1.top + page1.height && b.top + b.height > page1.top; }).length;
  assert('SVG export: the panels and labels are there, the grid itself and its guides are not', count(svg, /<image /g) === onPage && onPage >= 2 && /DAPI/.test(svg) && /Row 1/.test(svg) &&
    !/rgba\(91,140,255/.test(svg) && !/91,140,255/.test(svg), `images ${count(svg, /<image /g)} vs ${onPage} on the page, DAPI ${/DAPI/.test(svg)}, Row 1 ${/Row 1/.test(svg)}, guides ${/91,140,255/.test(svg)}`);
  const pdf = await MFC_EXPORT.buildPDF();
  assert('PDF export works with a grid', pdf.blob.size > 1000);
  const tiff = await MFC_EXPORT.buildTIFF(), png = await MFC_EXPORT.buildPNG();
  assert('TIFF and PNG exports work with a grid, at the page size', tiff.pixelWidth === 1200 && png.pixelWidth === 1200);
  const blue = await (async () => { const c = await MFC_EXPORT.renderSVG(await MFC_EXPORT.buildSVG()); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 91 && d[i + 1] === 140 && d[i + 2] === 255) n++; return n; })();
  assert('No guide pixel in the raster export', blue === 0, blue);
  const checkLines = MFC.getCanvas() && (await import(new URL('js/ui/figure-check.js', document.baseURI).href)).checkFigure();
  assert('The figure check ignores the grid object', !JSON.stringify(checkLines).includes('layoutGrid'));

  // ---- Save, load, undo, copy ----
  const saved = JSON.stringify(grid.mfcGrid), gridId = grid.mfcId, positions = grid.mfcGrid.areas.map(a => tl(byId(a.panel)));
  const next = MFC_PROJECT.prepareSave(true, 'grid'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
  await MFC.closeDocument(); await load(archive, 'grid.fluoforge');
  grid = grids()[0];
  assert('Save and load: the grid comes back with its cells, panels, labels and places', grid && grid.mfcId === gridId && JSON.stringify(grid.mfcGrid) === saved && labels(grid).length === 4 &&
    grid.mfcGrid.areas.every((a, i) => near(tl(byId(a.panel)).x, positions[i].x, 1e-4) && near(tl(byId(a.panel)).y, positions[i].y, 1e-4)) && labels(grid).some(l => l.text === 'DAPI'),
    `grid ${!!grid}, same grid ${grid && JSON.stringify(grid.mfcGrid) === saved}, labels ${grid && labels(grid).length}`);
  const p0 = panelAt(grid, 0, 0), p1 = panelAt(grid, 0, 1);
  canvas.setActiveObject(p0); drag(centre(p0), centre(p1));
  assert('…and it still works: a drag swaps two panels', panelAt(grid, 0, 1) === p0 && panelAt(grid, 0, 0) === p1);
  await MFC.undo(); await MFC_TIFF.whenIdle(); grid = grids()[0];
  assert('Undo puts the two panels back', panelAt(grid, 0, 0).mfcId === p0.mfcId && panelAt(grid, 0, 1).mfcId === p1.mfcId);
  canvas.setActiveObject(grid); MFC.copySelection(); await MFC.pasteSelection();
  const pasted = grids().find(g => g.mfcId !== gridId), original = grids().find(g => g.mfcId === gridId);
  assert('Copy and paste a grid: a second grid with its own copies of the panels and labels', grids().length === 2 && pasted.mfcGrid.areas.length === original.mfcGrid.areas.length &&
    pasted.mfcGrid.areas.every(a => byId(a.panel) && byId(a.panel).mfcGridId === pasted.mfcId && !original.mfcGrid.areas.some(b => b.panel === a.panel)) && labels(pasted).length === 4 &&
    original.mfcGrid.areas.every(a => byId(a.panel).mfcGridId === original.mfcId));
  const q0 = panelAt(pasted, 0, 0), q1 = panelAt(pasted, 0, 1);
  canvas.setActiveObject(q0); drag(centre(q0), centre(q1));
  assert('…and the pasted grid works on its own (swap), leaving the original unchanged', panelAt(pasted, 0, 1) === q0 && panelAt(original, 0, 0).mfcId === p0.mfcId);
  canvas.setActiveObject(pasted); canvas.fire('selection:created', { selected: [pasted] });
  const pastedPanels = pasted.mfcGrid.areas.map(a => byId(a.panel)), pastedLabels = labels(pasted);
  document.getElementById('grid-remove').click();
  assert('Remove grid: the grid and its labels go, its panels stay where they are', !canvas.contains(pasted) && pastedLabels.every(l => !canvas.contains(l)) && pastedPanels.every(p => canvas.contains(p) && !p.mfcGridId));
  await MFC.undo(); await MFC_TIFF.whenIdle();
  assert('Undo brings it back with its labels and panels', grids().length === 2 && labels(grids().find(g => g.mfcId !== gridId)).length === 4);

  // ---- The old Grid button and MFC.arrangeGrid on a project without a grid ----
  await MFC.closeDocument(); await load(reference, 'reference.mfcproj.zip');
  const imgs = canvas.getObjects().filter(o => o.mfcType === 'mfcImage');
  canvas.discardActiveObject();
  MFC.arrangeGrid({ rows: 2, cols: 2, cellW: 200, cellH: 150, gap: 10, headerRow: true, headerCol: false });
  grid = grids()[0];
  const first = imgs[0], s = Math.min(200 / first.width, 150 / first.height);
  assert('MFC.arrangeGrid (the former one-shot Grid) still works without a Grid object: same placement as before, now a grid',
    grid && near(tl(first).x, 40 + (200 - first.width * s) / 2) && near(tl(first).y, 40 + 44 + (150 - first.height * s) / 2) && near(first.scaleX, s, 1e-6) && labels(grid).length === 2);
  await MFC.undo(); await MFC_TIFF.whenIdle();
  assert('…and undo takes it all back', grids().length === 0 && !canvas.getObjects().some(o => o.mfcGridId));

  // ---- Montage panels in a grid ----
  const M = await import(new URL('js/image/montage.js', document.baseURI).href);
  const src = canvas.getObjects().find(o => o.mfcType === 'mfcImage' && !o.mfcIsInset && !o.angle);
  M.quickFigure([src], { grey: false, mergeFirst: false, gapMm: 1, channels: [0, 1] }); await MFC_TIFF.whenIdle();
  const montage = canvas.getObjects().filter(o => o.mfcMontageGroup && o.mfcType === 'mfcImage');
  canvas.setActiveObject(new fabric.ActiveSelection(montage, { canvas }));
  field('grid-rows', 1); field('grid-cols', 3); field('grid-width', 120); document.getElementById('grid-mode').value = 'fill';
  document.getElementById('grid-arrange').click();
  grid = grids()[0];
  const crops = montage.map(p => [p.cropX, p.cropY, p.width, p.height].map(x => x.toFixed(6)).join());
  assert('Montage panels go into a grid; in fill mode with same-size cells their crops are identical', grid.mfcGrid.areas.length === 3 && new Set(crops).size === 1 && montage.every(p => p.mfcGridId === grid.mfcId), crops.join(' | '));
  canvas.setActiveObject(montage[1]); MFC.setTool('crop');
  document.getElementById('crop-mode-rect').click();
  document.getElementById('crop-width').value = '60'; document.getElementById('crop-height').value = '40';
  document.getElementById('crop-width').focus(); MFC.applyCropFieldsToRect(); MFC.applyCrop(); MFC.setTool('select');
  const after = montage.map(p => [p.cropX, p.cropY, p.width, p.height].map(x => x.toFixed(6)).join());
  assert('Cropping one montage panel in the grid crops all of them the same, and they stay in their cells', new Set(after).size === 1 && after[0] !== crops[0] &&
    grid.mfcGrid.areas.every(a => { const p = byId(a.panel), b = boxPx(grid, Gm.areaBox(grid.mfcGrid, a)); return near(p.getScaledWidth(), b.width) && near(tl(p).x, b.left); }), after.join(' | '));

  // ---- The panel: titles, keyboard, themes ----
  canvas.setActiveObject(grid); canvas.fire('selection:created', { selected: [grid] });
  const controls = [...panel.querySelectorAll('input, select, button')];
  assert('Every Grid panel control has a title (its own or its label\'s)', controls.every(c => (c.title || c.closest('[title]')?.title || '').length > 5), controls.filter(c => !(c.title || c.closest('[title]')?.title)).map(c => c.id).join());
  canvas.setActiveObject(montage[0]); canvas.fire('selection:created', { selected: [montage[0]] }); panel.scrollIntoView();
  const hiddenButtons = [...panel.querySelectorAll('.grid-buttons button')].filter(b => { const r = b.getBoundingClientRect(), box = panel.getBoundingClientRect(); return !(r.width > 0 && r.height > 0 && r.right <= box.right + 1 && r.left >= box.left - 1); });
  assert('All nine row, column and span buttons are shown inside the panel (they wrap)', panel.querySelectorAll('.grid-buttons button').length === 9 && !hiddenButtons.length, hiddenButtons.map(b => b.id).join());
  const gw = document.getElementById('grid-edit-gutter'); gw.focus(); if (document.activeElement !== gw) { await frame(); gw.focus(); }
  assert('Its fields take keyboard focus', document.activeElement === gw);
  const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (x, y) => { const [h, l] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (h + 0.05) / (l + 0.05); };
  const opaque = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (!/rgba\(.*,\s*0\)$|transparent/.test(c)) return c; } return 'rgb(255,255,255)'; };
  const savedTheme = document.documentElement.dataset.theme, ratios = [];
  for (const theme of ['light', 'sage', 'dark', 'slate']) {
    document.documentElement.dataset.theme = theme;
    for (const el of [document.getElementById('grid-info'), document.getElementById('grid-row-above'), panel.querySelector('#grid-edit label'), gw]) ratios.push(contrast(getComputedStyle(el).color, opaque(el)));
  }
  if (savedTheme) document.documentElement.dataset.theme = savedTheme; else delete document.documentElement.dataset.theme;
  assert('The Grid panel is readable in all four themes (contrast ≥ 4.5)', ratios.every(r => r >= 4.5), ratios.map(r => r.toFixed(1)).join());
  return checks;
}

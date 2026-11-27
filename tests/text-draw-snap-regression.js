/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* PI-T6: text boxes drawn to size, and text that snaps when resized. With mouse events on the canvas:
   - the Text tool: a drag draws a text box of the dragged width and height (its box height), which
     keeps that size when typed into; a click still inserts a 200 px wide box; each is one History step;
   - resizing a text box by its side handle snaps its edge to a guide (the width changes), by its bottom
     handle snaps its box height, by a corner snaps and scales the text, the opposite corner staying put;
   - not with the Text panel's "Snap when resizing" off (a preference), nor with Alt held. */
async function runTextDrawSnapRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 0.75) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const G = await import(new URL('js/layout/guides.js', document.baseURI).href);
  const P = await import(new URL('js/core/preferences.js', document.baseURI).href);
  const el = canvas.upperCanvasEl;
  const scale = () => el.getBoundingClientRect().width / canvas.getWidth();
  const client = (x, y) => { const r = el.getBoundingClientRect(), v = canvas.viewportTransform, k = scale(); return { clientX: r.left + (x * v[0] + v[4]) * k, clientY: r.top + (y * v[3] + v[5]) * k }; };
  const fromScreen = (sx, sy) => { const r = el.getBoundingClientRect(), k = scale(); return { clientX: r.left + sx * k, clientY: r.top + sy * k }; };
  const mouse = (type, at, keys = {}, target = el) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1, ...keys, ...at }));
  const dragPage = async (x1, y1, x2, y2) => { mouse('mousedown', client(x1, y1)); mouse('mousemove', client((x1 + x2) / 2, (y1 + y2) / 2), {}, document); mouse('mousemove', client(x2, y2), {}, document); mouse('mouseup', client(x2, y2), {}, document); await frame(); };
  /** Drags a text box's handle (`corner`) to page point (x, y); `during` reads the box before the mouse is released. */
  async function dragHandle(box, corner, x, y, keys = {}, during = null) {
    box.setCoords();
    const c = box.oCoords[corner];
    mouse('mousedown', fromScreen(c.x, c.y), keys);
    const to = client(x, y), from = fromScreen(c.x, c.y);
    mouse('mousemove', { clientX: (from.clientX + to.clientX) / 2, clientY: (from.clientY + to.clientY) / 2 }, keys, document);
    mouse('mousemove', to, keys, document);
    const seen = during ? during() : null;
    mouse('mouseup', to, keys, document);
    await frame();
    return seen;
  }
  const rect = o => o.getBoundingRect(true, true);
  const savedSnap = P.getPreference('text.snapResize');

  try {
    await MFC_PROJECT.createProject({ name: 'Text drawn', width: 1200, height: 800, unit: 'px', dpi: 300 });
    await frame();

    // ---- drawing a text box ----
    let steps = MFC.getHistory().labels.length;
    MFC.setTool('text');
    await dragPage(100, 100, 400, 250);
    let box = canvas.getActiveObject();
    assert('A drag with the Text tool draws a text box of that size: 300 × 150 px at (100, 100)', box && box.type === 'textbox' && near(box.left, 100) && near(box.top, 100) && near(box.width, 300) && near(box.mfcBoxHeight, 150) && near(box.height, 150),
      box && JSON.stringify({ left: box.left, top: box.top, width: box.width, height: box.height, boxHeight: box.mfcBoxHeight }));
    assert('…in one History step, editing its text, back to the Select tool', MFC.getHistory().labels.length === steps + 1 && box.isEditing && MFC.currentTool === 'select', MFC.getHistory().labels.length - steps);
    assert('…and no dashed preview is left on the canvas', !canvas.getObjects().some(o => o.mfcIsPreview));
    box.exitEditing();
    box.set('text', 'A longer caption typed into the drawn box'); box.initDimensions(); box.setCoords(); canvas.fire('object:modified', { target: box });
    assert('Typed into, it keeps its drawn size (the text wraps inside it)', near(box.width, 300) && near(box.height, 150) && box._textLines.length > 1, `${box.width} × ${box.height}, ${box._textLines.length} lines`);
    steps = MFC.getHistory().labels.length;
    MFC.setTool('text');
    mouse('mousedown', client(700, 500)); mouse('mouseup', client(700, 500), {}, document); await frame();
    const clicked = canvas.getActiveObject();
    assert('A click still inserts a text box as before: 200 px wide, at the point, no box height of its own', clicked !== box && clicked.type === 'textbox' && near(clicked.left, 700) && near(clicked.top, 500) && clicked.width === 200 && !clicked.mfcBoxHeight &&
      MFC.getHistory().labels.length === steps + 1, JSON.stringify({ left: clicked.left, width: clicked.width, h: clicked.mfcBoxHeight }));
    clicked.exitEditing(); canvas.remove(clicked);

    // ---- resizing snaps ----
    G.setGuides([{ axis: 'v', pos: 520 }, { axis: 'h', pos: 330 }]);
    canvas.setActiveObject(box); await frame();
    assert('The Text panel has "Snap when resizing", on by default', $('text-snap-resize') && $('text-snap-resize').checked && P.getPreference('text.snapResize') === true);
    const threshold = P.getPreference('snap.distance') / MFC.getZoomLevel();
    const off = Math.min(4, threshold / 2); // within the snap distance at this zoom
    const left0 = box.left;
    await dragHandle(box, 'mr', 520 - off, 175);
    assert('Its right side handle dragged near a guide snaps the edge onto it: the width changes, the left edge stays', near(rect(box).left + rect(box).width, 520) && near(box.left, left0),
      `${rect(box).left + rect(box).width} (threshold ${threshold.toFixed(1)})`);
    await dragHandle(box, 'mb', 300, 330 - off);
    assert('Its bottom handle near a guide snaps the box height onto it', near(rect(box).top + rect(box).height, 330) && near(box.top, 100), rect(box).top + rect(box).height);
    const guidesBefore = JSON.stringify(MFC.getDocProps().guides);
    const altSeen = await dragHandle(box, 'mr', 520 + 3 * off, 175, { altKey: true }, () => ({ transform: !!canvas._currentTransform }));
    assert('A handle lying on the guide it snapped to can be grabbed again: the box resizes and the guide stays', altSeen.transform && JSON.stringify(MFC.getDocProps().guides) === guidesBefore, JSON.stringify(MFC.getDocProps().guides));
    const altRight = rect(box).left + rect(box).width;
    assert('With Alt held (Fabric then resizes from the centre), it does not snap: the edge stops where the mouse is', altSeen.transform && near(altRight, 520 + 3 * off, 1.5) && !near(altRight, 520, 0.3), altRight + ' ' + JSON.stringify(altSeen));
    await dragHandle(box, 'mr', 520 - off, 175); // back on the guide

    // ---- the option off ----
    $('text-snap-resize').click(); await frame();
    assert('Unticking "Snap when resizing" turns the preference off', P.getPreference('text.snapResize') === false);
    await dragHandle(box, 'mr', 520 - off, 175);
    assert('With the option off, the side handle stops where the mouse is, not on the guide', near(rect(box).left + rect(box).width, 520 - off, 1.5) && !near(rect(box).left + rect(box).width, 520, 0.3),
      rect(box).left + rect(box).width);
    await dragHandle(box, 'mb', 300, 330 - off);
    assert('…and so does the bottom handle', near(rect(box).top + rect(box).height, 330 - off, 1.5) && !near(rect(box).top + rect(box).height, 330, 0.3), rect(box).top + rect(box).height);
    $('text-snap-resize').click(); await frame();
    assert('Ticking it again turns it back on', P.getPreference('text.snapResize') === true);

    // ---- a corner scales the text, and snaps ----
    await dragHandle(box, 'mr', 480, 175); await dragHandle(box, 'mr', 520 - off, 175); // back on the guides
    await dragHandle(box, 'mb', 300, 290); await dragHandle(box, 'mb', 300, 330 - off);
    assert('Ticked again, it snaps again', near(rect(box).left + rect(box).width, 520) && near(rect(box).top + rect(box).height, 330), JSON.stringify(rect(box)));
    const before = rect(box);
    const seen = await dragHandle(box, 'br', 520 + 30, 330 + 40 - off, {}, () => { const r = rect(box); return { right: r.left + r.width, bottom: r.top + r.height, left: r.left, top: r.top, scale: box.scaleX, t: canvas._currentTransform && canvas._currentTransform.corner + '/' + canvas._currentTransform.action }; });
    assert('A corner scales the text, the opposite corner staying put', near(seen.left, before.left) && near(seen.top, before.top) && seen.scale > 1, JSON.stringify(seen));
    await MFC.undo(); await frame(); // back to the box before that corner drag
    box = canvas.getObjects().find(o => o.type === 'textbox'); canvas.setActiveObject(box); await frame();
    const r0 = rect(box), f = 1.25, gx = Math.round(r0.left + r0.width * f);
    G.setGuides([{ axis: 'v', pos: gx }]); await frame();
    // The mouse on the box's diagonal, a little short of the guide: the corner snaps onto it.
    const k = (gx - off - r0.left) / r0.width;
    const seen2 = await dragHandle(box, 'br', r0.left + r0.width * k, r0.top + r0.height * k, {}, () => { const r = rect(box); return { right: r.left + r.width, left: r.left, top: r.top, sx: box.scaleX, sy: box.scaleY }; });
    assert('…and its moving corner snaps onto a guide: the text scales so its edge lands on it, uniformly', near(seen2.right, gx) && near(seen2.left, r0.left) && near(seen2.top, r0.top) && near(seen2.sx, seen2.sy, 1e-6), JSON.stringify({ gx, ...seen2 }));
    assert('…and letting go folds the scale into the font size', box.scaleX === 1 && box.fontSize > 24, `${box.scaleX} ${box.fontSize}`);
  } finally {
    P.setGlobalPreference('text.snapResize', savedSnap);
    MFC.setTool('select');
  }
  return checks;
}

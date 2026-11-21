/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Snapping while dragging.
   - computeSnap (pure): each edge choice, the threshold, nearest wins, axes independent.
   - Real mouse drags through Fabric: a dragged object lands exactly on a neighbour's edge, also over
     several mouse moves (Fabric does not update an object's cached corners during a drag, which made
     snapping measure the old position: the bug shown in the bug report's recording).
   - Preferences: snapping off, page or objects only, chosen edges, distance in screen px at any zoom,
     guides on or off; Alt moves freely; hidden objects are not targets; guides are cleared on release
     and never reach the document or the exports. */

async function runSnappingRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const S = await import(new URL('js/layout/snap.js', document.baseURI).href);
  const P = await import(new URL('js/core/preferences.js', document.baseURI).href);
  const savedStore = localStorage.getItem(P.STORAGE_KEY);
  localStorage.removeItem(P.STORAGE_KEY); P.reloadGlobalPreferences();

  try {
    // ---- computeSnap ----
    const box = { left: 103, top: 205, width: 50, height: 40 }, target = { left: 100, top: 200, width: 80, height: 60 };
    let r = S.computeSnap(box, [target], { threshold: 8 });
    assert('computeSnap: left onto left and top onto top, with guides at the target edges', r.dx === -3 && r.dy === -5 && r.guideX === 100 && r.guideY === 200, JSON.stringify(r));
    r = S.computeSnap(box, [target], { threshold: 2 });
    assert('computeSnap: nothing snaps beyond the threshold', r.dx === null && r.dy === null);
    r = S.computeSnap(box, [target], { edges: ['right', 'bottom'], threshold: 8 });
    assert('computeSnap: only the chosen edges count (right and bottom: 153 is 27 from 180, so no snap)', r.dx === null && r.dy === null, JSON.stringify(r));
    r = S.computeSnap({ left: 117, top: 0, width: 50, height: 10 }, [target], { edges: ['hcenter'], threshold: 8 });
    assert('computeSnap: centre onto centre (142 → 140)', r.dx === -2 && r.dy === null && r.guideX === 140, JSON.stringify(r));
    r = S.computeSnap({ left: 182, top: 300, width: 20, height: 20 }, [target], { edges: ['left', 'right'], threshold: 8 });
    assert('computeSnap: with left and right chosen, a left edge snaps onto a right edge (side by side)', r.dx === -2 && r.guideX === 180, JSON.stringify(r));
    r = S.computeSnap({ left: 0, top: 197, width: 10, height: 10 }, [target, { left: 0, top: 198, width: 5, height: 5 }], { edges: ['top'], threshold: 8 });
    assert('computeSnap: the nearest edge wins', r.dy === 1 && r.guideY === 198, JSON.stringify(r));
    r = S.computeSnap({ left: 0, top: 0, width: 10, height: 10 }, [target], { edges: [], threshold: 8 });
    assert('computeSnap: no chosen edge, no snap', r.dx === null && r.dy === null);

    // ---- Real drags ----
    MFC.applyDocProps({ name: 'Snapping', width: 1200, height: 800, unit: 'px', dpi: 300 });
    const canvas = MFC.getCanvas();
    canvas.getObjects().filter(o => o.mfcId).forEach(o => canvas.remove(o));
    MFC.setZoom(0.75); MFC.setTool('select');
    const rect = (id, left, top, width, height, fill) => { const o = new fabric.Rect({ left, top, width, height, fill, strokeWidth: 0 }); o.mfcId = id; o.mfcType = 'shape'; o.mfcShapeKind = 'rect'; canvas.add(o); return o; };
    const a = rect('snap-a', 120, 150, 300, 60, '#333333');
    const b = rect('snap-b', 520, 420, 200, 40, '#999999'); // 40 high: its middle never meets A's
    const drag = (obj, steps, { alt = false, release = true } = {}) => {
      canvas.renderAll(); canvas.calcOffset(); obj.setCoords();
      const el = canvas.upperCanvasEl.getBoundingClientRect(), c = obj.getCenterPoint(), z = canvas.getZoom(), vpt = canvas.viewportTransform;
      let x = el.left + c.x * z + vpt[4], y = el.top + c.y * z + vpt[5];
      canvas.upperCanvasEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, buttons: 1, altKey: alt }));
      for (const [dx, dy] of steps) { x += dx * z; y += dy * z; document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, buttons: 1, altKey: alt })); }
      if (release) document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y, altKey: alt }));
    };
    const edges = o => { const bb = o.getBoundingRect(true, true); return { left: bb.left, top: bb.top, right: bb.left + bb.width, bottom: bb.top + bb.height }; };

    // Move B so that it is dropped 3 document px right of and 4 below A's top-left corner, in several moves.
    const DROP = [[-150, -100], [-100, -80], [-147, -86]]; // total −397, −266 → left 123, top 154
    let start = edges(b);
    drag(b, DROP);
    assert('A real drag over several mouse moves lands exactly on the neighbour\'s top and left edges', Math.abs(edges(b).top - edges(a).top) < 1e-6 && Math.abs(edges(b).left - edges(a).left) < 1e-6,
      JSON.stringify({ a: edges(a), b: edges(b), start }));
    assert('The drag pushes one undo step and leaves no guide behind', S.snapGuides() === null);

    // The same drag ending 4 px away, but with Alt: no snap.
    b.set({ left: 520, top: 420 }); b.setCoords();
    drag(b, DROP, { alt: true });
    assert('Alt moves freely: no snap', Math.abs(edges(b).top - 154) < 1.5 && Math.abs(edges(b).left - 123) < 1.5, JSON.stringify(edges(b)));

    // Guides while the button is down; cleared on release; not in the document or the export.
    b.set({ left: 520, top: 420 }); b.setCoords();
    drag(b, DROP, { release: false });
    const during = S.snapGuides();
    assert('While dragging, guides mark the snapped edges', during && during.x === 120 && during.y === 150, JSON.stringify(during));
    const svgWhileDragging = (await MFC_EXPORT.buildSVG()).svg;
    assert('Guides are not objects of the figure and are not exported', !canvas.getObjects().some(o => o.stroke === '#e0368f') && !/e0368f/i.test(svgWhileDragging));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0 }));
    assert('Releasing the mouse clears the guides', S.snapGuides() === null);

    // ---- Preferences ----
    const tryDrop = (prefs, steps = DROP) => {
      for (const [k, v] of Object.entries(prefs)) P.setGlobalPreference(k, v);
      b.set({ left: 520, top: 420 }); b.setCoords(); drag(b, steps);
      const e = edges(b); P.resetGlobalPreferences(); return e;
    };
    let e = tryDrop({ 'snap.enabled': false });
    assert('Snapping off: the object stays where it is dropped', Math.abs(e.top - 154) < 1.5 && Math.abs(e.left - 123) < 1.5, JSON.stringify(e));
    e = tryDrop({ 'snap.edges': ['top', 'bottom', 'vcenter'] });
    assert('Only top, middle and bottom chosen: tops align, the left edge does not snap', Math.abs(e.top - 150) < 1e-6 && Math.abs(e.left - 123) < 1.5, JSON.stringify(e));
    e = tryDrop({ 'snap.edges': ['left'] });
    assert('Only left chosen: left edges align, the top does not snap', Math.abs(e.left - 120) < 1e-6 && Math.abs(e.top - 154) < 1.5, JSON.stringify(e));
    e = tryDrop({ 'snap.toObjects': false });
    assert('Snap to objects off: no snap to the neighbour (the page edges are far away)', Math.abs(e.top - 154) < 1.5 && Math.abs(e.left - 123) < 1.5, JSON.stringify(e));
    e = tryDrop({ 'snap.toPage': true }, [[-515, -416]]); // left 5, top 4: near the page corner
    assert('Snap to the page: the page edges are targets', Math.abs(e.left) < 1e-6 && Math.abs(e.top) < 1e-6, JSON.stringify(e));
    e = tryDrop({ 'snap.toPage': false }, [[-515, -416]]);
    assert('Snap to the page off: the page edges are not', Math.abs(e.left - 5) < 1.5 && Math.abs(e.top - 4) < 1.5, JSON.stringify(e));
    e = tryDrop({ 'snap.distance': 2 });
    assert('A 2 px snap distance (2.7 document px at 75 %) does not reach an edge 4 document px away', Math.abs(e.top - 154) < 1.5, JSON.stringify(e));
    MFC.setZoom(2);
    e = tryDrop({});
    assert('At 200 %, 8 screen px are 4 document px: edges 3 and 4 px away still snap', Math.abs(e.top - 150) < 1e-6 && Math.abs(e.left - 120) < 1e-6, JSON.stringify(e));
    e = tryDrop({}, [[-397, -260]]); // top 160: 10 document px = 20 screen px away
    assert('At 200 %, an edge 10 document px away (20 screen px) does not snap', Math.abs(e.top - 160) < 1.5, JSON.stringify(e));
    MFC.setZoom(0.75);
    P.setGlobalPreference('snap.guides', false);
    b.set({ left: 520, top: 420 }); b.setCoords(); drag(b, DROP, { release: false });
    assert('Show guides off: it still snaps, without guides', S.snapGuides() === null && Math.abs(edges(b).top - 150) < 1e-6);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0 }));
    P.resetGlobalPreferences();
    a.visible = false;
    e = tryDrop({});
    assert('A hidden object is not a snap target', Math.abs(e.top - 154) < 1.5 && Math.abs(e.left - 123) < 1.5, JSON.stringify(e));
    a.visible = true;

    // A project override wins over the global value.
    P.setGlobalPreference('snap.enabled', true);
    P.setProjectPreference('snap.enabled', false);
    b.set({ left: 520, top: 420 }); b.setCoords(); drag(b, DROP);
    assert('A project that turns snapping off overrides the global "on"', Math.abs(edges(b).top - 154) < 1.5);
    P.setProjectPreference('snap.enabled', undefined);
    b.set({ left: 520, top: 420 }); b.setCoords(); drag(b, DROP);
    assert('Removing the project value brings back the global one', Math.abs(edges(b).top - 150) < 1e-6);

    // Keyboard nudges still pass through snap lines.
    b.set({ left: 121, top: 300 }); b.setCoords(); canvas.setActiveObject(b);
    MFC.nudgeSelection(-1, 0, true);
    assert('A 1 px keyboard nudge is not snapped back (it moves 1 px)', Math.abs(b.left - 120) < 1e-6 && S.snapGuides() === null);
    canvas.discardActiveObject();
  } finally {
    if (savedStore === null) localStorage.removeItem(P.STORAGE_KEY); else localStorage.setItem(P.STORAGE_KEY, savedStore);
    P.reloadGlobalPreferences();
  }
  return checks;
}

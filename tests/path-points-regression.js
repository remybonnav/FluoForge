/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* PI-T5: editing the points of paths and lines, and closing a path while drawing. With mouse events on
   the canvas (mousedown on the canvas, mousemove and mouseup on the document, contextmenu for the right
   click):
   - drawing with the Pen tool, the pointer near the first point snaps onto it and highlights it; a click
     there closes the path (three points, a Z), in one History step;
   - right-click > Modify points shows the anchors; dragging one, Add point here and Delete point change the
     path without History steps; Escape, a click outside, or undo ends editing in exactly one step;
   - a Shape-tool line gets Modify points too: changed, it becomes a two-point path; unchanged, it stays a line;
   - undo and redo, save and reopen, and SVG, PDF and TIFF exports keep the closed, edited path. */
async function runPathPointsRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = () => MFC.getCanvas();
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const near = (a, b, tol = 0.75) => Math.abs(a - b) <= tol;
  const PT = await import(new URL('js/tools/path.js', document.baseURI).href);
  const pdfjs = await import(new URL('assets/vendor/pdfjs/pdf.min.mjs', document.baseURI).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
  const el = () => canvas().upperCanvasEl;
  const scale = () => el().getBoundingClientRect().width / canvas().getWidth();
  const client = (x, y) => { const r = el().getBoundingClientRect(), v = canvas().viewportTransform, k = scale(); return { clientX: r.left + (x * v[0] + v[4]) * k, clientY: r.top + (y * v[3] + v[5]) * k }; };
  const fromScreen = c => { const r = el().getBoundingClientRect(), k = scale(); return { clientX: r.left + c.x * k, clientY: r.top + c.y * k }; };
  const mouse = (type, at, keys = {}, target = el()) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1, detail: 1, ...keys, ...at }));
  const hover = (x, y) => el().dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 0, ...client(x, y) }));
  const click = async (x, y) => { mouse('mousedown', client(x, y)); mouse('mouseup', client(x, y), {}, document); await frame(); };
  const dragFrom = async (from, x, y) => { const to = client(x, y); mouse('mousedown', from); mouse('mousemove', { clientX: (from.clientX + to.clientX) / 2, clientY: (from.clientY + to.clientY) / 2 }, {}, document); mouse('mousemove', to, {}, document); mouse('mouseup', to, {}, document); await frame(); };
  /** Drags the anchor of point `i` of a path in node editing to page point (x, y). */
  const dragPoint = async (path, i, x, y) => { path.setCoords(); await dragFrom(fromScreen(path.oCoords['a' + i]), x, y); };
  const world = (path, node) => fabric.util.transformPoint(new fabric.Point(node.x - path.pathOffset.x, node.y - path.pathOffset.y), path.calcTransformMatrix());
  const points = path => path.mfcPathNodes.map(n => world(path, n)).map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ');
  /** Right-clicks at page point (x, y); returns the menu's items by label. */
  const rightClick = async (x, y) => {
    el().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, buttons: 2, ...client(x, y) }));
    await frame();
    const menu = document.querySelector('.context-menu');
    return Object.fromEntries([...(menu ? menu.querySelectorAll('.context-item') : [])].map(b => [b.textContent, b]));
  };
  const closeMenu = () => document.querySelectorAll('.context-menu').forEach(m => m.remove());
  const escape = async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await frame(); };
  const steps = () => MFC.getHistory().labels.length;
  const lastLabel = () => { const h = MFC.getHistory(); return h.labels[h.index]; };
  const thePath = () => canvas().getObjects().find(o => o.mfcId === pathId);
  const pixel = (data, width, x, y) => { const i = (Math.round(y) * width + Math.round(x)) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const isRed = p => p[0] > 150 && p[1] < 90 && p[2] < 90, isWhite = p => p[0] > 235 && p[1] > 235 && p[2] > 235;
  let pathId = null;

  await MFC_PROJECT.createProject({ name: 'Points', width: 1000, height: 700, unit: 'px', dpi: 300 });
  await frame();

  // ================= closing a path while drawing =================
  MFC.setTool('path');
  document.getElementById('path-stroke-color').value = '#d62728';
  document.getElementById('path-stroke-width').value = '8';
  const before = steps();
  await click(200, 200); hover(300, 200); await click(400, 200); hover(400, 300); await click(400, 400);
  hover(300, 300); await frame();
  assert('Drawing a path, the first point is not highlighted far from it', PT.pathDraft && !PT.pathDraft.closing && !PT.pathHelpers.some(h => h.mfcPathCloseHint));
  hover(208, 206); await frame();
  assert('…near it, the pointer snaps onto the first point and it is highlighted', PT.pathDraft.closing && near(PT.pathDraft.hover.x, 200) && near(PT.pathDraft.hover.y, 200) && PT.pathHelpers.some(h => h.mfcPathCloseHint),
    JSON.stringify(PT.pathDraft.hover));
  assert('…and the status line says a click closes it', /close the path/i.test(document.getElementById('path-status').textContent), document.getElementById('path-status').textContent);
  hover(260, 260); await frame();
  assert('…moving away takes the highlight off', !PT.pathDraft.closing && !PT.pathHelpers.some(h => h.mfcPathCloseHint));
  hover(207, 205); await click(207, 205);
  let path = canvas().getActiveObject();
  pathId = path && path.mfcId;
  assert('A click there closes the path: three points, closed, a Z, the first point not repeated', path && path.mfcShapeKind === 'path' && path.mfcPathClosed && path.mfcPathNodes.length === 3 && path.path.at(-1)[0] === 'Z' &&
    points(path) === '200,200 400,200 400,400', path && points(path));
  assert('…in one History step, with no drawing helpers left, back to the Select tool', steps() === before + 1 && !canvas().getObjects().some(o => o.mfcIsPathHelper || o.mfcIsPathDraft) && MFC.currentTool === 'select', steps() - before);
  const closedState = points(path);

  // ================= Modify points from the right-click menu =================
  let items = await rightClick(300, 200);
  assert('Right-click on the path offers Modify points', !!items['Modify points'] && document.querySelector('.context-menu').getAttribute('aria-label') === 'Path', Object.keys(items).join('|'));
  items['Modify points'].click(); await frame();
  assert('Modify points shows its anchors to drag', path.__mfcNodeEdit && ['a0', 'a1', 'a2'].every(k => path.controls[k]));
  const H = steps();
  await dragPoint(path, 1, 450, 180);
  assert('Dragging an anchor moves that point', points(path) === '200,200 450,180 400,400', points(path));
  assert('…without a History step while editing', steps() === H, steps() - H);
  items = await rightClick(300, 300);
  assert('While editing, the menu offers Add point here, Delete point and Done', !!items['Add point here'] && !!items['Delete point'] && !!items['Done modifying points'] && !items['Modify points'], Object.keys(items).join('|'));
  items['Add point here'].click(); await frame();
  assert('Add point here adds a point on the nearest segment (the closing one), where right-clicked', path.mfcPathNodes.length === 4 && points(path) === '200,200 450,180 400,400 300,300' && path.mfcPathClosed, points(path));
  path.setCoords();
  const at1 = fromScreen(path.oCoords.a1); mouse('mousedown', at1); mouse('mouseup', at1, {}, document); await frame();
  assert('Clicking an anchor selects that point', path.__mfcSelectedNode === 1, path.__mfcSelectedNode);
  items = await rightClick(350, 350);
  items['Delete point'].click(); await frame();
  assert('Delete point deletes the selected point', points(path) === '200,200 400,400 300,300' && path.mfcPathClosed, points(path));
  assert('…all still without a History step', steps() === H && path.__mfcNodeEdit, steps() - H);
  await escape();
  assert('Escape ends editing in exactly one History step ("Reshaped")', !path.__mfcNodeEdit && steps() === H + 1 && /Reshaped/.test(lastLabel()), `${steps() - H} ${lastLabel()}`);
  await MFC.undo(); await frame();
  assert('Undo brings back the path as drawn, in one step', points(thePath()) === closedState && thePath().mfcPathClosed, points(thePath()));
  await MFC.redo(); await frame();
  path = thePath();
  assert('Redo brings back all the point edits', points(path) === '200,200 400,400 300,300' && path.mfcPathClosed, points(path));

  // ---- a click outside ends editing too ----
  canvas().setActiveObject(path); await frame();
  (await rightClick(350, 400))['Modify points'].click(); await frame();
  const H2 = steps();
  await dragPoint(path, 0, 180, 230);
  await click(800, 600);
  assert('A click on the empty page ends editing, in one History step', !path.__mfcNodeEdit && steps() === H2 + 1 && points(path) === '180,230 400,400 300,300', `${steps() - H2} ${points(path)}`);

  // ---- undo while editing keeps nothing half-done ----
  canvas().setActiveObject(path); await frame();
  (await rightClick(350, 400))['Modify points'].click(); await frame();
  const H3 = steps();
  await dragPoint(path, 2, 320, 260);
  await MFC.undo(); await frame();
  assert('Undo while editing ends it and undoes the whole edit', points(thePath()) === '180,230 400,400 300,300' && !thePath().__mfcNodeEdit && MFC.getHistory().index === H3 - 1, `${points(thePath())} ${MFC.getHistory().index} ${H3}`);
  await MFC.redo(); await frame();
  path = thePath();
  assert('…and redo brings that edit back', points(path) === '180,230 400,400 320,260', points(path));
  const finalPoints = points(path);

  // ================= a line from the Shape tool =================
  MFC.setTool('shape'); MFC.setShapeKind('line');
  await dragFrom(client(600, 100), 800, 250);
  let line = canvas().getActiveObject();
  const lineId = line.mfcId;
  assert('A line drawn with the Shape tool', line && line.mfcShapeKind === 'line');
  MFC.setTool('select'); canvas().setActiveObject(line); await frame();
  const L = steps();
  items = await rightClick(700, 175);
  assert('Right-click on a line offers Modify points', !!items['Modify points'], Object.keys(items).join('|'));
  items['Modify points'].click(); await frame();
  assert('Modify points shows its two end points', line.__mfcNodeEdit && line.mfcPathNodes.length === 2 && points(line) === '600,100 800,250', points(line));
  await escape();
  assert('Left unchanged, it is a line again, with no History step', line.mfcShapeKind === 'line' && !('mfcPathNodes' in line) && steps() === L, `${line.mfcShapeKind} ${steps() - L}`);
  (await rightClick(700, 175))['Modify points'].click(); await frame();
  await dragPoint(line, 1, 850, 300);
  await escape();
  assert('Its end point dragged, it becomes a two-point path, in one History step', line.mfcShapeKind === 'path' && points(line) === '600,100 850,300' && steps() === L + 1, `${points(line)} ${steps() - L}`);
  await MFC.undo(); await frame();
  line = canvas().getObjects().find(o => o.mfcId === lineId);
  assert('Undo makes it the line again', line.mfcShapeKind === 'line' && !line.mfcPathNodes);
  await MFC.redo(); await frame();
  line = canvas().getObjects().find(o => o.mfcId === lineId);
  assert('Redo makes it the edited path again', line.mfcShapeKind === 'path' && points(line) === '600,100 850,300');

  // ================= save and reopen =================
  const next = MFC_PROJECT.prepareSave(true, 'points'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
  await MFC.closeDocument();
  await MFC_PROJECT.loadProject(new File([archive], 'points.fluoforge'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await frame();
  path = thePath(); line = canvas().getObjects().find(o => o.mfcId === lineId);
  assert('Saved and reopened: the closed, edited path and the edited line', path && path.mfcPathClosed && path.path.at(-1)[0] === 'Z' && points(path) === finalPoints && line && points(line) === '600,100 850,300', path && points(path));
  canvas().setActiveObject(path); await frame();
  (await rightClick(390, 390))['Modify points'].click(); await frame();
  assert('…and its points can be modified again', path.__mfcNodeEdit && path.controls.a2);
  await escape();

  // ================= exports =================
  // Straight segments: the middle of the edited segment 0→1, and the middle of the original first segment (now empty).
  const n = path.mfcPathNodes.map(p => world(path, p)), onEdge = { x: (n[0].x + n[1].x) / 2, y: (n[0].y + n[1].y) / 2 }, oldEdge = { x: 300, y: 200 };
  const svg = (await MFC_EXPORT.buildSVG()).svg;
  const closedPaths = [...svg.matchAll(/<path[^>]* d="([^"]*)"/g)].map(m => m[1]).filter(d => /z\s*$/i.test(d.trim()));
  assert('SVG export: the closed path is a real path ending in Z', closedPaths.length >= 1, closedPaths.length);
  const tiff = await MFC_EXPORT.buildTIFF({ page: 0 }), buf = await tiff.blob.arrayBuffer(), ifds = UTIF.decode(buf);
  UTIF.decodeImage(buf, ifds[0]); const rgba = UTIF.toRGBA8(ifds[0]), tw = ifds[0].width;
  assert('TIFF export draws the edited path, not the original one', isRed(pixel(rgba, tw, onEdge.x, onEdge.y)) && isWhite(pixel(rgba, tw, oldEdge.x, oldEdge.y)),
    pixel(rgba, tw, onEdge.x, onEdge.y).join() + ' / ' + pixel(rgba, tw, oldEdge.x, oldEdge.y).join());
  const pdfOut = await MFC_EXPORT.buildPDF({}), pdfBytes = new Uint8Array(await pdfOut.blob.arrayBuffer());
  assert('PDF export stays vector (no image)', !/\/Subtype\s*\/Image/.test(new TextDecoder('latin1').decode(pdfBytes)));
  const doc = await pdfjs.getDocument({ data: pdfBytes, isEvalSupported: false }).promise, page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 300 / 72 }), rc = document.createElement('canvas'); rc.width = Math.round(vp.width); rc.height = Math.round(vp.height);
  const rctx = rc.getContext('2d'); await page.render({ canvas: rc, canvasContext: rctx, viewport: vp }).promise;
  const pd = rctx.getImageData(0, 0, rc.width, rc.height).data;
  assert('…and draws the edited path, not the original one', isRed(pixel(pd, rc.width, onEdge.x, onEdge.y)) && isWhite(pixel(pd, rc.width, oldEdge.x, oldEdge.y)),
    pixel(pd, rc.width, onEdge.x, onEdge.y).join() + ' / ' + pixel(pd, rc.width, oldEdge.x, oldEdge.y).join());
  closeMenu();
  MFC.setTool('select');
  return checks;
}

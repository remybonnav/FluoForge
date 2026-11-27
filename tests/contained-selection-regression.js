/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* PI-T4: selecting only what is fully inside. With mouse drags on the canvas over three panels (two
   entirely inside the rectangle, the third half inside): a plain drag selects all three; Ctrl+drag (or
   Cmd+drag) selects the two; Ctrl pressed only during the drag counts; the rectangle is dashed while
   Ctrl is held and plain again afterwards; other tools and a plain click are not affected. */
async function runContainedSelectionRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas();
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const client = (x, y) => {
    const el = canvas.upperCanvasEl, rect = el.getBoundingClientRect(), vpt = canvas.viewportTransform, k = rect.width / canvas.getWidth();
    return { clientX: rect.left + (x * vpt[0] + vpt[4]) * k, clientY: rect.top + (y * vpt[3] + vpt[5]) * k };
  };
  const mouse = (type, at, keys = {}, target = canvas.upperCanvasEl) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1, ...keys, ...at }));
  /** A drag from (x1, y1) to (x2, y2) in page pixels; `keys` at each step: [down, move, up]. Returns the look of the rectangle mid-drag. */
  async function drag(x1, y1, x2, y2, keys = [{}, {}, {}]) {
    mouse('mousedown', client(x1, y1), keys[0]);
    mouse('mousemove', client((x1 + x2) / 2, (y1 + y2) / 2), keys[1], document);
    mouse('mousemove', client(x2, y2), keys[1], document);
    const look = { dash: canvas.selectionDashArray.slice(), contained: canvas.selectionFullyContained, border: canvas.selectionBorderColor };
    mouse('mouseup', client(x2, y2), keys[2], document);
    await frame();
    return look;
  }
  const selected = () => { const a = canvas.getActiveObject(); return !a ? [] : a.type === 'activeSelection' ? a.getObjects() : [a]; };
  const names = () => selected().map(o => o.mfcName).sort().join(',');
  const CTRL = { ctrlKey: true }, CMD = { metaKey: true };

  await MFC_PROJECT.createProject({ name: 'Contained', width: 1200, height: 800, unit: 'px', dpi: 300 });
  MFC.setTool('select');
  await frame();
  // Three panels in a row: A and B well inside the rectangle 50..700 × 50..400, C half inside (600..800).
  const panel = (name, left) => { const r = new fabric.Rect({ left, top: 150, width: 200, height: 150, fill: '#4c72b0' }); r.mfcName = name; r.mfcId = 'r' + name; r.mfcType = 'shape'; r.mfcShapeKind = 'rect'; canvas.add(r); return r; };
  const A = panel('A', 100), B = panel('B', 350), C = panel('C', 600);
  canvas.discardActiveObject(); canvas.requestRenderAll(); MFC.pushHistory();
  await frame();
  assert('Three panels on the page, C half inside the drag rectangle', canvas.getObjects().includes(A) && C.left + C.width > 700 && C.left < 700);

  const plain = await drag(50, 50, 700, 400);
  assert('A plain drag selects every panel it touches: all three', names() === 'A,B,C', names());
  assert('…its rectangle has the plain look (not dashed)', plain.dash.length === 0 && !plain.contained, JSON.stringify(plain));
  canvas.discardActiveObject(); await frame();

  const ctrl = await drag(50, 50, 700, 400, [CTRL, CTRL, CTRL]);
  assert('Ctrl+drag selects only the panels entirely inside: A and B, not the half-covered C', names() === 'A,B', names());
  assert('…and its rectangle is dashed, in the accent colour, while Ctrl is held', ctrl.contained && ctrl.dash.length === 2 && ctrl.border === '#5b8cff', JSON.stringify(ctrl));
  assert('After the drag, the next rectangle has the plain look again', !canvas.selectionFullyContained && canvas.selectionDashArray.length === 0);
  canvas.discardActiveObject(); await frame();

  await drag(50, 50, 700, 400, [CMD, CMD, CMD]);
  assert('Cmd+drag (a Mac) does the same', names() === 'A,B', names());
  canvas.discardActiveObject(); await frame();

  const late = await drag(50, 50, 700, 400, [{}, CTRL, CTRL]);
  assert('Pressing Ctrl only during the drag counts too', names() === 'A,B' && late.contained, names());
  canvas.discardActiveObject(); await frame();

  await drag(50, 50, 700, 400, [CTRL, CTRL, {}]);
  assert('Releasing Ctrl before letting go of the mouse makes it a plain drag again', names() === 'A,B,C', names());
  canvas.discardActiveObject(); await frame();

  await drag(50, 50, 380, 400, [CTRL, CTRL, CTRL]);
  assert('Ctrl+drag over A and half of B selects A alone', names() === 'A', names());
  canvas.discardActiveObject(); await frame();

  MFC.setTool('legend'); await frame();
  await drag(50, 50, 700, 400, [CTRL, CTRL, CTRL]);
  assert('In another tool that selects by dragging (Legend), Ctrl changes nothing', names() === 'A,B,C' && !canvas.selectionFullyContained, names());
  MFC.setTool('select'); canvas.discardActiveObject(); await frame();
  return checks;
}

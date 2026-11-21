/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Arrowheads of pen paths when the path is resized.
   Pen paths keep their line width on the page when resized (strokeUniform). Their arrowheads were
   drawn in the path's own units, so they shrank or grew with it: a smaller path got an arrowhead
   thinner than its line, which then seemed to grow out of the tip. Now:
   - the arrowhead is max(10, 4 × line width) long and 0.45 × that wide on the page at any size,
     with uneven stretching and inside a scaled group; its tip stays on the end node;
   - paths whose line scales with them keep arrowheads that scale too (unchanged);
   - with round or square caps the line ends half a line width before the tip, so nothing sticks out;
   - the canvas, the SVG export (vector polygons) and resizing with the W field agree. */

async function runArrowheadRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const P = await import(new URL('js/tools/path.js', document.baseURI).href);
  MFC.applyDocProps({ name: 'Arrowheads', width: 900, height: 600, unit: 'px', dpi: 300 });
  const canvas = MFC.getCanvas();
  canvas.getObjects().filter(o => o.mfcId).forEach(o => canvas.remove(o));
  MFC.setZoom(1); MFC.setTool('select');
  document.getElementById('path-arrow-start').value = 'arrow'; document.getElementById('path-arrow-end').value = 'arrow';
  const make = ({ width = 6, cap = 'butt', uniform = true, scaleX = 1, scaleY = scaleX, nodes } = {}) => {
    const path = P.makeEditablePath(nodes || [{ x: 0, y: 0, type: 'corner' }, { x: 200, y: 0, type: 'corner' }],
      { ...P.pathStyleFromPanel(), stroke: '#ff0000', strokeWidth: width, strokeLineCap: cap, strokeUniform: uniform, strokeDashArray: null, opacity: 1 });
    path.set({ left: 150, top: 150, scaleX, scaleY }); path.setCoords(); canvas.add(path); return path;
  };
  const toPage = (path, q) => fabric.util.transformPoint(new fabric.Point(q.x - path.pathOffset.x, q.y - path.pathOffset.y), path.calcTransformMatrix());
  const measure = (path, atStart = false) => {
    const [tip, a, b] = P.pathArrowGeometry(path, atStart).map(q => toPage(path, q));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return { length: Math.hypot(tip.x - mid.x, tip.y - mid.y), half: Math.hypot(a.x - b.x, a.y - b.y) / 2, tip, a, b, mid };
  };
  const near = (x, y, eps = 0.01) => Math.abs(x - y) <= eps;
  const clear = () => canvas.getObjects().filter(o => o.mfcId).forEach(o => canvas.remove(o));

  // ---- Geometry ----
  for (const scale of [0.25, 0.4, 1, 3]) {
    clear(); const path = make({ scaleX: scale }), m = measure(path), end = toPage(path, path.mfcPathNodes[1]);
    assert(`Scaled ${scale}×: the arrowhead is 24 × 10.8 page px (line 6 px) and its tip is on the end node`, near(m.length, 24) && near(m.half, 10.8) && near(m.tip.x, end.x) && near(m.tip.y, end.y),
      `${m.length.toFixed(2)} × ${m.half.toFixed(2)}`);
  }
  clear(); let path = make({ width: 1, scaleX: 0.3 });
  assert('A thin line keeps the 10 px minimum arrowhead at any size', near(measure(path).length, 10) && near(measure(path).half, 4.5));
  clear(); path = make({ scaleX: 2, scaleY: 0.5, nodes: [{ x: 0, y: 0, type: 'corner' }, { x: 100, y: 100, type: 'corner' }] });
  let m = measure(path);
  const axis = { x: m.tip.x - toPage(path, path.mfcPathNodes[0]).x, y: m.tip.y - toPage(path, path.mfcPathNodes[0]).y }, len = Math.hypot(axis.x, axis.y);
  const along = ((m.tip.x - m.mid.x) * axis.x + (m.tip.y - m.mid.y) * axis.y) / len;
  const across = Math.abs((m.a.x - m.b.x) * axis.x + (m.a.y - m.b.y) * axis.y) / len;
  assert('Stretched unevenly (2 × 0.5) along a diagonal: the arrowhead keeps its size and points along the line on the page', near(m.length, 24) && near(m.half, 10.8) && near(along, 24) && near(across, 0, 0.02),
    `${m.length.toFixed(2)} ${m.half.toFixed(2)} along ${along.toFixed(2)} across ${across.toFixed(3)}`);
  clear(); path = make(); const other = new fabric.Rect({ left: 600, top: 400, width: 20, height: 20, fill: '#00f' }); other.mfcId = 'arrow-other'; canvas.add(other);
  const group = new fabric.Group([path, other]); canvas.remove(path); canvas.remove(other); group.mfcId = 'arrow-group'; canvas.add(group);
  group.set({ scaleX: 0.5, scaleY: 0.5 }); group.setCoords();
  m = measure(path);
  assert('Inside a group scaled 0.5×, the arrowhead is still 24 × 10.8 page px', near(m.length, 24) && near(m.half, 10.8), `${m.length.toFixed(2)} × ${m.half.toFixed(2)}`);
  canvas.remove(group);
  clear(); path = make({ uniform: false, scaleX: 0.5 });
  assert('A path whose line scales with it keeps an arrowhead that scales too (12 × 5.4 at 0.5×)', near(measure(path).length, 12) && near(measure(path).half, 5.4));
  clear(); path = make();
  assert('At 1× the arrowhead is unchanged: 24 × 10.8 in path units, as before', JSON.stringify(P.pathArrowGeometry(path, false).map(q => [+q.x.toFixed(3), +q.y.toFixed(3)])) === JSON.stringify([[200, 0], [176, 10.8], [176, -10.8]]));
  assert('Butt caps: the line commands are not changed', P.pathStrokeCommands(path) === null);
  clear(); path = make({ cap: 'round', scaleX: 0.5 });
  const trimmed = P.pathStrokeCommands(path);
  assert('Round caps: both arrow ends are pulled back by half the line width on the page (3 px = 6 path units at 0.5×)', trimmed && near(trimmed[0][1], 6) && near(trimmed.at(-1)[1], 194) && path.path[0][1] === 0 && path.path.at(-1)[1] === 200,
    JSON.stringify(trimmed));
  path.mfcArrowStart = 'none';
  assert('Only ends with an arrowhead are pulled back', near(P.pathStrokeCommands(path)[0][1], 0) && near(P.pathStrokeCommands(path).at(-1)[1], 194));
  clear(); path = make({ cap: 'square', nodes: [{ x: 0, y: 0, type: 'corner', handleOut: { x: 60, y: -80 } }, { x: 200, y: 0, type: 'corner', handleIn: { x: 140, y: 80 } }] });
  const curve = P.pathStrokeCommands(path), last = curve.at(-1), dir = { x: 200 - 140, y: 0 - 80 }, dl = Math.hypot(dir.x, dir.y);
  assert('On a curve, the end and its handle move together along the tangent', last[0] === 'C' && near(last[5], 200 - 3 * dir.x / dl) && near(last[6], -3 * dir.y / dl) && near(last[3] - 140, last[5] - 200) && near(curve[1][1] - 60, curve[0][1] - 0));

  // ---- Pixels ----
  const ctx = canvas.getContext();
  const red = (x, y) => { const v = canvas.viewportTransform, d = ctx.getImageData(Math.round(x * v[0] + v[4]), Math.round(y * v[3] + v[5]), 1, 1).data; return d[0] > 150 && d[1] < 100 && d[2] < 100; };
  for (const [scale, cap] of [[0.4, 'butt'], [3, 'butt'], [1, 'round'], [0.4, 'square']]) {
    clear(); path = make({ scaleX: scale, cap }); canvas.discardActiveObject(); canvas.renderAll();
    const tip = toPage(path, path.mfcPathNodes[1]);
    let beyond = false; for (let d = 1; d <= 8; d += 0.5) if (red(tip.x + d, tip.y)) beyond = true;
    const headAt12 = [...Array(21).keys()].map(k => k - 10).filter(w => red(tip.x - 12, tip.y + w)).length; // about 2 × 5.4 px of red 12 px behind the tip
    const midX = (tip.x + toPage(path, path.mfcPathNodes[0]).x) / 2;
    const lineAt60 = [...Array(21).keys()].map(k => k - 10).filter(w => red(midX, tip.y + w)).length;  // the line itself, 6 px, at its middle
    assert(`Rendered at ${scale}× with ${cap} caps: nothing red past the tip, and the head is wider than the line (${headAt12} px against ${lineAt60} px)`,
      !beyond && headAt12 >= 9 && headAt12 <= 13 && lineAt60 >= 5 && lineAt60 <= 7, `${beyond} ${headAt12} ${lineAt60}`);
  }

  // ---- Resizing with the W field, and the SVG export ----
  clear(); path = make(); canvas.setActiveObject(path); MFC.refreshSelectionBar();
  const lock = document.getElementById('obj-lock-aspect'), lockWas = lock.checked; lock.checked = true;
  document.getElementById('obj-width').value = String(Math.round(path.getBoundingRect(true, true).width / 2.5)); MFC.applyObjectSizeFromFields('width');
  lock.checked = lockWas;
  m = measure(path);
  assert('Resizing the path to 40 % with the W field keeps the arrowhead at 24 × 10.8 page px', path.scaleX < 0.5 && near(m.length, 24) && near(m.half, 10.8), `${path.scaleX} ${m.length}`);
  canvas.discardActiveObject();
  const svg = (await MFC_EXPORT.buildSVG()).svg, doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const polys = [...doc.querySelectorAll('polygon')].map(p => p.getAttribute('points').trim().split(/\s+/).map(s => s.split(',').map(Number)));
  const sizeOf = pts => { const [t, a, b] = pts, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; return [Math.hypot(t[0] - mid[0], t[1] - mid[1]), Math.hypot(a[0] - b[0], a[1] - b[1]) / 2]; };
  assert('The SVG export draws both arrowheads as polygons of 24 × 10.8 page px at that size', polys.length === 2 && polys.every(p => near(sizeOf(p)[0], 24, 0.02) && near(sizeOf(p)[1], 10.8, 0.02)),
    JSON.stringify(polys.map(sizeOf)));
  clear(); path = make({ cap: 'round', scaleX: 0.5 });
  const svg2 = (await MFC_EXPORT.buildSVG()).svg, d = new DOMParser().parseFromString(svg2, 'image/svg+xml').querySelector('path').getAttribute('d');
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number), endX = toPage(path, path.mfcPathNodes[1]).x, startX = toPage(path, path.mfcPathNodes[0]).x;
  assert('In the SVG export, a round-capped line ends half a line width before each tip', near(nums[0], startX + 3, 0.02) && near(nums.at(-2), endX - 3, 0.02), d);
  clear();
  return checks;
}

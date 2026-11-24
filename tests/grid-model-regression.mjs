// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* P3-T2: the layout grid's pure model (js/layout/grid-model.js), in Node: sizes in mm, cells and labels,
   placing, swapping and dropping panels, inserting and deleting rows and columns (spans grow and
   shrink, panels in a deleted row leave), spans, fit and fill (fill keeps the crop centre), resizing to
   a width with gutters kept, and inputs never changed. Run alone: node tests/grid-model-regression.mjs */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runGridModelRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const throwsMessage = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
  const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
  const deepFrozen = o => { Object.freeze(o); Object.values(o).forEach(v => { if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFrozen(v); }); return o; };
  const G = await import(pathToFileURL(join(ROOT, 'js/layout/grid-model.js')).href);

  // ---- geometry ----
  let g = deepFrozen(G.makeGrid({ rows: 2, cols: 3, cellW: 40, cellH: 30, gutter: 2, margin: 1, colBand: 5, rowBand: 10 }));
  const size = G.gridSize(g);
  assert('Size: 2 × 1 margin + 10 row band + 3 × 40 + 2 gutters of 2; 2 × 1 + 5 + 2 × 30 + 2', size.width === 136 && size.height === 69, JSON.stringify(size));
  const b = G.cellBox(g, 1, 2);
  assert('Cell (1, 2) starts after the margin, the band, two cells and two gutters', b.left === 1 + 10 + 2 * 42 && b.top === 1 + 5 + 32 && b.width === 40 && b.height === 30, JSON.stringify(b));
  assert('A cell spanning 2 × 2 includes the gutter between', G.cellBox(g, 0, 0, 2, 2).width === 82 && G.cellBox(g, 0, 0, 2, 2).height === 62);
  assert('Labels: column labels in the top band over their column, row labels in the left band beside their row',
    JSON.stringify(G.colLabelBox(g, 1)) === JSON.stringify({ left: 53, top: 1, width: 40, height: 5 }) && JSON.stringify(G.rowLabelBox(g, 1)) === JSON.stringify({ left: 1, top: 38, width: 10, height: 30 }));
  assert('cellAt finds cells and not gutters or bands', JSON.stringify(G.cellAt(g, 60, 40)) === '{"row":1,"col":1}' && G.cellAt(g, 52, 20) === null && G.cellAt(g, 5, 20) === null);
  assert('nearestCell takes gutters to the nearest cell and is null outside the cells', JSON.stringify(G.nearestCell(g, 52.5, 20)) === '{"row":0,"col":1}' && G.nearestCell(g, 2, 20) === null && G.nearestCell(g, 200, 20) === null);
  assert('mm and px at 300 dpi', near(G.mmToPx(25.4, 300), 300) && near(G.pxToMm(300, 300), 25.4));
  assert('Bad sizes are refused', /at least one row/.test(throwsMessage(() => G.makeGrid({ rows: 0, cols: 1, cellW: 1, cellH: 1 }))) && /positive size/.test(throwsMessage(() => G.makeGrid({ rows: 1, cols: 1, cellW: 0, cellH: 1 }))));

  // ---- placing, swapping, dropping ----
  g = deepFrozen(['a', 'b', 'c', 'd'].reduce((grid, p, i) => G.place(grid, p, Math.floor(i / 3), i % 3), g));
  assert('Panels go into cells in reading order', ['a', 'b', 'c', 'd'].map(p => { const a = G.areaOf(g, p); return a.row + ':' + a.col; }).join() === '0:0,0:1,0:2,1:0');
  assert('A taken cell is refused', /already holds/.test(throwsMessage(() => G.place(g, 'e', 0, 0))));
  let s = G.dropOn(g, 'a', 1, 0);
  assert('Dropping a panel on another one swaps them', G.areaOf(s, 'a').row === 1 && G.areaOf(s, 'a').col === 0 && G.areaOf(s, 'd').row === 0 && G.areaOf(s, 'd').col === 0 && s.areas.length === 4);
  s = G.dropOn(g, 'b', 1, 2);
  assert('Dropping on an empty cell moves the panel there', G.areaOf(s, 'b').row === 1 && G.areaOf(s, 'b').col === 2 && G.areaAt(s, 0, 1) === null);
  assert('Release takes a panel out', G.areaOf(G.release(g, 'c'), 'c') === null && G.release(g, 'c').areas.length === 3);

  // ---- spans ----
  let sp = G.span(g, 1, 0, 'right');
  assert('Span right takes the empty cell on the right', G.areaOf(sp, 'd').colSpan === 2 && G.areaAt(sp, 1, 1) === G.areaOf(sp, 'd'));
  assert('Spanning onto a panel or past the edge is refused', /not empty/.test(throwsMessage(() => G.span(g, 0, 0, 'right'))) && /beyond the edge/.test(throwsMessage(() => G.span(g, 1, 0, 'down'))));
  sp = G.unspan(sp, 1, 1);
  assert('Unspan gives a single cell back', G.areaOf(sp, 'd').colSpan === 1);
  const empty = G.span(g, 1, 1, 'right');
  assert('An empty cell can span too, and unspanning it removes the area', G.areaAt(empty, 1, 2).panel === null && G.areaAt(G.unspan(empty, 1, 1), 1, 1) === null);
  s = G.dropOn(empty, 'a', 1, 2);
  assert('Dropping a panel on an empty spanned area fills the area', G.areaOf(s, 'a').colSpan === 2 && G.areaOf(s, 'a').col === 1);

  // ---- insert and delete ----
  const wide = G.span(g, 1, 0, 'right');
  let ins = G.insertRow(wide, 1);
  assert('Insert row 1: the second row moves down, the grid has 3 rows', ins.rows === 3 && G.areaOf(ins, 'd').row === 2 && G.areaOf(ins, 'a').row === 0);
  ins = G.insertCol(wide, 1);
  assert('Insert a column inside a span: the span grows; cells to the right move', ins.cols === 4 && G.areaOf(ins, 'd').colSpan === 3 && G.areaOf(ins, 'b').col === 2 && G.areaOf(ins, 'a').col === 0);
  let del = G.deleteRow(g, 0);
  assert('Delete row 0: its panels leave the grid, the next row moves up', del.grid.rows === 1 && del.released.join() === 'a,b,c' && G.areaOf(del.grid, 'd').row === 0);
  del = G.deleteCol(wide, 0);
  assert('Delete a column under a span: the span shrinks and stays; the panel in that column only leaves', del.grid.cols === 2 && G.areaOf(del.grid, 'd').colSpan === 1 &&
    G.areaOf(del.grid, 'd').col === 0 && del.released.join() === 'a' && G.areaOf(del.grid, 'b').col === 0);
  assert('The last row or column cannot be deleted', /at least one row/.test(throwsMessage(() => G.deleteRow(G.makeGrid({ rows: 1, cols: 2, cellW: 1, cellH: 1 }), 0))) &&
    /at least one column/.test(throwsMessage(() => G.deleteCol(G.makeGrid({ rows: 2, cols: 1, cellW: 1, cellH: 1 }), 0))));

  // ---- fit, fill, width ----
  const box = { left: 10, top: 20, width: 40, height: 30 };
  let p = G.placeImage(box, { width: 200, height: 100 }, 'fit');
  assert('Fit: as large as fits, centred (200 × 100 in 40 × 30: scale 0.2, 5 from the top)', near(p.scale, 0.2) && near(p.left, 10) && near(p.top, 25) && p.crop === null);
  const crop = { cropX: 100, cropY: 50, width: 200, height: 100 };
  p = G.placeImage(box, { width: 200, height: 100 }, 'fill', crop);
  assert('Fill: the crop is cut to the box\'s shape (4:3) around its centre, and covers the box',
    near(p.crop.width, 133.333333333, 1e-6) && near(p.crop.height, 100) && near(p.crop.cropX + p.crop.width / 2, 200) && near(p.crop.cropY + p.crop.height / 2, 100) && near(p.crop.width * p.scale, 40) && near(p.crop.height * p.scale, 30));
  p = G.placeImage({ left: 0, top: 0, width: 10, height: 40 }, { width: 200, height: 100 }, 'fill', crop);
  assert('Fill in a tall box keeps the centre too', near(p.crop.height, 100) && near(p.crop.width, 25) && near(p.crop.cropX + 12.5, 200));
  const r = G.resizeToWidth(g, 85);
  assert('Resizing to 85 mm (one journal column) rescales the cells; gutters, margins and bands stay', near(G.gridSize(r).width, 85) && r.gutter === 2 && r.margin === 1 && r.rowBand === 10 && r.colBand === 5 &&
    near(r.cellH / r.cellW, 30 / 40), JSON.stringify(r));
  assert('Too narrow for the gutters is refused with the minimum', /cannot be narrower than/.test(throwsMessage(() => G.resizeToWidth(g, 10))));
  const spaced = G.setSpacing(g, { gutter: 3, rowBand: 0, margin: -2 });
  assert('Spacing: gutter and band set, negative values become 0', spaced.gutter === 3 && spaced.rowBand === 0 && spaced.margin === 0 && spaced.colBand === 5);
  assert('Fit or fill per area', G.areaOf(G.setMode(g, 0, 1, 'fill'), 'b').mode === 'fill' && G.areaOf(G.setMode(g, 0, 1, 'x'), 'b').mode === 'fit');
  assert('autoShape: up to 4 columns', JSON.stringify(G.autoShape(5)) === '{"rows":2,"cols":4}' && JSON.stringify(G.autoShape(2)) === '{"rows":1,"cols":2}');
  assert('No function changed its (frozen) input', g.areas.length === 4 && g.rows === 2);
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const checks = await runGridModelRegressions(); console.log(`PASS grid-model-regression: ${checks.length} checks`); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Layout grid (P3-T2), the pure part: geometry and editing of a grid description, with no Fabric and
   no page. A grid is plain JSON, saved as the `mfcGrid` field of the grid object (js/layout/grid.js):

     { rows, cols, cellW, cellH, gutter, margin, colBand, rowBand, areas: [...] }

   Lengths are in mm. Column cells are cellW wide and row cells cellH high, separated by `gutter`; the
   whole grid has `margin` on every side, a band `colBand` high above the cells for the column labels
   and a band `rowBand` wide on their left for the row labels (0: no band). An area is
   { row, col, rowSpan, colSpan, panel, mode, base, last }: the cells it covers, the panel (an image id,
   or null), 'fit' or 'fill', and for fill the crop it starts from (`base`) and the crop it last gave
   (`last`), both { cropX, cropY, width, height } in the image's preview pixels. Cells no area covers
   are empty. Every function returns a new grid and leaves its input unchanged. */

export const DEFAULTS = { gutter: 2, margin: 0, colBand: 0, rowBand: 0 };
const copy = value => JSON.parse(JSON.stringify(value));
export const mmToPx = (mm, dpi) => (mm / 25.4) * dpi;
export const pxToMm = (px, dpi) => (px / dpi) * 25.4;
const covers = (a, row, col) => row >= a.row && row < a.row + a.rowSpan && col >= a.col && col < a.col + a.colSpan;

/** A new grid of rows × cols empty cells. */
export function makeGrid({ rows, cols, cellW, cellH, gutter = DEFAULTS.gutter, margin = DEFAULTS.margin, colBand = DEFAULTS.colBand, rowBand = DEFAULTS.rowBand }) {
  if (!(rows >= 1 && cols >= 1)) throw new Error('A grid needs at least one row and one column.');
  if (!(cellW > 0 && cellH > 0)) throw new Error('Grid cells need a positive size.');
  return { rows: Math.floor(rows), cols: Math.floor(cols), cellW, cellH, gutter: Math.max(0, gutter), margin: Math.max(0, margin),
    colBand: Math.max(0, colBand), rowBand: Math.max(0, rowBand), areas: [] };
}

/** The grid's size in mm. */
export function gridSize(g) {
  return { width: 2 * g.margin + g.rowBand + g.cols * g.cellW + (g.cols - 1) * g.gutter,
    height: 2 * g.margin + g.colBand + g.rows * g.cellH + (g.rows - 1) * g.gutter };
}

/** The box (mm, from the grid's top left) of the cells row..row+rowSpan-1, col..col+colSpan-1. */
export function cellBox(g, row, col, rowSpan = 1, colSpan = 1) {
  return { left: g.margin + g.rowBand + col * (g.cellW + g.gutter), top: g.margin + g.colBand + row * (g.cellH + g.gutter),
    width: colSpan * g.cellW + (colSpan - 1) * g.gutter, height: rowSpan * g.cellH + (rowSpan - 1) * g.gutter };
}
export const areaBox = (g, a) => cellBox(g, a.row, a.col, a.rowSpan, a.colSpan);
/** The label boxes: column label `col` above the cells, row label `row` on their left. */
export const colLabelBox = (g, col) => ({ left: cellBox(g, 0, col).left, top: g.margin, width: g.cellW, height: g.colBand });
export const rowLabelBox = (g, row) => ({ left: g.margin, top: cellBox(g, row, 0).top, width: g.rowBand, height: g.cellH });

/** The area covering a cell, or null. */
export const areaAt = (g, row, col) => g.areas.find(a => covers(a, row, col)) || null;
export const areaOf = (g, panel) => g.areas.find(a => a.panel === panel) || null;

/** The cell under a point (mm, from the grid's top left), or null (gutters, bands, outside). */
export function cellAt(g, x, y) {
  for (let row = 0; row < g.rows; row++) for (let col = 0; col < g.cols; col++) {
    const b = cellBox(g, row, col);
    if (x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height) return { row, col };
  }
  return null;
}
/** The cell nearest a point inside the grid's cell area (gutters included), or null outside it. */
export function nearestCell(g, x, y) {
  const first = cellBox(g, 0, 0), last = cellBox(g, g.rows - 1, g.cols - 1);
  if (x < first.left || y < first.top || x > last.left + last.width || y > last.top + last.height) return null;
  const pick = (v, start, size, count) => Math.min(count - 1, Math.max(0, Math.floor((v - start + g.gutter / 2) / (size + g.gutter))));
  return { row: pick(y, first.top, g.cellH, g.rows), col: pick(x, first.left, g.cellW, g.cols) };
}

/** Puts `panel` in the cell (an empty cell, or an empty area) with `mode`. */
export function place(g, panel, row, col, mode = 'fit') {
  const next = copy(g);
  next.areas = next.areas.filter(a => a.panel !== panel || (a.panel = null, a.rowSpan > 1 || a.colSpan > 1));
  const target = next.areas.find(a => covers(a, row, col));
  if (target) { if (target.panel) throw new Error('That cell already holds a panel.'); Object.assign(target, { panel, mode, base: null, last: null }); }
  else next.areas.push({ row, col, rowSpan: 1, colSpan: 1, panel, mode, base: null, last: null });
  return next;
}

/** Moves `panel` onto the cell: into it if it is empty, or swapping with the panel already there. */
export function dropOn(g, panel, row, col) {
  const from = areaOf(g, panel), to = areaAt(g, row, col);
  if (!from) throw new Error('That panel is not in this grid.');
  if (to === from) return copy(g);
  const next = copy(g), a = next.areas[g.areas.indexOf(from)];
  if (to) {
    const b = next.areas[g.areas.indexOf(to)];
    [a.panel, b.panel] = [b.panel, a.panel];
    [a.mode, b.mode] = [b.mode, a.mode];
    for (const area of [a, b]) { area.base = null; area.last = null; }
  } else {
    const mode = a.mode;
    if (a.rowSpan > 1 || a.colSpan > 1) Object.assign(a, { panel: null, base: null, last: null });
    else next.areas.splice(next.areas.indexOf(a), 1);
    next.areas.push({ row, col, rowSpan: 1, colSpan: 1, panel, mode, base: null, last: null });
  }
  return next;
}

/** Takes `panel` out of the grid (its area stays if it spans cells). */
export function release(g, panel) {
  const next = copy(g);
  next.areas = next.areas.filter(a => a.panel !== panel || (Object.assign(a, { panel: null, base: null, last: null }), a.rowSpan > 1 || a.colSpan > 1));
  return next;
}

/** Inserts a row before row `at` (0..rows): areas below move down, an area spanning across grows. */
export function insertRow(g, at) {
  const next = copy(g);
  next.rows += 1;
  for (const a of next.areas) {
    if (a.row >= at) a.row += 1;
    else if (a.row + a.rowSpan > at) a.rowSpan += 1;
  }
  return next;
}
export function insertCol(g, at) {
  const next = copy(g);
  next.cols += 1;
  for (const a of next.areas) {
    if (a.col >= at) a.col += 1;
    else if (a.col + a.colSpan > at) a.colSpan += 1;
  }
  return next;
}
/** Deletes row `at`: { grid, released } (the panels of areas only in that row leave the grid). */
export function deleteRow(g, at) {
  if (g.rows <= 1) throw new Error('A grid keeps at least one row.');
  const next = copy(g), released = [];
  next.rows -= 1;
  next.areas = next.areas.filter(a => {
    if (a.row === at && a.rowSpan === 1) { if (a.panel) released.push(a.panel); return false; }
    if (a.row <= at && a.row + a.rowSpan > at) a.rowSpan -= 1;
    else if (a.row > at) a.row -= 1;
    return true;
  });
  return { grid: next, released };
}
export function deleteCol(g, at) {
  if (g.cols <= 1) throw new Error('A grid keeps at least one column.');
  const next = copy(g), released = [];
  next.cols -= 1;
  next.areas = next.areas.filter(a => {
    if (a.col === at && a.colSpan === 1) { if (a.panel) released.push(a.panel); return false; }
    if (a.col <= at && a.col + a.colSpan > at) a.colSpan -= 1;
    else if (a.col > at) a.col -= 1;
    return true;
  });
  return { grid: next, released };
}

/** Makes the area at (row, col) one cell wider ('right') or taller ('down'); the cells it takes must be empty. */
export function span(g, row, col, direction) {
  const next = copy(g);
  let a = next.areas.find(x => covers(x, row, col));
  if (!a) { a = { row, col, rowSpan: 1, colSpan: 1, panel: null, mode: 'fit', base: null, last: null }; next.areas.push(a); }
  const cells = direction === 'right' ? Array.from({ length: a.rowSpan }, (_, i) => [a.row + i, a.col + a.colSpan])
    : Array.from({ length: a.colSpan }, (_, i) => [a.row + a.rowSpan, a.col + i]);
  if (cells.some(([r, c]) => r >= next.rows || c >= next.cols)) throw new Error('There is no cell beyond the edge of the grid.');
  if (cells.some(([r, c]) => next.areas.some(x => x !== a && covers(x, r, c)))) throw new Error('The cell next to it is not empty.');
  if (direction === 'right') a.colSpan += 1; else a.rowSpan += 1;
  a.last = null;
  return next;
}
/** Back to one cell; an empty area simply goes away. */
export function unspan(g, row, col) {
  const next = copy(g), a = next.areas.find(x => covers(x, row, col));
  if (!a) return next;
  if (!a.panel) next.areas.splice(next.areas.indexOf(a), 1);
  else Object.assign(a, { rowSpan: 1, colSpan: 1, last: null });
  return next;
}

/** Fit or fill for the area at (row, col). Leaving fill gives the crop back (see the image layout). */
export function setMode(g, row, col, mode) {
  const next = copy(g), a = next.areas.find(x => covers(x, row, col));
  if (a) a.mode = mode === 'fill' ? 'fill' : 'fit';
  return next;
}

/** Spacing and bands (any of gutter, margin, colBand, rowBand, in mm). */
export function setSpacing(g, values) {
  const next = copy(g);
  for (const key of ['gutter', 'margin', 'colBand', 'rowBand']) if (Number.isFinite(values[key])) next[key] = Math.max(0, values[key]);
  return next;
}

/** Rescales the cells so the grid is `width` mm wide; gutters, margins and bands stay the same. */
export function resizeToWidth(g, width) {
  const fixed = 2 * g.margin + g.rowBand + (g.cols - 1) * g.gutter;
  const cellW = (width - fixed) / g.cols;
  if (!(cellW > 0.5)) throw new Error(`The grid cannot be narrower than ${(fixed + 0.5 * g.cols).toFixed(1)} mm with these gutters and margins.`);
  return { ...copy(g), cellW, cellH: g.cellH * cellW / g.cellW };
}

/**
 * Where an image goes in its box (both in the same units). `frame` is { width, height } of what the image
 * shows. Fit: as large as fits, centred. Fill: covers the box; `crop` (the crop to start from) is cut to
 * the box's shape around its centre. Returns { scale, left, top, crop|null } (crop only for fill).
 */
export function placeImage(box, frame, mode, crop = null) {
  if (mode === 'fill' && crop) {
    const ratio = box.width / box.height;
    let width = crop.width, height = crop.height;
    if (width / height > ratio) width = height * ratio; else height = width / ratio;
    const next = { cropX: crop.cropX + (crop.width - width) / 2, cropY: crop.cropY + (crop.height - height) / 2, width, height };
    return { scale: box.width / width, left: box.left, top: box.top, crop: next };
  }
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  return { scale, left: box.left + (box.width - frame.width * scale) / 2, top: box.top + (box.height - frame.height * scale) / 2, crop: null };
}

/** Rows and columns for n panels when none are given: up to 4 columns. */
export function autoShape(n) {
  const cols = Math.max(1, Math.min(4, n));
  return { rows: Math.max(1, Math.ceil(n / cols)), cols };
}

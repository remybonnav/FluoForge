/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Layout grid (P3-T2): a persistent grid object on the page. It is an invisible rectangle (mfcType
   "layoutGrid") under its panels, whose `mfcGrid` field holds the grid's description in mm (see
   js/layout/grid-model.js). Its panels are ordinary images placed in its cells (fit or fill); its row and
   column labels are text boxes it owns (`mfcGridId`, `mfcGridLabel` 'col' or 'row', `mfcGridIndex`). The
   editor draws the cells as dashed guides; exports leave the grid object out, so only the panels and
   labels are exported.
   Dragging a panel onto another cell swaps them (an empty cell: the panel moves there; outside the grid:
   it leaves the grid); dragging a free image onto an empty cell adds it. Moving the grid moves its panels
   and labels; resizing it to a width rescales the cells and keeps gutters and margins. Deleting the grid
   deletes its labels and leaves the panels where they are.
   A grid's panels and labels cover most of it, so each grid has a handle: a small "Grid" tab above its
   top-left corner, the same size on screen at any zoom (editor only). Clicking the tab selects the grid
   itself, dragging it moves the grid. */

import { history, pushHistory } from '../core/history.js';
import { getPreference } from '../core/preferences.js';
import { canvas, currentTool, docProps, documentOpen, registry, takeId } from '../core/state.js';
import { pageBounds, pageIndexForBox } from '../core/pages.js';
import * as G from './grid-model.js';
import { syncAttachments } from '../tools/inset.js';
import { attachTextListeners } from '../tools/text.js';
import { refreshLayersPanel } from '../ui/layers.js';
import { applyLockState, isTransformLocked } from '../ui/locks.js';

export const isGrid = o => !!(o && o.mfcType === 'layoutGrid' && o.mfcGrid);
const isImage = o => !!(o && o.mfcType === 'mfcImage' && registry[o.mfcId]);
const px = mm => G.mmToPx(mm, docProps.dpi);
const mm = v => G.pxToMm(v, docProps.dpi);
export const grids = () => canvas.getObjects().filter(isGrid);
const byId = id => canvas.getObjects().find(o => o.mfcId === id) || null;
/** The grid holding an image as a panel, or null. */
export const gridOfPanel = img => (img && img.mfcGridId ? grids().find(g => g.mfcId === img.mfcGridId && G.areaOf(g.mfcGrid, img.mfcId)) || null : null);
/** The grid of a selected object: the grid itself, one of its panels or one of its labels. */
export function gridOf(o) {
  if (!o) return null;
  if (isGrid(o)) return o;
  if (o.mfcGridLabel) return grids().find(g => g.mfcId === o.mfcGridId) || null;
  return gridOfPanel(o);
}
export const labelsOf = grid => canvas.getObjects().filter(o => o.type === 'textbox' && o.mfcGridId === grid.mfcId && o.mfcGridLabel);
const topLeft = o => o.getPointByOrigin('left', 'top');
const sameCrop = (a, b) => !!(a && b) && ['cropX', 'cropY', 'width', 'height'].every(k => Math.abs(a[k] - b[k]) < 1e-6);

// ---- drawing: the cells as dashed guides, in the editor only ----
function drawGuides(ctx) {
  const g = this.mfcGrid, size = G.gridSize(g), k = this.width / size.width;
  const zoom = (canvas && canvas.viewportTransform[0]) || 1, scale = Math.abs(this.scaleX || 1);
  ctx.save();
  ctx.translate(-this.width / 2, -this.height / 2);
  ctx.lineWidth = 1 / (zoom * scale);
  ctx.setLineDash([4 / (zoom * scale), 3 / (zoom * scale)]);
  ctx.strokeStyle = 'rgba(91,140,255,0.75)';
  const rect = b => ctx.strokeRect(b.left * k, b.top * k, b.width * k, b.height * k);
  for (let row = 0; row < g.rows; row++) for (let col = 0; col < g.cols; col++) if (!G.areaAt(g, row, col)) rect(G.cellBox(g, row, col));
  g.areas.forEach(a => rect(G.areaBox(g, a)));
  ctx.strokeStyle = 'rgba(91,140,255,0.4)';
  if (g.colBand > 0) for (let col = 0; col < g.cols; col++) rect(G.colLabelBox(g, col));
  if (g.rowBand > 0) for (let row = 0; row < g.rows; row++) rect(G.rowLabelBox(g, row));
  if (!this.group) drawHandle(ctx, 1 / (zoom * scale));
  ctx.restore();
}

// ---- the handle: a "Grid" tab above the top-left corner, in screen px ----
const HANDLE = { width: 50, height: 16, gap: 9 }; // the gap keeps it clear of the selected grid's corner control
/** The handle's box on the page (page px) at the current zoom. */
export function gridHandleBox(grid) {
  const zoom = (canvas && canvas.viewportTransform[0]) || 1, o = topLeft(grid);
  return { left: o.x, top: o.y - (HANDLE.height + HANDLE.gap) / zoom, width: HANDLE.width / zoom, height: HANDLE.height / zoom };
}
/** Draws the handle in the grid's own frame (origin at its top-left corner); `k`: local units per screen px. */
function drawHandle(ctx, k) {
  const w = HANDLE.width * k, h = HANDLE.height * k, top = -(HANDLE.height + HANDLE.gap) * k;
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(91,140,255,0.95)';
  ctx.fillRect(0, top, w, h);
  // A grip of three short bars, then the word "Grid".
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 3; i++) ctx.fillRect(5 * k, top + (4 + i * 3) * k, 7 * k, 1.5 * k);
  ctx.font = `bold ${11 * k}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('Grid', 16 * k, top + h / 2 + 0.5 * k);
}
/** The grid whose handle is under a page point (the topmost one), or null. */
export function gridAtHandle(point) {
  const list = grids().filter(g => !g.group && g.visible !== false && g.evented !== false && g.selectable !== false);
  for (let i = list.length - 1; i >= 0; i--) {
    const b = gridHandleBox(list[i]);
    if (point.x >= b.left && point.x <= b.left + b.width && point.y >= b.top && point.y <= b.top + b.height) return list[i];
  }
  return null;
}
/** Clicks on a handle (with the Select tool) find its grid, before the panels and labels; the selected
    object's own controls keep priority. Installed once on the canvas. */
function installHandleHitTest() {
  if (!canvas || canvas.__mfcGridHandles) return;
  canvas.__mfcGridHandles = true;
  const find = canvas.findTarget;
  canvas.findTarget = function (e, skipGroup) {
    if (!this.skipTargetFind && currentTool === 'select') {
      const active = this._activeObject;
      if (!(active && active._findTargetCorner(this.getPointer(e, true), fabric.util.isTouchEvent(e)))) {
        const grid = gridAtHandle(this.getPointer(e));
        if (grid) { this.targets = []; return grid; }
      }
    }
    return find.call(this, e, skipGroup);
  };
}
/** Gives a grid object its guides and handles (also after loading, undo and paste). */
export function installGridObject(o) {
  if (!isGrid(o) || o.__mfcGridInstalled) return;
  o.__mfcGridInstalled = true;
  installHandleHitTest();
  o._render = drawGuides;
  o.objectCaching = false;
  o.lockRotation = true;
  o.setControlsVisibility({ mt: false, mb: false, mtr: false });
}

// ---- labels ----
function makeLabel(grid, role, index) {
  const label = new fabric.Textbox(role === 'col' ? `Column ${index + 1}` : `Row ${index + 1}`, {
    fontFamily: getPreference('text.fontFamily'), fontSize: getPreference('text.fontSize'), fill: getPreference('text.color'),
    textAlign: role === 'col' || grid.mfcGrid.rowLabelTurn ? 'center' : 'right', originX: 'left', originY: 'top' });
  Object.assign(label, { mfcId: 'txt' + takeId(), mfcType: 'text', mfcVAlign: 'middle', mfcGridId: grid.mfcId, mfcGridLabel: role, mfcGridIndex: index });
  attachTextListeners(label);
  canvas.add(label);
  return label;
}
/** One label per column (and row) while its band is on; extra ones go. */
function syncLabels(grid) {
  const g = grid.mfcGrid, labels = labelsOf(grid);
  for (const [role, count, band] of [['col', g.cols, g.colBand], ['row', g.rows, g.rowBand]]) {
    const own = labels.filter(l => l.mfcGridLabel === role);
    own.filter(l => band <= 0 || l.mfcGridIndex >= count || own.find(x => x.mfcGridIndex === l.mfcGridIndex) !== l).forEach(l => canvas.remove(l));
    if (band > 0) for (let i = 0; i < count; i++) if (!own.some(l => l.mfcGridIndex === i && canvas.contains(l))) makeLabel(grid, role, i);
  }
}
/** After a row or column was inserted or deleted at `at`: labels after it change index; a deleted one goes. */
function shiftLabels(grid, role, at, delta) {
  for (const l of labelsOf(grid).filter(x => x.mfcGridLabel === role)) {
    if (delta < 0 && l.mfcGridIndex === at) canvas.remove(l);
    else if (l.mfcGridIndex >= at) l.mfcGridIndex += delta;
  }
}

// ---- layout ----
/** Places the grid's panels and labels from the grid's top-left corner. Returns the grid. */
export function relayout(grid) {
  if (!isGrid(grid) || grid.group) return grid;
  installGridObject(grid);
  const g = grid.mfcGrid, size = G.gridSize(g), origin = topLeft(grid);
  grid.set({ width: px(size.width), height: px(size.height), scaleX: 1, scaleY: 1, angle: 0, skewX: 0, skewY: 0, flipX: false, flipY: false });
  grid.setPositionByOrigin(origin, 'left', 'top');
  grid.setCoords();
  const at = b => ({ left: origin.x + px(b.left), top: origin.y + px(b.top), width: px(b.width), height: px(b.height) });
  let areas = null;
  g.areas.forEach((a, i) => {
    const img = a.panel && byId(a.panel);
    if (!isImage(img) || img.group) return;
    const box = at(G.areaBox(g, a));
    img.set({ angle: 0, skewX: 0, skewY: 0, flipX: false, flipY: false });
    const current = { cropX: img.cropX || 0, cropY: img.cropY || 0, width: img.width, height: img.height };
    let next = a;
    if (a.mode === 'fill') {
      // The crop to start from: kept while fill gave the current crop; a crop made since (crop tool) replaces it.
      const base = a.base && sameCrop(current, a.last) ? a.base : current;
      const p = G.placeImage(box, current, 'fill', base);
      img.set({ cropX: p.crop.cropX, cropY: p.crop.cropY, width: p.crop.width, height: p.crop.height, scaleX: p.scale, scaleY: p.scale });
      img.setPositionByOrigin(new fabric.Point(p.left, p.top), 'left', 'top');
      if (!sameCrop(base, a.base) || !sameCrop(p.crop, a.last)) next = { ...a, base, last: p.crop };
    } else {
      // Back from fill: the crop it started from comes back, unless the image was cropped since.
      if (a.base && sameCrop(current, a.last)) img.set({ cropX: a.base.cropX, cropY: a.base.cropY, width: a.base.width, height: a.base.height });
      if (a.base || a.last) next = { ...a, base: null, last: null };
      const p = G.placeImage(box, { width: img.width, height: img.height }, 'fit');
      img.set({ scaleX: p.scale, scaleY: p.scale });
      img.setPositionByOrigin(new fabric.Point(p.left, p.top), 'left', 'top');
    }
    img.mfcGridId = grid.mfcId;
    img.setCoords();
    syncAttachments(img);
    if (next !== a) { areas ||= g.areas.slice(); areas[i] = next; }
  });
  if (areas) grid.mfcGrid = { ...g, areas };
  syncLabels(grid);
  for (const l of labelsOf(grid)) {
    const b = at(l.mfcGridLabel === 'col' ? G.colLabelBox(g, l.mfcGridIndex) : G.rowLabelBox(g, l.mfcGridIndex));
    // A turned row label reads bottom to top: its own width runs along the row's height.
    const turned = l.mfcGridLabel === 'row' && g.rowLabelTurn;
    l.set({ width: Math.max(1, turned ? b.height : b.width), mfcBoxHeight: Math.max(1, turned ? b.width : b.height), scaleX: 1, scaleY: 1, angle: turned ? -90 : 0 });
    l.initDimensions();
    if (turned) l.setPositionByOrigin(new fabric.Point(b.left + b.width / 2, b.top + b.height / 2), 'center', 'center');
    else l.setPositionByOrigin(new fabric.Point(b.left, b.top), 'left', 'top'); // as before the turned labels
    l.setCoords();
  }
  canvas.requestRenderAll();
  return grid;
}
export const relayoutGrids = () => grids().forEach(relayout);

/** Changes a grid's description (a grid-model function's result) and lays it out again. One History step. */
export function updateGrid(grid, next, { history: step = true } = {}) {
  grid.mfcGrid = next;
  relayout(grid);
  if (step) pushHistory();
  return grid;
}

// ---- making a grid ----
/**
 * Makes a grid of `images` (in that order, reading order in the cells). Options (mm): rows, cols, cellW,
 * cellH (default: the first image's displayed size), width (rescales the cells to it), gutter, margin,
 * colBand, rowBand, mode ('fit' | 'fill'), left and top (page px; default: where the images start).
 * Locked images, and images in a group or in another grid, stay where they are. Returns the grid or null.
 */
export function createGrid(images, options = {}) {
  canvas.discardActiveObject();
  let list = images.filter(isImage);
  const skipped = list.filter(o => isTransformLocked(o) || (o.group && o.group.type !== 'activeSelection') || gridOfPanel(o));
  list = list.filter(o => !skipped.includes(o));
  if (skipped.length) MFC_UI.toast(skipped.length + ' locked, grouped or already gridded image(s) were left in place.');
  if (!list.length) { MFC_UI.toast('No unlocked images to arrange: import, select or unlock some first.'); return null; }
  const shape = G.autoShape(list.length), rows = options.rows || shape.rows, cols = options.cols || shape.cols;
  const first = list[0], ratio = first.getScaledHeight() / first.getScaledWidth();
  const cellW = options.cellW || mm(first.getScaledWidth());
  let g = G.makeGrid({ rows, cols, cellW, cellH: options.cellH || cellW * ratio, gutter: options.gutter ?? G.DEFAULTS.gutter,
    margin: options.margin ?? 0, colBand: options.colBand ?? 0, rowBand: options.rowBand ?? 0,
    labelGap: options.labelGap ?? G.DEFAULTS.labelGap, rowLabelTurn: options.rowLabelTurn ?? G.DEFAULTS.rowLabelTurn });
  if (options.width > 0) g = G.resizeToWidth(g, options.width);
  const used = list.slice(0, rows * cols);
  if (list.length > used.length) MFC_UI.toast(`${list.length - used.length} image(s) did not fit in ${rows} × ${cols} cells and were left in place.`);
  used.forEach((img, i) => { g = G.place(g, img.mfcId, Math.floor(i / cols), i % cols, options.mode === 'fill' ? 'fill' : 'fit'); });
  const boxes = used.map(o => o.getBoundingRect(true, true));
  // Where the images start, moved so the bands fit, but not past the top-left corner of their page.
  const page = pageBounds(Math.max(0, pageIndexForBox(boxes[0])));
  const left = options.left ?? Math.max(page.left, Math.min(...boxes.map(b => b.left)) - px(g.margin + g.rowBand));
  const top = options.top ?? Math.max(page.top, Math.min(...boxes.map(b => b.top)) - px(g.margin + g.colBand));
  const grid = new fabric.Rect({ left, top, width: 1, height: 1, fill: 'rgba(0,0,0,0)', strokeWidth: 0, originX: 'left', originY: 'top' });
  Object.assign(grid, { mfcId: 'grid' + takeId(), mfcType: 'layoutGrid', mfcGrid: g });
  installGridObject(grid);
  // Under its panels, so clicking a panel selects the panel.
  const objects = canvas.getObjects();
  canvas.insertAt(grid, Math.max(0, Math.min(...used.map(o => objects.indexOf(o)))));
  applyLockState(grid);
  relayout(grid);
  canvas.setActiveObject(grid);
  pushHistory();
  refreshLayersPanel();
  return grid;
}

/** The former one-shot Grid (kept in the API): cells, gap and header sizes in page px, placed from 40 px.
    It now makes a persistent grid with the same placement; headers are the grid's label bands. */
export function arrangeGrid({ rows, cols, cellW, cellH, gap, headerRow, headerCol }) {
  let images = canvas.getActiveObjects().filter(isImage);
  if (images.length < 2) images = canvas.getObjects().filter(isImage);
  return createGrid(images, { rows, cols, cellW: mm(cellW), cellH: mm(cellH), gutter: mm(gap || 0), margin: 0,
    colBand: headerRow ? mm(44) : 0, rowBand: headerCol ? mm(120) : 0, labelGap: false, rowLabelTurn: false, left: 40, top: 40 });
}

// ---- editing through the canvas ----
/** Where a page point falls in a grid's cells (null outside its cell area). */
function cellUnder(grid, point) {
  const o = topLeft(grid);
  return G.nearestCell(grid.mfcGrid, mm(point.x - o.x), mm(point.y - o.y));
}
const inside = (grid, point) => { const b = grid.getBoundingRect(true, true); return point.x >= b.left && point.x <= b.left + b.width && point.y >= b.top && point.y <= b.top + b.height; };

/**
 * After an object was moved, resized or edited (called by the canvas's object:modified, before its
 * History step). A grid: resized to its new width and laid out. A panel: dropped on a cell (swap or move),
 * outside the grid (leaves it) or back in place. A free image dropped on an empty cell joins the grid.
 */
export function onObjectModified(obj, action) {
  if (!obj || obj.group) return;
  if (isGrid(obj)) {
    const scale = Math.abs(obj.scaleX || 1);
    if (Math.abs(scale - 1) > 1e-6) {
      try { obj.mfcGrid = G.resizeToWidth(obj.mfcGrid, mm(obj.width * scale)); }
      catch (error) { MFC_UI.toast(error.message); }
    }
    relayout(obj);
    return;
  }
  if (obj.mfcGridLabel) { const grid = gridOf(obj); if (grid) relayout(grid); return; }
  if (!isImage(obj)) return;
  const grid = gridOfPanel(obj), center = obj.getCenterPoint();
  if (grid) {
    const cell = cellUnder(grid, center);
    if (cell) grid.mfcGrid = G.dropOn(grid.mfcGrid, obj.mfcId, cell.row, cell.col);
    else if (!inside(grid, center)) {
      grid.mfcGrid = G.release(grid.mfcGrid, obj.mfcId);
      delete obj.mfcGridId;
      MFC_UI.toast('The panel left the grid.');
    }
    relayout(grid);
    return;
  }
  if (action !== 'drag') return;
  for (const target of grids()) {
    const cell = cellUnder(target, center);
    if (cell && !G.areaAt(target.mfcGrid, cell.row, cell.col) && !isTransformLocked(obj)) {
      target.mfcGrid = G.place(target.mfcGrid, obj.mfcId, cell.row, cell.col, 'fit');
      relayout(target);
      return;
    }
  }
}
/** While the grid is dragged, its panels and labels follow. */
export function onObjectMoving(obj) { if (isGrid(obj) && !obj.group) relayout(obj); }
/** Side handles resize a grid's width: the height follows the cells (no free stretching). */
export function onGridScaling(obj, transform) {
  if (!isGrid(obj)) return false;
  const corner = transform && transform.corner;
  const s = corner === 'ml' || corner === 'mr' ? obj.scaleX : Math.max(obj.scaleX, obj.scaleY);
  obj.scaleX = s; obj.scaleY = s;
  return true;
}
/** A grid deleted by the user takes its labels with it; its panels stay where they are. */
export function onObjectRemoved(obj) {
  if (!isGrid(obj) || history.restoring || !documentOpen) return;
  for (const l of labelsOf(obj)) canvas.remove(l);
  for (const a of obj.mfcGrid.areas) { const img = a.panel && byId(a.panel); if (img && img.mfcGridId === obj.mfcId) delete img.mfcGridId; }
}
/** Copying a grid copies its panels and labels too. */
export function withGridMembers(objects) {
  const out = [...objects];
  for (const grid of objects.filter(isGrid)) {
    for (const a of grid.mfcGrid.areas) { const img = a.panel && byId(a.panel); if (img && !out.includes(img)) out.push(img); }
    for (const l of labelsOf(grid)) if (!out.includes(l)) out.push(l);
  }
  return out;
}
/** After pasting: grids keep only panels pasted with them, and pasted objects keep only grids pasted with them. */
export function remapPastedGrids(items, idMap) {
  const pastedIds = new Set(idMap.values());
  for (const json of items) {
    if (json.mfcType === 'layoutGrid' && json.mfcGrid) {
      json.mfcGrid = { ...json.mfcGrid, areas: json.mfcGrid.areas.map(a => ({ ...a, panel: a.panel && idMap.has(a.panel) ? idMap.get(a.panel) : null }))
        .filter(a => a.panel || a.rowSpan > 1 || a.colSpan > 1) };
    }
    if (json.mfcGridId) {
      if (idMap.has(json.mfcGridId)) json.mfcGridId = idMap.get(json.mfcGridId);
      else if (!pastedIds.has(json.mfcGridId)) { delete json.mfcGridId; delete json.mfcGridLabel; delete json.mfcGridIndex; }
    }
  }
}

// ---- the editing commands of the Grid panel (each one History step) ----
const fail = error => { MFC_UI.toast(error.message); return false; };
/** The cell of the selected panel in its grid, or null (the grid itself selected). */
export function selectedCell(grid, obj) { const a = obj && !isGrid(obj) && !obj.mfcGridLabel ? G.areaOf(grid.mfcGrid, obj.mfcId) : null; return a ? { row: a.row, col: a.col } : null; }
export function insertLine(grid, kind, at) {
  const g = grid.mfcGrid;
  updateGrid(grid, kind === 'row' ? G.insertRow(g, at) : G.insertCol(g, at), { history: false });
  shiftLabels(grid, kind, at, 1);
  relayout(grid); pushHistory();
  return true;
}
export function deleteLine(grid, kind, at) {
  let result;
  try { result = kind === 'row' ? G.deleteRow(grid.mfcGrid, at) : G.deleteCol(grid.mfcGrid, at); } catch (error) { return fail(error); }
  for (const id of result.released) { const img = byId(id); if (img) delete img.mfcGridId; }
  grid.mfcGrid = result.grid;
  shiftLabels(grid, kind, at, -1);
  relayout(grid); pushHistory();
  if (result.released.length) MFC_UI.toast(`${result.released.length} panel(s) left the grid and stay where they are.`);
  return true;
}
export function spanCell(grid, cell, direction) {
  try { return !!updateGrid(grid, direction ? G.span(grid.mfcGrid, cell.row, cell.col, direction) : G.unspan(grid.mfcGrid, cell.row, cell.col)); } catch (error) { return fail(error); }
}
export const setCellMode = (grid, cell, mode) => !!updateGrid(grid, G.setMode(grid.mfcGrid, cell.row, cell.col, mode));
export const setGridSpacing = (grid, values) => !!updateGrid(grid, G.setSpacing(grid.mfcGrid, values));
/** Row labels turned 90° or not (their alignment follows: centred when turned, right-aligned when not),
    and the gutter between label bands and cells. */
export function setGridLabels(grid, values) {
  const before = grid.mfcGrid.rowLabelTurn;
  grid.mfcGrid = G.setLabels(grid.mfcGrid, values);
  if (grid.mfcGrid.rowLabelTurn !== before) labelsOf(grid).filter(l => l.mfcGridLabel === 'row').forEach(l => l.set('textAlign', grid.mfcGrid.rowLabelTurn ? 'center' : 'right'));
  relayout(grid); pushHistory();
  return true;
}
export function setGridWidth(grid, widthMm) {
  try { return !!updateGrid(grid, G.resizeToWidth(grid.mfcGrid, widthMm)); } catch (error) { return fail(error); }
}
/** Removes the grid and its labels; the panels stay where they are. One History step. */
export function removeGrid(grid) {
  canvas.discardActiveObject();
  canvas.remove(grid); // onObjectRemoved takes the labels and frees the panels
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
}

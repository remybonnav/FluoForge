/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The Grid panel (top bar ▸ Grid): make a layout grid from the selected images, select the grid of the
   selected panel or label, and edit the selected grid (spacing, label bands, width, rows and columns, spans, fit or fill of the selected panel). The
   grid itself is js/layout/grid.js; its model js/layout/grid-model.js. */

import { getPreference } from '../core/preferences.js';
import { canvas, docProps, registry } from '../core/state.js';
import { areaOf, gridSize, pxToMm } from './grid-model.js';
import { createGrid, deleteLine, gridOf, insertLine, removeGrid, selectedCell, setCellMode, setGridLabels, setGridSpacing, setGridWidth, spanCell } from './grid.js';

const $ = id => document.getElementById(id);
const panel = () => $('panel-grid');
let opened = false; // shown with the Grid button; also shown while a grid, its panel or its label is selected

/** The selected grid and the selected object (a panel, a label or the grid itself). */
function target() {
  const obj = canvas && canvas.getActiveObject();
  if (!obj || obj.type === 'activeSelection') return { grid: null, obj: null };
  return { grid: gridOf(obj), obj };
}
const fmt = v => String(Math.round(v * 100) / 100);

/** Shows the panel's part for making a grid, or for editing the selected one. */
export function refreshGridPanel() {
  const el = panel();
  if (!el) return;
  const { grid, obj } = target();
  el.classList.toggle('hidden', !(opened || grid));
  $('grid-create').classList.toggle('hidden', !!grid);
  $('grid-edit').classList.toggle('hidden', !grid);
  if (!grid) return;
  $('grid-select').classList.toggle('hidden', obj === grid);
  const g = grid.mfcGrid, cell = selectedCell(grid, obj), area = cell ? areaOf(g, obj.mfcId) : null;
  $('grid-info').textContent = `Grid of ${g.rows} × ${g.cols} cells, ${fmt(gridSize(g).width)} × ${fmt(gridSize(g).height)} mm.` +
    (cell ? ` Selected panel: row ${cell.row + 1}, column ${cell.col + 1}.` : ' Select one of its panels to change its cell.');
  $('grid-edit-gutter').value = fmt(g.gutter);
  $('grid-edit-margin').value = fmt(g.margin);
  $('grid-edit-colband').value = fmt(g.colBand);
  $('grid-edit-rowband').value = fmt(g.rowBand);
  $('grid-edit-rowturn').checked = !!g.rowLabelTurn;
  $('grid-edit-labelgap').checked = !!g.labelGap;
  if (document.activeElement !== $('grid-edit-width')) $('grid-edit-width').value = fmt(gridSize(g).width);
  $('grid-cell-mode').disabled = !area;
  $('grid-cell-mode').value = area ? area.mode : 'fit';
  for (const id of ['grid-span-right', 'grid-span-down', 'grid-unspan']) $(id).disabled = !cell;
  $('grid-unspan').disabled = !area || (area.rowSpan === 1 && area.colSpan === 1);
}

function selectedImages() {
  const active = canvas.getActiveObjects().filter(o => o.mfcType === 'mfcImage' && registry[o.mfcId]);
  const images = active.length >= 2 ? active : canvas.getObjects().filter(o => o.mfcType === 'mfcImage' && registry[o.mfcId]);
  // Reading order: top to bottom, then left to right (rows within half an image height).
  const boxes = new Map(images.map(o => [o, o.getBoundingRect(true, true)]));
  return images.sort((a, b) => { const A = boxes.get(a), B = boxes.get(b); return Math.abs(A.top - B.top) > Math.min(A.height, B.height) / 2 ? A.top - B.top : A.left - B.left; });
}

/** Reads the "make a grid" fields: the options for createGrid. */
export function readCreateOptions() {
  const num = id => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
  const font = pxToMm(getPreference('text.fontSize') * 1.6, docProps.dpi); // a band fitting one line of the default text, in mm
  const options = { rows: num('grid-rows') > 0 ? Math.floor(num('grid-rows')) : null, cols: num('grid-cols') > 0 ? Math.floor(num('grid-cols')) : null,
    width: num('grid-width') > 0 ? num('grid-width') : null, gutter: Math.max(0, num('grid-gutter') ?? 2), margin: Math.max(0, num('grid-margin') ?? 0),
    colBand: $('grid-header-row').checked ? font : 0, rowBand: $('grid-header-col').checked ? font : 0, mode: $('grid-mode').value };
  return options;
}

/** Connects the panel's controls (once, when the editor loads). */
export function installGridPanel() {
  if (!panel()) return;
  $('btn-grid').addEventListener('click', () => { opened = true; refreshGridPanel(); });
  // The grid itself, when one of its panels or labels is selected (also the keyboard path to it).
  $('grid-select').addEventListener('click', () => {
    const { grid } = target();
    if (!grid) return;
    canvas.setActiveObject(grid);
    canvas.requestRenderAll();
    refreshGridPanel();
    $('grid-edit-gutter').focus(); // the button hides itself: keep the focus in the panel
  });
  $('grid-cancel').addEventListener('click', () => { opened = false; panel().classList.add('hidden'); });
  $('grid-arrange').addEventListener('click', () => { if (createGrid(selectedImages(), readCreateOptions())) refreshGridPanel(); });
  const withGrid = fn => () => { const { grid, obj } = target(); if (grid) { fn(grid, obj); refreshGridPanel(); } };
  const spacing = (id, key) => $(id).addEventListener('change', withGrid(grid => { const v = parseFloat($(id).value); if (Number.isFinite(v)) setGridSpacing(grid, { [key]: v }); }));
  $('grid-edit-rowturn').addEventListener('change', withGrid(grid => setGridLabels(grid, { rowLabelTurn: $('grid-edit-rowturn').checked })));
  $('grid-edit-labelgap').addEventListener('change', withGrid(grid => setGridLabels(grid, { labelGap: $('grid-edit-labelgap').checked })));
  spacing('grid-edit-gutter', 'gutter'); spacing('grid-edit-margin', 'margin'); spacing('grid-edit-colband', 'colBand'); spacing('grid-edit-rowband', 'rowBand');
  $('grid-apply-width').addEventListener('click', withGrid(grid => { const v = parseFloat($('grid-edit-width').value); if (v > 0) setGridWidth(grid, v); }));
  $('grid-edit-width').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('grid-apply-width').click(); } });
  $('grid-cell-mode').addEventListener('change', withGrid((grid, obj) => { const cell = selectedCell(grid, obj); if (cell) setCellMode(grid, cell, $('grid-cell-mode').value); }));
  const line = (id, kind, where) => $(id).addEventListener('click', withGrid((grid, obj) => {
    const cell = selectedCell(grid, obj), g = grid.mfcGrid, count = kind === 'row' ? g.rows : g.cols, index = cell ? cell[kind] : null;
    if (where === 'delete') deleteLine(grid, kind, index ?? count - 1);
    else insertLine(grid, kind, index == null ? count : where === 'before' ? index : index + 1);
  }));
  line('grid-row-above', 'row', 'before'); line('grid-row-below', 'row', 'after'); line('grid-col-left', 'col', 'before'); line('grid-col-right', 'col', 'after');
  line('grid-row-delete', 'row', 'delete'); line('grid-col-delete', 'col', 'delete');
  const spanBtn = (id, direction) => $(id).addEventListener('click', withGrid((grid, obj) => { const cell = selectedCell(grid, obj); if (cell) spanCell(grid, cell, direction); }));
  spanBtn('grid-span-right', 'right'); spanBtn('grid-span-down', 'down'); spanBtn('grid-unspan', null);
  $('grid-remove').addEventListener('click', withGrid(grid => { removeGrid(grid); }));
}

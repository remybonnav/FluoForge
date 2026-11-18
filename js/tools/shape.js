/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Shape tool: rectangles, ellipses, lines and curves drawn by dragging, and the Shape panel. */

import { pushHistory } from '../core/history.js';
import { DASH_PRESETS, canvas, currentTool, takeId } from '../core/state.js';
import { installPathControls } from './path.js';
import { toHexColor } from './text.js';
import { setTool } from './tool-switch.js';
import { selectedObjects } from '../ui/selection-bar.js';

export let shapeAspectMode = 'rect'; // 'rect' | 'square' — used by the shape tool

// ---- shape tool (rectangle/square, drag-to-draw) ----
export let shapeDrag = null; // { rect, startX, startY }
export let shapeKind = 'rect';

export function readShapeFormValues() {
  const dashKey = document.getElementById('shape-dash').value;
  const fillEnabled = document.getElementById('shape-fill-enabled').checked;
  return {
    stroke: document.getElementById('shape-stroke-color').value,
    strokeWidth: parseFloat(document.getElementById('shape-stroke-width').value) || 0,
    strokeDashArray: DASH_PRESETS[dashKey] || null,
    fill: fillEnabled ? document.getElementById('shape-fill-color').value : 'transparent'
  };
}

export function setShapeKind(kind) {
  shapeKind = kind;
  document.querySelectorAll('[data-shape-kind]').forEach(b => b.classList.toggle('active', b.dataset.shapeKind === kind));
}

export function pathForDrag(kind, x1, y1, x2, y2) {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

// Kept as a compatibility entry point for projects created before v0.21.
// Legacy Polyline/Curve objects are converted to the unified editable node model.
export function installCurveControls(path) {
  installPathControls(path);
}

export function startShapeDrag(pointer, evt) {
  const style = readShapeFormValues();
  if (shapeKind === 'ellipse') {
    const ellipse = new fabric.Ellipse({
      left: pointer.x, top: pointer.y, rx: 0.5, ry: 0.5,
      stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDashArray: style.strokeDashArray,
      fill: style.fill, strokeUniform: true,
      cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
    });
    ellipse.mfcId = 'shp' + takeId(); ellipse.mfcType = 'shape'; ellipse.mfcShapeKind = 'ellipse';
    canvas.add(ellipse);
    shapeDrag = { rect: ellipse, startX: pointer.x, startY: pointer.y, ellipse: true };
    return;
  }
  if (shapeKind !== 'rect') {
    const path = new fabric.Path(pathForDrag(shapeKind,pointer.x,pointer.y,pointer.x+1,pointer.y+1), {
      stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDashArray: style.strokeDashArray,
      fill: 'transparent', strokeUniform: true, perPixelTargetFind: false,
      cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
    });
    path.mfcId = 'shp' + takeId(); path.mfcType = 'shape'; path.mfcShapeKind = shapeKind;
    installCurveControls(path);
    canvas.add(path);
    shapeDrag = { rect: path, startX: pointer.x, startY: pointer.y, kind: shapeKind };
    return;
  }
  const rect = new fabric.Rect({
    left: pointer.x, top: pointer.y, width: 1, height: 1,
    stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDashArray: style.strokeDashArray,
    fill: style.fill, strokeUniform: true,
    cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
  });
  rect.mfcId = 'shp' + takeId();
  rect.mfcType = 'shape';
  canvas.add(rect);
  shapeDrag = { rect, startX: pointer.x, startY: pointer.y };
}

/** While a shape is being dragged out: resize it. */
export function moveShapeDrag(opt) {
  if (!shapeDrag) return;
  const p = canvas.getPointer(opt.e);
  if (shapeDrag.ellipse) {
    let w = p.x - shapeDrag.startX, h = p.y - shapeDrag.startY;
    if (shapeAspectMode === 'square' || opt.e.shiftKey) {
      const size = Math.max(Math.abs(w), Math.abs(h));
      w = (w < 0 ? -1 : 1) * size; h = (h < 0 ? -1 : 1) * size;
    }
    shapeDrag.rect.set({ left: w < 0 ? shapeDrag.startX + w : shapeDrag.startX, top: h < 0 ? shapeDrag.startY + h : shapeDrag.startY,
      rx: Math.max(0.5, Math.abs(w) / 2), ry: Math.max(0.5, Math.abs(h) / 2) });
    shapeDrag.rect.setCoords();
    canvas.requestRenderAll();
    return;
  }
  if (shapeDrag.kind) {
    const obj = shapeDrag.rect;
    obj._setPath(pathForDrag(shapeDrag.kind,shapeDrag.startX,shapeDrag.startY,p.x,p.y));
    obj.setCoords(); obj.dirty = true; canvas.requestRenderAll();
    return;
  }
  let w = p.x - shapeDrag.startX;
  let h = p.y - shapeDrag.startY;
  const square = shapeAspectMode === 'square' || opt.e.shiftKey;
  if (square) {
    const s = Math.max(Math.abs(w), Math.abs(h));
    w = (w < 0 ? -1 : 1) * s;
    h = (h < 0 ? -1 : 1) * s;
  }
  shapeDrag.rect.set({
    left: w < 0 ? shapeDrag.startX + w : shapeDrag.startX,
    top: h < 0 ? shapeDrag.startY + h : shapeDrag.startY,
    width: Math.abs(w), height: Math.abs(h)
  });
  shapeDrag.rect.setCoords();
  canvas.requestRenderAll();
}

/** Releasing a shape drag: a click places a default-sized shape; then back to Select. */
export function endShapeDrag() {
  if (!shapeDrag) return;
  const rect = shapeDrag.rect;
  if (shapeDrag.ellipse && rect.rx < 2.5 && rect.ry < 2.5) {
    rect.set({ rx: 75, ry: shapeAspectMode === 'square' ? 75 : 50 });
    rect.setCoords();
  }
  // treat a near-zero drag (a simple click) as "place a default-sized shape here"
  if (!shapeDrag.kind && !shapeDrag.ellipse && rect.width < 5 && rect.height < 5) {
    rect.set({ width: 150, height: shapeAspectMode === 'square' ? 150 : 100 });
    rect.setCoords();
    canvas.requestRenderAll();
  }
  if (shapeDrag.kind && rect.width < 5 && rect.height < 5) {
    rect._setPath(pathForDrag(shapeDrag.kind,shapeDrag.startX,shapeDrag.startY,shapeDrag.startX+150,shapeDrag.startY+80));
    rect.setCoords();
  }
  shapeDrag = null;
  canvas.setActiveObject(rect);
  canvas.requestRenderAll();
  pushHistory();
  refreshShapePanel();
  setTool('select');
}

/** Drops a shape that is still being dragged out (switching tools). */
export function cancelShapeDrag() { if (shapeDrag) { canvas.remove(shapeDrag.rect); shapeDrag = null; } }

export function setShapeAspectMode(mode) {
  shapeAspectMode = mode;
  document.getElementById('shape-mode-rect').classList.toggle('active', mode === 'rect');
  document.getElementById('shape-mode-square').classList.toggle('active', mode === 'square');
}

// Each panel control changes only its own property, on every selected object of the kind.
export const SHAPE_FIELD_PROPS = { 'shape-stroke-color': ['stroke'], 'shape-stroke-width': ['strokeWidth'],
  'shape-dash': ['strokeDashArray'], 'shape-fill-enabled': ['fill'], 'shape-fill-color': ['fill'] };
export function selectedShapes() { return selectedObjects(o => o.mfcType === 'shape' && o.mfcShapeKind !== 'path'); }

/** Live-apply the changed stroke/fill/dash setting (or all of them) to the selected shape(s). */
export function applyShapeStyle(field) {
  const shapes = selectedShapes();
  if (!shapes.length) return;
  if (field === 'shape-fill-color' && !document.getElementById('shape-fill-enabled').checked) return;
  const style = readShapeFormValues();
  const props = SHAPE_FIELD_PROPS[field] || Object.keys(style);
  // A line has no inside to fill.
  shapes.forEach(shape => props.forEach(key => { if (!(key === 'fill' && shape.mfcShapeKind === 'line')) shape.set(key, style[key]); }));
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: canvas.getActiveObject() });
}

export function refreshShapePanel() {
  const shapes = selectedShapes(), active = shapes[0];
  const isShape = !!active;
  document.getElementById('panel-shape').classList.toggle('hidden', !(isShape || currentTool === 'shape'));
  if (!isShape) return;
  document.getElementById('shape-stroke-color').value = toHexColor(active.stroke) || '#ffffff';
  document.getElementById('shape-stroke-width').value = active.strokeWidth || 0;
  const hasFill = active.fill && active.fill !== 'transparent';
  document.getElementById('shape-fill-enabled').checked = !!hasFill;
  document.getElementById('shape-fill-color').value = hasFill ? toHexColor(active.fill) : '#ffffff';
  const dash = active.strokeDashArray;
  let dashKey = 'solid';
  for (const [k, v] of Object.entries(DASH_PRESETS)) {
    if (v && dash && v.length === dash.length && v.every((n, i) => n === dash[i])) { dashKey = k; break; }
  }
  document.getElementById('shape-dash').value = dashKey;
}

// ---- tool interface (used by tools/tool-switch.js) ----
/** Choosing the Shape tool changes nothing by itself: the next drag on the canvas draws a shape. */
function activateShapeTool() {}
export { activateShapeTool as activate, cancelShapeDrag as deactivate, refreshShapePanel as refreshPanel };

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Canvas set-up and events: creates the Fabric canvas, wires its object and mouse events, and passes pointer events to the active tool. */

import { pushHistory } from './history.js';
import { canvas, currentTool, documentOpen, isHelper, setCanvas, takeId } from './state.js';
import { setZoom, zoomAnchor, zoomLevel } from './zoom.js';
import { clearSnapGuides, drawSnapGuides, snapObjectPosition } from '../layout/snap.js';
import { getPreference } from './preferences.js';
import { cropAspectMode, cropRect, keepCropSquare, syncCropFieldsFromRect } from '../tools/crop.js';
import { endInsetDrag, moveInsetDrag, placeFixedInsetContour, refreshInsetPanel, startInsetDrag, syncAttachments, syncInsetFromContour, updateInsetReadout } from '../tools/inset.js';
import { beginPathPointer, endPathPointer, enterPathEdit, finishPathDrawing, insertPathNode, movePathPointer, pathDraft, takePathFinishDoubleClick } from '../tools/path.js';
import { refreshScaleBarPreview } from '../tools/scalebar.js';
import { endShapeDrag, moveShapeDrag, startShapeDrag } from '../tools/shape.js';
import { attachTextListeners, forgetTextSelection, normalizeTextScale, refreshTextPanel } from '../tools/text.js';
import { setTool } from '../tools/tool-switch.js';
import { refreshLayersPanel } from '../ui/layers.js';
import { isTransformLocked } from '../ui/locks.js';
import { onSelectionChanged, refreshSelectionBar } from '../ui/selection-bar.js';
import { installImageMenu } from '../image/display-settings.js';
import { onObjectModified as onLettersModified, onObjectRemoved as onLettersRemoved } from '../layout/letters.js';
import { installFrameObject } from '../layout/frames.js';
import { installGridObject, onGridScaling, onObjectModified as onGridModified, onObjectMoving as onGridMoving, onObjectRemoved as onGridRemoved } from '../layout/grid.js';

// ---- init ----
export function init() {
  setCanvas(new fabric.Canvas('mfc-canvas', {
    preserveObjectStacking: true,
    selection: true
  }));
  setZoom(1);
  installImageMenu();

  canvas.on('object:modified', (e) => {
    const obj = e.target;
    // Corner handles scale a text box; fontSize stays the single source of truth, so
    // the scale is folded into fontSize/width (and box height) and reset to 1.
    if (obj && obj.type === 'textbox' && normalizeTextScale(obj)) refreshTextPanel();
    // Layout grids: a dropped panel swaps cells or leaves the grid, a resized grid rescales its cells.
    onGridModified(obj, e.action);
    onLettersModified(obj); // panel letters: an edited letter, and renumbering after a reorder
    if (obj && obj.type === 'activeSelection') obj.getObjects().forEach(o => { if (o.mfcType === 'mfcImage') syncAttachments(o); });
    else if (obj && obj.mfcType === 'mfcImage') syncAttachments(obj);
    refreshSelectionBar();
    if (obj && obj.mfcType === 'insetContour') refreshInsetPanel();
    if (currentTool === 'scalebar') refreshScaleBarPreview();
    pushHistory();
  });
  canvas.on('object:resizing', (e) => { refreshSelectionBar(); if (e.target && e.target.type === 'textbox') refreshTextPanel(); });

  // Shift while rotating snaps to 45° steps, pivoting on the object's center like Fabric's own rotation.
  canvas.on('object:rotating', (e) => {
    const obj = e.target;
    if (!obj) return;
    if (e.e && e.e.shiftKey) {
      const snapped = ((Math.round((obj.angle || 0) / 45) * 45) % 360 + 360) % 360;
      if (snapped !== obj.angle) {
        const center = obj.getCenterPoint();
        obj.set('angle', snapped);
        obj.setPositionByOrigin(center, 'center', 'center');
        obj.setCoords();
      }
    }
    if (obj.mfcType === 'mfcImage') syncAttachments(obj);
    refreshSelectionBar();
  });
  canvas.on('selection:created', onSelectionChanged);
  canvas.on('selection:updated', onSelectionChanged);
  canvas.on('selection:cleared', onSelectionChanged);
  canvas.on('object:added', e => { installGridObject(e.target); installFrameObject(e.target); if (!isHelper(e.target)) refreshLayersPanel(); });
  canvas.on('object:removed', e => { onGridRemoved(e.target); onLettersRemoved(e.target); if (!isHelper(e.target)) refreshLayersPanel(); });
  canvas.on('text:changed', () => { /* debounced via object:modified on blur */ });
  canvas.on('mouse:down', (opt) => {
    // A highlighted range belongs to the editing session in which it was made; any new
    // click on the canvas starts over, so later panel edits apply to the whole box.
    forgetTextSelection();
    onCanvasMouseDown(opt);
  });
  canvas.on('mouse:move', onCanvasMouseMove);
  canvas.on('mouse:up', onCanvasMouseUp);
  canvas.on('mouse:up', clearSnapGuides);
  canvas.on('after:render', opt => drawSnapGuides(opt && opt.ctx ? opt.ctx : canvas.getContext()));
  canvas.on('mouse:dblclick', onCanvasDoubleClick);

  canvas.on('object:moving', (e) => {
    if (!e.target || e.target === cropRect) return;
    if (!(e.e && e.e.altKey)) snapObjectPosition(e.target); // hold Alt to move freely without snapping
    else clearSnapGuides();
    if (e.target.mfcType === 'mfcImage') { syncAttachments(e.target); }
    if (e.target.mfcType === 'insetContour') { syncInsetFromContour(e.target); updateInsetReadout(e.target); }
    onGridMoving(e.target); // a grid's panels and labels follow it
    if (e.target.type === 'activeSelection') {
      e.target.getObjects().forEach(o => { if (o.mfcType === 'mfcImage') syncAttachments(o); });
    }
    refreshSelectionBar();
  });

  // Ctrl+scroll (or pinch, which browsers report as ctrlKey+wheel) zooms the CANVAS,
  // not the page. Plain scroll pans the canvas-wrap div as normal (its own scrollbars).
  canvas.on('mouse:wheel', (opt) => {
    if (!opt.e.ctrlKey) return; // let the page/div scroll normally otherwise
    opt.e.preventDefault();
    opt.e.stopPropagation();
    setZoom(zoomLevel * (0.999 ** opt.e.deltaY), zoomAnchor(opt.e));
  });

  // default-locked aspect ratio; Shift unlocks (fabric convention: uniformScaling + key)
  canvas.uniformScaling = true;
  canvas.on('object:scaling', (e) => {
    const evt = e.e;
    const obj = e.target;

    if (onGridScaling(obj, e.transform)) { refreshSelectionBar(); return; } // a grid resizes by its width
    if (obj === cropRect) {
      // crop rect resizing is handled by its own logic (free rectangle by default,
      // forced 1:1 only in "square" mode) — see setCropAspectMode/applyCrop section.
      if (cropAspectMode === 'square') keepCropSquare(obj, e.transform);
      syncCropFieldsFromRect();
      return;
    }

    if (evt && evt.shiftKey) {
      obj.lockUniScaling = false; // free resize while Shift held
    } else {
      // enforce uniform scale even if user grabs a side handle
      const s = Math.max(obj.scaleX, obj.scaleY);
      obj.scaleX = s; obj.scaleY = s;
    }

    if (obj.mfcType === 'mfcImage') { syncAttachments(obj); }
    if (obj.mfcType === 'insetContour') { syncInsetFromContour(obj); updateInsetReadout(obj); }
    refreshSelectionBar();
    if (obj.type === 'textbox') refreshTextPanel();
  });

  pushHistory();
}

export function onCanvasMouseDown(opt) {
  if (!documentOpen) return;
  if (currentTool === 'path') {
    beginPathPointer(canvas.getPointer(opt.e), opt.e);
    return;
  }
  // Shapes and labels are usually drawn over images: only an existing text box
  // (clicked to edit it) stops the Text tool, and nothing stops the Shape tool.
  if (currentTool === 'text' && !(opt.target && opt.target.type === 'textbox')) {
    const p = canvas.getPointer(opt.e);
    const t = new fabric.Textbox('Text', {
      left: p.x, top: p.y, width: 200,
      // Preferences → Text (a project can override them).
      fontFamily: getPreference('text.fontFamily'),
      fontSize: getPreference('text.fontSize'),
      fill: getPreference('text.color'),
      textAlign: 'left'
    });
    t.mfcId = 'txt' + takeId();
    t.mfcType = 'text';
    attachTextListeners(t);
    canvas.add(t);
    canvas.setActiveObject(t);
    t.enterEditing();
    canvas.requestRenderAll();
    pushHistory();
    setTool('select');
  } else if (currentTool === 'shape') {
    startShapeDrag(canvas.getPointer(opt.e), opt.e);
  } else if (currentTool === 'inset' && opt.target && opt.target.mfcType === 'mfcImage') {
    if (document.getElementById('inset-fixed-size').checked) placeFixedInsetContour(canvas.getPointer(opt.e), opt.target);
    else startInsetDrag(canvas.getPointer(opt.e), opt.target);
  }
}

export function onCanvasMouseMove(opt) {
  if (currentTool === 'path') {
    movePathPointer(canvas.getPointer(opt.e), opt.e);
    return;
  }
  if (moveInsetDrag(opt)) return;
  moveShapeDrag(opt);
}

export function onCanvasMouseUp(opt) {
  if (currentTool === 'path') {
    endPathPointer(canvas.getPointer(opt.e), opt.e);
    return;
  }
  if (endInsetDrag()) return;
  endShapeDrag();
}

export function onCanvasDoubleClick(opt) {
  if(pathDraft){finishPathDrawing(false);return;}
  if(takePathFinishDoubleClick())return; // this double-click just finished a path
  const target=opt.target;
  if(target&&target.mfcShapeKind==='path'&&!isTransformLocked(target)){
    canvas.setActiveObject(target);enterPathEdit(target);insertPathNode(target,canvas.getPointer(opt.e));
  }
}

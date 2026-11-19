/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Inset tool: an outline drawn on an image becomes an enlarged inset kept in sync with it; also keeps attached outlines and scale bars on their image. */

import { pushHistory } from '../core/history.js';
import { DASH_PRESETS, canvas, currentTool, registry, takeId } from '../core/state.js';
import { refreshChannelPanel } from '../image/channels.js';
import { recomposite } from '../image/import.js';
import { refreshScaleBarRefList, updateScaleBarsForImage } from './scalebar.js';
import { toHexColor } from './text.js';
import { setTool } from './tool-switch.js';
import { applyLockState, refuseLocked } from '../ui/locks.js';
import { selectedObjects } from '../ui/selection-bar.js';

// ---- inset tool (draw an outline on an image, then "Create Inset" duplicates that
// region as a separate, independently-editable image kept in sync with the outline) ----
export let insetDrag = null; // { rect, startX, startY }
export let insetAspectMode = 'square'; // 'square' | 'rect' — defaults to square so a drawn outline

/** Drops an inset outline that is still being dragged out (switching tools). */
export function cancelInsetDrag() { if (insetDrag) { canvas.remove(insetDrag.rect); insetDrag = null; } }

export function setInsetAspectMode(mode) {
  insetAspectMode = mode;
  document.getElementById('inset-mode-square').classList.toggle('active', mode === 'square');
  document.getElementById('inset-mode-rect').classList.toggle('active', mode === 'rect');
}

export function readInsetContourFormValues() {
  const dashKey = document.getElementById('inset-dash').value;
  return {
    stroke: document.getElementById('inset-stroke-color').value,
    strokeWidth: parseFloat(document.getElementById('inset-stroke-width').value) || 0,
    strokeDashArray: DASH_PRESETS[dashKey] || null
  };
}

// ---- exact-size insets: the size fields double as "same size as last inset" memory ----
export const INSET_PREFS_KEY = 'fluoforge-inset-size';
export function loadInsetSizePreferences() {
  let prefs = null;
  try { prefs = JSON.parse(localStorage.getItem(INSET_PREFS_KEY) || 'null'); } catch (_) { /* Preferences are optional. */ }
  if (!prefs) return;
  document.getElementById('inset-fixed-size').checked = !!prefs.fixed;
  if (prefs.width > 0) document.getElementById('inset-fixed-w').value = prefs.width;
  if (prefs.height > 0) document.getElementById('inset-fixed-h').value = prefs.height;
  if (prefs.magnification > 0) document.getElementById('inset-magnification').value = prefs.magnification;
}
export function saveInsetSizePreferences() {
  const size = readInsetFixedSize();
  try { localStorage.setItem(INSET_PREFS_KEY, JSON.stringify({ fixed: document.getElementById('inset-fixed-size').checked,
    width: size.width, height: size.height, magnification: readInsetMagnification() })); } catch (_) { /* Preferences are optional. */ }
}
export function readInsetFixedSize() {
  return { width: Math.max(2, parseFloat(document.getElementById('inset-fixed-w').value) || 100),
    height: Math.max(2, parseFloat(document.getElementById('inset-fixed-h').value) || 100) };
}
export function readInsetMagnification() { return Math.max(0.05, parseFloat(document.getElementById('inset-magnification').value) || 1); }
export function rememberInsetSize(width, height) {
  document.getElementById('inset-fixed-w').value = Math.round(width * 100) / 100;
  document.getElementById('inset-fixed-h').value = Math.round(height * 100) / 100;
  saveInsetSizePreferences();
}

export function makeInsetContour(left, top, width, height, sourceImg) {
  const style = readInsetContourFormValues();
  const rect = new fabric.Rect({
    left, top, width, height,
    fill: 'transparent', stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDashArray: style.strokeDashArray,
    strokeUniform: true,
    cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
  });
  rect.mfcId = 'ins' + takeId();
  rect.mfcType = 'insetContour';
  rect.mfcInsetSourceId = sourceImg.mfcId;
  canvas.add(rect);
  return rect;
}

export function startInsetDrag(pointer, sourceImg) {
  const rect = makeInsetContour(pointer.x, pointer.y, 1, 1, sourceImg);
  insetDrag = { rect, startX: pointer.x, startY: pointer.y };
}

/** Places an outline of exactly the typed size, centered on the click and kept inside the image where possible. */
export function placeFixedInsetContour(pointer, sourceImg) {
  const { width, height } = readInsetFixedSize();
  const b = canvasBounds(sourceImg);
  const clamp = (v, min, max) => max < min ? min : Math.min(Math.max(v, min), max);
  const left = clamp(pointer.x - width / 2, b.left, b.left + b.width - width);
  const top = clamp(pointer.y - height / 2, b.top, b.top + b.height - height);
  finishInsetContour(makeInsetContour(left, top, width, height, sourceImg));
}

export function finishInsetContour(rect) {
  applyLockState(rect);
  canvas.setActiveObject(rect);
  syncInsetFromContour(rect); // establishes mfcRelX/Y/W/H immediately, so followSourceImage works even before "Create inset" is pressed
  rememberInsetSize(rect.width * rect.scaleX, rect.height * rect.scaleY);
  canvas.requestRenderAll();
  pushHistory();
  refreshInsetPanel();
  setTool('select');
}

/** Gives the selected outline exactly the typed size, keeping its center. */
export function applyExactSizeToSelectedContour() {
  const active = canvas.getActiveObject();
  if (!active || active.mfcType !== 'insetContour' || refuseLocked(active, 'resized')) return;
  const { width, height } = readInsetFixedSize();
  const center = active.getCenterPoint();
  active.set({ width, height, scaleX: 1, scaleY: 1 });
  active.setPositionByOrigin(center, 'center', 'center');
  active.setCoords();
  syncInsetFromContour(active);
  saveInsetSizePreferences();
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: active });
}

export const INSET_FIELD_PROPS = { 'inset-stroke-color': 'stroke', 'inset-stroke-width': 'strokeWidth', 'inset-dash': 'strokeDashArray' };
/** Live-apply the changed outline setting (or all of them) to the selected inset outline(s). */
export function applyInsetContourStyle(field) {
  const contours = selectedObjects(o => o.mfcType === 'insetContour');
  if (!contours.length) return;
  const style = readInsetContourFormValues();
  const keys = INSET_FIELD_PROPS[field] ? [INSET_FIELD_PROPS[field]] : Object.keys(style);
  contours.forEach(contour => keys.forEach(key => contour.set(key, style[key])));
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: canvas.getActiveObject() });
}

export function refreshInsetPanel() {
  const contours = selectedObjects(o => o.mfcType === 'insetContour');
  const active = contours[0];
  const isContour = !!active;
  const single = isContour && active === canvas.getActiveObject();
  const panel = document.getElementById('panel-inset');
  if (!panel) return;
  panel.classList.toggle('hidden', !(isContour || currentTool === 'inset'));
  document.getElementById('inset-apply-size').classList.toggle('hidden', !single);
  const btn = document.getElementById('inset-create');
  if (btn) {
    btn.classList.toggle('hidden', !single);
    if (isContour) btn.textContent = active.mfcInsetTargetId ? 'Update linked inset now' : 'Create inset';
  }
  if (!insetDrag) updateInsetReadout(isContour ? active : null);
  if (isContour) {
    document.getElementById('inset-stroke-color').value = toHexColor(active.stroke) || '#ffcc00';
    document.getElementById('inset-stroke-width').value = active.strokeWidth || 0;
    const dash = active.strokeDashArray;
    let dashKey = 'solid';
    for (const [k, v] of Object.entries(DASH_PRESETS)) {
      if (v && dash && v.length === dash.length && v.every((n, i) => n === dash[i])) { dashKey = k; break; }
    }
    document.getElementById('inset-dash').value = dashKey;
  }
}

/**
 * Duplicates the region marked by an inset contour rectangle as a new, independent
 * image (own registry entry — own channels, so it's separately editable per the
 * channel panel like any other image), linked back to the contour so future moves/
 * resizes of the *contour* keep the duplicate's crop window in sync (see
 * syncInsetFromContour). The duplicate's own on-screen size/position are never
 * touched by that sync — only which pixels it's showing.
 */
export function createInsetFromContour(contourRect) {
  if (!contourRect || contourRect.mfcType !== 'insetContour') return;
  const srcImg = canvas.getObjects().find(o => o.mfcId === contourRect.mfcInsetSourceId);
  const entry = srcImg && registry[srcImg.mfcId];
  if (!srcImg || !entry) {
    MFC_UI.toast('Could not find the source image for this outline.');
    return;
  }

  // The contour stores its source region in source-image pixel coordinates.
  syncInsetFromContour(contourRect);
  const srcBox = canvasBounds(srcImg);
  const cropX = contourRect.mfcCropX, cropY = contourRect.mfcCropY;
  const cropW = contourRect.mfcCropW, cropH = contourRect.mfcCropH;
  const magnification = readInsetMagnification();
  const w = cropW * srcBox.width / srcImg.width * magnification;
  const h = cropH * srcBox.height / srcImg.height * magnification;

  let insetImg = contourRect.mfcInsetTargetId
    ? canvas.getObjects().find(o => o.mfcId === contourRect.mfcInsetTargetId) : null;

  if (insetImg) {
    // Already linked — "Create inset" becomes "update now" (same effect as a
    // move/resize sync, just triggered manually).
    const displayW = insetImg.getScaledWidth(), displayH = insetImg.getScaledHeight();
    insetImg.set({ cropX, cropY, width: cropW, height: cropH,
      scaleX: displayW/cropW, scaleY: displayH/cropH });
    insetImg.setCoords();
    canvas.requestRenderAll();
    pushHistory();
    MFC_UI.toast('Inset updated.');
    return;
  }

  // Independent registry entry: its own channel settings (on/off, color, contrast) so
  // the inset is separately editable from here on — same duplication pattern used by
  // copy/paste. Raw pixel arrays are read-only and safe to share by reference.
  const clonedRaw = { ...entry.rawImage, channels: entry.rawImage.channels.map(c => ({ ...c })) };
  const insetId = 'img' + takeId();
  registry[insetId] = { rawImage: clonedRaw, sourceId: entry.sourceId, sourceBlob: entry.sourceBlob, workingScale: entry.workingScale };
  // A blank canvas of the composite's size, filled in the next frame (compositing is asynchronous).
  const size = MFC_TIFF.compositeSize(clonedRaw, entry.workingScale);
  const compositeCanvas = document.createElement('canvas');
  compositeCanvas.width = size.width; compositeCanvas.height = size.height;

  insetImg = new fabric.Image(compositeCanvas, {
    left: srcBox.left + srcBox.width + 30, top: srcBox.top,
    cropX, cropY, width: cropW, height: cropH,
    scaleX: w / cropW, scaleY: h / cropH, // starts at the same on-screen size as the outline; freely resizable afterward
    cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
  });
  insetImg.mfcId = insetId;
  insetImg.mfcType = 'mfcImage';
  insetImg.mfcRawWidth = clonedRaw.width;
  insetImg.mfcRawHeight = clonedRaw.height;
  insetImg.mfcFileName = (clonedRaw.fileName || 'image') + ' (inset)';
  insetImg.mfcIsInset = true;
  insetImg.mfcInsetContourId = contourRect.mfcId;
  insetImg.mfcInsetSourceId = srcImg.mfcId;
  contourRect.mfcInsetTargetId = insetImg.mfcId;

  canvas.add(insetImg);
  recomposite(insetImg);
  canvas.setActiveObject(insetImg);
  canvas.requestRenderAll();
  pushHistory();
  refreshChannelPanel();
  refreshScaleBarRefList();
  MFC_UI.toast('Inset created — move/resize it freely; adjust the yellow outline on the original to change what it shows.');
}

// Canvas bounds include an ActiveSelection's transform; child left/top alone do not.
export function canvasCorners(obj) {
  const m = obj.calcTransformMatrix();
  return [[-obj.width/2,-obj.height/2],[obj.width/2,-obj.height/2],
    [obj.width/2,obj.height/2],[-obj.width/2,obj.height/2]]
    .map(([x,y]) => fabric.util.transformPoint(new fabric.Point(x,y), m));
}

export function canvasBounds(obj) {
  const corners = canvasCorners(obj);
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys),
    width: Math.max(...xs)-Math.min(...xs), height: Math.max(...ys)-Math.min(...ys) };
}

/** The part of the source image (its displayed, cropped frame) that an outline covers, clamped to the image. */
export function contourSourceRegion(contour, src) {
  const inverse = fabric.util.invertTransform(src.calcTransformMatrix());
  const local = canvasCorners(contour).map(pt => fabric.util.transformPoint(pt, inverse));
  const xs = local.map(pt => pt.x + src.width/2);
  const ys = local.map(pt => pt.y + src.height/2);
  const left = Math.max(0, Math.min(...xs)), top = Math.max(0, Math.min(...ys));
  return { left, top, right: Math.min(src.width, Math.max(...xs)), bottom: Math.min(src.height, Math.max(...ys)) };
}

/** Live size of an outline (while drawing, resizing or selected) shown in the Inset panel. */
export function updateInsetReadout(contour) {
  const el = document.getElementById('inset-size-readout');
  if (!el) return;
  if (!contour) { el.textContent = 'Draw on an image: the outline size appears here while you drag.'; el.classList.remove('active'); return; }
  const round = n => Math.round(n * 10) / 10;
  const w = contour.width * Math.abs(contour.scaleX || 1), h = contour.height * Math.abs(contour.scaleY || 1);
  let text = `Outline ${round(w)} × ${round(h)} px on the page`;
  const src = canvas.getObjects().find(o => o.mfcId === contour.mfcInsetSourceId), entry = src && registry[src.mfcId];
  if (src && entry) {
    const r = contourSourceRegion(contour, src);
    const nw = Math.max(0, r.right - r.left) / entry.workingScale, nh = Math.max(0, r.bottom - r.top) / entry.workingScale;
    text += ` · ${Math.round(nw)} × ${Math.round(nh)} px of the source image`;
    const voxel = entry.rawImage.voxelSizeUm;
    if (voxel) text += ` · ${round(nw * voxel)} × ${round(nh * voxel)} µm`;
  }
  el.textContent = text;
  el.classList.add('active');
}

export function syncInsetFromContour(contour) {
  const src = canvas.getObjects().find(o => o.mfcId === contour.mfcInsetSourceId);
  if (!src) return;
  const { left, top, right, bottom } = contourSourceRegion(contour, src);
  contour.mfcCropX = src.cropX + left;
  contour.mfcCropY = src.cropY + top;
  contour.mfcCropW = Math.max(1, right-left);
  contour.mfcCropH = Math.max(1, bottom-top);
  contour.mfcRelX = left/src.width;
  contour.mfcRelY = top/src.height;
  contour.mfcRelW = contour.mfcCropW/src.width;
  contour.mfcRelH = contour.mfcCropH/src.height;
  canvas.getObjects().filter(o => o.mfcIsInset && o.mfcInsetContourId === contour.mfcId).forEach(inset => {
    const displayW = inset.getScaledWidth(), displayH = inset.getScaledHeight();
    inset.set({ cropX: contour.mfcCropX, cropY: contour.mfcCropY,
      width: contour.mfcCropW, height: contour.mfcCropH,
      scaleX: displayW / contour.mfcCropW, scaleY: displayH / contour.mfcCropH });
    inset.setCoords();
  });
  canvas.requestRenderAll();
}

export function followSourceImage(src) {
  const matrix = src.calcTransformMatrix();
  const d = fabric.util.qrDecompose(matrix);
  canvas.getObjects().filter(o => o.mfcType === 'insetContour' &&
    o.mfcInsetSourceId === src.mfcId && o.mfcCropX != null).forEach(contour => {
    if (contour.group && contour.group.type === 'activeSelection') return;
    const localX = contour.mfcCropX-src.cropX-src.width/2;
    const localY = contour.mfcCropY-src.cropY-src.height/2;
    const origin = fabric.util.transformPoint(new fabric.Point(localX,localY),matrix);
    contour.set({ left: origin.x, top: origin.y, angle: d.angle,
      scaleX: contour.mfcCropW*d.scaleX/contour.width,
      scaleY: contour.mfcCropH*d.scaleY/contour.height });
    contour.setCoords();
  });
  canvas.requestRenderAll();
}

export function syncAttachments(img) {
  updateScaleBarsForImage(img);
  followSourceImage(img);
}

/** While an inset outline is being dragged out: resize it. Returns true if there was one. */
export function moveInsetDrag(opt) {
  if (insetDrag) {
    const p = canvas.getPointer(opt.e);
    let w = p.x - insetDrag.startX, h = p.y - insetDrag.startY;
    const square = insetAspectMode === 'square' ? !opt.e.shiftKey : opt.e.shiftKey;
    if (square) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = (w < 0 ? -1 : 1) * s;
      h = (h < 0 ? -1 : 1) * s;
    }
    insetDrag.rect.set({
      left: w < 0 ? insetDrag.startX + w : insetDrag.startX,
      top: h < 0 ? insetDrag.startY + h : insetDrag.startY,
      width: Math.abs(w), height: Math.abs(h)
    });
    insetDrag.rect.setCoords();
    updateInsetReadout(insetDrag.rect);
    document.getElementById('inset-fixed-w').value = Math.round(Math.abs(w) * 100) / 100;
    document.getElementById('inset-fixed-h').value = Math.round(Math.abs(h) * 100) / 100;
    canvas.requestRenderAll();
    return true;
  }
  return false;
}

/** Releasing an inset outline drag: keep the outline, or drop it if it is a sliver. Returns true if there was one. */
export function endInsetDrag() {
  if (insetDrag) {
    const rect = insetDrag.rect;
    insetDrag = null;
    if (rect.width < 8 || rect.height < 8) {
      // too small a drag to be intentional — discard rather than leave a stray sliver
      canvas.remove(rect);
      canvas.requestRenderAll();
      return true;
    }
    finishInsetContour(rect);
    return true;
  }
  return false;
}

// ---- tool interface (used by tools/tool-switch.js) ----
/** Choosing the Inset tool changes nothing by itself: the next drag on an image draws an outline. */
function activateInsetTool() {}
export { activateInsetTool as activate, cancelInsetDrag as deactivate, refreshInsetPanel as refreshPanel };

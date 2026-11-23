/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Crop tool (rectangle or square on an image) and crop to shape (a closed shape becomes an object's clip path). */

import { pushHistory } from '../core/history.js';
import { canvas, currentTool, takeId } from '../core/state.js';
import { canvasCorners, syncAttachments } from './inset.js';
import { refreshLayersPanel } from '../ui/layers.js';
import { applyLockState, refuseLocked } from '../ui/locks.js';
import { refreshSelectionBar } from '../ui/selection-bar.js';

// ---- crop tool ----
export let cropRect = null, cropTargetImg = null, cropAspectMode = 'rect'; // 'rect' | 'square'
/** The crop region's size on the page: its box, without the 1 px outline Fabric adds to getScaledWidth. */
const regionWidth = r => r.width * r.scaleX, regionHeight = r => r.height * r.scaleY;


export function startCrop() {
  const active = canvas.getActiveObject();
  if (!active || active.mfcType !== 'mfcImage') {
    MFC_UI.toast('Select an image first to crop it.');
    return;
  }
  if (refuseLocked(active, 'cropped')) return;
  cropTargetImg = active;
  document.getElementById('panel-crop').classList.remove('hidden');

  cropRect = new fabric.Rect({
    left: active.left, top: active.top,
    width: active.getScaledWidth(), height: active.getScaledHeight(),
    scaleX: 1, scaleY: 1,
    fill: 'rgba(91,140,255,0.15)', stroke: '#5b8cff', strokeDashArray: [6, 4],
    cornerColor: '#5b8cff', transparentCorners: false, cornerStyle: 'circle'
  });
  canvas.add(cropRect);
  canvas.setActiveObject(cropRect);
  canvas.requestRenderAll();
  syncCropFieldsFromRect();
}

/** Pull the crop rectangle's current on-screen size into the numeric fields (called live while dragging handles). */
export function syncCropFieldsFromRect() {
  if (!cropRect) return;
  document.getElementById('crop-width').value = Math.round(regionWidth(cropRect));
  document.getElementById('crop-height').value = Math.round(regionHeight(cropRect));
}

/** Push numeric field values back onto the crop rectangle (called when the user types a size). */
export function applyCropFieldsToRect() {
  if (!cropRect) return;
  let w = parseFloat(document.getElementById('crop-width').value);
  let h = parseFloat(document.getElementById('crop-height').value);
  if (!w || !h) return;
  if (cropAspectMode === 'square') {
    // whichever field the user is actively editing wins
    if (document.activeElement && document.activeElement.id === 'crop-height') w = h;
    else h = w;
    document.getElementById('crop-width').value = Math.round(w);
    document.getElementById('crop-height').value = Math.round(h);
  }
  cropRect.set({ scaleX: w / cropRect.width, scaleY: h / cropRect.height });
  cropRect.setCoords();
  canvas.requestRenderAll();
}

/** Makes the crop region a square of `side` (page px) while keeping the point of it at (originX, originY)
    in place. The region's own width and height differ for a non-square image, so a square needs a
    different scale on each axis (equal scales would bring back the image's proportions). */
export function setCropSquare(rect, side, originX = 'left', originY = 'top') {
  const anchor = rect.translateToOriginPoint(rect.getCenterPoint(), originX, originY);
  rect.set({ scaleX: side / rect.width, scaleY: side / rect.height });
  rect.setPositionByOrigin(anchor, originX, originY);
  rect.setCoords();
}

/** While a handle of the crop region is dragged in Square mode: the side being dragged sets the size
    (a corner: the larger side), and the side or corner opposite the handle stays where it is. */
export function keepCropSquare(rect, transform) {
  const corner = transform && transform.corner;
  const w = regionWidth(rect), h = regionHeight(rect);
  const side = corner === 'ml' || corner === 'mr' ? w : corner === 'mt' || corner === 'mb' ? h : Math.max(w, h);
  setCropSquare(rect, side, transform ? transform.originX : 'left', transform ? transform.originY : 'top');
}

export function setCropAspectMode(mode) {
  cropAspectMode = mode;
  document.getElementById('crop-mode-rect').classList.toggle('active', mode === 'rect');
  document.getElementById('crop-mode-square').classList.toggle('active', mode === 'square');
  if (mode === 'square' && cropRect) {
    // The smaller side, so the square fits inside a non-square image.
    setCropSquare(cropRect, Math.min(regionWidth(cropRect), regionHeight(cropRect)));
    canvas.requestRenderAll();
    syncCropFieldsFromRect();
  }
}

/** Crop always applies exactly what's currently shown by the crop rectangle's handles/fields. */
export function applyCrop() {
  if (!cropRect || !cropTargetImg) return;
  const w = regionWidth(cropRect);
  const h = regionHeight(cropRect);
  const img = cropTargetImg;

  // translate crop rect position into the image's local (unscaled) coordinate space
  const localLeft = (cropRect.left - img.left) / img.scaleX;
  const localTop = (cropRect.top - img.top) / img.scaleY;
  const before = { cropX: img.cropX || 0, cropY: img.cropY || 0, width: img.width, height: img.height };
  let width = Math.min(img.width - Math.max(0, localLeft), w / img.scaleX);
  let height = Math.min(img.height - Math.max(0, localTop), h / img.scaleY);
  if (cropAspectMode === 'square') {
    // A region overhanging the image would be cut to a rectangle: keep a square of the smaller side.
    const side = Math.min(width * img.scaleX, height * img.scaleY);
    width = side / img.scaleX; height = side / img.scaleY;
  }

  img.set({
    cropX: Math.max(0, localLeft),
    cropY: Math.max(0, localTop),
    width, height,
    left: cropRect.left, top: cropRect.top
  });
  keepClipOnContent(img, before);
  img.setCoords();
  canvas.remove(cropRect);
  cropRect = null; cropTargetImg = null;
  document.getElementById('panel-crop').classList.add('hidden');
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: img });
}

/** The Crop panel is shown only while the Crop tool is active. */
export function refreshCropPanel() { document.getElementById('panel-crop').classList.toggle('hidden', currentTool !== 'crop'); }

export function cancelCrop() {
  if (cropRect) canvas.remove(cropRect);
  cropRect = null; cropTargetImg = null;
  document.getElementById('panel-crop').classList.add('hidden');
  canvas.requestRenderAll();
}

// ---- crop to shape: a closed shape becomes the clip path of an image (or any other
// object). The clip is stored in the object's own coordinates, so it moves, scales and
// rotates with it, and SVG/PDF export keep it as a vector clipping path. ----
export function isClosedShape(o) {
  return !!o && o.mfcType === 'shape' && (o.type === 'rect' || o.type === 'ellipse' || o.type === 'circle' ||
    (o.mfcShapeKind === 'path' && !!o.mfcPathClosed));
}
/** The {shape, target} pair a "Crop to shape" would use: exactly two objects, the upper closed shape clips the other. */
export function cropToShapePair() {
  const objs = canvas.getActiveObjects();
  if (objs.length !== 2) return null;
  const [lower, upper] = [...objs].sort((a, b) => canvas.getObjects().indexOf(a) - canvas.getObjects().indexOf(b));
  const shape = isClosedShape(upper) ? upper : isClosedShape(lower) ? lower : null;
  const target = shape === upper ? lower : upper;
  if (!shape || !target || target.clipPath || target.mfcType === 'scalebar' || target.mfcType === 'calibrationBar') return null;
  return { shape, target };
}
export async function cropToShape() {
  const pair = cropToShapePair();
  if (!pair) { MFC_UI.toast('Select one image (or object) and one closed shape — box, ellipse or closed path — to crop it to that shape.'); return false; }
  const { shape, target } = pair;
  if (refuseLocked(target, 'cropped') || refuseLocked(shape, 'used as a crop')) return false;
  canvas.discardActiveObject(); // back to document coordinates
  const clip = await MFC_PROJECT.restoreObject(MFC_PROJECT.serializeObject(shape));
  fabric.util.applyTransformToObject(clip, fabric.util.multiplyTransformMatrices(
    fabric.util.invertTransform(target.calcTransformMatrix()), shape.calcTransformMatrix()));
  clip.set({ absolutePositioned: false, inverted: false });
  canvas.remove(shape);
  target.clipPath = clip;
  if (target.mfcType === 'mfcImage' && !target.mfcIsInset) cropImageFrameToClip(target);
  target.dirty = true;
  if (target.mfcType === 'mfcImage') syncAttachments(target);
  canvas.setActiveObject(target);
  canvas.requestRenderAll();
  pushHistory();
  refreshSelectionBar(); refreshLayersPanel();
  MFC_UI.toast('Cropped to shape. Remove shape crop (in the bar above) gives the shape back for editing.');
  return true;
}
/** Gives the clip shape back as a normal, editable shape at the same place on the canvas. */
export async function releaseShapeCrop(target = canvas.getActiveObject()) {
  if (!target || target.type === 'activeSelection' || !target.clipPath) return false;
  if (refuseLocked(target, 'uncropped')) return false;
  const clip = target.clipPath;
  const shape = await MFC_PROJECT.restoreObject(MFC_PROJECT.serializeObject(clip));
  fabric.util.applyTransformToObject(shape, fabric.util.multiplyTransformMatrices(target.calcTransformMatrix(), clip.calcOwnMatrix()));
  if (!shape.mfcId) shape.mfcId = 'shp' + takeId();
  if (!shape.mfcType) shape.mfcType = 'shape';
  target.clipPath = null;
  if (target.mfcPreShapeCrop) { setImageFrame(target, target.mfcPreShapeCrop); delete target.mfcPreShapeCrop; syncAttachments(target); }
  target.dirty = true;
  canvas.insertAt(shape, canvas.getObjects().indexOf(target) + 1);
  applyLockState(shape);
  shape.setCoords();
  canvas.setActiveObject(shape);
  canvas.requestRenderAll();
  pushHistory();
  refreshSelectionBar(); refreshLayersPanel();
  return true;
}
/**
 * Changes an image's crop window (in its preview pixels) while every pixel stays where
 * it is on the canvas, and the clip stays on the same pixels.
 */
export function setImageFrame(img, frame) {
  const before = { cropX: img.cropX || 0, cropY: img.cropY || 0, width: img.width, height: img.height };
  // The new frame's center, in the image's current local coordinates, then on the canvas.
  const local = new fabric.Point(frame.cropX + frame.width / 2 - (before.cropX + before.width / 2),
    frame.cropY + frame.height / 2 - (before.cropY + before.height / 2));
  const center = fabric.util.transformPoint(local, img.calcTransformMatrix());
  img.set({ cropX: frame.cropX, cropY: frame.cropY, width: frame.width, height: frame.height });
  img.setPositionByOrigin(center, 'center', 'center');
  keepClipOnContent(img, before);
  img.setCoords();
}
/** Shrinks an image's frame to its clip shape's bounding box (within the current frame), so the cropped image has no transparent surround. */
export function cropImageFrameToClip(img) {
  const clip = img.clipPath;
  const corners = canvasCorners(clip); // clip has no parent: corners in the image's local coordinates
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  const cropX = img.cropX || 0, cropY = img.cropY || 0;
  const x0 = Math.max(0, Math.min(...xs) + img.width / 2), x1 = Math.min(img.width, Math.max(...xs) + img.width / 2);
  const y0 = Math.max(0, Math.min(...ys) + img.height / 2), y1 = Math.min(img.height, Math.max(...ys) + img.height / 2);
  if (!(x1 - x0 >= 1 && y1 - y0 >= 1)) return;
  img.mfcPreShapeCrop = { cropX, cropY, width: img.width, height: img.height };
  setImageFrame(img, { cropX: cropX + x0, cropY: cropY + y0, width: x1 - x0, height: y1 - y0 });
}

/** Image crops move the image's local origin; shift its clip so it stays on the same pixels. */
export function keepClipOnContent(img, before) {
  if (!img.clipPath) return;
  img.clipPath.set({ left: img.clipPath.left + (before.cropX + before.width / 2) - ((img.cropX || 0) + img.width / 2),
    top: img.clipPath.top + (before.cropY + before.height / 2) - ((img.cropY || 0) + img.height / 2) });
  img.clipPath.setCoords();
  img.dirty = true;
}

// ---- tool interface (used by tools/tool-switch.js) ----
export { startCrop as activate, cancelCrop as deactivate, refreshCropPanel as refreshPanel };

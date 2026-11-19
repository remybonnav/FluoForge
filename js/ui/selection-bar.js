/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Selection: what happens when the selection changes, the selected objects, and the selection bar (position, size, rotation, crop reset). */

import { canvas, currentTool, registry } from '../core/state.js';
import { refreshChannelPanel } from '../image/channels.js';
import { cropRect, cropToShapePair, keepClipOnContent } from '../tools/crop.js';
import { followSourceImage, refreshInsetPanel, syncAttachments, syncInsetFromContour } from '../tools/inset.js';
import { refreshPathPanel } from '../tools/path.js';
import { refreshScaleBarPanel, refreshScaleBarPreview, refreshScaleBarRefList, updateScaleBarsForImage } from '../tools/scalebar.js';
import { refreshShapePanel } from '../tools/shape.js';
import { applyTextBoxSize, refreshTextPanel } from '../tools/text.js';
import { LAYER_ICONS, layerLabel, refreshLayersPanel } from './layers.js';
import { applyLockState, applySelectionLock, isTransformLocked, refuseLocked } from './locks.js';
import { refreshDisplayButtons } from '../image/display-settings.js';

export function onSelectionChanged() {
  const activeObject=canvas.getActiveObject();
  canvas.getObjects().filter(object=>object.__mfcNodeEdit&&object!==activeObject).forEach(path=>{
    path.__mfcNodeEdit=false;path.controls=path.__mfcStandardControls||fabric.Object.prototype.controls;
    path.hasBorders=true;applyLockState(path);path.setCoords();
  });
  applySelectionLock();
  refreshChannelPanel();
  refreshSelectionBar();
  refreshTextPanel();
  refreshScaleBarRefList();
  refreshScaleBarPanel();
  refreshScaleBarPreview();
  refreshShapePanel();
  refreshPathPanel();
  refreshInsetPanel();
  refreshLayersPanel();
  MFC_UI.focusSelection(activeObject, currentTool);
}

// ---- selection bar (contextual sub-bar under the top bar): position, size, rotation,
// position lock and alignment for whatever is selected. Its height never changes. ----
/** Width/height a user means by "size": the box itself for text boxes and inset outlines (no stroke), the drawn extent otherwise. */
export function objectSize(o) {
  if (o.type === 'textbox' || o.mfcType === 'insetContour')
    return { width: o.width * Math.abs(o.scaleX || 1), height: o.height * Math.abs(o.scaleY || 1) };
  return { width: o.getScaledWidth(), height: o.getScaledHeight() };
}
export function setFieldValue(id, value, disabled) {
  const el = document.getElementById(id);
  if (document.activeElement !== el) el.value = value;
  el.disabled = !!disabled;
}
export function refreshSelectionBar() {
  const label = document.getElementById('sel-label');
  if (!label) return;
  refreshDisplayButtons();
  const active = canvas.getActiveObject();
  const transform = document.getElementById('sel-transform'), alignGroup = document.getElementById('sel-align');
  const note = document.getElementById('sel-lock-note');
  const objs = canvas.getActiveObjects();
  if (!active || active === cropRect) {
    label.textContent = active && active === cropRect ? 'Crop region — use the Crop panel' : 'Nothing selected';
    transform.classList.add('hidden'); alignGroup.classList.add('hidden'); note.classList.add('hidden');
    return;
  }
  const multi = active.type === 'activeSelection';
  const locked = isTransformLocked(active);
  label.textContent = multi ? objs.length + ' objects selected' : layerLabel(active);
  label.title = label.textContent;
  transform.classList.remove('hidden');
  alignGroup.classList.toggle('hidden', objs.length < 2);
  const box = active.getBoundingRect(true, true), size = multi ? box : objectSize(active);
  setFieldValue('obj-x', Math.round(box.left), locked);
  setFieldValue('obj-y', Math.round(box.top), locked);
  setFieldValue('obj-width', Math.round(size.width), locked || multi);
  setFieldValue('obj-height', Math.round(size.height), locked || multi);
  setFieldValue('obj-angle', multi ? '' : Math.round(active.angle || 0), locked || multi);
  document.getElementById('obj-lock-aspect').disabled = locked || multi || active.type === 'textbox';
  document.getElementById('obj-rotate-ccw').disabled = locked || multi;
  document.getElementById('obj-rotate-cw').disabled = locked || multi;
  const allPositionLocked = objs.length > 0 && objs.every(o => o.mfcPositionLocked);
  const lockBtn = document.getElementById('obj-position-lock');
  lockBtn.classList.toggle('active', allPositionLocked);
  lockBtn.setAttribute('aria-pressed', String(allPositionLocked));
  lockBtn.innerHTML = (allPositionLocked ? LAYER_ICONS.lock : LAYER_ICONS.unlock) + (allPositionLocked ? ' Position locked' : ' Lock position');
  note.classList.toggle('hidden', !locked || allPositionLocked);
  note.textContent = locked ? 'Contains position-locked objects' : '';
  document.getElementById('obj-release-clip').classList.toggle('hidden', multi || !active.clipPath);
  document.getElementById('obj-release-clip').disabled = locked;
  document.getElementById('btn-crop-shape').classList.toggle('hidden', !cropToShapePair());
  const uncropBtn = document.getElementById('obj-uncrop');
  uncropBtn.classList.toggle('hidden', multi || !isCropped(active));
  uncropBtn.disabled = locked;
}
// Kept for callers/tests written against the former right-hand size panel.
export const refreshObjectSizePanel = refreshSelectionBar;

/** Whether an image currently has an active (non-full-frame) crop applied. */
export function isCropped(img) {
  if (!img || img.mfcType !== 'mfcImage') return false;
  const entry = registry[img.mfcId];
  if (!entry) return false;
  const fullW = Math.max(1, Math.round(entry.rawImage.width * entry.workingScale));
  const fullH = Math.max(1, Math.round(entry.rawImage.height * entry.workingScale));
  return (img.cropX || 0) > 0.01 || (img.cropY || 0) > 0.01 ||
         Math.abs((img.width || 0) - fullW) > 0.5 || Math.abs((img.height || 0) - fullH) > 0.5;
}

/**
 * Restores an image to its full, uncropped frame. Registry entries are never purged
 * when an image is cropped, so the original full-resolution data is always still
 * there — "uncrop" is just resetting the crop window back to the whole thing. Keeps
 * the currently-visible crop content anchored at the same screen position (rather
 * than jumping) by shifting left/top back by the crop offset as the frame expands.
 */
export function uncropImage(img) {
  if (!isCropped(img) || refuseLocked(img, 'resized')) return;
  const entry = registry[img.mfcId];
  const fullW = Math.max(1, Math.round(entry.rawImage.width * entry.workingScale));
  const fullH = Math.max(1, Math.round(entry.rawImage.height * entry.workingScale));
  const cx = img.cropX || 0, cy = img.cropY || 0;
  const before = { cropX: cx, cropY: cy, width: img.width, height: img.height };
  img.set({
    left: img.left - cx * img.scaleX,
    top: img.top - cy * img.scaleY,
    cropX: 0, cropY: 0,
    width: fullW, height: fullH
  });
  keepClipOnContent(img, before);
  img.setCoords();
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: img });
  updateScaleBarsForImage(img);
  followSourceImage(img);
  refreshSelectionBar();
}

/** Rotate the selected object by a relative amount (e.g. ±90°), wrapped to 0-359. */
export function rotateSelected(deltaDeg) {
  const active = canvas.getActiveObject();
  if (!active || active.type === 'activeSelection' || refuseLocked(active, 'rotated')) return;
  let a = ((active.angle || 0) + deltaDeg) % 360;
  if (a < 0) a += 360;
  const center = active.getCenterPoint();
  active.set('angle', a);
  active.setPositionByOrigin(center, 'center', 'center');
  active.setCoords();
  canvas.requestRenderAll();
  if (active.mfcType === 'mfcImage') syncAttachments(active);
  canvas.fire('object:modified', { target: active });
}

export function setObjectAngle(deg) {
  const active = canvas.getActiveObject();
  if (!active || active.type === 'activeSelection' || refuseLocked(active, 'rotated')) { refreshSelectionBar(); return; }
  const center = active.getCenterPoint();
  active.set('angle', ((deg % 360) + 360) % 360);
  active.setPositionByOrigin(center, 'center', 'center');
  active.setCoords();
  canvas.requestRenderAll();
  if (active.mfcType === 'mfcImage') syncAttachments(active);
  canvas.fire('object:modified', { target: active });
}

/** W/H fields: text boxes resize their box only (font size untouched); everything else is scaled. */
export function applyObjectSizeFromFields(changed = 'width') {
  const active = canvas.getActiveObject();
  if (!active || active.type === 'activeSelection') return;
  if (refuseLocked(active, 'resized')) { refreshSelectionBar(); return; }
  const w = parseFloat(document.getElementById('obj-width').value);
  const h = parseFloat(document.getElementById('obj-height').value);
  if (!(w > 0) || !(h > 0)) { refreshSelectionBar(); return; }
  if (active.type === 'textbox') { applyTextBoxSize(changed, changed === 'height' ? h : w); return; }

  const current = objectSize(active);
  let targetW = w, targetH = h;
  if (document.getElementById('obj-lock-aspect').checked) {
    const ratio = current.width / current.height;
    if (changed === 'height') targetW = h * ratio; else targetH = w / ratio;
  }
  // Keep the top-left of the bounding box where it was.
  const before = active.getBoundingRect(true, true);
  active.set({ scaleX: active.scaleX * targetW / current.width, scaleY: active.scaleY * targetH / current.height });
  active.setCoords();
  const after = active.getBoundingRect(true, true);
  active.set({ left: active.left + before.left - after.left, top: active.top + before.top - after.top });
  active.setCoords();
  if (active.mfcType === 'insetContour') syncInsetFromContour(active);
  if (active.mfcType === 'mfcImage') syncAttachments(active);
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: active });
}

/** X/Y fields move the selection's bounding box to the typed document coordinates. */
export function applyObjectPositionFromFields() {
  const active = canvas.getActiveObject();
  if (!active) return;
  if (refuseLocked(active, 'moved')) { refreshSelectionBar(); return; }
  const x = parseFloat(document.getElementById('obj-x').value), y = parseFloat(document.getElementById('obj-y').value);
  if (!Number.isFinite(x) || !Number.isFinite(y)) { refreshSelectionBar(); return; }
  const box = active.getBoundingRect(true, true);
  active.set({ left: active.left + x - box.left, top: active.top + y - box.top });
  active.setCoords();
  const moved = active.type === 'activeSelection' ? active.getObjects() : [active];
  moved.forEach(o => { if (o.mfcType === 'mfcImage') syncAttachments(o); if (o.mfcType === 'insetContour') syncInsetFromContour(o); });
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: active });
}

/** Selected objects matching pred: the active object itself, or the matching members of a multi-selection. */
export function selectedObjects(pred = () => true) {
  const active = canvas && canvas.getActiveObject();
  if (!active) return [];
  return (active.type === 'activeSelection' ? active.getObjects() : [active]).filter(pred);
}

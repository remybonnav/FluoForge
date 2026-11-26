/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Annotate tool (P3-T8): microscopy annotations.
   - Stamps, placed by a click: filled and open arrows (editable Pen paths pointing at the point clicked),
     an arrowhead, an asterisk and markers (dot, triangle, star), in the panel's colour and size.
   - ROIs, drawn by a drag: a dashed box or ellipse with a numbered label ("ROI 1") that follows it.
     The label is a text box with `mfcRoiFor` (the outline's id) and `mfcRoiOffset` (its place from the
     outline's top-left corner, kept when either is moved).
   - Auto-labels linked to an image: a text box with `mfcAutoLabel` { for, kind, corner, dx, dy, text }:
     kind 'channels' (names in their colours), 'z' (position in µm, or projection depth), 'time'
     (frame time: the interval read from the file's metadata, or typed once for the image, kept as
     `mfcTimeIntervalS`) or 'zoom' (an inset's magnification). The label sits at a corner of its image
     and follows it; it is re-filled before every History step, so a new slice, frame, channel name or
     inset size shows at once. Editing the label's text keeps the user's text from then on.
   Labels and outlines are ordinary objects: an image or outline deleted takes its labels with it. */

import { onBeforeHistoryStep, pushHistory } from '../core/history.js';
import { DASH_PRESETS, canvas, currentTool, documentOpen, registry, takeId } from '../core/state.js';
import { getPreference } from '../core/preferences.js';
import * as M from './annotate-model.js';
import { legendEntries } from './legend.js';
import { makeEditablePath, pathStyleFromPanel } from './path.js';
import { attachTextListeners } from './text.js';
import { setTool } from './tool-switch.js';
import { refreshLayersPanel } from '../ui/layers.js';
import { selectedObjects } from '../ui/selection-bar.js';

const KINDS = ['arrow', 'open-arrow', ...Object.keys(M.STAMPS), 'roi-rect', 'roi-ellipse'];
/** The panel's choices for the next annotation. */
export const annotateOptions = { place: 'arrow', color: '#ffffff', sizePt: 12, roiDash: 'dashed' };
const isImage = o => !!(o && o.mfcType === 'mfcImage' && registry[o.mfcId]);
const byId = id => (id ? canvas.getObjects().find(o => o.mfcId === id) || null : null);
const ptToPx = pt => (pt / 72) * (MFC.getDocProps().dpi || 300);
let roiDrag = null; // { shape, startX, startY }
let labelTargets = []; // the images selected when the tool was chosen: auto-labels go on them
let internal = false; // removals made here are not the user's

/** The page box of an object (an outline's stroke included), also inside a selection. */
function boxOf(o) {
  const b = o.getBoundingRect(true, true);
  return { left: b.left, top: b.top, width: b.width, height: b.height };
}
const sizeOf = o => ({ width: o.getScaledWidth(), height: o.getScaledHeight() });

// ---- stamps ----
/** Places the chosen stamp at a point (document px). Returns the object made. */
export function placeStamp(kind, point, { color = annotateOptions.color, sizePt = annotateOptions.sizePt } = {}) {
  const size = Math.max(2, ptToPx(sizePt));
  let obj;
  if (kind === 'arrow' || kind === 'open-arrow') {
    // An editable Pen path: from the upper right to its tip on the point clicked.
    const nodes = M.arrowStampNodes(size * 3).map(n => ({ x: point.x + n.x, y: point.y + n.y }));
    obj = makeEditablePath(nodes, { ...pathStyleFromPanel(), stroke: color, strokeWidth: Math.max(1, size / 6), strokeDashArray: null, opacity: 1 });
    obj.mfcArrowStart = 'none';
    obj.mfcArrowEnd = kind === 'arrow' ? 'arrow' : 'open';
  } else if (M.STAMPS[kind]) {
    const commands = M.stampCommands(kind, size).map(([type, ...v]) => [type, ...v.map((n, i) => n + (i % 2 ? point.y : point.x))]);
    const filled = M.STAMPS[kind].filled;
    obj = new fabric.Path(commands, { stroke: color, strokeWidth: filled ? 0 : Math.max(1, size / 8), fill: filled ? color : 'transparent',
      strokeLineCap: 'round', strokeLineJoin: 'round', strokeUniform: true, objectCaching: false,
      cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff' });
    Object.assign(obj, { mfcId: 'shp' + takeId(), mfcType: 'shape', mfcShapeKind: 'stamp', mfcStamp: kind });
  } else return null;
  canvas.add(obj);
  return obj;
}

// ---- ROIs ----
const roiLabels = () => canvas.getObjects().filter(o => o.type === 'textbox' && o.mfcRoiFor);
const labelFor = (list, id) => list.find(l => l.mfcRoiFor === id || (l.mfcAutoLabel && l.mfcAutoLabel.for === id));
function makeText(text, extra) {
  const box = new fabric.Textbox(text, { fontFamily: getPreference('text.fontFamily'), fontSize: Math.max(1, ptToPx(Math.max(4, annotateOptions.sizePt * 0.75))),
    fill: annotateOptions.color, textAlign: 'left', originX: 'left', originY: 'top' });
  Object.assign(box, { mfcId: 'txt' + takeId(), mfcType: 'text' }, extra);
  fitWidth(box);
  attachTextListeners(box);
  return box;
}
/** A label's box as wide as its text (one line). */
function fitWidth(box) {
  const measure = new fabric.Text(box.text || ' ', { fontFamily: box.fontFamily, fontSize: box.fontSize, fontWeight: box.fontWeight, fontStyle: box.fontStyle, styles: box.styles });
  box.set({ width: Math.ceil(measure.width) + 2 });
  box.initDimensions();
}
function startRoi(pointer) {
  const style = { left: pointer.x, top: pointer.y, stroke: annotateOptions.color, strokeWidth: Math.max(1, ptToPx(1)), strokeDashArray: DASH_PRESETS[annotateOptions.roiDash] || null,
    fill: 'transparent', strokeUniform: true, cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff' };
  const ellipse = annotateOptions.place === 'roi-ellipse';
  const shape = ellipse ? new fabric.Ellipse({ ...style, rx: 0.5, ry: 0.5 }) : new fabric.Rect({ ...style, width: 1, height: 1 });
  Object.assign(shape, { mfcId: 'shp' + takeId(), mfcType: 'shape', mfcRoi: true }, ellipse ? { mfcShapeKind: 'ellipse' } : {});
  canvas.add(shape);
  roiDrag = { shape, startX: pointer.x, startY: pointer.y, ellipse };
}
function moveRoi(pointer, shift) {
  let w = pointer.x - roiDrag.startX, h = pointer.y - roiDrag.startY;
  if (shift) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
  const pos = { left: w < 0 ? roiDrag.startX + w : roiDrag.startX, top: h < 0 ? roiDrag.startY + h : roiDrag.startY };
  roiDrag.shape.set(roiDrag.ellipse ? { ...pos, rx: Math.max(0.5, Math.abs(w) / 2), ry: Math.max(0.5, Math.abs(h) / 2) } : { ...pos, width: Math.abs(w), height: Math.abs(h) });
  roiDrag.shape.setCoords();
  canvas.requestRenderAll();
}
function endRoi() {
  const { shape, ellipse } = roiDrag; roiDrag = null;
  const b = boxOf(shape), fallback = ptToPx(36);
  if (b.width < 5 && b.height < 5) shape.set(ellipse ? { rx: fallback / 2, ry: fallback / 2 } : { width: fallback, height: fallback });
  shape.setCoords();
  const n = M.nextRoiNumber(roiLabels().map(l => l.text));
  const label = makeText(`ROI ${n}`, { mfcRoiFor: shape.mfcId });
  label.mfcRoiOffset = { dx: 0, dy: -label.height - Math.max(1, ptToPx(1)) }; // just above the outline's top-left corner
  canvas.insertAt(label, canvas.getObjects().indexOf(shape) + 1);
  followRoi(shape);
  return { shape, label };
}
/** Keeps an ROI's label at its place from the outline. */
export function followRoi(shape) {
  const label = shape && shape.mfcRoi ? labelFor(roiLabels(), shape.mfcId) : null;
  if (!label || label.group || label.isEditing || !label.mfcRoiOffset) return;
  const b = boxOf(shape);
  label.set({ left: b.left + label.mfcRoiOffset.dx, top: b.top + label.mfcRoiOffset.dy });
  label.setCoords();
}

// ---- auto-labels ----
const autoLabels = () => canvas.getObjects().filter(o => o.type === 'textbox' && o.mfcAutoLabel && typeof o.mfcAutoLabel === 'object');
/** What an auto-label says now: { text, styles } or { error } when the image has nothing to show. */
export function autoLabelContent(img, kind) {
  const raw = registry[img.mfcId]?.rawImage, stack = raw && raw.stack;
  if (!raw) return { error: 'The image has no data.' };
  if (kind === 'channels') {
    const entries = legendEntries(img, 'black');
    return entries.length ? M.channelsText(entries) : { error: 'This image shows no channel: turn one on first.' };
  }
  if (kind === 'z') {
    const text = stack && M.zLabel({ sizeZ: stack.sizeZ, zMode: raw.zMode, zIndex: raw.zIndex, zStepUm: stack.zStepUm });
    return text ? { text, styles: {} } : { error: 'This image is not a Z stack.' };
  }
  if (kind === 'time') {
    const interval = Number.isFinite(img.mfcTimeIntervalS) && img.mfcTimeIntervalS > 0 ? img.mfcTimeIntervalS : stack && stack.frameIntervalS;
    const text = stack && M.timeLabel({ sizeT: stack.sizeT, tIndex: raw.tIndex }, interval);
    return text ? { text, styles: {} } : { error: 'This image is not a time series.' };
  }
  if (kind === 'zoom') {
    const src = img.mfcIsInset ? byId(img.mfcInsetSourceId) : null;
    if (!src) return { error: 'Magnification is for an inset: select an inset made with the Inset tool.' };
    const text = M.magnificationLabel(Math.abs(img.getObjectScaling().scaleX), Math.abs(src.getObjectScaling().scaleX));
    return text ? { text, styles: {} } : { error: 'The inset has no size.' };
  }
  return { error: 'Unknown label.' };
}
function placeAuto(label, img) {
  if (label.group || label.isEditing) return;
  const p = M.placeLabel(boxOf(img), sizeOf(label), label.mfcAutoLabel);
  label.set({ left: p.left, top: p.top });
  label.setCoords();
}
/** Adds a `kind` label to each image (default: the images selected when the tool was chosen, or now). */
export function addAutoLabel(kind, images = null) {
  const targets = (images || (labelTargets.length ? labelTargets : selectedObjects(isImage))).filter(o => isImage(o) && canvas.getObjects().includes(o));
  if (!targets.length) { MFC_UI.toast('Select an image first, then choose Annotate: the label goes on that image.'); return []; }
  const made = [], errors = new Set();
  for (const img of targets) {
    const content = autoLabelContent(img, kind);
    if (content.error) { errors.add(content.error); continue; }
    const corner = M.DEFAULT_CORNER[kind] || 'tl';
    const label = makeText(content.text, {});
    label.set({ styles: content.styles, fill: '#ffffff' });
    fitWidth(label);
    label.mfcAutoLabel = { for: img.mfcId, kind, corner, ...M.insideOffset(corner, Math.max(1, ptToPx(2))), text: content.text };
    canvas.insertAt(label, canvas.getObjects().indexOf(img) + 1);
    placeAuto(label, img);
    made.push(label);
  }
  if (errors.size) MFC_UI.toast([...errors].join(' '));
  if (made.length) { canvas.requestRenderAll(); pushHistory(); refreshLayersPanel(); }
  return made;
}
/** Keeps an image's auto-labels on their corners (called with the image's other attachments). */
export function followAutoLabels(img) {
  if (!img || !canvas) return;
  autoLabels().filter(l => l.mfcAutoLabel.for === img.mfcId).forEach(l => placeAuto(l, img));
}
/** Re-fills every auto-label whose text is still its own; removes labels whose image or outline is gone. */
export function refreshAnnotations() {
  if (!canvas || !documentOpen) return;
  internal = true;
  try {
    for (const label of autoLabels()) {
      const img = byId(label.mfcAutoLabel.for);
      if (!isImage(img)) { canvas.remove(label); continue; }
      const link = label.mfcAutoLabel;
      if (link.custom || label.isEditing) continue;
      if (label.text !== link.text) { link.custom = true; continue; } // the user's own text from now on
      const content = autoLabelContent(img, link.kind);
      if (content.error || content.text === link.text) continue;
      label.set({ text: content.text, styles: content.styles });
      fitWidth(label);
      link.text = content.text;
      placeAuto(label, img);
    }
    for (const label of roiLabels()) { const shape = byId(label.mfcRoiFor); if (!shape) canvas.remove(label); }
  } finally { internal = false; }
}
/** A label moved by the user keeps its new place from its image (or outline). */
export function onObjectModified(obj) {
  const list = obj && obj.type === 'activeSelection' ? obj.getObjects() : [obj];
  for (const o of list) {
    if (!o || o.type !== 'textbox') continue;
    if (o.mfcAutoLabel && typeof o.mfcAutoLabel === 'object') {
      const img = byId(o.mfcAutoLabel.for);
      if (img && !(o.group && o.group === img.group)) Object.assign(o.mfcAutoLabel, M.offsetFrom(boxOf(img), sizeOf(o), boxOf(o)));
    } else if (o.mfcRoiFor) {
      const shape = byId(o.mfcRoiFor);
      if (shape && !(o.group && o.group === shape.group)) { const b = boxOf(shape), l = boxOf(o); o.mfcRoiOffset = { dx: l.left - b.left, dy: l.top - b.top }; }
    }
  }
}
/** While an object moves or is resized: its ROI label follows. */
export function onObjectMoving(obj) {
  if (!obj) return;
  if (obj.type === 'activeSelection') obj.getObjects().forEach(o => { if (o.mfcRoi) followRoi(o); });
  else if (obj.mfcRoi) followRoi(obj);
}
/** An outline removed by the user takes its label; an image its auto-labels. */
export function onObjectRemoved(obj) {
  if (internal || !obj || !obj.mfcId || !canvas) return;
  const gone = canvas.getObjects().filter(o => o.type === 'textbox' && (o.mfcRoiFor === obj.mfcId || (o.mfcAutoLabel && o.mfcAutoLabel.for === obj.mfcId)));
  if (!gone.length) return;
  internal = true;
  try { gone.forEach(l => canvas.remove(l)); } finally { internal = false; }
}

/** Sets (or, empty, clears) the frame interval of the target images: seconds between frames. */
export function setFrameInterval(value) {
  const v = parseFloat(value);
  const images = (labelTargets.length ? labelTargets : selectedObjects(isImage)).filter(isImage);
  if (!images.length) return;
  images.forEach(img => { if (Number.isFinite(v) && v > 0) img.mfcTimeIntervalS = v; else delete img.mfcTimeIntervalS; });
  pushHistory(); // re-fills the time labels
  canvas.requestRenderAll();
  refreshPanel();
}

// ---- tool ----
/** Mouse down with the Annotate tool: a stamp at the point, or the start of an ROI. */
export function onMouseDown(pointer) {
  if (annotateOptions.place.startsWith('roi-')) { startRoi(pointer); return; }
  const obj = placeStamp(annotateOptions.place, pointer);
  if (!obj) return;
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
}
export function onMouseMove(opt) { if (!roiDrag) return false; moveRoi(canvas.getPointer(opt.e), !!(opt.e && opt.e.shiftKey)); return true; }
export function onMouseUp() {
  if (!roiDrag) return false;
  const { shape } = endRoi();
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
  setTool('select');
  canvas.setActiveObject(shape);
  canvas.requestRenderAll();
  return true;
}
export function cancelRoi() { if (roiDrag) { canvas.remove(roiDrag.shape); roiDrag = null; } }

/** Shows the panel while the tool is active, with the options of the next annotation. */
export function refreshPanel() {
  const panel = document.getElementById('panel-annotate');
  if (!panel) return;
  panel.classList.toggle('hidden', currentTool !== 'annotate');
  if (currentTool !== 'annotate') return;
  document.getElementById('annotate-place').value = annotateOptions.place;
  document.getElementById('annotate-color').value = annotateOptions.color;
  const size = document.getElementById('annotate-size');
  if (document.activeElement !== size) size.value = annotateOptions.sizePt;
  document.getElementById('annotate-roi-dash').value = annotateOptions.roiDash;
  const targets = labelTargets.filter(o => canvas.getObjects().includes(o));
  panel.querySelectorAll('[data-auto-label]').forEach(b => { b.disabled = !targets.length; });
  const interval = document.getElementById('annotate-interval');
  interval.disabled = !targets.length;
  const first = targets[0], stack = first && registry[first.mfcId]?.rawImage?.stack;
  if (document.activeElement !== interval) interval.value = first && Number.isFinite(first.mfcTimeIntervalS) ? first.mfcTimeIntervalS : '';
  interval.placeholder = stack && stack.frameIntervalS ? `${M.trimNumber(stack.frameIntervalS, 3)} (from the file)` : 'not in the file';
  document.getElementById('annotate-status').textContent = targets.length
    ? `Auto-labels go on ${targets.length === 1 ? 'the selected image' : `the ${targets.length} selected images`}.`
    : 'For auto-labels, select an image first, then choose Annotate (A).';
}
export function activate() {
  labelTargets = selectedObjects(isImage);
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  refreshPanel();
}
export function deactivate() { cancelRoi(); }

/** Connects the Annotate panel's controls and the history hook (once, when the editor loads). */
export function installAnnotate() {
  const on = (id, event, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(event, fn); };
  on('annotate-place', 'change', e => { if (KINDS.includes(e.target.value)) annotateOptions.place = e.target.value; });
  on('annotate-color', 'input', e => { annotateOptions.color = e.target.value; });
  on('annotate-size', 'change', e => { const v = parseFloat(e.target.value); if (v > 0) annotateOptions.sizePt = v; refreshPanel(); });
  on('annotate-roi-dash', 'change', e => { if (e.target.value in DASH_PRESETS) annotateOptions.roiDash = e.target.value; });
  on('annotate-interval', 'change', e => setFrameInterval(e.target.value));
  document.querySelectorAll('#panel-annotate [data-auto-label]').forEach(b => b.addEventListener('click', () => addAutoLabel(b.dataset.autoLabel)));
  onBeforeHistoryStep(refreshAnnotations);
}

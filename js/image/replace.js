/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Replace image and fill frames (P3-T6).
   "Replace image…" (selection bar), or a file dropped onto an image, swaps the image's source and keeps
   the panel: its frame (place, size and angle on the page), its id and so everything linked to it — grid
   cell, panel letter, labels, comparison group, quick-figure row, scale bar and inset outlines. The new
   file is cropped from its centre to fill the same frame. Inset outlines stay where they are on the page
   and their insets show the new image's pixels there; scale bars are recalibrated to the new pixel size.
   A quick-figure row is replaced as a whole: each panel shows its channel of the new file. When channels
   of the new file have the names of the old ones, a dialog offers to keep their settings (LUT, range,
   gamma, invert, on/off).
   An empty frame (js/layout/frames.js) is filled the same way: by a file dropped on it, or by Replace
   image… with the frame selected. Frames of one group fill together from one file, each with its channel,
   Z slice or time point; an inset frame fills from its outline. */

import { pushHistory } from '../core/history.js';
import { canvas, documentOpen, registry } from '../core/state.js';
import { frames, isFrame } from '../layout/frames.js';
import { gridOfPanel, relayout } from '../layout/grid.js';
import { FRAME_TYPE, matchChannels, seriesIndex } from '../layout/template-model.js';
import { followPanel, renumberLetters } from '../layout/letters.js';
import { syncInsetFromContour } from '../tools/inset.js';
import { refreshScaleBarRefList, updateScaleBarsForImage } from '../tools/scalebar.js';
import { refreshLayersPanel } from '../ui/layers.js';
import { refreshChannelPanel } from './channels.js';
import { montageMembers, montageOf } from './comparison.js';
import { microscopeFormatError, MICROSCOPE_FORMATS, recomposite } from './import.js';

const isImage = o => !!(o && o.mfcType === 'mfcImage' && registry[o.mfcId]);
const byId = id => canvas.getObjects().find(o => o.mfcId === id) || null;
const channelName = (c, i) => String((c && c.name) || `Ch ${i + 1}`).trim() || `Ch ${i + 1}`;
/** The per-channel settings carried over, and how. */
const CHANNEL_KEYS = ['enabled', 'color', 'min', 'max', 'gamma', 'invert'];

/** Decodes a file as Import Image does (TIFF, OME-TIFF and ImageJ TIFF, or a browser raster). */
export async function decodeImageFile(file) {
  if (MICROSCOPE_FORMATS.test(file.name)) throw microscopeFormatError(file.name);
  return /\.tiff?$/i.test(file.name) ? MFC_TIFF.decodeFile(file) : MFC_TIFF.decodeRasterImage(file);
}

/** A view of a decoded file with its own channel settings (pixel arrays are shared, read-only). */
const viewOf = raw => ({ ...raw, channels: raw.channels.map(c => ({ ...c })) });

/** Gives `raw`'s channels the settings of `saved` channels of the same name. Returns the names kept. */
export function carrySettings(raw, saved, adjustments = null) {
  const matches = matchChannels(raw.channels, saved), kept = [];
  raw.channels.forEach((c, i) => {
    const s = matches[i];
    if (!s) return;
    for (const key of CHANNEL_KEYS) if (s[key] !== undefined && s[key] !== null) c[key] = s[key];
    if (s.lut) c.lut = s.lut;
    kept.push(channelName(c, i));
  });
  if (kept.length && adjustments) { raw.brightness = adjustments.brightness || 0; raw.contrast = adjustments.contrast || 0; }
  return kept;
}

/** The part of a composite of `size` that fills a frame of w × h, from the centre. */
export function centreCrop(size, w, h) {
  const ratio = w > 0 && h > 0 ? w / h : size.width / size.height;
  let width = size.width, height = width / ratio;
  if (height > size.height) { height = size.height; width = height * ratio; }
  return { cropX: (size.width - width) / 2, cropY: (size.height - height) / 2, width, height };
}

/** The settings dialog: true to keep the old settings of the channels named, false to take the new file's. */
export function askCarry(names, fileName) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop replace-backdrop';
    const dialog = document.createElement('div'); dialog.className = 'modal replace-modal';
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'replace-title');
    const title = document.createElement('h2'); title.id = 'replace-title'; title.textContent = 'Keep the channel settings?';
    const text = document.createElement('p');
    text.textContent = `${fileName} has channels with the same names: ${names.join(', ')}. Keep their LUT, display range, gamma, invert and on/off, or use the new file's own settings?`;
    const keep = document.createElement('button'); keep.className = 'primary-button'; keep.id = 'replace-keep'; keep.textContent = 'Keep settings';
    keep.title = 'Give the channels of the new file the settings of the channels with the same name';
    const fresh = document.createElement('button'); fresh.id = 'replace-fresh'; fresh.textContent = 'Use the new file\'s';
    fresh.title = 'Use the display settings saved in the new file (Esc)';
    const row = document.createElement('div'); row.className = 'btn-row'; row.append(fresh, keep);
    dialog.append(title, text, row); backdrop.append(dialog); document.body.append(backdrop);
    const done = value => { backdrop.remove(); if (opener && opener.focus) opener.focus(); resolve(value); };
    keep.addEventListener('click', () => done(true));
    fresh.addEventListener('click', () => done(false));
    backdrop.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === keep ? fresh : keep).focus(); }
    });
    keep.focus();
    requestAnimationFrame(() => { if (backdrop.isConnected && !backdrop.contains(document.activeElement)) keep.focus(); }); // Firefox, right after a drop
  });
}
async function decideCarry(names, fileName, carry) {
  if (!names.length) return false;
  if (carry === 'ask') return askCarry(names, fileName);
  return !!carry;
}

/** Puts `raw` into `img` (same id): a new registry entry, the centre of the file filling `box` (page px). */
function setSource(img, raw, sourceId, file, box, name) {
  const workingScale = MFC_TIFF.workingScale(raw.width, raw.height);
  registry[img.mfcId] = { rawImage: raw, sourceId, sourceBlob: file, workingScale };
  const size = MFC_TIFF.compositeSize(raw, workingScale);
  const blank = document.createElement('canvas'); blank.width = size.width; blank.height = size.height;
  img.setElement(blank);
  const crop = centreCrop(size, box.width, box.height);
  img.set({ ...crop, scaleX: box.width / crop.width, scaleY: box.height / crop.height, angle: box.angle || 0, flipX: false, flipY: false, skewX: 0, skewY: 0 });
  img.setPositionByOrigin(box.centre, 'center', 'center');
  Object.assign(img, { mfcRawWidth: raw.width, mfcRawHeight: raw.height, mfcFileName: name || raw.fileName });
  img.setCoords();
  recomposite(img);
}
const boxOf = o => ({ width: Math.abs(o.width * (o.scaleX || 1)), height: Math.abs(o.height * (o.scaleY || 1)), angle: o.angle || 0, centre: o.getCenterPoint() });

/** Shows channel `k` only (all when k < 0), in grey when asked. */
function showChannel(raw, k, grey) {
  if (!(k >= 0)) return;
  raw.channels.forEach((c, i) => { c.enabled = i === k; if (grey && i === k) c.color = 'grey'; });
}
/** Shows a Z slice or a time point of a stack. */
async function showPlane(raw, { z = null, t = null }) {
  if (!raw.stack) return;
  if (z != null) { raw.zMode = 'slice'; raw.zIndex = z; }
  if (t != null) raw.tIndex = t;
  await MFC_TIFF.selectPlane(raw);
}

/** After images changed source: insets show the new pixels, outlines and attachments follow, grids lay out again. */
function afterNewSource(images, raw, keep) {
  const ids = new Set(images.map(o => o.mfcId)), uncalibrated = !raw.voxelSizeUm;
  let bars = 0;
  for (const contour of canvas.getObjects().filter(o => o.mfcType === 'insetContour' && ids.has(o.mfcInsetSourceId))) {
    const src = byId(contour.mfcInsetSourceId);
    for (const inset of canvas.getObjects().filter(o => o.mfcIsInset && o.mfcInsetContourId === contour.mfcId && isImage(o))) {
      const old = registry[inset.mfcId].rawImage, view = viewOf(raw);
      if (keep) carrySettings(view, old, old);
      const workingScale = registry[src.mfcId].workingScale;
      registry[inset.mfcId] = { ...registry[src.mfcId], rawImage: view, workingScale };
      const size = MFC_TIFF.compositeSize(view, workingScale);
      const blank = document.createElement('canvas'); blank.width = size.width; blank.height = size.height;
      const shown = { width: inset.getScaledWidth(), height: inset.getScaledHeight() };
      inset.setElement(blank);
      inset.set({ width: Math.max(1, contour.mfcCropW || 1), height: Math.max(1, contour.mfcCropH || 1) });
      inset.set({ scaleX: shown.width / inset.width, scaleY: shown.height / inset.height });
      Object.assign(inset, { mfcRawWidth: view.width, mfcRawHeight: view.height, mfcFileName: (view.fileName || 'image') + ' (inset)' });
      ids.add(inset.mfcId);
    }
    syncInsetFromContour(contour); // the outline keeps its place on the page; its insets show what is under it now
    canvas.getObjects().filter(o => o.mfcIsInset && o.mfcInsetContourId === contour.mfcId && isImage(o)).forEach(inset => recomposite(inset));
  }
  const all = canvas.getObjects().filter(o => ids.has(o.mfcId) && isImage(o));
  // Scale bars and letters follow; the outlines were just placed from where they are (not moved back from their old crop).
  for (const img of all) { updateScaleBarsForImage(img); followPanel(img); }
  for (const grid of new Set(all.map(gridOfPanel).filter(Boolean))) relayout(grid);
  bars = canvas.getObjects().filter(o => o.mfcType === 'scalebar' && ids.has(o.mfcAttachedTo)).length;
  return { warning: bars && uncalibrated ? ' The new file has no pixel size: its scale bar no longer matches; set the pixel size in the Channels panel.' : '' };
}

/**
 * Replaces the source of an image (or of its whole quick-figure row) with a file. `carry`: true, false
 * or 'ask' (the dialog, when channel names match). One History step. Resolves to the image.
 */
export async function replaceImage(img, file, { carry = 'ask' } = {}) {
  if (!isImage(img)) throw new Error('Select an image (or an empty frame) to replace.');
  if (img.group && img.group.type !== 'activeSelection') throw new Error(`${img.mfcFileName || 'The image'} is inside a group: ungroup it first.`);
  canvas.discardActiveObject();
  const raw = await decodeImageFile(file);
  const sourceId = await MFC_PROJECT.registerSource(file, raw);
  const old = registry[img.mfcId].rawImage;
  const names = matchChannels(raw.channels, old).map((m, i) => (m ? channelName(raw.channels[i], i) : null)).filter(Boolean);
  const keep = await decideCarry(names, file.name, carry);
  const row = montageOf(img) ? montageMembers(montageOf(img)) : [img];
  const views = new Map(row.map(panel => [panel, panel === img ? raw : viewOf(raw)])); // each made before any is changed
  for (const panel of row) {
    const own = registry[panel.mfcId].rawImage, view = views.get(panel);
    if (keep) carrySettings(view, own, own);
    let name = raw.fileName || file.name;
    if (montageOf(panel) && panel.mfcMontageChannel >= 0) {
      // The channel of the same name in the new file, else the same number.
      const oldName = channelName(own.channels[panel.mfcMontageChannel], panel.mfcMontageChannel).toLowerCase();
      let k = view.channels.findIndex((c, i) => channelName(c, i).toLowerCase() === oldName);
      if (k < 0) k = Math.min(panel.mfcMontageChannel, view.channels.length - 1);
      panel.mfcMontageChannel = k;
      showChannel(view, k, !!panel.mfcMontageGrey);
      name = `${name} (${channelName(view.channels[k], k)})`;
    }
    setSource(panel, view, sourceId, file, boxOf(panel), name);
  }
  const { warning } = afterNewSource(row, raw, keep);
  canvas.setActiveObject(img);
  canvas.requestRenderAll();
  pushHistory();
  refreshChannelPanel(); refreshScaleBarRefList(); refreshLayersPanel();
  MFC_UI.toast(`Replaced with ${file.name}${row.length > 1 ? ` (${row.length} linked panels)` : ''}.` + (keep ? ` Settings kept for ${names.join(', ')}.` : '') + warning);
  return img;
}

/** The fields of a frame that only frames have. */
const FRAME_ONLY = ['mfcFrameGroup', 'mfcFrameChannel', 'mfcFrameGrey', 'mfcFrameT', 'mfcFrameZ', 'mfcFrameDisplay', 'mfcFrameInsetContour'];

/** An image in a frame's place: the frame's id and links, the file's centre filling the frame. */
function imageInFrame(frame, raw, sourceId, file, name) {
  const img = new fabric.Image(document.createElement('canvas'), { cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff', opacity: frame.opacity ?? 1 });
  for (const [key, value] of Object.entries(frame)) if (key.startsWith('mfc') && !FRAME_ONLY.includes(key)) img[key] = value;
  img.mfcType = 'mfcImage';
  const box = boxOf(frame);
  canvas.insertAt(img, canvas.getObjects().indexOf(frame));
  canvas.remove(frame);
  setSource(img, raw, sourceId, file, box, name);
  return img;
}

/**
 * Fills an empty frame — and the frames of its group — with a file. `carry`: true, false or 'ask' (when
 * the frame remembers channel settings of the same names). One History step. Resolves to the images.
 */
export async function fillFrame(frame, file, { carry = 'ask' } = {}) {
  if (!isFrame(frame)) throw new Error('This is not an empty frame.');
  if (frame.mfcFrameInsetContour) throw new Error('This inset frame fills from its outline: drop the image on the frame the outline is on.');
  canvas.discardActiveObject();
  const raw = await decodeImageFile(file);
  const sourceId = await MFC_PROJECT.registerSource(file, raw);
  const group = frame.mfcFrameGroup ? frames().filter(f => f.mfcFrameGroup === frame.mfcFrameGroup && !f.mfcFrameInsetContour) : [frame];
  const names = matchChannels(raw.channels, frame.mfcFrameDisplay).map((m, i) => (m ? channelName(raw.channels[i], i) : null)).filter(Boolean);
  const keep = await decideCarry(names, file.name, carry);
  const stack = raw.stack, made = [], notes = [];
  const countT = group.filter(f => Number.isInteger(f.mfcFrameT)).length, countZ = group.filter(f => Number.isInteger(f.mfcFrameZ)).length;
  if ((countT && !(stack && stack.sizeT > 1)) || (countZ && !(stack && stack.sizeZ > 1))) notes.push(`${file.name} is not a ${countT ? 'time series' : 'Z stack'}: every panel shows the same plane.`);
  const views = group.map((f, i) => (i === 0 ? raw : viewOf(raw))); // each made before any is changed
  for (const [i, f] of group.entries()) {
    const view = views[i];
    if (keep) carrySettings(view, f.mfcFrameDisplay, f.mfcFrameDisplay);
    let name = raw.fileName || file.name;
    if (Number.isInteger(f.mfcFrameChannel) && f.mfcFrameChannel >= 0) {
      const k = f.mfcFrameChannel;
      if (k < view.channels.length) { showChannel(view, k, !!f.mfcFrameGrey); name = `${name} (${channelName(view.channels[k], k)})`; }
      else { view.channels.forEach(c => { c.enabled = false; }); notes.push(`${file.name} has no channel ${k + 1}.`); }
    }
    let plane = null;
    if (Number.isInteger(f.mfcFrameT) && stack) { plane = { word: 'Frame', index: seriesIndex(f.mfcFrameT, countT, stack.sizeT) }; await showPlane(view, { t: plane.index }); }
    if (Number.isInteger(f.mfcFrameZ) && stack) { plane = { word: 'Slice', index: seriesIndex(f.mfcFrameZ, countZ, stack.sizeZ) }; await showPlane(view, { z: plane.index }); }
    if (plane) name = `${name} (${plane.word.toLowerCase()} ${plane.index + 1})`;
    const montageChannel = f.mfcFrameChannel;
    const img = imageInFrame(f, view, sourceId, file, name);
    if (typeof img.mfcMontageGroup === 'string' && Number.isInteger(montageChannel)) img.mfcMontageChannel = montageChannel;
    if (plane) for (const label of canvas.getObjects().filter(o => o.mfcFrameSeriesLabel && o.mfcFrameSeriesLabel.frame === img.mfcId)) label.set('text', `${plane.word} ${plane.index + 1}`);
    made.push(img);
  }
  // Inset frames whose outline is on one of these images: insets of the new pixels, in their frames.
  const ids = new Set(made.map(o => o.mfcId));
  for (const insetFrame of frames().filter(f => f.mfcFrameInsetContour)) {
    const contour = byId(insetFrame.mfcFrameInsetContour);
    if (!contour || !ids.has(contour.mfcInsetSourceId)) continue;
    const src = byId(contour.mfcInsetSourceId), entry = registry[src.mfcId];
    syncInsetFromContour(contour);
    const view = viewOf(entry.rawImage), box = boxOf(insetFrame);
    const img = imageInFrame(insetFrame, view, sourceId, file, (view.fileName || file.name) + ' (inset)');
    Object.assign(img, { mfcIsInset: true, mfcInsetContourId: contour.mfcId, mfcInsetSourceId: src.mfcId });
    registry[img.mfcId].workingScale = entry.workingScale;
    // The outline's region, as large as the frame allows (its proportions kept), in the frame's centre.
    const w = contour.mfcCropW, h = contour.mfcCropH, s = Math.min(box.width / w, box.height / h);
    img.set({ cropX: contour.mfcCropX, cropY: contour.mfcCropY, width: w, height: h, scaleX: s, scaleY: s });
    img.setPositionByOrigin(box.centre, 'center', 'center');
    img.setCoords();
    contour.mfcInsetTargetId = img.mfcId;
    recomposite(img);
    made.push(img);
  }
  const { warning } = afterNewSource(made, raw, false);
  renumberLetters();
  canvas.setActiveObject(made[0]);
  canvas.requestRenderAll();
  pushHistory();
  refreshChannelPanel(); refreshScaleBarRefList(); refreshLayersPanel();
  MFC_UI.toast(`${file.name} fills ${made.length === 1 ? 'the frame' : made.length + ' frames'}.` + (keep ? ` Settings kept for ${names.join(', ')}.` : '') + (notes.length ? ' ' + notes.join(' ') : '') + warning);
  return made;
}

/** Replaces an image or fills a frame, reporting errors to the user. */
export async function replaceOrFill(target, file, options) {
  try { return isFrame(target) ? await fillFrame(target, file, options) : await replaceImage(target, file, options); }
  catch (error) { MFC_ERRORS.report(error, { title: 'Could not use ' + file.name }); return null; }
}

/** The image or empty frame under a page point (the topmost), or null. */
export function targetAt(point) {
  const objects = canvas.getObjects();
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.visible === false || !(isImage(o) || isFrame(o))) continue;
    if (o.containsPoint(point, null, true)) return o;
  }
  return null;
}

/** Shows the selection bar's button for one image ("Replace image…") or empty frame ("Fill frame…"). */
export function refreshReplaceButton() {
  const button = document.getElementById('obj-replace-image');
  if (!button || !canvas) return;
  const t = selectedTarget();
  button.classList.toggle('hidden', !t);
  button.textContent = t && isFrame(t) ? 'Fill frame…' : 'Replace image…';
}
const selectedTarget = () => { const a = canvas.getActiveObject(); return a && a.type !== 'activeSelection' && (isImage(a) || isFrame(a)) ? a : null; };

/** The selection bar's Replace image… button, the file picker and dropping a file on an image or frame. */
export function installReplace() {
  const button = document.getElementById('obj-replace-image'), input = document.getElementById('replace-input');
  if (!button || !input || button.__mfcReplace) return;
  button.__mfcReplace = true;
  let target = null;
  button.addEventListener('click', () => { target = selectedTarget(); if (target) input.click(); });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file && target) await replaceOrFill(target, file);
    target = null;
  });
  // A single file dropped on an image or frame replaces it or fills it; anything else imports as before.
  const wrap = document.getElementById('canvas-wrap');
  wrap.addEventListener('drop', e => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!documentOpen || !files || files.length !== 1) return;
    canvas.discardActiveObject();
    const t = targetAt(canvas.getPointer(e));
    if (!t) return;
    e.preventDefault(); e.stopPropagation(); // instead of Import Image
    document.getElementById('drop-hint').classList.add('hidden');
    replaceOrFill(t, files[0]);
  }, true);
}

export { FRAME_TYPE };

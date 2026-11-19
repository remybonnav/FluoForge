/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Calibration bar: a linked object showing one channel's colour table from its min (bottom) to its
   max (top), with the two values as labels. It is a group of a small gradient raster (1 x 256 px,
   computed with the channel's LUT, gamma and invert), a frame and two text labels, so exports keep
   the frame and labels as vectors. The bar is rebuilt whenever that channel's display changes
   (recomposite calls updateCalibrationBarsForImage), so its labels and colours always match the image. */

import { pushHistory } from '../core/history.js';
import { canvas, registry, takeId } from '../core/state.js';
import { calibrationColours } from '../image/composite-core.js';
import { applyLockState } from '../ui/locks.js';
import { refreshLayersPanel } from '../ui/layers.js';

const LABEL_FONT = 'Liberation Sans';

/** A display value as a label: whole numbers as they are, others with up to 2 decimals. */
export function formatCalibrationValue(v) {
  if (!Number.isFinite(v)) return '';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** The gradient raster: 1 x 256 px, the channel's max at the top. */
function gradientCanvas(ch) {
  const colours = calibrationColours(ch);
  const c = document.createElement('canvas'); c.width = 1; c.height = 256;
  const ctx = c.getContext('2d'), img = ctx.createImageData(1, 256);
  for (let k = 0; k < 256; k++) {
    const row = 255 - k; // entry 0 (min) at the bottom
    img.data.set([colours[k * 3], colours[k * 3 + 1], colours[k * 3 + 2], 255], row * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** The parts of a bar for channel `ch`, in group order: gradient, frame, max label, min label. */
function barParts(ch, p) {
  const gradient = new fabric.Image(gradientCanvas(ch), { left: 0, top: 0, scaleX: p.width, scaleY: p.height / 256, objectCaching: false });
  const frame = new fabric.Rect({ left: 0, top: 0, width: p.width, height: p.height, fill: 'transparent', stroke: p.color, strokeWidth: p.strokeWidth, strokeUniform: true });
  const label = (text, top) => new fabric.Text(text, { left: p.width + p.gap, top, fontFamily: LABEL_FONT, fontSize: p.fontSize, fill: p.color });
  const max = label(formatCalibrationValue(ch.max), 0);
  const min = label(formatCalibrationValue(ch.min), 0);
  min.set({ top: p.height - min.height });
  return [gradient, frame, max, min];
}

const props = bar => ({ width: bar.mfcCalWidth, height: bar.mfcCalHeight, fontSize: bar.mfcCalFontSize, color: bar.mfcCalColor || '#000000',
  strokeWidth: bar.mfcCalStrokeWidth || 1, gap: bar.mfcCalGap ?? Math.round(bar.mfcCalWidth * 0.5) });

function channelOf(bar) {
  const entry = registry[bar.mfcCalImageId];
  return entry ? entry.rawImage.channels[bar.mfcCalChannel] : null;
}

/** Adds a calibration bar for channel `index` of each image, to the right of the image. */
export function addCalibrationBar(images, index) {
  const added = [];
  for (const img of images) {
    const ch = registry[img.mfcId]?.rawImage.channels[index];
    if (!ch) continue;
    const box = img.getBoundingRect(true, true);
    const height = Math.max(40, Math.round(box.height));
    const p = { width: Math.max(8, Math.round(height * 0.06)), height, fontSize: Math.max(10, Math.round(height * 0.07)), color: '#000000', strokeWidth: 1 };
    p.gap = Math.round(p.width * 0.5);
    const bar = new fabric.Group(barParts(ch, p), { left: box.left + box.width + p.gap * 2, top: box.top });
    Object.assign(bar, { mfcId: 'cb' + takeId(), mfcType: 'calibrationBar', mfcCalImageId: img.mfcId, mfcCalChannel: index,
      mfcCalWidth: p.width, mfcCalHeight: p.height, mfcCalFontSize: p.fontSize, mfcCalColor: p.color, mfcCalStrokeWidth: p.strokeWidth, mfcCalGap: p.gap });
    canvas.add(bar);
    added.push(bar);
  }
  if (!added.length) { MFC_UI.toast('Select an image to add a calibration bar for one of its channels.'); return []; }
  canvas.setActiveObject(added.at(-1));
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
  return added;
}

/** Rebuilds a bar from its channel's current display, keeping its place, size, rotation and locks. */
export function rebuildCalibrationBar(bar) {
  const ch = channelOf(bar);
  if (!ch) return bar; // the image is gone: the bar keeps its last colours and labels
  const fresh = new fabric.Group(barParts(ch, props(bar)), { originX: 'left', originY: 'top' });
  // Keep the bar's top-left corner, scale and rotation.
  const corner = bar.group ? null : bar.getPointByOrigin('left', 'top');
  fresh.set({ scaleX: bar.scaleX, scaleY: bar.scaleY, angle: bar.angle, flipX: bar.flipX, flipY: bar.flipY, opacity: bar.opacity, visible: bar.visible });
  if (corner) fresh.setPositionByOrigin(corner, 'left', 'top');
  for (const key of Object.keys(bar).filter(k => k.startsWith('mfc'))) fresh[key] = bar[key];
  const objects = canvas.getObjects(), at = objects.indexOf(bar);
  if (at < 0) return bar;
  const wasActive = canvas.getActiveObject() === bar;
  canvas.remove(bar);
  canvas.insertAt(fresh, at);
  applyLockState(fresh);
  fresh.setCoords();
  if (wasActive) canvas.setActiveObject(fresh);
  return fresh;
}

/** Rebuilds every calibration bar of this image (after a change to its channels' display). */
export function updateCalibrationBarsForImage(imgObj) {
  const bars = canvas.getObjects().filter(o => o.mfcType === 'calibrationBar' && o.mfcCalImageId === imgObj.mfcId);
  // A bar inside a multi-selection is drawn relative to it; drop the selection before replacing the bar.
  if (bars.some(b => b.group)) canvas.discardActiveObject();
  bars.forEach(rebuildCalibrationBar);
  if (bars.length) canvas.requestRenderAll();
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Series montages (P3-T9): a Z stack or time series becomes a strip or grid of linked panels, one per
   chosen plane, each labelled with its position ("z = 3.5 µm") or time ("t = 1:30 min").
   The image becomes the first panel; each other panel is a view of the same source (its own registry
   entry sharing the source's stack and sourceId, like a quick-figure panel), so the project stores the
   source once. A panel shows its plane through its own zIndex or tIndex.
   The panels are linked like a quick-figure row (`mfcMontageGroup`, js/image/montage.js): range, LUT,
   gamma, invert, brightness and contrast edits reach every panel, and so does turning a channel on or
   off; cropping one crops all and lays the montage out again. Each panel stores `mfcSeries` { axis
   ('z' | 't'), position (its place in the series, from 0) }, its column and row (`mfcMontageColumn`,
   `mfcMontageRow`) and the gap. The labels are P3-T8 auto-labels (js/tools/annotate.js): linked to their
   panel, they follow it and say its plane again when it changes. The pure part is series-model.js. */

import { pushHistory } from '../core/history.js';
import { pageBounds, pageIndexForBox } from '../core/pages.js';
import { canvas, registry, takeId } from '../core/state.js';
import { addAutoLabel, autoLabelContent, labelFontSize } from '../tools/annotate.js';
import { getPreference } from '../core/preferences.js';
import { refreshLayersPanel } from '../ui/layers.js';
import { selectedObjects } from '../ui/selection-bar.js';
import { montageMembers, montageOf } from './comparison.js';
import { recomposite } from './import.js';
import { groupParts, layoutRow, mmToPx } from './montage.js';
import * as S from './series-model.js';

/** The options of the next series montage: axis (null: the image's own), range (null: all), step
    (null: about eight panels), columns (0: a strip), gap in mm, labels. */
export const seriesOptions = { axis: null, from: null, to: null, step: null, columns: 0, gapMm: 1, labels: true };

const isImage = o => !!(o && o.mfcType === 'mfcImage' && registry[o.mfcId]);
const stackOf = img => (isImage(img) ? registry[img.mfcId].rawImage.stack || null : null);
/** The number of planes of `img` along `axis` (1 when it has none). */
export const seriesSize = (img, axis) => { const st = stackOf(img); return st ? (axis === 'z' ? st.sizeZ : st.sizeT) : 1; };
/** The axis a series of `img` runs along by default: time when it has frames, else Z; null for neither. */
export const defaultAxis = img => (seriesSize(img, 't') > 1 ? 't' : seriesSize(img, 'z') > 1 ? 'z' : null);

/** Why `img` cannot become a series montage along `axis`, or null. */
export function seriesRefusal(img, axis) {
  if (!isImage(img)) return 'Select an image that is a Z stack or a time series.';
  const name = img.mfcFileName || 'The image';
  if (!defaultAxis(img)) return `${name} is not a Z stack or a time series.`;
  if (seriesSize(img, axis) < 2) return `${name} is not a ${axis === 'z' ? 'Z stack' : 'time series'}.`;
  if (montageOf(img)) return `${name} is already part of a quick figure or series montage.`;
  if (img.group && img.group.type !== 'activeSelection') return `${name} is inside a group: ungroup it first.`;
  if (((img.angle || 0) % 360 + 360) % 360) return `${name} is rotated: set its angle to 0 first.`;
  if (img.clipPath) return `${name} is cropped to a shape: remove the shape crop first.`;
  return null;
}

/** A panel: a view of `img`'s source with its own channel settings and plane. */
function seriesPanel(img) {
  const entry = registry[img.mfcId], raw = entry.rawImage;
  const view = { ...raw, channels: raw.channels.map(c => ({ ...c })) };
  const id = 'img' + takeId();
  registry[id] = { rawImage: view, sourceId: entry.sourceId, sourceBlob: entry.sourceBlob, workingScale: entry.workingScale };
  const size = MFC_TIFF.compositeSize(view, entry.workingScale);
  const blank = document.createElement('canvas'); blank.width = size.width; blank.height = size.height;
  const panel = new fabric.Image(blank, { cropX: img.cropX || 0, cropY: img.cropY || 0, width: img.width, height: img.height,
    scaleX: img.scaleX, scaleY: img.scaleY, left: img.left, top: img.top, opacity: img.opacity ?? 1,
    cornerStyle: img.cornerStyle, transparentCorners: img.transparentCorners, cornerColor: img.cornerColor, borderColor: img.borderColor });
  Object.assign(panel, { mfcId: id, mfcType: 'mfcImage', mfcRawWidth: img.mfcRawWidth, mfcRawHeight: img.mfcRawHeight });
  if (Number.isFinite(img.mfcTimeIntervalS)) panel.mfcTimeIntervalS = img.mfcTimeIntervalS;
  return panel;
}

/** One text size for the labels of a montage: the Annotate panel's, smaller when the longest label
    would take more than 90 % of a panel's width (not below 4 pt). */
function labelSize(texts, panelWidth) {
  const size = labelFontSize(), floor = (4 / 72) * (MFC.getDocProps().dpi || 300);
  const widest = Math.max(1, ...texts.map(t => new fabric.Text(t || ' ', { fontFamily: getPreference('text.fontFamily'), fontSize: size }).width));
  return Math.min(size, Math.max(floor, size * panelWidth * 0.9 / widest));
}

/** Shows plane `index` along `axis` on `panel`: a Z slice (not a projection) or a time frame. */
function showPlane(panel, axis, index) {
  const raw = registry[panel.mfcId].rawImage;
  if (axis === 'z') { raw.zMode = 'slice'; raw.zIndex = index; } else raw.tIndex = index;
  return MFC_TIFF.track(MFC_TIFF.selectPlane(raw).then(() => recomposite(panel)));
}

/**
 * Turns `img` (a Z stack or time series) into a series montage. Options: axis ('z' | 't'), from and
 * to (1-based planes), step, columns (0: a strip), gapMm, labels. Throws with a message when the image
 * or the range cannot be used. One History step. Resolves to the panels, in series order.
 */
export async function seriesMontage(img, options = {}) {
  const axis = options.axis || defaultAxis(img);
  const why = seriesRefusal(img, axis);
  if (why) throw new Error(why);
  const size = seriesSize(img, axis);
  const planes = S.seriesPlanes(size, { from: options.from ?? 1, to: options.to ?? size, step: options.step ?? S.defaultStep(size) }, axis);
  canvas.discardActiveObject(); // page coordinates for the image
  const { columns, rows } = S.gridShape(planes.length, options.columns || 0);
  const gap = mmToPx(options.gapMm ?? 1);
  // Fit the montage in the page, with the same margin on the right and below as on the left.
  const page = pageBounds(Math.max(0, pageIndexForBox(img.getBoundingRect(true, true))));
  const x0 = img.left, y0 = img.top, margin = Math.max(0, x0 - page.left);
  const roomW = page.left + page.width - x0 - margin, roomH = page.top + page.height - y0 - margin;
  let w = img.getScaledWidth(), h = img.getScaledHeight();
  const f = Math.min(1, roomW > 0 ? (roomW - (columns - 1) * gap) / (columns * w) : 1, roomH > 0 ? (roomH - (rows - 1) * gap) / (rows * h) : 1);
  if (f < 1) { const k = Math.max(0.02, f); img.set({ scaleX: img.scaleX * k, scaleY: img.scaleY * k }); w *= k; h *= k; }

  const id = 'mtg' + takeId(), panels = [];
  let at = canvas.getObjects().indexOf(img);
  planes.forEach((plane, position) => {
    const panel = position === 0 ? img : seriesPanel(img);
    const { row, column } = S.cellOf(position, columns);
    Object.assign(panel, { mfcMontageGroup: id, mfcMontageChannel: -1, mfcMontageColumn: column, mfcMontageRow: row, mfcMontageGrey: false,
      mfcMontageGap: gap, mfcSeries: { axis, position } });
    if (position > 0) canvas.insertAt(panel, ++at);
    panels.push(panel);
  });
  // Names say the plane, as the Layers panel and the figure report show them.
  const base = img.mfcFileName || 'image', word = S.AXES[axis].one;
  panels.forEach((panel, i) => { panel.mfcFileName = `${base} (${word} ${planes[i] + 1})`; });
  layoutRow(groupParts(id), { x: x0, y: y0 }, w, h);
  const shown = Promise.all(panels.map((panel, i) => showPlane(panel, axis, planes[i])));
  if (options.labels !== false) {
    const kind = axis === 'z' ? 'z' : 'time';
    addAutoLabel(kind, panels, { history: false, fontSize: labelSize(panels.map(p => autoLabelContent(p, kind).text || ''), w) });
  }
  await shown;
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
  MFC_UI.toast(`Series montage: ${panels.length} linked panels, ${S.AXES[axis].many} ${S.describePlanes(planes)}. Crop or adjust one panel to change them all.`);
  return panels;
}

/** The panels of the series montage `img` belongs to, in series order (empty for another image). */
export function seriesPanels(img) {
  const id = montageOf(img);
  if (!id || !(img.mfcSeries && typeof img.mfcSeries === 'object')) return [];
  return montageMembers(id).filter(p => p.mfcSeries).sort((a, b) => a.mfcSeries.position - b.mfcSeries.position);
}

/** The selected images (for the dialog). */
export const selectedImages = () => selectedObjects(isImage);

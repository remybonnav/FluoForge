/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Split-channel montage ("Quick figure", P3-T1). Each selected image becomes a row of panels: one per
   chosen channel plus a merge, with column headers above the first row (channel names in their LUT
   colour). The image itself becomes the merge panel; each channel panel is a view of the same source,
   built like an inset (its own registry entry, sharing the source's pixel arrays and sourceId), so the
   project stores the source once.
   The panels of a row are linked by `mfcMontageGroup`: range, LUT, gamma, invert, brightness and
   contrast edits reach every panel (js/image/comparison.js, js/image/channels.js), except that a grey
   channel panel keeps its grey LUT; cropping or uncropping one panel crops all of them and lays the row
   out again (cropMontageLike, called by js/tools/crop.js and js/ui/selection-bar.js). Each panel also
   stores the channel it shows (`mfcMontageChannel`, -1 for the merge), its column, the gap and the
   grey option; headers store their group and column. */

import { pushHistory } from '../core/history.js';
import { getPreference } from '../core/preferences.js';
import { pageBounds, pageIndexForBox } from '../core/pages.js';
import { canvas, docProps, registry, takeId } from '../core/state.js';
import { montageMembers, montageOf } from './comparison.js';
import { recomposite } from './import.js';
import { syncAttachments } from '../tools/inset.js';
import { legendColor } from '../tools/legend.js';
import { attachTextListeners } from '../tools/text.js';
import { refreshLayersPanel } from '../ui/layers.js';
import { selectedObjects } from '../ui/selection-bar.js';

/** The options of the next montage: channels in grey, merge first, gap in mm, channel numbers (null: the shown ones). */
export const montageOptions = { grey: false, mergeFirst: false, gapMm: 1, channels: null };

const isImage = o => o && o.mfcType === 'mfcImage' && registry[o.mfcId];
export const mmToPx = mm => (Math.max(0, Number(mm) || 0) / 25.4) * docProps.dpi;
const channelName = (ch, i) => String(ch.name || `Ch ${i + 1}`).trim() || `Ch ${i + 1}`;

/** A header's text size: the default text size, smaller when the name would not fit the panel's width. */
function fitFontSize(text, width) {
  let size = Math.max(1, getPreference('text.fontSize'));
  const measure = new fabric.Text(text || ' ', { fontFamily: getPreference('text.fontFamily'), fontSize: size });
  if (measure.width > width * 0.95) size = Math.max(4, Math.floor(size * width * 0.95 / measure.width));
  return size;
}

/** A channel panel: a view of the merge image's source showing channel `idx` only. */
function channelPanel(img, idx, grey) {
  const entry = registry[img.mfcId], raw = entry.rawImage;
  const channels = raw.channels.map((c, i) => ({ ...c, enabled: i === idx, ...(grey && i === idx ? { color: 'grey' } : {}) }));
  const clonedRaw = { ...raw, channels };
  const id = 'img' + takeId();
  registry[id] = { rawImage: clonedRaw, sourceId: entry.sourceId, sourceBlob: entry.sourceBlob, workingScale: entry.workingScale };
  const size = MFC_TIFF.compositeSize(clonedRaw, entry.workingScale);
  const blank = document.createElement('canvas'); blank.width = size.width; blank.height = size.height;
  const panel = new fabric.Image(blank, { cropX: img.cropX || 0, cropY: img.cropY || 0, width: img.width, height: img.height,
    scaleX: img.scaleX, scaleY: img.scaleY, left: img.left, top: img.top,
    cornerStyle: img.cornerStyle, transparentCorners: img.transparentCorners, cornerColor: img.cornerColor, borderColor: img.borderColor });
  Object.assign(panel, { mfcId: id, mfcType: 'mfcImage', mfcRawWidth: img.mfcRawWidth, mfcRawHeight: img.mfcRawHeight,
    mfcFileName: `${img.mfcFileName || 'image'} (${channelName(raw.channels[idx], idx)})` });
  return panel;
}

/** Why an image cannot become a montage row, or null. */
function refusal(img) {
  if (montageOf(img)) return 'is already part of a quick figure';
  if (img.group && img.group.type !== 'activeSelection') return 'is inside a group: ungroup it first';
  if (((img.angle || 0) % 360 + 360) % 360) return 'is rotated: set its angle to 0 first';
  if (img.clipPath) return 'is cropped to a shape: remove the shape crop first';
  return null;
}

/** Places the panels (by column) and headers of a row from `origin`, with panels of `w` × `h` page px. */
function layoutRow(group, origin, w, h) {
  const gap = group.panels[0].mfcMontageGap || 0;
  for (const panel of group.panels) {
    panel.set({ left: origin.x + panel.mfcMontageColumn * (w + gap), top: origin.y });
    panel.setCoords();
    syncAttachments(panel);
  }
  for (const header of group.headers) {
    header.set({ width: w, fontSize: fitFontSize(header.text, w), left: origin.x + header.mfcMontageColumn * (w + gap) });
    header.initDimensions();
    header.set({ top: origin.y - header.height - Math.min(gap, header.height * 0.25) });
    header.setCoords();
  }
}
const groupParts = id => ({ panels: montageMembers(id), headers: canvas.getObjects().filter(o => o.type === 'textbox' && o.mfcMontageGroup === id) });

/**
 * Turns each image into a row of linked panels. Returns the montage ids made. One History step.
 * Options: grey (channel panels in grey), mergeFirst, gapMm, channels (channel numbers to include;
 * null: the shown channels of each image).
 */
export function quickFigure(images = selectedObjects(isImage), options = montageOptions) {
  canvas.discardActiveObject(); // page coordinates for every image
  const usable = [], problems = [];
  for (const img of images.filter(isImage)) { const why = refusal(img); if (why) problems.push(`${img.mfcFileName || 'An image'} ${why}.`); else usable.push(img); }
  if (!usable.length) { MFC_UI.toast(problems[0] || 'Select one or more images to make a quick figure.'); return []; }
  usable.sort((a, b) => a.top - b.top || a.left - b.left);
  const gap = mmToPx(options.gapMm);
  const made = [];
  let rowTop = usable[0].top, x0 = usable[0].left;
  usable.forEach((img, row) => {
    const raw = registry[img.mfcId].rawImage;
    const wanted = (options.channels || raw.channels.map((c, i) => (c.enabled ? i : -1))).filter(i => i >= 0 && i < raw.channels.length);
    const include = [...new Set(wanted)].sort((a, b) => a - b);
    if (!include.length) { problems.push(`${img.mfcFileName || 'An image'} has no channel to show.`); return; }
    const id = 'mtg' + takeId(), columns = include.length + 1;
    // Fit the row in the page's width, with the same margin on the right as on the left.
    const page = pageBounds(Math.max(0, pageIndexForBox(img.getBoundingRect(true, true))));
    const room = page.left + page.width - x0 - Math.max(0, x0 - page.left);
    let w = img.getScaledWidth(), h = img.getScaledHeight();
    if (room > 0 && columns * w + (columns - 1) * gap > room) {
      const f = Math.max(0.02, (room - (columns - 1) * gap) / (columns * w));
      img.set({ scaleX: img.scaleX * f, scaleY: img.scaleY * f }); w *= f; h *= f;
    }
    const order = options.mergeFirst ? [-1, ...include] : [...include, -1];
    raw.channels.forEach((c, i) => { c.enabled = include.includes(i); });
    Object.assign(img, { mfcMontageGroup: id, mfcMontageChannel: -1, mfcMontageColumn: order.indexOf(-1), mfcMontageGrey: !!options.grey, mfcMontageGap: gap });
    let at = canvas.getObjects().indexOf(img);
    for (const idx of include) {
      const panel = channelPanel(img, idx, !!options.grey);
      Object.assign(panel, { mfcMontageGroup: id, mfcMontageChannel: idx, mfcMontageColumn: order.indexOf(idx), mfcMontageGrey: !!options.grey, mfcMontageGap: gap });
      canvas.insertAt(panel, ++at);
    }
    // Column headers above the first row: channel names in their colour, and "Merge".
    if (row === 0) for (const idx of order) {
      const text = idx < 0 ? 'Merge' : channelName(raw.channels[idx], idx);
      const header = new fabric.Textbox(text, { fontFamily: getPreference('text.fontFamily'), fontSize: fitFontSize(text, w), width: w, textAlign: 'center',
        fill: idx < 0 ? getPreference('text.color') : legendColor(raw.channels[idx], 'white') });
      Object.assign(header, { mfcId: 'txt' + takeId(), mfcType: 'text', mfcMontageGroup: id, mfcMontageChannel: idx, mfcMontageColumn: order.indexOf(idx) });
      attachTextListeners(header);
      canvas.add(header);
    }
    const parts = groupParts(id);
    if (row === 0) {
      // Room for the headers above the first row, inside the page.
      layoutRow(parts, { x: x0, y: rowTop }, w, h);
      const top = Math.min(...parts.headers.map(t => t.top));
      if (top < page.top) { rowTop += page.top - top; layoutRow(parts, { x: x0, y: rowTop }, w, h); }
    } else layoutRow(parts, { x: x0, y: rowTop }, w, h);
    parts.panels.forEach(p => recomposite(p));
    rowTop += h + gap;
    made.push(id);
  });
  if (!made.length) { MFC_UI.toast(problems[0] || 'Nothing to make.'); return []; }
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
  const panels = made.reduce((n, id) => n + montageMembers(id).length, 0);
  MFC_UI.toast(`Quick figure: ${made.length} row${made.length > 1 ? 's' : ''}, ${panels} linked panels. Crop or adjust one panel to change its whole row.` + (problems.length ? ' ' + problems.join(' ') : ''));
  return made;
}

/**
 * After `img` (a montage panel) was cropped or uncropped: gives every panel of its row the same frame
 * at the same scale and lays the row out again from where it started. `before` is the panel's
 * { left, top, width, height } on the page before the change.
 */
export function cropMontageLike(img, before) {
  const id = montageOf(img);
  if (!id) return;
  const parts = groupParts(id), gap = img.mfcMontageGap || 0;
  const origin = { x: before.left - img.mfcMontageColumn * (before.width + gap), y: before.top };
  for (const panel of parts.panels) {
    if (panel === img) continue;
    panel.set({ cropX: img.cropX || 0, cropY: img.cropY || 0, width: img.width, height: img.height, scaleX: img.scaleX, scaleY: img.scaleY });
  }
  layoutRow(parts, origin, img.getScaledWidth(), img.getScaledHeight());
  canvas.requestRenderAll();
}

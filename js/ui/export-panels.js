/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Export ▸ Export panels (zip): every image panel at source resolution as displayed, and each shown
   channel in grey, as PNGs named from the panel letter and the channel name; journals and reviewers
   ask for these. Also in the zip: figure-report.json (provenance) and README.txt (what each file is).
   - <letter>_merge.png: the panel's crop at source pixels with the panel's display settings
     (channels, LUTs, ranges, gamma, invert, brightness and contrast). Shape masks are not applied.
   - <letter>_<channel>.png: that channel alone in grey, through its own range, gamma and invert
     (brightness and contrast act on the merged colours, so they are left out here).
   The letter is the one- or two-character label nearest the panel's top-left corner; panels
   without one are named panel-1, panel-2, ... in figure order. PNGs carry the pixel size (pHYs). */

import { canvas, registry } from '../core/state.js';
import { buildReport, panelGeometry, toJSON } from './figure-report.js';
import { pngWithPhys } from '../image/raster-encoders.js';
import { absoluteBox } from './figure-check.js';
import { pageIndexForBox } from '../core/pages.js';

const LABEL = /^\(?[A-Za-z]{1,2}\)?$/;
const safe = text => String(text || '').normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'channel';

/** Visible image panels on the pages, in figure order (as the figure report numbers them). */
function panels() {
  const out = [];
  const walk = (objects, top) => objects.forEach(o => {
    if (o.visible === false) return;
    if (o.mfcType === 'mfcImage' && registry[o.mfcId] && pageIndexForBox(absoluteBox(top || o)) >= 0) out.push(o);
    if (o.type === 'group' && o.getObjects) walk(o.getObjects(), top || o);
  });
  walk(canvas.getObjects().filter(o => o.mfcId), null);
  return out;
}
function labels() {
  const out = [];
  const walk = objects => objects.forEach(o => {
    if (o.visible === false) return;
    if (['text', 'textbox', 'i-text'].includes(o.type) && LABEL.test(String(o.text || '').trim())) out.push({ text: String(o.text).trim().replace(/[()]/g, ''), box: absoluteBox(o) });
    if (o.type === 'group' && o.getObjects) walk(o.getObjects());
  });
  walk(canvas.getObjects());
  return out;
}

/** The letter of each panel (by mfcId): the nearest label to its top-left corner, within reach. */
export function panelLetters(list = panels()) {
  const found = labels(), letters = new Map(), used = new Map();
  list.forEach((image, i) => {
    const box = absoluteBox(image), reach = Math.max(40, 0.3 * Math.min(box.width, box.height));
    let best = null;
    for (const l of found) {
      const cx = l.box.left + l.box.width / 2, cy = l.box.top + l.box.height / 2;
      const inside = cx >= box.left - reach && cx <= box.left + box.width && cy >= box.top - reach && cy <= box.top + box.height;
      const d = Math.hypot(cx - box.left, cy - box.top);
      if (inside && d <= reach * 1.5 && (!best || d < best.d)) best = { d, text: l.text };
    }
    let name = best ? best.text : 'panel-' + (i + 1);
    const n = (used.get(name) || 0) + 1; used.set(name, n);
    if (n > 1) name += '-' + n;
    letters.set(image.mfcId, name);
  });
  return letters;
}

async function png(canvasEl, micronsPerPixel) {
  const blob = await new Promise((resolve, reject) => canvasEl.toBlob(b => b ? resolve(b) : reject(new Error('PNG encoding failed')), 'image/png'));
  return pngWithPhys(new Uint8Array(await blob.arrayBuffer()), { micronsPerPixel });
}

/** Builds the zip: { blob, files: [names] }. */
export async function buildPanelsZip() {
  if (!MFC.hasDocument) throw new Error('Create or open a figure before exporting.');
  const list = panels();
  if (!list.length) throw new Error('This figure has no image panels on its pages.');
  await MFC_TIFF.whenIdle();
  const letters = panelLetters(list), zip = new JSZip(), files = [], readme = ['FluoForge ' + MFC.getAppVersion() + ': image panels of "' + (MFC.getDocProps().name || 'figure') + '"', ''];
  for (const image of list) {
    const raw = registry[image.mfcId].rawImage, { region } = panelGeometry(image);
    const w = Math.max(1, Math.round(region.width)), h = Math.max(1, Math.round(region.height)), um = raw.voxelSizeUm || null, letter = safe(letters.get(image.mfcId));
    const merge = await MFC_TIFF.composite(raw, 1, region, w, h);
    const mergeName = `${letter}_merge.png`;
    zip.file(mergeName, await png(merge, um)); files.push(mergeName);
    readme.push(`${mergeName}: ${raw.fileName || image.mfcFileName}, ${w} x ${h} px at source resolution, as displayed${um ? `, ${um} µm/px` : ''}${image.clipPath ? ' (its shape mask is not applied)' : ''}`);
    const taken = new Set([mergeName]);
    for (const [index, channel] of raw.channels.entries()) {
      if (channel.enabled === false) continue;
      const grey = { ...raw, brightness: 0, contrast: 0, channels: raw.channels.map((c, i) => ({ ...c, enabled: i === index, color: 'grey', lut: undefined })) };
      let name = `${letter}_${safe(channel.name)}.png`;
      for (let k = 2; taken.has(name); k++) name = `${letter}_${safe(channel.name)}-${k}.png`;
      taken.add(name);
      zip.file(name, await png(await MFC_TIFF.composite(grey, 1, region, w, h), um)); files.push(name);
      readme.push(`${name}: channel ${index + 1} "${channel.name}" in grey, display range ${channel.min} to ${channel.max}` +
        (channel.gamma && channel.gamma !== 1 ? `, gamma ${channel.gamma}` : '') + (channel.invert ? ', inverted' : ''));
    }
  }
  zip.file('figure-report.json', toJSON(buildReport())); files.push('figure-report.json');
  readme.push('', 'figure-report.json: every panel\'s source file (with its SHA-256), crop, projection and display settings.');
  zip.file('README.txt', readme.join('\n') + '\n'); files.push('README.txt');
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'STORE' }), files };
}

/** Export ▸ Export panels (zip). */
export async function exportPanels() {
  MFC_UI.showSavingDialog('Rendering panels…');
  try {
    const { blob, files } = await buildPanelsZip();
    MFC_EXPORT.download(blob, MFC_EXPORT.exportBaseName() + '_panels.zip');
    MFC_UI.toast(`Panels exported: ${files.filter(f => f.endsWith('.png')).length} PNG files in a zip.`);
  } catch (error) { console.error(error); MFC_UI.toast(error.message); }
  finally { MFC_UI.hideSavingDialog(); }
}

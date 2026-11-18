/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Image info dialog (Channels panel): what the import found in the selected image's file, shown
   instead of printed to the console: dimensions, bit depth, channels, Z and T, pixel size and its
   source, and the raw ImageJ header. Every value from the file is inserted as text, never as HTML. */

import { registry } from '../core/state.js';
import { selectedObjects } from './selection-bar.js';

const FORMATS = { tiff: 'TIFF', raster: 'Raster image (PNG, JPEG or BMP)' };

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = String(text);
  return el;
}

/** Where the current pixel size comes from: the file, or typed in the Channels panel. */
function pixelSizeSource(raw, info) {
  const current = raw.voxelSizeUm, fromFile = info ? info.pixelSizeUm : null;
  if (current == null) return info ? info.pixelSizeSource : 'Unknown';
  if (fromFile != null && Math.abs(current - fromFile) <= 1e-9 * Math.max(1, Math.abs(fromFile))) return info.pixelSizeSource;
  return 'Entered in the Channels panel' + (fromFile != null ? ` (the file says ${fromFile} µm/px)` : '');
}

/** The rows of the dialog for one image, as [label, value] pairs. */
export function imageInfoRows(raw) {
  const info = raw.meta && raw.meta.decodeInfo;
  const depths = [...new Set(raw.channels.map(c => c.bitDepth).filter(Boolean))].map(d => d + '-bit');
  const rows = [
    ['File', raw.fileName || 'Unknown'],
    ['Format', FORMATS[raw.sourceFormat] || raw.sourceFormat || 'Unknown'],
    ['Dimensions', `${raw.width} × ${raw.height} px`],
    ['Bit depth', depths.join(', ') || 'Unknown'],
    ['Channels', String(raw.channels.length)],
    ['Z slices', String(raw.stack ? raw.stack.sizeZ : 1)],
    ['Time frames', String(raw.stack ? raw.stack.sizeT : 1)]
  ];
  if (raw.stack && raw.stack.zStepUm) rows.push(['Z step', raw.stack.zStepUm + ' µm']);
  if (info) rows.push(['Pages in the file', String(info.pages)]);
  rows.push(['Pixel size', raw.voxelSizeUm != null ? raw.voxelSizeUm + ' µm/px' : 'Not set']);
  rows.push(['Pixel size source', pixelSizeSource(raw, info)]);
  if (info && info.layoutNote) rows.push(['Note', info.layoutNote]);
  return rows;
}

export function showImageInfo() {
  if (document.querySelector('.image-info-backdrop')) return;
  const image = selectedObjects(o => o.mfcType === 'mfcImage' && registry[o.mfcId])[0];
  if (!image) { MFC_UI.toast('Select an image to see its info.'); return; }
  const raw = registry[image.mfcId].rawImage;
  const info = raw.meta && raw.meta.decodeInfo;
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.getElementById('btn-image-info');

  const backdrop = element('div', 'modal-backdrop image-info-backdrop');
  const dialog = element('div', 'modal image-info-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'image-info-title');
  const title = element('h2', null, 'Image info'); title.id = 'image-info-title';

  const list = element('dl', 'image-info-list');
  for (const [label, value] of imageInfoRows(raw)) list.append(element('dt', null, label), element('dd', null, value));

  const channels = element('table', 'image-info-channels');
  const head = channels.createTHead().insertRow();
  for (const label of ['Channel', 'Colour', 'Display range', 'Range from']) head.append(element('th', null, label));
  const body = channels.createTBody();
  raw.channels.forEach((channel, i) => {
    const row = body.insertRow();
    const detail = info && info.channels && info.channels[i];
    for (const text of [channel.name, channel.color + (detail && detail.colorSource === 'ImageJ LUT' ? ' (ImageJ LUT)' : ''),
      `${channel.min} – ${channel.max}`, detail ? detail.rangeSource : 'Unknown']) row.insertCell().textContent = String(text);
  });

  const header = raw.meta && raw.meta.raw ? raw.meta.raw : '';
  const headerBox = element('pre', 'image-info-header', header || 'None: the file has no ImageJ header.');
  headerBox.id = 'image-info-header';
  headerBox.tabIndex = 0; // long headers scroll: reachable and scrollable with the keyboard
  headerBox.setAttribute('aria-label', 'ImageJ header, as stored in the file');

  const close = element('button', null, 'Close'); close.type = 'button'; close.id = 'image-info-close';
  const buttons = element('div', 'btn-row'); buttons.append(close);
  dialog.append(title, list, element('h3', null, 'Channels'), channels, element('h3', null, 'ImageJ header'), headerBox, buttons);
  backdrop.append(dialog);

  const done = () => { backdrop.remove(); if (opener && opener.focus) opener.focus(); };
  close.addEventListener('click', done);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) done(); });
  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); done(); return; }
    if (event.key !== 'Tab') return;
    // Keep keyboard focus inside the dialog while it is open.
    const first = headerBox, last = close;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.body.append(backdrop);
  close.focus();
}

document.getElementById('btn-image-info').addEventListener('click', showImageInfo);

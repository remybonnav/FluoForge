/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Image info dialog (Channels panel): what the import found in the selected image's file, shown
   instead of printed to the console: dimensions, bit depth, channels, Z and T, pixel size and its
   source, and the raw ImageJ header. Every value from the file is inserted as text, never as HTML.
   Plot info (PI-T8): the same for a vector panel (SVG, or a PDF, EPS, EMF or WMF converted to SVG): its
   file, format and page, its size on paper, the message shown when it was imported (kept with the panel)
   and what was left out; shown in the Inspector's Plot section and as a dialog. Both are also in the
   canvas right-click menu. */

import { canvas, docProps, registry } from '../core/state.js';
import { selectedObjects } from './selection-bar.js';
import { positive, showNumber, valueSource } from '../image/calibration-model.js';

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

/** The rows of the dialog for one image, as [label, value] pairs. With the canvas image `img`, the Z
    step and frame interval are the ones it uses (typed in the Channels panel or the file's). */
export function imageInfoRows(raw, img = null) {
  const info = raw.meta && raw.meta.decodeInfo;
  const kind = info && /floating-point/.test(info.sampleType || '') ? ' float' : info && /signed integer/.test(info.sampleType || '') && !/unsigned/.test(info.sampleType) ? ' signed' : '';
  const depths = [...new Set(raw.channels.map(c => c.bitDepth).filter(Boolean))].map(d => d + '-bit' + kind);
  const rows = [
    ['File', raw.fileName || 'Unknown'],
    ['Format', (info && info.metadata === 'OME-XML' ? 'OME-TIFF' : FORMATS[raw.sourceFormat]) || raw.sourceFormat || 'Unknown'],
    ['Dimensions', `${raw.width} × ${raw.height} px`],
    ['Bit depth', depths.join(', ') || 'Unknown'],
    ['Channels', String(raw.channels.length)],
    ['Z slices', String(raw.stack ? raw.stack.sizeZ : 1)],
    ['Time frames', String(raw.stack ? raw.stack.sizeT : 1)]
  ];
  const stack = raw.stack, typed = key => (img ? positive(img[key]) : null);
  for (const [label, size, fromFile, key, unit] of [['Z step', 'sizeZ', stack && positive(stack.zStepUm), 'mfcZStepUm', 'µm'],
    ['Frame interval', 'sizeT', stack && positive(stack.frameIntervalS), 'mfcTimeIntervalS', 's']]) {
    const current = typed(key) ?? fromFile;
    if (!stack || (stack[size] < 2 && current == null)) continue;
    rows.push([label, current != null ? showNumber(current) + ' ' + unit : 'Not set']);
    if (typed(key) != null) rows.push([label + ' source', valueSource(current, fromFile)]);
  }
  if (info) rows.push(['Pages in the file', String(info.pages)]);
  if (info && raw.sourceFormat === 'tiff') rows.push(['Dimensions from', info.metadata || 'Page count (every page is a channel)']);
  rows.push(['Pixel size', raw.voxelSizeUm != null ? raw.voxelSizeUm + ' µm/px' : 'Not set']);
  rows.push(['Pixel size source', pixelSizeSource(raw, info)]);
  if (info && info.layoutNote) rows.push(['Note', info.layoutNote]);
  // A PDF page imported as an image (PI-T8): where it came from, and the message shown then.
  const r = img && img.mfcRasterised && typeof img.mfcRasterised === 'object' ? img.mfcRasterised : null;
  if (r) {
    rows.push(['Imported from', `${String(r.from || 'pdf').toUpperCase()} ${r.file || ''}${r.page ? `, page ${r.page}${r.pages > 1 ? ' of ' + r.pages : ''}` : ''}`.trim()]);
    rows.push(['Kept as', `Rasterised${r.dpi ? ' at ' + r.dpi + ' dpi' : ''}: an image, not vector`]);
  }
  if (img && typeof img.mfcImportMessage === 'string') rows.push(['Import message', img.mfcImportMessage]);
  return rows;
}

const PLOT_FORMATS = { pdf: 'PDF', eps: 'EPS (PostScript)', emf: 'EMF (Windows metafile)', wmf: 'WMF (Windows metafile)' };
const mmText = (w, h) => `${(Math.round(w * 10) / 10).toFixed(1)} × ${(Math.round(h * 10) / 10).toFixed(1)} mm`;
/** The rows of Plot info for the vector panel `obj`, as [label, value] pairs. */
export function plotInfoRows(obj) {
  const converted = obj.mfcConverted && typeof obj.mfcConverted === 'object' ? obj.mfcConverted : null;
  const dpi = docProps.dpi || 300, drawnDpi = obj.mfcVectorDpi || dpi, element = obj.getElement && obj.getElement();
  const fullW = element && element.width > 1 ? element.width : obj.width, fullH = element && element.height > 1 ? element.height : obj.height;
  const format = converted ? PLOT_FORMATS[converted.from] || String(converted.from || '').toUpperCase() : /\.svgz$/i.test(obj.mfcFileName || '') ? 'SVG (compressed)' : 'SVG';
  const rows = [['File', (converted && converted.file) || obj.mfcFileName || 'Unknown'], ['Format', format]];
  if (converted && converted.page) rows.push(['Page', converted.pages > 1 ? `${converted.page} of ${converted.pages}` : String(converted.page)]);
  rows.push(['Size on paper', mmText(obj.getScaledWidth() / dpi * 25.4, obj.getScaledHeight() / dpi * 25.4)]);
  rows.push(['Size of the plot', mmText(fullW / drawnDpi * 25.4, fullH / drawnDpi * 25.4)]);
  rows.push(['Kept as', converted ? `Vector: converted from ${format} to SVG on import` : 'Vector: the original SVG']);
  rows.push(['Import message', typeof obj.mfcImportMessage === 'string' ? obj.mfcImportMessage : 'Not recorded: the plot was imported before FluoForge 0.1.51.']);
  if (converted && Array.isArray(converted.missing) && converted.missing.length) rows.push(['Left out or drawn differently', converted.missing.map(String).join(', ')]);
  return rows;
}
const infoList = rows => { const list = element('dl', 'image-info-list'); for (const [label, value] of rows) list.append(element('dt', null, label), element('dd', null, value)); return list; };

/** The Inspector's Plot section: shown while one vector panel is selected, with its info. */
export function refreshPlotPanel() {
  const panel = document.getElementById('panel-plot');
  if (!panel || !canvas) return;
  const plots = selectedObjects(o => o.mfcType === 'mfcVector'), plot = plots.length === 1 ? plots[0] : null;
  panel.classList.toggle('hidden', !plot);
  if (!plot) return;
  document.getElementById('plot-name').textContent = '— ' + (plot.mfcFileName || 'plot');
  document.getElementById('plot-info-list').replaceChildren(...infoList(plotInfoRows(plot)).childNodes);
}

/** A modal info dialog titled `heading` with `parts` (elements); Escape, Close or a click outside closes it. */
function infoDialog(heading, parts, opener) {
  const backdrop = element('div', 'modal-backdrop image-info-backdrop');
  const dialog = element('div', 'modal image-info-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'image-info-title');
  const title = element('h2', null, heading); title.id = 'image-info-title';
  const close = element('button', null, 'Close'); close.type = 'button'; close.id = 'image-info-close';
  const buttons = element('div', 'btn-row'); buttons.append(close);
  dialog.append(title, ...parts, buttons);
  backdrop.append(dialog);
  const done = () => { backdrop.remove(); if (opener && opener.isConnected && opener.focus) opener.focus(); };
  close.addEventListener('click', done);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) done(); });
  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); done(); return; }
    if (event.key !== 'Tab') return;
    // Keep keyboard focus inside the dialog while it is open.
    const stops = [...dialog.querySelectorAll('button, [tabindex="0"]')], first = stops[0], last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.body.append(backdrop);
  close.focus();
  return dialog;
}

/** Plot info for the vector panel `plot` (default: the selected one). */
export function showPlotInfo(plot = selectedObjects(o => o.mfcType === 'mfcVector')[0]) {
  if (document.querySelector('.image-info-backdrop')) return;
  if (!plot) { MFC_UI.toast('Select a plot (a vector panel) to see its info.'); return; }
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.getElementById('btn-plot-info');
  infoDialog('Plot info', [infoList(plotInfoRows(plot))], opener);
}
/** The info of any panel: Image info for an image, Plot info for a vector panel. */
export function showPanelInfo(obj) {
  if (obj && obj.mfcType === 'mfcVector') return showPlotInfo(obj);
  return showImageInfo(obj);
}

export function showImageInfo(target = null) {
  if (document.querySelector('.image-info-backdrop')) return;
  const image = target && target.mfcType === 'mfcImage' && registry[target.mfcId] ? target : selectedObjects(o => o.mfcType === 'mfcImage' && registry[o.mfcId])[0];
  if (!image) { MFC_UI.toast('Select an image to see its info.'); return; }
  const raw = registry[image.mfcId].rawImage;
  const info = raw.meta && raw.meta.decodeInfo;
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.getElementById('btn-image-info');

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
  const ome = !!(raw.meta && raw.meta.ome);
  const headerBox = element('pre', 'image-info-header', header || 'None: the file has no ImageJ header.');
  headerBox.id = 'image-info-header';
  headerBox.tabIndex = 0; // long headers scroll: reachable and scrollable with the keyboard
  headerBox.setAttribute('aria-label', (ome ? 'OME-XML' : 'ImageJ header') + ', as stored in the file');
  infoDialog('Image info', [infoList(imageInfoRows(raw, image)), element('h3', null, 'Channels'), channels, element('h3', null, ome ? 'OME-XML' : 'ImageJ header'), headerBox], opener);
}

document.getElementById('btn-image-info').addEventListener('click', () => showImageInfo());
document.getElementById('btn-plot-info').addEventListener('click', () => showPlotInfo());

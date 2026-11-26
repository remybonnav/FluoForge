/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Figure report ("Methods and adjustments"): for every image panel of the figure, where it came from
   (file name, SHA-256, dimensions, bit depth, pixel size) and what was done to it (crop in source
   pixels, Z projection, channel LUTs and display ranges, gamma, brightness and contrast), with its
   printed size and effective resolution at the document's DPI. Written as JSON, Markdown and CSV, with
   a paragraph for a Methods section. SVG and PDF exports embed the JSON (js/export.js).
   The report has no date in it, so the same figure always gives the same report.
   No global and no MFC name: js/export.js and js/main.js import this module. Names and other text from files
   go into the dialog with textContent and value, never as HTML. */

import { zStepOf } from '../image/calibration.js';
import { docProps, getAppVersion, getCanvas, registry } from '../core/state.js';
import { docPropsToPixels, pageBounds, pageCount } from '../core/pages.js';
import { FILE_LUT } from '../image/luts.js';

export const REPORT_VERSION = 1;
const Z_LABELS = { max: 'Maximum intensity projection', mean: 'Mean intensity projection', slice: 'Single slice' };
const FORMATS = { tiff: 'TIFF', raster: 'Raster image' };
const MASKS = { rect: 'rectangle', ellipse: 'ellipse', circle: 'circle', path: 'path', curve: 'curve', polyline: 'polygon', polygon: 'polygon' };

const round = (n, digits = 3) => n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** digits) / 10 ** digits || 0;
const num = (n, digits = 3) => n == null ? '' : String(round(n, digits));
const mm = (px, dpi) => px / dpi * 25.4;

function overlaps(box, page) {
  return box.left < page.left + page.width && box.left + box.width > page.left &&
    box.top < page.top + page.height && box.top + box.height > page.top;
}

/** Image panels in figure order (layer order, depth first), each with the top-level object exports
    use to decide which pages it is on. Hidden objects are not exported, so they are left out. */
function figurePanels() {
  const panels = [];
  const walk = (objects, top) => objects.forEach(obj => {
    if (obj.visible === false || obj.mfcIsPageBounds) return;
    if (obj.mfcType === 'mfcImage' && registry[obj.mfcId]) panels.push({ image: obj, top: top || obj });
    if (obj.type === 'group') walk(obj.getObjects(), top || obj);
  });
  walk(getCanvas().getObjects().filter(o => o.mfcId), null);
  return panels;
}

/** Where the pixel size comes from: the file, or typed in the Channels panel. */
function pixelSizeSource(raw, info) {
  const current = raw.voxelSizeUm, fromFile = info ? info.pixelSizeUm : null;
  if (current == null) return null;
  if (fromFile != null && Math.abs(current - fromFile) <= 1e-9 * Math.max(1, Math.abs(fromFile))) return info.pixelSizeSource || 'File';
  return 'Entered in FluoForge';
}

function sampleKind(info) {
  const type = info && info.sampleType || '';
  if (/floating-point/.test(type)) return 'float';
  if (/signed integer/.test(type) && !/unsigned/.test(type)) return 'signed integer';
  return 'unsigned integer';
}

function projectionOf(raw, image) {
  const stack = raw.stack;
  if (!stack) return null;
  const mode = Z_LABELS[raw.zMode] ? raw.zMode : stack.sizeZ > 1 ? 'max' : 'slice';
  const z = Math.min(Math.max(0, raw.zIndex | 0), stack.sizeZ - 1), t = Math.min(Math.max(0, raw.tIndex | 0), stack.sizeT - 1);
  const all = mode !== 'slice' && stack.sizeZ > 1;
  return { mode: all ? mode : 'slice', label: Z_LABELS[all ? mode : 'slice'], sizeZ: stack.sizeZ,
    firstSlice: all ? 1 : z + 1, lastSlice: all ? stack.sizeZ : z + 1, sizeT: stack.sizeT, frame: t + 1,
    zStepUm: round(zStepOf(image) || null, 6) }; // the typed Z step (P3-T9a) or the file's
}

/** A panel's crop in source pixels, printed size in document pixels and effective resolution: the
    same crop and output size as MFC_EXPORT.buildSVG. Also used by the figure check. */
export function panelGeometry(image, dpi = docProps.dpi) {
  const entry = registry[image.mfcId], raw = entry.rawImage;
  const previewW = Math.round(raw.width * entry.workingScale), previewH = Math.round(raw.height * entry.workingScale);
  const rx = raw.width / previewW, ry = raw.height / previewH;
  const region = { x: (image.cropX || 0) * rx, y: (image.cropY || 0) * ry, width: image.width * rx, height: image.height * ry };
  const matrix = image.calcTransformMatrix();
  const docW = image.width * Math.hypot(matrix[0], matrix[1]), docH = image.height * Math.hypot(matrix[2], matrix[3]);
  return { region, matrix, docW, docH, ppiX: region.width / (docW / dpi), ppiY: region.height / (docH / dpi),
    outW: Math.max(1, Math.min(Math.ceil(region.width), Math.ceil(docW))), outH: Math.max(1, Math.min(Math.ceil(region.height), Math.ceil(docH))) };
}

function panelEntry(image, number, pages) {
  const entry = registry[image.mfcId], raw = entry.rawImage, dpi = docProps.dpi;
  const info = raw.meta && raw.meta.decodeInfo;
  const { region, matrix, docW, docH, outW, outH, ppiX, ppiY } = panelGeometry(image, dpi), parts = fabric.util.qrDecompose(matrix);
  const um = raw.voxelSizeUm;
  const id = String(entry.sourceId || '');
  const depths = [...new Set(raw.channels.map(c => c.bitDepth).filter(Boolean))];
  return {
    panel: number,
    page: pages[0] + 1,
    ...(pages.length > 1 ? { alsoOnPages: pages.slice(1).map(p => p + 1) } : {}),
    inset: !!image.mfcIsInset,
    source: {
      fileName: raw.fileName || (entry.sourceBlob && entry.sourceBlob.name) || image.mfcFileName || 'Unknown',
      sha256: /^src-[0-9a-f]{64}$/.test(id) ? id.slice(4) : null,
      format: info && info.metadata === 'OME-XML' ? 'OME-TIFF' : FORMATS[raw.sourceFormat] || raw.sourceFormat || 'Unknown',
      width: raw.width, height: raw.height, channels: raw.channels.length,
      sizeZ: raw.stack ? raw.stack.sizeZ : 1, sizeT: raw.stack ? raw.stack.sizeT : 1,
      bitDepth: depths.length === 1 ? depths[0] : depths, sampleType: sampleKind(info)
    },
    pixelSizeUm: round(um ?? null, 6),
    pixelSizeSource: pixelSizeSource(raw, info),
    crop: { x: round(region.x, 2), y: round(region.y, 2), width: round(region.width, 2), height: round(region.height, 2),
      wholeImage: Math.abs(region.x) < 0.01 && Math.abs(region.y) < 0.01 && Math.abs(region.width - raw.width) < 0.01 && Math.abs(region.height - raw.height) < 0.01 },
    fieldOfViewUm: um ? { width: round(region.width * um, 3), height: round(region.height * um, 3) } : null,
    shapeMask: image.clipPath ? MASKS[image.clipPath.mfcShapeKind] || MASKS[image.clipPath.type] || 'shape' : null,
    projection: projectionOf(raw, image),
    channels: raw.channels.map((c, i) => ({
      channel: i + 1, name: c.name, shown: c.enabled !== false,
      lut: c.color === FILE_LUT ? 'From file' : c.color,
      min: round(c.min, 6), max: round(c.max, 6),
      gamma: Number.isFinite(c.gamma) && c.gamma > 0 ? round(c.gamma, 4) : 1, invert: !!c.invert
    })),
    brightness: raw.brightness || 0, contrast: raw.contrast || 0,
    rotationDeg: round(parts.angle, 2), flipped: (matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 0,
    printed: { widthMm: round(mm(docW, dpi), 2), heightMm: round(mm(docH, dpi), 2) },
    effectivePpi: { x: round(ppiX, 1), y: round(ppiY, 1) },
    exportedPx: { width: outW, height: outH },
    belowDocumentDpi: Math.min(ppiX, ppiY) < dpi - 0.05
  };
}

/** The report of the open figure. With `page` (0-based), only the panels drawn on that page. */
export function buildReport({ page = null } = {}) {
  const props = docProps, size = docPropsToPixels(props), count = pageCount(props), panels = [];
  const dismissals = (Array.isArray(props.checkDismissals) ? props.checkDismissals : []).map(d => ({
    rule: String(d.rule || ''), severity: String(d.severity || ''), message: String(d.message || ''), note: String(d.note || '') }));
  for (const { image, top } of figurePanels()) {
    const box = top.getBoundingRect(true, true), pages = [];
    for (let i = 0; i < count; i++) if (overlaps(box, pageBounds(i, props))) pages.push(i);
    if (!pages.length || (page != null && !pages.includes(page))) continue; // not exported
    panels.push(panelEntry(image, panels.length + 1, pages));
  }
  return {
    report: 'FluoForge figure report', reportVersion: REPORT_VERSION, generator: 'FluoForge ' + getAppVersion(),
    figure: { name: props.name || '', pages: count, ...(page != null ? { page: page + 1 } : {}),
      width: props.width, height: props.height, unit: props.unit, dpi: props.dpi,
      widthPx: size.width, heightPx: size.height,
      widthMm: round(mm(size.width, props.dpi), 2), heightMm: round(mm(size.height, props.dpi), 2) },
    panels,
    // Figure check findings dismissed in this project, with the note given (P2-T7). Absent when there are none.
    ...(dismissals.length ? { checkDismissals: dismissals } : {})
  };
}

export const toJSON = report => JSON.stringify(report, null, 2) + '\n';

/** JSON with every non-ASCII character and <, >, & escaped (still valid JSON): safe as XML text in
    an SVG <metadata> element and as a PDF document property. */
export function toEmbeddedJSON(report) {
  return JSON.stringify(report).replace(/[\u007f-￿<>&]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

// ---- text forms ----
const bitDepthText = s => (Array.isArray(s.bitDepth) ? s.bitDepth.join('/') : s.bitDepth) + '-bit' +
  (s.sampleType === 'float' ? ' float' : s.sampleType === 'signed integer' ? ' signed' : '');
function list(items) { return items.length < 3 ? items.join(' and ') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]; }
function projectionText(p) {
  if (!p) return '';
  const frame = p.sizeT > 1 ? `, time frame ${p.frame} of ${p.sizeT}` : '';
  if (p.mode === 'slice') return p.sizeZ > 1 ? `Z slice ${p.firstSlice} of ${p.sizeZ}${frame}` : frame.slice(2);
  return `${p.label.toLowerCase()} of Z slices ${p.firstSlice}–${p.lastSlice}${frame}`;
}
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

/** A paragraph for a Methods section, built only from what the report records. */
export function methodsParagraph(report) {
  const panels = report.panels;
  if (!panels.length) return `The figure was assembled in ${report.generator}; it contains no image panels.`;
  const files = new Set(panels.map(p => p.source.sha256 || p.source.fileName));
  const parts = [`Figure panels were assembled in ${report.generator} (${panels.length} image panel${panels.length > 1 ? 's' : ''} from ${files.size} source file${files.size > 1 ? 's' : ''}).`];
  for (const p of panels) {
    const s = p.source;
    const dims = `${s.width} × ${s.height} px, ${s.channels} channel${s.channels > 1 ? 's' : ''}` +
      (s.sizeZ > 1 ? `, ${s.sizeZ} Z slices` : '') + (s.sizeT > 1 ? `, ${s.sizeT} time frames` : '') + `, ${bitDepthText(s)}` +
      (p.pixelSizeUm != null ? `, ${p.pixelSizeUm} µm/px` : '');
    let text = `Panel ${p.panel}${p.inset ? ' (an inset)' : ''} shows ${s.fileName} (${dims})`;
    if (!p.crop.wholeImage) text += `, cropped to ${p.crop.width} × ${p.crop.height} px` +
      (p.fieldOfViewUm ? ` (${p.fieldOfViewUm.width} × ${p.fieldOfViewUm.height} µm)` : '');
    if (p.shapeMask) text += `, masked to ${/^[aeiou]/.test(p.shapeMask) ? 'an' : 'a'} ${p.shapeMask}`;
    const projection = projectionText(p.projection);
    if (projection) text += `, as a ${projection}`.replace('as a Z slice', 'showing Z slice').replace('as a time frame', 'at time frame');
    const shown = p.channels.filter(c => c.shown).map(c => `${c.name} in ${c.lut} (display range ${c.min}–${c.max}` +
      (c.gamma !== 1 ? `, gamma ${c.gamma}` : '') + (c.invert ? ', inverted' : '') + ')');
    text += shown.length ? `; ${list(shown)}` : '; no channel shown';
    if (p.brightness || p.contrast) text += `; brightness ${signed(p.brightness)} and contrast ${signed(p.contrast)} applied to the composite`;
    parts.push(text + '.');
  }
  const gamma = panels.some(p => p.channels.some(c => c.shown && c.gamma !== 1));
  parts.push(`Display ranges were applied as linear scaling between the minimum and maximum${gamma ? ', with the gamma stated' : ''}, to the whole image.` +
    ` Panels were exported at ${report.figure.dpi} dpi from the source pixels, averaged where a panel is printed smaller than its source region and never enlarged.`);
  return parts.join(' ');
}

const mdEscape = text => String(text).replace(/[\\`*_[\]<>|~]/g, ch => '\\' + ch).replace(/\r?\n/g, ' ');
const mdRow = cells => '| ' + cells.join(' | ') + ' |';

export function toMarkdown(report) {
  const f = report.figure, lines = [];
  lines.push(`# Figure report: ${mdEscape(f.name || 'Untitled figure')}`, '');
  lines.push(`${report.generator}. ${f.pages} page${f.pages > 1 ? 's' : ''}${f.page ? ` (this file: page ${f.page})` : ''} of ${f.widthPx} × ${f.heightPx} px at ${f.dpi} dpi (${f.widthMm} × ${f.heightMm} mm).`, '');
  lines.push('## Methods', '', mdEscape(methodsParagraph(report)), '');
  for (const p of report.panels) {
    const s = p.source, z = p.projection;
    lines.push(`## Panel ${p.panel}: ${mdEscape(s.fileName)}`, '');
    const rows = [
      ['Page', String(p.page) + (p.alsoOnPages ? ` (also ${p.alsoOnPages.join(', ')})` : '') + (p.inset ? ', inset' : '')],
      ['Source file', mdEscape(s.fileName)],
      ['SHA-256', s.sha256 ? '`' + s.sha256 + '`' : 'Unknown'],
      ['Format', mdEscape(s.format)],
      ['Source dimensions', `${s.width} × ${s.height} px, ${s.channels} channels, ${s.sizeZ} Z, ${s.sizeT} T`],
      ['Bit depth', bitDepthText(s)],
      ['Pixel size', p.pixelSizeUm != null ? `${p.pixelSizeUm} µm/px (${mdEscape(p.pixelSizeSource)})` : 'Not set'],
      ['Crop (source px)', `x ${p.crop.x}, y ${p.crop.y}, ${p.crop.width} × ${p.crop.height}` + (p.crop.wholeImage ? ' (whole image)' : '') +
        (p.fieldOfViewUm ? `; ${p.fieldOfViewUm.width} × ${p.fieldOfViewUm.height} µm` : '')],
      ['Shape mask', p.shapeMask ? mdEscape(p.shapeMask) : 'None'],
      ['Z / T', z ? mdEscape(projectionText(z) || 'Single plane') : 'Single plane'],
      ['Brightness / contrast', `${p.brightness} / ${p.contrast}`],
      ['Rotation', `${p.rotationDeg}°` + (p.flipped ? ', flipped' : '')],
      ['Printed size', `${p.printed.widthMm} × ${p.printed.heightMm} mm`],
      ['Effective resolution', `${p.effectivePpi.x} × ${p.effectivePpi.y} ppi (document ${f.dpi} dpi; exported as ${p.exportedPx.width} × ${p.exportedPx.height} px)` +
        (p.belowDocumentDpi ? ', below the document DPI' : '')]
    ];
    lines.push(mdRow(['Property', 'Value']), mdRow(['---', '---']), ...rows.map(mdRow), '');
    lines.push(mdRow(['Channel', 'Name', 'Shown', 'LUT', 'Min', 'Max', 'Gamma', 'Invert']), mdRow(Array(8).fill('---')));
    for (const c of p.channels) lines.push(mdRow([c.channel, mdEscape(c.name), c.shown ? 'yes' : 'no', mdEscape(c.lut), c.min, c.max, c.gamma, c.invert ? 'yes' : 'no']));
    lines.push('');
  }
  if (report.checkDismissals) {
    lines.push('## Dismissed figure checks', '', mdRow(['Severity', 'Finding', 'Note']), mdRow(['---', '---', '---']));
    for (const d of report.checkDismissals) lines.push(mdRow([mdEscape(d.severity), mdEscape(d.message), mdEscape(d.note || '(no note)')]));
    lines.push('');
  }
  return lines.join('\n');
}

export const CSV_COLUMNS = ['panel', 'page', 'inset', 'file', 'sha256', 'format', 'source_width', 'source_height', 'source_channels',
  'size_z', 'size_t', 'bit_depth', 'sample_type', 'pixel_size_um', 'pixel_size_source', 'crop_x', 'crop_y', 'crop_width', 'crop_height',
  'shape_mask', 'z_mode', 'z_first', 'z_last', 'frame', 'brightness', 'contrast', 'rotation_deg', 'flipped', 'printed_width_mm',
  'printed_height_mm', 'effective_ppi_x', 'effective_ppi_y', 'exported_width_px', 'exported_height_px', 'document_dpi',
  'channel', 'channel_name', 'shown', 'lut', 'min', 'max', 'gamma', 'invert'];

/** RFC 4180 field. Text from files that a spreadsheet would read as a formula is prefixed with '. */
function csvField(value, text) {
  let s = value == null ? '' : String(value);
  if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** One row per channel of each panel. */
export function toCSV(report) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const p of report.panels) for (const c of p.channels) {
    const s = p.source, z = p.projection;
    const cells = [[p.panel], [p.page], [p.inset], [s.fileName, 1], [s.sha256], [s.format, 1], [s.width], [s.height], [s.channels],
      [s.sizeZ], [s.sizeT], [Array.isArray(s.bitDepth) ? s.bitDepth.join('/') : s.bitDepth], [s.sampleType], [p.pixelSizeUm],
      [p.pixelSizeSource, 1], [p.crop.x], [p.crop.y], [p.crop.width], [p.crop.height], [p.shapeMask, 1], [z ? z.mode : ''],
      [z ? z.firstSlice : ''], [z ? z.lastSlice : ''], [z ? z.frame : ''], [p.brightness], [p.contrast], [p.rotationDeg], [p.flipped],
      [p.printed.widthMm], [p.printed.heightMm], [p.effectivePpi.x], [p.effectivePpi.y], [p.exportedPx.width], [p.exportedPx.height],
      [report.figure.dpi], [c.channel], [c.name, 1], [c.shown], [c.lut, 1], [c.min], [c.max], [c.gamma], [c.invert]];
    rows.push(cells.map(([v, text]) => csvField(v, text)).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

// ---- dialog ----
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = String(text);
  return el;
}
function button(id, text, title) {
  const b = element('button', null, text); b.type = 'button'; b.id = id; b.title = title; return b;
}

async function copyText(text, area) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { area.focus(); area.select(); try { return document.execCommand('copy'); } catch { return false; } }
}

/** Export menu → Figure report: the Methods paragraph to copy, and the report as Markdown, CSV or JSON. */
export function showReportDialog() {
  if (document.querySelector('.figure-report-backdrop')) return;
  if (!MFC.hasDocument) { MFC_UI.toast('Create or open a figure first.'); return; }
  const report = buildReport(), opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.getElementById('btn-export');
  const backdrop = element('div', 'modal-backdrop figure-report-backdrop');
  const dialog = element('div', 'modal figure-report-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'figure-report-title');
  const title = element('h2', null, 'Figure report'); title.id = 'figure-report-title';
  const summary = element('p', 'hint', report.panels.length
    ? `${report.panels.length} image panel${report.panels.length > 1 ? 's' : ''}: source files with their SHA-256, crop, projection, channel display settings and effective resolution at ${report.figure.dpi} dpi. SVG and PDF exports carry the same report as JSON.`
    : 'This figure has no image panels on its pages.');
  const label = element('label', null, 'Methods paragraph'); label.htmlFor = 'figure-report-methods';
  const area = element('textarea', 'figure-report-methods'); area.id = 'figure-report-methods'; area.readOnly = true; area.rows = 9;
  area.value = methodsParagraph(report);
  area.title = 'A paragraph for a Methods section, built from the figure. Check it before you use it.';
  const copy = button('figure-report-copy', 'Copy paragraph', 'Copy the Methods paragraph to the clipboard');
  const md = button('figure-report-md', 'Markdown', 'Download the report as Markdown (.md): every panel, with the Methods paragraph');
  const csv = button('figure-report-csv', 'CSV', 'Download the report as CSV (.csv): one row per channel of each panel');
  const json = button('figure-report-json', 'JSON', 'Download the report as JSON (.json), as embedded in SVG and PDF exports');
  const close = button('figure-report-close', 'Close', 'Close the figure report (Esc)');
  const downloads = element('div', 'btn-row figure-report-downloads');
  downloads.append(element('span', 'hint', 'Download:'), md, csv, json);
  const buttons = element('div', 'btn-row'); buttons.append(copy, close);
  dialog.append(title, summary, label, area, buttons, downloads);
  backdrop.append(dialog);

  const base = () => MFC_EXPORT.exportBaseName() + '_report';
  copy.addEventListener('click', async () => MFC_UI.toast(await copyText(area.value, area) ? 'Methods paragraph copied.' : 'Could not copy: select the text and copy it.'));
  md.addEventListener('click', () => MFC_EXPORT.download(new Blob([toMarkdown(report)], { type: 'text/markdown' }), base() + '.md'));
  csv.addEventListener('click', () => MFC_EXPORT.download(new Blob(['﻿' + toCSV(report)], { type: 'text/csv' }), base() + '.csv'));
  json.addEventListener('click', () => MFC_EXPORT.download(new Blob([toJSON(report)], { type: 'application/json' }), base() + '.json'));
  const done = () => { backdrop.remove(); if (opener && opener.focus) opener.focus(); };
  close.addEventListener('click', done);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) done(); });
  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); done(); return; }
    if (event.key !== 'Tab') return;
    const items = [area, copy, close, md, csv, json], first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.body.append(backdrop);
  copy.focus();
  // Firefox can ignore the first focus() on a dialog built in the same task; try again next frame.
  if (document.activeElement !== copy) requestAnimationFrame(() => { if (backdrop.isConnected && !dialog.contains(document.activeElement)) copy.focus(); });
}


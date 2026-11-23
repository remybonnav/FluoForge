/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Export dialog (Export ▸ Export…): format, pages, resolution, transparent background, TIFF
   compression and the figure report, with the figure check summary (never blocking). The choices
   are remembered until the page is closed. The export itself is MFC_EXPORT.exportWith. */

import { canvas, docProps } from '../core/state.js';
import { pageCount, pageIndexForBox } from '../core/pages.js';
import { checkFigure, dismissals, summaryText } from './figure-check.js';
import { summarize } from '../image/figure-check-rules.js';

export const FORMATS = {
  tiff: { label: 'TIFF (flattened RGB)', raster: true, transparent: true },
  png: { label: 'PNG', raster: true, transparent: true },
  svg: { label: 'SVG (vectors, editable in Inkscape or Illustrator)', raster: false, transparent: true },
  pdf: { label: 'PDF (vectors, fonts embedded)', raster: false, transparent: false }
};
/* Resolution units of the raster formats. dpi and ppi are the same number for a digital image (one
   pixel is one dot), and so are dpc and ppc. perInch converts the shown value to pixels per inch;
   tiff is the unit written in the TIFF's resolution tags (PNG always stores pixels per metre). */
export const RESOLUTION_UNITS = {
  dpi: { label: 'dpi', title: 'Dots per inch', perInch: 1, tiff: 'inch' },
  ppi: { label: 'ppi', title: 'Pixels per inch (the same number as dpi)', perInch: 1, tiff: 'inch' },
  dpc: { label: 'dpc', title: 'Dots per centimetre (dpi ÷ 2.54)', perInch: 2.54, tiff: 'cm' },
  ppc: { label: 'ppc', title: 'Pixels per centimetre (the same number as dpc)', perInch: 2.54, tiff: 'cm' }
};
const MIN_DPI = 30, MAX_DPI = 2400;
/** A resolution in pixels per inch, shown in `unit`: at most 2 decimals, no trailing zeros. */
export const dpiInUnit = (dpi, unit) => String(Number((dpi / RESOLUTION_UNITS[unit].perInch).toFixed(2)));
let last = { format: 'tiff', pages: 'all', range: '', dpi: null, unit: 'dpi', transparent: false, compression: 'deflate', includeReport: false };

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = String(text);
  return e;
}
function field(labelText, control, title) {
  const label = el('label', 'export-field'); label.title = title;
  label.append(el('span', null, labelText), control);
  return label;
}

/** The page the view is on (for "Current page"). */
function currentPage() {
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap || !canvas) return 0;
  const vpt = canvas.viewportTransform, mid = (wrap.scrollTop + wrap.clientHeight / 2 - 40 - vpt[5]) / vpt[3];
  const i = pageIndexForBox({ left: 0, top: mid - 1, width: 10, height: 2 });
  return i >= 0 ? i : 0;
}

/** The options the dialog's fields describe, or throws with a message for the user. */
export function readExportOptions(form) {
  const format = form.querySelector('#export-format').value, info = FORMATS[format], count = pageCount();
  const which = form.querySelector('input[name="export-pages"]:checked').value;
  const pages = which === 'all' ? null : which === 'current' ? [Number(form.dataset.currentPage) || 0] : MFC_EXPORT.parsePageRange(form.querySelector('#export-range').value, count);
  const unit = RESOLUTION_UNITS[form.querySelector('#export-dpi-unit').value] ? form.querySelector('#export-dpi-unit').value : 'dpi';
  const text = form.querySelector('#export-dpi').value.trim();
  const value = /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
  // Compared after rounding to 2 decimals in the unit, as the limits are shown (11.81 ppc is 30 dpi).
  const dpi = info.raster ? value * RESOLUTION_UNITS[unit].perInch : null, shown = Number(value.toFixed(2));
  if (info.raster && !(shown >= Number(dpiInUnit(MIN_DPI, unit)) && shown <= Number(dpiInUnit(MAX_DPI, unit))))
    throw new Error(`Enter a resolution between ${dpiInUnit(MIN_DPI, unit)} and ${dpiInUnit(MAX_DPI, unit)} ${unit}.`);
  return { format, pages, dpi: info.raster ? Math.min(MAX_DPI, Math.max(MIN_DPI, dpi)) : null, resolutionUnit: info.raster ? RESOLUTION_UNITS[unit].tiff : 'inch',
    transparent: info.transparent && form.querySelector('#export-transparent').checked,
    compression: form.querySelector('#export-compression').value, includeReport: form.querySelector('#export-report').checked };
}

/** Opens the export dialog. */
export function showExportDialog() {
  if (document.querySelector('.export-backdrop')) return;
  if (!MFC.hasDocument) { MFC_UI.toast('Create or open a figure first.'); return; }
  const opener = document.getElementById('btn-export');
  const backdrop = el('div', 'modal-backdrop export-backdrop'), dialog = el('form', 'modal export-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'export-title');
  dialog.noValidate = true; // the dialog checks its fields itself and says what is wrong
  dialog.dataset.currentPage = String(currentPage());
  const title = el('h2', null, 'Export'); title.id = 'export-title';

  const format = el('select'); format.id = 'export-format';
  for (const [value, f] of Object.entries(FORMATS)) { const o = el('option', null, f.label); o.value = value; format.append(o); }
  format.value = last.format;

  const pagesBox = el('fieldset', 'export-pages'); pagesBox.append(el('legend', null, 'Pages'));
  const count = pageCount();
  for (const [value, text] of [['all', `All (${count})`], ['current', `Current page (${Number(dialog.dataset.currentPage) + 1})`], ['range', 'Pages:']]) {
    const label = el('label'), radio = el('input'); radio.type = 'radio'; radio.name = 'export-pages'; radio.value = value; radio.id = 'export-pages-' + value;
    radio.checked = last.pages === value; label.append(radio, document.createTextNode(' ' + text)); pagesBox.append(label);
  }
  const range = el('input'); range.type = 'text'; range.id = 'export-range'; range.placeholder = 'e.g. 1-3, 5'; range.value = last.range;
  range.setAttribute('aria-label', 'Pages to export, for example 1-3, 5'); range.title = 'Pages to export, for example 1-3, 5';
  range.addEventListener('input', () => { dialog.querySelector('#export-pages-range').checked = true; });
  pagesBox.lastElementChild.append(range);
  pagesBox.title = 'Which pages to export. PDF puts them in one file; TIFF, PNG and SVG write one file per page';

  const dpi = el('input'); dpi.type = 'number'; dpi.id = 'export-dpi';
  dpi.title = 'Resolution of the TIFF or PNG, in the unit chosen next to it'; dpi.setAttribute('aria-label', 'Resolution');
  const unit = el('select'); unit.id = 'export-dpi-unit';
  unit.title = 'Resolution unit: dpi = ppi (per inch), dpc = ppc (per centimetre). Changing it converts the value';
  unit.setAttribute('aria-label', 'Resolution unit');
  for (const [value, u] of Object.entries(RESOLUTION_UNITS)) { const o = el('option', null, u.label); o.value = value; o.title = u.title; unit.append(o); }
  unit.value = RESOLUTION_UNITS[last.unit] ? last.unit : 'dpi';
  /** Limits and step of the number field in the current unit. */
  const setLimits = () => { dpi.min = dpiInUnit(MIN_DPI, unit.value); dpi.max = dpiInUnit(MAX_DPI, unit.value); dpi.step = RESOLUTION_UNITS[unit.value].perInch === 1 ? '1' : '0.01'; };
  setLimits(); dpi.value = dpiInUnit(last.dpi || docProps.dpi, unit.value);
  let unitShown = unit.value;
  unit.addEventListener('change', () => {
    // Keep the same resolution: convert what is typed from the previous unit (left as is if unreadable).
    const typed = Number(dpi.value);
    if (dpi.value.trim() !== '' && Number.isFinite(typed)) dpi.value = dpiInUnit(typed * RESOLUTION_UNITS[unitShown].perInch, unit.value);
    unitShown = unit.value; setLimits(); sync();
  });
  const resolution = el('span', 'export-resolution'); resolution.append(dpi, unit);
  const transparent = el('input'); transparent.type = 'checkbox'; transparent.id = 'export-transparent'; transparent.checked = last.transparent;
  const compression = el('select'); compression.id = 'export-compression';
  for (const [value, text] of [['deflate', 'Deflate (smallest)'], ['lzw', 'LZW'], ['none', 'None']]) { const o = el('option', null, text); o.value = value; compression.append(o); }
  compression.value = last.compression;
  const report = el('input'); report.type = 'checkbox'; report.id = 'export-report'; report.checked = last.includeReport;

  const dpiField = field('Resolution', resolution, 'Pixels per inch (dpi, ppi) or per centimetre (dpc, ppc) of the TIFF or PNG. Images are recomposited from their source and never enlarged beyond their source pixels');
  const transparentField = field('Transparent background', transparent, 'Leave the page background transparent instead of white (TIFF with alpha, PNG, SVG)');
  const compressionField = field('TIFF compression', compression, 'Lossless compression of the TIFF: Deflate is smallest, LZW is read by older software, None writes raw pixels');
  const reportField = field('Include the figure report', report, 'Also save the figure report (Methods and adjustments) as Markdown and JSON next to the export');
  const note = el('p', 'hint export-note');
  const sync = () => {
    const f = FORMATS[format.value];
    dpi.disabled = !f.raster; unit.disabled = !f.raster; transparent.disabled = !f.transparent; compression.disabled = format.value !== 'tiff';
    compressionField.hidden = format.value !== 'tiff';
    note.textContent = f.raster ? (unit.value === 'dpi' ? `${docProps.dpi} dpi is the document's resolution.`
      : `${dpiInUnit(docProps.dpi, unit.value)} ${unit.value} (${docProps.dpi} dpi) is the document's resolution.`) :
      format.value === 'pdf' ? 'PDF keeps text and shapes as vectors; images are embedded at the document resolution. Its background is white.' :
      'SVG keeps text and shapes as vectors; images are embedded at the document resolution.';
  };
  format.addEventListener('change', sync);

  const s = summarize(checkFigure(), dismissals());
  const check = el('p', 'export-check-line' + (s.error ? ' has-errors' : ''), 'Figure check: ' + summaryText(s) + ' Exporting is never blocked.');
  check.setAttribute('role', 'status');
  const error = el('p', 'export-error'); error.setAttribute('role', 'alert');
  const ok = el('button', 'primary-button', 'Export'); ok.type = 'submit'; ok.id = 'export-ok'; ok.title = 'Export with these settings';
  const cancel = el('button', null, 'Cancel'); cancel.type = 'button'; cancel.id = 'export-cancel'; cancel.title = 'Close without exporting (Esc)';
  const buttons = el('div', 'btn-row'); buttons.append(cancel, ok);
  dialog.append(title, field('Format', format, 'File format'), pagesBox, dpiField, transparentField, compressionField, reportField, note, check, error, buttons);
  backdrop.append(dialog);
  sync();

  const done = () => { backdrop.remove(); if (opener && opener.focus) opener.focus(); };
  dialog.addEventListener('submit', async event => {
    event.preventDefault();
    let options;
    try { options = readExportOptions(dialog); } catch (e) { error.textContent = e.message; return; }
    last = { format: options.format, pages: dialog.querySelector('input[name="export-pages"]:checked').value, range: range.value,
      dpi: options.dpi || last.dpi, unit: unit.value, transparent: transparent.checked, compression: compression.value, includeReport: report.checked };
    done();
    await MFC_EXPORT.exportWith(options);
  });
  cancel.addEventListener('click', done);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) done(); });
  backdrop.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); done(); return; }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('input:not([disabled]), select:not([disabled]), button')].filter(e => !e.closest('[hidden]'));
    const first = items[0], lastItem = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); lastItem.focus(); }
    else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); first.focus(); }
  });
  document.body.append(backdrop);
  format.focus();
  if (document.activeElement !== format) requestAnimationFrame(() => { if (backdrop.isConnected) format.focus(); });
}

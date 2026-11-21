/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Copy for other software (Export ▸ Copy for other software…, Ctrl+Shift+C): puts the current page
   or the selection on the system clipboard, to paste into PowerPoint, Word, Keynote, Inkscape,
   Illustrator, Figma or an e-mail.
   - Vector picture: image/svg+xml (where the browser can write it: Chrome and Edge 124+).
   - Bitmap: image/png at the chosen resolution, with its DPI.
   - Both: SVG and PNG in one clipboard item; each program takes the format it reads.
   - SVG code: the SVG source as text (Figma, Inkscape and Illustrator turn pasted SVG code into vectors).
   The clipboard write starts inside the click, with the files as promises, because browsers only
   allow it during a user action and building a figure takes a moment. It is the same rendering as
   Export (recomposited from the source data), so nothing is copied from the screen preview. */

import { canvas } from '../core/state.js';
import { pageIndexForBox } from '../core/pages.js';

export const COPY_FORMATS = {
  svg: { label: 'Vector picture (SVG)', help: 'For PowerPoint, Word, Keynote, Inkscape and Illustrator: stays sharp at any size' },
  png: { label: 'Bitmap (PNG)', help: 'For any program, slides and e-mail: pixels at the resolution below' },
  both: { label: 'Both (SVG and PNG)', help: 'Puts both on the clipboard; each program pastes the format it reads' },
  'svg-text': { label: 'SVG code (text)', help: 'The SVG source as text: Figma, Inkscape and Illustrator paste it as editable vectors' }
};
let last = { format: 'both', dpi: null, transparent: false };

/** Whether the browser can put this type on the clipboard. */
export function canWrite(type) {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem === 'undefined') return type === 'text/plain' && !!(navigator.clipboard && navigator.clipboard.writeText);
  if (typeof ClipboardItem.supports === 'function') return ClipboardItem.supports(type);
  return type === 'image/png' || type === 'text/plain' || type === 'text/html';
}

/** The selected top-level objects and their box in document px (rounded outwards), or null. */
export function selectionArea() {
  const active = canvas && canvas.getActiveObject();
  if (!active) return null;
  const objects = (active.type === 'activeSelection' ? active.getObjects() : [active]).filter(o => o.mfcId && !o.mfcIsPageBounds);
  if (!objects.length) return null;
  const box = active.getBoundingRect(true, true);
  const left = Math.floor(box.left), top = Math.floor(box.top);
  return { only: new Set(objects.map(o => o.mfcId)), bounds: { left, top, width: Math.ceil(box.left + box.width) - left, height: Math.ceil(box.top + box.height) - top }, count: objects.length };
}

/** The page the view shows. */
export function visiblePage() {
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap || !canvas) return 0;
  const vpt = canvas.viewportTransform, mid = (wrap.scrollTop + wrap.clientHeight / 2 - 40 - vpt[5]) / vpt[3];
  const i = pageIndexForBox({ left: 0, top: mid - 1, width: 10, height: 2 });
  return i >= 0 ? i : 0;
}

/** Starts the clipboard write; call it inside the click. options: { scope: 'page' | 'selection',
    page, format: 'svg' | 'png' | 'both' | 'svg-text', dpi, transparent }. Resolves to
    { types, note } once the clipboard holds the figure; rejects with a message for the user. */
export function copyFigure({ scope = 'page', page = visiblePage(), format = 'both', dpi = null, transparent = false } = {}) {
  if (!MFC.hasDocument) return Promise.reject(new Error('Create or open a figure first.'));
  if (!navigator.clipboard) return Promise.reject(new Error('This page cannot use the clipboard: browsers allow it only on https:// or localhost pages. Use Export instead, or open FluoForge from a web address.'));
  if (!COPY_FORMATS[format]) return Promise.reject(new Error('Unknown format: ' + format));
  let area = null;
  if (scope === 'selection') { area = selectionArea(); if (!area) return Promise.reject(new Error('Select the objects to copy first.')); }
  const where = area ? { bounds: area.bounds, only: area.only } : { page };
  let svgPromise = null;
  const svgText = () => (svgPromise ||= MFC_EXPORT.buildSVG({ ...where, transparent }).then(out => out.svg));
  const svgBlob = () => svgText().then(text => new Blob([text], { type: 'image/svg+xml' }));
  const pngBlob = () => MFC_EXPORT.buildPNG({ ...where, dpi, transparent }).then(out => out.blob);
  const items = {}, notes = [];
  const wantSvg = format === 'svg' || format === 'both';
  if (wantSvg && canWrite('image/svg+xml')) items['image/svg+xml'] = svgBlob();
  if (format === 'png' || format === 'both') {
    if (!canWrite('image/png')) return Promise.reject(new Error('This browser cannot put pictures on the clipboard. Use Export ▸ Export PNG instead.'));
    items['image/png'] = pngBlob();
  }
  if (format === 'svg-text' || (wantSvg && !items['image/svg+xml'])) {
    if (wantSvg) notes.push(format === 'both' ? 'This browser cannot copy SVG pictures, so the PNG is on the clipboard.' : 'This browser cannot copy SVG pictures (Chrome and Edge can); the SVG code was copied as text instead: Figma, Inkscape and Illustrator paste it as vectors.');
    if (format !== 'both') items['text/plain'] = svgText().then(text => new Blob([text], { type: 'text/plain' }));
  }
  const types = Object.keys(items);
  let write;
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') write = navigator.clipboard.write([new ClipboardItem(items)]);
  else if (types.length === 1 && types[0] === 'text/plain') write = svgText().then(text => navigator.clipboard.writeText(text));
  else return Promise.reject(new Error('This browser cannot put pictures on the clipboard. Use Export instead.'));
  write.catch(() => {}); // handled below; avoids an unhandled rejection when building fails first
  // Building can fail (an unsupported font in the figure): report that, not the clipboard's generic error.
  return Promise.all(Object.values(items)).then(() => write).then(() => ({ types, note: notes.join(' ') }), error =>
    Promise.all(Object.values(items)).then(() => { throw new Error('The clipboard refused the figure (' + (error && error.message || error) + '). Click Copy again, or use Export.'); }));
}

// ---- dialog ----
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = String(text);
  return e;
}
const describe = types => types.map(t => ({ 'image/svg+xml': 'SVG picture', 'image/png': 'PNG', 'text/plain': 'SVG code' })[t] || t).join(' and ');

/** Opens the dialog. options: { scope: 'page' | 'selection', page } choose what it starts with
    (default: the selection when there is one, and the page in view). */
export function showCopyDialog({ scope = null, page: chosenPage = null } = {}) {
  if (document.querySelector('.copy-backdrop')) return;
  if (!MFC.hasDocument) { MFC_UI.toast('Create or open a figure first.'); return; }
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.getElementById('btn-copy-external');
  const selection = selectionArea(), page = Number.isInteger(chosenPage) ? chosenPage : visiblePage();
  const startWith = scope === 'page' || !selection ? 'page' : 'selection';
  const backdrop = el('div', 'modal-backdrop copy-backdrop'), dialog = el('form', 'modal copy-modal');
  dialog.noValidate = true;
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'copy-title');
  const title = el('h2', null, 'Copy for other software'); title.id = 'copy-title';
  const intro = el('p', 'hint', 'Copies the figure to the clipboard, rendered from the source data like an export. Paste it into PowerPoint, Word, Keynote, Inkscape, Illustrator, Figma or an e-mail.');

  const scopeBox = el('fieldset', 'copy-choices'); scopeBox.append(el('legend', null, 'What'));
  scopeBox.title = 'Copy the page you are looking at, or only the selected objects (cropped to them)';
  for (const [value, text, disabled] of [['page', `Page ${page + 1}`, false], ['selection', selection ? `Selection (${selection.count} object${selection.count > 1 ? 's' : ''})` : 'Selection (nothing selected)', !selection]]) {
    const label = el('label'), radio = el('input'); radio.type = 'radio'; radio.name = 'copy-scope'; radio.value = value; radio.id = 'copy-scope-' + value; radio.disabled = disabled;
    radio.checked = value === startWith; // with a selection, copying it is the likely intent
    label.append(radio, document.createTextNode(' ' + text)); scopeBox.append(label);
  }
  const formatBox = el('fieldset', 'copy-choices copy-formats'); formatBox.append(el('legend', null, 'As'));
  for (const [value, f] of Object.entries(COPY_FORMATS)) {
    const label = el('label'), radio = el('input'); radio.type = 'radio'; radio.name = 'copy-format'; radio.value = value; radio.id = 'copy-format-' + value;
    radio.checked = value === last.format; label.title = f.help;
    const unsupported = (value === 'svg' && !canWrite('image/svg+xml')) ? ' (as SVG code in this browser)' : '';
    label.append(radio, document.createTextNode(' ' + f.label + unsupported)); formatBox.append(label);
  }
  const dpi = el('input'); dpi.type = 'number'; dpi.id = 'copy-dpi'; dpi.min = '30'; dpi.max = '1200'; dpi.step = '1'; dpi.value = String(last.dpi || MFC.getDocProps().dpi);
  const dpiField = el('label', 'export-field'); dpiField.title = 'Resolution of the PNG; images are recomposited from their source and never enlarged beyond it';
  dpiField.append(el('span', null, 'PNG resolution (dpi)'), dpi);
  const transparent = el('input'); transparent.type = 'checkbox'; transparent.id = 'copy-transparent'; transparent.checked = last.transparent;
  const transparentField = el('label', 'export-field'); transparentField.title = 'Leave the background transparent instead of white';
  transparentField.append(el('span', null, 'Transparent background'), transparent);
  const status = el('p', 'copy-status'); status.setAttribute('role', 'status');
  const ok = el('button', 'primary-button', 'Copy'); ok.type = 'submit'; ok.id = 'copy-ok'; ok.title = 'Copy to the clipboard with these settings';
  const close = el('button', null, 'Close'); close.type = 'button'; close.id = 'copy-close'; close.title = 'Close (Esc)';
  const buttons = el('div', 'btn-row'); buttons.append(close, ok);
  dialog.append(title, intro, scopeBox, formatBox, dpiField, transparentField, status, buttons);
  backdrop.append(dialog);
  const sync = () => { const f = dialog.querySelector('input[name="copy-format"]:checked').value; dpi.disabled = !(f === 'png' || f === 'both'); };
  formatBox.addEventListener('change', sync); sync();

  const done = () => { backdrop.remove(); if (opener && opener.focus) opener.focus(); };
  dialog.addEventListener('submit', event => {
    event.preventDefault();
    const format = dialog.querySelector('input[name="copy-format"]:checked').value, scope = dialog.querySelector('input[name="copy-scope"]:checked').value;
    const d = parseInt(dpi.value, 10);
    if ((format === 'png' || format === 'both') && !(d >= 30 && d <= 1200)) { status.className = 'copy-status copy-error'; status.textContent = 'Enter a resolution between 30 and 1200 dpi.'; return; }
    last = { format, dpi: d || last.dpi, transparent: transparent.checked };
    status.className = 'copy-status'; status.textContent = 'Copying…'; ok.disabled = true;
    copyFigure({ scope, page, format, dpi: d, transparent: transparent.checked }).then(({ types, note }) => {
      status.textContent = `Copied ${describe(types)}. Paste it in the other program (Ctrl+V).` + (note ? ' ' + note : '');
      MFC_UI.toast('Figure copied: ' + describe(types) + '.');
    }, error => { status.className = 'copy-status copy-error'; status.textContent = error.message; })
      .finally(() => { ok.disabled = false; });
  });
  close.addEventListener('click', done);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) done(); });
  backdrop.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); done(); return; }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('input:not([disabled]), button:not([disabled])')], first = items[0], lastItem = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); lastItem.focus(); }
    else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); first.focus(); }
  });
  document.body.append(backdrop);
  ok.focus();
  if (document.activeElement !== ok) requestAnimationFrame(() => { if (backdrop.isConnected) ok.focus(); });
}

document.getElementById('btn-copy-external')?.addEventListener('click', () => showCopyDialog());

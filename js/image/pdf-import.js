/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* A PDF page as a panel (P3-T10), the fallback when a plot is only available as PDF: the page is
   rasterised at the document's dpi by pdf.js (assets/vendor/pdfjs, loaded only now) and becomes an
   ordinary image panel at the page's size on paper. It is clearly labelled: its name says "rasterised
   at N dpi", it carries `mfcRasterised` { from: 'pdf', file, page, pages, dpi }, the figure check lists
   it, and a message says how to keep a plot vector (export it as SVG). The PNG of the page, not the
   PDF, is the project source. */

import { docProps } from '../core/state.js';
import { addImageToCanvas } from './import.js';
import { pdfRaster } from './vector-model.js';

const BASE = new URL('assets/vendor/pdfjs/', document.baseURI).href;
/** The most pixels a rasterised page may have (10 000 × 10 000). */
export const MAX_PIXELS = 100e6;
let library = null;

/** pdf.js, loaded on first use, its worker from the same folder. */
function pdfjs() {
  if (!library) {
    library = import(BASE + 'pdf.min.mjs').then(lib => { lib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs'; return lib; });
    library.catch(() => { library = null; });
  }
  return library;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = String(text);
  return e;
}

/** Asks which page of a `pages`-page PDF to import: resolves to its number, or null when cancelled. */
export function askPage(name, pages, dpi) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    const backdrop = el('div', 'modal-backdrop pdf-page-backdrop'), dialog = el('form', 'modal export-modal pdf-page-modal');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'pdf-page-title');
    dialog.noValidate = true;
    const title = el('h2', null, 'Import a PDF page'); title.id = 'pdf-page-title';
    const intro = el('p', 'hint', `${name} has ${pages} pages. The page you choose is rasterised at the document's ${dpi} dpi and becomes an image panel: it does not stay vector. To keep a plot vector, export it as SVG and import that instead.`);
    const input = el('input'); input.type = 'number'; input.id = 'pdf-page'; input.min = '1'; input.max = String(pages); input.step = '1'; input.value = '1';
    input.title = `The page to import (1 to ${pages})`;
    const label = el('label', 'export-field'); label.title = input.title; label.append(el('span', null, 'Page'), input);
    const error = el('p', 'export-error'); error.setAttribute('role', 'alert');
    const ok = el('button', 'primary-button', 'Import page'); ok.type = 'submit'; ok.id = 'pdf-page-ok'; ok.title = 'Rasterise this page and add it as an image panel';
    const cancel = el('button', null, 'Cancel'); cancel.type = 'button'; cancel.id = 'pdf-page-cancel'; cancel.title = 'Close without importing (Esc)';
    const buttons = el('div', 'btn-row'); buttons.append(cancel, ok);
    dialog.append(title, intro, label, error, buttons);
    backdrop.append(dialog);
    const close = value => { backdrop.remove(); if (opener && opener.focus) opener.focus(); resolve(value); };
    const read = () => { const n = Number(input.value); return Number.isInteger(n) && n >= 1 && n <= pages ? n : null; };
    input.addEventListener('input', () => { const n = read(); error.textContent = n ? '' : `Enter a page between 1 and ${pages}.`; ok.disabled = !n; });
    dialog.addEventListener('submit', event => { event.preventDefault(); const n = read(); if (n) close(n); });
    cancel.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(null); });
    backdrop.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(null); return; }
      if (event.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll('input:not([disabled]), button:not([disabled])')];
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    });
    document.body.append(backdrop);
    input.focus(); input.select();
  });
}

/** Page `number` of the PDF `doc` (pdf.js) drawn at `dpi` on a white canvas. */
export async function renderPage(doc, number, dpi, name = 'The PDF') {
  const page = await doc.getPage(number);
  const base = page.getViewport({ scale: 1 }), size = pdfRaster(base.width, base.height, dpi);
  if (size.width * size.height > MAX_PIXELS)
    throw new Error(`Page ${number} of ${name} would be ${size.width} × ${size.height} pixels at ${dpi} dpi, too large to rasterise. Export the plot as SVG instead, or lower the document's dpi.`);
  const viewport = page.getViewport({ scale: size.scale });
  const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport, transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0] }).promise;
  page.cleanup();
  return canvas;
}

/**
 * Imports one page of the PDF file `file` as a rasterised image panel at the document's dpi. With
 * several pages, a dialog asks which (or `page` says). Resolves to the panel, or null when cancelled.
 */
export async function importPDF(file, { page = null } = {}) {
  const name = file.name || 'document.pdf';
  const lib = await pdfjs();
  let doc;
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, enableXfa: false,
      standardFontDataUrl: BASE + 'standard_fonts/', useSystemFonts: false, disableAutoFetch: true, stopAtErrors: false, verbosity: 0 });
  try {
    doc = await task.promise;
  } catch (error) {
    task.destroy();
    throw new Error(error && error.name === 'PasswordException' ? `${name} is protected by a password: open it, save it without one, and import it again.`
      : `${name} is not a readable PDF file (${error && error.message ? error.message : 'unknown error'}).`);
  }
  try {
    const dpi = docProps.dpi || 300, pages = doc.numPages;
    const number = page ?? (pages === 1 ? 1 : await askPage(name, pages, dpi));
    if (number == null) return null;
    if (!(Number.isInteger(number) && number >= 1 && number <= pages)) throw new Error(`${name} has no page ${number}: it has ${pages}.`);
    const canvas = await renderPage(doc, number, dpi, name);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the page.'))), 'image/png'));
    const base = name.replace(/\.pdf$/i, '');
    const png = new File([blob], `${base} page ${number} (${dpi} dpi).png`, { type: 'image/png' });
    const raw = await MFC_TIFF.decodeRasterImage(png);
    const label = `${name}, page ${number} (rasterised at ${dpi} dpi)`;
    raw.fileName = label;
    await addImageToCanvas(raw, png, { props: { mfcRasterised: { from: 'pdf', file: name, page: number, pages, dpi } }, physical: true });
    MFC_UI.toast(`Page ${number} of ${name} was rasterised at ${dpi} dpi: it is an image, not vector. For a plot that stays vector in SVG and PDF export, export it as SVG and import that.`);
    return MFC.getCanvas().getActiveObject();
  } finally {
    task.destroy(); // the document and its worker
  }
}

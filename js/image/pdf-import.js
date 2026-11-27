/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* A PDF page as a panel. pdf.js (assets/vendor/pdfjs, loaded only now) reads the file.
   - By default (P3-T10a) the page is converted to SVG (js/image/pdf-vector.js) and becomes a vector
     panel like an SVG plot: it stays vector in SVG and PDF export. Its project source is that SVG, so
     any version that opens vector panels (0.1.39 on) opens it; `mfcConverted` { from: 'pdf', file,
     page, pages } records where it came from.
   - The fallback (P3-T10): the page rasterised at the document's dpi, an ordinary image panel at the
     page's size on paper, clearly labelled: its name says "rasterised at N dpi", it carries
     `mfcRasterised` { from: 'pdf', file, page, pages, dpi }, the figure check lists it, and a message
     says so. It is offered when the conversion cannot reproduce the page, or chosen in the dialog. */

import { docProps } from '../core/state.js';
import { addImageToCanvas } from './import.js';
import { pdfRaster } from './vector-model.js';
import { pageToSVG } from './pdf-vector.js';
import { addVectorToCanvas } from './vector.js';

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

/**
 * The PDF import dialog. With `issues` (what the vector import of page `page` could not reproduce), it
 * offers the page as a rasterised image instead and resolves to true, or null when cancelled.
 * Otherwise it asks which of the `pages` pages and how (vector, or an image rasterised at `dpi`):
 * resolves to { page, as: 'vector' | 'image' }, or null when cancelled.
 */
export function askPDF({ name, pages, dpi, issues = null, page = 1 }) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    const backdrop = el('div', 'modal-backdrop pdf-page-backdrop'), dialog = el('form', 'modal export-modal pdf-page-modal');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'pdf-page-title');
    dialog.noValidate = true;
    const error = el('p', 'export-error'); error.setAttribute('role', 'alert');
    const ok = el('button', 'primary-button'); ok.type = 'submit'; ok.id = 'pdf-page-ok';
    const cancel = el('button', null, 'Cancel'); cancel.type = 'button'; cancel.id = 'pdf-page-cancel'; cancel.title = 'Close without importing (Esc)';
    const buttons = el('div', 'btn-row'); buttons.append(cancel, ok);
    let input = null, how = null, read;
    if (issues) {
      const title = el('h2', null, 'Import this PDF page as an image?'); title.id = 'pdf-page-title';
      const where = pages > 1 ? `Page ${page} of ${name}` : name;
      const intro = el('p', 'hint', `${where} uses things the vector import cannot reproduce faithfully:`);
      const list = el('ul', 'pdf-issues'); for (const issue of issues) list.append(el('li', null, issue));
      const after = el('p', 'hint', `It can be imported as an image instead: rasterised at the document's ${dpi} dpi and labelled as rasterised. It will not stay vector.`);
      ok.textContent = 'Import as image'; ok.title = `Rasterise the page at ${dpi} dpi and add it as an image panel`;
      dialog.append(title, intro, list, after, error, buttons);
      read = () => true;
    } else {
      const title = el('h2', null, 'Import a PDF page'); title.id = 'pdf-page-title';
      const intro = el('p', 'hint', `${pages > 1 ? `${name} has ${pages} pages. ` : ''}As vector, the page stays sharp in SVG and PDF export, like an SVG plot. As an image, it is rasterised at the document's ${dpi} dpi.`);
      dialog.append(title, intro);
      if (pages > 1) {
        input = el('input'); input.type = 'number'; input.id = 'pdf-page'; input.min = '1'; input.max = String(pages); input.step = '1'; input.value = String(page);
        input.title = `The page to import (1 to ${pages})`;
        const label = el('label', 'export-field'); label.title = input.title; label.append(el('span', null, 'Page'), input);
        dialog.append(label);
      }
      how = el('select'); how.id = 'pdf-as';
      how.title = 'Vector keeps lines and text sharp at any size; an image is rasterised at the document dpi';
      for (const [value, text] of [['vector', 'Vector (stays sharp)'], ['image', `Image, rasterised at ${dpi} dpi`]]) { const o = el('option', null, text); o.value = value; how.append(o); }
      const howLabel = el('label', 'export-field'); howLabel.title = how.title; howLabel.append(el('span', null, 'Import as'), how);
      ok.textContent = 'Import page'; ok.title = 'Add the page as a panel';
      dialog.append(howLabel, error, buttons);
      read = () => {
        const n = input ? Number(input.value) : 1;
        return Number.isInteger(n) && n >= 1 && n <= pages ? { page: n, as: how.value } : null;
      };
      if (input) input.addEventListener('input', () => { const n = read(); error.textContent = n ? '' : `Enter a page between 1 and ${pages}.`; ok.disabled = !n; });
    }
    backdrop.append(dialog);
    const close = value => { backdrop.remove(); if (opener && opener.focus) opener.focus(); resolve(value); };
    dialog.addEventListener('submit', event => { event.preventDefault(); const v = read(); if (v) close(v); });
    cancel.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(null); });
    backdrop.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(null); return; }
      if (event.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll('input:not([disabled]), select:not([disabled]), button:not([disabled])')];
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    });
    document.body.append(backdrop);
    if (input) { input.focus(); input.select(); } else if (how) how.focus(); else ok.focus();
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

/** pdf.js's document for a PDF file; its glyph outlines are kept for the vector import. */
async function openPDF(lib, file, name) {
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, enableXfa: false,
      standardFontDataUrl: BASE + 'standard_fonts/', useSystemFonts: false, disableAutoFetch: true, stopAtErrors: false, verbosity: 0,
      disableFontFace: true, fontExtraProperties: true });
  try {
    return { task, doc: await task.promise };
  } catch (error) {
    task.destroy();
    throw new Error(error && error.name === 'PasswordException' ? `${name} is protected by a password: open it, save it without one, and import it again.`
      : `${name} is not a readable PDF file (${error && error.message ? error.message : 'unknown error'}).`);
  }
}

/**
 * Imports one page of the PDF file `file` as a panel. By default it is converted to SVG and becomes a
 * vector panel (P3-T10a). When the page uses something the conversion cannot reproduce, a dialog
 * offers it as an image rasterised at the document's dpi instead (the labelled fallback, P3-T10).
 * With several pages a dialog asks which, and how. `page` and `as` ('vector' | 'image') skip the
 * dialog; `as: 'vector'` throws instead of offering an image. Resolves to the panel, or null when cancelled.
 */
export async function importPDF(file, { page = null, as = null } = {}) {
  const name = file.name || 'document.pdf';
  const lib = await pdfjs();
  const { task, doc } = await openPDF(lib, file, name);
  try {
    const dpi = docProps.dpi || 300, pages = doc.numPages;
    let number = page, mode = as;
    if (number == null && pages > 1) {
      const choice = await askPDF({ name, pages, dpi });
      if (!choice) return null;
      number = choice.page; mode = mode || choice.as;
    }
    number = number ?? 1; mode = mode || 'vector';
    if (!(Number.isInteger(number) && number >= 1 && number <= pages)) throw new Error(`${name} has no page ${number}: it has ${pages}.`);
    let issues = null;
    if (mode === 'vector') {
      const pdfPage = await doc.getPage(number);
      const result = await pageToSVG(lib, doc, pdfPage);
      pdfPage.cleanup();
      if (!result.issues.length) {
        // The source is the SVG, named like the panel (the file it came from, and its page).
        const label = pages > 1 ? `${name}, page ${number}` : name;
        const svg = new File([result.svg], label, { type: 'image/svg+xml' });
        return await addVectorToCanvas(svg, { name: label, what: pages > 1 ? `Page ${number} of ${name}` : name,
          props: { mfcConverted: { from: 'pdf', file: name, page: number, pages } } });
      }
      issues = result.issues;
      const where = pages > 1 ? `Page ${number} of ${name}` : name;
      if (as === 'vector') throw new Error(`${where} cannot be imported as vector: it uses ${issues.join(', ')}.`);
      if (!await askPDF({ name, pages, dpi, issues, page: number })) return null;
    }
    const canvas = await renderPage(doc, number, dpi, name);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the page.'))), 'image/png'));
    const base = name.replace(/\.pdf$/i, '');
    const png = new File([blob], `${base} page ${number} (${dpi} dpi).png`, { type: 'image/png' });
    const raw = await MFC_TIFF.decodeRasterImage(png);
    const label = `${name}, page ${number} (rasterised at ${dpi} dpi)`;
    raw.fileName = label;
    await addImageToCanvas(raw, png, { props: { mfcRasterised: { from: 'pdf', file: name, page: number, pages, dpi } }, physical: true });
    MFC_UI.toast(`Page ${number} of ${name} was rasterised at ${dpi} dpi: it is an image, not vector.` +
      (issues ? ` The vector import could not reproduce its ${issues.join(', ')}.` : ' Import it as vector (the default) to keep it sharp in SVG and PDF export.'));
    return MFC.getCanvas().getActiveObject();
  } finally {
    task.destroy(); // the document and its worker
  }
}

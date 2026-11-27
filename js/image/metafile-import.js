/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* EMF and WMF files as vector panels (P3-T10b). js/image/metafile.js plays the file into SVG; this
   reads the file (.emz and .wmz are gzipped), turns its bitmaps into PNG, and adds the SVG as a vector
   panel (js/image/vector.js). Its project source is that SVG, so any version that opens vector panels
   (0.1.39 on) opens it; `mfcConverted` { from: 'emf' | 'wmf', file } records where it came from.
   When the file uses something the conversion cannot reproduce, a dialog lists it before anything is
   added: import anyway (the panel then lists it in `mfcConverted.missing`), or cancel. */

import { metafileToSVG } from './metafile.js';
import { addVectorToCanvas } from './vector.js';

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 16384) s += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(s);
}

/** A decoded bitmap (metafile.js) as a data URL: an embedded JPEG or PNG as it is, pixels as PNG of the source rectangle. */
export function bitmapURL(img, src) {
  if (img.mime) return `data:${img.mime};base64,${base64(img.bytes)}`;
  const full = document.createElement('canvas'); full.width = img.width; full.height = img.height;
  full.getContext('2d').putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
  const x = Math.max(0, Math.min(src.x, src.x + src.width)), y = Math.max(0, Math.min(src.y, src.y + src.height));
  const w = Math.min(img.width - x, Math.abs(src.width) || img.width), h = Math.min(img.height - y, Math.abs(src.height) || img.height);
  if (w <= 0 || h <= 0) return null;
  if (x === 0 && y === 0 && w === img.width && h === img.height) return full.toDataURL('image/png');
  const part = document.createElement('canvas'); part.width = w; part.height = h;
  part.getContext('2d').drawImage(full, x, y, w, h, 0, 0, w, h);
  return part.toDataURL('image/png');
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = String(text);
  return e;
}

/** Says what a metafile uses that cannot be reproduced; resolves to true to import anyway, false to cancel. */
export function askMetafile(name, kind, issues) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    const backdrop = el('div', 'modal-backdrop metafile-backdrop'), dialog = el('form', 'modal export-modal metafile-modal');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'metafile-title');
    const title = el('h2', null, `Import this ${kind.toUpperCase()} with parts missing?`); title.id = 'metafile-title';
    const intro = el('p', 'hint', `${name} uses things FluoForge cannot reproduce from an ${kind.toUpperCase()} file:`);
    const list = el('ul', 'pdf-issues'); for (const issue of issues) list.append(el('li', null, issue));
    const after = el('p', 'hint', 'Those parts would be missing or drawn differently. To keep the plot exactly, export it from its program as SVG or PDF and import that instead.');
    const ok = el('button', 'primary-button', 'Import anyway'); ok.type = 'submit'; ok.id = 'metafile-ok'; ok.title = 'Add the plot as a vector panel without those parts';
    const cancel = el('button', null, 'Cancel'); cancel.type = 'button'; cancel.id = 'metafile-cancel'; cancel.title = 'Close without importing (Esc)';
    const buttons = el('div', 'btn-row'); buttons.append(cancel, ok);
    dialog.append(title, intro, list, after, buttons);
    backdrop.append(dialog);
    const close = value => { backdrop.remove(); if (opener && opener.focus) opener.focus(); resolve(value); };
    dialog.addEventListener('submit', event => { event.preventDefault(); close(true); });
    cancel.addEventListener('click', () => close(false));
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(false); });
    backdrop.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(false); return; }
      if (event.key !== 'Tab') return;
      const items = [cancel, ok];
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    });
    document.body.append(backdrop);
    cancel.focus();
    // Firefox sometimes ignores this first focus() when the dialog opens during an import (seen in tests): try again next frame.
    requestAnimationFrame(() => { if (backdrop.isConnected && !dialog.contains(document.activeElement)) cancel.focus(); });
  });
}

/**
 * Imports the EMF or WMF file `file` as a vector panel. `anyway`: import without asking when it
 * uses something that cannot be reproduced (true), or fail with a message (false); by default a
 * dialog asks. Resolves to the panel, or null when cancelled.
 */
export async function importMetafile(file, { anyway = null } = {}) {
  const name = file.name || 'plot.emf';
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try { bytes = pako.ungzip(bytes); } catch (error) { throw new Error(`${name} is not a readable compressed EMF or WMF file (${error.message || error}).`); }
  }
  const result = metafileToSVG(bytes, { image: bitmapURL, name });
  const kind = result.kind.toUpperCase();
  if (result.issues.length) {
    if (anyway === false) throw new Error(`${name} cannot be imported exactly: it uses ${result.issues.join(', ')}.`);
    if (anyway !== true && !await askMetafile(name, result.kind, result.issues)) return null;
  }
  const svg = new File([result.svg], name, { type: 'image/svg+xml' });
  const notes = [];
  if (result.issues.length) notes.push(`Left out or drawn differently: ${result.issues.join(', ')}.`);
  if (!result.sized) notes.push(`The ${kind} does not give its size on paper; it was sized at 96 units per inch.`);
  return addVectorToCanvas(svg, { name, what: name, note: notes.join(' '),
    props: { mfcConverted: { from: result.kind, file: name, ...(result.issues.length ? { missing: result.issues } : {}) } } });
}

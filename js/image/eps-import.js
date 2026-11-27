/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* EPS files as vector panels (P3-T10c). js/image/postscript.js runs the file and writes what it
   draws as SVG; this gives it the widths and outlines of the bundled Liberation faces (loaded only
   when a file uses them), Flate decompression (pako) and bitmaps as PNG, then adds the SVG as a vector
   panel (js/image/vector.js). Its project source is that SVG, so any version that opens vector panels
   (0.1.39 on) opens it; `mfcConverted` { from: 'eps', file } records where it came from. When the file
   uses something that cannot be reproduced, the same dialog as for EMF and WMF lists it first. */

import { epsToSVG } from './postscript.js';
import { parseTrueType } from './truetype.js';
import { askMetafile, bitmapURL } from './metafile-import.js';
import { addVectorToCanvas } from './vector.js';

const FILES = { 'Liberation Sans': 'LiberationSans', 'Liberation Serif': 'LiberationSerif', 'Liberation Mono': 'LiberationMono' };
const STYLES = { normal: 'Regular', bold: 'Bold', italic: 'Italic', bolditalic: 'BoldItalic' };
const faces = new Map(); // "face|style" -> Promise of the parsed font

function loadFace(key) {
  if (!faces.has(key)) {
    const [face, style] = key.split('|');
    faces.set(key, fetch(new URL(`assets/fonts/${FILES[face]}-${STYLES[style]}.ttf`, document.baseURI)).then(r => {
      if (!r.ok) throw new Error('Could not load the font ' + face);
      return r.arrayBuffer();
    }).then(b => parseTrueType(new Uint8Array(b))));
    faces.get(key).catch(() => faces.delete(key));
  }
  return faces.get(key);
}

/** Widths and outlines of the Liberation faces already loaded; the others are noted in `missing`. */
function fontProvider(loaded, missing) {
  const get = (face, style) => { const key = `${face}|${style}`; if (!loaded.has(key)) { missing.add(key); return null; } return loaded.get(key); };
  return {
    width(face, style, ch) { const f = get(face, style); if (!f) return null; const g = f.glyphIndex(ch.codePointAt(0)); return g ? f.advance(g) / f.unitsPerEm : null; },
    outline(face, style, ch) { const f = get(face, style); if (!f) return null; const g = f.glyphIndex(ch.codePointAt(0)); return g ? { ops: f.outline(g), unitsPerEm: f.unitsPerEm } : null; }
  };
}

/** Flate data and how many bytes of it the compressed stream used. */
function inflate(bytes) {
  const z = new pako.Inflate();
  z.push(bytes, true);
  if (z.err) throw new Error(z.msg || 'inflate');
  return { data: z.result, used: bytes.length - (z.strm ? z.strm.avail_in : 0) };
}

/**
 * Imports the EPS file `file` as a vector panel. `anyway`: import without asking when it uses
 * something that cannot be reproduced (true), or fail with a message (false); by default a dialog
 * asks. Resolves to the panel, or null when cancelled.
 */
export async function importEPS(file, { anyway = null } = {}) {
  const name = file.name || 'plot.eps';
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The program runs once; if it used Liberation faces not yet loaded, they are loaded and it runs again.
  const loaded = new Map();
  let result;
  for (let pass = 0; pass < 3; pass++) {
    const missing = new Set();
    result = epsToSVG(bytes, { name, fonts: fontProvider(loaded, missing), image: bitmapURL, inflate });
    if (!missing.size) break;
    for (const key of missing) loaded.set(key, await loadFace(key));
  }
  if (result.issues.length) {
    if (anyway === false) throw new Error(`${name} cannot be imported exactly: it uses ${result.issues.join(', ')}.`);
    if (anyway !== true && !await askMetafile(name, 'eps', result.issues)) return null;
  }
  const svg = new File([result.svg], name, { type: 'image/svg+xml' });
  const note = result.issues.length ? `Left out or drawn differently: ${result.issues.join(', ')}.` : '';
  return addVectorToCanvas(svg, { name, what: name, note,
    props: { mfcConverted: { from: 'eps', file: name, ...(result.issues.length ? { missing: result.issues } : {}) } } });
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Vector panels (P3-T10): an SVG (a graph from R, Python or Prism) becomes a panel that stays vector in
   SVG and PDF export.
   - Import reads the file, refuses what a figure cannot carry (scripts, event handlers, HTML, links to
     other files), and sets its text in the embedded Liberation faces (js/image/vector-model.js), so it
     looks the same on screen, in SVG, PDF and TIFF and the PDF glyph check covers it. The original file
     is the project source, stored once like an image's.
   - On the canvas the panel is a Fabric image (`mfcType: 'mfcVector'`) of the SVG drawn by the browser,
     at its size on paper (`mfcVectorDpi` document pixels per inch); it moves, resizes, rotates, crops
     and takes a panel letter like an image.
   - Export writes the plot's own elements into the figure (exportMarkup): its ids renamed and its CSS
     limited to the panel, the crop as a clip. svg2pdf turns them into PDF drawing and text operators.
   PDF pages are imported by js/image/pdf-import.js: converted to SVG (js/image/pdf-vector.js) and added
   here, or, as a clearly labelled fallback, rasterised. */

import { pushHistory } from '../core/history.js';
import { pageBounds } from '../core/pages.js';
import { canvas, docProps, takeId } from '../core/state.js';
import { refreshLayersPanel } from '../ui/layers.js';
import * as V from './vector-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT_FILES = { 'Liberation Sans': 'LiberationSans', 'Liberation Serif': 'LiberationSerif', 'Liberation Mono': 'LiberationMono' };
const STYLE_FILES = { normal: 'Regular', bold: 'Bold', italic: 'Italic', bolditalic: 'BoldItalic' };
// Elements a figure cannot carry: they run code or hold HTML, which neither SVG files of a figure nor PDF keep.
const REFUSED = { script: 'scripts', foreignobject: 'HTML content (foreignObject)', iframe: 'HTML content', video: 'video', audio: 'audio',
  canvas: 'HTML content', embed: 'embedded objects', object: 'embedded objects', animate: 'animation', animatemotion: 'animation',
  animatetransform: 'animation', set: 'animation', handler: 'scripts', listener: 'scripts' };
// Attributes of the root that only place the SVG: the panel does that.
const ROOT_ONLY = /^(xmlns(:.*)?|width|height|viewbox|preserveaspectratio|x|y|version|baseprofile|id|zoomandpan|contentscripttype|contentstyletype)$/i;

const entries = new Map(); // source id -> Promise of the prepared SVG
const elements = new Map(); // source id + size -> Promise of the drawn <img>
const faces = new Map(); // font file -> Promise of its base64

/** The text of an SVG file (a gzipped .svgz is inflated). */
async function svgText(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const plain = bytes[0] === 0x1f && bytes[1] === 0x8b ? pako.ungzip(bytes) : bytes;
  return new TextDecoder().decode(plain);
}

/** The font-family, font-weight and font-style an element sets itself (attribute or style attribute). */
function ownFont(el) {
  const out = {};
  for (const key of ['font-family', 'font-weight', 'font-style']) if (el.hasAttribute(key)) out[key] = el.getAttribute(key);
  const style = el.getAttribute('style') || '';
  for (const m of style.matchAll(/(font-family|font-weight|font-style)\s*:\s*([^;]+)/gi)) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}

/**
 * The SVG `text` of a file named `name`, ready to be a panel: { clean (the SVG with its text in the
 * embedded faces), geometry, par, fonts: [{ family, style, text }], replaced: [font families that were
 * not the embedded ones] }. Throws with a message for the user when it cannot be one.
 */
export function prepareSVG(text, name = 'The SVG') {
  // Event handlers are refused before parsing: even an inert parse makes the browser report them.
  if (/<[^!?>][^>]*\son[a-z]+\s*=/i.test(text)) throw new Error(`${name} contains event handlers (onclick, onload…), which a figure cannot carry. Export the plot again as a plain SVG.`);
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || !root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS)
    throw new Error(`${name} is not a readable SVG file. Export the plot again as SVG (in R: svglite or svg(); in Python: plt.savefig("plot.svg"); in Prism: File ▸ Export ▸ SVG).`);
  const all = [root, ...root.querySelectorAll('*')];
  const refused = new Set(), external = new Set();
  for (const el of all) {
    const tag = el.localName.toLowerCase();
    if (REFUSED[tag]) refused.add(REFUSED[tag]);
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.localName)) refused.add('event handlers (onclick, onload…)');
      if (attr.localName === 'href' || attr.localName === 'src') { if (V.isExternal(attr.value)) external.add(attr.value); }
      if (/^javascript:/i.test(attr.value.trim())) refused.add('scripts');
      if (attr.localName === 'style' || /url\(/i.test(attr.value)) V.cssURLs(attr.value).filter(V.isExternal).forEach(u => external.add(u));
    }
    if (tag === 'style') V.cssURLs(el.textContent).filter(V.isExternal).forEach(u => external.add(u));
  }
  if (refused.size) throw new Error(`${name} contains ${[...refused].join(', ')}, which a figure cannot carry. Export the plot again as a plain SVG.`);
  if (external.size) {
    const list = [...external].slice(0, 3).map(u => (u.length > 60 ? u.slice(0, 57) + '…' : u)).join(', ');
    throw new Error(`${name} links to files outside it (${list}${external.size > 3 ? ', …' : ''}). A figure must carry everything it shows: export the plot again with its images embedded.`);
  }
  const geometry = V.vectorGeometry({ width: root.getAttribute('width'), height: root.getAttribute('height'), viewBox: root.getAttribute('viewBox') });
  const par = root.getAttribute('preserveAspectRatio') || '';

  // Fonts: every family becomes its embedded face. The families replaced are said once to the user.
  const replaced = new Set();
  const note = value => { for (const f of String(value).split(',')) { const n = f.trim().replace(/^['"]|['"]$/g, ''); if (n && !V.FACES.includes(n) && !/^(sans-serif|serif|monospace)$/i.test(n)) replaced.add(n); } };
  for (const el of all) {
    if (el.hasAttribute('font-family')) { note(el.getAttribute('font-family')); el.setAttribute('font-family', `'${V.faceFor(el.getAttribute('font-family'))}'`); }
    const style = el.getAttribute('style');
    if (style && /font/i.test(style)) {
      for (const m of style.matchAll(/font-family\s*:\s*([^;]+)/gi)) note(m[1]);
      for (const m of style.matchAll(/(?:^|[;\s])font\s*:\s*([^;]+)/gi)) { const f = /(?:\d(?:px|pt|em|rem|%|mm|cm|in|pc)?)(?:\s*\/\s*\S+)?\s+(.+)$/i.exec(m[1]); if (f) note(f[1]); }
      el.setAttribute('style', V.mapDeclarations(style));
    }
    if (el.localName === 'style') {
      for (const m of el.textContent.matchAll(/font-family\s*:\s*([^;}]+)/gi)) note(m[1]);
      el.textContent = V.mapDeclarations(el.textContent);
    }
  }
  // Text with no family anywhere is drawn in SVG's default face, a serif: say so explicitly.
  if (!ownFont(root)['font-family']) root.setAttribute('font-family', "'Liberation Serif'");

  // The characters of each face and style, for the PDF fonts and their glyph check.
  const used = new Map();
  const sheet = [...root.querySelectorAll('style')].map(s => s.textContent).join('\n');
  const sheetBold = /font-weight\s*:\s*(bold|bolder|[6-9]00)/i.test(sheet), sheetItalic = /font-style\s*:\s*(italic|oblique)/i.test(sheet);
  for (const textEl of root.querySelectorAll('text')) {
    const font = {};
    for (let el = textEl; el && el.nodeType === 1; el = el.parentNode) for (const [k, v] of Object.entries(ownFont(el))) if (!(k in font)) font[k] = v;
    const family = V.faceFor(font['font-family']), chars = textEl.textContent.replace(/\s+/g, '');
    if (!chars) continue;
    const styles = new Set([V.styleKey(font['font-weight'], font['font-style'])]);
    // A stylesheet may make text bold or italic through classes: those faces come too.
    if (sheetBold) styles.add('bold'); if (sheetItalic) styles.add('italic'); if (sheetBold && sheetItalic) styles.add('bolditalic');
    for (const style of styles) {
      const key = family + ':' + style;
      if (!used.has(key)) used.set(key, { family, style, text: '' });
      used.get(key).text += chars;
    }
  }
  return { clean: new XMLSerializer().serializeToString(root), geometry, par, fonts: [...used.values()], replaced: [...replaced] };
}

/** The prepared SVG of a project source (cached). */
export function vectorEntry(sourceId) {
  if (!entries.has(sourceId)) {
    entries.set(sourceId, (async () => {
      const source = MFC_PROJECT.sources.get(sourceId);
      if (!source) throw new Error('Project source is missing: ' + sourceId);
      return prepareSVG(await svgText(source.blob), source.name);
    })());
    entries.get(sourceId).catch(() => entries.delete(sourceId));
  }
  return entries.get(sourceId);
}

function fontFace(family, style) {
  const path = 'assets/fonts/' + FONT_FILES[family] + '-' + STYLE_FILES[style] + '.ttf';
  if (!faces.has(path)) {
    faces.set(path, fetch(path).then(r => { if (!r.ok) throw new Error('Could not load the font ' + family); return r.arrayBuffer(); }).then(buffer => {
      const bytes = new Uint8Array(buffer); let s = '';
      for (let i = 0; i < bytes.length; i += 16384) s += String.fromCharCode(...bytes.subarray(i, i + 16384));
      return btoa(s);
    }));
  }
  return faces.get(path);
}

/** The SVG as the browser draws it on the canvas: `width` × `height` pixels, its faces embedded
    (an SVG drawn as an image cannot use the page's fonts). */
async function displaySVG(entry, width, height) {
  const root = new DOMParser().parseFromString(entry.clean, 'image/svg+xml').documentElement;
  root.setAttribute('width', String(width)); root.setAttribute('height', String(height));
  if (!root.hasAttribute('viewBox')) { const vb = entry.geometry.viewBox; root.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`); }
  if (entry.fonts.length) {
    const rules = [];
    for (const { family, style } of entry.fonts) {
      rules.push(`@font-face{font-family:'${family}';font-style:${style.includes('italic') ? 'italic' : 'normal'};font-weight:${style.includes('bold') ? 700 : 400};` +
        `src:url(data:font/ttf;base64,${await fontFace(family, style)}) format('truetype');}`);
    }
    const style = root.ownerDocument.createElementNS(SVG_NS, 'style');
    style.textContent = rules.join('\n');
    root.insertBefore(style, root.firstChild);
  }
  return new XMLSerializer().serializeToString(root);
}

/** The panel's size in document pixels: the SVG's size on paper at `dpi`. */
export const vectorSize = (entry, dpi) => V.naturalSize(entry.geometry, dpi);

/** The drawn SVG of a source at `dpi`, as an <img> for Fabric (cached: panels of one source share it). */
export function vectorElement(sourceId, dpi) {
  const key = sourceId + '@' + dpi;
  if (!elements.has(key)) {
    elements.set(key, (async () => {
      const entry = await vectorEntry(sourceId), size = vectorSize(entry, dpi);
      const url = URL.createObjectURL(new Blob([await displaySVG(entry, size.width, size.height)], { type: 'image/svg+xml' }));
      const img = new Image();
      img.width = size.width; img.height = size.height;
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('The browser could not draw this SVG.')); img.src = url; });
      return img;
    })());
    elements.get(key).catch(() => elements.delete(key));
  }
  return elements.get(key);
}

/** A saved vector panel (project.js): its Fabric image, drawn (or, for an export, an empty one of its size). */
export async function restoreVector(json, options, forExport = false) {
  const element = forExport ? Object.assign(document.createElement('canvas'), { width: 1, height: 1 }) : await vectorElement(json.sourceId, json.mfcVectorDpi);
  const obj = new fabric.Image(element, { ...options, width: json.width, height: json.height, cropX: json.cropX || 0, cropY: json.cropY || 0 });
  obj.mfcVectorSource = json.sourceId;
  return obj;
}

/**
 * The SVG of a vector panel inside an exported figure, for Fabric's _toSVG: the plot's own elements in
 * the panel's frame (crop as a clip), its ids prefixed with the panel's and its CSS limited to it, and
 * inherited paint reset so the panel's wrapper does not change the plot. Resolves to { markup, fonts }.
 */
export async function exportMarkup(obj) {
  const entry = await vectorEntry(obj.mfcVectorSource);
  const root = new DOMParser().parseFromString(entry.clean, 'image/svg+xml').documentElement;
  const prefix = 'v' + String(obj.mfcId).replace(/[^\w-]/g, '') + '-';
  const ids = new Map();
  for (const el of root.querySelectorAll('[id]')) ids.set(el.getAttribute('id'), prefix + el.getAttribute('id'));
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el.hasAttribute('id') && el !== root) el.setAttribute('id', ids.get(el.getAttribute('id')));
    for (const attr of [...el.attributes]) if (attr.value.includes('#')) attr.value = V.renameRefs(attr.value, ids);
    if (el.localName === 'style') el.textContent = V.scopeCSS(V.renameRefs(el.textContent, ids), `#${prefix}scope`);
  }
  const size = vectorSize(entry, obj.mfcVectorDpi);
  const t = V.viewportTransform(entry.geometry.viewBox, size.width, size.height, entry.par);
  const w = obj.width, h = obj.height, cx = obj.cropX || 0, cy = obj.cropY || 0;
  const n = v => String(Number(v.toFixed(6)));
  const rootAttrs = [...root.attributes].filter(a => !ROOT_ONLY.test(a.name)).map(a => ` ${a.name}="${a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`).join('');
  const children = [...root.childNodes].map(node => (node.nodeType === 1 ? new XMLSerializer().serializeToString(node) : node.nodeType === 3 ? node.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;') : '')).join('');
  const markup = `<clipPath id="${prefix}clip"><rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}"/></clipPath>` +
    `<g id="${prefix}scope" clip-path="url(#${prefix}clip)" fill="#000000" fill-opacity="1" fill-rule="nonzero" stroke="none" stroke-width="1" stroke-opacity="1" ` +
    `stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="4" stroke-dasharray="none" stroke-dashoffset="0">` +
    `<g transform="translate(${n(-w / 2 - cx)} ${n(-h / 2 - cy)}) matrix(${n(t.sx)} 0 0 ${n(t.sy)} ${n(t.tx)} ${n(t.ty)})"${rootAttrs}>${children}</g></g>`;
  return { markup, fonts: entry.fonts };
}

/** Adds the SVG file `file` to the canvas as a vector panel, at its size on paper (smaller when it
    would not fit on the page). One History step. A PDF page converted to SVG (pdf-import.js) passes
    the panel's `name`, extra `props` (mfcConverted), the `what` its message starts with and a `note` it ends with;
    so does an EMF or WMF (metafile-import.js). */
export async function addVectorToCanvas(file, { name: label = null, props = null, what = null, note = '' } = {}) {
  const text = await svgText(file);
  const name = label || file.name || 'plot.svg';
  const entry = prepareSVG(text, name);
  const sourceId = await MFC_PROJECT.registerSource(file, { fileName: name, sourceFormat: 'svg' });
  entries.set(sourceId, Promise.resolve(entry));
  const dpi = docProps.dpi || 300, size = vectorSize(entry, dpi);
  const element = await vectorElement(sourceId, dpi);
  const page = pageBounds(0), room = { width: page.width - 80, height: page.height - 80 };
  const fit = Math.min(1, room.width > 0 ? room.width / size.width : 1, room.height > 0 ? room.height / size.height : 1);
  const obj = new fabric.Image(element, {
    left: page.left + 40 + (canvas.getObjects().length * 20) % 200, top: page.top + 40 + (canvas.getObjects().length * 20) % 200,
    scaleX: fit, scaleY: fit, cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
  });
  const fonts = entry.replaced.length ? ` Its text is set in the embedded Liberation fonts (instead of ${entry.replaced.slice(0, 3).join(', ')}${entry.replaced.length > 3 ? ', …' : ''}), so it looks the same in every export.` : '';
  const message = `${what || name} is a vector panel: it stays vector in SVG and PDF export.${fonts}${fit < 1 ? ' It was scaled down to fit the page.' : ''}${note ? ' ' + note : ''}`;
  // The import message is kept with the panel (PI-T8): its Plot info shows it again, also after save and reopen.
  Object.assign(obj, { mfcId: 'vec' + takeId(), mfcType: 'mfcVector', mfcFileName: name, mfcVectorSource: sourceId, mfcVectorDpi: dpi }, props || {}, { mfcImportMessage: message });
  canvas.add(obj);
  canvas.setActiveObject(obj);
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
  MFC_UI.toast(message);
  return obj;
}

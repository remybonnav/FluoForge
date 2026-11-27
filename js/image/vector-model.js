/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Vector panels (P3-T10), the pure part: no DOM, no Fabric.
   - The size of an SVG on paper (its width and height in px, pt, mm, cm or in; else its viewBox in CSS
     pixels) and the transform from its viewBox to its viewport (preserveAspectRatio).
   - The embedded Liberation face that stands in for a font family, so text in a plot looks the same on
     screen, in SVG, in PDF and in TIFF.
   - Scoping a plot's CSS to its own group, and renaming its ids, so neither reaches the rest of the figure.
   The panel itself is made by js/image/vector.js. */

/** Inches per unit of an SVG length; a number without a unit is in CSS pixels (96 per inch). */
const UNITS = { '': 1 / 96, px: 1 / 96, pt: 1 / 72, pc: 1 / 6, in: 1, cm: 1 / 2.54, mm: 1 / 25.4, q: 1 / 101.6 };

/** An SVG length (width or height) in inches, or null when absent, relative (%) or not a length. */
export function lengthInches(value) {
  const m = /^\s*([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(String(value ?? ''));
  if (!m) return null;
  const unit = m[2].toLowerCase();
  if (!(unit in UNITS)) return null;
  const n = Number(m[1]) * UNITS[unit];
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A viewBox attribute as { x, y, width, height }, or null when absent or unusable. */
export function parseViewBox(value) {
  const parts = String(value ?? '').trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

/**
 * The size on paper and the drawing area of an SVG root: { widthIn, heightIn, viewBox }. Without a
 * usable width or height, the viewBox gives the size in CSS pixels (and the other one keeps its aspect);
 * without a viewBox, width and height in CSS pixels make one. Throws with a message when neither says.
 */
export function vectorGeometry({ width, height, viewBox }) {
  const vb = parseViewBox(viewBox);
  let w = lengthInches(width), h = lengthInches(height);
  if (vb) {
    if (w == null && h == null) { w = vb.width / 96; h = vb.height / 96; }
    else if (w == null) w = h * vb.width / vb.height;
    else if (h == null) h = w * vb.height / vb.width;
  }
  if (w == null || h == null) throw new Error('The SVG has no size: it needs a width and height, or a viewBox.');
  return { widthIn: w, heightIn: h, viewBox: vb || { x: 0, y: 0, width: w * 96, height: h * 96 } };
}

/**
 * The transform from viewBox coordinates to a viewport of `width` × `height`, as SVG draws it:
 * { sx, sy, tx, ty } with x' = sx·x + tx. `par` is the preserveAspectRatio attribute (xMidYMid meet by default).
 */
export function viewportTransform(vb, width, height, par = '') {
  const words = String(par || '').trim().split(/\s+/).filter(w => w && w !== 'defer');
  const align = words[0] || 'xMidYMid', mode = words[1] || 'meet';
  let sx = width / vb.width, sy = height / vb.height;
  if (align !== 'none') {
    const s = mode === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = sy = s;
  }
  let tx = -vb.x * sx, ty = -vb.y * sy;
  if (align !== 'none') {
    const fx = /xMid/.test(align) ? 0.5 : /xMax/.test(align) ? 1 : 0, fy = /YMid/.test(align) ? 0.5 : /YMax/.test(align) ? 1 : 0;
    tx += (width - vb.width * sx) * fx; ty += (height - vb.height * sy) * fy;
  }
  return { sx, sy, tx, ty };
}

// ---- fonts ----
/** The embedded faces (assets/fonts) and the families they stand in for. */
export const FACES = ['Liberation Sans', 'Liberation Serif', 'Liberation Mono'];
const SANS = /^(liberation sans|arimo|arial|helvetica( neue)?|dejavu sans|bitstream vera sans|verdana|tahoma|segoe ui|calibri|lucida (grande|sans)|open sans|roboto|source sans( pro| 3)?|noto sans|inter|gill sans|futura|myriad( pro)?|sans-serif|system-ui)$/;
const SERIF = /^(liberation serif|tinos|times( new roman)?|georgia|dejavu serif|bitstream vera serif|cambria|garamond|palatino( linotype)?|book antiqua|noto serif|cmr10|computer modern|stix( two text)?|stixgeneral|serif)$/;
const MONO = /^(liberation mono|cousine|courier( new)?|dejavu sans mono|bitstream vera sans mono|consolas|menlo|monaco|lucida console|source code pro|noto sans mono|monospace)$/;

/** The embedded face for a font-family list ("'DejaVu Sans', Arial, sans-serif"): the first family it
    knows decides; a list of only unknown names is set in Liberation Sans, most plots' kind of face. */
export function faceFor(families) {
  const names = String(families ?? '').split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase()).filter(Boolean);
  for (const name of names) {
    if (SANS.test(name)) return 'Liberation Sans';
    if (SERIF.test(name)) return 'Liberation Serif';
    if (MONO.test(name)) return 'Liberation Mono';
  }
  return names.length ? 'Liberation Sans' : 'Liberation Serif'; // no family at all: SVG's default face is a serif
}

/** The style key of the export's fonts: 'normal', 'bold', 'italic' or 'bolditalic'. */
export function styleKey(weight, style) {
  const w = String(weight ?? '').trim().toLowerCase();
  const bold = w === 'bold' || w === 'bolder' || (Number(w) >= 600);
  const italic = /italic|oblique/.test(String(style ?? '').toLowerCase());
  return (bold ? 'bold' : '') + (italic ? 'italic' : '') || 'normal';
}

/** CSS text with every font-family declaration set to its embedded face. */
export const mapCSSFonts = css => String(css).replace(/(font-family\s*:\s*)([^;}]+)/gi, (_, key, value) => `${key}'${faceFor(value.replace(/!important/i, ''))}'`);

/**
 * A CSS `font` shorthand value ("italic bold 10px/1.2 'DejaVu Sans', sans-serif") as longhand
 * declarations with the family set to its embedded face; null when it is not a shorthand with a size.
 */
export function expandFontShorthand(value) {
  const m = /^\s*((?:(?:italic|oblique|normal|small-caps|bold|bolder|lighter|[1-9]00)\s+)*)((?:\d+\.?\d*|\.\d+)(?:px|pt|em|rem|%|mm|cm|in|pc)?)(?:\s*\/\s*[^\s]+)?\s+(.+)$/i.exec(String(value));
  if (!m) return null;
  const words = m[1].trim().split(/\s+/).filter(Boolean).map(w => w.toLowerCase());
  const style = words.find(w => w === 'italic' || w === 'oblique') || 'normal';
  const weight = words.find(w => /^(bold|bolder|lighter|[1-9]00)$/.test(w)) || 'normal';
  return `font-style: ${style}; font-weight: ${weight}; font-size: ${m[2]}; font-family: '${faceFor(m[3])}'`;
}

/** Declarations (a style attribute or a CSS block) with every font shorthand and family set to its embedded face. */
export const mapDeclarations = css => mapCSSFonts(String(css).replace(/(^|[;{\s])font\s*:\s*([^;}]+)/gi, (whole, lead, value) => {
  const longhand = expandFontShorthand(value.replace(/!important/i, ''));
  return longhand ? lead + longhand : whole;
}));

// ---- CSS scoping and ids ----
/**
 * A plot's stylesheet with every rule limited to `scope` (a selector, such as "#v12"): "*{…}" becomes
 * "#v12 *{…}", ".a, line{…}" becomes "#v12 .a, #v12 line{…}". @font-face and @import rules are
 * dropped (fonts are the embedded faces; imports are refused before), as is any other at-rule
 * except @media, whose rules are scoped in turn. Comments are removed.
 */
export function scopeCSS(css, scope) {
  const text = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '', i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i), semi = text.indexOf(';', i);
    // A statement at-rule (@import 'x.css';, @charset) has no block: skip it.
    if (text.slice(i).trimStart().startsWith('@') && semi >= 0 && (open < 0 || semi < open)) { i = semi + 1; continue; }
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    // The block: to the matching brace.
    let depth = 1, j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    const body = text.slice(open + 1, j - 1);
    if (head.startsWith('@')) {
      if (/^@media\b/i.test(head)) out += `${head}{${scopeCSS(body, scope)}}`;
    } else if (head) {
      const selectors = head.split(',').map(s => s.trim()).filter(Boolean).map(s => `${scope} ${s}`);
      out += `${selectors.join(', ')}{${body}}`;
    }
    i = j;
  }
  return out;
}

/** Rewrites references to the ids in `ids` (a Map old → new) in an attribute or CSS value:
    url(#a), url('#a') and a bare "#a" href. */
export function renameRefs(value, ids) {
  let s = String(value).replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (whole, q, id) => (ids.has(id) ? `url(#${ids.get(id)})` : whole));
  const bare = /^#(.+)$/.exec(s.trim());
  if (bare && ids.has(bare[1])) s = '#' + ids.get(bare[1]);
  return s;
}

/** Whether a link (href, src or a CSS url()) leaves the file: anything but "#id" and data: URLs. */
export const isExternal = href => { const h = String(href ?? '').trim(); return !!h && !h.startsWith('#') && !/^data:/i.test(h); };

/** The url(...) targets in CSS text, for the external-link check. */
export const cssURLs = css => [...String(css).matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)].map(m => m[2]).concat(
  [...String(css).matchAll(/@import\s+(['"])([^'"]+)\1/gi)].map(m => m[2]));

// ---- placing ----
/** The panel's size in document pixels at `dpi`: the SVG's size on paper. */
export const naturalSize = (geometry, dpi) => ({ width: Math.max(1, Math.round(geometry.widthIn * dpi)), height: Math.max(1, Math.round(geometry.heightIn * dpi)) });

/** A file that is an SVG, by name or type. */
export const isSVGFile = file => /\.svgz?$/i.test(file?.name || '') || file?.type === 'image/svg+xml';
/** A file that is a PDF, by name or type. */
/** An EMF or WMF (P3-T10b), or their gzipped .emz and .wmz, by name or type. */
export const isMetafileFile = file => /\.(emf|emz|wmf|wmz)$/i.test(file?.name || '') || /^(image\/(x-)?(emf|wmf)|application\/x-msmetafile)$/i.test(file?.type || '');
export const isPDFFile = file => /\.pdf$/i.test(file?.name || '') || file?.type === 'application/pdf';

/** The page size of a PDF page (in points) in document pixels at `dpi`, and the scale pdf.js renders at. */
export function pdfRaster(widthPt, heightPt, dpi) {
  const scale = dpi / 72;
  return { width: Math.max(1, Math.round(widthPt * scale)), height: Math.max(1, Math.round(heightPt * scale)), scale };
}

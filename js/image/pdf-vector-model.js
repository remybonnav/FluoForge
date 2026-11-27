/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The pure part of turning a PDF page into SVG (P3-T10a): affine matrices, path data, numbers, and
   which PDF fonts the embedded Liberation faces can stand in for. js/image/pdf-vector.js walks the
   page's drawing operators (from pdf.js) and uses these; tests/pdf-vector-model-regression.mjs checks
   them in Node. */

/** Affine matrices are [a, b, c, d, e, f], as in PDF and canvas: x' = a x + c y + e, y' = b x + d y + f. */
export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

/** m · n: the matrix that applies n first, then m (canvas `transform(n)` on a context at m). */
export function multiply(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

/** The inverse of m, or null when it has none (a degenerate, flat transform). */
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** How m scales lengths: { scale (√|det|), uniform (a rotation and one scale, maybe a flip, within 1 %) }. */
export function lengthScale(m) {
  const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const skew = sx && sy ? Math.abs(m[0] * m[2] + m[1] * m[3]) / (sx * sy) : 1;
  return { scale, uniform: scale > 0 && Math.abs(sx - sy) <= 0.01 * Math.max(sx, sy) && skew <= 0.01 };
}

/** A number for SVG: at most `digits` decimals, no trailing zeros, never "-0". */
export function num(v, digits = 3) {
  const s = Number(v).toFixed(digits);
  const t = s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  return t === '-0' ? '0' : t;
}

/** An SVG transform attribute value for m (scale and rotation to 6 decimals, offsets to 3). */
export const matrixAttr = m => `matrix(${num(m[0], 6)} ${num(m[1], 6)} ${num(m[2], 6)} ${num(m[3], 6)} ${num(m[4])} ${num(m[5])})`;

/** pdf.js path operators (its DrawOPS) in a page's constructPath data. */
export const DRAW = Object.freeze({ moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 });

/**
 * SVG path data for pdf.js path data `ops` (a flat list: an operator, then its coordinates), its
 * points mapped by `m` (none: as they are). Unknown operators throw, so a change in pdf.js's format
 * fails loudly instead of drawing nonsense.
 */
export function pathData(ops, m = null) {
  const out = [];
  const pt = (x, y) => { const [u, v] = m ? apply(m, x, y) : [x, y]; return num(u) + ' ' + num(v); };
  for (let i = 0; i < (ops ? ops.length : 0);) {
    switch (ops[i++]) {
      case DRAW.moveTo: out.push('M' + pt(ops[i], ops[i + 1])); i += 2; break;
      case DRAW.lineTo: out.push('L' + pt(ops[i], ops[i + 1])); i += 2; break;
      case DRAW.curveTo: out.push('C' + pt(ops[i], ops[i + 1]) + ' ' + pt(ops[i + 2], ops[i + 3]) + ' ' + pt(ops[i + 4], ops[i + 5])); i += 6; break;
      case DRAW.quadraticCurveTo: out.push('Q' + pt(ops[i], ops[i + 1]) + ' ' + pt(ops[i + 2], ops[i + 3])); i += 4; break;
      case DRAW.closePath: out.push('Z'); break;
      default: throw new Error(`Unknown path operator ${ops[i - 1]} in the PDF page.`);
    }
  }
  return out.join('');
}

/** Text for an SVG element or attribute. */
export const escapeXML = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SVG stroke-linecap and stroke-linejoin for PDF's numbers. */
export const CAPS = ['butt', 'round', 'square'];
export const JOINS = ['miter', 'round', 'bevel'];

// Families the embedded Liberation faces are metric-compatible with: text in them stays text, every
// character exactly as wide as in the PDF.
const COMPATIBLE = /^(arial|arimo|helvetica|liberation sans|times|times new roman|tinos|liberation serif|courier|courier new|cousine|liberation mono)$/;

/**
 * The family, weight and style of a PDF font from its name (as pdf.js gives it, e.g. "ABCDEF+Arial-BoldMT",
 * "Arial,Bold", "Times-Roman", "TimesNewRomanPS-ItalicMT") and pdf.js's flags: { family, bold, italic,
 * compatible (a Liberation face has the same character widths) }.
 */
export function pdfFont(name, flags = {}) {
  const plain = String(name || '').replace(/^[A-Z]{6}\+/, '');
  const familyPart = plain.split(/[,-]/)[0];
  const family = familyPart.replace(/(PSMT|PS|MT)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[^\w .]/g, '').trim() || 'sans-serif';
  const bold = !!(flags.bold || flags.black) || /bold|black|heavy|semibold|demi/i.test(plain);
  const italic = !!flags.italic || /italic|oblique/i.test(plain);
  const base = family.replace(/(\s+(Bold|Black|Heavy|Italic|Oblique|Regular))+$/i, '').replace(/(?<!New)\s+Roman$/i, ''); // "Times Roman", not "Times New Roman"
  return { family: base, bold, italic, compatible: COMPATIBLE.test(base.toLowerCase()) };
}

/** Whether a glyph's Unicode text can be written as SVG text (not empty, not control or private-use characters). */
export const writableText = s => !!s && !/[\u0000-\u001f\u007f-\u009f-�]/.test(s);

/** What the vector import of a page could not reproduce, said to the user: one line per kind. */
export const ISSUES = Object.freeze({
  tiling: 'repeating pattern fills',
  mesh: 'mesh (free-form) colour gradients',
  smask: 'soft masks (transparency defined by an image)',
  blend: 'blend modes other than normal',
  textClip: 'text used as a clipping path',
  transfer: 'transfer functions (colour remapping)',
  vertical: 'vertical text',
  imageGroup: 'groups of inline images',
  rawPath: 'filled glyph paths pdf.js could not describe'
});

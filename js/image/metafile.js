/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Windows metafiles as SVG (P3-T10b): EMF (Enhanced Metafile, Prism and Office on Windows) and WMF
   (the older Windows Metafile), so a plot in either becomes a vector panel like an SVG or PDF one.
   Both are lists of GDI drawing calls; one small GDI "device" here plays them and writes SVG:
   - the mapping modes, window and viewport, the world transform (EMF), saving and restoring the state;
   - pens (width, dashes, caps, joins), brushes (solid, hatched), polygons, polylines, Béziers,
     rectangles, rounded rectangles, ellipses, arcs, chords and pies, paths (EMF), clipping;
   - text: placed by its character advances where the file gives them, in the font it names (Arial,
     Times New Roman and Courier New are set in the Liberation face with the same widths; others are
     named in the import message, as for an SVG); the Symbol font's Greek letters become Unicode;
   - bitmaps (DIBs: 1, 4, 8, 16, 24 and 32 bits, and embedded JPEG and PNG), as images.
   What it cannot reproduce (ISSUES) is collected for the importer, which says so before importing.
   Pure: no DOM; bitmaps go through `image` (js/image/metafile-import.js gives a canvas-based one). */

import * as P from './pdf-vector-model.js';

/** What a metafile may use that this cannot reproduce faithfully, said to the user. */
export const ISSUES = Object.freeze({
  rop: 'drawing modes that invert or combine colours (raster operations)',
  patternBrush: 'fills with a bitmap pattern',
  region: 'clipping regions combined by union, difference or exclusive or',
  regionFill: 'outlined or inverted regions',
  bitmap: 'bitmaps in a format it cannot read (compressed or palette-indexed)',
  glyphIndex: 'text stored as glyph numbers instead of characters',
  textBackground: 'text with a background box and no character widths',
  underline: 'underlined or struck-out text with no character widths',
  floodFill: 'flood fills',
  widenPath: 'widened paths',
  gradientTriangle: 'triangle gradient fills',
  otherText: 'text records of a rare kind (small or poly text out)',
  layout: 'right-to-left layout',
  openGL: 'OpenGL drawing',
  escape: 'printer escapes that draw',
  plusStrokeFill: 'EMF+ paths stroked and filled in one record'
});

const STOCK_BRUSHES = ['#ffffff', '#c0c0c0', '#808080', '#404040', '#000000', null];
const MAP_MM = { 2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440 }; // logical unit in mm, by mapping mode
// Ascent and descent of the Liberation faces (as of Arial, Times New Roman, Courier New), in em, and the cell height.
const METRICS = { sans: [0.905, 0.212], serif: [0.891, 0.216], mono: [0.833, 0.300] };
const SYMBOL = {
  0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2a: '∗', 0x2d: '−', 0x40: '≅', 0x5c: '∴', 0x5e: '⊥', 0x60: '‾',
  0xa1: 'ϒ', 0xa2: '′', 0xa3: '≤', 0xa4: '⁄', 0xa5: '∞', 0xa6: 'ƒ', 0xab: '↔', 0xac: '←', 0xad: '↑', 0xae: '→', 0xaf: '↓',
  0xb0: '°', 0xb1: '±', 0xb2: '″', 0xb3: '≥', 0xb4: '×', 0xb5: '∝', 0xb6: '∂', 0xb7: '•', 0xb8: '÷', 0xb9: '≠', 0xba: '≡', 0xbb: '≈', 0xbc: '…',
  0xc5: '⊕', 0xc6: '∅', 0xc7: '∩', 0xc8: '∪', 0xd0: '∠', 0xd1: '∇', 0xd6: '√', 0xd7: '⋅', 0xd8: '¬', 0xd9: '∧', 0xda: '∨', 0xe5: '∑', 0xf2: '∫'
};
const GREEK_LOWER = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ', GREEK_UPPER = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
/** A character of the Symbol font as Unicode (codes 0x20–0xFF, or 0xF020–0xF0FF as Windows stores them). */
export function symbolChar(code) {
  const c = code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code;
  if (c >= 0x61 && c <= 0x7a) return GREEK_LOWER[c - 0x61];
  if (c >= 0x41 && c <= 0x5a) return GREEK_UPPER[c - 0x41];
  return SYMBOL[c] || String.fromCharCode(c);
}
const CODEPAGES = { 0: 'windows-1252', 1: 'windows-1252', 77: 'macintosh', 128: 'shift_jis', 129: 'euc-kr', 134: 'gbk', 136: 'big5', 161: 'windows-1253',
  162: 'windows-1254', 163: 'windows-1258', 177: 'windows-1255', 178: 'windows-1256', 186: 'windows-1257', 204: 'windows-1251', 222: 'windows-874', 238: 'windows-1250' };

const color = ref => '#' + [ref & 0xff, (ref >> 8) & 0xff, (ref >> 16) & 0xff].map(v => v.toString(16).padStart(2, '0')).join('');

/** 'emf', 'wmf' or null, from a file's first bytes. */
export function metafileKind(bytes) {
  if (bytes.length < 18) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 88 && v.getUint32(0, true) === 1 && v.getUint32(40, true) === 0x464d4520) return 'emf';
  if (bytes.length >= 40 && v.getUint32(0, true) === 0x9ac6cdd7) return 'wmf';
  const type = v.getUint16(0, true), size = v.getUint16(2, true), version = v.getUint16(4, true);
  if ((type === 1 || type === 2) && size === 9 && (version === 0x300 || version === 0x100)) return 'wmf';
  return null;
}
export const isMetafileName = name => /\.(emf|emz|wmf|wmz)$/i.test(name || '');

/** Approximates an elliptical arc (centre, radii, from angle a0 to a1, radians) by cubic Béziers: [[x0, y0], c1, c2, p, c1, c2, p…]. */
export function arcPoints(cx, cy, rx, ry, a0, a1) {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9)), step = (a1 - a0) / n, k = 4 / 3 * Math.tan(step / 4);
  const pt = a => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  const out = [pt(a0)];
  for (let i = 0; i < n; i++) {
    const s = a0 + i * step, e = s + step;
    out.push([cx + rx * (Math.cos(s) - k * Math.sin(s)), cy + ry * (Math.sin(s) + k * Math.cos(s))],
      [cx + rx * (Math.cos(e) + k * Math.sin(e)), cy + ry * (Math.sin(e) - k * Math.cos(e))], pt(e));
  }
  return out;
}

/** A little-endian reader over `bytes`. */
class Reader {
  constructor(bytes) { this.bytes = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  u8(o) { return this.view.getUint8(o); }
  u16(o) { return this.view.getUint16(o, true); }
  i16(o) { return this.view.getInt16(o, true); }
  u32(o) { return this.view.getUint32(o, true); }
  i32(o) { return this.view.getInt32(o, true); }
  f32(o) { return this.view.getFloat32(o, true); }
  sub(o, n) { return this.bytes.subarray(o, o + n); }
}

/**
 * The GDI device both formats draw on. Coordinates it writes are in "output" units: EMF device
 * pixels, or a WMF's own logical units.
 */
class Device {
  constructor({ outPerMM, pixel, image }) {
    this.outPerMM = outPerMM; this.pixel = pixel; this.imageOf = image;
    this.out = []; this.defs = []; this.issues = new Set(); this.ids = 0; this.open = 0; this.drawn = 0;
    this.dc = {
      mapMode: 1, winOrg: [0, 0], winExt: [1, 1], vpOrg: [0, 0], vpExt: [1, 1], world: P.IDENTITY,
      pen: { style: 0, width: 0, color: '#000000', cosmetic: true, cap: 0, join: 0 }, brush: { style: 0, color: '#ffffff' },
      font: { height: -16, weight: 400, italic: 0, face: 'System', charset: 0 }, textColor: '#000000', bkColor: '#ffffff', bkMode: 2,
      polyFill: 1, textAlign: 0, miter: 10, arcDir: 1, cur: [0, 0], clip: [], rop2: 13, charExtra: 0
    };
    this.saved = [];
    this.path = null; this.lastPath = null;
  }
  id(kind) { return kind + (++this.ids); }

  // ---- mapping ----
  /** Logical (page) units to output units, the world transform first. */
  matrix() {
    const dc = this.dc;
    let sx, sy;
    if (dc.mapMode === 1) sx = sy = 1;
    else if (MAP_MM[dc.mapMode]) { sx = MAP_MM[dc.mapMode] * this.outPerMM[0]; sy = -MAP_MM[dc.mapMode] * this.outPerMM[1]; }
    else {
      sx = dc.vpExt[0] / (dc.winExt[0] || 1); sy = dc.vpExt[1] / (dc.winExt[1] || 1);
      if (dc.mapMode === 7) { const m = Math.min(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx) * m; sy = Math.sign(sy) * m; }
    }
    return P.multiply([sx, 0, 0, sy, dc.vpOrg[0] - dc.winOrg[0] * sx, dc.vpOrg[1] - dc.winOrg[1] * sy], dc.world);
  }
  save() { this.saved.push(structuredClone(this.dc)); }
  restore(n) {
    const index = n < 0 ? this.saved.length + n : n - 1;
    if (index < 0 || index >= this.saved.length) return;
    const dc = this.saved[index];
    this.saved.length = index;
    const clipChanged = JSON.stringify(dc.clip) !== JSON.stringify(this.dc.clip);
    this.dc = dc;
    if (clipChanged) this.applyClip();
  }

  // ---- clipping: a chain of clip paths (their intersection), each an SVG <g> ----
  applyClip() {
    this.out.push('</g>'.repeat(this.open)); this.open = 0;
    for (const c of this.dc.clip) {
      if (!c.id) { c.id = this.id('c'); this.defs.push(`<clipPath id="${c.id}" clipPathUnits="userSpaceOnUse"><path d="${c.d || 'M0 0Z'}"${c.evenOdd ? ' clip-rule="evenodd"' : ''}/></clipPath>`); }
      this.out.push(`<g clip-path="url(#${c.id})">`); this.open++;
    }
  }
  /** Combines the clip with path data `d` (output units) by GDI region mode (1 and, 4 diff, 5 copy). */
  clipTo(d, mode, evenOdd = false) {
    if (mode === 5) this.dc.clip = d == null ? [] : [{ d, evenOdd }];
    else if (mode === 1) this.dc.clip = [...this.dc.clip, { d, evenOdd }];
    else if (mode === 4) this.dc.clip = [...this.dc.clip, { d: this.everything() + d, evenOdd: true }];
    else { this.issues.add(ISSUES.region); this.dc.clip = d == null ? [] : [{ d, evenOdd }]; }
    this.applyClip();
  }
  everything() { return 'M-1e7 -1e7L1e7 -1e7L1e7 1e7L-1e7 1e7Z'; }
  rectPath(x0, y0, x1, y1, m = this.matrix()) {
    return P.pathData([P.DRAW.moveTo, x0, y0, P.DRAW.lineTo, x1, y0, P.DRAW.lineTo, x1, y1, P.DRAW.lineTo, x0, y1, P.DRAW.closePath], m);
  }

  // ---- paint ----
  fillAttr(evenOdd = this.dc.polyFill === 1) {
    const b = this.dc.brush, rule = evenOdd ? ' fill-rule="evenodd"' : '';
    if (!b || b.style === 1) return 'fill="none"';
    if (b.style === 2) return `fill="url(#${this.hatch(b)})"` + rule;
    if (b.style !== 0) { this.issues.add(ISSUES.patternBrush); return 'fill="#808080"' + rule; }
    return `fill="${b.color}"` + rule;
  }
  hatch(b) {
    const key = `${b.hatch}|${b.color}|${this.dc.bkMode === 2 ? this.dc.bkColor : ''}`;
    this.hatches ??= new Map();
    if (!this.hatches.has(key)) {
      const id = this.id('h'), s = 8 * this.pixel, w = P.num(this.pixel, 4), z = P.num(s, 4);
      const lines = { 0: [`M0 ${s / 2}H${z}`], 1: [`M${s / 2} 0V${z}`], 2: [`M0 0L${z} ${z}`], 3: [`M0 ${z}L${z} 0`], 4: [`M0 ${s / 2}H${z}`, `M${s / 2} 0V${z}`], 5: [`M0 0L${z} ${z}`, `M0 ${z}L${z} 0`] }[b.hatch] || [`M0 ${s / 2}H${z}`];
      this.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${z}" height="${z}">` + (this.dc.bkMode === 2 ? `<rect width="${z}" height="${z}" fill="${this.dc.bkColor}"/>` : '') +
        `<path d="${lines.join('')}" stroke="${b.color}" stroke-width="${w}" fill="none"/></pattern>`);
      this.hatches.set(key, id);
    }
    return this.hatches.get(key);
  }
  strokeAttr(m = this.matrix()) {
    const p = this.dc.pen;
    if (!p || p.style === 5) return 'stroke="none"';
    const scale = P.lengthScale(m).scale;
    const w = p.cosmetic || !p.width ? this.pixel : p.width * scale;
    let a = `stroke="${p.color}" stroke-width="${P.num(w, 4)}"`;
    if (p.cosmetic) a += ' stroke-linecap="round" stroke-linejoin="round"';
    else {
      a += ` stroke-linecap="${['round', 'square', 'butt'][p.cap] || 'round'}" stroke-linejoin="${['round', 'bevel', 'miter'][p.join] || 'round'}"`;
      if (p.join === 2) a += ` stroke-miterlimit="${P.num(Math.max(1, this.dc.miter), 3)}"`;
    }
    // GDI's dash patterns: in device pixels for a cosmetic pen, in pen widths for a geometric one.
    const dashes = p.style === 7 && p.user && p.user.length ? p.user.map(v => v * (p.cosmetic ? this.pixel : scale))
      : p.cosmetic ? ({ 1: [18, 6], 2: [3, 3], 3: [9, 6, 3, 6], 4: [9, 3, 3, 3, 3, 3], 8: [1, 1] }[p.style] || []).map(v => v * this.pixel)
      : ({ 1: [3, 1], 2: [1, 1], 3: [3, 1, 1, 1], 4: [3, 1, 1, 1, 1, 1] }[p.style] || []).map(v => v * w);
    if (dashes.length) a += ` stroke-dasharray="${dashes.map(v => P.num(v, 4)).join(' ')}"`;
    return a;
  }
  check() { const r = this.dc.rop2; if (r !== 13 && r !== 1 && r !== 16 && r !== 11) this.issues.add(ISSUES.rop); return r !== 11; }

  /** Draws path data `d` (output units) filled and/or stroked with the current brush and pen, or adds it to the open path. */
  draw(d, fill, stroke, m) {
    if (!d) return;
    if (this.path) { this.path.push(d); return; }
    if (!this.check()) return;
    const f = fill ? this.fillAttr() : 'fill="none"', s = stroke ? this.strokeAttr(m) : 'stroke="none"';
    if (f === 'fill="none"' && s === 'stroke="none"') return;
    // R2_BLACK and R2_WHITE paint in black or white whatever the pen and brush.
    const rop = this.dc.rop2 === 1 ? '#000000' : this.dc.rop2 === 16 ? '#ffffff' : null;
    const attrs = rop ? f.replace(/fill="(?!none)[^"]+"/, `fill="${rop}"`) + ' ' + s.replace(/stroke="(?!none)[^"]+"/, `stroke="${rop}"`) : f + ' ' + s;
    this.out.push(`<path d="${d}" ${attrs}/>`);
    this.drawn++;
  }
  points(list, m = this.matrix()) { return list.map(([x, y]) => P.apply(m, x, y)); }
  /** Adds `d` (which starts at the current point) to the open path: it continues the figure, or starts one. */
  extend(d) { this.path.push(this.path.length ? d.replace(/^M[^LCZ]*/, '') : d); }
  poly(list, close) {
    const pts = this.points(list);
    if (!pts.length) return '';
    return 'M' + pts.map(([x, y]) => P.num(x) + ' ' + P.num(y)).join('L') + (close ? 'Z' : '');
  }
  polygon(list) { this.draw(this.poly(list, true), true, true); }
  polyPolygon(lists) { this.draw(lists.map(l => this.poly(l, true)).join(''), true, true); }
  polyline(list) {
    if (this.path) { this.path.push(this.poly(list, false)); this.dc.cur = list.at(-1) || this.dc.cur; return; }
    this.draw(this.poly(list, false), false, true);
  }
  polylineTo(list) {
    const d = this.poly([this.dc.cur, ...list], false);
    if (this.path) this.extend(d); else this.draw(d, false, true);
    if (list.length) this.dc.cur = list.at(-1);
  }
  bezier(list, to) {
    const all = to ? [this.dc.cur, ...list] : list;
    if (all.length < 4) return;
    const pts = this.points(all);
    let d = `M${P.num(pts[0][0])} ${P.num(pts[0][1])}`;
    for (let i = 1; i + 2 < pts.length; i += 3) d += 'C' + [pts[i], pts[i + 1], pts[i + 2]].map(([x, y]) => P.num(x) + ' ' + P.num(y)).join(' ');
    if (this.path) { if (to) this.extend(d); else this.path.push(d); } else this.draw(d, false, true);
    if (to) this.dc.cur = list.at(-1);
  }
  moveTo(x, y) { this.dc.cur = [x, y]; if (this.path) { const [u, v] = P.apply(this.matrix(), x, y); this.path.push(`M${P.num(u)} ${P.num(v)}`); } }
  lineTo(x, y) {
    const d = this.poly([this.dc.cur, [x, y]], false);
    if (this.path) this.extend(d); else this.draw(d, false, true);
    this.dc.cur = [x, y];
  }
  rectangle(l, t, r, b) { this.draw(this.rectPath(l, t, r, b), true, true); }
  roundRect(l, t, r, b, w, h) {
    const rx = Math.min(Math.abs(w) / 2, Math.abs(r - l) / 2), ry = Math.min(Math.abs(h) / 2, Math.abs(b - t) / 2);
    const x0 = Math.min(l, r), x1 = Math.max(l, r), y0 = Math.min(t, b), y1 = Math.max(t, b);
    const pts = [...arcPoints(x1 - rx, y0 + ry, rx, ry, -Math.PI / 2, 0), ...arcPoints(x1 - rx, y1 - ry, rx, ry, 0, Math.PI / 2),
      ...arcPoints(x0 + rx, y1 - ry, rx, ry, Math.PI / 2, Math.PI), ...arcPoints(x0 + rx, y0 + ry, rx, ry, Math.PI, 1.5 * Math.PI)];
    this.draw(this.curves(pts, true, true), true, true);
  }
  /** Path data for arcPoints-style lists, several joined: each 4-point group after the first is a curve; `joinLines` links groups with lines. */
  curves(pts, close, joinLines) {
    const m = this.matrix(), p = pts.map(([x, y]) => P.apply(m, x, y)), f = ([x, y]) => P.num(x) + ' ' + P.num(y);
    let d = 'M' + f(p[0]);
    for (let i = 1; i < p.length;) {
      if (joinLines && (i % 4 === 0)) { d += 'L' + f(p[i]); i++; continue; }
      d += 'C' + f(p[i]) + ' ' + f(p[i + 1]) + ' ' + f(p[i + 2]); i += 3;
    }
    return d + (close ? 'Z' : '');
  }
  ellipse(l, t, r, b) {
    const cx = (l + r) / 2, cy = (t + b) / 2, rx = Math.abs(r - l) / 2, ry = Math.abs(b - t) / 2;
    this.draw(this.curves(arcPoints(cx, cy, rx, ry, 0, 2 * Math.PI), true), true, true);
  }
  /** ARC (kind 'arc'), CHORD ('chord'), PIE ('pie') or ARCTO ('to'), from the bounding box and the radial start and end points. */
  arc(kind, l, t, r, b, xs, ys, xe, ye) {
    const cx = (l + r) / 2, cy = (t + b) / 2, rx = Math.abs(r - l) / 2 || 1e-9, ry = Math.abs(b - t) / 2 || 1e-9;
    let a0 = Math.atan2((ys - cy) / ry, (xs - cx) / rx), a1 = Math.atan2((ye - cy) / ry, (xe - cx) / rx);
    // Counter-clockwise as seen (the default): angles decrease where y points down on the page.
    const det = (m => m[0] * m[3] - m[1] * m[2])(this.matrix());
    const decreasing = (this.dc.arcDir === 1) === (det > 0);
    if (decreasing) { while (a1 >= a0) a1 -= 2 * Math.PI; } else { while (a1 <= a0) a1 += 2 * Math.PI; }
    const pts = arcPoints(cx, cy, rx, ry, a0, a1);
    if (kind === 'to') { // a line from the current point to the arc's start, then the arc
      const d = this.poly([this.dc.cur, pts[0]], false) + this.curves(pts, false).replace(/^M[^C]*/, '');
      if (this.path) this.extend(d); else this.draw(d, false, true);
      this.dc.cur = pts.at(-1);
      return;
    }
    let d = this.curves(pts, false);
    if (kind === 'chord') d += 'Z';
    if (kind === 'pie') { const [u, v] = P.apply(this.matrix(), cx, cy); d += `L${P.num(u)} ${P.num(v)}Z`; }
    this.draw(d, kind !== 'arc', true);
  }
  /** ANGLEARC: a line from the current point to the arc's start, then the arc (angles in degrees, counter-clockwise). */
  angleArc(x, y, radius, start, sweep) {
    const a0 = -start * Math.PI / 180, a1 = -(start + sweep) * Math.PI / 180;
    const pts = arcPoints(x, y, radius, radius, a0, a1);
    const d = this.poly([this.dc.cur, pts[0]], false) + this.curves(pts, false).replace(/^M[^C]*/, '');
    if (this.path) this.extend(d); else this.draw(d, false, true);
    this.dc.cur = pts.at(-1);
  }

  // ---- paths (EMF) ----
  beginPath() { this.path = []; }
  endPath() { this.lastPath = this.path ? this.path.join('') : ''; this.path = null; }
  closeFigure() { if (this.path) this.path.push('Z'); }
  usePath(fill, stroke) {
    const d = this.lastPath; this.lastPath = null;
    if (d) this.draw(d, fill, stroke);
  }

  // ---- text ----
  /**
   * Text `chars` at logical (x, y), with character advances `dx` (logical units, or null) and ExtTextOut
   * `options`; `rect` (logical) is the opaque or clip rectangle. `advanced`: the graphics mode of EMF text.
   */
  text(x, y, chars, dx, options = 0, rect = null, advanced = false) {
    if (!chars.length) return;
    if (!this.check()) return;
    const dc = this.dc, font = dc.font;
    if (dc.textAlign & 1) [x, y] = dc.cur; // TA_UPDATECP
    const info = P.pdfFont(font.face || 'Arial', { bold: font.weight >= 600, italic: !!font.italic });
    const symbol = font.charset === 2 || /^symbol$/i.test(font.face || '');
    let text = [...chars];
    if (symbol) text = text.map(ch => symbolChar(ch.codePointAt(0)));
    const kind = /mono|courier|consol/i.test(font.face || '') ? 'mono' : /times|serif|roman|georgia|garamond|cambria|palatino/i.test(font.face || '') ? 'serif' : 'sans';
    const [ascent, descent] = METRICS[kind];
    const em = font.height < 0 ? -font.height : font.height > 0 ? font.height / (ascent + descent) : 12;
    const m = this.matrix(), { scale } = P.lengthScale(m);
    const advances = dx ? dx.slice(0, text.length).map(v => v + (dc.charExtra || 0)) : null;
    const width = advances ? advances.reduce((a, b) => a + b, 0) : null;
    // Where the text starts and its baseline, in the text's own (unrotated, logical-size) frame.
    const h = dc.textAlign & 6, v = dc.textAlign & 24;
    let x0 = 0, anchor = '';
    if (h === 6) { if (width != null) x0 = -width / 2; else anchor = ' text-anchor="middle"'; }
    else if (h === 2) { if (width != null) x0 = -width; else anchor = ' text-anchor="end"'; }
    const base = v === 24 ? 0 : v === 8 ? -descent * em : ascent * em;
    // Output frame: the reference point, the escapement (tenths of a degree, counter-clockwise as seen), the scale.
    const [px, py] = P.apply(m, x, y);
    const angle = -(font.escapement || 0) / 10 * Math.PI / 180 + (advanced ? Math.atan2(m[1], m[0]) : 0);
    const T = P.multiply([Math.cos(angle) * scale, Math.sin(angle) * scale, -Math.sin(angle) * scale, Math.cos(angle) * scale, px, py], [1, 0, 0, 1, 0, base]);
    const fontAttrs = `font-family="${P.escapeXML(symbol ? 'Symbol' : info.family)}"${font.weight >= 600 ? ' font-weight="bold"' : ''}${font.italic ? ' font-style="italic"' : ''} font-size="${P.num(em, 4)}"`;
    if (options & 0x2 && rect) this.out.push(`<path d="${this.rectPath(...rect, m)}" fill="${dc.bkColor}"/>`); // ETO_OPAQUE
    let clipped = false;
    if (options & 0x4 && rect) { const cid = this.id('c'); this.defs.push(`<clipPath id="${cid}" clipPathUnits="userSpaceOnUse"><path d="${this.rectPath(...rect, m)}"/></clipPath>`); this.out.push(`<g clip-path="url(#${cid})">`); clipped = true; }
    if (dc.bkMode === 2 && !(options & 0x2)) {
      if (width != null) this.out.push(`<path transform="${P.matrixAttr(T)}" d="${P.pathData([0, x0, -ascent * em, 1, x0 + width, -ascent * em, 1, x0 + width, descent * em, 1, x0, descent * em, 4])}" fill="${dc.bkColor}"/>`);
      else this.issues.add(ISSUES.textBackground);
    }
    const word = (from, to, at) => {
      const s = text.slice(from, to).join('');
      if (s.trim()) this.out.push(`<text transform="${P.matrixAttr(P.multiply(T, [1, 0, 0, 1, at, 0]))}" ${fontAttrs} fill="${dc.textColor}"${anchor}>${P.escapeXML(s)}</text>`);
    };
    if (!advances) word(0, text.length, x0);
    else {
      // Each word (each character, for a face whose widths Liberation does not share) where the file puts it.
      const each = !info.compatible || symbol;
      let at = x0, start = 0, startAt = x0;
      for (let i = 0; i <= text.length; i++) {
        const end = i === text.length || /\s/.test(text[i]) || each;
        if (end) { if (each && i < text.length) { word(i, i + 1, at); } else { word(start, i, startAt); } start = i + 1; startAt = at + (i < text.length ? advances[i] : 0); }
        if (i < text.length) at += advances[i];
      }
    }
    if (font.underline || font.strikeout) {
      if (width == null) this.issues.add(ISSUES.underline);
      else for (const [on, at] of [[font.underline, 0.1 * em], [font.strikeout, -0.28 * em]]) if (on)
        this.out.push(`<path transform="${P.matrixAttr(T)}" d="M${P.num(x0)} ${P.num(at)}H${P.num(x0 + width)}" stroke="${dc.textColor}" stroke-width="${P.num(em * 0.06, 4)}" fill="none"/>`);
    }
    if (clipped) this.out.push('</g>');
    if (dc.textAlign & 1 && width != null) this.dc.cur = [x + width, y];
    this.drawn++;
  }

  // ---- bitmaps ----
  /** A DIB (header at `bmi`, pixels at `bits`) drawn into logical rectangle (x, y, w, h), its source rectangle (sx, sy, sw, sh). */
  bitmap(dib, x, y, w, h, sx, sy, sw, sh, { opacity = 1, alpha = false, fromBottom = false } = {}) {
    if (!this.check()) return;
    const img = decodeDIB(dib, alpha);
    if (!img) { this.issues.add(ISSUES.bitmap); return; }
    if (fromBottom && img.bottomUp) sy = img.height - sy - sh; // StretchDIBits counts rows from the bottom of a bottom-up DIB
    this.placeImage(img, P.multiply(this.matrix(), [w, 0, 0, h, x, y]), { x: sx, y: sy, width: sw, height: sh }, opacity);
  }
  /** A decoded image drawn in the unit square mapped by `t` (output units), its source rectangle `src`. */
  placeImage(img, t, src, opacity = 1) {
    const href = this.imageOf ? this.imageOf(img, src) : 'data:,';
    if (!href) { this.issues.add(ISSUES.bitmap); return; }
    const px = P.lengthScale(t).scale / Math.sqrt(Math.max(1, Math.abs(src.width * src.height)));
    this.out.push(`<image x="0" y="0" width="1" height="1" preserveAspectRatio="none" transform="${P.matrixAttr(t)}"` + (opacity < 1 ? ` opacity="${P.num(opacity, 4)}"` : '') +
      (px >= 1.5 * this.pixel ? ' style="image-rendering:pixelated"' : '') + ` href="${href}"/>`);
    this.drawn++;
  }
  /** A raster operation with no bitmap: fills with the brush (PATCOPY), black or white. */
  patBlt(rop, x, y, w, h) {
    const fill = rop === 0x00f00021 ? this.fillAttr(false) : rop === 0x00000042 ? 'fill="#000000"' : rop === 0x00ff0062 ? 'fill="#ffffff"' : null;
    if (rop === 0x00aa0029) return; // D: nothing changes
    if (!fill) { this.issues.add(ISSUES.rop); return; }
    if (fill !== 'fill="none"') { this.out.push(`<path d="${this.rectPath(x, y, x + w, y + h)}" ${fill}/>`); this.drawn++; }
  }

  svg(viewBox, widthMM, heightMM) {
    this.out.push('</g>'.repeat(this.open)); this.open = 0;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${P.num(widthMM, 4)}mm" height="${P.num(heightMM, 4)}mm" viewBox="${viewBox.map(v => P.num(v, 3)).join(' ')}">` +
      (this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '') + this.out.join('') + '</svg>';
  }
}

/**
 * A device-independent bitmap: { width, height, rgba: Uint8ClampedArray, top-down } or, for an
 * embedded JPEG or PNG, { width, height, mime, bytes }; null when it cannot be read.
 */
export function decodeDIB({ reader, bmi, bits, usage = 0 }, alpha = false) {
  const size = reader.u32(bmi);
  let width, height, bpp, compression = 0, used = 0, tableAt, entry = 4;
  if (size === 12) { width = reader.u16(bmi + 4); height = reader.i16(bmi + 6); bpp = reader.u16(bmi + 10); tableAt = bmi + 12; entry = 3; }
  else { width = reader.i32(bmi + 4); height = reader.i32(bmi + 8); bpp = reader.u16(bmi + 14); compression = reader.u32(bmi + 16); used = reader.u32(bmi + 32); tableAt = bmi + size; }
  const topDown = height < 0; height = Math.abs(height);
  if (!width || !height || width * height > 64e6) return null;
  if (compression === 4 || compression === 5) {
    const imgSize = reader.u32(bmi + 20);
    return { width, height, mime: compression === 4 ? 'image/jpeg' : 'image/png', bytes: reader.sub(bits, imgSize) };
  }
  if (usage === 1 && bpp <= 8) return null; // palette indices into a palette the file does not carry here
  let masks = null;
  if (compression === 3 || compression === 6) {
    masks = size >= 52 ? [reader.u32(bmi + 40), reader.u32(bmi + 44), reader.u32(bmi + 48), size >= 56 ? reader.u32(bmi + 52) : 0]
      : [reader.u32(tableAt), reader.u32(tableAt + 4), reader.u32(tableAt + 8), 0];
    if (size === 40) tableAt += 12;
  } else if (compression !== 0) return null; // RLE
  const colours = bpp <= 8 ? (used || 1 << bpp) : 0;
  const table = [];
  for (let i = 0; i < colours; i++) { const o = tableAt + i * entry; table.push([reader.u8(o + 2), reader.u8(o + 1), reader.u8(o)]); }
  const stride = Math.ceil(width * bpp / 32) * 4;
  if (bits + stride * height > reader.bytes.length) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const shift = m => { let s = 0; while (m && !(m & 1)) { m >>>= 1; s++; } return s; };
  const fieldOf = (v, m) => m ? Math.round(((v & m) >>> shift(m)) * 255 / (m >>> shift(m))) : 0;
  if (!masks && bpp === 16) masks = [0x7c00, 0x03e0, 0x001f, 0];
  for (let row = 0; row < height; row++) {
    const src = bits + (topDown ? row : height - 1 - row) * stride, dst = row * width * 4;
    for (let x = 0; x < width; x++) {
      let r, g, b, a = 255;
      if (bpp <= 8) {
        const per = 8 / bpp, byte = reader.u8(src + Math.floor(x / per)), index = (byte >> ((per - 1 - x % per) * bpp)) & ((1 << bpp) - 1);
        [r, g, b] = table[index] || [0, 0, 0];
      } else if (bpp === 24) { const o = src + x * 3; b = reader.u8(o); g = reader.u8(o + 1); r = reader.u8(o + 2); }
      else if (bpp === 16 || (bpp === 32 && masks)) {
        const v = bpp === 16 ? reader.u16(src + x * 2) : reader.u32(src + x * 4);
        r = fieldOf(v, masks[0]); g = fieldOf(v, masks[1]); b = fieldOf(v, masks[2]); if (masks[3]) a = fieldOf(v, masks[3]);
      } else if (bpp === 32) {
        const o = src + x * 4; b = reader.u8(o); g = reader.u8(o + 1); r = reader.u8(o + 2);
        if (alpha) { a = reader.u8(o + 3); if (a && a < 255) { r = Math.min(255, r * 255 / a); g = Math.min(255, g * 255 / a); b = Math.min(255, b * 255 / a); } }
      } else return null;
      rgba[dst + x * 4] = r; rgba[dst + x * 4 + 1] = g; rgba[dst + x * 4 + 2] = b; rgba[dst + x * 4 + 3] = a;
    }
  }
  return { width, height, rgba, bottomUp: !topDown };
}

// ==================================================== EMF+ =====================================================
// EMF+ (GDI+) records travel inside EMF comments. A "dual" file also has a plain EMF copy of the
// drawing, which is played instead; a file with EMF+ only (R's devEMF by default) is played from them.

const PLUS_UNIT_MM = { 3: 25.4 / 72, 4: 25.4, 5: 25.4 / 300, 6: 1 }; // point, inch, document, millimetre; others are device pixels
const argb = v => ({ color: '#' + [(v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff].map(c => c.toString(16).padStart(2, '0')).join(''), alpha: ((v >>> 24) & 0xff) / 255 });

/** Plays EMF+ records (in an EMF comment's data, bytes `start` to `end`) on `gdi`; `plus` keeps their state between comments. */
function playPlus(reader, start, end, plus, gdi) {
  let r = reader;
  const unitOut = unit => (PLUS_UNIT_MM[unit] || 25.4 / plus.dpi) * gdi.outPerMM[0];
  const matrix = () => P.multiply([plus.pageScale * unitOut(plus.pageUnit), 0, 0, plus.pageScale * unitOut(plus.pageUnit), 0, 0], plus.world);
  const f = ([x, y]) => P.num(x) + ' ' + P.num(y);
  const readPoints = (at, n, compressed, relative) => {
    const pts = [];
    let x = 0, y = 0;
    for (let i = 0; i < n; i++) {
      if (relative) {
        const one = () => { const b = r.u8(at); if (b & 0x80) { const v = ((b & 0x7f) << 8 | r.u8(at + 1)) << 17 >> 17; at += 2; return v; } at += 1; return (b & 0x7f) << 25 >> 25; };
        x += one(); y += one();
      } else if (compressed) { x = r.i16(at); y = r.i16(at + 2); at += 4; }
      else { x = r.f32(at); y = r.f32(at + 4); at += 8; }
      pts.push([x, y]);
    }
    return { pts, at };
  };
  const readRect = (at, compressed) => (compressed ? [r.i16(at), r.i16(at + 2), r.i16(at + 4), r.i16(at + 6)] : [r.f32(at), r.f32(at + 4), r.f32(at + 8), r.f32(at + 12)]);
  const rectOps = ([x, y, w, h]) => [P.DRAW.moveTo, x, y, P.DRAW.lineTo, x + w, y, P.DRAW.lineTo, x + w, y + h, P.DRAW.lineTo, x, y + h, P.DRAW.closePath];
  const ellipseD = ([x, y, w, h], m) => { const pts = arcPoints(x + w / 2, y + h / 2, w / 2, h / 2, 0, 2 * Math.PI).map(p => P.apply(m, ...p)); let d = 'M' + f(pts[0]); for (let i = 1; i < pts.length; i += 3) d += 'C' + [pts[i], pts[i + 1], pts[i + 2]].map(f).join(' '); return d + 'Z'; };
  const arcD = ([x, y, w, h], startDeg, sweepDeg, m, pie) => {
    const a0 = startDeg * Math.PI / 180, a1 = (startDeg + sweepDeg) * Math.PI / 180, cx = x + w / 2, cy = y + h / 2;
    // GDI+ angles are those of the ellipse's own circle, clockwise as seen (y down).
    const pts = arcPoints(cx, cy, w / 2, h / 2, a0, a1).map(p => P.apply(m, ...p));
    let d = pie ? 'M' + f(P.apply(m, cx, cy)) + 'L' + f(pts[0]) : 'M' + f(pts[0]);
    for (let i = 1; i < pts.length; i += 3) d += 'C' + [pts[i], pts[i + 1], pts[i + 2]].map(f).join(' ');
    return d + (pie ? 'Z' : '');
  };
  const polyD = (pts, m, close) => pts.length < 2 ? '' : 'M' + pts.map(p => f(P.apply(m, ...p))).join('L') + (close ? 'Z' : '');
  const pathD = (path, m) => {
    let d = '';
    for (let i = 0; i < path.pts.length; i++) {
      const t = path.types[i], kind = t & 7, p = f(P.apply(m, ...path.pts[i]));
      if (kind === 0) d += 'M' + p;
      else if (kind === 3 && i + 2 < path.pts.length) { d += 'C' + p + ' ' + f(P.apply(m, ...path.pts[i + 1])) + ' ' + f(P.apply(m, ...path.pts[i + 2])); i += 2; if (path.types[i] & 0x80) d += 'Z'; continue; }
      else d += 'L' + p;
      if (t & 0x80) d += 'Z';
    }
    return d;
  };
  /** A cardinal spline (GDI+'s curves) through `pts` as Béziers, `tension` 0.5 by default. */
  const curveD = (pts, tension, m, closed) => {
    if (pts.length < 2) return '';
    const n = pts.length, k = tension / 3, at = i => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
    let d = 'M' + f(P.apply(m, ...pts[0]));
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      const c1 = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k], c2 = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
      d += 'C' + [c1, c2, p2].map(p => f(P.apply(m, ...p))).join(' ');
    }
    return d + (closed ? 'Z' : '');
  };
  const brushAttr = (flags, id, rule = '') => {
    if (flags & 0x8000) { const c = argb(id); return c.alpha ? `fill="${c.color}"${c.alpha < 1 ? ` fill-opacity="${P.num(c.alpha, 4)}"` : ''}${rule}` : 'fill="none"'; }
    const b = plus.objects.get(id);
    if (!b || b.kind !== 'brush') return 'fill="none"';
    if (b.gradient) {
      const gid = gdi.id('g'), [x, y, w, h] = b.gradient.rect, m = P.multiply(matrix(), b.gradient.transform || P.IDENTITY);
      const [x1, y1] = P.apply(m, x, y), [x2, y2] = P.apply(m, x + w, y);
      gdi.defs.push(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${P.num(x1)}" y1="${P.num(y1)}" x2="${P.num(x2)}" y2="${P.num(y2)}">` +
        b.gradient.stops.map(([o, c]) => `<stop offset="${P.num(o, 4)}" stop-color="${c.color}"${c.alpha < 1 ? ` stop-opacity="${P.num(c.alpha, 4)}"` : ''}/>`).join('') + '</linearGradient>');
      return `fill="url(#${gid})"${rule}`;
    }
    if (b.hatch != null) { const keep = gdi.dc.bkMode; gdi.dc.bkMode = b.back.alpha ? 2 : 1; const bk = gdi.dc.bkColor; gdi.dc.bkColor = b.back.color; const id2 = gdi.hatch({ hatch: b.hatch, color: b.fore.color }); gdi.dc.bkMode = keep; gdi.dc.bkColor = bk; return `fill="url(#${id2})"${rule}`; }
    if (b.unsupported) { gdi.issues.add(ISSUES.patternBrush); return `fill="#808080"${rule}`; }
    return b.alpha ? `fill="${b.color}"${b.alpha < 1 ? ` fill-opacity="${P.num(b.alpha, 4)}"` : ''}${rule}` : 'fill="none"';
  };
  const penAttr = (id, m) => {
    const p = plus.objects.get(id);
    if (!p || p.kind !== 'pen') return 'stroke="none"';
    const c = p.brush && !p.brush.gradient && p.brush.color ? p.brush : { color: '#000000', alpha: 1 };
    if (!c.alpha) return 'stroke="none"';
    const scale = P.lengthScale(m).scale;
    const w = p.width > 0 ? (p.unit === 0 || p.unit === 1 && false ? p.width * scale : p.unit === 0 ? p.width * scale : p.width * unitOut(p.unit)) : gdi.pixel;
    let a = `stroke="${c.color}" stroke-width="${P.num(w, 4)}"` + (c.alpha < 1 ? ` stroke-opacity="${P.num(c.alpha, 4)}"` : '');
    a += ` stroke-linecap="${p.cap}" stroke-linejoin="${p.join}"`;
    if (p.join === 'miter') a += ` stroke-miterlimit="${P.num(Math.max(1, p.miter), 3)}"`;
    if (p.dash && p.dash.length) a += ` stroke-dasharray="${p.dash.map(v => P.num(v * w, 4)).join(' ')}"`;
    return a;
  };
  const emit = (d, attrs) => {
    if (!d || /undefined|NaN/.test(d) || /^fill="none"( stroke="none")?$/.test(attrs.trim())) return; // nothing to see
    gdi.out.push(`<path d="${d}" ${attrs}/>`); gdi.drawn++;
  };
  const clip = (d, mode) => {
    const gdiMode = { 0: 5, 1: 1, 4: 4 }[mode];
    if (gdiMode == null) gdi.issues.add(ISSUES.region);
    gdi.clipTo(d, gdiMode ?? 5);
  };
  // An object that came in several parts is parsed from its own buffer, with the same code.
  function objectFrom(reader, type, size) { const keep = r; r = reader; try { return parseObject(type, 0, size); } finally { r = keep; } }
  function parseObject(type, at, size) {
    const brushAt = o => {
      const t = r.u32(o + 4);
      if (t === 0) return { kind: 'brush', ...argb(r.u32(o + 8)) };
      if (t === 1) return { kind: 'brush', hatch: [0, 1, 2, 3, 4, 5][r.u32(o + 8)] ?? 0, fore: argb(r.u32(o + 12)), back: argb(r.u32(o + 16)) };
      if (t === 4) { // linear gradient: its two end colours (and its transform)
        const flags = r.u32(o + 8), rect = [r.f32(o + 16), r.f32(o + 20), r.f32(o + 24), r.f32(o + 28)];
        const transform = flags & 0x2 ? [r.f32(o + 48), r.f32(o + 52), r.f32(o + 56), r.f32(o + 60), r.f32(o + 64), r.f32(o + 68)] : null;
        return { kind: 'brush', gradient: { rect, transform, stops: [[0, argb(r.u32(o + 32))], [1, argb(r.u32(o + 36))]] } };
      }
      return { kind: 'brush', unsupported: true };
    };
    if (type === 1) return brushAt(at);
    if (type === 2) { // pen: flags, unit, width, optional data in order, then its brush
      const flags = r.u32(at + 8), unit = r.u32(at + 12), width = r.f32(at + 16);
      let o = at + 20, cap = 'butt', join = 'miter', miter = 10, style = 0, dash = null;
      if (flags & 0x1) o += 24;
      if (flags & 0x2) { cap = ({ 1: 'square', 2: 'round' })[r.i32(o)] || 'butt'; o += 4; }
      if (flags & 0x4) o += 4;
      if (flags & 0x8) { join = ({ 1: 'bevel', 2: 'round' })[r.u32(o)] || 'miter'; o += 4; }
      if (flags & 0x10) { miter = r.f32(o); o += 4; }
      if (flags & 0x20) { style = r.i32(o); o += 4; }
      if (flags & 0x40) o += 4;
      if (flags & 0x80) o += 4;
      if (flags & 0x100) { const n = r.u32(o); dash = Array.from({ length: n }, (_, i) => r.f32(o + 4 + i * 4)); o += 4 + n * 4; }
      if (flags & 0x200) o += 4;
      if (flags & 0x400) { const n = r.u32(o); o += 4 + n * 4; }
      if (flags & 0x800) o += 4 + r.u32(o);
      if (flags & 0x1000) o += 4 + r.u32(o);
      if (!dash) dash = { 1: [3, 1], 2: [1, 1], 3: [3, 1, 1, 1], 4: [3, 1, 1, 1, 1, 1] }[style] || null;
      return { kind: 'pen', unit, width, cap, join, miter, dash, brush: o + 8 <= at + size ? brushAt(o) : null };
    }
    if (type === 3) { // path
      const n = r.u32(at + 4), flags = r.u32(at + 8);
      const { pts, at: after } = readPoints(at + 12, n, !!(flags & 0x4000), !!(flags & 0x0800));
      let types = [], o = after;
      if (flags & 0x1000) { while (types.length < n) { const b0 = r.u8(o), t = r.u8(o + 1); for (let k = 0; k < (b0 & 0x3f); k++) types.push(t); o += 2; } }
      else types = Array.from(r.sub(o, n));
      return { kind: 'path', pts, types };
    }
    if (type === 4) { // region: a single rectangle node only
      const nodes = r.u32(at + 4), node = r.u32(at + 8);
      if (nodes === 0 && node === 0x10000000) return { kind: 'region', rect: [r.f32(at + 12), r.f32(at + 16), r.f32(at + 20), r.f32(at + 24)] };
      if (nodes === 0 && node === 0x10000003) return { kind: 'region', infinite: true };
      return { kind: 'region', unsupported: true };
    }
    if (type === 5) { // image
      if (r.u32(at + 4) !== 1) return { kind: 'image', unsupported: true };
      const w = r.i32(at + 8), h = r.i32(at + 12), stride = r.i32(at + 16), format = r.u32(at + 20), compressed = r.u32(at + 24) === 1, data = at + 28;
      if (compressed) {
        const b = r.sub(data, at + size - data), mime = b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x47 && b[1] === 0x49 ? 'image/gif' : null;
        return mime ? { kind: 'image', img: { width: w, height: h, mime, bytes: b } } : { kind: 'image', unsupported: true };
      }
      const bpp = (format >> 8) & 0xff, indexed = !!(format & 0x10000);
      let o = data, palette = null;
      if (indexed) { const count = r.u32(o + 4); palette = Array.from({ length: count }, (_, i) => r.u32(o + 8 + i * 4)); o += 8 + count * 4; }
      if (w <= 0 || h <= 0 || w * h > 64e6) return { kind: 'image', unsupported: true };
      const rgba = new Uint8ClampedArray(w * h * 4), premultiplied = format === 0x000e200b, alpha = format === 0x0026200a || premultiplied;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const row = o + y * stride, d = (y * w + x) * 4;
        let v;
        if (indexed) { const per = 8 / bpp, byte = r.u8(row + Math.floor(x / per)); v = palette[(byte >> ((per - 1 - x % per) * bpp)) & ((1 << bpp) - 1)] ?? 0xff000000; }
        else if (bpp === 32) v = r.u32(row + x * 4);
        else if (bpp === 24) v = 0xff000000 | r.u8(row + x * 3 + 2) << 16 | r.u8(row + x * 3 + 1) << 8 | r.u8(row + x * 3);
        else return { kind: 'image', unsupported: true };
        let a = alpha || indexed ? (v >>> 24) & 0xff : 255, red = (v >>> 16) & 0xff, green = (v >>> 8) & 0xff, blue = v & 0xff;
        if (premultiplied && a && a < 255) { red = Math.min(255, red * 255 / a); green = Math.min(255, green * 255 / a); blue = Math.min(255, blue * 255 / a); }
        rgba[d] = red; rgba[d + 1] = green; rgba[d + 2] = blue; rgba[d + 3] = a;
      }
      return { kind: 'image', img: { width: w, height: h, rgba } };
    }
    if (type === 6) { // font
      const em = r.f32(at + 4), unit = r.u32(at + 8), style = r.i32(at + 12), n = r.u32(at + 20);
      const face = Array.from({ length: n }, (_, i) => String.fromCharCode(r.u16(at + 24 + i * 2))).join('');
      return { kind: 'font', em, unit, bold: !!(style & 1), italic: !!(style & 2), underline: !!(style & 4), strikeout: !!(style & 8), face };
    }
    if (type === 7) return { kind: 'format', align: r.u32(at + 12), lineAlign: r.u32(at + 16) };
    return { kind: 'other' };
  }
  const text = (font, brushFlags, brushId, chars, x, y, anchor, m) => {
    if (!font || font.kind !== 'font' || !chars.trim()) return;
    const info = P.pdfFont(font.face, font);
    const scale = P.lengthScale(m).scale || 1;
    const em = font.unit === 0 || font.unit === 1 || font.unit === 2 ? font.em : font.em * unitOut(font.unit) / scale; // in world units
    const fill = brushAttr(brushFlags, brushId);
    gdi.out.push(`<text transform="${P.matrixAttr(P.multiply(m, [1, 0, 0, 1, x, y]))}" font-family="${P.escapeXML(info.family)}"${info.bold ? ' font-weight="bold"' : ''}${info.italic ? ' font-style="italic"' : ''} font-size="${P.num(em, 4)}" ${fill}${anchor}>${P.escapeXML(chars)}</text>`);
    gdi.drawn++;
    return em;
  };

  for (let at = start; at + 12 <= end;) {
    const type = r.u16(at), flags = r.u16(at + 2), size = r.u32(at + 4), o = at + 12;
    if (size < 12 || at + size > end) break;
    const m = matrix(), C = !!(flags & 0x4000), Prel = !!(flags & 0x0800), id = flags & 0xff;
    switch (type) {
      case 0x4001: plus.dpi = r.u32(o + 8) || 96; break;
      case 0x4008: { // object, maybe in several parts
        const kind = (flags >> 8) & 0x7f;
        if (flags & 0x8000) {
          const total = r.u32(o), part = r.sub(o + 4, size - 16);
          if (!plus.pending || plus.pending.id !== id) plus.pending = { id, kind, total, parts: [] };
          plus.pending.parts.push(part);
          const have = plus.pending.parts.reduce((s2, p2) => s2 + p2.length, 0);
          if (have >= total) {
            const all = new Uint8Array(have); let k = 0; for (const p2 of plus.pending.parts) { all.set(p2, k); k += p2.length; }
            plus.objects.set(id, objectFrom(new Reader(all), kind, all.length));
            plus.pending = null;
          }
        } else plus.objects.set(id, parseObject(kind, o, size - 12));
        break;
      }
      case 0x4009: { const c = argb(r.u32(o)); gdi.out.push(`<rect x="-1e6" y="-1e6" width="2e6" height="2e6" fill="${c.color}"${c.alpha < 1 ? ` fill-opacity="${P.num(c.alpha, 4)}"` : ''}/>`); break; }
      case 0x400a: { const n = r.u32(o + 4); for (let i = 0; i < n; i++) emit(P.pathData(rectOps(readRect(o + 8 + i * (C ? 8 : 16), C)), m), brushAttr(flags, r.u32(o))); break; }
      case 0x400b: { const n = r.u32(o); const d = Array.from({ length: n }, (_, i) => P.pathData(rectOps(readRect(o + 4 + i * (C ? 8 : 16), C)), m)).join(''); emit(d, 'fill="none" ' + penAttr(id, m)); break; }
      case 0x400c: { const { pts } = readPoints(o + 8, r.u32(o + 4), C, Prel); emit(polyD(pts, m, true), brushAttr(flags, r.u32(o))); break; }
      case 0x400d: { const { pts } = readPoints(o + 4, r.u32(o), C, Prel); emit(polyD(pts, m, !!(flags & 0x2000)), 'fill="none" ' + penAttr(id, m)); break; }
      case 0x400e: emit(ellipseD(readRect(o + 4, C), m), brushAttr(flags, r.u32(o))); break;
      case 0x400f: emit(ellipseD(readRect(o, C), m), 'fill="none" ' + penAttr(id, m)); break;
      case 0x4010: emit(arcD(readRect(o + 12, C), r.f32(o + 4), r.f32(o + 8), m, true), brushAttr(flags, r.u32(o))); break;
      case 0x4011: emit(arcD(readRect(o + 8, C), r.f32(o), r.f32(o + 4), m, true), 'fill="none" ' + penAttr(id, m)); break;
      case 0x4012: emit(arcD(readRect(o + 8, C), r.f32(o), r.f32(o + 4), m, false), 'fill="none" ' + penAttr(id, m)); break;
      case 0x4013: { const reg = plus.objects.get(id); if (reg && reg.rect) emit(P.pathData(rectOps(reg.rect), m), brushAttr(flags, r.u32(o))); else gdi.issues.add(ISSUES.region); break; }
      case 0x4014: { const path = plus.objects.get(id); if (path && path.kind === 'path') emit(pathD(path, m), brushAttr(flags, r.u32(o))); break; }
      case 0x4015: { const path = plus.objects.get(id); if (path && path.kind === 'path') emit(pathD(path, m), 'fill="none" ' + penAttr(r.u32(o), m)); break; }
      case 0x4016: { const { pts } = readPoints(o + 12, r.u32(o + 8), C, Prel); emit(curveD(pts, r.f32(o + 4), m, true), brushAttr(flags, r.u32(o), flags & 0x2000 ? '' : ' fill-rule="evenodd"')); break; }
      case 0x4017: { const { pts } = readPoints(o + 8, r.u32(o + 4), C, Prel); emit(curveD(pts, r.f32(o), m, true), 'fill="none" ' + penAttr(id, m)); break; }
      case 0x4018: { // DrawCurve: tension, offset, segments, points
        const { pts } = readPoints(o + 16, r.u32(o + 12), C, false), first = r.u32(o + 4), segs = r.u32(o + 8);
        const d = curveD(pts, r.f32(o), m, false);
        void first; void segs;
        emit(d, 'fill="none" ' + penAttr(id, m));
        break;
      }
      case 0x4019: {
        const { pts } = readPoints(o + 4, r.u32(o), C, Prel), q = pts.map(p => f(P.apply(m, ...p)));
        if (q.length < 4) break;
        let d = 'M' + q[0]; for (let i = 1; i + 2 < q.length; i += 3) d += 'C' + q[i] + ' ' + q[i + 1] + ' ' + q[i + 2];
        emit(d, 'fill="none" ' + penAttr(id, m));
        break;
      }
      case 0x401a: case 0x401b: { // DrawImage, DrawImagePoints
        const image = plus.objects.get(id);
        if (!image || !image.img) { gdi.issues.add(ISSUES.bitmap); break; }
        const src = { x: r.f32(o + 8), y: r.f32(o + 12), width: r.f32(o + 16), height: r.f32(o + 20) };
        let t;
        if (type === 0x401a) { const [x, y, w, h] = readRect(o + 24, C); t = P.multiply(m, [w, 0, 0, h, x, y]); }
        else { const { pts } = readPoints(o + 28, 3, C, Prel); t = P.multiply(m, [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[0][0], pts[0][1]]); }
        gdi.placeImage(image.img, t, src);
        break;
      }
      case 0x401c: { // DrawString in a layout rectangle, aligned by its string format
        const n = r.u32(o + 8), [x, y, w, h] = [r.f32(o + 12), r.f32(o + 16), r.f32(o + 20), r.f32(o + 24)];
        const chars = Array.from({ length: n }, (_, i) => String.fromCharCode(r.u16(o + 28 + i * 2))).join('');
        const format = plus.objects.get(r.u32(o + 4)) || {}, font = plus.objects.get(id);
        const ax = format.align === 1 ? x + w / 2 : format.align === 2 ? x + w : x, anchor = format.align === 1 ? ' text-anchor="middle"' : format.align === 2 ? ' text-anchor="end"' : '';
        if (!font) break;
        const scale = P.lengthScale(m).scale || 1, em = font.unit <= 2 ? font.em : font.em * unitOut(font.unit) / scale;
        const [asc, desc] = METRICS.sans;
        const by = format.lineAlign === 1 && h ? y + h / 2 + (asc - desc) * em / 2 : format.lineAlign === 2 && h ? y + h - desc * em : y + asc * em;
        text(font, flags, r.u32(o), chars, ax, by, anchor, m);
        break;
      }
      case 0x4036: { // DrawDriverString: characters at given positions
        const options = r.u32(o + 4), hasMatrix = r.u32(o + 8), n = r.u32(o + 12);
        if (!(options & 1)) { gdi.issues.add(ISSUES.glyphIndex); break; }
        const chars = Array.from({ length: n }, (_, i) => String.fromCharCode(r.u16(o + 16 + i * 2)));
        const posAt = o + 16 + n * 2, count = options & 4 ? 1 : n;
        const pos = Array.from({ length: count }, (_, i) => [r.f32(posAt + i * 8), r.f32(posAt + i * 8 + 4)]);
        const mm = hasMatrix ? P.multiply(m, [r.f32(posAt + count * 8), r.f32(posAt + count * 8 + 4), r.f32(posAt + count * 8 + 8), r.f32(posAt + count * 8 + 12), r.f32(posAt + count * 8 + 16), r.f32(posAt + count * 8 + 20)]) : m;
        const font = plus.objects.get(id);
        if (count === 1) { text(font, flags, r.u32(o), chars.join(''), pos[0][0], pos[0][1], '', mm); break; }
        let from = 0;
        for (let i = 0; i <= n; i++) if (i === n || /\s/.test(chars[i])) { if (i > from) text(font, flags, r.u32(o), chars.slice(from, i).join(''), pos[from][0], pos[from][1], '', mm); from = i + 1; }
        break;
      }
      case 0x402a: plus.world = [r.f32(o), r.f32(o + 4), r.f32(o + 8), r.f32(o + 12), r.f32(o + 16), r.f32(o + 20)]; break;
      case 0x402b: plus.world = P.IDENTITY; break;
      case 0x402c: case 0x402d: case 0x402e: case 0x402f: {
        const t = type === 0x402c ? [r.f32(o), r.f32(o + 4), r.f32(o + 8), r.f32(o + 12), r.f32(o + 16), r.f32(o + 20)]
          : type === 0x402d ? [1, 0, 0, 1, r.f32(o), r.f32(o + 4)] : type === 0x402e ? [r.f32(o), 0, 0, r.f32(o + 4), 0, 0]
          : (a => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0])(r.f32(o) * Math.PI / 180);
        plus.world = flags & 0x2000 ? P.multiply(t, plus.world) : P.multiply(plus.world, t);
        break;
      }
      case 0x4030: plus.pageUnit = flags & 0xff; plus.pageScale = r.f32(o) || 1; break;
      case 0x4025: case 0x4028: plus.stack.set(r.u32(o), { world: plus.world, pageUnit: plus.pageUnit, pageScale: plus.pageScale, clip: gdi.dc.clip }); break;
      case 0x4026: case 0x4029: {
        const s2 = plus.stack.get(r.u32(o));
        if (s2) { plus.world = s2.world; plus.pageUnit = s2.pageUnit; plus.pageScale = s2.pageScale; if (JSON.stringify(s2.clip) !== JSON.stringify(gdi.dc.clip)) { gdi.dc.clip = s2.clip; gdi.applyClip(); } }
        break;
      }
      case 0x4027: { // BeginContainer: dest rect, src rect, then the stack index
        const dst = [r.f32(o), r.f32(o + 4), r.f32(o + 8), r.f32(o + 12)], srcR = [r.f32(o + 16), r.f32(o + 20), r.f32(o + 24), r.f32(o + 28)];
        plus.stack.set(r.u32(o + 32), { world: plus.world, pageUnit: plus.pageUnit, pageScale: plus.pageScale, clip: gdi.dc.clip });
        const sx = dst[2] / (srcR[2] || 1), sy = dst[3] / (srcR[3] || 1);
        plus.world = P.multiply(plus.world, [sx, 0, 0, sy, dst[0] - srcR[0] * sx, dst[1] - srcR[1] * sy]);
        break;
      }
      case 0x4031: gdi.clipTo(null, 5); break;
      case 0x4032: clip(P.pathData(rectOps([r.f32(o), r.f32(o + 4), r.f32(o + 8), r.f32(o + 12)]), m), (flags >> 8) & 0xf); break;
      case 0x4033: { const path = plus.objects.get(id); if (path && path.kind === 'path') clip(pathD(path, m), (flags >> 8) & 0xf); break; }
      case 0x4034: {
        const reg = plus.objects.get(id);
        if (reg && reg.infinite) gdi.clipTo(null, 5);
        else if (reg && reg.rect) clip(P.pathData(rectOps(reg.rect), m), (flags >> 8) & 0xf);
        else gdi.issues.add(ISSUES.region);
        break;
      }
      case 0x4035: gdi.issues.add(ISSUES.region); break;
      case 0x4037: gdi.issues.add(ISSUES.plusStrokeFill); break; // StrokeFillPath: rare, not drawn
      default: break; // header end, GetDC, rendering hints, compositing quality, interpolation, rendering origin
    }
    at += size;
  }
}

// ===================================================== EMF =====================================================

function playEMF(bytes, image) {
  const r = new Reader(bytes);
  const bounds = [r.i32(8), r.i32(12), r.i32(16), r.i32(20)], frame = [r.i32(24), r.i32(28), r.i32(32), r.i32(36)];
  const device = [r.i32(72), r.i32(76)], mm = [r.i32(80), r.i32(84)];
  const outPerMM = device[0] > 0 && mm[0] > 0 && device[1] > 0 && mm[1] > 0 ? [device[0] / mm[0], device[1] / mm[1]] : [96 / 25.4, 96 / 25.4];
  const gdi = new Device({ outPerMM, pixel: 1, image });
  const objects = new Map();
  const stockBrush = i => (i <= 5 ? { style: STOCK_BRUSHES[i] ? 0 : 1, color: STOCK_BRUSHES[i] } : i === 18 ? { style: 0, color: '#ffffff' } : null);
  const stockPen = i => (i === 6 ? { style: 0, width: 0, cosmetic: true, color: '#ffffff' } : i === 7 || i === 19 ? { style: 0, width: 0, cosmetic: true, color: '#000000' } : i === 8 ? { style: 5 } : null);
  const pts16 = (o, n) => Array.from({ length: n }, (_, i) => [r.i16(o + i * 4), r.i16(o + i * 4 + 2)]);
  const pts32 = (o, n) => Array.from({ length: n }, (_, i) => [r.i32(o + i * 8), r.i32(o + i * 8 + 4)]);
  const rect = o => [r.i32(o), r.i32(o + 4), r.i32(o + 8), r.i32(o + 12)];
  const xform = o => [r.f32(o), r.f32(o + 4), r.f32(o + 8), r.f32(o + 12), r.f32(o + 16), r.f32(o + 20)];
  const regionPath = (o, cb) => {
    if (cb < 32) return null;
    const count = r.u32(o + 8), d = [];
    for (let i = 0; i < count; i++) { const [l, t, rr, b] = rect(o + 32 + i * 16); d.push(gdi.rectPath(l, t, rr, b, P.IDENTITY)); }
    return d.join('');
  };
  let emfPlus = false, emfPlusDual = false;
  const plusState = { dpi: 96, world: P.IDENTITY, pageUnit: 2, pageScale: 1, objects: new Map(), stack: new Map(), pending: null };
  let off = r.u32(4);
  for (let guard = 0; off + 8 <= bytes.length && guard < 5e6; guard++) {
    const type = r.u32(off), size = r.u32(off + 8 - 4);
    if (size < 8 || off + size > bytes.length) break;
    const o = off + 8;
    const dc = gdi.dc;
    switch (type) {
      case 14: off = bytes.length; continue; // EOF
      case 2: gdi.bezier(pts32(o + 20, r.u32(o + 16)), false); break; // POLYBEZIER
      case 3: gdi.polygon(pts32(o + 20, r.u32(o + 16))); break;
      case 4: gdi.polyline(pts32(o + 20, r.u32(o + 16))); break;
      case 5: gdi.bezier(pts32(o + 20, r.u32(o + 16)), true); break;
      case 6: gdi.polylineTo(pts32(o + 20, r.u32(o + 16))); break;
      case 7: case 8: case 90: case 91: { // POLYPOLYLINE, POLYPOLYGON (32 and 16 bits)
        const n = r.u32(o + 16), small = type >= 90, counts = Array.from({ length: n }, (_, i) => r.u32(o + 24 + i * 4));
        let at = o + 24 + n * 4; const lists = [];
        for (const c of counts) { lists.push(small ? pts16(at, c) : pts32(at, c)); at += c * (small ? 4 : 8); }
        if (type === 8 || type === 91) gdi.polyPolygon(lists); else for (const l of lists) gdi.polyline(l);
        break;
      }
      case 9: dc.winExt = [r.i32(o), r.i32(o + 4)]; break;
      case 10: dc.winOrg = [r.i32(o), r.i32(o + 4)]; break;
      case 11: dc.vpExt = [r.i32(o), r.i32(o + 4)]; break;
      case 12: dc.vpOrg = [r.i32(o), r.i32(o + 4)]; break;
      case 17: dc.mapMode = r.u32(o); break;
      case 18: dc.bkMode = r.u32(o); break;
      case 19: dc.polyFill = r.u32(o); break;
      case 20: dc.rop2 = r.u32(o); break;
      case 22: dc.textAlign = r.u32(o); break;
      case 24: dc.textColor = color(r.u32(o)); break;
      case 25: dc.bkColor = color(r.u32(o)); break;
      case 27: gdi.moveTo(r.i32(o), r.i32(o + 4)); break;
      case 29: { const [l, t, rr, b] = rect(o); gdi.clipTo(gdi.rectPath(l, t, rr, b), 4); break; } // EXCLUDECLIPRECT
      case 30: { const [l, t, rr, b] = rect(o); gdi.clipTo(gdi.rectPath(l, t, rr, b), 1); break; } // INTERSECTCLIPRECT
      case 31: { const [xn, xd, yn, yd] = rect(o); dc.vpExt = [dc.vpExt[0] * xn / xd, dc.vpExt[1] * yn / yd]; break; }
      case 32: { const [xn, xd, yn, yd] = rect(o); dc.winExt = [dc.winExt[0] * xn / xd, dc.winExt[1] * yn / yd]; break; }
      case 33: gdi.save(); break;
      case 34: gdi.restore(r.i32(o)); break;
      case 35: dc.world = xform(o); break;
      case 36: {
        const x = xform(o), mode = r.u32(o + 24);
        dc.world = mode === 1 ? P.IDENTITY : mode === 2 ? P.multiply(dc.world, x) : mode === 3 ? P.multiply(x, dc.world) : mode === 4 ? x : dc.world;
        break;
      }
      case 37: {
        const i = r.u32(o);
        if (i & 0x80000000) {
          const s = i & 0x7fffffff, b = stockBrush(s), p = stockPen(s);
          if (b) dc.brush = b; else if (p) dc.pen = { cap: 0, join: 0, ...p }; else if (s >= 10 && s <= 17 && s !== 15) dc.font = { height: -16, weight: 400, face: s === 10 || s === 11 || s === 16 ? 'Courier New' : 'Arial', charset: 0 };
        } else {
          const obj = objects.get(i);
          if (obj && obj.kind === 'pen') dc.pen = obj; else if (obj && obj.kind === 'brush') dc.brush = obj; else if (obj && obj.kind === 'font') dc.font = obj;
        }
        break;
      }
      case 38: { // CREATEPEN
        const style = r.u32(o + 4), width = r.i32(o + 8);
        objects.set(r.u32(o), { kind: 'pen', style: style & 0xf, width, cosmetic: width === 0, color: color(r.u32(o + 16)), cap: (style >> 8) & 0xf, join: (style >> 12) & 0xf });
        break;
      }
      case 95: { // EXTCREATEPEN
        const style = r.u32(o + 20), width = r.u32(o + 24), brushStyle = r.u32(o + 28), n = r.u32(o + 40);
        const user = Array.from({ length: Math.min(n, 16) }, (_, i) => r.u32(o + 44 + i * 4));
        if (brushStyle !== 0 && brushStyle !== 1) gdi.issues.add(ISSUES.patternBrush);
        objects.set(r.u32(o), { kind: 'pen', style: brushStyle === 1 ? 5 : style & 0xf, width, cosmetic: !(style & 0x10000), color: color(r.u32(o + 32)),
          cap: (style >> 8) & 0xf, join: (style >> 12) & 0xf, user });
        break;
      }
      case 39: { // CREATEBRUSHINDIRECT
        const style = r.u32(o + 4);
        objects.set(r.u32(o), { kind: 'brush', style, color: color(r.u32(o + 8)), hatch: r.u32(o + 12) });
        break;
      }
      case 93: case 94: objects.set(r.u32(o), { kind: 'brush', style: 3, color: null }); break; // bitmap pattern brushes
      case 40: objects.delete(r.u32(o)); break;
      case 41: gdi.angleArc(r.i32(o), r.i32(o + 4), r.u32(o + 8), r.f32(o + 12), r.f32(o + 16)); break;
      case 42: gdi.ellipse(...rect(o)); break;
      case 43: gdi.rectangle(...rect(o)); break;
      case 44: gdi.roundRect(...rect(o), r.i32(o + 16), r.i32(o + 20)); break;
      case 45: gdi.arc('arc', ...rect(o), r.i32(o + 16), r.i32(o + 20), r.i32(o + 24), r.i32(o + 28)); break;
      case 46: gdi.arc('chord', ...rect(o), r.i32(o + 16), r.i32(o + 20), r.i32(o + 24), r.i32(o + 28)); break;
      case 47: gdi.arc('pie', ...rect(o), r.i32(o + 16), r.i32(o + 20), r.i32(o + 24), r.i32(o + 28)); break;
      case 55: gdi.arc('to', ...rect(o), r.i32(o + 16), r.i32(o + 20), r.i32(o + 24), r.i32(o + 28)); break;
      case 54: gdi.lineTo(r.i32(o), r.i32(o + 4)); break;
      case 56: case 92: { // POLYDRAW
        const n = r.u32(o + 16), small = type === 92, list = small ? pts16(o + 20, n) : pts32(o + 20, n), kinds = r.sub(o + 20 + n * (small ? 4 : 8), n);
        for (let i = 0; i < n; i++) {
          const k = kinds[i] & 6;
          if (k === 6) gdi.moveTo(...list[i]);
          else if (k === 2) gdi.lineTo(...list[i]);
          else if (k === 4 && i + 2 < n) { gdi.bezier(list.slice(i, i + 3), true); i += 2; }
          if (kinds[i] & 1) gdi.closeFigure();
        }
        break;
      }
      case 57: dc.arcDir = r.u32(o); break;
      case 58: dc.miter = r.u32(o); break;
      case 59: gdi.beginPath(); break;
      case 60: gdi.endPath(); break;
      case 61: gdi.closeFigure(); break;
      case 62: gdi.usePath(true, false); break;
      case 63: gdi.usePath(true, true); break;
      case 64: gdi.usePath(false, true); break;
      case 65: break; // FLATTENPATH: the same drawing
      case 66: gdi.issues.add(ISSUES.widenPath); break;
      case 67: { const d = gdi.lastPath; gdi.lastPath = null; gdi.clipTo(d || '', r.u32(o), dc.polyFill === 1); break; } // SELECTCLIPPATH
      case 68: gdi.path = null; gdi.lastPath = null; break;
      case 70: { // COMMENT: EMF+ records are played only when there is no plain copy of the drawing
        if (size >= 20 && r.u32(o + 4) === 0x2b464d45) {
          if (!emfPlus && r.u16(o + 8) === 0x4001) emfPlusDual = !!(r.u16(o + 10) & 1);
          emfPlus = true;
          if (!emfPlusDual) playPlus(r, o + 8, o + 4 + r.u32(o), plusState, gdi);
        }
        break;
      }
      case 71: { // FILLRGN: bounds, cbRgnData, ihBrush, region
        const brush = objects.get(r.u32(o + 20)), d = regionPath(o + 24, r.u32(o + 16));
        if (d) { const keep = dc.brush; if (brush) dc.brush = brush; gdi.out.push(`<path d="${d}" ${gdi.fillAttr(false)}/>`); dc.brush = keep; gdi.drawn++; }
        break;
      }
      case 74: { const d = regionPath(o + 20, r.u32(o + 16)); if (d) { gdi.out.push(`<path d="${d}" ${gdi.fillAttr(false)}/>`); gdi.drawn++; } break; } // PAINTRGN
      case 72: case 73: gdi.issues.add(ISSUES.regionFill); break;
      case 75: { // EXTSELECTCLIPRGN
        const cb = r.u32(o), mode = r.u32(o + 4);
        gdi.clipTo(cb ? regionPath(o + 8, cb) : null, cb ? mode : 5);
        break;
      }
      case 26: gdi.issues.add(ISSUES.region); break; // OFFSETCLIPRGN
      case 76: case 77: { // BITBLT, STRETCHBLT
        const x = r.i32(o + 16), y = r.i32(o + 20), w = r.i32(o + 24), h = r.i32(o + 28), rop = r.u32(o + 32);
        // ... xSrc, ySrc, xformSrc (24 bytes), BkColorSrc, UsageSrc, offBmiSrc, cbBmiSrc, offBitsSrc, cbBitsSrc[, cxSrc, cySrc]
        const xs = r.i32(o + 36), ys = r.i32(o + 40), usage = r.u32(o + 72), offBmi = r.u32(o + 76), cbBmi = r.u32(o + 80), offBits = r.u32(o + 84);
        const sw = type === 77 ? r.i32(o + 92) : w, sh = type === 77 ? r.i32(o + 96) : h;
        if (!cbBmi) gdi.patBlt(rop, x, y, w, h);
        else if (rop !== 0x00cc0020) gdi.issues.add(ISSUES.rop);
        else gdi.bitmap({ reader: r, bmi: off + offBmi, bits: off + offBits, usage }, x, y, w, h, xs, ys, sw, sh);
        break;
      }
      case 81: { // STRETCHDIBITS
        const x = r.i32(o + 16), y = r.i32(o + 20), xs = r.i32(o + 24), ys = r.i32(o + 28), sw = r.i32(o + 32), sh = r.i32(o + 36);
        const offBmi = r.u32(o + 40), offBits = r.u32(o + 48), usage = r.u32(o + 56), rop = r.u32(o + 60), w = r.i32(o + 64), h = r.i32(o + 68);
        if (rop !== 0x00cc0020) gdi.issues.add(ISSUES.rop);
        else gdi.bitmap({ reader: r, bmi: off + offBmi, bits: off + offBits, usage }, x, y, w, h, xs, ys, sw, sh, { fromBottom: true });
        break;
      }
      case 80: { // SETDIBITSTODEVICE
        const x = r.i32(o + 16), y = r.i32(o + 20), xs = r.i32(o + 24), ys = r.i32(o + 28), sw = r.i32(o + 32), sh = r.i32(o + 36);
        gdi.bitmap({ reader: r, bmi: off + r.u32(o + 40), bits: off + r.u32(o + 48), usage: r.u32(o + 56) }, x, y, sw, sh, xs, ys, sw, sh, { fromBottom: true });
        break;
      }
      case 114: { // ALPHABLEND
        const x = r.i32(o + 16), y = r.i32(o + 20), w = r.i32(o + 24), h = r.i32(o + 28), blend = r.u32(o + 32);
        const xs = r.i32(o + 36), ys = r.i32(o + 40), usage = r.u32(o + 72), offBmi = r.u32(o + 76), offBits = r.u32(o + 84), sw = r.i32(o + 92), sh = r.i32(o + 96);
        gdi.bitmap({ reader: r, bmi: off + offBmi, bits: off + offBits, usage }, x, y, w, h, xs, ys, sw, sh, { opacity: ((blend >> 16) & 0xff) / 255, alpha: !!((blend >> 24) & 1) });
        break;
      }
      case 78: case 79: case 116: gdi.issues.add(ISSUES.rop); break; // MASKBLT, PLGBLT, TRANSPARENTBLT
      case 82: { // EXTCREATEFONTINDIRECTW
        const face = new TextDecoder('utf-16le').decode(r.sub(o + 32, 64)).split('\0')[0];
        objects.set(r.u32(o), { kind: 'font', height: r.i32(o + 4), width: r.i32(o + 8), escapement: r.i32(o + 12), weight: r.i32(o + 20), italic: r.u8(o + 24),
          underline: r.u8(o + 25), strikeout: r.u8(o + 26), charset: r.u8(o + 27), face });
        break;
      }
      case 83: case 84: { // EXTTEXTOUTA, EXTTEXTOUTW
        const advanced = r.u32(o + 16) === 2, t = o + 28;
        const x = r.i32(t), y = r.i32(t + 4), n = r.u32(t + 8), offString = r.u32(t + 12), options = r.u32(t + 16), offDx = r.u32(t + 36);
        if (options & 0x10) { gdi.issues.add(ISSUES.glyphIndex); break; }
        const raw = r.sub(off + offString, n * (type === 84 ? 2 : 1));
        const chars = type === 84 ? Array.from({ length: n }, (_, i) => String.fromCharCode(raw[i * 2] | raw[i * 2 + 1] << 8)).join('')
          : new TextDecoder(CODEPAGES[dc.font.charset] || 'windows-1252').decode(raw);
        let dx = null;
        if (offDx && off + offDx + n * 4 <= off + size) { const step = options & 0x2000 ? 8 : 4; dx = Array.from({ length: n }, (_, i) => r.i32(off + offDx + i * step)); }
        if (dx && dx.every(v => v === 0) && n > 1) dx = null;
        const box = rect(t + 20);
        gdi.text(x, y, chars, dx && n > 1 ? dx : (n === 1 && dx && dx[0] ? dx : null), options, box[2] > box[0] ? box : null, advanced);
        break;
      }
      case 85: gdi.bezier(pts16(o + 20, r.u32(o + 16)), false); break;
      case 86: gdi.polygon(pts16(o + 20, r.u32(o + 16))); break;
      case 87: gdi.polyline(pts16(o + 20, r.u32(o + 16))); break;
      case 88: gdi.bezier(pts16(o + 20, r.u32(o + 16)), true); break;
      case 89: gdi.polylineTo(pts16(o + 20, r.u32(o + 16))); break;
      case 15: { const [x, y] = [r.i32(o), r.i32(o + 4)], keep = dc.brush; dc.brush = { style: 0, color: color(r.u32(o + 8)) }; gdi.patBlt(0x00f00021, x, y, 1, 1); dc.brush = keep; break; } // SETPIXELV
      case 118: { // GRADIENTFILL
        const nVer = r.u32(o + 16), nTri = r.u32(o + 20), mode = r.u32(o + 24);
        if (mode === 2) { gdi.issues.add(ISSUES.gradientTriangle); break; }
        const v = i => { const at = o + 28 + i * 16; return { x: r.i32(at), y: r.i32(at + 4), c: '#' + [8, 10, 12].map(k => (r.u16(at + k) >> 8).toString(16).padStart(2, '0')).join('') }; };
        for (let k = 0; k < nTri; k++) {
          const at = o + 28 + nVer * 16 + k * 8, a = v(r.u32(at)), b = v(r.u32(at + 4)), m = gdi.matrix(), id = gdi.id('g');
          const [x1, y1] = P.apply(m, a.x, a.y), [x2, y2] = P.apply(m, mode === 0 ? b.x : a.x, mode === 0 ? a.y : b.y);
          gdi.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${P.num(x1)}" y1="${P.num(y1)}" x2="${P.num(x2)}" y2="${P.num(y2)}"><stop offset="0" stop-color="${a.c}"/><stop offset="1" stop-color="${b.c}"/></linearGradient>`);
          gdi.out.push(`<path d="${gdi.rectPath(a.x, a.y, b.x, b.y)}" fill="url(#${id})"/>`); gdi.drawn++;
        }
        break;
      }
      case 53: gdi.issues.add(ISSUES.floodFill); break;
      case 96: case 97: case 108: gdi.issues.add(ISSUES.otherText); break;
      case 115: if (r.u32(o)) gdi.issues.add(ISSUES.layout); break;
      case 102: case 103: gdi.issues.add(ISSUES.openGL); break;
      case 105: case 106: gdi.issues.add(ISSUES.escape); break;
      default: break; // palettes, colour management, brush origin, mapper flags, stretch mode, metaregion: nothing to draw
    }
    off += size;
  }
  let [fl, ft, fr, fb] = frame;
  let widthMM = (fr - fl) / 100, heightMM = (fb - ft) / 100;
  let viewBox;
  if (widthMM > 0 && heightMM > 0) viewBox = [fl / 100 * outPerMM[0], ft / 100 * outPerMM[1], widthMM * outPerMM[0], heightMM * outPerMM[1]];
  else { // no frame: the bounds, in device pixels
    viewBox = [bounds[0], bounds[1], Math.max(1, bounds[2] - bounds[0]), Math.max(1, bounds[3] - bounds[1])];
    widthMM = viewBox[2] / outPerMM[0]; heightMM = viewBox[3] / outPerMM[1];
  }
  return { svg: gdi.svg(viewBox, widthMM, heightMM), issues: [...gdi.issues], widthMM, heightMM, drawn: gdi.drawn, emfPlus };
}

// ===================================================== WMF =====================================================

function playWMF(bytes, image) {
  const r = new Reader(bytes);
  let start = 0, box = null, inch = 0;
  if (r.u32(0) === 0x9ac6cdd7) {
    box = [r.i16(6), r.i16(8), r.i16(10), r.i16(12)]; inch = r.u16(14) || 1440; start = 22;
  }
  const headerWords = r.u16(start + 2);
  let off = start + headerWords * 2;
  // Without a placeable header the picture's size is not in the file: its window, at 96 units per inch.
  let sized = !!box;
  if (!box) {
    let probe = off;
    for (let guard = 0; probe + 6 <= bytes.length && guard < 1e6; guard++) {
      const size = r.u32(probe) * 2, fn = r.u16(probe + 4);
      if (fn === 0x020c) { box = [0, 0, r.i16(probe + 8), r.i16(probe + 6)]; break; }
      if (!size || fn === 0) break;
      probe += size;
    }
    if (box) { let probe2 = start + headerWords * 2; for (let g = 0; probe2 + 6 <= bytes.length && g < 1e6; g++) { const s = r.u32(probe2) * 2, fn = r.u16(probe2 + 4); if (fn === 0x020b) { box[0] = r.i16(probe2 + 8); box[1] = r.i16(probe2 + 6); box[2] += box[0]; box[3] += box[1]; break; } if (!s || fn === 0) break; probe2 += s; } }
    box ||= [0, 0, 1000, 1000];
    inch = 96;
  }
  const [bl, bt, br, bb] = box, bw = br - bl || 1, bh = bb - bt || 1;
  const perMM = inch / 25.4;
  const gdi = new Device({ outPerMM: [perMM, perMM], pixel: inch / 96, image });
  const dc = gdi.dc;
  dc.winOrg = [bl, bt]; dc.winExt = [bw, bh]; dc.vpOrg = [bl, bt]; dc.vpExt = [bw, bh];
  const slots = [];
  const add = obj => { let i = slots.indexOf(undefined); if (i < 0) i = slots.length; slots[i] = obj; };
  const decode = (o, n, charset) => new TextDecoder(CODEPAGES[charset] || 'windows-1252').decode(r.sub(o, n));
  for (let guard = 0; off + 6 <= bytes.length && guard < 5e6; guard++) {
    const size = r.u32(off) * 2, fn = r.u16(off + 4), o = off + 6, d = gdi.dc;
    if (size < 6) break;
    const p = i => r.i16(o + i * 2), pu = i => r.u16(o + i * 2);
    const pts = (at, n) => Array.from({ length: n }, (_, i) => [r.i16(at + i * 4), r.i16(at + i * 4 + 2)]);
    switch (fn) {
      case 0x0000: off = bytes.length; continue;
      case 0x0201: d.bkColor = color(r.u32(o)); break;
      case 0x0102: d.bkMode = pu(0); break;
      case 0x0103: d.mapMode = pu(0); break;
      case 0x0104: d.rop2 = pu(0); break;
      case 0x0106: d.polyFill = pu(0); break;
      case 0x0108: d.charExtra = p(0); break;
      case 0x0209: d.textColor = color(r.u32(o)); break;
      case 0x020b: d.winOrg = [p(1), p(0)]; break;
      case 0x020c: d.winExt = [p(1), p(0)]; break;
      case 0x020d: d.vpOrg = [p(1), p(0)]; break;
      case 0x020e: d.vpExt = [p(1), p(0)]; break;
      case 0x020f: d.winOrg = [d.winOrg[0] + p(1), d.winOrg[1] + p(0)]; break;
      case 0x0211: d.vpOrg = [d.vpOrg[0] + p(1), d.vpOrg[1] + p(0)]; break;
      case 0x0410: d.winExt = [d.winExt[0] * p(3) / p(2), d.winExt[1] * p(1) / p(0)]; break;
      case 0x0412: d.vpExt = [d.vpExt[0] * p(3) / p(2), d.vpExt[1] * p(1) / p(0)]; break;
      case 0x0213: gdi.lineTo(p(1), p(0)); break;
      case 0x0214: gdi.moveTo(p(1), p(0)); break;
      case 0x0415: gdi.clipTo(gdi.rectPath(p(3), p(2), p(1), p(0)), 4); break;
      case 0x0416: gdi.clipTo(gdi.rectPath(p(3), p(2), p(1), p(0)), 1); break;
      case 0x0817: gdi.arc('arc', p(7), p(6), p(5), p(4), p(3), p(2), p(1), p(0)); break;
      case 0x081a: gdi.arc('pie', p(7), p(6), p(5), p(4), p(3), p(2), p(1), p(0)); break;
      case 0x0830: gdi.arc('chord', p(7), p(6), p(5), p(4), p(3), p(2), p(1), p(0)); break;
      case 0x0418: gdi.ellipse(p(3), p(2), p(1), p(0)); break;
      case 0x041b: gdi.rectangle(p(3), p(2), p(1), p(0)); break;
      case 0x061c: gdi.roundRect(p(5), p(4), p(3), p(2), p(1), p(0)); break;
      case 0x061d: gdi.patBlt(r.u32(o), p(5), p(4), p(3), p(2)); break; // PATBLT: rop, height, width, y, x
      case 0x041f: { const keep = d.brush; d.brush = { style: 0, color: color(r.u32(o)) }; gdi.patBlt(0x00f00021, p(3), p(2), 1, 1); d.brush = keep; break; }
      case 0x001e: gdi.save(); break;
      case 0x0127: gdi.restore(p(0)); break;
      case 0x0324: gdi.polygon(pts(o + 2, pu(0))); break;
      case 0x0325: gdi.polyline(pts(o + 2, pu(0))); break;
      case 0x0538: { // POLYPOLYGON
        const n = pu(0), counts = Array.from({ length: n }, (_, i) => pu(1 + i)); let at = o + 2 + n * 2; const lists = [];
        for (const c of counts) { lists.push(pts(at, c)); at += c * 4; }
        gdi.polyPolygon(lists);
        break;
      }
      case 0x012d: { // SELECTOBJECT
        const obj = slots[pu(0)];
        if (obj && obj.kind === 'pen') d.pen = obj; else if (obj && obj.kind === 'brush') d.brush = obj; else if (obj && obj.kind === 'font') d.font = obj;
        else if (obj && obj.kind === 'region') gdi.clipTo(obj.d, 5);
        break;
      }
      case 0x012c: { const obj = slots[pu(0)]; gdi.clipTo(obj && obj.kind === 'region' ? obj.d : null, 5); break; } // SELECTCLIPREGION
      case 0x01f0: slots[pu(0)] = undefined; break;
      case 0x02fa: { // CREATEPENINDIRECT
        const style = pu(0), width = p(1);
        add({ kind: 'pen', style: style & 0xf, width, cosmetic: width === 0, color: color(r.u32(o + 6)), cap: (style >> 8) & 0xf, join: (style >> 12) & 0xf });
        break;
      }
      case 0x02fc: add({ kind: 'brush', style: pu(0), color: color(r.u32(o + 2)), hatch: pu(3) }); break;
      case 0x02fb: { // CREATEFONTINDIRECT
        const end = Math.min(o + size - 6, o + 18 + 32);
        const nameBytes = r.sub(o + 18, end - (o + 18)), zero = nameBytes.indexOf(0);
        const charset = r.u8(o + 13);
        add({ kind: 'font', height: p(0), width: p(1), escapement: p(2), weight: p(4), italic: r.u8(o + 10), underline: r.u8(o + 11), strikeout: r.u8(o + 12), charset,
          face: decode(o + 18, zero < 0 ? nameBytes.length : zero, 0) });
        break;
      }
      case 0x00f7: add({ kind: 'palette' }); break;
      case 0x01f9: case 0x0142: add({ kind: 'brush', style: 3, color: null }); break;
      case 0x06ff: { // CREATEREGION: its scans become rectangles
        const scans = pu(6), rects = []; let at = o + 20;
        for (let s = 0; s < scans && at + 6 <= o + size - 6; s++) {
          const count = r.u16(at), top = r.i16(at + 2), bottom = r.i16(at + 4);
          for (let k = 0; k < count / 2; k++) rects.push(gdi.rectPath(r.i16(at + 6 + k * 4), top, r.i16(at + 8 + k * 4), bottom));
          at += 8 + count * 2;
        }
        add({ kind: 'region', d: rects.join('') });
        break;
      }
      case 0x0228: { const reg = slots[pu(0)], brush = slots[pu(1)]; if (reg && reg.d) { const keep = d.brush; if (brush) d.brush = brush; gdi.out.push(`<path d="${reg.d}" ${gdi.fillAttr(false)}/>`); d.brush = keep; gdi.drawn++; } break; }
      case 0x012b: { const reg = slots[pu(0)]; if (reg && reg.d) { gdi.out.push(`<path d="${reg.d}" ${gdi.fillAttr(false)}/>`); gdi.drawn++; } break; }
      case 0x0429: case 0x012a: gdi.issues.add(ISSUES.regionFill); break;
      case 0x012e: d.textAlign = pu(0); break;
      case 0x0521: { // TEXTOUT: length, string (even), y, x
        const n = pu(0), padded = n + (n & 1), y = r.i16(o + 2 + padded), x = r.i16(o + 4 + padded);
        gdi.text(x, y, decode(o + 2, n, d.font.charset), null, 0, null);
        break;
      }
      case 0x0a32: { // EXTTEXTOUT: y, x, length, options, [rect], string (even), [dx]
        const y = p(0), x = p(1), n = pu(2), options = pu(3);
        let at = o + 8, box2 = null;
        if (options & 0x6) { box2 = [r.i16(at), r.i16(at + 2), r.i16(at + 4), r.i16(at + 6)]; at += 8; }
        const chars = decode(at, n, d.font.charset);
        at += n + (n & 1);
        const dx = at + n * 2 <= off + size ? Array.from({ length: n }, (_, i) => r.i16(at + i * 2)) : null;
        gdi.text(x, y, chars, dx, options, box2);
        break;
      }
      case 0x0940: case 0x0b41: case 0x0f43: { // DIBBITBLT, DIBSTRETCHBLT, STRETCHDIB
        const rop = r.u32(o);
        let q = 2, usage = 0;
        if (fn === 0x0f43) { usage = pu(2); q = 3; }
        let sh, sw, ys, xs, h, w, y, x;
        if (fn === 0x0940) { ys = p(q); xs = p(q + 1); h = p(q + 2); w = p(q + 3); y = p(q + 4); x = p(q + 5); sh = h; sw = w; q += 6; }
        else { sh = p(q); sw = p(q + 1); ys = p(q + 2); xs = p(q + 3); h = p(q + 4); w = p(q + 5); y = p(q + 6); x = p(q + 7); q += 8; }
        if (size - 6 - q * 2 < 12) { // no bitmap (a reserved word instead): the destination is the last four words
          const n = (size - 6) / 2;
          gdi.patBlt(rop, p(n - 1), p(n - 2), p(n - 3), p(n - 4));
          break;
        }
        if (rop !== 0x00cc0020) { gdi.issues.add(ISSUES.rop); break; }
        const bmi = o + q * 2, headerSize = r.u32(bmi);
        const bpp = headerSize === 12 ? r.u16(bmi + 10) : r.u16(bmi + 14), compression = headerSize === 12 ? 0 : r.u32(bmi + 16), used = headerSize === 12 ? 0 : r.u32(bmi + 32);
        const colours = bpp <= 8 ? (used || 1 << bpp) : 0, masks = compression === 3 && headerSize === 40 ? 12 : 0;
        const bits = bmi + headerSize + masks + colours * (headerSize === 12 ? 3 : usage === 1 ? 2 : 4);
        gdi.bitmap({ reader: r, bmi, bits, usage }, x, y, w, h, xs, ys, sw, sh, { fromBottom: fn === 0x0f43 });
        break;
      }
      case 0x0626: break; // ESCAPE: comments and printer settings; nothing to draw
      case 0x0419: case 0x0548: gdi.issues.add(ISSUES.floodFill); break;
      case 0x0d33: gdi.issues.add(ISSUES.bitmap); break;
      default: break;
    }
    off += size;
  }
  return { svg: gdi.svg([bl, bt, bw, bh], bw / perMM, bh / perMM), issues: [...gdi.issues], widthMM: bw / perMM, heightMM: bh / perMM, drawn: gdi.drawn, sized: !!sized };
}

/**
 * An EMF or WMF file's bytes as SVG: { kind, svg, issues: [what it could not reproduce], widthMM,
 * heightMM, sized (false: a WMF with no size of its own, given 96 units per inch) }. `image(bitmap,
 * source rectangle)` turns a decoded bitmap into an image URL. Throws with a message when the file
 * is neither, or holds nothing this can draw.
 */
export function metafileToSVG(bytes, { image = null, name = 'The file' } = {}) {
  const kind = metafileKind(bytes);
  if (!kind) throw new Error(`${name} is not a readable EMF or WMF file.`);
  const result = kind === 'emf' ? playEMF(bytes, image) : playWMF(bytes, image);
  if (!result.drawn) throw new Error(`${name} draws nothing FluoForge can read.`);
  return { kind, sized: result.sized !== false, ...result };
}

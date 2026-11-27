/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* A small TrueType reader (P3-T10c): character advances, the character map and glyph outlines.
   The EPS reader (js/image/postscript.js) uses it for fonts embedded in an EPS as Type 42 (cairo,
   for example) and for the widths of the bundled Liberation faces, which stand in for Helvetica,
   Times and Courier. Pure: no DOM. Outlines use pdf.js's path operators (DRAW in pdf-vector-model.js). */

import { DRAW } from './pdf-vector-model.js';

/** Reads the TrueType font in `bytes`; throws when it is not one. */
export function parseTrueType(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = o => v.getUint16(o), i16 = o => v.getInt16(o), u32 = o => v.getUint32(o);
  const version = u32(0);
  if (version !== 0x00010000 && version !== 0x74727565) throw new Error('Not a TrueType font.');
  const tables = {};
  for (let i = 0, n = u16(4); i < n; i++) {
    const at = 12 + i * 16, tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    tables[tag] = { offset: u32(at + 8), length: u32(at + 12) };
  }
  const head = tables.head, maxp = tables.maxp, hhea = tables.hhea, hmtx = tables.hmtx;
  if (!head) throw new Error('The TrueType font has no head table.');
  const unitsPerEm = u16(head.offset + 18) || 1000, longLoca = i16(head.offset + 50) === 1;
  const numGlyphs = maxp ? u16(maxp.offset + 4) : 0;
  const numberOfHMetrics = hhea ? u16(hhea.offset + 34) : 0;

  const advance = gid => {
    if (!hmtx || !numberOfHMetrics) return unitsPerEm / 2;
    return u16(hmtx.offset + Math.min(gid, numberOfHMetrics - 1) * 4);
  };

  // The character map: (3,10) format 12, (3,1) or (0,*) format 4 or 12, or (3,0) symbol.
  let map = null, symbol = false;
  if (tables.cmap) {
    const c = tables.cmap.offset, subs = [];
    for (let i = 0, n = u16(c + 2); i < n; i++) subs.push({ platform: u16(c + 4 + i * 8), encoding: u16(c + 6 + i * 8), offset: c + u32(c + 8 + i * 8) });
    const pick = subs.find(s => s.platform === 3 && s.encoding === 10) || subs.find(s => s.platform === 3 && s.encoding === 1) || subs.find(s => s.platform === 0) ||
      subs.find(s => s.platform === 3 && s.encoding === 0);
    if (pick) {
      symbol = pick.platform === 3 && pick.encoding === 0;
      const at = pick.offset, format = u16(at);
      if (format === 4) {
        const segX2 = u16(at + 6), ends = at + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
        map = code => {
          for (let s = 0; s < segX2 / 2; s++) {
            const end = u16(ends + s * 2);
            if (code > end) continue;
            const start = u16(starts + s * 2);
            if (code < start) return 0;
            const delta = i16(deltas + s * 2), range = u16(ranges + s * 2);
            if (!range) return (code + delta) & 0xffff;
            const g = u16(ranges + s * 2 + range + (code - start) * 2);
            return g ? (g + delta) & 0xffff : 0;
          }
          return 0;
        };
      } else if (format === 12) {
        const n = u32(at + 12);
        map = code => {
          for (let s = 0; s < n; s++) {
            const g = at + 16 + s * 12, start = u32(g), end = u32(g + 4);
            if (code >= start && code <= end) return u32(g + 8) + code - start;
          }
          return 0;
        };
      } else if (format === 0) map = code => (code < 256 ? bytes[at + 6 + code] : 0);
    }
  }
  const glyphIndex = code => {
    if (!map) return 0;
    const g = map(code);
    return g || (symbol && code < 0x100 ? map(0xf000 + code) : 0);
  };

  const glyphAt = gid => {
    const loca = tables.loca, glyf = tables.glyf;
    if (!loca || !glyf || gid < 0 || gid >= numGlyphs) return null;
    const off = longLoca ? u32(loca.offset + gid * 4) : u16(loca.offset + gid * 2) * 2;
    const next = longLoca ? u32(loca.offset + gid * 4 + 4) : u16(loca.offset + gid * 2 + 2) * 2;
    return next > off ? glyf.offset + off : null;
  };
  /** The outline of glyph `gid` in font units (y up), as path operators; [] for an empty glyph. */
  function outline(gid, depth = 0) {
    const at = glyphAt(gid);
    if (at == null || depth > 8) return [];
    const contours = i16(at);
    if (contours < 0) { // composite: components placed by offsets (and scaled)
      const out = [];
      let o = at + 10, flags;
      do {
        flags = u16(o); const child = u16(o + 2); o += 4;
        let dx, dy;
        if (flags & 1) { dx = i16(o); dy = i16(o + 2); o += 4; } else { dx = v.getInt8(o); dy = v.getInt8(o + 1); o += 2; }
        if (!(flags & 2)) { dx = 0; dy = 0; } // point matching: rare, not supported
        let a = 1, b = 0, c = 0, d = 1;
        const f2 = p => i16(p) / 16384;
        if (flags & 8) { a = d = f2(o); o += 2; } else if (flags & 0x40) { a = f2(o); d = f2(o + 2); o += 4; } else if (flags & 0x80) { a = f2(o); b = f2(o + 2); c = f2(o + 4); d = f2(o + 6); o += 8; }
        const part = outline(child, depth + 1);
        for (let i = 0; i < part.length;) {
          const op = part[i++]; out.push(op);
          const n = op === DRAW.closePath ? 0 : op === DRAW.quadraticCurveTo ? 2 : 1;
          for (let k = 0; k < n; k++) { const x = part[i++], y = part[i++]; out.push(a * x + c * y + dx, b * x + d * y + dy); }
        }
      } while (flags & 0x20);
      return out;
    }
    const endPts = Array.from({ length: contours }, (_, i) => u16(at + 10 + i * 2));
    const count = contours ? endPts[contours - 1] + 1 : 0;
    let o = at + 10 + contours * 2;
    o += 2 + u16(o); // instructions
    const flags = [];
    while (flags.length < count) { const f = bytes[o++]; flags.push(f); if (f & 8) { let r = bytes[o++]; while (r-- > 0) flags.push(f); } }
    const xs = [], ys = [];
    let x = 0, y = 0;
    for (const f of flags) { if (f & 2) { x += f & 16 ? bytes[o] : -bytes[o]; o += 1; } else if (!(f & 16)) { x += i16(o); o += 2; } xs.push(x); }
    for (const f of flags) { if (f & 4) { y += f & 32 ? bytes[o] : -bytes[o]; o += 1; } else if (!(f & 32)) { y += i16(o); o += 2; } ys.push(y); }
    const out = [];
    let start = 0;
    for (const end of endPts) {
      const pts = [];
      for (let i = start; i <= end; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
      start = end + 1;
      if (!pts.length) continue;
      // Start on an on-curve point (or the midpoint of two off-curve ones).
      let first = pts.findIndex(p => p.on), ring;
      if (first < 0) { const m = { x: (pts[0].x + pts[1 % pts.length].x) / 2, y: (pts[0].y + pts[1 % pts.length].y) / 2, on: true }; ring = [m, ...pts.slice(1), pts[0]]; }
      else ring = [...pts.slice(first), ...pts.slice(0, first)];
      out.push(DRAW.moveTo, ring[0].x, ring[0].y);
      for (let i = 1; i <= ring.length; i++) {
        const p = ring[i % ring.length];
        if (p.on) { out.push(DRAW.lineTo, p.x, p.y); continue; }
        const q = ring[(i + 1) % ring.length];
        const endPt = q.on ? q : { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        out.push(DRAW.quadraticCurveTo, p.x, p.y, endPt.x, endPt.y);
        if (q.on) i++;
      }
      out.push(DRAW.closePath);
    }
    return out;
  }
  return { unitsPerEm, numGlyphs, advance, glyphIndex, outline };
}

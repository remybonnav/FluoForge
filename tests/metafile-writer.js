// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* Writes small EMF and WMF files for the tests (P3-T10b): tests/metafile-regression.mjs (Node) and
   tests/metafile-import-regression.js (browser) build the files they read with these.
   A record is a list of fields: ['u8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32', value], ['utf16', text,
   bytes] (zero-padded), ['ascii', text, bytes], or ['bytes', Uint8Array]. */

function fieldBytes(fields) {
  const parts = [];
  for (const [kind, value, size] of fields) {
    if (kind === 'bytes') { parts.push(Uint8Array.from(value)); continue; }
    if (kind === 'utf16' || kind === 'ascii') {
      const b = new Uint8Array(size ?? (kind === 'utf16' ? value.length * 2 : value.length));
      for (let i = 0; i < value.length; i++) { if (kind === 'utf16') { b[i * 2] = value.charCodeAt(i) & 0xff; b[i * 2 + 1] = value.charCodeAt(i) >> 8; } else b[i] = value.charCodeAt(i); }
      parts.push(b); continue;
    }
    const n = { u8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4 }[kind], b = new Uint8Array(n), v = new DataView(b.buffer);
    if (kind === 'u8') v.setUint8(0, value); else if (kind === 'u16') v.setUint16(0, value, true); else if (kind === 'i16') v.setInt16(0, value, true);
    else if (kind === 'u32') v.setUint32(0, value >>> 0, true); else if (kind === 'i32') v.setInt32(0, value, true); else v.setFloat32(0, value, true);
    parts.push(b);
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const concat = list => { const out = new Uint8Array(list.reduce((s, p) => s + p.length, 0)); let at = 0; for (const p of list) { out.set(p, at); at += p.length; } return out; };

/** An EMF: `widthMM` × `heightMM` on a reference device of `dpi`. rec(type, ...fields) adds a record; bytes() finishes it. */
export class EMFWriter {
  constructor({ widthMM = 100, heightMM = 50, dpi = 96 } = {}) {
    this.widthMM = widthMM; this.heightMM = heightMM; this.dpi = dpi; this.records = [];
  }
  rec(type, ...fields) {
    let body = fieldBytes(fields);
    if (body.length % 4) body = concat([body, new Uint8Array(4 - body.length % 4)]);
    this.records.push(concat([fieldBytes([['u32', type], ['u32', body.length + 8]]), body]));
    return this;
  }
  /** A record whose fields are given as a list, with a body length the caller fixes (for offsets). */
  raw(type, body) { this.records.push(concat([fieldBytes([['u32', type], ['u32', body.length + 8]]), body])); return this; }
  bytes() {
    const px = mm => Math.round(mm * this.dpi / 25.4);
    const end = fieldBytes([['u32', 14], ['u32', 20], ['u32', 0], ['u32', 16], ['u32', 20]]);
    const size = 108 + this.records.reduce((s, r) => s + r.length, 0) + end.length;
    const header = fieldBytes([['u32', 1], ['u32', 108],
      ['i32', 0], ['i32', 0], ['i32', px(this.widthMM)], ['i32', px(this.heightMM)], // bounds (device)
      ['i32', 0], ['i32', 0], ['i32', Math.round(this.widthMM * 100)], ['i32', Math.round(this.heightMM * 100)], // frame (0.01 mm)
      ['u32', 0x464d4520], ['u32', 0x10000], ['u32', size], ['u32', this.records.length + 2], ['u16', 8], ['u16', 0], ['u32', 0], ['u32', 0], ['u32', 0],
      ['i32', px(254)], ['i32', px(254)], ['i32', 254], ['i32', 254], // reference device: 254 mm at `dpi`
      ['u32', 0], ['u32', 0], ['u32', 0], ['i32', 254000], ['i32', 254000]]);
    return concat([header, ...this.records, end]);
  }
}

/** A WMF with a placeable header: logical `box` [left, top, right, bottom] at `inch` units per inch (none: no placeable header). */
export class WMFWriter {
  constructor({ box = [0, 0, 1440, 720], inch = 1440, placeable = true } = {}) { this.box = box; this.inch = inch; this.placeable = placeable; this.records = []; }
  rec(fn, ...fields) {
    let body = fieldBytes(fields);
    if (body.length % 2) body = concat([body, new Uint8Array(1)]);
    this.records.push(concat([fieldBytes([['u32', (body.length + 6) / 2], ['u16', fn]]), body]));
    return this;
  }
  bytes() {
    const end = fieldBytes([['u32', 3], ['u16', 0]]);
    const words = (18 + this.records.reduce((s, r) => s + r.length, 0) + end.length) / 2;
    const header = fieldBytes([['u16', 1], ['u16', 9], ['u16', 0x300], ['u32', words], ['u16', 16], ['u32', 64], ['u16', 0]]);
    const parts = [header, ...this.records, end];
    if (this.placeable) {
      const p = fieldBytes([['u32', 0x9ac6cdd7], ['u16', 0], ['i16', this.box[0]], ['i16', this.box[1]], ['i16', this.box[2]], ['i16', this.box[3]], ['u16', this.inch], ['u32', 0]]);
      const v = new DataView(p.buffer); let sum = 0; for (let i = 0; i < 10; i++) sum ^= v.getUint16(i * 2, true);
      parts.unshift(p, fieldBytes([['u16', sum]]));
    }
    return concat(parts);
  }
}

/** A bottom-up 24-bit DIB (BITMAPINFOHEADER and pixels) of `rows` (top row first) of [r, g, b]. */
export function dib24(rows) {
  const h = rows.length, w = rows[0].length, stride = Math.ceil(w * 3 / 4) * 4;
  const header = fieldBytes([['u32', 40], ['i32', w], ['i32', h], ['u16', 1], ['u16', 24], ['u32', 0], ['u32', stride * h], ['i32', 2835], ['i32', 2835], ['u32', 0], ['u32', 0]]);
  const bits = new Uint8Array(stride * h);
  rows.forEach((row, y) => row.forEach(([r, g, b], x) => { const o = (h - 1 - y) * stride + x * 3; bits[o] = b; bits[o + 1] = g; bits[o + 2] = r; }));
  return { header, bits };
}
/** An 8-bit palette DIB, top-down (negative height), of `rows` of palette indices. */
export function dib8(palette, rows) {
  const h = rows.length, w = rows[0].length, stride = Math.ceil(w / 4) * 4;
  const header = fieldBytes([['u32', 40], ['i32', w], ['i32', -h], ['u16', 1], ['u16', 8], ['u32', 0], ['u32', stride * h], ['i32', 0], ['i32', 0], ['u32', palette.length], ['u32', 0],
    ...palette.flatMap(([r, g, b]) => [['u8', b], ['u8', g], ['u8', r], ['u8', 0]])]);
  const bits = new Uint8Array(stride * h);
  rows.forEach((row, y) => row.forEach((v, x) => { bits[y * stride + x] = v; }));
  return { header, bits };
}

/** STRETCHDIBITS (EMF 81) of a DIB into logical (x, y, w, h). */
export function stretchDIBits(writer, { header, bits }, x, y, w, h, src = null) {
  const width = new DataView(header.buffer).getInt32(4, true), height = Math.abs(new DataView(header.buffer).getInt32(8, true));
  const [sx, sy, sw, sh] = src || [0, 0, width, height];
  const fixed = 72 + 8; // the record's fields after type and size come to 72 bytes; offsets count from the record start
  writer.raw(81, concat([fieldBytes([['i32', x], ['i32', y], ['i32', x + w], ['i32', y + h], ['i32', x], ['i32', y], ['i32', sx], ['i32', sy], ['i32', sw], ['i32', sh],
    ['u32', fixed], ['u32', header.length], ['u32', fixed + header.length], ['u32', bits.length], ['u32', 0], ['u32', 0x00cc0020], ['i32', w], ['i32', h]]), header, bits]));
}

/** EXTTEXTOUTW (EMF 84): `text` at (x, y), with advances `dx` (or none), ExtTextOut `options`, graphics mode `mode`. */
export function textW(writer, x, y, text, dx = null, { options = 0, rect = [0, 0, -1, -1], mode = 1 } = {}) {
  const n = text.length, fixed = 8 + 28 + 40; // type and size, bounds + mode + scales, EMRTEXT
  const strBytes = Math.ceil(n * 2 / 4) * 4;
  writer.raw(84, concat([fieldBytes([['i32', 0], ['i32', 0], ['i32', -1], ['i32', -1], ['u32', mode], ['f32', 1], ['f32', 1],
    ['i32', x], ['i32', y], ['u32', n], ['u32', fixed], ['u32', options], ['i32', rect[0]], ['i32', rect[1]], ['i32', rect[2]], ['i32', rect[3]], ['u32', dx ? fixed + strBytes : 0]]),
  fieldBytes([['utf16', text, strBytes]]), dx ? fieldBytes(dx.map(v => ['i32', v])) : new Uint8Array(0)]));
}

/** EMF+ records wrapped in an EMF comment: `records` is a list of [type, flags, fields]. */
export function emfPlus(writer, records) {
  const parts = records.map(([type, flags, fields]) => { let body = fieldBytes(fields); if (body.length % 4) body = concat([body, new Uint8Array(4 - body.length % 4)]); return concat([fieldBytes([['u16', type], ['u16', flags], ['u32', body.length + 12], ['u32', body.length]]), body]); });
  const data = concat([fieldBytes([['u32', 0x2b464d45]]), ...parts]);
  writer.raw(70, concat([fieldBytes([['u32', data.length]]), data]));
}

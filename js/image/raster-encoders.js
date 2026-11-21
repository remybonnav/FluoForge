/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Raster file writers for the exports.
   - encodeTIFF: 8-bit RGB or RGBA (unassociated alpha) baseline TIFF, in strips, compressed with
     Deflate (pako, vendored) or LZW, with the horizontal differencing predictor, and the resolution
     tags (XResolution, YResolution, ResolutionUnit = inch) as before. Uncompressed is still possible.
   - pngWithPhys: adds a pHYs chunk (pixels per metre) to a PNG from canvas.toBlob, for a DPI or for
     a physical pixel size in µm. */

const TYPE = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5 };
export const TIFF_COMPRESSION = { none: 1, lzw: 5, deflate: 8 };
const ROWS_PER_STRIP_BYTES = 64 * 1024;

/** TIFF LZW (MSB first, codes from 9 to 12 bits, early change), as TIFF 6.0 section 13. */
export function lzwEncode(input) {
  const out = []; let acc = 0, bits = 0;
  const put = (code, width) => { acc = (acc << width) | code; bits += width; while (bits >= 8) { bits -= 8; out.push((acc >>> bits) & 0xff); } acc &= (1 << bits) - 1; };
  const CLEAR = 256, EOI = 257;
  let dict = new Map(), next = 258, width = 9;
  put(CLEAR, width);
  if (!input.length) { put(EOI, width); if (bits) out.push((acc << (8 - bits)) & 0xff); return Uint8Array.from(out); }
  let prefix = input[0];
  for (let i = 1; i < input.length; i++) {
    const c = input[i], key = prefix * 256 + c, found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    put(prefix, width);
    dict.set(key, next++);
    // The reader adds its entry one code later and widens when its table reaches 2^width − 1 entries
    // ("early change"): that is when this table reaches 2^width. Before 4096 entries, start again.
    if (next >= 4095) { put(CLEAR, width); dict = new Map(); next = 258; width = 9; }
    else if (next >= 1 << width) width++;
    prefix = c;
  }
  put(prefix, width);
  // Reading this last code adds the reader's entry for the previous one, which can widen EOI.
  if (next + 1 >= 1 << width && width < 12) width++;
  put(EOI, width);
  if (bits) out.push((acc << (8 - bits)) & 0xff);
  return Uint8Array.from(out);
}

/** Horizontal differencing (TIFF predictor 2) of interleaved 8-bit rows, in place on a copy. */
function predict(rows, width, samples) {
  const out = new Uint8Array(rows.length), stride = width * samples;
  for (let r = 0; r < rows.length / stride; r++) {
    const o = r * stride;
    for (let s = 0; s < samples; s++) out[o + s] = rows[o + s];
    for (let i = samples; i < stride; i++) out[o + i] = (rows[o + i] - rows[o + i - samples]) & 0xff;
  }
  return out;
}

/** 8-bit RGB(A) TIFF from RGBA pixels. options: { dpi, compression: 'deflate' | 'lzw' | 'none', alpha, software }. */
export function encodeTIFF(rgba, width, height, { dpi = 300, compression = 'deflate', alpha = false, software = 'FluoForge' } = {}) {
  if (!(TIFF_COMPRESSION[compression])) throw new Error('Unknown TIFF compression: ' + compression);
  const samples = alpha ? 4 : 3, rowBytes = width * samples;
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(ROWS_PER_STRIP_BYTES / rowBytes) || 1));
  const strips = [];
  for (let y = 0; y < height; y += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, height - y), raw = new Uint8Array(rows * rowBytes);
    for (let r = 0; r < rows; r++) for (let x = 0; x < width; x++) {
      const s = ((y + r) * width + x) * 4, d = r * rowBytes + x * samples;
      raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2]; if (alpha) raw[d + 3] = rgba[s + 3];
    }
    const data = compression === 'none' ? raw : predict(raw, width, samples);
    strips.push(compression === 'deflate' ? pako.deflate(data) : compression === 'lzw' ? lzwEncode(data) : data);
  }
  const dpiRational = [Math.round(dpi * 10000), 10000];
  const tags = [
    [256, TYPE.LONG, [width]], [257, TYPE.LONG, [height]], [258, TYPE.SHORT, Array(samples).fill(8)],
    [259, TYPE.SHORT, [TIFF_COMPRESSION[compression]]], [262, TYPE.SHORT, [2]],
    [273, TYPE.LONG, strips.map(() => 0)], [277, TYPE.SHORT, [samples]], [278, TYPE.LONG, [rowsPerStrip]],
    [279, TYPE.LONG, strips.map(s => s.length)], [282, TYPE.RATIONAL, dpiRational], [283, TYPE.RATIONAL, dpiRational],
    [284, TYPE.SHORT, [1]], [296, TYPE.SHORT, [2]], [305, TYPE.ASCII, software],
    ...(compression !== 'none' ? [[317, TYPE.SHORT, [2]]] : []), ...(alpha ? [[338, TYPE.SHORT, [2]]] : [])
  ].sort((a, b) => a[0] - b[0]);
  const size = { [TYPE.BYTE]: 1, [TYPE.ASCII]: 1, [TYPE.SHORT]: 2, [TYPE.LONG]: 4, [TYPE.RATIONAL]: 8 };
  const valueBytes = ([, type, v]) => (type === TYPE.ASCII ? v.length + 1 : type === TYPE.RATIONAL ? v.length / 2 : v.length) * size[type];
  const ifdSize = 2 + tags.length * 12 + 4;
  let extra = 8 + ifdSize; // values longer than 4 bytes follow the IFD
  const extraAt = new Map();
  for (const tag of tags) if (valueBytes(tag) > 4) { extraAt.set(tag[0], extra); extra += valueBytes(tag) + (valueBytes(tag) & 1); }
  let dataAt = extra;
  const offsets = strips.map(s => { const at = dataAt; dataAt += s.length; return at; });
  tags.find(t => t[0] === 273)[2] = offsets;
  const out = new Uint8Array(dataAt), view = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]); view.setUint32(4, 8, true);
  view.setUint16(8, tags.length, true);
  const write = (at, [, type, v]) => {
    if (type === TYPE.ASCII) { for (let i = 0; i < v.length; i++) out[at + i] = v.charCodeAt(i) & 0x7f; out[at + v.length] = 0; return; }
    v.forEach((n, i) => {
      if (type === TYPE.SHORT) view.setUint16(at + i * 2, n, true);
      else if (type === TYPE.LONG || type === TYPE.RATIONAL) view.setUint32(at + i * 4, n, true);
      else out[at + i] = n;
    });
  };
  tags.forEach((tag, i) => {
    const at = 10 + i * 12, [id, type, v] = tag;
    view.setUint16(at, id, true); view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, type === TYPE.ASCII ? v.length + 1 : type === TYPE.RATIONAL ? v.length / 2 : v.length, true);
    if (extraAt.has(id)) { view.setUint32(at + 8, extraAt.get(id), true); write(extraAt.get(id), tag); }
    else write(at + 8, tag);
  });
  view.setUint32(10 + tags.length * 12, 0, true);
  strips.forEach((s, i) => out.set(s, offsets[i]));
  return out;
}

// ---- PNG pHYs ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** PNG bytes with a pHYs chunk: pixelsPerMetre from { dpi } or { micronsPerPixel }. An existing pHYs is replaced. */
export function pngWithPhys(png, { dpi = null, micronsPerPixel = null } = {}) {
  const ppm = dpi ? Math.round(dpi / 0.0254) : micronsPerPixel ? Math.round(1e6 / micronsPerPixel) : 0;
  if (!(ppm > 0)) return png;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength), parts = [png.subarray(0, 8)];
  let at = 8, inserted = false;
  const chunk = new Uint8Array(21), cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); cv.setUint32(8, ppm); cv.setUint32(12, ppm); chunk[16] = 1;
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));
  while (at < png.length) {
    const length = view.getUint32(at), type = String.fromCharCode(...png.subarray(at + 4, at + 8)), end = at + 12 + length;
    if (type !== 'pHYs') parts.push(png.subarray(at, end));
    if (type === 'IHDR' && !inserted) { parts.push(chunk); inserted = true; }
    at = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** The pHYs of a PNG as { ppmX, ppmY, unit }, or null. */
export function readPhys(png) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at), type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === 'pHYs') return { ppmX: view.getUint32(at + 8), ppmY: view.getUint32(at + 12), unit: png[at + 16] };
    at += 12 + length;
  }
  return null;
}

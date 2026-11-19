/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The compositor: raw channel planes -> 8-bit RGBA. Pure functions on typed arrays, with no DOM,
   canvas or Fabric, so the same code runs in the compositing worker (js/image/composite-worker.js)
   and, when workers are unavailable, on the main thread.

   The display model is the one Fiji/ImageJ and QuPath use:
     raw value --(min, max, gamma, invert)--> index 0..255 --(channel LUT, 256 x 3)--> RGB,
   and channels are added together, each colour component clamped at 255. Raw data is never
   changed: only the displayed and exported colours are computed here.

   Resizing: when the output is smaller than the source region, each output pixel is the area
   average of the raw values it covers (a box filter with partial-pixel weights), so a fine
   pattern does not alias (moiré). When the output is the same size or larger, the nearest
   source pixel is used, so pixels stay honest. Averaging happens on raw values, before the
   display mapping, which is why a resampled plane can be cached and reused while the display
   settings change. */

import { PRESETS, namedLUT, channelLUT } from './luts.js';
export { PRESETS };

/** A single-colour preset as its 256 x 3 LUT (kept for the tests; every table is in js/image/luts.js). */
export function presetLUT(name) { return namedLUT(PRESETS[name] ? name : 'grey'); }

/**
 * Lookup from every possible raw value (0..2^bitDepth - 1) to its display index 0..255:
 * norm = (v - min) / (max - min), clamped to 0..1; then norm^gamma; then 1 - that if inverted.
 * With gamma 1 and no invert this is exactly the rounding FluoForge always used.
 */
export function levelTable({ min, max, gamma = 1, invert = false }, bitDepth) {
  const size = bitDepth > 8 ? 65536 : 256;
  const table = new Uint8ClampedArray(size);
  const range = (max - min) || 1;
  const g = gamma > 0 && Number.isFinite(gamma) ? gamma : 1;
  for (let v = 0; v < size; v++) {
    let norm = (v - min) / range;
    if (norm < 0) norm = 0; else if (norm > 1) norm = 1;
    if (g !== 1) norm = Math.pow(norm, g);
    if (invert) norm = 1 - norm;
    table[v] = norm * 255;
  }
  return table;
}

/** A channel's raw value -> packed colour (R << 20 | G << 10 | B), from its level table and LUT. */
export function colourTable(table, lut) {
  const colour = new Uint32Array(table.length);
  for (let v = 0; v < table.length; v++) { const l = table[v] * 3; colour[v] = (lut[l] << 20) | (lut[l + 1] << 10) | lut[l + 2]; }
  return colour;
}

// Colour tables by display settings, so a change to one channel rebuilds only that channel's table.
const colourCache = new Map();
function cachedColour(ch, bitDepth) {
  const key = [bitDepth > 8 ? 16 : 8, ch.min, ch.max, ch.gamma ?? 1, !!ch.invert, ch.color, ch.color === 'file' ? ch.lut : ''].join('|');
  let colour = colourCache.get(key);
  if (colour) { colourCache.delete(key); colourCache.set(key, colour); return colour; }
  colour = colourTable(levelTable(ch, bitDepth), channelLUT(ch.color, ch.lut));
  colourCache.set(key, colour);
  if (colourCache.size > 32) colourCache.delete(colourCache.keys().next().value);
  return colour;
}

/**
 * The colours of a calibration bar: 256 entries (R, G, B interleaved) from the channel's min (entry 0)
 * to its max (entry 255), through the same gamma, invert and LUT as the image.
 */
export function calibrationColours(ch) {
  const lut = channelLUT(ch.color, ch.lut), out = new Uint8Array(768), level = new Uint8ClampedArray(1);
  const g = ch.gamma > 0 && Number.isFinite(ch.gamma) ? ch.gamma : 1;
  for (let k = 0; k < 256; k++) {
    let norm = k / 255;
    if (g !== 1) norm = Math.pow(norm, g);
    if (ch.invert) norm = 1 - norm;
    level[0] = norm * 255;
    out.set(lut.subarray(level[0] * 3, level[0] * 3 + 3), k * 3);
  }
  return out;
}

/** Maximum or mean intensity projection of a list of Z planes (all the same length and type). */
export function projectPlanes(zs, mode) {
  const n = zs[0].length, out = new (zs[0].constructor)(n);
  if (mode === 'max') {
    out.set(zs[0]);
    for (let z = 1; z < zs.length; z++) { const p = zs[z]; for (let i = 0; i < n; i++) if (p[i] > out[i]) out[i] = p[i]; }
  } else {
    const sum = new Float64Array(n);
    for (const p of zs) for (let i = 0; i < n; i++) sum[i] += p[i];
    for (let i = 0; i < n; i++) out[i] = Math.round(sum[i] / zs.length);
  }
  return out;
}

/**
 * How each output column (or row) samples the source along one axis.
 * Returns { averaging, first[], count[], index[], weight[] }: output position k reads
 * index[first[k] .. first[k] + count[k]) with the matching weights (summing to the in-bounds
 * part of the footprint). Nearest-neighbour when the output is not smaller than the region.
 */
function axisSamples(start, length, dst, srcSize) {
  const step = length / dst;
  const first = new Int32Array(dst), count = new Int32Array(dst);
  if (step <= 1) {
    // Nearest neighbour: the same formula as before, so 1:1 and enlarged panels are unchanged.
    const index = new Int32Array(dst), weight = new Float64Array(dst);
    for (let k = 0; k < dst; k++) {
      const s = Math.floor(start + k * length / dst);
      first[k] = k; count[k] = s >= 0 && s < srcSize ? 1 : 0; index[k] = s; weight[k] = 1;
    }
    return { averaging: false, first, count, index, weight };
  }
  const index = [], weight = [];
  for (let k = 0; k < dst; k++) {
    const a = start + k * step, b = a + step;
    first[k] = index.length;
    for (let s = Math.floor(a); s < b; s++) {
      if (s < 0 || s >= srcSize) continue;
      const w = Math.min(b, s + 1) - Math.max(a, s);
      if (w > 1e-12) { index.push(s); weight.push(w / step); }
    }
    count[k] = index.length - first[k];
  }
  return { averaging: true, first, count, index: Int32Array.from(index), weight: Float64Array.from(weight) };
}

/** The source rows that output rows [y0, y1) read, as [first, last + 1), clamped to the image. */
export function sourceRows(region, dstH, srcH, y0, y1) {
  const ys = axisSamples(region.y, region.height, dstH, srcH);
  let lo = srcH, hi = 0;
  for (let y = y0; y < y1; y++) for (let j = ys.first[y], end = j + ys.count[y]; j < end; j++) {
    const s = ys.index[j]; if (s >= 0 && s < srcH) { if (s < lo) lo = s; if (s + 1 > hi) hi = s + 1; }
  }
  return lo < hi ? [lo, hi] : [0, 0];
}

/**
 * Resamples one plane (srcW x srcH) to dstW x dstH over `region` (source pixels).
 * Returns the resampled plane, of the same type (averages are rounded to the nearest raw value),
 * and `coverage`: null when every output pixel lies inside the image, otherwise a Uint8ClampedArray
 * of 0..255 giving the part of each output pixel that does.
 * `rows` = [y0, y1) computes only those output rows (a band); `data` may then hold only source
 * rows from `dataRow0` on (see sourceRows). The band is exactly those rows of the full result.
 */
export function resamplePlane(data, srcW, srcH, region, dstW, dstH, rows = null, dataRow0 = 0) {
  const [y0, y1] = rows || [0, dstH], bandH = y1 - y0;
  // 1:1 on whole pixels inside the image: the plane itself, or its rows, unchanged.
  if (dstW === region.width && dstH === region.height && Number.isInteger(region.x) && Number.isInteger(region.y) &&
      region.x >= 0 && region.y >= 0 && region.x + dstW <= srcW && region.y + dstH <= srcH) {
    if (dstW === srcW && !rows && dataRow0 === 0 && dstH === srcH) return { data, coverage: null };
    const out = new (data.constructor)(dstW * bandH);
    for (let y = y0; y < y1; y++) {
      const start = (region.y + y - dataRow0) * srcW + region.x;
      out.set(data.subarray(start, start + dstW), (y - y0) * dstW);
    }
    return { data: out, coverage: null };
  }
  const xs = axisSamples(region.x, region.width, dstW, srcW), ys = axisSamples(region.y, region.height, dstH, srcH);
  const out = new (data.constructor)(dstW * bandH);
  let coverage = null;
  const needCoverage = () => (coverage ||= new Uint8ClampedArray(dstW * bandH).fill(255));
  if (!xs.averaging && !ys.averaging) {
    // Nearest neighbour (enlarged): one read per output pixel.
    for (let y = y0; y < y1; y++) {
      const rowInside = ys.count[y] === 1, base = (ys.index[y] - dataRow0) * srcW, o = (y - y0) * dstW;
      for (let x = 0; x < dstW; x++) {
        if (rowInside && xs.count[x] === 1) out[o + x] = data[base + xs.index[x]];
        else needCoverage()[o + x] = 0;
      }
    }
    return { data: out, coverage };
  }
  // Area average, separable: each output row sums its source rows (horizontally resampled).
  const { first: xf, count: xc, index: xi, weight: xw } = xs;
  const xCover = new Float64Array(dstW);
  for (let x = 0; x < dstW; x++) { let c = 0; for (let j = xf[x], end = j + xc[x]; j < end; j++) c += xw[j]; xCover[x] = c; }
  const acc = new Float64Array(dstW);
  for (let y = y0; y < y1; y++) {
    acc.fill(0);
    let yCover = 0;
    for (let j = ys.first[y], end = j + ys.count[y]; j < end; j++) {
      const base = (ys.index[j] - dataRow0) * srcW, wy = ys.weight[j];
      yCover += wy;
      for (let x = 0; x < dstW; x++) {
        let sum = 0;
        for (let k = xf[x], kend = k + xc[x]; k < kend; k++) sum += data[base + xi[k]] * xw[k];
        acc[x] += sum * wy;
      }
    }
    const o = (y - y0) * dstW;
    for (let x = 0; x < dstW; x++) {
      const c = xCover[x] * yCover;
      if (c < 1 - 1e-9) needCoverage()[o + x] = c * 255;
      out[o + x] = c > 0 ? Math.round(acc[x] / c) : 0;
    }
  }
  return { data: out, coverage };
}

// The hot loop, once per pixel type: engines optimise a loop for the array types it has seen, and
// one loop fed both 8-bit and 16-bit planes (a PNG and a TIFF in one figure) runs about half as fast.
function addChannel16(acc, colour, plane, n) { for (let i = 0; i < n; i++) acc[i] += colour[plane[i]]; }
function addChannel8(acc, colour, plane, n) { for (let i = 0; i < n; i++) acc[i] += colour[plane[i]]; }
function addChannelAny(acc, colour, plane, n) { for (let i = 0; i < n; i++) acc[i] += colour[plane[i]]; }

/**
 * Composites resampled planes (all dstW x dstH) into RGBA.
 * channels: [{ plane, table (levelTable), lut (256 x 3) }] for the enabled channels, in order.
 * alpha: optional plane of 0..255 (PNG transparency); coverage: optional mask from resamplePlane.
 */
export function compositeRGBA({ width, height, channels, brightness = 0, contrast = 0, alpha = null, coverage = null }) {
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) throw new Error('The compositor needs a little-endian machine.');
  // Each channel's raw value -> packed colour (R, G, B in 10-bit fields), so the inner loop is two
  // array reads (raw value, colour) and one add. Channels are added as integers and each colour
  // clamped at 255, as in Fiji's and QuPath's additive composite. The fields hold up to 1023, so
  // the sums are clamped every few channels; min(255, a + b) after clamping a is min(255, sum).
  const acc = new Uint32Array(n);
  const clampAll = () => {
    for (let i = 0; i < n; i++) {
      const v = acc[i], r = v >>> 20, g = (v >>> 10) & 1023, b = v & 1023;
      acc[i] = ((r > 255 ? 255 : r) << 20) | ((g > 255 ? 255 : g) << 10) | (b > 255 ? 255 : b);
    }
  };
  let room = 4; // four channels of at most 255 fit in 10 bits; after a clamp, three more
  channels.forEach(({ plane, table, lut, colour: given }, c) => {
    if (room === 0) { clampAll(); room = 3; } // only when another channel is still to come
    const colour = given || colourTable(table, lut);
    (plane instanceof Uint16Array ? addChannel16 : plane instanceof Uint8Array ? addChannel8 : addChannelAny)(acc, colour, plane, n);
    room--;
  });
  // One 32-bit store per pixel: R, G, B clamped at 255, opaque. Canvas pixels are RGBA in memory,
  // so on a little-endian machine (every platform browsers run on) the word is A<<24 | B<<16 | G<<8 | R.
  const words = new Uint32Array(out.buffer);
  for (let i = 0; i < n; i++) {
    const v = acc[i];
    let r = v >>> 20, g = (v >>> 10) & 1023, b = v & 1023;
    if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
    words[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }
  // Whole-image brightness/contrast tone curve, after the channels are added (unchanged).
  if (brightness !== 0 || contrast !== 0) {
    const contrastFactor = (100 + contrast) / 100, brightnessOffset = brightness * 2.55;
    for (let i = 0; i < out.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const v = (out[i + c] - 128) * contrastFactor + 128 + brightnessOffset;
        out[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  if (alpha) for (let i = 0; i < n; i++) out[i * 4 + 3] = alpha[i];
  // Outside the image (a region past its edge) is transparent, as it always was; partly outside
  // (only when averaging) is partly transparent.
  if (coverage && (channels.length || alpha)) {
    for (let i = 0; i < n; i++) if (coverage[i] < 255) out[i * 4 + 3] = alpha ? Math.min(out[i * 4 + 3], coverage[i]) : coverage[i];
  }
  return out;
}

/**
 * The whole pipeline for one image: resample every enabled channel (and the alpha plane), map
 * and add them. job: { srcW, srcH, region, dstW, dstH, brightness, contrast, alpha (Uint8Array|null),
 * channels: [{ data, enabled, color, min, max, gamma, invert, bitDepth }] }.
 * `resample(data)` may be supplied to reuse cached resampled planes.
 */
export function compositeImage(job, resample = data => resamplePlane(data, job.srcW, job.srcH, job.region, job.dstW, job.dstH, job.rows, job.dataRow0 || 0)) {
  let coverage = null;
  const channels = [];
  for (const ch of job.channels) {
    if (!ch.enabled) continue;
    const r = resample(ch.data);
    coverage = coverage || r.coverage;
    channels.push({ plane: r.data, colour: cachedColour(ch, ch.bitDepth) });
  }
  let alpha = null;
  if (job.alpha) { const r = resample(job.alpha); alpha = r.data; coverage = coverage || r.coverage; }
  else if (!channels.length && coverage) coverage = null;
  const height = job.rows ? job.rows[1] - job.rows[0] : job.dstH;
  return compositeRGBA({ width: job.dstW, height, channels, brightness: job.brightness || 0, contrast: job.contrast || 0, alpha, coverage });
}

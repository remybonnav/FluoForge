/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Microscopy annotations (P3-T8), the pure part: no DOM, no Fabric.
   - The texts of auto-labels linked to an image: Z position in µm, time stamp, magnification of an inset
     (the channel names come from js/tools/legend.js).
   - Where a label sits on its image: a corner plus an offset, kept when the image moves or is resized.
   - Stamps: path commands of arrowheads, asterisks and markers around the point clicked.
   - The special characters of the Text panel's palette. */

/** A number with at most `digits` decimals and no trailing zeros. */
export const trimNumber = (value, digits = 2) => String(Math.round(value * 10 ** digits) / 10 ** digits).replace(/^-0$/, '0');

/** A time in seconds as a label: "45 s", "2:05 min", "1:02:03 h". */
export function formatSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${trimNumber(seconds, 2)} s`;
  const total = Math.round(seconds), pad = n => String(n).padStart(2, '0');
  if (total < 3600) return `${Math.floor(total / 60)}:${pad(total % 60)} min`;
  return `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)} h`;
}

/**
 * The Z label of an image shown from a stack: { sizeZ, zMode ('max' | 'mean' | 'slice'), zIndex, zStepUm }.
 * A slice: its position, z = 0 at the first slice ("z = 3.5 µm"), or its number without a Z step
 * ("z 8/25"). A projection: the depth it covers ("MIP z 0–12 µm", "Mean of 25 slices"). null without Z.
 */
export function zLabel({ sizeZ, zMode, zIndex = 0, zStepUm = null } = {}) {
  if (!(sizeZ > 1)) return null;
  const step = Number.isFinite(zStepUm) && zStepUm > 0 ? zStepUm : null;
  if (zMode === 'max' || zMode === 'mean') {
    const name = zMode === 'max' ? 'MIP' : 'Mean';
    return step ? `${name} z 0–${trimNumber((sizeZ - 1) * step)} µm` : `${name} of ${sizeZ} slices`;
  }
  const z = Math.min(Math.max(0, zIndex | 0), sizeZ - 1);
  return step ? `z = ${trimNumber(z * step)} µm` : `z ${z + 1}/${sizeZ}`;
}

/** The time label of a frame of a time series ({ sizeT, tIndex }): "t = 2:30 min" with an interval
    (seconds), "t 6/40" without. null for a single frame. */
export function timeLabel({ sizeT, tIndex = 0 } = {}, intervalS = null) {
  if (!(sizeT > 1)) return null;
  const t = Math.min(Math.max(0, tIndex | 0), sizeT - 1);
  return Number.isFinite(intervalS) && intervalS > 0 ? `t = ${formatSeconds(t * intervalS)}` : `t ${t + 1}/${sizeT}`;
}

/** The magnification of an inset: its source pixels' size on the page over the source image's ("3×", "2.5×"). */
export function magnificationLabel(insetScale, sourceScale) {
  const ratio = insetScale / sourceScale;
  return Number.isFinite(ratio) && ratio > 0 ? `${trimNumber(ratio, 1)}×` : null;
}

/** The text and per-character colours of a channel label from [{ name, color }]: names separated by spaces. */
export function channelsText(entries) {
  const line = {}; let at = 0;
  for (const e of entries) { for (let k = 0; k < e.name.length; k++) line[at + k] = { fill: e.color }; at += e.name.length + 1; }
  return { text: entries.map(e => e.name).join(' '), styles: entries.length ? { 0: line } : {} };
}

// ---- placement on the image ----
export const CORNERS = ['tl', 'tr', 'bl', 'br'];
/** Where each kind of label goes by default. */
export const DEFAULT_CORNER = { channels: 'tl', z: 'bl', time: 'tr', zoom: 'br' };
const cornerPoint = (box, corner) => ({ x: corner[1] === 'r' ? box.left + box.width : box.left, y: corner[0] === 'b' ? box.top + box.height : box.top });
/** The label's top-left for an image box, a corner and an offset (the label's matching corner from the image's). */
export function placeLabel(box, size, { corner = 'tl', dx = 0, dy = 0 } = {}) {
  const p = cornerPoint(box, corner);
  return { left: p.x + dx - (corner[1] === 'r' ? size.width : 0), top: p.y + dy - (corner[0] === 'b' ? size.height : 0) };
}
/** The default offset: `margin` inside the corner. */
export const insideOffset = (corner, margin) => ({ dx: corner[1] === 'r' ? -margin : margin, dy: corner[0] === 'b' ? -margin : margin });
/** The offset of a label at `pos` (its top-left) from the nearest corner of the image box. */
export function offsetFrom(box, size, pos) {
  const cx = pos.left + size.width / 2, cy = pos.top + size.height / 2;
  const corner = (cy > box.top + box.height / 2 ? 'b' : 't') + (cx > box.left + box.width / 2 ? 'r' : 'l');
  const p = cornerPoint(box, corner);
  return { corner, dx: pos.left + (corner[1] === 'r' ? size.width : 0) - p.x, dy: pos.top + (corner[0] === 'b' ? size.height : 0) - p.y };
}

// ---- ROI ----
/** The next free ROI number, given the labels already on the page ("ROI 1", "ROI 2"…). */
export function nextRoiNumber(texts) {
  const used = new Set(texts.map(t => (/^ROI (\d+)$/.exec(String(t).trim()) || [])[1]).filter(Boolean).map(Number));
  let n = 1; while (used.has(n)) n++;
  return n;
}

// ---- stamps ----
/** The stamps, in the order of the panel: label, and whether the shape is filled or only stroked. */
export const STAMPS = {
  arrowhead: { label: 'Arrowhead', filled: true },
  asterisk: { label: 'Asterisk', filled: false },
  circle: { label: 'Dot', filled: true },
  triangle: { label: 'Triangle', filled: true },
  star: { label: 'Star', filled: true }
};
const round = v => Math.round(v * 1000) / 1000;
const pts = list => list.map(([x, y]) => [round(x), round(y)]);
/**
 * Path commands of a stamp of `size` (its height, document px) around (0, 0): an arrowhead has its tip
 * at (0, 0) pointing down and to the left (from the upper right, as arrows usually point at a cell);
 * the others are centred on it. Returns [['M', x, y], ['L', x, y]…, ['Z']] (closed shapes) or several
 * M/L pairs (the asterisk's strokes).
 */
export function stampCommands(kind, size) {
  const r = size / 2;
  if (kind === 'arrowhead') {
    // A head as long as `size`, half as wide, along (−1, 1)/√2.
    const ux = -Math.SQRT1_2, uy = Math.SQRT1_2, half = size * 0.45;
    const base = [-ux * size, -uy * size], n = [-uy, ux];
    const p = pts([[0, 0], [base[0] + n[0] * half, base[1] + n[1] * half], [base[0] - n[0] * half, base[1] - n[1] * half]]);
    return [['M', ...p[0]], ['L', ...p[1]], ['L', ...p[2]], ['Z']];
  }
  if (kind === 'asterisk') {
    const out = [];
    for (const deg of [90, 30, 150]) {
      const a = deg * Math.PI / 180, [x, y] = [Math.cos(a) * r, -Math.sin(a) * r];
      out.push(['M', round(-x), round(-y)], ['L', round(x), round(y)]);
    }
    return out;
  }
  if (kind === 'circle') {
    const k = 0.5522847498 * r;
    return [['M', r, 0], ['C', r, round(k), round(k), r, 0, r], ['C', round(-k), r, -r, round(k), -r, 0],
      ['C', -r, round(-k), round(-k), -r, 0, -r], ['C', round(k), -r, r, round(-k), r, 0], ['Z']];
  }
  if (kind === 'triangle') {
    // Equilateral, pointing up, centred on its centroid.
    const h = size, side = h * 2 / Math.sqrt(3), p = pts([[0, -h * 2 / 3], [side / 2, h / 3], [-side / 2, h / 3]]);
    return [['M', ...p[0]], ['L', ...p[1]], ['L', ...p[2]], ['Z']];
  }
  if (kind === 'star') {
    const list = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r; list.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    const p = pts(list);
    return [['M', ...p[0]], ...p.slice(1).map(q => ['L', ...q]), ['Z']];
  }
  return null;
}

/** The two nodes of an arrow stamp: from the upper right to its tip at (0, 0), `length` long. */
export const arrowStampNodes = length => [{ x: round(length * Math.SQRT1_2), y: round(-length * Math.SQRT1_2) }, { x: 0, y: 0 }];

// ---- text ----
/** The special-character palette: groups of [character, name]. Each must have a glyph in every
    Liberation face, so PDF export can embed it (checked by tests/annotate-regression.js). */
export const SPECIAL_CHARACTERS = [
  ['Units and signs', [['µ', 'micro'], ['°', 'degree'], ['±', 'plus-minus'], ['×', 'times'], ['÷', 'divide'], ['≈', 'approximately'],
    ['≤', 'less than or equal'], ['≥', 'greater than or equal'], ['≠', 'not equal'], ['‰', 'per mille'], ['Å', 'ångström'], ['′', 'prime'], ['″', 'double prime']]],
  ['Greek', [['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['ε', 'epsilon'], ['ζ', 'zeta'], ['η', 'eta'], ['θ', 'theta'],
    ['κ', 'kappa'], ['λ', 'lambda'], ['ν', 'nu'], ['ξ', 'xi'], ['π', 'pi'], ['ρ', 'rho'], ['σ', 'sigma'], ['τ', 'tau'], ['φ', 'phi'],
    ['χ', 'chi'], ['ψ', 'psi'], ['ω', 'omega'], ['Γ', 'capital gamma'], ['Δ', 'capital delta'], ['Σ', 'capital sigma'], ['Φ', 'capital phi'], ['Ψ', 'capital psi'], ['Ω', 'capital omega']]],
  ['Arrows', [['←', 'left arrow'], ['→', 'right arrow'], ['↑', 'up arrow'], ['↓', 'down arrow'], ['↔', 'left-right arrow'], ['↕', 'up-down arrow']]],
  ['Other', [['•', 'bullet'], ['–', 'en dash'], ['—', 'em dash'], ['†', 'dagger'], ['‡', 'double dagger'], ['§', 'section'], ['∞', 'infinity'], ['√', 'square root']]]
];

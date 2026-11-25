/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Rulers, guides and smart guides (P3-T7), the pure part: no DOM, no Fabric.
   - Ruler ticks in the document unit (cm with mm ticks, inches with eighths, or px), spaced for the zoom.
   - Guides: `docProps.guides`, a list of { axis: 'v' | 'h', pos } in document px (a vertical guide at x =
     pos on every page; a horizontal one at y = pos). Layout guides are not stored: a margin (mm) and the
     column widths of the journal preset, measured from the margin, on every page.
   - Equal spacing: while dragging, the gap to a neighbour snaps to a gap between two other objects of
     the row (or column), or the object centres itself between its two neighbours. */

/** Document px per unit. */
export const pxPerUnit = (unit, dpi) => (unit === 'cm' ? dpi / 2.54 : unit === 'in' ? dpi : 1);
const STEPS = {
  cm: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200],
  in: [0.125, 0.25, 0.5, 1, 2, 5, 10, 20, 50],
  px: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
};
const unitOf = unit => (STEPS[unit] ? unit : 'px');
/** A ruler label: at most three decimals, no trailing zeros. */
export const tickLabel = value => String(Math.round(value * 1000) / 1000).replace(/^-0$/, '0');

/**
 * The ticks of a ruler from document px `from` to `to`, counting from `origin` (the page's edge), in
 * `unit` at `dpi`, for a zoom (screen px per document px). Minor ticks are at least 6 screen px apart,
 * labelled major ticks at least 50. Returns { minor, major, ticks: [{ pos, value, major }] }.
 */
export function rulerTicks(from, to, origin, unit, dpi, zoom) {
  const u = unitOf(unit), per = pxPerUnit(u, dpi), screen = per * zoom, steps = STEPS[u];
  const minor = steps.find(s => s * screen >= 6) || steps[steps.length - 1];
  const major = steps.find(s => s * screen >= 50 && Math.abs(s / minor - Math.round(s / minor)) < 1e-9) || steps[steps.length - 1];
  const ticks = [];
  const first = Math.floor((from - origin) / per / minor), last = Math.ceil((to - origin) / per / minor);
  for (let i = first; i <= last && ticks.length < 4000; i++) {
    const value = i * minor, ratio = value / major;
    ticks.push({ pos: origin + value * per, value, major: Math.abs(ratio - Math.round(ratio)) < 1e-9 });
  }
  return { minor, major, ticks };
}

/** The manual guides of a document, valid ones only. */
export function guidesOf(docProps) {
  const list = docProps && Array.isArray(docProps.guides) ? docProps.guides : [];
  return list.filter(g => g && (g.axis === 'v' || g.axis === 'h') && Number.isFinite(g.pos)).map(g => ({ axis: g.axis, pos: g.pos }));
}
/** The layout guide settings: margin in mm (0: none) and whether the journal's column guides show. */
export function layoutSettings(docProps) {
  const s = docProps && docProps.layoutGuides && typeof docProps.layoutGuides === 'object' ? docProps.layoutGuides : {};
  return { marginMm: Number.isFinite(s.marginMm) && s.marginMm > 0 ? s.marginMm : 0, columns: s.columns !== false };
}

/**
 * Margin and column guides of one page (document px): a margin `marginMm` from each edge, and a vertical
 * guide at each column width (mm) measured from the left margin, when it fits on the page.
 * Returns [{ axis, pos, kind: 'margin' | 'column', label }].
 */
export function layoutGuides(page, { marginMm = 0, columnsMm = [] } = {}, dpi) {
  const mm = v => (v / 25.4) * dpi, m = mm(marginMm), out = [];
  if (m > 0 && 2 * m < page.width && 2 * m < page.height) {
    out.push({ axis: 'v', pos: page.left + m, kind: 'margin', label: 'margin' }, { axis: 'v', pos: page.left + page.width - m, kind: 'margin', label: 'margin' },
      { axis: 'h', pos: page.top + m, kind: 'margin', label: 'margin' }, { axis: 'h', pos: page.top + page.height - m, kind: 'margin', label: 'margin' });
  }
  for (const w of [...new Set(columnsMm.filter(v => Number.isFinite(v) && v > 0))].sort((a, b) => a - b)) {
    const x = page.left + m + mm(w);
    if (x <= page.left + page.width + 0.5) out.push({ axis: 'v', pos: x, kind: 'column', label: `${w} mm` });
  }
  return out;
}

/** A guide as a snap target for js/layout/snap.js computeSnap: a line on one axis only. */
export const guideTarget = g => (g.axis === 'v' ? { left: g.pos, width: 0, top: NaN, height: NaN } : { left: NaN, width: 0, top: g.pos, height: 0 });

/** The guide (index) within `tolerance` document px of a point on its axis, or -1. */
export function guideAt(guides, point, tolerance) {
  let best = -1, bestD = Infinity;
  guides.forEach((g, i) => { const d = Math.abs((g.axis === 'v' ? point.x : point.y) - g.pos); if (d <= tolerance && d < bestD) { best = i; bestD = d; } });
  return best;
}

// ---- equal spacing ----
const AXES = {
  x: { start: 'left', size: 'width', crossStart: 'top', crossSize: 'height' },
  y: { start: 'top', size: 'height', crossStart: 'left', crossSize: 'width' }
};
const end = (b, a) => b[a.start] + b[a.size];
const overlaps = (a, b, ax) => a[ax.crossStart] < end(b, { start: ax.crossStart, size: ax.crossSize }) && b[ax.crossStart] < end(a, { start: ax.crossStart, size: ax.crossSize });

/**
 * On one axis ('x' or 'y'): the move that gives `box` the same gap to its neighbour as two other
 * objects of its row (column) have, or centres it between its two neighbours, if within `threshold`.
 * Returns null, or { d, gap, marks: [{ from, to, at }] } (gaps to draw: from and to on the axis, at on
 * the other axis, in document px).
 */
export function spacingSnapAxis(box, others, threshold, axis = 'x') {
  const ax = AXES[axis], mid = box[ax.start] + box[ax.size] / 2;
  const row = others.filter(o => o[ax.size] > 0 && o[ax.crossSize] > 0 && overlaps(o, box, ax)).sort((a, b) => a[ax.start] - b[ax.start]);
  const before = row.filter(o => end(o, ax) <= mid && o[ax.start] + o[ax.size] / 2 < mid).sort((a, b) => end(b, ax) - end(a, ax))[0] || null;
  const after = row.filter(o => o[ax.start] >= mid && o[ax.start] + o[ax.size] / 2 > mid).sort((a, b) => a[ax.start] - b[ax.start])[0] || null;
  const crossMid = o => o[ax.crossStart] + o[ax.crossSize] / 2;
  const at = o => (crossMid(o) + crossMid(box)) / 2;
  // Gaps between consecutive objects of the row (not involving the moving box).
  const gaps = [];
  for (let i = 0; i + 1 < row.length; i++) {
    const a = row[i], b = row[i + 1], g = b[ax.start] - end(a, ax);
    if (g > 0) gaps.push({ g, from: end(a, ax), to: b[ax.start], at: (crossMid(a) + crossMid(b)) / 2 });
  }
  const candidates = [];
  if (before && after) {
    const g = (after[ax.start] - end(before, ax) - box[ax.size]) / 2;
    if (g > 0) candidates.push({ d: end(before, ax) + g - box[ax.start], gap: g, centred: true });
  }
  for (const gap of gaps) {
    if (before) candidates.push({ d: end(before, ax) + gap.g - box[ax.start], gap: gap.g, ref: gap, side: 'before' });
    if (after) candidates.push({ d: after[ax.start] - gap.g - box[ax.size] - box[ax.start], gap: gap.g, ref: gap, side: 'after' });
  }
  const best = candidates.filter(c => Math.abs(c.d) <= threshold).sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
  if (!best) return null;
  const start = box[ax.start] + best.d, stop = start + box[ax.size], marks = [];
  if (best.centred || best.side === 'before') marks.push({ from: end(before, ax), to: start, at: at(before) });
  if (best.centred || best.side === 'after') marks.push({ from: stop, to: after[ax.start], at: at(after) });
  if (best.ref) marks.push({ from: best.ref.from, to: best.ref.to, at: best.ref.at });
  return { d: best.d, gap: best.gap, marks };
}

/** Both axes: { dx, dy, marks: { x: [...], y: [...] } } (null where nothing snaps). */
export function computeSpacingSnap(box, others, threshold) {
  const x = spacingSnapAxis(box, others, threshold, 'x'), y = spacingSnapAxis(box, others, threshold, 'y');
  return { dx: x ? x.d : null, dy: y ? y.d : null, marks: { x: x ? x.marks : [], y: y ? y.marks : [] } };
}

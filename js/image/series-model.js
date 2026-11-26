/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Series montages (P3-T9), the pure part: no DOM, no Fabric.
   - Which planes of a Z stack or time series a montage shows: a first and last plane (1-based, as the
     Channels panel numbers them) and a step.
   - The shape of the montage: a strip (one row) or a grid of a number of columns, filled row by row.
   The montage itself is made by js/image/series.js. */

/** The most panels one series montage makes. */
export const MAX_PANELS = 100;
/** The two axes a series runs along: the word for one plane, and for many. */
export const AXES = { z: { one: 'slice', many: 'slices', label: 'Z slices' }, t: { one: 'frame', many: 'frames', label: 'Time frames' } };

const isWhole = v => Number.isInteger(v);

/**
 * The planes (0-based) from plane `from` to plane `to` (1-based, both included when the step reaches
 * it) every `step` planes, of a series of `size` planes. Throws with a message for the user when the
 * range is not usable.
 */
export function seriesPlanes(size, { from = 1, to = size, step = 1 } = {}, axis = 't') {
  const word = (AXES[axis] || AXES.t).one;
  if (!(isWhole(size) && size > 1)) throw new Error(`This image has a single ${word}: there is no series to show.`);
  if (!isWhole(from) || from < 1 || from > size) throw new Error(`Enter a first ${word} between 1 and ${size}.`);
  if (!isWhole(to) || to < 1 || to > size) throw new Error(`Enter a last ${word} between 1 and ${size}.`);
  if (to < from) throw new Error(`The last ${word} must come after the first.`);
  if (!isWhole(step) || step < 1) throw new Error('Enter a step of 1 or more.');
  const out = [];
  for (let p = from; p <= to; p += step) out.push(p - 1);
  if (out.length > MAX_PANELS) throw new Error(`That makes ${out.length} panels; at most ${MAX_PANELS}: use a larger step or a shorter range.`);
  return out;
}

/** A step that shows the whole series in about `panels` panels. */
export const defaultStep = (size, panels = 8) => Math.max(1, Math.ceil(size / Math.max(1, panels)));

/** Columns and rows of `count` panels: a strip (columns 0 or more than count) is one row. */
export function gridShape(count, columns = 0) {
  const n = Math.max(0, count | 0);
  const cols = isWhole(columns) && columns > 0 ? Math.min(columns, Math.max(1, n)) : Math.max(1, n);
  return { columns: cols, rows: n ? Math.ceil(n / cols) : 0 };
}

/** The cell of panel `index` in a grid of `columns` columns, filled row by row. */
export const cellOf = (index, columns) => ({ row: Math.floor(index / Math.max(1, columns)), column: index % Math.max(1, columns) });

/** The planes as the user counts them, shortened when long: "1, 5, 9", "1, 17, 33 … 113". */
export function describePlanes(planes) {
  const shown = planes.map(p => p + 1);
  return shown.length > 6 ? `${shown.slice(0, 3).join(', ')} … ${shown.at(-1)}` : shown.join(', ');
}

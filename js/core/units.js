/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Print units (P3-T4), pure: document px ↔ mm and pt at the document's dpi, and the unit each kind of
   size field shows. Lengths (positions, widths) are in mm; line widths and font sizes in pt; with the
   "px" preference, everything stays in document px as before. */

export const KINDS = ['length', 'line', 'font'];
export const MODES = ['mm-pt', 'px'];

/** The unit a field of `kind` shows in `mode` ('mm-pt' or 'px'). */
export const unitFor = (kind, mode) => (mode === 'px' ? 'px' : kind === 'length' ? 'mm' : 'pt');

/** A value in `unit` ('mm', 'pt' or 'px') to document px at `dpi`. */
export function toPx(value, unit, dpi) {
  if (unit === 'mm') return (value / 25.4) * dpi;
  if (unit === 'pt') return (value / 72) * dpi;
  return value;
}
/** Document px at `dpi` to `unit`. */
export function fromPx(px, unit, dpi) {
  if (unit === 'mm') return (px / dpi) * 25.4;
  if (unit === 'pt') return (px / dpi) * 72;
  return px;
}
/** A value as shown in a field: at most two decimals (px: as given). */
export const formatValue = (value, unit) => (unit === 'px' ? String(value) : String(Math.round(value * 100) / 100));
/** The arrow-key step of a field showing `unit` (px: the field's own step). */
export const stepFor = (kind, unit, pxStep) => (unit === 'mm' ? '0.1' : unit === 'pt' ? (kind === 'font' ? '0.5' : '0.25') : pxStep);

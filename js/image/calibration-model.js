/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Calibration values against the file's own (P3-T9a): pixel size, Z step and frame interval can be
   typed in the Channels panel; when a typed value is not the one stored in the image file, a warning
   says so. Pure: no DOM, no Fabric. */

/** A usable calibration value: a finite number above 0, else null. */
export const positive = v => { const n = typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v)) : v; return Number.isFinite(n) && n > 0 ? n : null; };

/** Whether two calibration values are the same, allowing for rounding in the file's metadata. */
export function sameValue(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** A number as people type it: up to 6 significant digits, no trailing zeros. */
export const showNumber = v => String(Number(Number(v).toPrecision(6)));

/**
 * The warning for a value that differs from the file's, or '' when it does not (or the file has none).
 * `unit` is the unit printed after the file's value ('µm/px', 'µm', 's').
 */
export function differenceWarning(current, fromFile, unit) {
  if (fromFile == null || sameValue(current, fromFile)) return '';
  return current == null
    ? `No value set: the file says ${showNumber(fromFile)} ${unit}.`
    : `Differs from the file: the file says ${showNumber(fromFile)} ${unit}.`;
}

/** Where a value comes from, for Image info: the file, typed in, or not set. */
export function valueSource(current, fromFile, fileSource = 'File') {
  if (current == null) return 'Not set';
  if (fromFile != null && sameValue(current, fromFile)) return fileSource;
  return 'Entered in the Channels panel' + (fromFile != null ? ` (the file says ${showNumber(fromFile)})` : '');
}

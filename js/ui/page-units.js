/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Page width and height follow the Unit choice. In the Document Properties panel and the Create a figure
   dialog, choosing another unit (cm, inches, pixels) converts the width and height already there:
   21 × 29.7 cm become 8.27 × 11.69 in, or 2480 × 3508 px at 300 DPI. Pixels go through the DPI field.
   Each field shows a rounded number (two decimals, whole pixels) but keeps the exact value behind it,
   so going back to the first unit gives the same numbers and applying the page keeps its pixel size.
   A number the user types is used as typed. */

/** Converts a length between 'cm', 'in' and 'px' (px at `dpi`). */
export function convertLength(value, from, to, dpi) {
  if (from === to) return value;
  const inches = from === 'cm' ? value / 2.54 : from === 'in' ? value : value / dpi;
  return to === 'cm' ? inches * 2.54 : to === 'in' ? inches : inches * dpi;
}
/** The text shown for a length: whole pixels after a conversion to px, otherwise at most two decimals. */
export function formatLength(value, unit) {
  return String(unit === 'px' ? Math.round(value) : Math.round(value * 100) / 100);
}

let nativeInput = null, nativeSelect = null;
const attached = new WeakSet();

/** Keeps the exact value behind a number field's rounded text. */
function exactField(el) {
  let record = null; // { text, value }: what the field shows and the exact value behind it
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() { const text = nativeInput.get.call(this); return record && record.text === text ? String(record.value) : text; },
    set(v) {
      const n = typeof v === 'number' ? v : parseFloat(v);
      if (!Number.isFinite(n) || String(v).trim() === '') { record = null; nativeInput.set.call(this, v); return; }
      this.showLength(n, null);
    }
  });
  el.showLength = (n, unit) => { const text = formatLength(n, unit); record = { text, value: n }; nativeInput.set.call(el, text); };
}

/**
 * Connects a width, height, unit and DPI set of fields: changing the unit converts the width and height.
 * The unit follows every change, also one made by code (a journal preset sets cm), so the conversion
 * always starts from the unit the numbers are in.
 */
export function attachPageUnits({ width, height, unit, dpi }) {
  if (!width || !height || !unit || !dpi || attached.has(unit)) return;
  attached.add(unit);
  nativeInput ||= Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  nativeSelect ||= Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  exactField(width); exactField(height);
  let current = nativeSelect.get.call(unit);
  Object.defineProperty(unit, 'value', {
    configurable: true,
    get() { return nativeSelect.get.call(this); },
    set(v) { nativeSelect.set.call(this, v); current = nativeSelect.get.call(this); }
  });
  const convert = () => {
    const to = nativeSelect.get.call(unit), from = current;
    if (to === from) return;
    current = to;
    const d = parseFloat(dpi.value);
    if ((from === 'px' || to === 'px') && !(d > 0)) return; // no DPI to convert pixels with: the numbers stay
    let changed = false;
    for (const el of [width, height]) {
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) continue;
      el.showLength(convertLength(v, from, to, d), to);
      changed = true;
    }
    if (changed) width.dispatchEvent(new Event('input', { bubbles: true })); // the pixel preview follows
  };
  unit.addEventListener('input', convert);
  unit.addEventListener('change', convert);
}

/** The Document Properties panel's fields (once, when the editor loads). */
export function installPageUnits() {
  const $ = id => document.getElementById(id);
  attachPageUnits({ width: $('doc-width'), height: $('doc-height'), unit: $('doc-unit'), dpi: $('doc-dpi') });
}

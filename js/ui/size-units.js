/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Size fields in print units (P3-T4). The selection bar's X, Y, W and H show mm; stroke and outline
   widths, scale bar thickness, text border width and font size show pt; Preferences → Units → "Size
   units: px" keeps document px. The editor's code still reads and writes these fields in document px:
   each field's `value` converts between the px the code uses and the unit shown, at the document's dpi.
   A value the code wrote reads back exactly (not from its rounded display). Each field gets a unit
   after it, and its title says the unit. */

import { docProps } from '../core/state.js';
import { getPreference, onPreferenceChange } from '../core/preferences.js';
import { formatValue, fromPx, stepFor, toPx, unitFor } from '../core/units.js';

/** The fields and the kind of size each holds. */
export const SIZE_FIELDS = [
  ['obj-x', 'length'], ['obj-y', 'length'], ['obj-width', 'length'], ['obj-height', 'length'],
  ['shape-stroke-width', 'line'], ['path-stroke-width', 'line'], ['inset-stroke-width', 'line'], ['sb-thickness', 'line'], ['text-border-width', 'line'],
  ['text-size', 'font']
];
let native = null; // the inputs' own value property (set when installing: not in Node)
const dpi = () => (docProps && docProps.dpi > 0 ? docProps.dpi : 300);
let mode = 'mm-pt'; // the mode the fields show now
const fields = [];

/** The size unit mode of the preference ('mm-pt' or 'px'). */
export const sizeUnitMode = () => (getPreference('units.size') === 'px' ? 'px' : 'mm-pt');
/** The unit a field shows now ('mm', 'pt' or 'px'), or null for a field that is not a size field. */
export function fieldUnit(id) { const f = fields.find(x => x.el.id === id); return f ? unitFor(f.kind, mode) : null; }

function bind(el, kind) {
  const label = el.closest('label'), own = label && label.firstChild && label.firstChild.nodeType === 3 ? label.firstChild.textContent : '';
  // The label's words without "(px)" (it shows the unit after the field now).
  if (label && /\(px\)/.test(own)) label.firstChild.textContent = own.replace(/\s*\(px\)/, '');
  const base = ((label && label.title) || '').replace(/\s*\((document )?px\)\s*$/, '') || own.replace(/\s*\(px\)/, '').trim();
  const f = { el, kind, record: null, title: base, step: el.getAttribute('step') || 'any', min: el.getAttribute('min') };
  // `record`: the px the code last wrote and the text it showed, so an untouched field reads back exactly.
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() {
      const text = native.get.call(this), unit = unitFor(kind, mode);
      if (unit === 'px') return text;
      if (f.record && f.record.text === text && f.record.unit === unit) return String(f.record.px);
      const v = parseFloat(text);
      return Number.isFinite(v) ? String(toPx(v, unit, dpi())) : text;
    },
    set(value) {
      const unit = unitFor(kind, mode), v = parseFloat(value);
      if (unit === 'px' || !Number.isFinite(v)) { f.record = null; native.set.call(this, value); return; }
      const text = formatValue(fromPx(v, unit, dpi()), unit);
      f.record = { px: v, text, unit };
      native.set.call(this, text);
    }
  });
  const suffix = document.createElement('span');
  suffix.className = 'unit-suffix';
  el.after(suffix);
  f.suffix = suffix;
  fields.push(f);
  return f;
}

/** Shows every field in the current mode (the px values stay the same). */
function show(f, px) {
  const unit = unitFor(f.kind, mode), label = f.el.closest('label') || f.el;
  f.suffix.textContent = unit;
  label.title = (f.title ? f.title + ' ' : '') + `(${unit === 'px' ? 'document px' : unit})`;
  f.el.setAttribute('step', stepFor(f.kind, unit, f.step));
  if (unit === 'px' && f.min != null) f.el.setAttribute('min', f.min); else f.el.setAttribute('min', '0');
  f.el.value = px;
}
/** Switches the fields to another mode, keeping their px values. */
export function applySizeUnits(next = sizeUnitMode()) {
  const values = fields.map(f => f.el.value); // px, read in the current mode
  mode = next;
  fields.forEach((f, i) => show(f, values[i]));
}
/** After the dpi changed: the fields show their px values at the new dpi. */
export const refreshSizeFields = () => applySizeUnits(mode);

/** Connects the size fields (once, when the editor loads). Their initial values in the page are px. */
export function installSizeUnits() {
  native ||= Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  for (const [id, kind] of SIZE_FIELDS) {
    const el = document.getElementById(id);
    if (!el || fields.some(f => f.el === el)) continue;
    mode = 'px'; bind(el, kind);
  }
  mode = 'px';
  applySizeUnits(sizeUnitMode());
  onPreferenceChange(() => { if (sizeUnitMode() !== mode) applySizeUnits(sizeUnitMode()); });
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The Journal and Width choices of the New figure dialog (P3-T4). Choosing a width fills the dialog's
   width and height (in cm); the chosen journal's limits go with the new figure as
   docProps.journalPreset and are used by the figure check. The presets come from presets/journals.json
   (js/core/journal-presets.js); their names, labels and sources are set with textContent. */

import { fontRangeText, loadJournalPresets, makePreset, pageForPreset, presetLimits } from '../core/journal-presets.js';
import { DEFAULT_PRESET } from '../image/figure-check-rules.js';
import { attachPageUnits } from './page-units.js';

const option = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
const round = v => String(Math.round(v * 1000) / 1000);

/**
 * Connects the dialog's #m-journal, #m-preset and #m-preset-info to the presets. Sets
 * `modal.journalPreset()`: the chosen preset for docProps (null: none). Resolves once the presets are in.
 */
export async function attachJournalChoice(modal) {
  const $ = id => modal.querySelector('#' + id);
  const journal = $('m-journal'), width = $('m-preset'), info = $('m-preset-info');
  attachPageUnits({ width: $('m-width'), height: $('m-height'), unit: $('m-unit'), dpi: $('m-dpi') }); // the size follows the unit
  modal.journalPreset = () => null;
  let families;
  try { families = await loadJournalPresets(); }
  catch (error) { info.textContent = error.message + ' Type the size instead.'; journal.disabled = true; width.disabled = true; return; }
  journal.append(...families.map(f => option(f.id, f.name)));
  const family = () => families.find(f => f.id === journal.value) || null;
  const current = () => { const f = family(); return f ? makePreset(f, width.value) : null; };
  modal.journalPreset = current;
  const describe = () => {
    const p = current();
    if (!p) { info.textContent = 'No journal: type the size; the figure check uses 5–8 pt and 300 dpi.'; return; }
    const limits = presetLimits(p, DEFAULT_PRESET);
    info.textContent = `${p.widthMm} mm wide` + (p.maxHeightMm ? `, at most ${p.maxHeightMm} mm high` : '') +
      `. Text ${fontRangeText(limits)}, at least ${limits.minDpi} dpi` + (p.formats ? `; formats: ${p.formats.join(', ').toUpperCase()}` : '') + '.' +
      (p.source ? ` From ${p.source}, checked ${p.checked}.` : ' A generic size; the figure check uses 5–8 pt and 300 dpi.');
  };
  const apply = () => {
    const p = current();
    if (p) {
      const unit = $('m-unit'), height = $('m-height');
      const currentCm = unit.value === 'cm' ? parseFloat(height.value) : unit.value === 'in' ? parseFloat(height.value) * 2.54 : parseFloat(height.value) / parseFloat($('m-dpi').value) * 2.54;
      const page = pageForPreset(p, Number.isFinite(currentCm) && currentCm > 0 ? currentCm : 10);
      unit.value = 'cm'; $('m-width').value = round(page.width); height.value = round(page.height);
    }
    describe();
  };
  journal.addEventListener('change', () => {
    const f = family();
    width.replaceChildren(...(f ? f.widths.map(w => option(w.id, `${w.label}, ${w.mm} mm`)) : []));
    width.disabled = !f;
    apply();
  });
  width.addEventListener('change', apply);
  describe();
}

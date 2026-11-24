/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Journal presets (P3-T4): figure widths per journal family for the New figure dialog, and the text and
   resolution limits the figure check uses. The data is presets/journals.json (same origin, read once).
   A figure made from a preset keeps a copy of it in `docProps.journalPreset`:
     { family, name, width, widthMm, minFontPt, maxFontPt?, minDpi?, formats?, source?, checked? }
   so the project does not depend on the file. Everything here but loadJournalPresets is pure. */

export const PRESETS_URL = 'presets/journals.json';
const isNum = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isUrl = v => typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v);

/** The problems of a presets file (an empty list when it is valid). Journals need a source and a checked date. */
export function presetProblems(data) {
  const out = [];
  if (!data || data.format !== 1 || !Array.isArray(data.families)) return ['Not a presets file (format 1 with families).'];
  const ids = new Set();
  for (const f of data.families) {
    const where = `family ${f && f.id}`;
    if (!f || typeof f.id !== 'string' || !f.id || ids.has(f.id)) { out.push(`${where}: missing or repeated id`); continue; }
    ids.add(f.id);
    if (typeof f.name !== 'string' || !f.name) out.push(`${where}: no name`);
    if (!Array.isArray(f.widths) || !f.widths.length) out.push(`${where}: no widths`);
    else for (const w of f.widths) {
      if (!w || typeof w.id !== 'string' || typeof w.label !== 'string' || !isNum(w.mm)) out.push(`${where}: width ${w && w.id} needs id, label and mm`);
      else if (w.heightMm !== undefined && !isNum(w.heightMm)) out.push(`${where}: width ${w.id} has an invalid height`);
      else if (w.source !== undefined && !isUrl(w.source)) out.push(`${where}: width ${w.id} has an invalid source`);
    }
    for (const k of ['maxHeightMm', 'minFontPt', 'maxFontPt', 'minDpi']) if (f[k] !== undefined && !isNum(f[k])) out.push(`${where}: invalid ${k}`);
    if (isNum(f.minFontPt) && isNum(f.maxFontPt) && f.minFontPt > f.maxFontPt) out.push(`${where}: minFontPt above maxFontPt`);
    if (f.formats !== undefined && !(Array.isArray(f.formats) && f.formats.every(x => typeof x === 'string' && x))) out.push(`${where}: invalid formats`);
    if (f.id !== 'generic') {
      if (!isUrl(f.source)) out.push(`${where}: a journal needs a source URL`);
      if (!isDate(f.checked)) out.push(`${where}: a journal needs a checked date (YYYY-MM-DD)`);
    }
    if (isNum(f.maxHeightMm) && Array.isArray(f.widths)) for (const w of f.widths) if (isNum(w.heightMm) && w.heightMm > f.maxHeightMm) out.push(`${where}: width ${w.id} is taller than the maximum height`);
  }
  return out;
}

/**
 * The preset of a family and one of its widths, as kept in docProps.journalPreset. Limits the journal
 * does not state are left out (the figure check then uses its defaults for them, see presetLimits).
 */
export function makePreset(family, widthId) {
  const w = family.widths.find(x => x.id === widthId) || family.widths[0];
  const p = { family: family.id, name: family.id === 'generic' ? `${w.mm} mm` : family.name, width: w.id, widthMm: w.mm };
  for (const k of ['minFontPt', 'maxFontPt', 'minDpi', 'maxHeightMm']) if (isNum(family[k])) p[k] = family[k];
  if (isNum(w.heightMm)) p.heightMm = w.heightMm;
  if (Array.isArray(family.formats)) p.formats = family.formats.slice();
  if (isUrl(w.source || family.source)) p.source = w.source || family.source;
  if (isDate(family.checked)) p.checked = family.checked;
  return p;
}

/** The page a preset gives: width and height in cm (height: the width's own height, else the current one capped at the journal's maximum). */
export function pageForPreset(preset, currentHeightCm) {
  const widthCm = preset.widthMm / 10;
  let heightCm = isNum(preset.heightMm) ? preset.heightMm / 10 : currentHeightCm;
  if (isNum(preset.maxHeightMm)) heightCm = Math.min(heightCm, preset.maxHeightMm / 10);
  return { width: widthCm, height: heightCm, unit: 'cm' };
}

/**
 * The limits the figure check uses: the preset's own, or `fallback`'s for a generic preset and for any
 * limit the journal does not state. A journal that states no maximum text size gets none (Infinity).
 */
export function presetLimits(preset, fallback) {
  if (!preset || typeof preset !== 'object' || !isNum(preset.widthMm)) return fallback;
  if (preset.family === 'generic') return { ...fallback, name: `${fallback.name}, ${preset.name} wide` };
  return { name: preset.name, minFontPt: isNum(preset.minFontPt) ? preset.minFontPt : fallback.minFontPt,
    maxFontPt: isNum(preset.maxFontPt) ? preset.maxFontPt : (isNum(preset.minFontPt) ? Infinity : fallback.maxFontPt),
    minDpi: isNum(preset.minDpi) ? preset.minDpi : fallback.minDpi };
}

/** "5–7 pt" or "at least 5 pt". */
export const fontRangeText = limits => Number.isFinite(limits.maxFontPt) ? `${limits.minFontPt}–${limits.maxFontPt} pt` : `at least ${limits.minFontPt} pt`;

let loaded = null;
/** The families of presets/journals.json (read once). Rejects when the file is missing or invalid. */
export function loadJournalPresets() {
  loaded ||= fetch(PRESETS_URL, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('Journal presets not found (' + r.status + ').'); return r.json(); })
    .then(data => { const problems = presetProblems(data); if (problems.length) throw new Error('Journal presets: ' + problems[0]); return data.families; })
    .catch(error => { loaded = null; throw error; });
  return loaded;
}

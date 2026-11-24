// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* P3-T4: the journal presets file (presets/journals.json) and its pure module (js/core/journal-presets.js),
   and the print units (js/core/units.js), in Node: the file is valid, the generic presets are 85, 114 and
   174 mm, every journal has a source URL and a checked date and states nothing it should not; the checks
   catch a journal without source or date and inverted limits; a preset's page and figure check limits;
   px ↔ mm and pt. Run alone: node tests/journal-presets-regression.mjs */
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runJournalPresetsRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const J = await import(pathToFileURL(join(ROOT, 'js/core/journal-presets.js')).href);
  const U = await import(pathToFileURL(join(ROOT, 'js/core/units.js')).href);
  const data = JSON.parse(await readFile(join(ROOT, 'presets/journals.json'), 'utf8'));
  const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

  // ---- the file ----
  assert('presets/journals.json is a valid presets file', J.presetProblems(data).length === 0, J.presetProblems(data).join('; '));
  const generic = data.families.find(f => f.id === 'generic');
  assert('Generic presets: 85, 114 and 174 mm wide, with no source and no limits of their own', generic && generic.widths.map(w => w.mm).join() === '85,114,174' &&
    !generic.source && generic.minFontPt === undefined && generic.maxFontPt === undefined);
  const journals = data.families.filter(f => f.id !== 'generic');
  assert('Every journal has an https source on the journal\'s own site and a checked date', journals.length >= 1 &&
    journals.every(f => /^https:\/\/(www\.nature\.com|www\.science\.org|journals\.plos\.org|rupress\.org|www\.cell\.com|www\.jci\.org|www\.pnas\.org)\//.test(f.source) && /^\d{4}-\d{2}-\d{2}$/.test(f.checked)), journals.map(f => f.source).join());
  assert('Only stated values: Science gives no maximum height or text size, and no format list', (() => { const s = data.families.find(f => f.id === 'science'); return s && s.maxHeightMm === undefined && s.maxFontPt === undefined && s.formats === undefined; })());
  const fam$ = id => data.families.find(f => f.id === id);
  assert('Cell Press: 85, 114 and 174 mm (and 55 mm for three-column formats), at most 20 cm high, 6–8 pt, 300 dpi', (() => { const c = fam$('cell-press'); return c && c.widths.map(w => w.mm).join() === '85,114,174,55' &&
    c.maxHeightMm === 200 && c.minFontPt === 6 && c.maxFontPt === 8 && c.minDpi === 300 && /Cancer Cell/.test(c.name) && /Molecular Cell/.test(c.name) && /Cell Metabolism/.test(c.name); })());
  assert('JCI: 90 to 180 mm wide, at most 172.5 mm high, 6–8 pt, 600 ppi', (() => { const c = fam$('jci'); return c && c.widths.map(w => w.mm).join() === '90,180' && c.maxHeightMm === 172.5 &&
    c.minFontPt === 6 && c.maxFontPt === 8 && c.minDpi === 600; })());
  assert('PNAS: small, medium and large sizes with their heights, 6–12 pt; no resolution or maximum height of its own', (() => { const c = fam$('pnas'); return c && c.widths.map(w => w.mm + 'x' + w.heightMm).join() === '90x60,110x110,180x220' &&
    c.minFontPt === 6 && c.maxFontPt === 12 && c.minDpi === undefined && c.maxHeightMm === undefined; })());
  assert('PNAS medium makes an 11 × 11 cm page; JCI\'s 600 ppi reaches the figure check', JSON.stringify(J.pageForPreset(J.makePreset(fam$('pnas'), 'one-and-half'), 5)) === JSON.stringify({ width: 11, height: 11, unit: 'cm' }) &&
    J.presetLimits(J.makePreset(fam$('jci'), 'single'), { minFontPt: 5, maxFontPt: 8, minDpi: 300 }).minDpi === 600);
  assert('Widths within each journal\'s maximum height, and minimum text sizes not above the maximum', data.families.every(f => f.widths.every(w => !w.heightMm || !f.maxHeightMm || w.heightMm <= f.maxHeightMm)) &&
    data.families.every(f => !(f.minFontPt > f.maxFontPt)));

  // ---- the checks ----
  const bad = structuredClone(data);
  delete bad.families[1].source; delete bad.families[2].checked; bad.families[3].minFontPt = 20;
  bad.families[4].widths.push({ id: 'x', label: 'X' });
  const problems = J.presetProblems(bad);
  assert('A journal without source or date, inverted text limits and a width without mm are refused', problems.some(p => /source URL/.test(p)) && problems.some(p => /checked date/.test(p)) &&
    problems.some(p => /minFontPt above maxFontPt/.test(p)) && problems.some(p => /needs id, label and mm/.test(p)), problems.join('; '));
  assert('Not a presets file at all', J.presetProblems({ families: [] }).length === 1 && J.presetProblems(null).length === 1);

  // ---- presets ----
  const fam = { id: 'j', name: 'Journal J', widths: [{ id: 'single', label: 'Single', mm: 89 }, { id: 'full', label: 'Full page', mm: 183, heightMm: 247 }],
    maxHeightMm: 247, minFontPt: 5, maxFontPt: 7, minDpi: 300, formats: ['pdf'], source: 'https://example.org/guide', checked: '2026-11-24' };
  const p = J.makePreset(fam, 'single');
  assert('A preset copies the journal\'s stated values and the chosen width', JSON.stringify(p) === JSON.stringify({ family: 'j', name: 'Journal J', width: 'single', widthMm: 89,
    minFontPt: 5, maxFontPt: 7, minDpi: 300, maxHeightMm: 247, formats: ['pdf'], source: 'https://example.org/guide', checked: '2026-11-24' }), JSON.stringify(p));
  assert('Its page: the width in cm, the current height capped at the journal\'s maximum; a full page takes its height', JSON.stringify(J.pageForPreset(p, 30)) === JSON.stringify({ width: 8.9, height: 24.7, unit: 'cm' }) &&
    J.pageForPreset(p, 10).height === 10 && J.pageForPreset(J.makePreset(fam, 'full'), 5).height === 24.7);
  const fallback = { name: 'Default (5–8 pt, 300 dpi)', minFontPt: 5, maxFontPt: 8, minDpi: 300 };
  assert('Figure check limits: the journal\'s', JSON.stringify(J.presetLimits(p, fallback)) === JSON.stringify({ name: 'Journal J', minFontPt: 5, maxFontPt: 7, minDpi: 300 }));
  const noMax = J.presetLimits(J.makePreset({ ...fam, maxFontPt: undefined, minFontPt: 6, minDpi: undefined }, 'single'), fallback);
  assert('A journal that states a minimum text size but no maximum gets none; an unstated dpi falls back', noMax.minFontPt === 6 && noMax.maxFontPt === Infinity && noMax.minDpi === 300 && J.fontRangeText(noMax) === 'at least 6 pt');
  const g = J.presetLimits(J.makePreset(generic, 'one-and-half'), fallback);
  assert('A generic width keeps the default limits', g.minFontPt === 5 && g.maxFontPt === 8 && g.minDpi === 300 && /114 mm/.test(g.name) && J.fontRangeText(g) === '5–8 pt');
  assert('No preset (an old project): the default limits', J.presetLimits(undefined, fallback) === fallback && J.presetLimits({ name: 'x' }, fallback) === fallback);

  // ---- units ----
  assert('300 px at 300 dpi are 25.4 mm and 72 pt; and back', near(U.fromPx(300, 'mm', 300), 25.4) && near(U.fromPx(300, 'pt', 300), 72) && near(U.toPx(25.4, 'mm', 300), 300) && near(U.toPx(8, 'pt', 300), 100 / 3) && U.toPx(7, 'px', 300) === 7);
  assert('Lengths in mm, line widths and font sizes in pt; everything in px with the px option', U.unitFor('length', 'mm-pt') === 'mm' && U.unitFor('line', 'mm-pt') === 'pt' && U.unitFor('font', 'mm-pt') === 'pt' &&
    U.KINDS.every(k => U.unitFor(k, 'px') === 'px'));
  assert('Shown with at most two decimals (px as given); arrow steps of 0.1 mm, 0.25 pt for lines and 0.5 pt for fonts', U.formatValue(8.46666, 'mm') === '8.47' && U.formatValue(33.333, 'px') === '33.333' &&
    U.stepFor('length', 'mm', '1') === '0.1' && U.stepFor('line', 'pt', '1') === '0.25' && U.stepFor('font', 'pt', '1') === '0.5' && U.stepFor('font', 'px', '1') === '1');
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const checks = await runJournalPresetsRegressions(); console.log(`PASS journal-presets-regression: ${checks.length} checks`); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

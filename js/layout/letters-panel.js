/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The Panel letters panel (top bar ▸ Letters): letters the selected panels in one click, sets the
   document's letter style, and skips or overrides the letter of the selected panel. The letters
   themselves are js/layout/letters.js. */

import { canvas } from '../core/state.js';
import { isGrid } from './grid.js';
import { addLetters, isLetter, isPanel, letterOf, letterStyle, removeLetters, setLetterStyle, setOverride, setSkip } from './letters.js';

const $ = id => document.getElementById(id);
let opened = false;
const byId = id => canvas.getObjects().find(o => o.mfcId === id) || null;

/** The panels a selection stands for: images, the panels of a grid, the panels of selected letters. */
export function selectedPanels() {
  const out = [];
  const add = p => { if (isPanel(p) && !out.includes(p)) out.push(p); };
  for (const o of canvas ? canvas.getActiveObjects() : []) {
    if (isGrid(o)) o.mfcGrid.areas.forEach(a => add(a.panel && byId(a.panel)));
    else if (isLetter(o)) add(byId(o.mfcLetterFor));
    else add(o);
  }
  return out;
}

export function refreshLettersPanel() {
  const panel = $('panel-letters');
  if (!panel) return;
  const panels = selectedPanels(), lettered = panels.filter(p => p.mfcLetter);
  panel.classList.toggle('hidden', !(opened || lettered.length));
  const s = letterStyle();
  $('letters-case').value = s.case; $('letters-bold').checked = s.bold; $('letters-size').value = String(s.sizePt);
  $('letters-position').value = s.position; $('letters-placement').value = s.placement; $('letters-offset').value = String(s.offsetMm); $('letters-color').value = s.color;
  $('letters-add').disabled = !panels.length;
  const single = lettered.length === 1 && panels.length === 1 ? lettered[0] : null;
  $('letters-selected').classList.toggle('hidden', !lettered.length);
  $('letters-skip').disabled = !single; $('letters-override').disabled = !single;
  $('letters-skip').checked = !!(single && single.mfcLetter.skip);
  const letter = single && letterOf(single);
  if (document.activeElement !== $('letters-override')) $('letters-override').value = single && single.mfcLetter.text ? single.mfcLetter.text : '';
  $('letters-override').placeholder = letter ? letter.text + ' (automatic)' : '';
  $('letters-info').textContent = single ? (single.mfcLetter.skip ? 'This panel is skipped: it has no letter.' : `This panel is lettered ${letter ? letter.text : ''}${single.mfcLetter.text ? ' (its own letter)' : ''}.`)
    : `${lettered.length} lettered panels selected.`;
}

/** Connects the panel's controls and the top bar button (once, when the editor loads). */
export function installLettersPanel() {
  if (!$('panel-letters')) return;
  $('btn-letters').addEventListener('click', () => {
    opened = true;
    const panels = selectedPanels();
    if (panels.length) addLetters(panels);
    refreshLettersPanel();
    if (!panels.length) MFC_UI.toast('Select the panels (or a grid) to letter, then click Letters or "Letter selected panels".');
  });
  $('letters-close').addEventListener('click', () => { opened = false; $('panel-letters').classList.add('hidden'); });
  $('letters-add').addEventListener('click', () => { addLetters(selectedPanels()); refreshLettersPanel(); });
  $('letters-remove').addEventListener('click', () => { removeLetters(selectedPanels()); refreshLettersPanel(); });
  const style = (id, key, read) => $(id).addEventListener('change', () => { const v = read($(id)); if (v !== undefined) setLetterStyle({ [key]: v }); refreshLettersPanel(); });
  style('letters-case', 'case', el => el.value);
  style('letters-bold', 'bold', el => el.checked);
  style('letters-size', 'sizePt', el => { const v = parseFloat(el.value); return v >= 2 && v <= 200 ? v : undefined; });
  style('letters-position', 'position', el => el.value);
  style('letters-placement', 'placement', el => el.value);
  style('letters-offset', 'offsetMm', el => { const v = parseFloat(el.value); return v >= 0 && v <= 50 ? v : undefined; });
  style('letters-color', 'color', el => el.value);
  const single = () => { const p = selectedPanels().filter(x => x.mfcLetter); return p.length === 1 ? p[0] : null; };
  $('letters-skip').addEventListener('change', () => { const p = single(); if (p) setSkip(p, $('letters-skip').checked); refreshLettersPanel(); });
  $('letters-override').addEventListener('change', () => { const p = single(); if (p) setOverride(p, $('letters-override').value); refreshLettersPanel(); });
  $('letters-override').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('letters-override').blur(); } });
}

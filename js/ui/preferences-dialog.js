/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Preferences dialog (top bar → Preferences, or Ctrl+,): a modal above the canvas and the panels.
   Its rows are built from PREFERENCES (js/core/preferences.js), so a new preference appears here
   without changes to this file. Each row has a "This project only" tick: ticked, the control edits
   the open project's own value, which overrides the global one in this project; unticked, it edits
   the global value used by every project. Changes apply at once. */

import { PREFERENCES, SECTIONS, FONTS, getPreference, globalPreference, isProjectOverride,
  onPreferenceChange, resetGlobalPreferences, setGlobalPreference, setProjectPreference } from '../core/preferences.js';

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = String(text);
  return e;
}
const describe = (def, value) => {
  if (def.type === 'boolean') return value ? 'on' : 'off';
  if (def.type === 'set') return value.length ? def.options.filter(o => value.includes(o.value)).map(o => o.label).join(', ') : 'none';
  if (def.type === 'choice') return (def.options.find(o => o.value === value) || {}).label || String(value);
  return String(value);
};

/** One control for a preference; onChange(value) receives a value of the entry's type. */
function control(def, value, onChange, id) {
  if (def.type === 'boolean') {
    const box = el('input'); box.type = 'checkbox'; box.id = id; box.checked = !!value;
    box.addEventListener('change', () => onChange(box.checked));
    return box;
  }
  if (def.type === 'number') {
    const input = el('input'); input.type = 'number'; input.id = id; input.value = String(value);
    Object.assign(input, { min: def.min, max: def.max, step: def.step || 'any' });
    input.addEventListener('change', () => { const n = parseFloat(input.value); if (!onChange(n)) input.value = String(getPreference(def.key)); });
    return input;
  }
  if (def.type === 'color') {
    const input = el('input'); input.type = 'color'; input.id = id; input.value = value;
    input.addEventListener('change', () => onChange(input.value)); // change, not input: one step per pick
    return input;
  }
  if (def.type === 'choice' || def.type === 'font') {
    const select = el('select'); select.id = id;
    const options = def.type === 'font' ? FONTS.map(f => ({ value: f, label: f })) : def.options;
    for (const o of options) { const opt = el('option', null, o.label); opt.value = o.value; select.append(opt); }
    if (def.type === 'font' && !options.some(o => o.value === value)) { const opt = el('option', null, value); opt.value = value; select.prepend(opt); }
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }
  if (def.type === 'set') {
    const group = el('div', 'pref-set'); group.id = id; group.setAttribute('role', 'group');
    for (const o of def.options) {
      const label = el('label', 'pref-set-item'), box = el('input');
      box.type = 'checkbox'; box.value = o.value; box.checked = value.includes(o.value);
      box.addEventListener('change', () => onChange([...group.querySelectorAll('input:checked')].map(b => b.value)));
      label.append(box, document.createTextNode(' ' + o.label));
      group.append(label);
    }
    return group;
  }
  return el('span', null, String(value));
}

function row(def) {
  const id = 'pref-' + def.key.replace(/[^a-z0-9]+/gi, '-');
  const wrap = el('div', 'pref-row'); wrap.dataset.key = def.key; wrap.title = def.help || '';
  const own = isProjectOverride(def.key), project = window.MFC && MFC.hasDocument;
  const name = el(def.type === 'set' ? 'span' : 'label', 'pref-label', def.label);
  if (def.type !== 'set') name.htmlFor = id; else name.id = id + '-label';
  const value = getPreference(def.key);
  const input = control(def, value, v => (own ? setProjectPreference(def.key, v) : setGlobalPreference(def.key, v)), id);
  if (def.type === 'set') input.setAttribute('aria-labelledby', id + '-label');
  input.title = def.help || '';
  const scope = el('label', 'pref-scope'), tick = el('input');
  tick.type = 'checkbox'; tick.checked = own; tick.disabled = !project;
  tick.className = 'pref-project-only';
  tick.title = project ? 'Use a value of its own for this project only; it overrides the global preference in this project and is saved with it'
    : 'Open a figure to give this project its own value';
  tick.setAttribute('aria-label', def.label + ': this project only');
  tick.addEventListener('change', () => setProjectPreference(def.key, tick.checked ? getPreference(def.key) : undefined));
  scope.append(tick, document.createTextNode(' This project only'));
  const note = el('p', 'pref-note hint', own ? `Global value: ${describe(def, globalPreference(def.key))}.` : '');
  note.hidden = !own;
  wrap.append(name, input, scope, note);
  return wrap;
}

function render(body) {
  const focusedKey = document.activeElement && document.activeElement.closest('.pref-row')?.dataset.key;
  const focusedScope = document.activeElement && document.activeElement.classList.contains('pref-project-only');
  body.replaceChildren(...SECTIONS.map(section => {
    const box = el('section', 'pref-section'); box.setAttribute('aria-labelledby', 'pref-section-' + section.id);
    const h = el('h3', null, section.label); h.id = 'pref-section-' + section.id;
    box.append(h, ...PREFERENCES.filter(def => def.section === section.id).map(row));
    return box;
  }));
  if (focusedKey) {
    const r = body.querySelector(`.pref-row[data-key="${CSS.escape(focusedKey)}"]`);
    const target = r && (focusedScope ? r.querySelector('.pref-project-only') : r.querySelector('input, select'));
    if (target) target.focus();
  }
}

/** Opens the Preferences dialog (nothing happens if it is already open). */
export function showPreferences() {
  if (document.querySelector('.preferences-backdrop')) return;
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.getElementById('btn-preferences');
  const backdrop = el('div', 'modal-backdrop preferences-backdrop');
  const dialog = el('div', 'modal preferences-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'preferences-title');
  const title = el('h2', null, 'Preferences'); title.id = 'preferences-title';
  const intro = el('p', 'hint', 'Changes apply at once. A preference is global (every project, saved in this browser) unless you tick "This project only", which gives the open project its own value, saved with it.');
  const body = el('div', 'preferences-body');
  const reset = el('button', null, 'Reset global preferences'); reset.type = 'button'; reset.id = 'preferences-reset';
  reset.title = 'Set every global preference back to its default (values of this project are kept)';
  const close = el('button', null, 'Close'); close.type = 'button'; close.id = 'preferences-close'; close.title = 'Close Preferences (Esc)';
  const buttons = el('div', 'btn-row'); buttons.append(reset, close);
  dialog.append(title, intro, body, buttons);
  backdrop.append(dialog);
  render(body);
  const stop = onPreferenceChange(() => render(body));
  const done = () => { stop(); backdrop.remove(); if (opener && opener.focus) opener.focus(); };
  reset.addEventListener('click', () => resetGlobalPreferences());
  close.addEventListener('click', done);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) done(); });
  backdrop.addEventListener('keydown', event => {
    event.stopPropagation(); // keep the app's shortcuts (Delete, arrows, Ctrl+Z) away from the dialog
    if (event.key === 'Escape') { event.preventDefault(); done(); return; }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('input:not([disabled]), select, button')], first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.body.append(backdrop);
  const target = dialog.querySelector('input, select');
  target.focus();
  // Firefox can ignore the first focus() on a dialog built in the same task; try again next frame.
  if (document.activeElement !== target) requestAnimationFrame(() => { if (backdrop.isConnected && !dialog.contains(document.activeElement)) target.focus(); });
}

document.getElementById('btn-preferences').addEventListener('click', showPreferences);
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === ',') { event.preventDefault(); showPreferences(); }
});

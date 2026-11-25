/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Templates (P3-T6): "Save as template" writes the figure's layout, styles and labels to a
   .fftemplate.json file, every image turned into an empty frame and no image data kept;
   "From template" opens a built-in template or a template file as a new figure with empty frames to
   drop files into (js/image/replace.js fills them). The format is in js/layout/template-model.js and
   docs/PROJECT-FORMAT.md. */

import { resetHistory } from '../core/history.js';
import { docProps, getAppVersion } from '../core/state.js';
import { relayoutGrids } from '../layout/grid.js';
import { renumberLetters } from '../layout/letters.js';
import { BUILT_IN, builtInTemplate, holdsImageData, stateFromTemplate, templateFromState, templateProblems } from '../layout/template-model.js';

/** The template of the open figure (no image data). */
export function currentTemplate(name = docProps.name) {
  const t = templateFromState(MFC_PROJECT.captureState(), name, getAppVersion());
  if (holdsImageData(t.objects)) throw new Error('The template still holds image data; it was not saved.'); // never expected
  return t;
}

/** Saves the open figure as a template file. Resolves to the template. */
export function saveAsTemplate() {
  if (!MFC.hasDocument) { MFC_UI.toast('Create or open a figure first.'); return null; }
  const t = currentTemplate();
  const base = String(t.name).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'template';
  MFC_EXPORT.download(new Blob([JSON.stringify(t, null, 1)], { type: 'application/json' }), base + '.fftemplate.json');
  MFC_UI.toast(`Saved the template "${t.name}": the layout, styles and labels, with ${t.objects.filter(o => o.mfcType === 'imageFrame').length} empty frame(s) and no image data.`);
  return t;
}

/** Opens a template (a template file's content) as a new figure. */
export async function openTemplate(t) {
  const problems = templateProblems(t);
  if (problems.length) throw new Error(problems.join(' '));
  await MFC_PROJECT.createFromTemplate(stateFromTemplate(t));
  relayoutGrids();
  renumberLetters();
  resetHistory(); // the template as it opens is the first History step
  MFC.getCanvas().requestRenderAll();
  // Frames of a group fill together and inset frames from their outline: one file per remaining target.
  const empty = MFC.getCanvas().getObjects().filter(o => o.mfcType === 'imageFrame' && !o.mfcFrameInsetContour);
  const files = new Set(empty.map(f => f.mfcFrameGroup || f.mfcId)).size;
  MFC_UI.toast(`${t.name}: ` + (files === 1 ? 'drop one image file on an empty frame' : `drop an image file on each of the ${files} empty frames`) + ' (or select a frame and use Fill frame…).');
}
/** Opens a built-in template by id. */
export const openBuiltIn = (id, dpi = 300) => openTemplate(builtInTemplate(id, dpi));

/** Reads a template file. */
export async function readTemplateFile(file) {
  let t;
  try { t = JSON.parse(await file.text()); } catch (_) { throw new Error(`${file.name} is not a template file (it is not JSON).`); }
  return t;
}

/** The From template dialog: the five built-ins and a template file. */
export function showTemplateDialog() {
  if (document.querySelector('.template-backdrop')) return;
  const opener = document.activeElement;
  const el = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text != null) e.textContent = text; return e; };
  const backdrop = el('div', 'modal-backdrop template-backdrop'), dialog = el('form', 'modal template-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'template-title');
  const title = el('h2', null, 'New figure from a template'); title.id = 'template-title';
  const list = el('fieldset', 'template-list'); list.append(el('legend', null, 'Built-in templates'));
  BUILT_IN.forEach((b, i) => {
    const label = el('label', 'template-choice'), radio = el('input');
    radio.type = 'radio'; radio.name = 'template'; radio.value = b.id; radio.id = 'template-' + b.id; radio.checked = i === 0;
    label.title = b.description;
    const text = el('span'); text.append(el('strong', null, b.name), el('span', 'hint', b.description));
    label.append(radio, text); list.append(label);
  });
  const error = el('p', 'export-error'); error.setAttribute('role', 'alert');
  const file = el('button', null, 'Open a template file…'); file.type = 'button'; file.id = 'template-file';
  file.title = 'Open a template saved with Save as template (.fftemplate.json)';
  const cancel = el('button', null, 'Cancel'); cancel.type = 'button'; cancel.id = 'template-cancel'; cancel.title = 'Close without making a figure (Esc)';
  const ok = el('button', 'primary-button', 'Create'); ok.type = 'submit'; ok.id = 'template-ok'; ok.title = 'Make a new figure from the chosen template';
  const buttons = el('div', 'btn-row'); buttons.append(file, cancel, ok);
  dialog.append(title, el('p', 'hint', 'A template has the layout, styles and labels of a figure, with empty frames to drop your images into.'), list, error, buttons);
  backdrop.append(dialog); document.body.append(backdrop);
  const done = () => { backdrop.remove(); if (opener && opener.focus) opener.focus(); };
  const run = async action => { try { await action(); done(); } catch (e) { error.textContent = e.message; } };
  dialog.addEventListener('submit', e => { e.preventDefault(); run(() => openBuiltIn(dialog.querySelector('input[name="template"]:checked').value, 300)); });
  cancel.addEventListener('click', done);
  file.addEventListener('click', () => {
    const input = document.getElementById('template-input');
    input.onchange = () => { const f = input.files && input.files[0]; input.value = ''; if (f) run(async () => openTemplate(await readTemplateFile(f))); };
    input.click();
  });
  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); done(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('input:checked, button')], first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  dialog.querySelector('input[name="template"]:checked').focus();
}

/** The top bar's From template and Save as template buttons. */
export function installTemplates() {
  const open = document.getElementById('btn-new-from-template'), save = document.getElementById('btn-save-template');
  if (!open || !save || open.__mfcTemplates) return;
  open.__mfcTemplates = true;
  open.addEventListener('click', showTemplateDialog);
  save.addEventListener('click', () => { try { saveAsTemplate(); } catch (e) { MFC_ERRORS.report(e, { title: 'Could not save the template' }); } });
}

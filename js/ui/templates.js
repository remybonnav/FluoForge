/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Templates (P3-T6): "Save as template" writes the figure's layout, styles and labels to a
   .fftemplate.json file, every image turned into an empty frame and no image data kept;
   "From template" opens a built-in template or a template file as a new figure with empty frames to
   drop files into (js/image/replace.js fills them). The format is in js/layout/template-model.js and
   docs/PROJECT-FORMAT.md.
   PI-T13: both dialogs explain what a template is and keeps, and the three steps to make and reuse
   one (build a figure, Save as template, From template ▸ Open a template file…); New from template
   shows a preview of each template, a template file's too, before it is opened. */

import { resetHistory } from '../core/history.js';
import { docProps, getAppVersion } from '../core/state.js';
import { relayoutGrids } from '../layout/grid.js';
import { renumberLetters } from '../layout/letters.js';
import { BUILT_IN, builtInTemplate, FRAME_TYPE, holdsImageData, stateFromTemplate, templateFromState, templatePreview, templateProblems } from '../layout/template-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text != null) e.textContent = text; return e; };
/** A paragraph mixing plain text and control names: parts are strings or ['Name'] (shown in bold, class template-control). */
function helpText(tag, className, parts) {
  const p = el(tag, className);
  for (const part of parts) p.append(Array.isArray(part) ? el('strong', 'template-control', part[0]) : document.createTextNode(part));
  return p;
}
/** What a template is and keeps, for both dialogs. */
const WHAT_IT_IS = 'A template is a figure without its images. It keeps the layout, styles and labels: text, shapes, grids, panel letters, scale bars, inset outlines, linked panels. Every image becomes an empty frame; no image data, file names or pixel sizes are kept.';
/** The three steps to make and reuse a template. */
function stepsList() {
  const list = el('ol', 'template-steps');
  list.append(
    helpText('li', null, ['Make: build a figure with your images, laid out and labelled as you want it.']),
    helpText('li', null, ['Save: click ', ['Save as template'], ' in the top bar, name the template and click ', ['Save'], '. You get a .fftemplate.json file.']),
    helpText('li', null, ['Reuse: click ', ['From template'], ', then ', ['Open a template file…'], ', choose the file and click ', ['Create'], '. Drop an image file on each empty frame (or select a frame and click ', ['Fill frame…'], ').']));
  return list;
}

/** Counts the empty frames and labels of a template, for its preview's description. */
function describe(t) {
  const frames = (t.objects || []).filter(o => o && o.mfcType === FRAME_TYPE).length;
  const texts = (t.objects || []).filter(o => o && (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text')).length;
  const pages = Math.max(1, Math.floor(Number(t.docProps && t.docProps.pages)) || 1);
  return `${frames} empty frame${frames === 1 ? '' : 's'}` + (texts ? `, ${texts} text${texts === 1 ? '' : 's'}` : '') + (pages > 1 ? `; ${pages} pages, the first one shown` : '');
}

/** A small drawing of a template's first page (an SVG built element by element: its text stays text). */
export function previewElement(t, widthPx = 120) {
  const p = templatePreview(t);
  const svg = document.createElementNS(SVG_NS, 'svg');
  const set = (node, attrs) => { for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v)); return node; };
  const add = (tag, attrs, parent = svg) => parent.appendChild(set(document.createElementNS(SVG_NS, tag), attrs));
  set(svg, { class: 'template-preview', viewBox: `0 0 ${p.width} ${p.height}`, width: widthPx, height: Math.round(widthPx * p.height / p.width), role: 'img',
    'aria-label': `Preview of ${t.name || 'the template'}: ${describe(t)}` });
  const line = Math.max(1, p.width / 240);
  add('rect', { x: 0, y: 0, width: p.width, height: p.height, fill: '#ffffff', stroke: '#8a94a6', 'stroke-width': line });
  for (const it of p.items) {
    const g = add('g', it.angle ? { transform: `rotate(${it.angle} ${it.cx} ${it.cy})` } : {});
    if (it.kind === 'frame') {
      add('rect', { x: it.x, y: it.y, width: it.w, height: it.h, fill: '#d5dae3', stroke: '#5d6778', 'stroke-width': line, 'stroke-dasharray': `${line * 4} ${line * 3}` }, g);
      const s = Math.min(it.w, it.h) * 0.18; // a small picture sign: this is where an image goes
      add('path', { d: `M${it.x + it.w / 2 - s} ${it.y + it.h / 2 + s * 0.6} l${s * 0.7} ${-s} l${s * 0.5} ${s * 0.6} l${s * 0.3} ${-s * 0.3} l${s * 0.5} ${s * 0.7} z`, fill: '#8a94a6' }, g);
    } else if (it.kind === 'text') {
      const x = it.align === 'center' ? it.x + it.w / 2 : it.align === 'right' ? it.x + it.w : it.x;
      const text = add('text', { x, y: it.y + it.h / 2, 'font-size': it.fontSize, 'font-family': 'sans-serif', fill: it.fill, 'dominant-baseline': 'middle',
        'text-anchor': it.align === 'center' ? 'middle' : it.align === 'right' ? 'end' : 'start' }, g);
      text.textContent = it.text.split('\n')[0];
    } else if (it.kind === 'outline') {
      add('rect', { x: it.x, y: it.y, width: it.w, height: it.h, fill: 'none', stroke: it.stroke, 'stroke-width': line * 1.5 }, g);
    } else {
      const paint = { fill: it.fill || 'none', stroke: it.stroke || (it.fill ? null : '#8a94a6'), 'stroke-width': line };
      if (it.shape === 'ellipse') add('ellipse', { cx: it.x + it.w / 2, cy: it.y + it.h / 2, rx: it.w / 2, ry: it.h / 2, ...paint }, g);
      else if (it.shape === 'line') add('line', { x1: it.x, y1: it.flip ? it.y + it.h : it.y, x2: it.x + it.w, y2: it.flip ? it.y : it.y + it.h, ...paint, stroke: it.stroke || '#000000' }, g);
      else add('rect', { x: it.x, y: it.y, width: it.w, height: it.h, ...paint }, g);
    }
  }
  return svg;
}

/** The template of the open figure (no image data). */
export function currentTemplate(name = docProps.name) {
  const t = templateFromState(MFC_PROJECT.captureState(), name, getAppVersion());
  if (holdsImageData(t.objects)) throw new Error('The template still holds image data; it was not saved.'); // never expected
  return t;
}

/** Saves the open figure as a template file. Resolves to the template. */
export function saveAsTemplate(name = docProps.name) {
  if (!MFC.hasDocument) { MFC_UI.toast('Create or open a figure first.'); return null; }
  const t = currentTemplate(name);
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

/** Keeps Tab inside a dialog and closes it on Esc. */
function trapKeys(backdrop, dialog, done) {
  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); done(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('input:checked, input[type=text], button')], first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

/** The Save as template dialog: what a template keeps, its name, a preview, and how to reuse it. */
export function showSaveTemplateDialog() {
  if (document.querySelector('.template-backdrop')) return;
  if (!MFC.hasDocument) { MFC_UI.toast('Create or open a figure first: a template is made from a figure.'); return; }
  const opener = document.activeElement;
  const backdrop = el('div', 'modal-backdrop template-backdrop'), dialog = el('form', 'modal template-modal template-save-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'template-save-title');
  dialog.noValidate = true;
  const title = el('h2', null, 'Save as template'); title.id = 'template-save-title';
  const name = el('input'); name.type = 'text'; name.id = 'template-name'; name.value = docProps.name || 'Template'; name.maxLength = 120;
  name.title = 'The template\'s name: shown when it is opened, and used for the file name';
  const nameLabel = el('label', 'export-field'); nameLabel.title = name.title; nameLabel.append(el('span', null, 'Name'), name);
  const t = currentTemplate();
  const preview = el('div', 'template-save-preview');
  preview.append(previewElement(t, 200), el('p', 'hint', `This figure as a template: ${describe(t)}.`));
  const keeps = el('p', 'hint', 'A frame remembers its image\'s channel settings (names, LUTs, ranges, gamma). When you drop a file whose channels have the same names, FluoForge offers to use them again.');
  const error = el('p', 'export-error'); error.setAttribute('role', 'alert');
  const cancel = el('button', null, 'Cancel'); cancel.type = 'button'; cancel.id = 'template-save-cancel'; cancel.title = 'Close without saving (Esc)';
  const ok = el('button', 'primary-button', 'Save'); ok.type = 'submit'; ok.id = 'template-save-ok'; ok.title = 'Save the template as a .fftemplate.json file';
  const buttons = el('div', 'btn-row'); buttons.append(cancel, ok);
  dialog.append(title, el('p', 'hint', WHAT_IT_IS), preview, nameLabel, keeps, el('h3', 'template-steps-title', 'Making and reusing a template'), stepsList(), error, buttons);
  backdrop.append(dialog); document.body.append(backdrop);
  const done = () => { backdrop.remove(); if (opener && opener.focus) opener.focus(); };
  dialog.addEventListener('submit', e => {
    e.preventDefault();
    const value = name.value.trim();
    if (!value) { error.textContent = 'Give the template a name.'; name.focus(); return; }
    try { saveAsTemplate(value); done(); } catch (err) { error.textContent = err.message; }
  });
  cancel.addEventListener('click', done);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) done(); });
  trapKeys(backdrop, dialog, done);
  name.focus(); name.select();
}

/** The From template dialog: what a template is, the five built-ins and a template file, each with a preview. */
export function showTemplateDialog() {
  if (document.querySelector('.template-backdrop')) return;
  const opener = document.activeElement;
  const backdrop = el('div', 'modal-backdrop template-backdrop'), dialog = el('form', 'modal template-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'template-title');
  const title = el('h2', null, 'New figure from a template'); title.id = 'template-title';
  const list = el('fieldset', 'template-list'); list.append(el('legend', null, 'Built-in templates'));
  const choice = (value, t, heading, description) => {
    const label = el('label', 'template-choice'), radio = el('input');
    radio.type = 'radio'; radio.name = 'template'; radio.value = value; radio.id = 'template-' + value;
    label.title = description;
    const text = el('span'); text.append(el('strong', null, heading), el('span', 'hint', description));
    label.append(radio, previewElement(t, 96), text);
    return label;
  };
  BUILT_IN.forEach((b, i) => { const label = choice(b.id, builtInTemplate(b.id, 300), b.name, b.description); label.querySelector('input').checked = i === 0; list.append(label); });
  let fileTemplate = null;
  const error = el('p', 'export-error'); error.setAttribute('role', 'alert');
  const file = el('button', null, 'Open a template file…'); file.type = 'button'; file.id = 'template-file';
  file.title = 'Open a template saved with Save as template (.fftemplate.json)';
  const cancel = el('button', null, 'Cancel'); cancel.type = 'button'; cancel.id = 'template-cancel'; cancel.title = 'Close without making a figure (Esc)';
  const ok = el('button', 'primary-button', 'Create'); ok.type = 'submit'; ok.id = 'template-ok'; ok.title = 'Make a new figure from the chosen template';
  const buttons = el('div', 'btn-row'); buttons.append(file, cancel, ok);
  const help = el('details', 'template-help'); help.open = true;
  const summary = el('summary', null, 'Making and reusing your own template'); summary.title = 'Show or hide the three steps';
  help.append(summary, stepsList());
  dialog.append(title, el('p', 'hint', WHAT_IT_IS), list, help, error, buttons);
  backdrop.append(dialog); document.body.append(backdrop);
  const done = () => { backdrop.remove(); if (opener && opener.focus) opener.focus(); };
  const run = async action => { try { await action(); done(); } catch (e) { error.textContent = e.message; } };
  dialog.addEventListener('submit', e => {
    e.preventDefault();
    const value = dialog.querySelector('input[name="template"]:checked').value;
    run(() => (value === 'file' ? openTemplate(fileTemplate) : openBuiltIn(value, 300)));
  });
  cancel.addEventListener('click', done);
  /** A template file becomes a choice of its own, with its preview, chosen: Create opens it. */
  const addFile = async f => {
    error.textContent = '';
    try {
      const t = await readTemplateFile(f);
      const problems = templateProblems(t);
      if (problems.length) throw new Error(`${f.name}: ${problems.join(' ')}`);
      fileTemplate = t;
      const old = list.querySelector('#template-file-choice'); if (old) old.closest('label').remove();
      const label = choice('file', t, String(t.name || f.name), `From the file ${f.name}: ${describe(t)}. Click Create to open it.`);
      const radio = label.querySelector('input'); radio.id = 'template-file-choice'; radio.checked = true;
      list.append(label); radio.focus();
    } catch (err) { error.textContent = err.message; }
  };
  file.addEventListener('click', () => {
    const input = document.getElementById('template-input');
    input.onchange = () => { const f = input.files && input.files[0]; input.value = ''; if (f) addFile(f); };
    input.click();
  });
  trapKeys(backdrop, dialog, done);
  dialog.querySelector('input[name="template"]:checked').focus();
}

/** The top bar's From template and Save as template buttons. */
export function installTemplates() {
  const open = document.getElementById('btn-new-from-template'), save = document.getElementById('btn-save-template');
  if (!open || !save || open.__mfcTemplates) return;
  open.__mfcTemplates = true;
  open.addEventListener('click', showTemplateDialog);
  save.addEventListener('click', () => { try { showSaveTemplateDialog(); } catch (e) { MFC_ERRORS.report(e, { title: 'Could not save the template' }); } });
}

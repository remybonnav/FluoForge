/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The Series montage dialog (top bar ▸ Series montage): Z slices or time frames, the first and last
   plane and the step or a typed list of planes ("1, 2, 5, 12-20", P3-T9b), a strip or a grid of some columns, the gap in mm, and labels on or off. A line
   says which planes the montage will show. Its layout choices are remembered until the page is closed.
   The montage itself is made by js/image/series.js. */

import { defaultAxis, selectedImages, seriesMontage, seriesOptions, seriesSize } from '../image/series.js';
import * as S from '../image/series-model.js';

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = String(text);
  return e;
}
function field(labelText, control, title) {
  const label = el('label', 'export-field'); label.title = title;
  label.append(el('span', null, labelText), control);
  return label;
}
function number(id, min, max, step, value) {
  const input = el('input'); input.type = 'number'; input.id = id; input.min = String(min); if (max != null) input.max = String(max);
  input.step = String(step); input.value = String(value);
  return input;
}
const whole = v => (String(v).trim() === '' ? NaN : Number(v));

/** The options the dialog's fields describe, or throws with a message for the user. */
export function readSeriesOptions(form, img) {
  const axis = form.querySelector('#sm-axis').value, pick = form.querySelector('#sm-pick').value === 'list' ? 'list' : 'range';
  const options = pick === 'list' ? { axis, pick, list: form.querySelector('#sm-list').value }
    : { axis, pick, from: whole(form.querySelector('#sm-from').value), to: whole(form.querySelector('#sm-to').value), step: whole(form.querySelector('#sm-step').value) };
  const planes = pick === 'list' ? S.parsePlanes(options.list, seriesSize(img, axis), axis) : S.seriesPlanes(seriesSize(img, axis), options, axis);
  const grid = form.querySelector('#sm-layout').value === 'grid';
  const columns = grid ? whole(form.querySelector('#sm-columns').value) : 0;
  if (grid && !(Number.isInteger(columns) && columns >= 1 && columns <= S.MAX_PANELS)) throw new Error(`Enter a number of columns between 1 and ${S.MAX_PANELS}.`);
  const gap = Number(form.querySelector('#sm-gap').value);
  if (!(Number.isFinite(gap) && gap >= 0 && gap <= 50)) throw new Error('Enter a gap between 0 and 50 mm.');
  return { ...options, columns, gapMm: gap, labels: form.querySelector('#sm-labels').checked, planes };
}

/** Opens the dialog for the selected image. */
export function showSeriesDialog() {
  if (document.querySelector('.series-backdrop')) return;
  const images = selectedImages(), img = images.find(o => defaultAxis(o)) || null;
  if (images.length !== 1 || !img) {
    MFC_UI.toast(images.length > 1 ? 'Select one image: a series montage is made from one Z stack or time series.'
      : images.length ? `${images[0].mfcFileName || 'The image'} is not a Z stack or a time series.` : 'Select a Z stack or time series first: it becomes a strip or grid of panels, one per slice or frame.');
    return;
  }
  const opener = document.getElementById('btn-series');
  const backdrop = el('div', 'modal-backdrop series-backdrop'), dialog = el('form', 'modal export-modal series-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'sm-title');
  dialog.noValidate = true;
  const title = el('h2', null, 'Series montage'); title.id = 'sm-title';
  const intro = el('p', 'hint', `${img.mfcFileName || 'The image'} becomes a strip or grid of linked panels, one per slice or frame, each labelled with its position or time. Crop or adjust one panel to change them all.`);

  const axis = el('select'); axis.id = 'sm-axis';
  for (const a of ['t', 'z']) {
    const n = seriesSize(img, a);
    if (n < 2) continue;
    const o = el('option', null, `${S.AXES[a].label} (${n})`); o.value = a; axis.append(o);
  }
  axis.value = seriesOptions.axis && seriesSize(img, seriesOptions.axis) > 1 ? seriesOptions.axis : defaultAxis(img);
  const pick = el('select'); pick.id = 'sm-pick';
  for (const [value, text] of [['range', 'Range and step'], ['list', 'Specific planes']]) { const o = el('option', null, text); o.value = value; pick.append(o); }
  pick.value = seriesOptions.pick === 'list' ? 'list' : 'range';
  const from = number('sm-from', 1, null, 1, 1), to = number('sm-to', 1, null, 1, 1), step = number('sm-step', 1, null, 1, 1);
  const list = el('input'); list.type = 'text'; list.id = 'sm-list'; list.autocomplete = 'off'; list.spellcheck = false;
  const listField = field('Planes', list, '');
  const rangeFields = [field('First', from, ''), field('Last', to, ''), field('Step', step, '')];
  const layout = el('select'); layout.id = 'sm-layout';
  for (const [value, text] of [['strip', 'Strip (one row)'], ['grid', 'Grid']]) { const o = el('option', null, text); o.value = value; layout.append(o); }
  layout.value = seriesOptions.columns > 0 ? 'grid' : 'strip';
  const columns = number('sm-columns', 1, S.MAX_PANELS, 1, seriesOptions.columns > 0 ? seriesOptions.columns : 4);
  const columnsField = field('Columns', columns, 'Panels per row of the grid; the rows fill from left to right, top to bottom');
  const gap = number('sm-gap', 0, 50, 0.1, seriesOptions.gapMm);
  const labels = el('input'); labels.type = 'checkbox'; labels.id = 'sm-labels'; labels.checked = seriesOptions.labels !== false;
  const labelsField = field('Labels', labels, 'Put a label on each panel: its Z position in µm (or slice number) or its time (or frame number). The labels follow their panel.');
  const summary = el('p', 'hint series-summary'); summary.id = 'sm-summary'; summary.setAttribute('aria-live', 'polite');
  const error = el('p', 'export-error'); error.setAttribute('role', 'alert');
  const ok = el('button', 'primary-button', 'Create'); ok.type = 'submit'; ok.id = 'sm-ok'; ok.title = 'Make the linked panels';
  const cancel = el('button', null, 'Cancel'); cancel.type = 'button'; cancel.id = 'sm-cancel'; cancel.title = 'Close without changing anything (Esc)';
  const buttons = el('div', 'btn-row'); buttons.append(cancel, ok);

  const resetRange = () => {
    const n = seriesSize(img, axis.value), word = S.AXES[axis.value].one;
    for (const input of [from, to]) input.max = String(n);
    from.value = '1'; to.value = String(n); step.value = String(S.defaultStep(n)); step.max = String(n);
    from.title = `The first ${word} shown (1 to ${n})`; to.title = `The last ${word} that can be shown (1 to ${n})`;
    step.title = `Show every this many ${S.AXES[axis.value].many}: 1 shows them all`;
    const many = S.AXES[axis.value].many;
    pick.options[1].textContent = `Specific ${many}`;
    list.title = `The ${many} to show, in this order (1 to ${n}): numbers and ranges such as 1, 2, 5, 10 or 1, 5, 12-20`;
    list.placeholder = n >= 20 ? '1, 2, 5, 10 or 1, 5, 12-20' : `1, 2, ${Math.min(n, 4)}`;
    listField.title = list.title;
    // A new list starts as the range's planes, to edit.
    list.value = S.formatPlanes(S.seriesPlanes(n, { step: S.defaultStep(n) }, axis.value));
  };
  const showPick = () => {
    const byList = pick.value === 'list';
    listField.classList.toggle('hidden', !byList); list.disabled = !byList;
    rangeFields.forEach(f => f.classList.toggle('hidden', byList));
    [from, to, step].forEach(input => { input.disabled = byList; });
  };
  const update = () => {
    showPick();
    columnsField.classList.toggle('hidden', layout.value !== 'grid');
    columns.disabled = layout.value !== 'grid';
    try {
      const o = readSeriesOptions(dialog, img), shape = S.gridShape(o.planes.length, o.columns);
      // A typed list is said back whole (runs joined); a range, shortened.
      const which = o.pick === 'list' ? S.formatPlanes(o.planes) : S.describePlanes(o.planes);
      summary.textContent = `${o.planes.length} panels (${shape.columns} × ${shape.rows}): ${S.AXES[o.axis].many} ${which}.`;
      error.textContent = ''; ok.disabled = false;
    } catch (e) { summary.textContent = ''; error.textContent = e.message; ok.disabled = true; }
  };
  resetRange();
  dialog.append(title, intro,
    field('Series', axis, 'Make the panels from the Z slices or from the time frames'),
    field('Show', pick, 'Show a range of planes every so many, or the planes you type, in your order'), ...rangeFields, listField,
    field('Layout', layout, 'One row of panels, or a grid of the number of columns you choose'), columnsField,
    field('Gap (mm)', gap, 'Space between panels, in millimetres on the printed figure'),
    labelsField, summary, error, buttons);
  // The fields' own titles also on their labels (set by resetRange).
  for (const input of [from, to, step]) input.closest('label').title = input.title;
  backdrop.append(dialog);

  axis.addEventListener('change', () => { resetRange(); for (const input of [from, to, step]) input.closest('label').title = input.title; update(); });
  dialog.addEventListener('input', update);
  dialog.addEventListener('change', update);
  const done = () => { backdrop.remove(); if (opener && opener.focus) opener.focus(); };
  dialog.addEventListener('submit', async event => {
    event.preventDefault();
    let options;
    try { options = readSeriesOptions(dialog, img); } catch (e) { error.textContent = e.message; return; }
    Object.assign(seriesOptions, { axis: options.axis, pick: options.pick, columns: options.columns, gapMm: options.gapMm, labels: options.labels });
    done();
    try { await seriesMontage(img, options); } catch (e) { MFC_UI.toast(e.message); }
  });
  cancel.addEventListener('click', done);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) done(); });
  backdrop.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); done(); return; }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('input:not([disabled]), select:not([disabled]), button:not([disabled])')];
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.body.append(backdrop);
  update();
  axis.focus();
  if (document.activeElement !== axis) requestAnimationFrame(() => { if (backdrop.isConnected) axis.focus(); });
}

/** Connects the top bar's Series montage button (once, when the editor loads). */
export function installSeriesMontage() {
  const button = document.getElementById('btn-series');
  if (button) button.addEventListener('click', () => showSeriesDialog());
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The Quick figure dialog (top bar ▸ Quick figure): which channels get a panel, the merges and the
   channels of each (PI-T12: all channels by default; Add merge for more, for example C1 + C2 and
   C1 + C3 + C4), channels in colour or grey, merges first or last, the gap in mm. Its choices are
   remembered until the page is closed. The montage itself is made by js/image/montage.js. */

import { canvas, registry } from '../core/state.js';
import { mergeName, montageOptions, quickFigure } from '../image/montage.js';
import { legendColor } from '../tools/legend.js';

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
const selectedImages = () => {
  const a = canvas.getActiveObject();
  return (a ? (a.type === 'activeSelection' ? a.getObjects() : [a]) : []).filter(o => o.mfcType === 'mfcImage' && registry[o.mfcId]);
};

/** The options the dialog's fields describe, or throws with a message for the user. */
export function readQuickFigureOptions(form) {
  const channels = [...form.querySelectorAll('input[name="qf-channel"]')].filter(c => c.checked).map(c => Number(c.value));
  const merges = [...form.querySelectorAll('.qf-merge-row')].map(row => [...row.querySelectorAll('input[type=checkbox]')].filter(c => c.checked).map(c => Number(c.value)));
  if (!channels.length && !merges.length) throw new Error('Choose at least one channel, or add a merge.');
  const few = merges.findIndex(m => m.length < 2);
  if (few >= 0) throw new Error(`Merge ${few + 1} needs at least two channels: tick more, or remove it.`);
  const same = merges.findIndex((m, i) => merges.findIndex(n => n.join() === m.join()) < i);
  if (same >= 0) throw new Error(`Merges ${merges.findIndex(n => n.join() === merges[same].join()) + 1} and ${same + 1} have the same channels.`);
  const gap = Number(form.querySelector('#qf-gap').value);
  if (!(Number.isFinite(gap) && gap >= 0 && gap <= 50)) throw new Error('Enter a gap between 0 and 50 mm.');
  return { channels, merges, grey: form.querySelector('#qf-colour').value === 'grey', mergeFirst: form.querySelector('#qf-merge').value === 'first', gapMm: gap };
}

/** Opens the dialog for the selected images. */
export function showQuickFigureDialog() {
  if (document.querySelector('.quick-figure-backdrop')) return;
  const images = selectedImages();
  if (!images.length) { MFC_UI.toast('Select one or more images first: each becomes a row of panels, one per channel plus a merge.'); return; }
  const opener = document.getElementById('btn-quick-figure');
  const raw = registry[images[0].mfcId].rawImage;
  const backdrop = el('div', 'modal-backdrop quick-figure-backdrop'), dialog = el('form', 'modal export-modal quick-figure-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'qf-title');
  dialog.noValidate = true;
  const title = el('h2', null, 'Quick figure'); title.id = 'qf-title';
  const intro = el('p', 'hint', images.length === 1 ? 'The image becomes a row of panels: one per channel and one per merge, with column headers. The panels stay linked: crop or adjust one to change them all.'
    : `Each of the ${images.length} images becomes a row of panels: one per channel and one per merge, with column headers above the first row. The panels of a row stay linked.`);

  const box = el('fieldset', 'export-pages qf-channels'); box.append(el('legend', null, 'Channels'));
  box.title = 'The channels that get their own panel' + (images.length > 1 ? ' (by channel number, for every image)' : '');
  raw.channels.forEach((ch, i) => {
    const label = el('label'), check = el('input'); check.type = 'checkbox'; check.name = 'qf-channel'; check.value = String(i); check.id = 'qf-channel-' + i;
    check.checked = montageOptions.channels ? montageOptions.channels.includes(i) : !!ch.enabled;
    const swatch = el('span', 'qf-swatch'); swatch.style.background = legendColor(ch, 'transparent');
    label.title = `Include ${ch.name || 'channel ' + (i + 1)}`;
    label.append(check, swatch, document.createTextNode(' ' + (ch.name || `Ch ${i + 1}`))); box.append(label);
  });
  // The merges: one row each, with a tick per channel, the merge's name and Remove; Add merge below.
  const mergeBox = el('fieldset', 'export-pages qf-merges'); mergeBox.append(el('legend', null, 'Merges'));
  mergeBox.title = 'Each merge is a panel showing the ticked channels together, named by them (for example "Ch1 + Ch2")' + (images.length > 1 ? ', by channel number for every image' : '');
  const mergeList = el('div', 'qf-merge-list');
  const add = el('button', 'qf-merge-add', 'Add merge'); add.type = 'button'; add.id = 'qf-merge-add';
  add.title = 'Add another merge panel, with every channel ticked: untick the ones it leaves out';
  const renumber = () => [...mergeList.children].forEach((row, n) => {
    const set = [...row.querySelectorAll('input[type=checkbox]')].filter(c => c.checked).map(c => Number(c.value));
    row.querySelector('.qf-merge-title').textContent = `Merge ${n + 1}:`;
    row.querySelector('.qf-merge-name').textContent = set.length ? mergeName(raw.channels, set) : '(no channel)';
    row.querySelectorAll('input[type=checkbox]').forEach(c => { c.id = `qf-merge-${n}-${c.value}`; c.closest('label').title = `Show ${raw.channels[c.value].name || 'channel ' + (Number(c.value) + 1)} in merge ${n + 1}`; });
    const remove = row.querySelector('.qf-merge-remove'); remove.title = `Remove merge ${n + 1}`; remove.setAttribute('aria-label', `Remove merge ${n + 1}`);
  });
  const addMerge = set => {
    const row = el('div', 'qf-merge-row');
    const head = el('div', 'qf-merge-head');
    head.append(el('span', 'qf-merge-title'), el('span', 'qf-merge-name'));
    const ticks = el('div', 'qf-merge-channels');
    raw.channels.forEach((ch, i) => {
      const label = el('label'), check = el('input'); check.type = 'checkbox'; check.value = String(i); check.checked = set.includes(i);
      const swatch = el('span', 'qf-swatch'); swatch.style.background = legendColor(ch, 'transparent');
      label.append(check, swatch, document.createTextNode(' ' + (ch.name || `Ch ${i + 1}`))); ticks.append(label);
    });
    const remove = el('button', 'qf-merge-remove', 'Remove'); remove.type = 'button';
    remove.addEventListener('click', () => {
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove(); renumber();
      (next ? next.querySelector('input') : add).focus();
    });
    head.append(remove);
    row.append(head, ticks);
    row.addEventListener('change', renumber);
    mergeList.append(row);
    renumber();
    return row;
  };
  const all = raw.channels.map((c, i) => i);
  (montageOptions.merges || (all.length > 1 ? [all] : [])).map(m => m.filter(i => i < raw.channels.length)).forEach(addMerge); // one channel: nothing to merge
  add.addEventListener('click', () => addMerge(all).querySelector('input').focus());
  mergeBox.append(mergeList, add);

  const colour = el('select'); colour.id = 'qf-colour';
  for (const [value, text] of [['colour', 'In colour'], ['grey', 'In grey']]) { const o = el('option', null, text); o.value = value; colour.append(o); }
  colour.value = montageOptions.grey ? 'grey' : 'colour';
  const merge = el('select'); merge.id = 'qf-merge';
  for (const [value, text] of [['last', 'Last'], ['first', 'First']]) { const o = el('option', null, text); o.value = value; merge.append(o); }
  merge.value = montageOptions.mergeFirst ? 'first' : 'last';
  const gap = el('input'); gap.type = 'number'; gap.id = 'qf-gap'; gap.min = '0'; gap.max = '50'; gap.step = '0.1'; gap.value = String(montageOptions.gapMm);

  const error = el('p', 'export-error'); error.setAttribute('role', 'alert');
  const ok = el('button', 'primary-button', 'Create'); ok.type = 'submit'; ok.id = 'qf-ok'; ok.title = 'Make the rows of linked panels';
  const cancel = el('button', null, 'Cancel'); cancel.type = 'button'; cancel.id = 'qf-cancel'; cancel.title = 'Close without changing anything (Esc)';
  const buttons = el('div', 'btn-row'); buttons.append(cancel, ok);
  dialog.append(title, intro, box, mergeBox,
    field('Channel panels', colour, 'Show each channel panel in its own colour, or in grey (the merges keep the colours; the headers name each colour)'),
    field('Merges', merge, 'Put the merge panels after the channels or before them'),
    field('Gap (mm)', gap, 'Space between panels, in millimetres on the printed figure'),
    error, buttons);
  backdrop.append(dialog);

  const done = () => { backdrop.remove(); if (opener && opener.focus) opener.focus(); };
  dialog.addEventListener('submit', event => {
    event.preventDefault();
    let options;
    try { options = readQuickFigureOptions(dialog); } catch (e) { error.textContent = e.message; return; }
    Object.assign(montageOptions, options);
    done();
    quickFigure(images, options);
  });
  cancel.addEventListener('click', done);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) done(); });
  backdrop.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); done(); return; }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('input:not([disabled]), select:not([disabled]), button')];
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.body.append(backdrop);
  const firstControl = dialog.querySelector('input, select');
  firstControl.focus();
  if (document.activeElement !== firstControl) requestAnimationFrame(() => { if (backdrop.isConnected) firstControl.focus(); });
}

/** Connects the top bar's Quick figure button (once, when the editor loads). */
export function installQuickFigure() {
  const button = document.getElementById('btn-quick-figure');
  if (button) button.addEventListener('click', () => showQuickFigureDialog());
}

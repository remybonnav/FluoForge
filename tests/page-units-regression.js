/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The page size follows the Unit choice (js/ui/page-units.js), in the Create a figure dialog and the
   Document Properties panel: 21 × 29.7 cm become 8.27 × 11.69 in and 2480 × 3508 px at 300 DPI, and
   come back to 21 × 29.7 cm; applying a converted size keeps the page's pixels; a typed number is
   converted from the unit it was typed in; the unit a journal preset sets is followed; the pixel
   preview follows; an empty field, or pixels without a DPI, are left alone. */
async function runPageUnitsRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const shown = id => native.get.call($(id));
  const size = (w, h) => `${shown(w)} × ${shown(h)}`;
  /** What a user does: type a number in a field. */
  const type = (id, text) => { const el = $(id); el.focus(); native.set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  /** What a user does: choose a unit (the select fires input, then change). */
  const choose = (id, unit) => {
    const el = $(id); el.focus();
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, unit);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const U = await import(new URL('js/ui/page-units.js', document.baseURI).href);

  // ---- the conversion ----
  assert('21 cm are 8.27 in and 2480 px at 300 DPI; 29.7 cm are 11.69 in and 3508 px', U.formatLength(U.convertLength(21, 'cm', 'in', 300), 'in') === '8.27' &&
    U.formatLength(U.convertLength(29.7, 'cm', 'in', 300), 'in') === '11.69' && U.formatLength(U.convertLength(21, 'cm', 'px', 300), 'px') === '2480' &&
    U.formatLength(U.convertLength(29.7, 'cm', 'px', 300), 'px') === '3508' && U.convertLength(600, 'px', 'in', 300) === 2);

  // ---- the Create a figure dialog ----
  $('btn-new-document').click();
  const modal = document.querySelector('.document-start-modal');
  await modal.ready;
  type('m-width', '21'); type('m-height', '29.7');
  choose('m-unit', 'in');
  assert('Dialog: cm → inches converts the size (21 × 29.7 cm → 8.27 × 11.69 in)', size('m-width', 'm-height') === '8.27 × 11.69', size('m-width', 'm-height'));
  choose('m-unit', 'px');
  assert('Dialog: inches → pixels at the DPI (2480 × 3508 px)', size('m-width', 'm-height') === '2480 × 3508', size('m-width', 'm-height'));
  choose('m-unit', 'cm');
  assert('Dialog: back to cm gives the same numbers (21 × 29.7), not a rounded drift', size('m-width', 'm-height') === '21 × 29.7', size('m-width', 'm-height'));
  const journal = $('m-journal');
  journal.value = 'generic'; journal.dispatchEvent(new Event('change', { bubbles: true }));
  assert('A journal width preset still fills the size in cm', shown('m-width') === '8.5' && $('m-unit').value === 'cm', size('m-width', 'm-height') + ' ' + $('m-unit').value);
  choose('m-unit', 'in');
  assert('Dialog: the size a preset filled is converted from cm (8.5 cm → 3.35 in)', shown('m-width') === '3.35', shown('m-width'));
  journal.value = ''; journal.dispatchEvent(new Event('change', { bubbles: true }));
  choose('m-unit', 'cm');
  type('m-width', '21'); type('m-height', '29.7');
  choose('m-unit', 'in');
  $('m-ok').click();
  for (let i = 0; i < 100 && document.querySelector('.document-start-modal'); i++) await frame();
  let props = MFC.getDocProps(), px = MFC.docPropsToPixels(props);
  assert('Create in inches: the figure is A4 (2480 × 3508 px at 300 DPI), not 8.27 × 11.69 in rounded (2481 × 3507)', !document.querySelector('.document-start-modal') && props.unit === 'in' &&
    px.width === 2480 && px.height === 3508, `${props.width} × ${props.height} ${props.unit} = ${px.width} × ${px.height}`);

  // ---- the Document Properties panel ----
  assert('Panel: shows the size rounded (8.27 × 11.69 in)', size('doc-width', 'doc-height') === '8.27 × 11.69' && $('doc-unit').value === 'in', size('doc-width', 'doc-height'));
  choose('doc-unit', 'cm');
  assert('Panel: inches → cm converts the size back to 21 × 29.7', size('doc-width', 'doc-height') === '21 × 29.7', size('doc-width', 'doc-height'));
  assert('Panel: the pixel preview follows', /= 2480 × 3508 px at 300 DPI/.test($('doc-pixel-preview').textContent), $('doc-pixel-preview').textContent);
  choose('doc-unit', 'px');
  assert('Panel: cm → pixels (2480 × 3508)', size('doc-width', 'doc-height') === '2480 × 3508', size('doc-width', 'doc-height'));
  choose('doc-unit', 'in');
  $('doc-apply').click();
  props = MFC.getDocProps(); px = MFC.docPropsToPixels(props);
  assert('Panel: Apply after cm → px → in keeps the page at 2480 × 3508 px', props.unit === 'in' && px.width === 2480 && px.height === 3508, `${props.width} × ${props.height} ${props.unit}`);
  assert('Panel: after Apply it still shows 8.27 × 11.69 in', size('doc-width', 'doc-height') === '8.27 × 11.69', size('doc-width', 'doc-height'));

  type('doc-width', '4'); type('doc-height', '2');
  choose('doc-unit', 'cm');
  assert('Panel: a typed size is converted from the unit it was typed in (4 × 2 in → 10.16 × 5.08 cm)', size('doc-width', 'doc-height') === '10.16 × 5.08', size('doc-width', 'doc-height'));
  type('doc-width', '');
  choose('doc-unit', 'in');
  assert('Panel: an empty field stays empty; the other is converted', shown('doc-width') === '' && shown('doc-height') === '2', size('doc-width', 'doc-height'));
  type('doc-width', '3'); type('doc-dpi', '');
  choose('doc-unit', 'px');
  assert('Panel: without a DPI, pixels cannot be worked out and the numbers stay', size('doc-width', 'doc-height') === '3 × 2', size('doc-width', 'doc-height'));
  type('doc-dpi', '300');
  choose('doc-unit', 'in');
  assert('Panel: the next unit change converts from the unit shown (px → in)', size('doc-width', 'doc-height') === '0.01 × 0.01', size('doc-width', 'doc-height'));
  const tip = $('doc-unit').closest('label');
  $('doc-unit').focus();
  assert('The unit select takes the keyboard focus and stays a plain select (its options unchanged)', document.activeElement === $('doc-unit') && [...$('doc-unit').options].map(o => o.value).join() === 'px,cm,in' && !!tip);
  return checks;
}

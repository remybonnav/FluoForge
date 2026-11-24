/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T4: journal presets and print sizes in the editor (the file and the pure parts alone:
   tests/journal-presets-regression.mjs).
   - The New figure dialog lists the journals of presets/journals.json; a width preset fills the size
     in cm; the new figure keeps the preset (docProps.journalPreset), also through save and reopen;
   - the figure check uses the journal's text limits (and says which); a figure without a preset, as
     every older project, keeps the default limits;
   - size fields show mm (selection bar) and pt (stroke and outline widths, scale bar thickness, text
     border, font size), typing in them sets the right px, and Preferences → Size units → px keeps px;
     a dpi change shows the new values;
   - the bundled fonts are labelled by what they replace; titles, focus and keyboard. */
async function runPrintSizeRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const P = await import(new URL('js/core/preferences.js', document.baseURI).href);
  const FC = await import(new URL('js/ui/figure-check.js', document.baseURI).href);
  const presets = await (await fetch('presets/journals.json', { cache: 'no-store' })).json();
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const shownText = id => native.get.call($(id));
  /** What a user does: type a value (in the unit shown) and leave the field. */
  const type = (id, text) => { const el = $(id); el.focus(); native.set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); };
  const pick = (id, value) => { const el = $(id); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
  P.setGlobalPreference('units.size', 'mm-pt');

  // ---- The New figure dialog ----
  $('btn-new-document').click();
  const modal = document.querySelector('.document-start-modal');
  await modal.ready;
  const journal = $('m-journal'), width = $('m-preset');
  assert('The dialog lists "None" and every family of presets/journals.json, by name', [...journal.options].map(o => o.textContent).join('|') === ['None (free size)', ...presets.families.map(f => f.name)].join('|'));
  assert('Journal and Width preset have titles; the width list waits for a journal', !!journal.closest('label').title && !!width.closest('label').title && width.disabled && /No journal/.test($('m-preset-info').textContent));
  pick('m-journal', 'generic');
  assert('Generic: 85, 114 and 174 mm; the first fills the width (8.5 cm)', [...width.options].map(o => o.textContent).join('|') === 'Single column, 85 mm|1.5 column, 114 mm|Double column, 174 mm' &&
    $('m-width').value === '8.5' && $('m-unit').value === 'cm');
  pick('m-preset', 'double');
  assert('Choosing a width fills it in', $('m-width').value === '17.4');
  $('m-unit').value = 'in'; $('m-height').value = '20';
  pick('m-journal', 'nature');
  const nature = presets.families.find(f => f.id === 'nature');
  assert('Nature: its widths; the height is capped at its maximum (20 in → 24.7 cm), the unit is cm', [...width.options].length === nature.widths.length && $('m-width').value === String(nature.widths[0].mm / 10) &&
    $('m-height').value === String(nature.maxHeightMm / 10) && $('m-unit').value === 'cm', `${$('m-width').value} × ${$('m-height').value} ${$('m-unit').value}`);
  pick('m-preset', 'full');
  assert('Full page: the page width and height (18.3 × 24.7 cm)', $('m-width').value === '18.3' && $('m-height').value === '24.7');
  pick('m-preset', 'single');
  const info = $('m-preset-info').textContent;
  assert('The dialog tells the limits and where they come from (source and checked date)', info.includes('5–7 pt') && info.includes(nature.source) && info.includes(nature.checked), info);
  width.focus();
  assert('The selects take the keyboard focus', document.activeElement === width);
  $('m-height').value = '12';
  $('m-ok').click();
  for (let i = 0; i < 100 && document.querySelector('.document-start-modal'); i++) await frame();
  let props = MFC.getDocProps();
  assert('Create: the page is 8.9 × 12 cm and keeps the Nature preset', !document.querySelector('.document-start-modal') && props.width === 8.9 && props.height === 12 && props.unit === 'cm' &&
    props.journalPreset && props.journalPreset.family === 'nature' && props.journalPreset.width === 'single' && props.journalPreset.minFontPt === 5 && props.journalPreset.maxFontPt === 7 &&
    props.journalPreset.source === nature.source, JSON.stringify(props.journalPreset));

  // ---- The figure check uses the journal's limits ----
  const dpi = props.dpi, pt = v => v / 72 * dpi, mm = v => v / 25.4 * dpi;
  const text = new fabric.Textbox('Eight points', { left: mm(5), top: mm(5), width: mm(40), fontSize: pt(8), fontFamily: 'Liberation Sans' });
  Object.assign(text, { mfcId: 'txt' + Date.now(), mfcType: 'text' }); canvas.add(text);
  let findings = FC.checkFigure().filter(f => f.rule === 'text-size');
  assert('8 pt text breaks Nature\'s 5–7 pt, and the finding says so', findings.length === 1 && /Nature allows 5–7 pt/.test(findings[0].message), findings.map(f => f.message).join());
  FC.refreshCheckPanel();
  assert('The Check figure panel says which limits it uses', /5–7 pt and resolution against 300 dpi \(Nature\)/.test($('check-limits').textContent), $('check-limits').textContent);
  const saved = MFC_PROJECT.captureState();
  await MFC_PROJECT.restoreState(JSON.parse(JSON.stringify(saved)), { resetHistory: true }); await MFC_TIFF.whenIdle();
  assert('Saved and reopened, the figure keeps its preset and its limits', MFC.getDocProps().journalPreset?.family === 'nature' && FC.activePreset().maxFontPt === 7 && FC.checkFigure().some(f => f.rule === 'text-size'));
  const science = presets.families.find(f => f.id === 'science');
  MFC.applyDocProps({ ...MFC.getDocProps(), journalPreset: { family: 'science', name: 'Science', width: 'single', widthMm: 57, minFontPt: science.minFontPt, minDpi: science.minDpi } });
  canvas.getObjects().filter(o => o.type === 'textbox').forEach(t => t.set('fontSize', pt(20)));
  assert('A journal that gives no maximum (Science): large text is fine, small text is not', !FC.checkFigure().some(f => f.rule === 'text-size') &&
    (canvas.getObjects().filter(o => o.type === 'textbox').forEach(t => t.set('fontSize', pt(4))), /Science allows at least 5 pt/.test(FC.checkFigure().find(f => f.rule === 'text-size')?.message || '')));
  const old = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await MFC_PROJECT.loadProject(new File([old], 'reference.mfcproj.zip')); document.querySelectorAll('.recovery-modal').forEach(m => m.remove()); await MFC_TIFF.whenIdle();
  assert('An older project has no preset: the default limits (5–8 pt, 300 dpi)', !MFC.getDocProps().journalPreset && FC.activePreset().minFontPt === 5 && FC.activePreset().maxFontPt === 8 && FC.activePreset().minDpi === 300);

  // ---- Size fields in mm and pt ----
  const rdpi = MFC.getDocProps().dpi, rmm = v => v / 25.4 * rdpi, rpt = v => v / 72 * rdpi;
  const rect = new fabric.Rect({ left: 100, top: 120, width: 300, height: 200, fill: '#8888ff', stroke: '#000000', strokeWidth: 3 });
  Object.assign(rect, { mfcId: 'shape' + Date.now(), mfcType: 'shape' }); canvas.add(rect);
  canvas.setActiveObject(rect); canvas.fire('selection:created', { selected: [rect] }); await frame();
  const box = () => rect.getBoundingRect(true, true);
  const suffix = id => $(id).nextElementSibling;
  assert('The selection bar shows mm, with "mm" after each field and in its title', shownText('obj-x') === String(Math.round(box().left / rdpi * 25.4 * 100) / 100) &&
    ['obj-x', 'obj-y', 'obj-width', 'obj-height'].every(id => suffix(id).textContent === 'mm' && /\(mm\)$/.test($(id).closest('label').title)), `${shownText('obj-x')} ${suffix('obj-x').textContent} ${$('obj-x').closest('label').title}`);
  assert('The code still reads px from the field, exactly', $('obj-x').value === String(Math.round(box().left)));
  type('obj-x', '20');
  assert('Typing 20 mm in X puts the object 20 mm from the page edge', near(box().left, rmm(20)), `${box().left} vs ${rmm(20)}`);
  type('obj-width', '50');
  assert('Typing 50 mm in W makes it 50 mm wide', near(box().width, rmm(50), 0.6), `${box().width} vs ${rmm(50)}`);
  assert('Stroke width shows pt (3 px = 0.72 pt at 300 dpi)', shownText('shape-stroke-width') === String(Math.round(3 / rdpi * 72 * 100) / 100) && suffix('shape-stroke-width').textContent === 'pt');
  type('shape-stroke-width', '1');
  assert('Typing 1 pt sets a 1 pt stroke', near(rect.strokeWidth, rpt(1)), String(rect.strokeWidth));
  assert('Scale bar thickness, path and inset widths and the text border show pt', ['sb-thickness', 'path-stroke-width', 'inset-stroke-width', 'text-border-width'].every(id => suffix(id).textContent === 'pt') &&
    shownText('sb-thickness') === String(Math.round(6 / rdpi * 72 * 100) / 100) && !/\(px\)/.test($('sb-thickness').closest('label').textContent) && !/\(px\)/.test($('text-border-width').closest('label').textContent));
  const label = new fabric.Textbox('Label', { left: 50, top: 50, width: 200, fontSize: 24, fontFamily: 'Liberation Sans' });
  Object.assign(label, { mfcId: 'txt' + (Date.now() + 1), mfcType: 'text' }); canvas.add(label);
  canvas.setActiveObject(label); canvas.fire('selection:created', { selected: [label] }); await frame();
  assert('Font size shows pt (24 px = 5.76 pt at 300 dpi)', shownText('text-size') === String(Math.round(24 / rdpi * 72 * 100) / 100) && suffix('text-size').textContent === 'pt', shownText('text-size'));
  type('text-size', '8');
  assert('Typing 8 pt gives an 8 pt font (not rounded to whole px)', near(label.fontSize, rpt(8)), String(label.fontSize));
  canvas.setActiveObject(label); canvas.fire('selection:created', { selected: [label] }); await frame();
  assert('…and it shows 8 pt again', shownText('text-size') === '8', shownText('text-size'));
  $('obj-x').focus();
  assert('The fields keep the keyboard focus and their step suits the unit (0.1 mm, 0.5 pt for fonts)', document.activeElement === $('obj-x') && $('obj-x').step === '0.1' && $('text-size').step === '0.5');
  $('obj-x').blur();

  // ---- The px option and a dpi change ----
  canvas.setActiveObject(rect); canvas.fire('selection:created', { selected: [rect] }); await frame();
  P.setGlobalPreference('units.size', 'px');
  assert('Preferences → Size units → px: the fields show document px again, and say so', shownText('obj-x') === String(Math.round(box().left)) && suffix('obj-x').textContent === 'px' &&
    /\(document px\)$/.test($('obj-x').closest('label').title) && near(parseFloat(shownText('shape-stroke-width')), rpt(1)) && suffix('text-size').textContent === 'px');
  type('obj-x', '200');
  assert('Typing in px works as before', near(box().left, 200));
  P.setGlobalPreference('units.size', 'mm-pt');
  assert('Back to mm and pt', shownText('obj-x') === String(Math.round(200 / rdpi * 25.4 * 100) / 100) && suffix('obj-x').textContent === 'mm');
  MFC.applyDocProps({ ...MFC.getDocProps(), dpi: rdpi * 2 });
  assert('At twice the dpi, the same px show half the mm', shownText('obj-x') === String(Math.round(200 / (rdpi * 2) * 25.4 * 100) / 100), shownText('obj-x'));
  MFC.applyDocProps({ ...MFC.getDocProps(), dpi: rdpi });
  const pref = [...P.PREFERENCES].find(d => d.key === 'units.size');
  assert('The preference is in a Units section, mm and pt by default', pref && pref.section === 'units' && pref.default === 'mm-pt' && pref.options.map(o => o.value).join() === 'mm-pt,px');

  // ---- Fonts by what they replace ----
  const fontOptions = [...$('text-font').options];
  assert('The Text panel names the bundled fonts by what they replace', fontOptions.slice(0, 3).map(o => o.textContent).join('|') === 'Liberation Sans (Arial metrics)|Liberation Serif (Times New Roman metrics)|Liberation Mono (Courier New metrics)' &&
    fontOptions.slice(0, 3).map(o => o.value).join() === 'Liberation Sans,Liberation Serif,Liberation Mono');
  canvas.setActiveObject(label); canvas.fire('selection:created', { selected: [label] }); await frame();
  assert('…and still sets and shows the font itself', $('text-font').value === 'Liberation Sans');
  $('btn-preferences').click(); await frame();
  const fontSelect = document.querySelector('.pref-row[data-key="text.fontFamily"] select');
  assert('So does Preferences → Default font', fontSelect && [...fontSelect.options].some(o => o.value === 'Liberation Serif' && o.textContent === 'Liberation Serif (Times New Roman metrics)'));
  const unitSelect = document.querySelector('.pref-row[data-key="units.size"] select');
  assert('Preferences shows the Size units choice', unitSelect && unitSelect.value === 'mm-pt');
  document.querySelector('.preferences-backdrop')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.preferences-backdrop').forEach(b => b.remove());
  P.resetGlobalPreferences();
  return checks;
}

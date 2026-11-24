/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Preferences.
   - The registry: every entry is valid; values are checked; project value > global value > default;
     global values persist in this browser, project values in the project (undo, save and reopen);
     unknown keys from a newer version are kept; change events.
   - The dialog: opens from the top bar and with Ctrl+, above the canvas and the panels; rows built
     from the registry; "This project only" ticks; Reset; Esc; focus trap; titles; four themes.
   - New text boxes use the default font, size and colour. */

const nextPrefFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function runPreferencesRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const P = await import(new URL('js/core/preferences.js', document.baseURI).href);
  const savedStore = localStorage.getItem(P.STORAGE_KEY);
  const stored = () => JSON.parse(localStorage.getItem(P.STORAGE_KEY) || 'null');
  try {
    localStorage.removeItem(P.STORAGE_KEY); P.reloadGlobalPreferences();

    // ---- Registry ----
    assert('Every preference has a key, a section, a label, a type, a help text and a valid default',
      P.PREFERENCES.length >= 9 && P.PREFERENCES.every(d => d.key && P.SECTIONS.some(s => s.id === d.section) && d.label && d.help && P.validPreference(d, d.default) !== undefined) &&
      new Set(P.PREFERENCES.map(d => d.key)).size === P.PREFERENCES.length);
    assert('Snapping preferences: on/off, page, objects, edges (left, centre, right, top, middle, bottom), distance, guides',
      ['snap.enabled', 'snap.toPage', 'snap.toObjects', 'snap.edges', 'snap.distance', 'snap.guides'].every(k => P.preferenceDef(k)) &&
      P.preferenceDef('snap.edges').options.map(o => o.value).join() === 'left,hcenter,right,top,vcenter,bottom');
    assert('Text preferences: default font, size and colour', ['text.fontFamily', 'text.fontSize', 'text.color'].every(k => P.preferenceDef(k)) &&
      P.getPreference('text.fontFamily') === 'Liberation Sans' && P.getPreference('text.fontSize') === 24 && P.getPreference('text.color') === '#000000');
    const v = (key, value) => P.validPreference(P.preferenceDef(key), value);
    assert('Values are checked against their type and limits', v('snap.enabled', 'yes') === undefined && v('snap.distance', 1) === undefined && v('snap.distance', 41) === undefined &&
      v('snap.distance', 12) === 12 && v('text.color', 'red') === undefined && v('text.color', '#AABBCC') === '#aabbcc' && v('snap.edges', ['top', 'diagonal']) === undefined &&
      JSON.stringify(v('snap.edges', ['top', 'left'])) === '["left","top"]' && v('text.fontFamily', '') === undefined);
    assert('With nothing stored, every value is its default', P.PREFERENCES.every(d => JSON.stringify(P.getPreference(d.key)) === JSON.stringify(d.default)));
    let events = [];
    const off = P.onPreferenceChange(key => events.push(key));
    assert('A global value is stored in this browser and applies', P.setGlobalPreference('snap.distance', 12) && P.getPreference('snap.distance') === 12 &&
      stored().version === P.STORAGE_VERSION && stored().values['snap.distance'] === 12 && events.includes('snap.distance'));
    assert('An invalid value is refused and changes nothing', !P.setGlobalPreference('snap.distance', 'far') && P.getPreference('snap.distance') === 12);
    localStorage.setItem(P.STORAGE_KEY, JSON.stringify({ version: 9, values: { 'snap.distance': 'nonsense', 'future.thing': { a: 1 }, 'snap.guides': false } }));
    P.reloadGlobalPreferences();
    assert('Stored values from elsewhere are checked (an invalid one falls back to the default)', P.getPreference('snap.distance') === 8 && P.getPreference('snap.guides') === false);
    P.setGlobalPreference('snap.guides', true);
    assert('Keys of a newer version and its version number are kept when saving', stored().values['future.thing'].a === 1 && stored().version === 9);
    P.resetGlobalPreferences();
    assert('Reset forgets every global value this version knows and keeps the others', P.getPreference('snap.guides') === true && Object.keys(stored().values).join() === 'future.thing');
    localStorage.setItem(P.STORAGE_KEY, '{broken'); P.reloadGlobalPreferences();
    assert('Damaged storage means defaults, without an error', P.getPreference('snap.enabled') === true);
    localStorage.removeItem(P.STORAGE_KEY); P.reloadGlobalPreferences();
    const copyCheck = P.getPreference('snap.edges'); copyCheck.length = 0;
    assert('Values are returned as copies (changing one does not change the preference)', P.getPreference('snap.edges').length === 6);

    // ---- Project overrides ----
    const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
    await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
    await MFC_TIFF.whenIdle();
    P.setGlobalPreference('text.color', '#112233');
    events = [];
    assert('A project value overrides the global one in this project', P.setProjectPreference('text.color', '#ff0000') && P.getPreference('text.color') === '#ff0000' &&
      P.globalPreference('text.color') === '#112233' && P.isProjectOverride('text.color') && MFC.getDocProps().preferences['text.color'] === '#ff0000' && events.includes('text.color'));
    assert('Invalid project values are refused', !P.setProjectPreference('text.color', 'blue') && P.getPreference('text.color') === '#ff0000');
    await MFC.undo(); await MFC_TIFF.whenIdle();
    assert('Undo takes the project value back (the global one applies again)', P.getPreference('text.color') === '#112233' && !P.isProjectOverride('text.color'));
    await MFC.redo(); await MFC_TIFF.whenIdle();
    assert('Redo restores it', P.getPreference('text.color') === '#ff0000');
    P.setProjectPreference('snap.edges', ['top']);
    MFC.getDocProps().preferences['future.option'] = 42; // as written by a newer version
    const next = MFC_PROJECT.prepareSave(true, 'prefs'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
    await MFC_PROJECT.loadProject(new File([archive], 'prefs.fluoforge')); await MFC_TIFF.whenIdle();
    assert('Saving and reopening keeps the project values, and keys of a newer version', P.getPreference('text.color') === '#ff0000' &&
      JSON.stringify(P.getPreference('snap.edges')) === '["top"]' && MFC.getDocProps().preferences['future.option'] === 42);
    document.getElementById('doc-apply').click();
    assert('Applying document properties keeps them', P.getPreference('text.color') === '#ff0000');
    P.setProjectPreference('snap.edges', undefined);
    assert('Removing a project value brings back the global one', P.getPreference('snap.edges').length === 6 && !('snap.edges' in MFC.getDocProps().preferences));

    // ---- New text uses the defaults ----
    P.setProjectPreference('text.color', undefined); delete MFC.getDocProps().preferences;
    P.setGlobalPreference('text.fontFamily', 'Liberation Serif'); P.setGlobalPreference('text.fontSize', 40); P.setGlobalPreference('text.color', '#3366cc');
    const canvas = MFC.getCanvas(); MFC.setTool('text');
    canvas.renderAll(); canvas.calcOffset();
    const el = canvas.upperCanvasEl.getBoundingClientRect(), vpt = canvas.viewportTransform;
    const at = { clientX: el.left + 600 * vpt[0] + vpt[4], clientY: el.top + 700 * vpt[3] + vpt[5] };
    canvas.upperCanvasEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, buttons: 1, ...at }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, ...at }));
    const made = canvas.getObjects().filter(o => o.type === 'textbox').at(-1);
    assert('A new text box uses the default font, size and colour', made && made.fontFamily === 'Liberation Serif' && made.fontSize === 40 && made.fill === '#3366cc',
      made && JSON.stringify([made.fontFamily, made.fontSize, made.fill]));
    if (made.isEditing) made.exitEditing();
    MFC.setTool('select');
    P.setProjectPreference('text.fontSize', 18);
    MFC.setTool('text');
    canvas.upperCanvasEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, buttons: 1, clientX: at.clientX, clientY: at.clientY - 120 * vpt[3] }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: at.clientX, clientY: at.clientY - 120 * vpt[3] }));
    const made2 = canvas.getObjects().filter(o => o.type === 'textbox').at(-1);
    assert('With a project value, new text in that project uses it', made2 !== made && made2.fontSize === 18 && made2.fontFamily === 'Liberation Serif');
    if (made2.isEditing) made2.exitEditing();
    MFC.setTool('select');
    P.resetGlobalPreferences(); P.setProjectPreference('text.fontSize', undefined);

    // ---- Dialog ----
    const button = document.getElementById('btn-preferences');
    assert('The top bar has a Preferences button with a title mentioning Ctrl+,', button && button.closest('#topbar') && /Ctrl\+,/.test(button.title));
    button.click(); await nextPrefFrame();
    let dialog = document.querySelector('.preferences-modal');
    assert('It opens a modal dialog, focused on the first control', dialog && dialog.getAttribute('role') === 'dialog' && dialog.getAttribute('aria-modal') === 'true' &&
      dialog.contains(document.activeElement));
    const box = dialog.getBoundingClientRect(), panel = document.getElementById('side-panel').getBoundingClientRect();
    const topAt = (x, y) => document.elementFromPoint(x, y);
    assert('It sits above the canvas and the panels (the backdrop covers them)', dialog.contains(topAt(box.left + box.width / 2, box.top + 20)) &&
      topAt(panel.left + 10, panel.top + 10).classList.contains('preferences-backdrop') &&
      topAt(10, window.innerHeight - 10).classList.contains('preferences-backdrop'));
    const rows = [...dialog.querySelectorAll('.pref-row')];
    assert('One row per preference, in Snapping, Text and Units sections', rows.length === P.PREFERENCES.length &&
      [...dialog.querySelectorAll('.pref-section h3')].map(h => h.textContent).join() === 'Snapping,Text,Units');
    const rowOf = key => dialog.querySelector(`.pref-row[data-key="${key}"]`);
    const distance = rowOf('snap.distance').querySelector('input[type=number]');
    distance.value = '15'; distance.dispatchEvent(new Event('change', { bubbles: true }));
    dialog = document.querySelector('.preferences-modal');
    assert('Changing a value without the tick changes the global preference', P.globalPreference('snap.distance') === 15 && !P.isProjectOverride('snap.distance') && stored().values['snap.distance'] === 15);
    const tick = rowOf('text.color').querySelector('.pref-project-only');
    tick.click();
    assert('Ticking "This project only" gives the project its own value (the current one)', P.isProjectOverride('text.color') && P.getPreference('text.color') === '#000000');
    const color = rowOf('text.color').querySelector('input[type=color]');
    color.value = '#00aa44'; color.dispatchEvent(new Event('change', { bubbles: true }));
    assert('With the tick, the control edits the project value only, and the row shows the global value', P.getPreference('text.color') === '#00aa44' && P.globalPreference('text.color') === '#000000' &&
      !rowOf('text.color').querySelector('.pref-note').hidden && /Global value: #000000/.test(rowOf('text.color').querySelector('.pref-note').textContent));
    const edgeBoxes = [...rowOf('snap.edges').querySelectorAll('input[type=checkbox]:not(.pref-project-only)')];
    edgeBoxes.find(b => b.value === 'hcenter').click();
    assert('The edges are a set of check boxes; unticking one removes it', edgeBoxes.length === 6 && !P.getPreference('snap.edges').includes('hcenter') && P.getPreference('snap.edges').length === 5);
    rowOf('text.color').querySelector('.pref-project-only').click();
    assert('Unticking removes the project value: the global one applies again', !P.isProjectOverride('text.color') && P.getPreference('text.color') === '#000000');
    dialog.querySelector('#preferences-reset').click();
    assert('Reset global preferences restores the defaults', P.getPreference('snap.distance') === 8 && P.getPreference('snap.edges').length === 6);
    const controls = [...dialog.querySelectorAll('input, select, button')];
    assert('Every control has a title or a labelled row with a help text', controls.every(c => (c.title || c.closest('.pref-row')?.title || '').length > 5));
    const items = controls.filter(c => !c.disabled), last = items[items.length - 1];
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert('Tab from the last control wraps to the first', document.activeElement === items[0]);
    const deleteKey = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    const objectsBefore = canvas.getObjects().length; canvas.setActiveObject(canvas.getObjects().find(o => o.mfcId)); items[0].dispatchEvent(deleteKey);
    assert('App shortcuts do not reach the canvas while the dialog is open', canvas.getObjects().length === objectsBefore);
    canvas.discardActiveObject();
    const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const contrast = (x, y) => { const [h, l] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (h + 0.05) / (l + 0.05); };
    const savedTheme = document.documentElement.dataset.theme, ratios = [];
    for (const theme of ['light', 'sage', 'dark', 'slate']) {
      document.documentElement.dataset.theme = theme;
      const d = getComputedStyle(dialog), label = getComputedStyle(dialog.querySelector('.pref-label')), input = getComputedStyle(distance.isConnected ? distance : dialog.querySelector('input[type=number]'));
      ratios.push(contrast(label.color, d.backgroundColor), contrast(input.color, input.backgroundColor));
    }
    if (savedTheme) document.documentElement.dataset.theme = savedTheme; else delete document.documentElement.dataset.theme;
    assert('Labels and fields are readable in all four themes (contrast ≥ 4.5)', ratios.every(r => r >= 4.5), ratios.map(r => r.toFixed(1)).join());
    const focusRule = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } }).some(r => /\.preferences-modal input:focus-visible/.test(r.selectorText || '') && /outline/.test(r.cssText));
    assert('Controls have a visible focus outline', focusRule);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert('Escape closes the dialog and returns focus to the button', !document.querySelector('.preferences-backdrop') && document.activeElement === button);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true, cancelable: true })); await nextPrefFrame();
    assert('Ctrl+, opens it too', !!document.querySelector('.preferences-modal'));
    document.getElementById('preferences-close').click();
    MFC.closeDocument();
    button.click(); await nextPrefFrame();
    assert('Without an open figure, the "This project only" ticks are disabled and say why',
      [...document.querySelectorAll('.pref-project-only')].every(t => t.disabled && /Open a figure/.test(t.title)));
    document.getElementById('preferences-close').click();
    off();
  } finally {
    if (savedStore === null) localStorage.removeItem(P.STORAGE_KEY); else localStorage.setItem(P.STORAGE_KEY, savedStore);
    P.reloadGlobalPreferences();
  }
  return checks;
}

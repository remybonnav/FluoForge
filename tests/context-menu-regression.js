/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* PI-T9: the right-click menu, built on one list of actions (js/core/actions.js, js/ui/context-actions.js),
   that the user can customise (Preferences ▸ Context menu, kept in this browser, with a reset).
   On the reference figure, plus an SVG plot:
   - the default menu of each kind of selection (image, cropped image, path, plot, text, several objects,
     a group, the empty page), opened by a real right-click;
   - every default entry run from the keyboard only (Shift+F10, arrow keys, Enter), doing what its button
     does, in one History step where it changes the figure;
   - every entry, default or optional, is in the keyboard-opened menu where it applies;
   - a customised menu (an item removed, one added in the Preferences dialog) is stored, survives reading
     the stored preferences again and a real reload of the app, and can be reset to the default; a project never
     carries its own menu. */
async function runContextMenuRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = () => MFC.getCanvas();
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const settle = async () => { await MFC_TIFF.whenIdle(); for (let i = 0; i < 4; i++) await frame(); };
  const $ = id => document.getElementById(id);
  const A = await import(new URL('js/core/actions.js', document.baseURI).href);
  const P = await import(new URL('js/core/preferences.js', document.baseURI).href);
  const D = await import(new URL('js/image/display-settings.js', document.baseURI).href);
  const PT = await import(new URL('js/tools/path.js', document.baseURI).href);
  const LY = await import(new URL('js/ui/layers.js', document.baseURI).href);
  const byId = id => canvas().getObjects().find(o => o.mfcId === id);
  const steps = () => MFC.getHistory().labels.length;
  const el = () => canvas().upperCanvasEl;
  const client = (x, y) => { const r = el().getBoundingClientRect(), v = canvas().viewportTransform, k = r.width / canvas().getWidth(); return { clientX: r.left + (x * v[0] + v[4]) * k, clientY: r.top + (y * v[3] + v[5]) * k }; };
  const menuEl = () => document.querySelector('.context-menu');
  const labels = () => [...(menuEl() ? menuEl().querySelectorAll('.context-item') : [])].map(b => b.textContent).join(',');
  const shownIds = () => [...(menuEl() ? menuEl().querySelectorAll('.context-item') : [])].map(b => b.dataset.action);
  const closeMenu = () => { if (menuEl()) menuEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); };
  /** A real right-click on the object's centre (or a page point). */
  const rightClick = async target => {
    canvas().discardActiveObject(); canvas().requestRenderAll(); await frame();
    const c = target.getCenterPoint ? target.getCenterPoint() : target;
    el().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, buttons: 2, ...client(c.x, c.y) }));
    await frame();
    return labels();
  };
  const select = async (...objs) => {
    canvas().discardActiveObject();
    if (objs.length === 1) canvas().setActiveObject(objs[0]);
    else if (objs.length) canvas().setActiveObject(new fabric.ActiveSelection(objs, { canvas: canvas() }));
    canvas().requestRenderAll(); MFC.refreshSelectionBar(); await frame();
  };
  /** Keyboard only: Shift+F10 opens the menu on the selection; arrow keys reach the item; Enter (a click on the focused button) runs it. */
  const openByKeyboard = async () => {
    closeMenu(); document.body.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    await frame();
    return menuEl();
  };
  const runByKeyboard = async id => {
    if (!(await openByKeyboard())) return 'no menu';
    for (let i = 0; i < 40 && document.activeElement.dataset.action !== id; i++)
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    if (document.activeElement.dataset.action !== id) { const got = labels(); closeMenu(); return 'not reached: ' + got; }
    document.activeElement.click(); // Enter or Space on a focused button is a click
    await settle();
    return 'ran';
  };
  const savedStore = localStorage.getItem(P.STORAGE_KEY);
  const toasts = []; const toastEl = $('toast'), watch = new MutationObserver(() => toasts.push(toastEl.textContent)); watch.observe(toastEl, { childList: true, characterData: true, subtree: true });
  const IMAGE = 'Image info…,Copy display settings,Paste display settings,Replace image…,Lock position,Bring forward,Send backward,Bring to front,Send to back,Copy for other software…,Customise this menu…';
  const ORDER = 'Bring forward,Send backward,Bring to front,Send to back';

  try {
    localStorage.removeItem(P.STORAGE_KEY); P.reloadGlobalPreferences();
    const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
    await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
    document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
    await settle();
    MFC.setTool('select');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="1in" viewBox="0 0 200 100"><rect x="10" y="10" width="120" height="70" fill="#36c"/></svg>';
    await MFC.importFiles([new File([svg], 'menu-plot.svg', { type: 'image/svg+xml' })]); await settle();
    const plot = canvas().getObjects().find(o => o.mfcType === 'mfcVector' && o.mfcFileName === 'menu-plot.svg');
    plot.set({ left: 820, top: 40 }); plot.setCoords();
    const img1 = byId('img1'), img2 = byId('img2'), cropped = byId('mfcImage6'), text = byId('refTextbox');
    const rect = byId('refRect'), ellipse = byId('refEllipse'), path = byId('refPath'), group = byId('grp5');
    assert('Setting up: the reference figure and an SVG plot', img1 && img2 && cropped && text && rect && ellipse && path && group && plot);

    // ================= one list of actions =================
    const options = A.menuOptions(), defaults = A.defaultMenuIds();
    assert('The menu is built on one list of actions, each with an id, a group and a name for Preferences',
      options.length >= 20 && options.every(a => a.id && a.group && a.option) && new Set(options.map(a => a.id)).size === options.length, options.length);
    assert('The default menu has the task\'s first entries', ['info', 'modify-points', 'adjust-crop', 'copy-display', 'paste-display', 'replace', 'lock-position',
      'bring-forward', 'send-backward', 'bring-to-front', 'send-to-back', 'group', 'crop-to-shape', 'copy-external'].every(id => defaults.includes(id)), defaults.join());
    assert('The preference\'s default is that list; its options are every action', JSON.stringify(P.getPreference('menu.items')) === JSON.stringify(defaults) &&
      P.preferenceDef('menu.items').options.length === options.length && P.preferenceDef('menu.items').globalOnly === true);

    // ================= the default menu of each kind of selection =================
    let got = await rightClick(img1);
    assert('An image: Image info, display settings, Replace image, Lock position, order, Copy for other software, Customise', got === IMAGE && canvas().getActiveObject() === img1 && menuEl().getAttribute('aria-label') === 'Image', got);
    assert('Items of different groups are separated', menuEl().querySelectorAll('.context-separator').length === 5, menuEl().querySelectorAll('.context-separator').length);
    assert('Every item is a menu item with a title', [...menuEl().querySelectorAll('.context-item')].every(b => b.getAttribute('role') === 'menuitem' && b.title.length > 10));
    assert('img1 is at the back: Send backward and Send to back are disabled, Bring forward is not', (() => { const b = Object.fromEntries([...menuEl().querySelectorAll('.context-item')].map(x => [x.textContent, x.disabled])); return b['Send backward'] && b['Send to back'] && !b['Bring forward']; })());
    closeMenu();
    got = await rightClick(cropped);
    assert('A cropped image also has Adjust crop', got === IMAGE.replace('Image info…,', 'Image info…,Adjust crop,'), got);
    closeMenu();
    got = await rightClick(path);
    assert('A path: Modify points, Lock position, order, Copy', got === 'Modify points,Lock position,' + ORDER + ',Copy for other software…,Customise this menu…' && menuEl().getAttribute('aria-label') === 'Path', got);
    closeMenu();
    got = await rightClick(plot);
    assert('A plot: Plot info, Lock position, order, Copy', got === 'Plot info…,Lock position,' + ORDER + ',Copy for other software…,Customise this menu…' && menuEl().getAttribute('aria-label') === 'Plot', got);
    closeMenu();
    got = await rightClick(text);
    assert('A text box: Lock position, order, Copy', got === 'Lock position,' + ORDER + ',Copy for other software…,Customise this menu…' && menuEl().getAttribute('aria-label') === 'Figure', got);
    MFC.refreshSelectionBar();
    assert('The menu of an object without images stays open while the selection bar refreshes', !!menuEl());
    canvas().discardActiveObject(); MFC.refreshSelectionBar();
    assert('…and closes once that object is no longer selected', !menuEl());
    await select(rect, ellipse); await openByKeyboard();
    assert('A box and an ellipse: Lock position, order, Group, Crop to shape', labels() === 'Lock position,' + ORDER + ',Group,Crop to shape,Copy for other software…,Customise this menu…', labels());
    closeMenu();
    await select(group); await openByKeyboard();
    assert('A group: Ungroup', labels() === 'Lock position,' + ORDER + ',Ungroup,Copy for other software…,Customise this menu…', labels());
    closeMenu();
    const page = MFC.pageBounds(0);
    got = await rightClick({ x: page.left + page.width - 15, y: page.top + page.height - 15 });
    assert('The empty page: Copy for other software, Customise', got === 'Copy for other software…,Customise this menu…' && !canvas().getActiveObject(), got);
    closeMenu();

    // ================= every default entry from the keyboard =================
    await select(img1);
    assert('Image info… opens Image info', await runByKeyboard('info') === 'ran' && !!document.querySelector('.image-info-modal'));
    document.querySelector('.image-info-backdrop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frame();
    await select(plot);
    assert('Plot info… opens Plot info', await runByKeyboard('info') === 'ran' && /Plot/.test(document.querySelector('.image-info-modal h2')?.textContent || ''));
    document.querySelector('.image-info-backdrop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frame();
    await select(path);
    assert('Modify points shows the points of the path', await runByKeyboard('modify-points') === 'ran' && path.__mfcNodeEdit === true);
    PT.exitPathEdit(path); await settle();
    await select(cropped);
    assert('Adjust crop starts the Crop tool on the panel', await runByKeyboard('adjust-crop') === 'ran' && MFC.currentTool === 'crop');
    MFC.setTool('select'); await settle();
    await select(img1);
    assert('Copy display settings copies them', await runByKeyboard('copy-display') === 'ran' && D.copiedDisplaySettings() && D.copiedDisplaySettings().fileName === img1.mfcFileName);
    await select(img2); let n = steps();
    assert('Paste display settings pastes them, in one History step', await runByKeyboard('paste-display') === 'ran' && steps() === n + 1);
    let picked = 0; const input = $('replace-input'); input.click = () => { picked++; };
    await select(img2);
    assert('Replace image… opens the file picker for the image', await runByKeyboard('replace') === 'ran' && picked === 1);
    delete input.click;
    await select(text); n = steps();
    assert('Lock position locks it, in one History step', await runByKeyboard('lock-position') === 'ran' && text.mfcPositionLocked === true && steps() === n + 1);
    await openByKeyboard();
    assert('The menu then offers Unlock position', labels().startsWith('Unlock position,'), labels());
    closeMenu();
    assert('Unlock position unlocks it', await runByKeyboard('lock-position') === 'ran' && !text.mfcPositionLocked);
    const layer = o => LY.layerObjects().indexOf(o), top = () => LY.layerObjects().length - 1;
    await select(rect); let at = layer(rect); n = steps();
    assert('Bring forward moves it one step up, in one History step', await runByKeyboard('bring-forward') === 'ran' && layer(rect) === at + 1 && steps() === n + 1, [at, layer(rect)].join());
    await select(rect); n = steps();
    assert('Send backward moves it back', await runByKeyboard('send-backward') === 'ran' && layer(rect) === at && steps() === n + 1);
    await select(rect);
    assert('Bring to front puts it above everything', await runByKeyboard('bring-to-front') === 'ran' && layer(rect) === top());
    await select(rect); await openByKeyboard();
    const disabled = Object.fromEntries([...menuEl().querySelectorAll('.context-item')].map(x => [x.dataset.action, x.disabled]));
    assert('At the front, Bring forward and Bring to front are disabled (and skipped by the arrow keys)', disabled['bring-forward'] && disabled['bring-to-front'] && !disabled['send-to-back']);
    closeMenu();
    assert('Send to back puts it behind every object, the pages staying behind it', await runByKeyboard('send-to-back') === 'ran' && layer(rect) === 0 &&
      canvas().getObjects().indexOf(rect) > canvas().getObjects().findIndex(o => o.mfcIsPageBounds));
    await select(rect, ellipse); n = steps();
    assert('Group groups them, in one History step', await runByKeyboard('group') === 'ran' && canvas().getActiveObject().type === 'group' && steps() === n + 1);
    const made = canvas().getActiveObject();
    await select(made);
    assert('Ungroup gives the objects back', await runByKeyboard('group') === 'ran' && canvas().getObjects().includes(rect) && !canvas().getObjects().includes(made));
    await select(img2, ellipse); n = steps();
    assert('Crop to shape crops the image to the ellipse, in one History step', await runByKeyboard('crop-to-shape') === 'ran' && !!img2.clipPath && !canvas().getObjects().includes(ellipse) && steps() === n + 1);
    await select(text);
    assert('Copy for other software… opens the copy dialog for the selection', await runByKeyboard('copy-external') === 'ran' && document.querySelector('.copy-modal #copy-scope-selection')?.checked);
    $('copy-close').click(); await frame();
    await select(text);
    assert('Customise this menu… opens Preferences at the menu\'s items', await runByKeyboard('customise') === 'ran' &&
      document.activeElement.closest('.pref-row')?.dataset.key === 'menu.items');
    $('preferences-close').click(); await frame();

    // ================= every entry, default or optional, is reachable from the keyboard =================
    P.setGlobalPreference('menu.items', options.map(a => a.id));
    const reached = new Set();
    const collect = async (...objs) => { await select(...objs); await openByKeyboard(); shownIds().forEach(id => reached.add(id)); closeMenu(); };
    await collect(img1); await collect(cropped); await collect(path); await collect(plot); await collect(img1, byId('img3'));
    await collect(rect, byId('refLine')); await collect(group);
    await select(img1, byId('img3')); await runByKeyboard('link');
    await collect(img1);
    const missing = options.map(a => a.id).filter(id => !reached.has(id));
    assert('With every item chosen, each action is in the keyboard-opened menu where it applies (Link made a group, so Unlink shows)', !missing.length, missing.join());
    P.resetGlobalPreference('menu.items');

    // ================= customising =================
    $('btn-preferences').click(); await frame();
    let row = document.querySelector('.pref-row[data-key="menu.items"]');
    const box = value => document.querySelector(`.pref-row[data-key="menu.items"] input[value="${value}"]`);
    assert('Preferences has a Context menu section: one tick per action, the default ones ticked',
      row && row.closest('.pref-section').querySelector('h3').textContent === 'Context menu' && row.querySelectorAll('input[type=checkbox]').length === options.length &&
      [...row.querySelectorAll('input:checked')].map(b => b.value).join() === defaults.join());
    assert('It has a Reset to default button and no "This project only" tick (it is kept in this browser)', !!row.querySelector('.pref-reset') && !row.querySelector('.pref-project-only') && /default/.test(row.querySelector('.pref-reset').title));
    box('replace').click(); box('duplicate').click();
    const stored = () => JSON.parse(localStorage.getItem(P.STORAGE_KEY) || '{}');
    assert('Removing Replace image and adding Duplicate is stored in this browser', Array.isArray(stored().values['menu.items']) &&
      !stored().values['menu.items'].includes('replace') && stored().values['menu.items'].includes('duplicate'), JSON.stringify(stored().values));
    $('preferences-close').click(); await frame();
    P.reloadGlobalPreferences(); // what a reload does: the stored preferences are read again
    got = await rightClick(img1);
    assert('After reading the stored preferences again, the menu is the customised one', got === IMAGE.replace('Replace image…,', '').replace('Lock position,', 'Lock position,Duplicate,'), got);
    closeMenu();
    // A real reload: the app opened again, in a frame of this page (same origin, same stored preferences).
    const child = document.createElement('iframe');
    child.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:800px;opacity:0;pointer-events:none';
    child.src = location.pathname + '?test=regression-reload-' + Date.now();
    await new Promise(resolve => { child.onload = resolve; document.body.append(child); });
    const win = child.contentWindow;
    for (let i = 0; i < 400 && !((win.document.getElementById('app-version') || {}).textContent && win.MFC); i++) await new Promise(r => setTimeout(r, 25));
    // This file, loaded in the reloaded app, gives it contextMenuAfterReload (classic globals such as MFC_PROJECT are not window properties).
    const probe = win.document.createElement('script'); probe.src = 'tests/context-menu-regression.js?reload=' + Date.now();
    await new Promise((resolve, reject) => { probe.onload = resolve; probe.onerror = reject; win.document.head.append(probe); });
    const reloaded = await win.contextMenuAfterReload(bytes);
    child.remove(); window.focus(); await frame(); // Firefox leaves the focus nowhere when a focused frame goes
    assert('A reloaded app shows the customised menu', reloaded === IMAGE.replace('Replace image…,', '').replace('Lock position,', 'Lock position,Duplicate,'), reloaded);
    await select(text); const count = canvas().getObjects().length;
    const ranDuplicate = await runByKeyboard('duplicate');
    for (let i = 0; i < 40 && canvas().getObjects().length === count; i++) await frame(); // pasting is asynchronous
    assert('The added Duplicate runs from the keyboard too', ranDuplicate === 'ran' && canvas().getObjects().length === count + 1, [ranDuplicate, canvas().getObjects().length - count].join());
    assert('A project cannot carry its own menu', P.setProjectPreference('menu.items', ['info']) === false && !P.isProjectOverride('menu.items'));
    const props = MFC.getDocProps(), before = props.preferences;
    props.preferences = { ...(before || {}), 'menu.items': ['info'] };
    assert('…and a menu written into a project file is ignored', P.getPreference('menu.items').includes('duplicate'));
    if (before) props.preferences = before; else delete props.preferences;
    $('btn-preferences').click(); await frame();
    row = document.querySelector('.pref-row[data-key="menu.items"]');
    row.querySelector('.pref-reset').click(); await frame();
    assert('Reset to default gives the default menu back and forgets the stored one', JSON.stringify(P.getPreference('menu.items')) === JSON.stringify(defaults) &&
      !('menu.items' in stored().values) && [...document.querySelectorAll('.pref-row[data-key="menu.items"] input:checked')].length === defaults.length);
    box('replace').click();
    $('preferences-reset').click(); await frame();
    assert('Reset global preferences resets it too', JSON.stringify(P.getPreference('menu.items')) === JSON.stringify(defaults));
    $('preferences-close').click(); await frame();
    got = await rightClick(img1);
    assert('The default menu is back', got === IMAGE, got);
    closeMenu();
  } finally {
    watch.disconnect();
    document.querySelectorAll('.context-menu, .image-info-backdrop, .preferences-backdrop').forEach(m => m.remove());
    if (savedStore === null) localStorage.removeItem(P.STORAGE_KEY); else localStorage.setItem(P.STORAGE_KEY, savedStore);
    P.reloadGlobalPreferences();
  }
  return { checks };
}

/** Runs in the reloaded app (a frame of the suite): opens the reference figure and returns the menu of img1, opened with Shift+F10. */
async function contextMenuAfterReload(bytes) {
  await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await MFC_TIFF.whenIdle();
  const canvas = MFC.getCanvas();
  canvas.setActiveObject(canvas.getObjects().find(o => o.mfcId === 'img1'));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
  return [...document.querySelectorAll('.context-menu .context-item')].map(b => b.textContent).join(',');
}

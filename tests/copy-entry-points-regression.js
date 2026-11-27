/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Ways to reach "Copy for other software" besides Ctrl+Shift+C and the Export menu:
   - the Copy out button in the top bar (title with the shortcut, disabled without a figure);
   - the right-click menu: on an image (after its display-settings items), on any other object, and
     on the empty page (copying that page); the Menu key and Shift+F10.
   Each opens the copy dialog starting with the right thing. */

const nextEntryFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function runCopyEntryPointsRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const button = document.getElementById('btn-copy-external');
  const waitDialog = async () => { for (let i = 0; i < 50 && !document.querySelector('.copy-modal'); i++) await new Promise(r => setTimeout(r, 10)); await nextEntryFrame(); return document.querySelector('.copy-modal'); };
  const closeDialog = () => document.querySelector('#copy-close')?.click();

  // ---- The button ----
  if (MFC.hasDocument) MFC.closeDocument();
  assert('The top bar has a Copy out button, disabled until a figure is open', button && button.closest('#topbar') && button.textContent.trim() === 'Copy out' && button.disabled);
  assert('Its title says what it does and gives the shortcut', /PowerPoint/.test(button.title) && /SVG/.test(button.title) && /PNG/.test(button.title) && /Ctrl\+Shift\+C/.test(button.title));
  const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
  await MFC_TIFF.whenIdle(); await document.fonts.ready;
  const canvas = MFC.getCanvas();
  canvas.discardActiveObject(); canvas.requestRenderAll();
  assert('With a figure open, the button is enabled', !button.disabled);
  button.click();
  let dialog = await waitDialog();
  assert('The button opens the copy dialog (page chosen when nothing is selected)', dialog && dialog.querySelector('#copy-scope-page').checked);
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert('Closing the dialog returns focus to the button', !document.querySelector('.copy-modal') && document.activeElement === button);
  const image = canvas.getObjects().find(o => o.mfcType === 'mfcImage');
  canvas.setActiveObject(image); canvas.requestRenderAll();
  button.click(); dialog = await waitDialog();
  assert('With a selection, the button starts with the selection', dialog.querySelector('#copy-scope-selection').checked);
  closeDialog();
  canvas.discardActiveObject();

  // ---- Right-click ----
  const rightClick = (x, y) => {
    canvas.calcOffset(); const r = canvas.upperCanvasEl.getBoundingClientRect(), v = canvas.viewportTransform;
    const ev = new MouseEvent('contextmenu', { clientX: r.left + x * v[0] + v[4], clientY: r.top + y * v[3] + v[5], bubbles: true, cancelable: true, button: 2 });
    canvas.upperCanvasEl.dispatchEvent(ev); return ev;
  };
  const items = () => [...document.querySelectorAll('.context-menu .context-item')].map(b => b.textContent);
  const centre = o => { const b = o.getBoundingRect(true, true); return [b.left + b.width / 2, b.top + b.height / 2]; };
  let ev = rightClick(...centre(image));
  assert('Right-clicking an image: Image info… (PI-T8), display settings items, a separator, then Copy for other software…', ev.defaultPrevented &&
    items().join() === 'Image info…,Copy display settings,Paste display settings,Copy for other software…' && document.querySelector('.context-menu .context-separator') && canvas.getActiveObject() === image);
  const copyItem = () => [...document.querySelectorAll('.context-menu .context-item')].find(b => b.textContent === 'Copy for other software…');
  assert('The item has a title that names the selection and the shortcut', /the selection/.test(copyItem().title) && /Ctrl\+Shift\+C/.test(copyItem().title));
  copyItem().click(); dialog = await waitDialog();
  assert('It opens the dialog with the selection chosen, and closes the menu', dialog && dialog.querySelector('#copy-scope-selection').checked && !document.querySelector('.context-menu'));
  closeDialog();

  const shape = canvas.getObjects().find(o => o.mfcType === 'shape' && o.type === 'ellipse');
  canvas.discardActiveObject();
  ev = rightClick(...centre(shape));
  assert('Right-clicking a shape selects it and opens a menu with only Copy for other software…', ev.defaultPrevented && items().join() === 'Copy for other software…' &&
    canvas.getActiveObject() === shape && document.querySelector('.context-menu').getAttribute('aria-label') === 'Figure', items().join());
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert('Escape closes it', !document.querySelector('.context-menu'));

  const page2 = MFC.pageBounds(1), emptyX = page2.left + page2.width - 20, emptyY = page2.top + page2.height - 20;
  ev = rightClick(emptyX, emptyY);
  assert('Right-clicking the empty page 2 opens the menu for page 2 and clears the selection', ev.defaultPrevented && items().join() === 'Copy for other software…' &&
    /page 2/.test(copyItem().title) && !canvas.getActiveObject(), copyItem() && copyItem().title);
  copyItem().click(); dialog = await waitDialog();
  assert('…and the dialog starts with page 2', dialog.querySelector('#copy-scope-page').checked && /Page 2/.test(dialog.querySelector('#copy-scope-page').parentElement.textContent));
  closeDialog();

  const corner = new MouseEvent('contextmenu', { clientX: canvas.upperCanvasEl.getBoundingClientRect().left + 2, clientY: canvas.upperCanvasEl.getBoundingClientRect().top + 2, bubbles: true, cancelable: true, button: 2 });
  canvas.upperCanvasEl.dispatchEvent(corner);
  assert('The pasteboard (outside the pages) keeps the browser\'s own menu', !corner.defaultPrevented && !document.querySelector('.context-menu'));

  // ---- Keyboard: Shift+F10 / Menu key ----
  canvas.setActiveObject(shape); canvas.requestRenderAll();
  document.body.focus();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
  assert('Shift+F10 with a shape selected opens the menu, focused on Copy for other software…', items().join() === 'Copy for other software…' && document.activeElement === copyItem());
  document.activeElement.click(); dialog = await waitDialog();
  assert('Enter on it opens the dialog for the selection', dialog && dialog.querySelector('#copy-scope-selection').checked);
  closeDialog();
  canvas.discardActiveObject(); canvas.requestRenderAll(); document.body.focus();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
  assert('The Menu key with nothing selected opens the menu for the page', items().join() === 'Copy for other software…' && /page/.test(copyItem().title));
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  // ---- Looks ----
  const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (x, y) => { const [h, l] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (h + 0.05) / (l + 0.05); };
  const savedTheme = document.documentElement.dataset.theme, ratios = [];
  rightClick(...centre(image));
  for (const theme of ['light', 'sage', 'dark', 'slate']) {
    document.documentElement.dataset.theme = theme;
    const b = getComputedStyle(button), item = getComputedStyle(copyItem()), menuStyle = getComputedStyle(document.querySelector('.context-menu'));
    ratios.push(contrast(b.color, b.backgroundColor), contrast(item.color, menuStyle.backgroundColor));
  }
  if (savedTheme) document.documentElement.dataset.theme = savedTheme; else delete document.documentElement.dataset.theme;
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert('The button and the menu item are readable in all four themes (contrast ≥ 4.5)', ratios.every(r => r >= 4.5), ratios.map(r => r.toFixed(1)).join());
  const focusRule = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } }).some(r => /\.copy-out-btn:focus-visible/.test(r.selectorText || '') && /outline/.test(r.cssText));
  assert('The button has a visible focus outline', focusRule);
  const bar = document.getElementById('topbar').getBoundingClientRect(), b = button.getBoundingClientRect();
  assert('The button sits inside the top bar', b.top >= bar.top && b.bottom <= bar.bottom && b.width > 40);
  return checks;
}

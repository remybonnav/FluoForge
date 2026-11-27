/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* PI-T3: Document Properties takes less room. It folds to one line (its title and the page size) as soon
   as another Inspector section is opened, or becomes the active one: by its toggle, by keyboard focus,
   by selecting an image, by choosing a tool. It opens again with its own toggle or the Document button;
   its state is stored like the other sections'; the toggle is a button with aria-expanded and
   aria-controls, and the summary follows the page size. */
async function runDocpropsCollapseRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas();
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const KEY = 'fluoforge-collapsed-panels';
  const savedState = localStorage.getItem(KEY);
  const docPanel = $('panel-docprops'), docToggle = docPanel.querySelector('.panel-toggle'), docBody = $('panel-docprops-body');
  const isOpen = () => !docBody.hidden && docToggle.getAttribute('aria-expanded') === 'true';
  const open = async () => { if (!isOpen()) docToggle.click(); await frame(); };
  const toggleOf = id => document.querySelector(`#${id} .panel-toggle`);
  const stored = () => new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
  try {
    await MFC_PROJECT.createProject({ name: 'Fold', width: 1200, height: 800, unit: 'px', dpi: 300 });
    await frame();

    // ---- one line, with the page size ----
    MFC_UI.focusPanel('panel-docprops', true); await frame();
    assert('A new figure opens Document Properties', isOpen());
    const layers = toggleOf('panel-layers');
    if (layers.getAttribute('aria-expanded') === 'true') layers.click(); // start from Layers folded
    await open();
    layers.click(); await frame();
    assert('Opening another section (Layers) folds Document Properties', !isOpen() && layers.getAttribute('aria-expanded') === 'true');
    const summary = $('docprops-summary');
    assert('Folded, its heading shows the page size', summary && summary.textContent === '1200×800 px · 300 dpi' && getComputedStyle(summary).display !== 'none' && /1200 × 800 px at 300 dpi/.test(summary.title), summary && summary.textContent);
    const other = toggleOf('panel-history');
    if (other.getAttribute('aria-expanded') === 'true') other.click();
    await frame();
    assert('…on one line, as high as another folded section\'s heading', Math.abs(docToggle.getBoundingClientRect().height - other.getBoundingClientRect().height) <= 1,
      `${docToggle.getBoundingClientRect().height} / ${other.getBoundingClientRect().height}`);
    assert('…and the Inspector title is the section\'s name, without the page size', (MFC_UI.focusPanel('panel-docprops'), $('inspector-context').textContent === 'Document Properties'), $('inspector-context').textContent);
    await open();
    assert('Open, the page size is not repeated in the heading', getComputedStyle(summary).display === 'none');

    // ---- other ways another section becomes the active one ----
    await open();
    layers.click(); layers.click(); await frame(); // folding Layers itself does not count; opening it again does
    assert('Folding a section does not fold it; opening one does', !isOpen());
    await open();
    // (Firefox fires no focus events for a scripted focus() while its window is in the background: the
    // focusin a user's Tab would cause is sent explicitly too.)
    const target = $('panel-layers-body').querySelector('button');
    target.focus(); target.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); await frame();
    assert('Moving the keyboard focus into another section folds it', !isOpen() && $('inspector-context').textContent === 'Layers', $('inspector-context').textContent);
    await MFC.importFiles([await new Promise(r => { const c = document.createElement('canvas'); c.width = 40; c.height = 30; c.getContext('2d').fillRect(0, 0, 40, 30); c.toBlob(b => r(new File([b], 'cell.png', { type: 'image/png' })), 'image/png'); })]);
    await MFC_TIFF.whenIdle(); canvas.discardActiveObject(); MFC_UI.focusSelection(null, 'select'); await frame();
    await open();
    const img = canvas.getObjects().find(o => o.mfcFileName === 'cell.png');
    canvas.setActiveObject(img); canvas.fire('selection:created', { selected: [img] }); await frame();
    assert('Selecting an image (the Channels section becomes active) folds it', !isOpen() && /^Channels/.test($('inspector-context').textContent), $('inspector-context').textContent);
    canvas.discardActiveObject(); canvas.fire('selection:cleared', {}); await open();
    $('tool-text').click(); await frame();
    assert('Choosing a tool (its section becomes active) folds it', !isOpen() && /Text/.test($('inspector-context').textContent), $('inspector-context').textContent);
    MFC.setTool('select');

    // ---- opening it again, keyboard and screen readers, stored state ----
    $('btn-docprops').click(); await frame();
    assert('The Document button opens it again', isOpen());
    assert('Its heading is a button in the Tab order, with aria-expanded and aria-controls on its body', docToggle.tagName === 'BUTTON' && docToggle.tabIndex === 0 &&
      docToggle.getAttribute('aria-controls') === 'panel-docprops-body' && docToggle.getAttribute('aria-expanded') === 'true' && docToggle.title);
    docToggle.focus(); docToggle.click(); await frame();
    assert('Activating it from the keyboard folds and opens it (aria-expanded follows)', docToggle.getAttribute('aria-expanded') === 'false' && docBody.hidden && document.activeElement === docToggle);
    assert('…and the page size is in its accessible name while folded', /Document Properties/.test(docToggle.textContent) && /1200×800 px · 300 dpi/.test(docToggle.textContent));
    assert('Its folded state is stored like the other sections\'', stored().has('panel-docprops'));
    docToggle.click(); await frame();
    assert('…and so is its open state', isOpen() && !stored().has('panel-docprops'));

    // ---- the summary follows the page size ----
    $('doc-width').value = '17.4'; $('doc-height').value = '10'; $('doc-unit').value = 'cm'; $('doc-dpi').value = '600';
    $('doc-apply').click(); await frame();
    assert('After Apply, the summary gives the new page size', summary.textContent === '17.4×10 cm · 600 dpi', summary.textContent);
  } finally {
    if (savedState === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, savedState);
    MFC.setTool('select');
  }
  return checks;
}

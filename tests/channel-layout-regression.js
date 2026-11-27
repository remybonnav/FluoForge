/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* PI-T2: the Channels panel's controls stay inside their frame. For an 8-bit, a 16-bit, a signed
   16-bit and a 32-bit float image, at the narrowest (280 px) and widest (320 px) Inspector, in all
   four themes, and with the longest values the number fields show (65535, -32768, a 7-digit float):
   every control's box lies inside its channel row and every row inside the panel; each number field
   shows its whole value; each button's label stays on one line; the histogram stays behind the
   sliders. */
async function runChannelLayoutRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas();
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const panel = $('side-panel'), themeSelect = $('theme-select');
  const themes = [...themeSelect.options].map(o => o.value), savedTheme = themeSelect.value;
  const png = () => new Promise(r => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 64, 48); c.toBlob(b => r(new File([b], 'rgb8.png', { type: 'image/png' })), 'image/png'); });
  const fixture = async name => new File([await (await fetch('tests/fixtures/formats/' + name)).blob()], name);
  /** The lines a label's text takes (a wrapped label has two): the boxes of its text alone, not of a checkbox or swatch beside it. */
  function textLines(el) {
    const rects = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      rects.push(...[...range.getClientRects()].filter(r => r.width > 0));
    }
    rects.sort((a, b) => a.top - b.top);
    let lines = 0, last = -Infinity;
    for (const r of rects) if (r.top - last > r.height / 2) { lines++; last = r.top; }
    return lines;
  }
  const inside = (r, f, tol = 0.5) => r.left >= f.left - tol && r.right <= f.right + tol && r.top >= f.top - tol && r.bottom <= f.bottom + tol;
  const name = el => el.tagName.toLowerCase() + '.' + String(el.className.baseVal ?? el.className).trim().split(/\s+/).join('.');

  /** Problems in the Channels panel as laid out now. */
  function problems() {
    const out = [];
    const pr = panel.getBoundingClientRect(), frameBox = { left: pr.left + panel.clientLeft, right: pr.left + panel.clientLeft + panel.clientWidth, top: -1e9, bottom: 1e9 };
    const rows = [...document.querySelectorAll('#channel-list .channel-row')];
    if (!rows.length) out.push('no channel rows');
    for (const row of rows) {
      const rr = row.getBoundingClientRect();
      if (!inside(rr, frameBox)) out.push(`row beyond the panel by ${Math.round(rr.right - frameBox.right)} px`);
      for (const el of row.querySelectorAll('input, button, label, select, .ch-name, .ch-hist, .hint')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        if (!inside(r, rr)) out.push(`${name(el)} beyond its row by ${Math.round(Math.max(r.right - rr.right, rr.left - r.left))} px`);
        if (el.tagName === 'INPUT' && el.type === 'number' && el.scrollWidth > el.clientWidth + 1) out.push(`${name(el)} cuts its value "${el.value}"`);
        if (el.tagName === 'BUTTON' && el.textContent.trim() && textLines(el) > 1) out.push(`${name(el)} label on ${textLines(el)} lines`);
        if (el.tagName === 'LABEL' && el.classList.contains('ch-invert-label') && textLines(el) > 1) out.push('invert label on two lines');
      }
      // The histogram lies behind the sliders: from the first slider's left to its right edge.
      const hist = row.querySelector('.ch-hist'), slider = row.querySelector('.ch-min');
      if (hist && slider) {
        const h = hist.getBoundingClientRect(), s = slider.getBoundingClientRect();
        if (Math.abs(h.left - s.left) > 2 || Math.abs(h.right - s.right) > 2) out.push(`histogram ${Math.round(h.left)}–${Math.round(h.right)} not behind the slider ${Math.round(s.left)}–${Math.round(s.right)}`);
      }
    }
    return out;
  }

  try {
    await MFC_PROJECT.createProject({ name: 'Channel layout', width: 1200, height: 800, unit: 'px', dpi: 300 });
    await frame();
    const cases = [
      { file: await png(), label: '8-bit RGB', longest: ['255', '0'] },
      { file: await fixture('gray16.tif'), label: '16-bit', longest: ['65535', '0'] },
      { file: await fixture('signed16.tif'), label: 'signed 16-bit', longest: ['-32768', '32767'] },
      { file: await fixture('float32.tif'), label: '32-bit float', longest: ['-1234567', '1234567'] }
    ];
    for (const c of cases) {
      await MFC.importFiles([c.file]); await MFC_TIFF.whenIdle();
      const img = canvas.getObjects().find(o => o.mfcFileName === c.file.name);
      canvas.setActiveObject(img); canvas.fire('selection:created', { selected: [img] }); await frame();
      // The longest values the min and max fields show for this kind of data.
      const fill = () => document.querySelectorAll('#channel-list .channel-row').forEach(row => { row.querySelector('.ch-min-val').value = c.longest[0]; row.querySelector('.ch-max-val').value = c.longest[1]; });
      const found = [];
      for (const width of [280, 320]) for (const theme of themes) {
        MFC_UI.applyTheme(theme); panel.style.width = width + 'px';
        fill(); await frame();
        for (const p of problems()) found.push(`${width} px, ${theme}: ${p}`);
      }
      assert(`${c.label}: every control inside its row and the panel, values whole, labels on one line (280 and 320 px, ${themes.length} themes)`, !found.length, found.slice(0, 6).join(' | '));
    }
    assert('Four themes were checked', themes.length === 4, themes.join());
  } finally {
    panel.style.width = '';
    MFC_UI.applyTheme(savedTheme);
  }
  return checks;
}

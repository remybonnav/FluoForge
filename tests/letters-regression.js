/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T3: panel letters in the editor (the model alone: tests/letters-model-regression.mjs).
   - One click (Letters) letters the selected panels, or a grid's panels, A, B, C in reading order;
   - the style is set once per document (case, bold, size in pt, corner, inside or outside, offset,
     colour) and every letter follows it;
   - letters are linked to their panel: they follow it (moves, grid layout), renumber when panels are
     reordered (a drag, a grid swap), added or deleted; a panel can be skipped or given its own letter
     (in the panel or by editing the letter); deleting a letter unletters its panel;
   - undo, save and reopen, SVG export, copy and paste; the panel's titles, keyboard and themes. */
async function runLettersRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 0.75) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const load = async (blob, name) => { await MFC_PROJECT.loadProject(new File([blob], name)); document.querySelectorAll('.recovery-modal').forEach(m => m.remove()); await MFC_TIFF.whenIdle(); };
  await load(await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer(), 'reference.mfcproj.zip');
  const Lm = await import(new URL('js/layout/letters-model.js', document.baseURI).href);
  const G = await import(new URL('js/layout/grid.js', document.baseURI).href);
  const dpi = MFC.getDocProps().dpi, mm = v => v / 25.4 * dpi, pt = v => v / 72 * dpi;
  const byId = id => canvas.getObjects().find(o => o.mfcId === id);
  const images = () => canvas.getObjects().filter(o => o.mfcType === 'mfcImage');
  const letters = () => canvas.getObjects().filter(o => o.type === 'textbox' && o.mfcLetterFor);
  const letterOf = p => letters().find(l => l.mfcLetterFor === p.mfcId);
  const boxOf = o => { const m = o.calcTransformMatrix(), w = o.width / 2, h = o.height / 2; return fabric.util.makeBoundingBoxFromPoints([[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => fabric.util.transformPoint(new fabric.Point(x, y), m))); };
  const tl = o => o.getPointByOrigin('left', 'top');
  /** What the letters should be now, from the panels' places (the model's reading order). */
  const expected = (lettercase = 'upper') => {
    const panels = images().filter(p => p.mfcLetter);
    const order = Lm.readingOrder(panels.map(p => { const b = boxOf(p); return { id: p.mfcId, page: Math.max(0, MFC.pageIndexForBox(b)), ...b }; }));
    return Lm.assignLetters(order.map(id => ({ id, skip: !!byId(id).mfcLetter.skip, text: byId(id).mfcLetter.text })), lettercase);
  };
  const shown = () => new Map(letters().map(l => [l.mfcLetterFor, l.text]));
  const same = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
  const describe = m => [...m].map(([k, v]) => `${byId(k)?.mfcFileName || k}:${v}`).join(' ');
  const drag = (from, to) => {
    canvas.renderAll(); canvas.calcOffset();
    const box = canvas.upperCanvasEl.getBoundingClientRect(), v = canvas.viewportTransform;
    const s = p => ({ x: box.left + p.x * v[0] + v[4], y: box.top + p.y * v[3] + v[5] }), a = s(from), b = s(to);
    canvas.upperCanvasEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: a.x, clientY: a.y, buttons: 1 }));
    for (const p of [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b]) document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: p.x, clientY: p.y, buttons: 1, altKey: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: b.x, clientY: b.y, altKey: true }));
  };
  const field = (id, value) => { const el = document.getElementById(id); if (el.type === 'checkbox') el.checked = value; else el.value = String(value); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const select = list => { canvas.discardActiveObject(); canvas.setActiveObject(list.length === 1 ? list[0] : new fabric.ActiveSelection(list, { canvas })); canvas.fire('selection:created', { selected: list }); };

  // ---- One click ----
  const button = document.getElementById('btn-letters'), panelEl = document.getElementById('panel-letters');
  assert('A Letters button in the top bar, with a title saying what it does', button && /A, B, C/.test(button.title));
  canvas.discardActiveObject(); document.getElementById('toast').textContent = '';
  button.click();
  assert('With nothing selected it letters nothing and says what to select; the panel opens', letters().length === 0 && /Select the panels/.test(document.getElementById('toast').textContent) && !panelEl.classList.contains('hidden'));
  const four = images();
  select(four); button.click(); canvas.discardActiveObject();
  assert('One click letters the four selected panels A, B, C, D in reading order', letters().length === 4 && same(shown(), expected()) && [...shown().values()].sort().join() === 'A,B,C,D', describe(shown()));
  const s0 = Lm.normalizeStyle();
  const inPlace = (p, style = s0) => { const l = letterOf(p), b = boxOf(p), at = Lm.placeLetter(b, { width: l.width, height: l.height }, style, mm(style.offsetMm)); return near(tl(l).x, at.left) && near(tl(l).y, at.top); };
  assert('Default style: bold, 10 pt, white, 1 mm inside the top-left corner of each panel', letters().every(l => l.fontWeight === 'bold' && near(l.fontSize, pt(10), 1e-6) && l.fill === '#ffffff' && l.mfcType === 'text') &&
    four.every(p => inPlace(p)), letters().map(l => `${l.text} ${l.fontWeight} ${l.fontSize} ${l.fill} at ${tl(l).x.toFixed(1)},${tl(l).y.toFixed(1)}`).join(' | ') + ' // ' +
    four.map(p => { const l = letterOf(p), b = boxOf(p), at = Lm.placeLetter(b, { width: l.width, height: l.height }, s0, mm(1)); return `${l.text}: want ${at.left.toFixed(1)},${at.top.toFixed(1)} angle ${p.angle} group ${!!p.group}`; }).join(' | '));
  assert('Each letter is linked to its panel and drawn above it', four.every(p => p.mfcLetter && letterOf(p) && canvas.getObjects().indexOf(letterOf(p)) > canvas.getObjects().indexOf(p)));

  // ---- Style, once per document ----
  field('letters-case', 'lower'); field('letters-bold', false); field('letters-size', 12); field('letters-position', 'bottom-right'); field('letters-placement', 'outside'); field('letters-offset', 2); field('letters-color', '#ff0000');
  const s1 = Lm.normalizeStyle(MFC.getDocProps().letterStyle);
  assert('The style is saved with the document', JSON.stringify(s1) === JSON.stringify({ case: 'lower', bold: false, sizePt: 12, position: 'bottom-right', placement: 'outside', offsetMm: 2, color: '#ff0000' }), JSON.stringify(s1));
  assert('Every letter follows it: lower case, not bold, 12 pt, red, 2 mm below the bottom-right corner', same(shown(), expected('lower')) && [...shown().values()].sort().join() === 'a,b,c,d' &&
    letters().every(l => l.fontWeight === 'normal' && near(l.fontSize, pt(12), 1e-6) && l.fill === '#ff0000') && four.every(p => inPlace(p, s1)));
  field('letters-case', 'upper'); field('letters-bold', true); field('letters-size', 10); field('letters-position', 'top-left'); field('letters-placement', 'inside'); field('letters-offset', 1); field('letters-color', '#ffffff');

  // ---- Linked: follows, renumbers ----
  const first = four.find(p => letterOf(p).text === 'A'), c = first.getCenterPoint();
  select([first]); drag(c, { x: c.x + 15, y: c.y + 10 });
  assert('A letter follows its panel when the panel is dragged', inPlace(first) && letterOf(first).text === 'A',
    `moved ${(first.getCenterPoint().x - c.x).toFixed(1)},${(first.getCenterPoint().y - c.y).toFixed(1)}; letter ${letterOf(first).text} at ${tl(letterOf(first)).x.toFixed(1)},${tl(letterOf(first)).y.toFixed(1)}; want ${JSON.stringify(Lm.placeLetter(boxOf(first), { width: letterOf(first).width, height: letterOf(first).height }, s0, mm(1)))}; active ${canvas.getActiveObject() && canvas.getActiveObject().mfcId}`);
  const page = MFC.pageBounds(0);
  select([first]); drag(first.getCenterPoint(), { x: page.left + page.width - 60, y: page.top + page.height - 60 });
  assert('Dragging panel A to the bottom right of the page renumbers: it becomes the last letter, the others move up', letterOf(first).text === 'D' && same(shown(), expected()) && inPlace(first), describe(shown()));
  const extra = (await (async () => { select([four[1]]); MFC.copySelection(); await MFC.pasteSelection(); await MFC_TIFF.whenIdle(); return canvas.getActiveObject(); })());
  assert('A pasted lettered panel gets its own letter, linked to it, in reading order; the original keeps its letter', extra.mfcLetter && letterOf(extra) && letterOf(extra) !== letterOf(four[1]) &&
    letters().length === 5 && same(shown(), expected()), describe(shown()));
  canvas.remove(extra); MFC.pushHistory();
  assert('Deleting a lettered panel removes its letter and the others renumber', letters().length === 4 && !letters().some(l => l.mfcLetterFor === extra.mfcId) && same(shown(), expected()) &&
    [...shown().values()].sort().join() === 'A,B,C,D');

  // ---- Skip and override ----
  const second = four.find(p => letterOf(p).text === 'B');
  select([second]);
  assert('The panel shows the selected panel\'s letter', !document.getElementById('letters-selected').classList.contains('hidden') && /lettered B/.test(document.getElementById('letters-info').textContent));
  field('letters-skip', true);
  assert('Skip: the panel loses its letter and the next panels move up', !letterOf(second) && second.mfcLetter.skip && letters().length === 3 && [...shown().values()].sort().join() === 'A,B,C' && same(shown(), expected()));
  field('letters-skip', false);
  assert('…and counts again when unskipped', letterOf(second).text === 'B' && letters().length === 4);
  select([second]); field('letters-override', "B'");
  assert('Own letter: the panel shows it, the others keep their letters', letterOf(second).text === "B'" && second.mfcLetter.text === "B'" && [...shown().values()].sort().join() === "A,B',C,D");
  field('letters-override', '');
  assert('Emptying it gives the automatic letter back', letterOf(second).text === 'B' && !second.mfcLetter.text);
  const third = four.find(p => letterOf(p).text === 'C'), l3 = letterOf(third);
  l3.set('text', 'C1'); canvas.fire('object:modified', { target: l3 });
  assert('Editing a letter\'s text gives its panel that letter', third.mfcLetter.text === 'C1' && letterOf(third).text === 'C1');
  l3.set('text', 'C'); canvas.fire('object:modified', { target: l3 });
  assert('Typing the automatic letter back makes it automatic again', !third.mfcLetter.text);
  const fourth = four.find(p => letterOf(p).text === 'D');
  canvas.remove(letterOf(fourth)); MFC.pushHistory();
  assert('Deleting a letter takes its panel out of the lettering', !fourth.mfcLetter && letters().length === 3);
  await MFC.undo(); await MFC_TIFF.whenIdle();
  assert('Undo brings the letter back, linked', letters().length === 4 && images().filter(p => p.mfcLetter).length === 4 && same(shown(), expected()));

  // ---- Grid cells ----
  const panels = images();
  const grid = G.createGrid(panels, { rows: 2, cols: 2, width: 90, gutter: 2, colBand: 0, rowBand: 0 });
  canvas.discardActiveObject();
  assert('Panels laid out by a grid: their letters follow and renumber in reading order (row by row)', same(shown(), expected()) && panels.every(p => inPlace(p)));
  const cellLetter = (row, col) => { const a = grid.mfcGrid.areas.find(x => x.row === row && x.col === col); return letterOf(byId(a.panel)).text; };
  assert('…which is the grid\'s order: A B on the first row, C D on the second', `${cellLetter(0, 0)}${cellLetter(0, 1)}${cellLetter(1, 0)}${cellLetter(1, 1)}` === 'ABCD');
  const a00 = byId(grid.mfcGrid.areas.find(x => x.row === 0 && x.col === 0).panel), a11 = byId(grid.mfcGrid.areas.find(x => x.row === 1 && x.col === 1).panel);
  select([a00]); drag(a00.getCenterPoint(), a11.getCenterPoint());
  assert('Swapping two grid panels renumbers: the cells keep A to D, the panels change letters', `${cellLetter(0, 0)}${cellLetter(0, 1)}${cellLetter(1, 0)}${cellLetter(1, 1)}` === 'ABCD' && letterOf(a00).text === 'D' && letterOf(a11).text === 'A' && inPlace(a00));
  select([grid]); document.getElementById('letters-remove').click(); canvas.discardActiveObject();
  assert('Remove letters with the grid selected: its panels lose their letters', letters().length === 0 && !images().some(p => p.mfcLetter));
  select([grid]); document.getElementById('letters-add').click(); canvas.discardActiveObject();
  assert('Selecting the grid and lettering letters its cells A, B, C, D (the grid stands for its panels)', grid.mfcGrid.areas.every(a => byId(a.panel).mfcLetter && letterOf(byId(a.panel))) &&
    `${cellLetter(0, 0)}${cellLetter(0, 1)}${cellLetter(1, 0)}${cellLetter(1, 1)}` === 'ABCD');

  // ---- Save, reopen, export ----
  field('letters-case', 'lower');
  const before = describe(shown()), style = JSON.stringify(MFC.getDocProps().letterStyle);
  const next = MFC_PROJECT.prepareSave(true, 'letters'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
  await MFC.closeDocument(); await load(archive, 'letters.fluoforge');
  assert('Save and reopen: the same letters on the same panels, and the document style', describe(shown()) === before && JSON.stringify(MFC.getDocProps().letterStyle) === style && letters().length >= 4, `${describe(shown())} WAS ${before}`);
  const g2 = canvas.getObjects().find(o => o.mfcType === 'layoutGrid'), p00 = byId(g2.mfcGrid.areas.find(x => x.row === 0 && x.col === 0).panel), p01 = byId(g2.mfcGrid.areas.find(x => x.row === 0 && x.col === 1).panel);
  const t00 = letterOf(p00).text;
  select([p00]); drag(p00.getCenterPoint(), p01.getCenterPoint());
  assert('…and still linked: a swap after reopening renumbers', letterOf(p00).text !== t00 && same(shown(), expected('lower')));
  const svg = (await MFC_EXPORT.buildSVG()).svg;
  assert('SVG export: the letters are text on the page', letters().filter(l => { const b = boxOf(l); return b.left < MFC.pageBounds(0).width; }).every(l => svg.includes('>' + l.text + '<')));

  // ---- Panel: titles, keyboard, themes ----
  select([p00]); document.getElementById('btn-letters').click();
  const controls = [...panelEl.querySelectorAll('input, select, button')];
  assert('Every Panel letters control has a title (its own or its label\'s)', controls.every(c => (c.title || c.closest('[title]')?.title || '').length > 5), controls.filter(c => !(c.title || c.closest('[title]')?.title)).map(c => c.id).join());
  const sz = document.getElementById('letters-size'); sz.focus(); if (document.activeElement !== sz) { await frame(); sz.focus(); }
  assert('Its fields take keyboard focus', document.activeElement === sz);
  const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (x, y) => { const [h, l] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (h + 0.05) / (l + 0.05); };
  const opaque = el => { for (let e = el; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; if (!/rgba\(.*,\s*0\)$|transparent/.test(bg)) return bg; } return 'rgb(255,255,255)'; };
  const savedTheme = document.documentElement.dataset.theme, ratios = [];
  for (const theme of ['light', 'sage', 'dark', 'slate']) {
    document.documentElement.dataset.theme = theme;
    for (const el of [panelEl.querySelector('label'), document.getElementById('letters-info'), document.getElementById('letters-add'), button, sz]) ratios.push(contrast(getComputedStyle(el).color, opaque(el)));
  }
  if (savedTheme) document.documentElement.dataset.theme = savedTheme; else delete document.documentElement.dataset.theme;
  assert('The Panel letters panel and button are readable in all four themes (contrast ≥ 4.5)', ratios.every(r => r >= 4.5), ratios.map(r => r.toFixed(1)).join());
  return checks;
}

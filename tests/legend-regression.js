/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Channel legend tool (js/tools/legend.js).
   - Choosing the tool only opens its panel, even with an image selected; "Add legend to selected image"
     adds the legend, in one History step, and is greyed out with a hint when no image is selected;
     no tool button adds an object by itself (PI-T17);
   - the legend is a text box with the shown channels' names, each in its
     channel's colour (LUT at max; grey on white and the like fall back to black or white);
   - the box is as wide as the image is displayed, above it, or as long as it is tall, turned 90° on
     its left side; background black, white or transparent; border on (black) or off;
   - the options update a selected legend; no image selected gives a message;
   - undo, save and reopen, SVG and PDF exports; the button, panel, keyboard and themes. */
async function runLegendRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
  const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await MFC_TIFF.whenIdle(); await document.fonts.ready;
  const L = await import(new URL('js/tools/legend.js', document.baseURI).href);

  const images = () => canvas.getObjects().filter(o => o.mfcType === 'mfcImage' && !o.mfcIsInset);
  const img = images()[0], raw = MFC.getRegistry()[img.mfcId].rawImage;
  assert('The reference image has three channels to label', raw.channels.length >= 3, raw.channels.length);
  Object.assign(raw.channels[0], { name: 'DAPI', color: 'blue', enabled: true, gamma: 1, invert: false });
  Object.assign(raw.channels[1], { name: 'FLAG', color: 'green', enabled: true, gamma: 1, invert: false });
  Object.assign(raw.channels[2], { name: 'WGA', color: 'red', enabled: true, gamma: 1, invert: false });
  const texts = () => canvas.getObjects().filter(o => o.type === 'textbox');
  const colours = box => { const line = box.styles[0] || {}; return [...box.text].map((c, i) => (c === ' ' ? ' ' : (line[i] && line[i].fill) || box.fill)); };
  const wordColours = box => { const c = colours(box); let at = 0; return box.text.split(' ').map(w => { const v = c[at]; at += w.length + 1; return v; }); };
  const shown = o => fabric.util.makeBoundingBoxFromPoints(o.getCoords(true, true));
  // A text box's own box (its bounding rectangle also counts Fabric's default 1 px stroke):
  // { left, top, width, height } on the page, also when turned 90°.
  const boxOf = o => { const c = o.getCenterPoint(), turned = Math.abs(o.angle % 180) === 90, w = turned ? o.height : o.width, h = turned ? o.width : o.height;
    return { left: c.x - w / 2, top: c.y - h / 2, width: w, height: h }; };
  const choose = (id, value) => { const el = document.getElementById(id); if (el.type === 'checkbox') el.checked = value; else el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
  const make = (image = img) => { canvas.setActiveObject(image); return L.addChannelLegend()[0]; };
  const snapshot = o => JSON.stringify({ text: o.text, styles: o.styles, fill: o.fill, bg: o.backgroundColor, w: o.width, h: o.height, left: o.left, top: o.top, angle: o.angle, border: o.mfcBorderWidth, borderColor: o.mfcBorderColor, size: o.fontSize });

  // ---- The tool creates an ordinary text box ----
  const button = document.getElementById('tool-legend'), panel = document.getElementById('panel-legend');
  assert('The Legend tool button is in the toolbar with a title that says what to do', button && button.dataset.tool === 'legend' && /select an image/i.test(button.title) && /Add legend to selected image/.test(button.title) && /\(L\)/.test(button.title));
  const addButton = document.getElementById('legend-add');
  const before = texts().length, objectsBefore = canvas.getObjects().length, stepsBefore = MFC.getHistory().labels.length;
  canvas.setActiveObject(img); button.click();
  assert('Choosing the tool with an image selected adds nothing: it opens the Channel legend panel', MFC.currentTool === 'legend' && canvas.getObjects().length === objectsBefore &&
    texts().length === before && !panel.classList.contains('hidden') && MFC.getHistory().labels.length === stepsBefore && canvas.getActiveObject() === img);
  assert('…with "Add legend to selected image" ready for the selected image', addButton.textContent === 'Add legend to selected image' && !addButton.disabled && addButton.title);
  addButton.click();
  let box = canvas.getActiveObject();
  assert('"Add legend to selected image" adds one text box, selected, in one History step, the tool still active', texts().length === before + 1 && box.type === 'textbox' &&
    MFC.currentTool === 'legend' && MFC.getHistory().labels.length === stepsBefore + 1, MFC.getHistory().labels.length - stepsBefore);
  assert('It lists the shown channels by name', box.text === 'DAPI FLAG WGA', box.text);
  assert('Each name is in its channel\'s colour: blue, green, red', wordColours(box).join() === '#0000ff,#00ff00,#ff0000', wordColours(box).join());
  assert('It is an ordinary text box: mfcType "text", no legend fields, no link to the image',
    box.mfcType === 'text' && !Object.keys(box).some(k => /legend/i.test(k)) && !Object.values(box).includes(img.mfcId) && box.textAlign === 'center' && box.mfcVAlign === 'middle');
  assert('Default look: black background, black border', box.backgroundColor === '#000000' && box.mfcBorderWidth > 0 && box.mfcBorderColor === '#000000');
  let r = shown(img), b = boxOf(box);
  assert('Width: as wide as the image is displayed, right above it', near(b.width, r.width) && near(b.left, r.left) && near(b.top + b.height, r.top) && box.angle === 0,
    `${b.left},${b.top} ${b.width}x${b.height} / image ${r.left},${r.top} ${r.width}x${r.height}`);
  assert('The names fit on one line', box._textLines.length === 1);
  assert('The Channel legend panel shows while the tool is active', !panel.classList.contains('hidden') && document.getElementById('legend-background').value === 'black' &&
    document.getElementById('legend-border').checked && document.getElementById('legend-fit').value === 'width');

  // ---- The options set up the next legend and never change an existing box ----
  const first = box, firstBefore = snapshot(first);
  choose('legend-background', 'white'); choose('legend-border', false); choose('legend-border-color', '#ff00ff'); choose('legend-fit', 'height');
  assert('Changing every option leaves the existing text box exactly as it was', snapshot(first) === firstBefore);
  first.set({ text: 'Hoechst FLAG-tag WGA', styles: {} }); first.set('backgroundColor', '#ffffff'); first.mfcBorderColor = '#00ff00';
  canvas.setActiveObject(first); choose('legend-background', 'black'); choose('legend-border', true);
  assert('After editing its text and look like any text box, the legend options do not touch it', first.text === 'Hoechst FLAG-tag WGA' && first.backgroundColor === '#ffffff' && first.mfcBorderColor === '#00ff00');
  canvas.setActiveObject(first); MFC.setTool('select'); canvas.setActiveObject(first); canvas.fire('selection:created', { selected: [first] });
  assert('Selected with the Select tool, it opens the Text panel, not the legend panel', panel.classList.contains('hidden') && !document.getElementById('panel-text').classList.contains('hidden'));
  canvas.remove(first); MFC.setTool('legend');

  raw.channels[0].color = 'grey';
  choose('legend-background', 'white'); choose('legend-border', true); choose('legend-border-color', '#000000'); choose('legend-fit', 'width');
  box = make();
  assert('White background: a white box, and a grey (white at max) channel is written in black; green stays green', box.backgroundColor === '#ffffff' && wordColours(box)[0] === '#000000' && wordColours(box)[1] === '#00ff00', wordColours(box).join());
  canvas.remove(box); choose('legend-background', 'black'); box = make();
  assert('Black background: grey is written in white', box.backgroundColor === '#000000' && wordColours(box)[0] === '#ffffff');
  canvas.remove(box); choose('legend-background', 'transparent'); box = make();
  assert('Transparent background: no box fill', !box.backgroundColor && wordColours(box)[0] === '#ffffff');
  canvas.remove(box); choose('legend-border', false); box = make();
  assert('Border off', box.mfcBorderWidth === 0 && document.getElementById('legend-border-color').disabled);
  canvas.remove(box); choose('legend-border', true); choose('legend-border-color', '#ff00ff'); box = make();
  assert('Border on, in the chosen colour', box.mfcBorderWidth > 0 && box.mfcBorderColor === '#ff00ff');
  canvas.remove(box); choose('legend-fit', 'height'); box = make(); r = shown(img); b = boxOf(box);
  assert('Height: turned 90°, as long as the image is displayed tall, against its left side, centred on it',
    box.angle === -90 && near(box.width, r.height) && near(b.left + b.width, r.left) && near(b.top + b.height / 2, r.top + r.height / 2) && near(b.height, r.height),
    `${b.left},${b.top} ${b.width}x${b.height} / image ${r.left},${r.top} ${r.width}x${r.height}`);
  canvas.remove(box);
  raw.channels[0].color = 'blue'; choose('legend-background', 'black'); choose('legend-border-color', '#000000'); choose('legend-fit', 'width');

  // ---- Shown channels, LUTs, displayed size ----
  raw.channels[1].enabled = false; raw.channels[2].color = 'viridis';
  box = make();
  assert('Only shown channels are listed; a LUT gives its colour at max (viridis: yellow)', box.text === 'DAPI WGA' && wordColours(box).join() === '#0000ff,#fde725', `${box.text} ${wordColours(box).join()}`);
  raw.channels[1].enabled = true; raw.channels[2].color = 'red'; canvas.remove(box);
  const second = images().find(o => o !== img && !o.angle && !o.group) || img, saved = [second.scaleX, second.scaleY];
  second.set({ scaleX: saved[0] * 0.5, scaleY: saved[1] * 0.5 }); second.setCoords();
  box = make(second);
  assert('The size follows the displayed image (scaled to half), not its source pixels', near(boxOf(box).width, shown(second).width) && near(shown(second).width, second.width * saved[0] * 0.5),
    `legend ${boxOf(box).width}, image shown ${shown(second).width}`);
  canvas.remove(box); second.set({ scaleX: saved[0], scaleY: saved[1] }); second.setCoords();
  const wide = shown(img).width;
  raw.channels.forEach((c, i) => { c.name = ['A very long first channel name', 'Another rather long name', 'Third'][i] || c.name; });
  img.set({ scaleX: img.scaleX * 0.3, scaleY: img.scaleY * 0.3 }); img.setCoords();
  box = make();
  assert('Long names on a small image: the text shrinks to stay on one line', box._textLines.length === 1 && box.fontSize < 24 && near(boxOf(box).width, wide * 0.3, 1), `${box.fontSize} ${box._textLines.length}`);
  canvas.remove(box); img.set({ scaleX: img.scaleX / 0.3, scaleY: img.scaleY / 0.3 }); img.setCoords();
  ['DAPI', 'FLAG', 'WGA'].forEach((n, i) => { raw.channels[i].name = n; });

  // ---- No image selected ----
  canvas.discardActiveObject();
  let count = texts().length; document.getElementById('toast').textContent = '';
  L.addChannelLegend();
  assert('Without a selected image nothing is added and a message says to select one', texts().length === count && /Select an image/.test(document.getElementById('toast').textContent), document.getElementById('toast').textContent);
  MFC.setTool('select'); MFC.setTool('legend');
  assert('…and the panel\'s Add button is disabled, with a status line', document.getElementById('legend-add').disabled && /Select an image/.test(document.getElementById('legend-status').textContent));
  count = canvas.getObjects().length; MFC.setTool('select'); MFC.setTool('legend');
  assert('Choosing the tool with nothing selected adds nothing', canvas.getObjects().length === count);

  // ---- Undo ----
  MFC.pushHistory(); // the checks above removed their boxes without recording it
  count = texts().length; make(); await MFC.undo();
  assert('Undo removes the legend just added', texts().length === count);

  // ---- Save, reopen, exports ----
  const keep = make(); MFC.pushHistory(); MFC.setTool('select');
  const keepId = keep.mfcId, keepJson = snapshot(keep);
  const next = MFC_PROJECT.prepareSave(true, 'legend'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
  await MFC.closeDocument();
  await MFC_PROJECT.loadProject(new File([archive], 'legend.fluoforge'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await MFC_TIFF.whenIdle();
  const back = canvas.getObjects().find(o => o.mfcId === keepId);
  assert('Save and reopen: the text box comes back identical (text, colours, box, border, place)', back && snapshot(back) === keepJson);
  const svg = (await MFC_EXPORT.buildSVG()).svg;
  assert('SVG export: the names are text in their colours', /DAPI/.test(svg) && /rgb\(0,0,255\)/.test(svg) && /rgb\(0,255,0\)/.test(svg) && /rgb\(255,0,0\)/.test(svg));
  const pdf = await MFC_EXPORT.buildPDF();
  assert('PDF export works with the legend', pdf.blob.size > 1000);

  // ---- Keyboard, controls, themes ----
  MFC.setTool('select'); document.activeElement && document.activeElement.blur && document.activeElement.blur();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
  assert('The L key chooses the Legend tool', MFC.currentTool === 'legend');
  const controls = [...panel.querySelectorAll('select, input, button')];
  assert('Every legend control has a title (its own or its label\'s)', controls.every(c => (c.title || c.closest('[title]')?.title || '').length > 5));
  // Each control takes keyboard focus (Firefox may need a frame to scroll the inspector first).
  const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const focusable = async el => { el.focus(); if (document.activeElement !== el) { await frame(); el.focus(); await frame(); } return document.activeElement === el; };
  const own = ['legend-background', 'legend-border', 'legend-border-color', 'legend-fit'].map(id => document.getElementById(id));
  const focused = []; for (const el of own) focused.push(await focusable(el));
  assert('The legend controls take keyboard focus and are in the Tab order', focused.every(Boolean) && controls.every(c => c.tabIndex >= 0), focused.join());
  const bg = document.getElementById('legend-background');
  const luminance = rgb => { const [r2, g, b2] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r2 + 0.7152 * g + 0.0722 * b2; };
  const ratio = (x, y) => { const [h, l] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (h + 0.05) / (l + 0.05); };
  const opaque = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (!/rgba\(.*,\s*0\)$|transparent/.test(c)) return c; } return 'rgb(255,255,255)'; };
  const savedTheme = document.documentElement.dataset.theme, ratios = [];
  for (const theme of ['light', 'sage', 'dark', 'slate']) {
    document.documentElement.dataset.theme = theme;
    for (const el of [bg, panel.querySelector('label'), document.getElementById('legend-add'), button]) ratios.push(ratio(getComputedStyle(el).color, opaque(el)));
  }
  if (savedTheme) document.documentElement.dataset.theme = savedTheme; else delete document.documentElement.dataset.theme;
  assert('The panel and the button are readable in all four themes (contrast ≥ 4.5)', ratios.every(x => x >= 4.5), ratios.map(x => x.toFixed(1)).join());

  // ---- No tool button adds an object by itself (PI-T17): each opens its options ----
  // (The Crop tool shows its crop frame on the selected image to be adjusted: an editing frame, not a
  // figure object, gone when the tool ends; it is not counted.)
  const C = await import(new URL('js/tools/crop.js', document.baseURI).href);
  MFC.setTool('select');
  const target = images()[0], acted = [];
  for (const toolButton of document.querySelectorAll('.tool-btn[data-tool]')) {
    MFC.setTool('select'); canvas.setActiveObject(target);
    const objects = canvas.getObjects().slice(), steps = MFC.getHistory().labels.length;
    toolButton.click();
    const added = canvas.getObjects().filter(o => !objects.includes(o) && !MFC.isHelper(o) && o !== C.cropRect);
    if (added.length || MFC.getHistory().labels.length !== steps) acted.push(toolButton.dataset.tool);
  }
  MFC.setTool('select');
  assert('No tool button adds an object or a History step by itself, with an image selected', !acted.length && document.querySelectorAll('.tool-btn[data-tool]').length >= 9, acted.join());
  return checks;
}

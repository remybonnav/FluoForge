/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P2-T3: histogram and auto contrast, and copying display settings between images.
   - histograms of the displayed plane (exact for integer data, binned for float), computed in the
     worker, drawn on a log scale behind the min and max sliders;
   - Auto (ImageJ's Enhance Contrast, saturated=0.35: checked against ImageJ 1.54p), Full range and
     Reset to file, each one History step; slider limits that follow the data;
   - acceptance: Auto on a 12-bit image in a 16-bit file sets a sensible range;
   - Copy / Paste display settings (selection bar and context menu): channels matched by number,
     one History step. */
async function runHistogramDisplayRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail ? ': ' + detail : '')); checks.push(name); };
  const core = await import(new URL('js/image/composite-core.js', document.baseURI).href);
  const display = await import(new URL('js/image/display-settings.js', document.baseURI).href);
  const canvas = MFC.getCanvas();
  const idle = () => MFC_TIFF.whenIdle();
  const steps = () => MFC.getHistory().index; // the current step (after an undo, a new step replaces the redo branch)

  // A little-endian TIFF: one page per channel (8- or 16-bit), optional ImageDescription on page 1.
  const tiff = (name, pages, w, h, bits = 16, description = null) => {
    const desc = description ? new TextEncoder().encode(description + '\0') : null;
    const tagsPerPage = i => 8 + (i === 0 && desc ? 1 : 0), planeBytes = w * h * bits / 8;
    let size = 8 + (desc ? desc.length : 0);
    const layout = pages.map((_, i) => { const ifd = size; size += 2 + tagsPerPage(i) * 12 + 4; const data = size; size += planeBytes; return { ifd, data }; });
    const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
    u8.set([0x49, 0x49]); dv.setUint16(2, 42, true); dv.setUint32(4, layout[0].ifd, true);
    if (desc) u8.set(desc, 8);
    pages.forEach((page, i) => {
      const { ifd, data } = layout[i]; let p = ifd; dv.setUint16(p, tagsPerPage(i), true); p += 2;
      const tag = (id, type, count, value) => { dv.setUint16(p, id, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true); if (type === 3 && count === 1) dv.setUint16(p + 8, value, true); else dv.setUint32(p + 8, value, true); p += 12; };
      tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, bits); tag(259, 3, 1, 1); tag(262, 3, 1, 1);
      if (i === 0 && desc) tag(270, 2, desc.length, 8);
      tag(273, 4, 1, data); tag(277, 3, 1, 1); tag(279, 4, 1, planeBytes);
      dv.setUint32(p, i + 1 < pages.length ? layout[i + 1].ifd : 0, true);
      for (let k = 0; k < w * h; k++) { if (bits === 16) dv.setUint16(data + k * 2, page[k], true); else u8[data + k] = page[k]; }
    });
    return new File([buf], name, { type: 'image/tiff' });
  };

  // ---- the maths ----
  // The planes the ImageJ 1.54p results were taken from (same formulas in an ImageJ macro, then
  // Process > Enhance Contrast, saturated=0.35, and getMinAndMax):
  //   8-bit spikes 3..250, 16-bit spikes 60..1799, smooth 12-bit-in-16 100..3991.
  const W = 200, H = 150, N = W * H;
  const spikes8 = Uint8Array.from({ length: N }, (_, i) => (i % 211 === 0 ? 3 : i % 97 === 0 ? 250 : 40 + (i * 37) % 61));
  const spikes16 = Uint16Array.from({ length: N }, (_, i) => (i % 499 === 0 ? 60 : i % 997 === 0 ? 4095 : 200 + (i * 37) % 1601));
  const smooth = Uint16Array.from({ length: N }, (_, i) => { const u = ((i * 7919) % 30011) / 30011; return i % 1499 === 0 ? 4095 : 100 + Math.floor(3900 * u * u); });
  const range = plane => core.autoRange(core.planeHistogram(plane));
  assert('Auto gives what ImageJ 1.54p\'s Enhance Contrast (saturated=0.35) gives on 8- and 16-bit planes',
    JSON.stringify([range(spikes8), range(spikes16), range(smooth)]) === JSON.stringify([{ min: 3, max: 250 }, { min: 60, max: 1799 }, { min: 100, max: 3991 }]),
    JSON.stringify([range(spikes8), range(spikes16), range(smooth)]));
  // Independently: 0.35 % in total is saturated, half at each end (n * 0.35 / 200 pixels per end).
  const sorted = Array.from(smooth).sort((a, b) => a - b), cut = Math.floor(N * 0.35 / 200);
  assert('…which is the exact percentile: 0.175 % of the pixels at or past each end', range(smooth).min === sorted[cut] && range(smooth).max === sorted[N - 1 - cut]);
  const flat = core.planeHistogram(new Uint16Array(100).fill(700));
  assert('A flat plane gets a valid range (min < max) instead of an empty one', JSON.stringify(core.autoRange(flat)) === '{"min":700,"max":701}');
  const h8 = core.planeHistogram(spikes8);
  assert('Integer planes get one histogram bin per value, with exact counts and data min and max',
    h8.counts.length === 256 && h8.counts[3] === spikes8.filter(v => v === 3).length && h8.min === 3 && h8.max === 250 && h8.n === N);
  const float = new Float32Array([-1.5, 0, 0.25, 2.5, NaN, Infinity]);
  const hf = core.planeHistogram(float);
  assert('Float planes are binned over their data range, leaving out NaN and infinity', !hf.integer && hf.n === 4 && hf.min === -1.5 && hf.max === 2.5 && hf.counts.length === core.FLOAT_BINS);
  assert('Float slider limits are the data range', JSON.stringify(core.sliderLimits(hf, 32)) === '{"lo":-1.5,"hi":2.5,"integer":false}');
  assert('Integer slider limits: the bit depth, narrowed to the bits the data uses (8-bit 0-255; 12-bit data in 16 bits 0-4095; one hot pixel at 60000 0-65535)',
    core.sliderLimits(h8, 8).hi === 255 && core.sliderLimits(core.planeHistogram(smooth), 16).hi === 4095 &&
    core.sliderLimits(core.planeHistogram(Uint16Array.of(5, 60000)), 16).hi === 65535 && core.sliderLimits(core.planeHistogram(Uint16Array.of(5, 900)), 16).hi === 1023 &&
    core.sliderLimits(core.planeHistogram(smooth), 16, [5000]).hi === 16383);
  const bars = core.logBins(core.planeHistogram(Uint8Array.from([...Array(1000).fill(10), 200])), 0, 255, 256);
  assert('The drawn histogram is log-scaled: 1 pixel against 1000 is log(2)/log(1001) as tall, not 1/1000',
    bars[10] === 1 && Math.abs(bars[200] - Math.log(2) / Math.log(1001)) < 1e-6 && bars[100] === 0);

  // ---- in the worker ----
  const before = MFC_TIFF.stats.workerHistograms;
  const p1 = MFC_TIFF.histogram(smooth), p2 = MFC_TIFF.histogram(smooth);
  const hw = await p1;
  assert('The histogram is computed in the worker, once per displayed plane', MFC_TIFF.workerActive && MFC_TIFF.stats.workerHistograms === before + 1 && p1 === p2 &&
    hw.counts[4095] === core.planeHistogram(smooth).counts[4095] && hw.max === 4095);
  {
    // The channel panel asks in the background: that waits for the composite being made.
    const S = 1024, planes = [0, 1].map(c => Uint16Array.from({ length: S * S }, (_, i) => (i * (c + 5)) & 0xfff));
    const big = { width: S, height: S, brightness: 0, contrast: 0, channels: planes.map((data, c) => ({ data, enabled: true, bitDepth: 16, min: 0, max: 4095, color: c ? 'green' : 'magenta' })) };
    const order = [];
    const composite = MFC_TIFF.track(MFC_TIFF.composite(big, 1)).then(() => order.push('composite'));
    const background = MFC_TIFF.histogram(planes[0], { background: true }).then(() => order.push('background histogram'));
    await Promise.all([composite, background]);
    assert('A background histogram (the panel\'s) starts only after the pending composite', order.join() === 'composite,background histogram', order.join());
    let started = false;
    const waiting = MFC_TIFF.histogram(planes[1], { background: true }).then(() => { started = true; });
    const now = MFC_TIFF.histogram(planes[1]);
    assert('Asking for the same plane without background (Auto) starts it at once and shares the result', (await now) === (await MFC_TIFF.histogram(planes[1], { background: true })));
    await waiting;
    assert('…and the waiting request gets it too', started);
  }
  assert('…without touching the plane itself (it stays shared with the stack)', smooth.length === N && smooth[1] === 100 + Math.floor(3900 * (7919 / 30011) ** 2));

  // ---- acceptance: a 12-bit camera image in a 16-bit file ----
  window.focus();
  await MFC_PROJECT.createProject({ name: 'histogram', width: 900, height: 600, unit: 'px', dpi: 300 });
  // Dark background around 150-250, a bright cell up to ~3000, 0.1 % hot pixels at 4095 (12-bit
  // saturation). The ImageJ header gives the display range the file was saved with: 0-4095.
  const cam = Uint16Array.from({ length: N }, (_, i) => {
    const x = i % W, y = Math.floor(i / W), r = Math.hypot(x - 100, y - 75);
    const noise = ((i * 7919) % 101);
    if (i % 1000 === 0) return 4095;
    return r < 40 ? 600 + Math.round(2400 * (1 - r / 40)) + noise : 150 + noise;
  });
  await MFC.importFiles([tiff('camera-12bit.tif', [cam], W, H, 16, 'ImageJ=1.54p\nmin=0.0\nmax=4095.0')]);
  await idle();
  const img = canvas.getActiveObject(), raw = () => MFC.getRegistry()[img.mfcId].rawImage, ch = () => raw().channels[0];
  const row = () => document.querySelector('#channel-list .channel-row');
  await MFC_TIFF.histogram(ch().data); await new Promise(r => setTimeout(r, 0));
  assert('The image keeps the file\'s display range, and remembers it for "Reset to file"', ch().min === 0 && ch().max === 4095 && ch().fileMin === 0 && ch().fileMax === 4095);
  assert('The sliders follow the data: 0-4095 for 12-bit data in a 16-bit file (typed values may still use 0-65535)',
    row().querySelector('.ch-min').max === '4095' && row().querySelector('.ch-max').max === '4095' && row().querySelector('.ch-max-val').max === '65535');
  const svg = row().querySelector('.ch-hist');
  const heights = () => [...svg.querySelector('.ch-hist-bars').getAttribute('d').matchAll(/V([\d.]+)H/g)].map(m => 1 - parseFloat(m[1]));
  assert('A log-scale histogram is drawn behind the min and max sliders', svg.dataset.state === 'ready' && heights().length === 128 && Math.max(...heights()) === 1 &&
    heights().filter(v => v > 0).length > 20 && getComputedStyle(svg).position === 'absolute' && svg.parentElement.contains(row().querySelector('.ch-min')) && svg.parentElement.contains(row().querySelector('.ch-max')));
  assert('The background bins are the tallest; the 30 hot pixels still show (log scale)', Math.max(...heights().slice(4, 8)) === 1 && heights()[127] > 0.2, heights().slice(0, 10).map(v => v.toFixed(2)).join() + ' … ' + heights()[127]);
  assert('Auto, Full range and Reset to file each have a title', ['.ch-auto', '.ch-full', '.ch-reset'].every(s => row().querySelector(s).title.length > 20));

  let n = steps();
  row().querySelector('.ch-auto').click(); await idle();
  const camSorted = Array.from(cam).sort((a, b) => a - b), camCut = Math.floor(N * 0.35 / 200);
  assert('Accept: Auto sets a sensible range on a 12-bit image in a 16-bit file: from the background to the cell\'s brightest pixels, leaving out the hot pixels',
    ch().min === camSorted[camCut] && ch().max === camSorted[N - 1 - camCut] && ch().min >= 150 && ch().min < 200 && ch().max > 2500 && ch().max < 4095,
    ch().min + '-' + ch().max);
  assert('Auto is one History step, and the fields and the shaded range follow',
    steps() === n + 1 && row().querySelector('.ch-min-val').value === String(ch().min) && row().querySelector('.ch-max-val').value === String(ch().max) &&
    Math.abs(parseFloat(svg.querySelector('.ch-hist-range').getAttribute('width')) - (ch().max - ch().min) / 4095 * 128) < 0.01);
  const auto = [ch().min, ch().max];
  n = steps();
  row().querySelector('.ch-full').click(); await idle();
  assert('Full range shows the whole 12-bit range (0-4095), as one History step', ch().min === 0 && ch().max === 4095 && steps() === n + 1);
  ch().min = 400; ch().max = 900; MFC.recomposite(img); canvas.fire('object:modified', { target: img }); MFC.refreshChannelPanel(); await idle();
  n = steps();
  row().querySelector('.ch-reset').click(); await idle();
  assert('Reset to file goes back to the file\'s range (0-4095), as one History step', ch().min === 0 && ch().max === 4095 && steps() === n + 1);
  await MFC.undo(); await idle();
  assert('Undo after Reset to file gives back the previous range', ch().min === 400 && ch().max === 900);
  await MFC.redo(); await idle();
  canvas.setActiveObject(canvas.getObjects().find(o => o.mfcType === 'mfcImage')); MFC.refreshChannelPanel();

  // Save, reopen: Reset to file still knows the file's range (it is read from the source again).
  row().querySelector('.ch-auto').click(); await idle();
  const next = MFC_PROJECT.prepareSave(true, 'histogram'), saved = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
  await MFC.closeDocument();
  await MFC_PROJECT.loadProject(new File([saved], 'histogram.fluoforge'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await idle();
  let reopened = canvas.getObjects().find(o => o.mfcType === 'mfcImage');
  canvas.setActiveObject(reopened); MFC.refreshChannelPanel(); await idle();
  const rch = () => MFC.getRegistry()[reopened.mfcId].rawImage.channels[0];
  assert('After save and reopen the Auto range is kept, and the histogram is drawn again', rch().min === auto[0] && rch().max === auto[1] && rch().fileMax === 4095);
  await MFC_TIFF.histogram(rch().data); await new Promise(r => setTimeout(r, 0));
  row().querySelector('.ch-reset').click(); await idle();
  assert('…and Reset to file still goes back to the file\'s range', rch().min === 0 && rch().max === 4095 && row().querySelector('.ch-hist').dataset.state === 'ready');

  // An 8-bit image: 0-255 sliders; Auto with two images selected uses each one's own pixels.
  await MFC.importFiles([tiff('spikes8.tif', [spikes8], W, H, 8)]);
  await idle();
  const img8 = canvas.getActiveObject(), ch8 = () => MFC.getRegistry()[img8.mfcId].rawImage.channels[0];
  await MFC_TIFF.histogram(ch8().data); await new Promise(r => setTimeout(r, 0));
  assert('An 8-bit image gets 0-255 sliders', row().querySelector('.ch-max').max === '255' && row().querySelector('.ch-max-val').max === '255');
  canvas.setActiveObject(new fabric.ActiveSelection([reopened, img8], { canvas })); canvas.fire('selection:created'); MFC.refreshChannelPanel();
  n = steps();
  row().querySelector('.ch-auto').click(); await idle();
  assert('Auto on two selected images gives each one its own range, in one History step',
    ch8().min === 3 && ch8().max === 250 && rch().min === auto[0] && rch().max === auto[1] && steps() === n + 1, [ch8().min, ch8().max, rch().min, rch().max].join());

  // ---- copy and paste display settings ----
  await MFC.closeDocument();
  await MFC_PROJECT.createProject({ name: 'paste', width: 900, height: 600, unit: 'px', dpi: 300 });
  const small = (k, scale = 1) => Uint16Array.from({ length: 64 * 48 }, (_, i) => (i * (k + 3) * scale) % 4000);
  await MFC.importFiles([tiff('three.tif', [small(0), small(1), small(2)], 64, 48)]);
  await MFC.importFiles([tiff('two.tif', [small(3), small(4)], 64, 48)]);
  await MFC.importFiles([tiff('four.tif', [small(5), small(6), small(7), small(8)], 64, 48)]);
  await MFC.importFiles([tiff('eight-bit.tif', [Uint8Array.from({ length: 64 * 48 }, (_, i) => i % 256)], 64, 48, 8)]);
  await idle();
  const [three, two, four, eight] = canvas.getObjects().filter(o => o.mfcType === 'mfcImage');
  const rawOf = o => MFC.getRegistry()[o.mfcId].rawImage;
  Object.assign(rawOf(three), { brightness: 12, contrast: -8 });
  Object.assign(rawOf(three).channels[0], { color: 'viridis', min: 100, max: 3900, gamma: 0.8, invert: true });
  Object.assign(rawOf(three).channels[1], { color: 'magenta', min: 50, max: 2000, enabled: false });
  Object.assign(rawOf(three).channels[2], { color: 'fire', min: 10, max: 300, gamma: 1.5 });
  MFC.recomposite(three); MFC.pushHistory(); await idle();
  const fourCh3 = JSON.stringify(rawOf(four).channels[3], (k, v) => (k === 'data' ? undefined : v));

  canvas.setActiveObject(new fabric.ActiveSelection([three, two], { canvas })); canvas.fire('selection:created'); MFC.refreshSelectionBar();
  const copyBtn = document.getElementById('obj-copy-display'), pasteBtn = document.getElementById('obj-paste-display');
  assert('The selection bar shows Copy display and Paste display for images; Copy needs exactly one image, Paste needs something copied',
    !document.getElementById('sel-display').classList.contains('hidden') && copyBtn.disabled && pasteBtn.disabled && copyBtn.title.includes('LUT'));
  canvas.setActiveObject(three); canvas.fire('selection:created'); MFC.refreshSelectionBar();
  n = steps();
  copyBtn.click();
  assert('Copy display copies the channels\' LUT, range, gamma, invert and on/off, and brightness and contrast, without a History step',
    steps() === n && display.copiedDisplaySettings().channels.length === 3 && display.copiedDisplaySettings().brightness === 12 &&
    display.copiedDisplaySettings().channels[0].color === 'viridis' && !pasteBtn.disabled);

  canvas.setActiveObject(new fabric.ActiveSelection([two, four, eight], { canvas })); canvas.fire('selection:created'); MFC.refreshSelectionBar();
  n = steps();
  pasteBtn.click(); await idle();
  const same = (a, b) => a.color === b.color && a.min === b.min && a.max === b.max && (a.gamma || 1) === (b.gamma || 1) && !!a.invert === !!b.invert && a.enabled === b.enabled;
  const src = rawOf(three).channels;
  assert('Accept: Paste applies channel by number to every selected image, as one History step',
    steps() === n + 1 && same(rawOf(two).channels[0], src[0]) && same(rawOf(two).channels[1], src[1]) &&
    [0, 1, 2].every(i => same(rawOf(four).channels[i], src[i])) && rawOf(two).brightness === 12 && rawOf(four).contrast === -8);
  assert('A channel the copied image does not have is left as it was', JSON.stringify(rawOf(four).channels[3], (k, v) => (k === 'data' ? undefined : v)) === fourCh3);
  assert('An 8-bit image gets the LUT and gamma, with the range kept inside 0-255', rawOf(eight).channels[0].color === 'viridis' && rawOf(eight).channels[0].min === 100 && rawOf(eight).channels[0].max === 255);
  assert('Channel names are not pasted', rawOf(two).channels[0].name === 'Ch 1' && rawOf(four).channels[1].name === 'Ch 2');
  await MFC.undo(); await idle();
  const back = canvas.getObjects().filter(o => o.mfcType === 'mfcImage');
  assert('One undo takes the paste back from all three images', rawOf(back[1]).channels[0].color !== 'viridis' && rawOf(back[2]).channels[0].color !== 'viridis' &&
    rawOf(back[3]).channels[0].max === 255 && rawOf(back[3]).channels[0].color === 'grey' && rawOf(back[0]).channels[0].color === 'viridis');

  // ---- the context menu ----
  const [t3, t2] = back;
  canvas.discardActiveObject(); t2.set({ left: 600, top: 400 }); t2.setCoords(); canvas.requestRenderAll(); // clear of the other images
  const box = t2.getBoundingRect(), rect = canvas.upperCanvasEl.getBoundingClientRect();
  const at = { clientX: rect.left + box.left + box.width / 2, clientY: rect.top + box.top + box.height / 2, bubbles: true, cancelable: true, button: 2 };
  const ev = new MouseEvent('contextmenu', at);
  canvas.upperCanvasEl.dispatchEvent(ev);
  let menu = document.querySelector('.context-menu');
  const items = () => [...menu.querySelectorAll('.context-item')];
  assert('Right-clicking an image selects it and opens a menu with Copy and Paste display settings, instead of the browser\'s menu',
    ev.defaultPrevented && menu && canvas.getActiveObject() === t2 && items().map(b => b.textContent).join() === 'Copy display settings,Paste display settings' &&
    items().every(b => b.getAttribute('role') === 'menuitem' && b.title) && menu.getAttribute('role') === 'menu',
    [ev.defaultPrevented, !!menu, canvas.getActiveObject() && canvas.getActiveObject().mfcFileName].join());
  assert('The first item has the focus; the menu is inside the window', document.activeElement === items()[0] &&
    menu.getBoundingClientRect().right <= window.innerWidth && menu.getBoundingClientRect().bottom <= window.innerHeight);
  const key = (k, extra = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  const leftBefore = t2.left;
  key('ArrowDown');
  assert('Arrow keys move in the menu and do not move the image', document.activeElement === items()[1] && t2.left === leftBefore);
  key('Escape');
  assert('Escape closes the menu', !document.querySelector('.context-menu'));
  // Keyboard only: Shift+F10 on the selected image, then Enter on "Paste display settings".
  document.body.focus();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
  menu = document.querySelector('.context-menu');
  assert('Shift+F10 opens the same menu for the selected image', menu && document.activeElement === items()[0]);
  key('ArrowDown');
  n = steps();
  document.activeElement.click(); await idle(); // Enter or Space on a focused button is a click
  assert('Paste from the menu applies the copied settings in one History step and closes the menu',
    !document.querySelector('.context-menu') && steps() === n + 1 && same(rawOf(t2).channels[0], rawOf(t3).channels[0]),
    [!!document.querySelector('.context-menu'), steps() - n, JSON.stringify(rawOf(t2).channels[0], (k, v) => (k === 'data' ? undefined : v)), JSON.stringify(rawOf(t3).channels[0], (k, v) => (k === 'data' ? undefined : v))].join(' | '));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
  assert('The Menu key opens it too', !!document.querySelector('.context-menu'));
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  assert('Clicking elsewhere closes it', !document.querySelector('.context-menu'));
  canvas.discardActiveObject(); canvas.fire('selection:cleared');
  const empty = new MouseEvent('contextmenu', { ...at, clientX: rect.left + 2, clientY: rect.top + 2 });
  canvas.upperCanvasEl.dispatchEvent(empty);
  assert('Right-clicking an empty part of the canvas leaves the browser\'s own menu', !empty.defaultPrevented && !document.querySelector('.context-menu'));
  return { checks };
}

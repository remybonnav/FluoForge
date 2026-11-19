/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P2-T1: the compositor (js/image/composite-core.js, run in js/image/composite-worker.js).
   - 1:1 and enlarged composites against the compositor of v0.1.5 (legacyComposite below, copied
     unchanged from js/tiff.js at that version);
   - the 8 presets as 256 x 3 LUTs; gamma and invert; area averaging when shrinking (no moiré on a
     checkerboard) and nearest neighbour when enlarging, in the preview and in export;
   - worker and main-thread fallback give the same bytes; a display change sends no pixels;
   - a 4096 px, 4-channel image recomposites in under 100 ms off the main thread;
   - a slider drag gives one composite per animation frame;
   - the gamma and invert controls: keyboard, several images, history, save and reopen. */

/* ---- The compositor of FluoForge 0.1.5, unchanged: the reference for "identical to before". ---- */
function legacyComposite(imgData, scale, region = null, targetWidth = null, targetHeight = null) {
const COLOR_PRESETS = MFC_TIFF.COLOR_PRESETS;
  const srcW = imgData.width, srcH = imgData.height;
  const area = region || { x: 0, y: 0, width: srcW, height: srcH };
  const dstW = targetWidth || Math.max(1, Math.round(area.width * scale));
  const dstH = targetHeight || Math.max(1, Math.round(area.height * scale));
  const sourceX = x => Math.floor(area.x + x * area.width / dstW);
  const sourceY = y => Math.floor(area.y + y * area.height / dstH);

  const canvas = document.createElement('canvas');
  canvas.width = dstW; canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(dstW, dstH);
  const outData = out.data;

  // init alpha to 255, rgb to 0
  for (let i = 0; i < outData.length; i += 4) outData[i + 3] = 255;

  const activeChannels = imgData.channels.filter(c => c.enabled);
  for (const ch of activeChannels) {
    const [wr, wg, wb] = COLOR_PRESETS[ch.color] || COLOR_PRESETS.grey;
    const range = (ch.max - ch.min) || 1;
    const data = ch.data;

    for (let y = 0; y < dstH; y++) {
      const sy = sourceY(y);
      for (let x = 0; x < dstW; x++) {
        const sx = sourceX(x);
        if (sx < 0 || sy < 0 || sx >= srcW || sy >= srcH) { outData[(y * dstW + x) * 4 + 3] = 0; continue; }
        const v = data[sy * srcW + sx];
        let norm = (v - ch.min) / range;
        if (norm < 0) norm = 0; else if (norm > 1) norm = 1;
        const o = (y * dstW + x) * 4;
        if (wr) outData[o]     = Math.min(255, outData[o]     + norm * 255 * wr);
        if (wg) outData[o + 1] = Math.min(255, outData[o + 1] + norm * 255 * wg);
        if (wb) outData[o + 2] = Math.min(255, outData[o + 2] + norm * 255 * wb);
      }
    }
  }

  // Whole-image brightness/contrast tone curve — applied after channel compositing to
  // the already-blended RGB, so the same control works identically for TIFF composites
  // and RGB imports. contrast/brightness default to 0 (no-op) when unset, so existing
  // images/projects that predate this feature render exactly as before.
  const brightness = imgData.brightness || 0, contrast = imgData.contrast || 0;
  if (brightness !== 0 || contrast !== 0) {
    const contrastFactor = (100 + contrast) / 100; // 0 -> 1x (no change), 100 -> 2x, -100 -> 0x (flat grey)
    const brightnessOffset = brightness * 2.55;    // -100..100 -> roughly -255..255
    for (let i = 0; i < outData.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = (outData[i + c] - 128) * contrastFactor + 128 + brightnessOffset;
        outData[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }

  // Preserve real source transparency (e.g. PNG alpha) when present and enabled;
  // otherwise stays fully opaque (255, set above) same as every other image type.
  if (imgData.hasAlpha && imgData.alphaEnabled !== false && imgData.alphaData) {
    const alphaData = imgData.alphaData;
    for (let y = 0; y < dstH; y++) {
      const sy = sourceY(y);
      for (let x = 0; x < dstW; x++) {
        const sx = sourceX(x);
        if (sx < 0 || sy < 0 || sx >= srcW || sy >= srcH) { outData[(y * dstW + x) * 4 + 3] = 0; continue; }
        outData[(y * dstW + x) * 4 + 3] = alphaData[sy * srcW + sx];
      }
    }
  }

  ctx.putImageData(out, 0, 0);
  return canvas;
}


async function runCompositorRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail ? ': ' + detail : '')); checks.push(name); };
  const core = await import(new URL('js/image/composite-core.js', document.baseURI).href);
  const canvas = MFC.getCanvas();
  const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const compare = (a, b) => { let diff = 0, worst = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { diff++; worst = Math.max(worst, d); } } return { diff, worst, total: a.length }; };
  let seed = 7; const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const plane = (n, max, Type = Uint16Array) => { const p = new Type(n); for (let i = 0; i < n; i++) p[i] = Math.floor(random() * (max + 1)); return p; };
  const raw = (width, height, channels, extra = {}) => ({ width, height, brightness: 0, contrast: 0, ...extra,
    channels: channels.map((c, i) => ({ enabled: true, name: 'Ch ' + (i + 1), bitDepth: c.data.BYTES_PER_ELEMENT > 1 ? 16 : 8, ...c })) });
  const rgbaOf = async (r, scale, region, w, h) => pixels(await MFC_TIFF.composite(r, scale, region, w, h));
  const stdDev = (data, channel = 0) => { let s = 0, s2 = 0, n = 0; for (let i = channel; i < data.length; i += 4) { s += data[i]; s2 += data[i] * data[i]; n++; } const m = s / n; return { mean: m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)) }; };

  // ---- presets as LUTs ----
  const names = Object.keys(MFC_TIFF.COLOR_PRESETS);
  assert('The 8 presets are the same in the app and the compositor', names.length === 8 &&
    names.every(n => JSON.stringify(MFC_TIFF.COLOR_PRESETS[n]) === JSON.stringify(core.PRESETS[n])));
  const rounded = new Uint8ClampedArray(1);
  assert('Each preset is a generated 256 x 3 Uint8Array LUT', names.every(n => {
    const lut = core.presetLUT(n), w = core.PRESETS[n];
    if (!(lut instanceof Uint8Array) || lut.length !== 768) return false;
    for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) { rounded[0] = i * w[c]; if (lut[i * 3 + c] !== rounded[0]) return false; }
    return true;
  }));

  // ---- 1:1 against the previous compositor ----
  const W = 97, H = 61, N = W * H;
  for (const color of names) {
    const r = raw(W, H, [{ data: plane(N, 65535), color, min: 1200, max: 50000 }]);
    const result = compare(await rgbaOf(r, 1), pixels(legacyComposite(r, 1)));
    if (color === 'orange') assert(`16-bit orange: within 1 level of before (${result.diff} of ${result.total / 4 * 3} colour values differ)`, result.worst <= 1);
    else assert(`16-bit ${color}, one channel: pixel-identical to before`, result.diff === 0, JSON.stringify(result));
  }
  {
    const r = raw(W, H, [{ data: plane(N, 255, Uint8Array), color: 'red', min: 0, max: 255 }, { data: plane(N, 255, Uint8Array), color: 'green', min: 0, max: 255 },
      { data: plane(N, 255, Uint8Array), color: 'blue', min: 0, max: 255 }]);
    assert('8-bit RGB (a PNG or JPEG import): pixel-identical to before', compare(await rgbaOf(r, 1), pixels(legacyComposite(r, 1))).diff === 0);
    const alphaData = plane(N, 255, Uint8Array);
    const withAlpha = { ...r, hasAlpha: true, alphaData, alphaEnabled: true };
    assert('8-bit RGB with transparency: pixel-identical to before', compare(await rgbaOf(withAlpha, 1), pixels(legacyComposite(withAlpha, 1))).diff === 0);
    const toned = { ...r, brightness: 23, contrast: -17 };
    assert('Brightness and contrast: pixel-identical to before', compare(await rgbaOf(toned, 1), pixels(legacyComposite(toned, 1))).diff === 0);
    const region = { x: 10, y: 7, width: 40, height: 30 };
    assert('A cropped region at 1:1: pixel-identical to before', compare(await rgbaOf(r, 1, region, 40, 30), pixels(legacyComposite(r, 1, region, 40, 30))).diff === 0);
    assert('An enlarged region (nearest neighbour): pixel-identical to before', compare(await rgbaOf(r, 1, region, 120, 75), pixels(legacyComposite(r, 1, region, 120, 75))).diff === 0);
  }
  {
    const r = raw(W, H, ['grey', 'red', 'green', 'magenta'].map((color, i) => ({ data: plane(N, 65535), color, min: 500 * i, max: 40000 + 5000 * i })));
    const result = compare(await rgbaOf(r, 1), pixels(legacyComposite(r, 1)));
    assert(`16-bit, 4 overlapping channels: within 1 level of before (${result.diff} of ${result.total / 4 * 3} colour values differ, at rounding ties)`, result.worst <= 1);
  }

  // ---- gamma and invert ----
  {
    const ramp = new Uint8Array(256).map((_, i) => i);
    const out = await rgbaOf(raw(256, 1, [{ data: ramp, color: 'grey', min: 0, max: 255, gamma: 2 }]), 1);
    const expect = v => { rounded[0] = Math.pow(v / 255, 2) * 255; return rounded[0]; };
    assert('Gamma 2 maps each value v to 255 (v/255)^2', [0, 64, 128, 200, 255].every(v => out[v * 4] === expect(v)));
    const inv = await rgbaOf(raw(256, 1, [{ data: ramp, color: 'grey', min: 0, max: 255, invert: true }]), 1);
    assert('Invert maps v to 255 - v', [0, 1, 100, 254, 255].every(v => inv[v * 4] === 255 - v));
    const both = await rgbaOf(raw(256, 1, [{ data: ramp, color: 'green', min: 0, max: 255, gamma: 0.5, invert: true }]), 1);
    rounded[0] = (1 - Math.sqrt(100 / 255)) * 255;
    assert('Gamma is applied before invert, and the colour LUT after both', both[100 * 4 + 1] === rounded[0] && both[100 * 4] === 0);
    const r = raw(3, 1, [{ data: new Uint16Array([0, 1000, 2000]), color: 'grey', min: 0, max: 2000, gamma: 1, invert: false }]);
    assert('Gamma 1 and no invert are exactly the default display', compare(await rgbaOf(r, 1), pixels(legacyComposite(r, 1))).diff === 0);
  }

  // ---- resizing ----
  const checker = (size, cell = 1) => { const p = new Uint8Array(size * size); for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) p[y * size + x] = ((Math.floor(x / cell) + Math.floor(y / cell)) % 2) * 255; return p; };
  {
    const r = raw(512, 512, [{ data: checker(512), color: 'grey', min: 0, max: 255 }]);
    const shrunk = stdDev(await rgbaOf(r, 157 / 512)), nearest = stdDev(pixels(legacyComposite(r, 157 / 512)));
    // An area average at a non-integer ratio leaves a faint residue; moiré is the full-contrast
    // pattern nearest neighbour gives. Limit: under 3 % of the checkerboard's contrast (127.5).
    assert(`A 1-pixel checkerboard shrunk to 157 px is even grey, no moiré: mean ${shrunk.mean.toFixed(1)}, spread ${shrunk.sd.toFixed(2)} ` +
      `(${(shrunk.sd / 127.5 * 100).toFixed(1)} % of the contrast; nearest neighbour: ${(nearest.sd / 127.5 * 100).toFixed(0)} %)`,
      Math.abs(shrunk.mean - 127.5) < 1.5 && shrunk.sd < 0.03 * 127.5 && nearest.sd > 0.3 * 127.5);
    // Other shrink factors of 2x or more: even grey with the right mean (nearest neighbour gives
    // pure black or white at 0.5 and 0.25, or a full-contrast pattern).
    const ratios = [];
    for (const ratio of [0.5, 0.25, 0.2, 0.41]) {
      const a = stdDev(await rgbaOf(r, ratio)), b = stdDev(pixels(legacyComposite(r, ratio)));
      ratios.push(`${ratio}: ${(a.sd / 127.5 * 100).toFixed(1)} % (nearest ${(b.sd / 127.5 * 100).toFixed(0)} %, mean ${b.mean.toFixed(0)})`);
      if (!(Math.abs(a.mean - 127.5) < 1.5 && a.sd < 0.03 * 127.5)) throw new Error('Shrinking the checkerboard by ' + ratio + ' leaves a pattern: ' + ratios.at(-1));
    }
    checks.push('Shrunk by 2x or more, the checkerboard is even grey with the right mean: ' + ratios.join('; '));
    // Recorded, not a pass/fail limit: a box filter shrinking by less than 2x leaves a weaker beat.
    const mild = stdDev(await rgbaOf(r, 0.77)), mildNearest = stdDev(pixels(legacyComposite(r, 0.77)));
    checks.push(`For the record, shrunk by 0.77 the residue is ${(mild.sd / 127.5 * 100).toFixed(0)} % of the contrast (nearest neighbour: ${(mildNearest.sd / 127.5 * 100).toFixed(0)} %)`);
    const tiny = raw(4, 4, [{ data: new Uint16Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]), color: 'grey', min: 0, max: 255 }]);
    assert('Shrinking by 2 averages each 2 x 2 block of raw values before the display mapping', [...(await rgbaOf(tiny, 0.5))].filter((_, i) => i % 4 === 0).join() === '25,45,105,125');
    const up = await rgbaOf(raw(2, 1, [{ data: new Uint8Array([10, 200]), color: 'grey', min: 0, max: 255 }]), 1, null, 6, 2);
    assert('Enlarging keeps each source pixel as a block (nearest neighbour)', [...up].filter((_, i) => i % 4 === 0).join() === '10,10,10,200,200,200,10,10,10,200,200,200');
  }

  // ---- worker, fallback and the preview cache ----
  assert('Compositing runs in a worker', MFC_TIFF.workerActive);
  {
    const r = raw(300, 200, ['red', 'cyan'].map(color => ({ data: plane(60000, 65535), color, min: 100, max: 60000, gamma: 1.4 })));
    const inWorker = await rgbaOf(r, 0.43);
    MFC_TIFF.useWorker = false;
    const before = MFC_TIFF.stats.mainThreadComposites;
    let onMain;
    try { onMain = await rgbaOf(r, 0.43); } finally { MFC_TIFF.useWorker = true; }
    assert('Without a worker the same composite is made on the main thread, byte for byte', MFC_TIFF.stats.mainThreadComposites === before + 1 && compare(inWorker, onMain).diff === 0);
    await MFC_TIFF.composite(r, 0.43, null, null, null, { cache: true });
    const sent = MFC_TIFF.stats.planesSent;
    r.channels[0].max = 30000; r.channels[1].invert = true;
    await MFC_TIFF.composite(r, 0.43, null, null, null, { cache: true });
    assert('Changing the display of a cached preview sends no pixels to the worker', MFC_TIFF.stats.planesSent === sent);
  }

  // ---- speed: a 4096 px, 4-channel, 16-bit image ----
  {
    const S = 4096, n = S * S;
    const channels = ['grey', 'red', 'green', 'blue'].map((color, c) => { const d = new Uint16Array(n); for (let i = 0; i < n; i++) d[i] = (i * (c + 3) + (i >> 12) * 7) & 0xffff; return { data: d, color, min: 0, max: 65535 }; });
    const big = raw(S, S, channels);
    const scale = MFC_TIFF.workingScale(S, S);
    let t = performance.now();
    await MFC_TIFF.composite(big, scale, null, null, null, { cache: true });
    const first = performance.now() - t;
    const times = [], workerTimes = [];
    for (let k = 0; k < 7; k++) {
      big.channels[k % 4].max = 60000 - k * 1000;
      t = performance.now(); await MFC_TIFF.composite(big, scale, null, null, null, { cache: true }); times.push(performance.now() - t);
      workerTimes.push(MFC_TIFF.stats.lastWorkerMs);
    }
    // Main thread, measured separately (a busy timer loop would slow the timing above): the
    // longest gap between timer ticks while the workers composite.
    let longest = 0, last = performance.now(), ticking = true;
    const tick = () => { if (!ticking) return; const now = performance.now(); longest = Math.max(longest, now - last); last = now; setTimeout(tick, 0); };
    setTimeout(tick, 0);
    for (let k = 0; k < 4; k++) { big.channels[k].gamma = 1 + k / 10; await MFC_TIFF.composite(big, scale, null, null, null, { cache: true }); }
    ticking = false;
    times.sort((a, b) => a - b);
    const median = times[3];
    t = performance.now(); await MFC_TIFF.composite(big, 1); const full = performance.now() - t;
    assert(`A 4096 px, 4-channel image recomposites in under 100 ms after a display change (median ${median.toFixed(0)} ms for the 2048 px preview; ` +
      `first composite ${first.toFixed(0)} ms, full 4096 px ${full.toFixed(0)} ms)`, median < 100, times.map(x => x.toFixed(0)).join(', ') + ' | in the workers: ' + workerTimes.map(x => x.toFixed(0)).join(', ') + ' | ' + MFC_TIFF.workerCount + ' workers');
    assert(`The main thread stays free while the worker composites (longest pause ${longest.toFixed(0)} ms)`, longest < 50);
  }

  // ---- the editor: one composite per frame, and the gamma / invert controls ----
  await MFC_PROJECT.createProject({ name: 'compositor', width: 800, height: 600, unit: 'px', dpi: 300 });
  const png = async (name, fill) => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const g = c.getContext('2d'); g.fillStyle = fill; g.fillRect(0, 0, 64, 48); g.fillStyle = '#808080'; g.fillRect(16, 12, 32, 24); return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name, { type: 'image/png' }); };
  await MFC.importFiles([await png('a.png', '#204080'), await png('b.png', '#802040')]);
  const [imgA, imgB] = canvas.getObjects().filter(o => o.mfcType === 'mfcImage');
  canvas.setActiveObject(imgA); MFC.refreshChannelPanel();
  await MFC_TIFF.whenIdle();
  {
    const real = MFC_TIFF.composite; let calls = 0;
    MFC_TIFF.composite = (...args) => { calls++; return real(...args); };
    try {
      const slider = document.querySelector('#channel-list .channel-row .ch-max');
      for (let v = 250; v > 200; v -= 2) { slider.value = v; slider.dispatchEvent(new Event('input', { bubbles: true })); }
      await MFC_TIFF.whenIdle();
    } finally { MFC_TIFF.composite = real; }
    assert(`25 slider input events in one frame give one composite (${calls})`, calls === 1);
    const shown = pixels(imgA.getElement()), expected = pixels(legacyComposite(MFC.getRegistry()[imgA.mfcId].rawImage, 1));
    assert('…made with the last value', compare(shown, expected).diff === 0);
  }
  {
    const row = () => document.querySelector('#channel-list .channel-row');
    const gamma = row().querySelector('.ch-gamma'), invert = row().querySelector('.ch-invert');
    assert('Each channel has a gamma field and an invert box with explanations', gamma && invert && gamma.title.includes('Gamma') && invert.closest('label').title.includes('Invert') &&
      gamma.type === 'number' && gamma.min === '0.1' && gamma.max === '5' && gamma.value === '1' && !invert.checked);
    canvas.setActiveObject(new fabric.ActiveSelection([imgA, imgB], { canvas })); MFC.refreshChannelPanel();
    const historyBefore = MFC.getHistory().labels.length;
    const g = row().querySelector('.ch-gamma'); g.focus(); g.value = '2.25'; g.dispatchEvent(new Event('input', { bubbles: true })); g.dispatchEvent(new Event('change', { bubbles: true }));
    await MFC_TIFF.whenIdle();
    const chA = () => MFC.getRegistry()[imgA.mfcId].rawImage.channels[0], chB = () => MFC.getRegistry()[imgB.mfcId].rawImage.channels[0];
    assert('Typing a gamma applies it to that channel of every selected image, as one history step', chA().gamma === 2.25 && chB().gamma === 2.25 && MFC.getHistory().labels.length === historyBefore + 1);
    const out = row().querySelector('.ch-gamma'); out.value = '9'; out.dispatchEvent(new Event('change', { bubbles: true }));
    assert('A gamma out of range is clamped to 0.1 to 5', chA().gamma === 5 && row().querySelector('.ch-gamma').value === '5');
    out.value = '2.25'; out.dispatchEvent(new Event('change', { bubbles: true }));
    const inv = row().querySelector('.ch-invert'); inv.click();
    await MFC_TIFF.whenIdle();
    assert('The invert box (keyboard: Space) inverts that channel on every selected image', chA().invert === true && chB().invert === true);
    const shown = pixels(imgA.getElement()), expected = pixels(await MFC_TIFF.composite(MFC.getRegistry()[imgA.mfcId].rawImage, 1));
    assert('The panel shows the image with gamma and invert applied', compare(shown, expected).diff === 0 && compare(shown, pixels(legacyComposite(MFC.getRegistry()[imgA.mfcId].rawImage, 1))).diff > 0);
    const state = MFC_PROJECT.captureState();
    const saved = state.objects.filter(o => o.mfcType === 'mfcImage').map(o => o.display.channels[0]);
    assert('Gamma and invert are saved with the project (schema 2 or later)', state.schema >= 2 && saved.every(c => c.gamma === 2.25 && c.invert === true));
    await MFC.undo(); await MFC_TIFF.whenIdle();
    assert('Undo restores the previous invert', MFC.getRegistry()[canvas.getObjects().find(o => o.mfcType === 'mfcImage').mfcId].rawImage.channels[0].invert === false);
    await MFC_PROJECT.restoreState(state, { resetHistory: false }); await MFC_TIFF.whenIdle();
    assert('A reopened state shows gamma and invert', canvas.getObjects().filter(o => o.mfcType === 'mfcImage').every(o => { const c = MFC.getRegistry()[o.mfcId].rawImage.channels[0]; return c.gamma === 2.25 && c.invert; }));
  }

  // ---- export: shrunk panels are area-averaged ----
  {
    await MFC_PROJECT.createProject({ name: 'export', width: 400, height: 400, unit: 'px', dpi: 300 });
    const size = 300, data = checker(size);
    const rgb = new Uint8ClampedArray(size * size * 4); for (let i = 0; i < size * size; i++) { rgb[i * 4] = rgb[i * 4 + 1] = rgb[i * 4 + 2] = data[i]; rgb[i * 4 + 3] = 255; }
    const c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').putImageData(new ImageData(rgb, size, size), 0, 0);
    await MFC.importFiles([new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'checker.png', { type: 'image/png' })]);
    const img = canvas.getObjects().find(o => o.mfcType === 'mfcImage');
    img.set({ left: 20, top: 20, scaleX: 0.31, scaleY: 0.31 }); img.setCoords(); await MFC_TIFF.whenIdle();
    const svg = (await MFC_EXPORT.buildSVG()).svg;
    const href = svg.match(/xlink:href="(data:image\/png[^"]+)"/)[1];
    const embedded = new Image(); embedded.src = href; await embedded.decode();
    const e = document.createElement('canvas'); e.width = embedded.naturalWidth; e.height = embedded.naturalHeight; e.getContext('2d').drawImage(embedded, 0, 0);
    const s = stdDev(pixels(e));
    assert(`A checkerboard panel printed at 31 % is exported area-averaged at ${e.width} px: even grey, residue ${(s.sd / 127.5 * 100).toFixed(1)} % of the contrast`,
      e.width === Math.ceil(size * 0.31) && Math.abs(s.mean - 127.5) < 1.5 && s.sd < 0.03 * 127.5);
  }
  return { checks };
}

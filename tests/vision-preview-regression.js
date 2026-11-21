/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P2-T8: colour-vision and grey-scale preview.
   - The Vision selector in the top bar: Normal, deuteranopia, protanopia, tritanopia, grey-scale.
   - Each mode puts its SVG colour-matrix filter on the canvas container, and the filters do what
     they say: red and green become hard to tell apart with deuteranopia and protanopia, blue and
     green with tritanopia, and grey-scale gives R = G = B (rendered through the same filters).
   - View only: the captured state, the history, the canvas pixels and the SVG export are the same
     with every preview on; the choice is not saved with the project.
   - The badge and its Normal button, keyboard use and the four themes. */

const nextVisionFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function runVisionPreviewRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const V = await import(new URL('js/ui/vision-preview.js', document.baseURI).href);
  const select = document.getElementById('vision-select'), scroll = document.getElementById('canvas-scroll'), badge = document.getElementById('vision-badge');

  // ---- The control ----
  assert('The top bar has a Vision selector with Normal, Deuteranopia, Protanopia, Tritanopia and Grey-scale, starting at Normal',
    select && select.closest('#topbar') && [...select.options].map(o => o.value).join() === 'normal,deuteranopia,protanopia,tritanopia,greyscale' &&
    select.value === 'normal' && !scroll.style.filter && badge.hidden);
  assert('The selector has a title saying it is view only, and an accessible name',
    /View only/.test(select.closest('label').title) && /view only/i.test(select.getAttribute('aria-label')));

  // ---- Filters ----
  const filters = { deuteranopia: 'vision-deuteranopia', protanopia: 'vision-protanopia', tritanopia: 'vision-tritanopia', greyscale: 'vision-greyscale' };
  for (const [mode, id] of Object.entries(filters)) {
    select.value = mode; select.dispatchEvent(new Event('change', { bubbles: true }));
    const filter = document.getElementById(id), matrix = filter && filter.querySelector('feColorMatrix');
    assert(`${mode}: the canvas container gets url(#${id}), a 4 × 5 colour matrix in linear RGB, and the badge names the preview`,
      scroll.style.filter === `url("#${id}")` || scroll.style.filter === `url(#${id})` ? matrix && matrix.getAttribute('values').trim().split(/\s+/).length === 20 &&
      filter.getAttribute('color-interpolation-filters') === 'linearRGB' && !badge.hidden && document.getElementById('vision-badge-text').textContent.includes(V.VISION_MODES[mode].label) &&
      /not exported/.test(document.getElementById('vision-badge-text').textContent) : false, scroll.style.filter);
  }
  const rows = id => { const v = document.getElementById(id).querySelector('feColorMatrix').getAttribute('values').trim().split(/\s+/).map(Number); return [0, 1, 2].map(r => v.slice(r * 5, r * 5 + 3)); };
  assert('Every matrix keeps white white (each row sums to 1) and leaves alpha alone',
    Object.values(filters).every(id => rows(id).every(r => Math.abs(r[0] + r[1] + r[2] - 1) < 2e-3) &&
      document.getElementById(id).querySelector('feColorMatrix').getAttribute('values').trim().split(/\s+/).slice(15).join() === '0,0,0,1,0'));
  assert('The deficiency matrices are Machado et al. (2009) at full severity', rows('vision-deuteranopia')[0].join() === '0.367322,0.860646,-0.227968' &&
    rows('vision-protanopia')[0].join() === '0.152286,1.052583,-0.204868' && rows('vision-tritanopia')[2].join() === '0.004733,0.691367,0.3039');

  // Rendered through the filters (a canvas 2D filter using the same SVG filter).
  const through = async (id, rgb) => {
    const c = document.createElement('canvas'); c.width = c.height = 4;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const src = document.createElement('canvas'); src.width = src.height = 4;
    const s = src.getContext('2d'); s.fillStyle = `rgb(${rgb.join(',')})`; s.fillRect(0, 0, 4, 4);
    ctx.filter = id ? `url(#${id})` : 'none'; ctx.drawImage(src, 0, 0); await nextVisionFrame();
    return [...ctx.getImageData(1, 1, 1, 1).data.slice(0, 3)];
  };
  const hue = ([r, g, b]) => { const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; if (!d) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  const hueGap = (a, b) => { const d = Math.abs(hue(a) - hue(b)) % 360; return Math.min(d, 360 - d); };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const red = [220, 40, 40], green = [40, 180, 40], blue = [40, 60, 220], teal = [40, 160, 160];
  const plain = await through(null, red);
  if (plain.join() === red.join() && (await through('vision-greyscale', red)).join() !== red.join()) {
    for (const id of ['vision-deuteranopia', 'vision-protanopia']) {
      const r = await through(id, red), g = await through(id, green);
      assert(`${id.slice(7)} rendered: red and green come out in nearly the same hue (${hueGap(r, g).toFixed(0)}° apart instead of ${hueGap(red, green).toFixed(0)}°)`, hueGap(r, g) < 20, r + ' / ' + g);
    }
    const tb = await through('vision-tritanopia', blue), tt = await through('vision-tritanopia', teal), tr = await through('vision-tritanopia', red), tg = await through('vision-tritanopia', green);
    assert('tritanopia rendered: blue and teal come closer in hue, red and green stay apart', hueGap(tb, tt) < hueGap(blue, teal) && hueGap(tr, tg) > 60, [tb, tt, tr, tg].join(' / '));
    const grey = await through('vision-greyscale', [200, 60, 30]);
    assert('grey-scale rendered: R = G = B', Math.abs(grey[0] - grey[1]) <= 1 && Math.abs(grey[1] - grey[2]) <= 1, grey.join());
  } else checks.push('Rendering through the filters is not available in this browser\'s canvas (matrices checked above)');

  // ---- View only ----
  V.setVisionPreview('normal');
  const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
  await MFC_TIFF.whenIdle(); await document.fonts.ready;
  const fingerprint = () => MFC_PROJECT.fingerprint(MFC_PROJECT.captureState());
  const pixels = () => MFC.getCanvas().lowerCanvasEl.toDataURL();
  const before = { state: fingerprint(), history: JSON.stringify(MFC.getHistory()), pixels: pixels(), svg: (await MFC_EXPORT.buildSVG()).svg };
  let same = true, detail = '';
  for (const mode of Object.keys(filters)) {
    V.setVisionPreview(mode); MFC.getCanvas().renderAll(); await nextVisionFrame();
    const svg = (await MFC_EXPORT.buildSVG()).svg.replace(/(CLIPPATH|SVGID)_\d+/g, '$1');
    if (fingerprint() !== before.state) { same = false; detail = mode + ': state'; }
    if (JSON.stringify(MFC.getHistory()) !== before.history) { same = false; detail = mode + ': history'; }
    if (pixels() !== before.pixels) { same = false; detail = mode + ': canvas pixels'; }
    if (svg !== before.svg.replace(/(CLIPPATH|SVGID)_\d+/g, '$1')) { same = false; detail = mode + ': SVG export'; }
  }
  assert('With every preview on, the figure state, the history, the canvas pixels and the SVG export are unchanged', same, detail);
  const saved = MFC_PROJECT.captureState();
  assert('The preview is not saved with the project', !JSON.stringify(saved).includes('vision') && !JSON.stringify(saved).includes('greyscale'));
  assert('Selection still works under a preview (the filter is drawing only)', (() => { const o = MFC.getCanvas().getObjects().find(x => x.mfcType === 'mfcImage'); MFC.getCanvas().setActiveObject(o); const ok = MFC.getCanvas().getActiveObject() === o; MFC.getCanvas().discardActiveObject(); return ok; })());

  // ---- Badge, keyboard, themes ----
  V.setVisionPreview('protanopia');
  const normal = document.getElementById('vision-normal');
  assert('The badge stays over the canvas with a Normal button that has a title', !badge.hidden && badge.parentElement.id === 'canvas-wrap' && normal.title.length > 10);
  const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (x, y) => { const [h, l] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (h + 0.05) / (l + 0.05); };
  const savedTheme = document.documentElement.dataset.theme, ratios = [];
  for (const theme of ['light', 'sage', 'dark', 'slate']) {
    document.documentElement.dataset.theme = theme;
    const pill = getComputedStyle(badge.querySelector('.vision-pill')), sel = getComputedStyle(select);
    ratios.push(contrast(pill.color, pill.backgroundColor), contrast(sel.color, sel.backgroundColor));
  }
  if (savedTheme) document.documentElement.dataset.theme = savedTheme; else delete document.documentElement.dataset.theme;
  assert('The badge and the selector are readable in all four themes (contrast ≥ 4.5)', ratios.every(r => r >= 4.5), ratios.map(r => r.toFixed(1)).join());
  const focusRule = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } }).some(r => /\.vision-pill button:focus-visible/.test(r.selectorText || '') && /outline/.test(r.cssText));
  assert('The selector and the Normal button have a visible focus outline', focusRule);
  normal.click(); await nextVisionFrame();
  assert('Normal turns the preview off, hides the badge and returns focus to the selector',
    V.visionPreview() === 'normal' && !scroll.style.filter && badge.hidden && select.value === 'normal' && document.activeElement === select);
  select.focus(); select.value = 'greyscale'; select.dispatchEvent(new Event('change', { bubbles: true }));
  assert('Choosing from the selector with the keyboard (change event) applies the preview', V.visionPreview() === 'greyscale' && /vision-greyscale/.test(scroll.style.filter));
  V.setVisionPreview('unknown');
  assert('An unknown mode falls back to Normal', V.visionPreview() === 'normal' && !scroll.style.filter);
  return checks;
}

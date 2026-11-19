/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P2-T2: the LUT library and the calibration bar.
   - the 14 LUTs (sizes, groups, published endpoints, Fire as ImageJ interpolates it);
   - ImageJ files: a LUT is matched in full against the library, and one that matches nothing is kept
     ("From file") with its 768 bytes, saved in the project;
   - the LUT popover with the mouse and the keyboard;
   - acceptance: a single-channel image in viridis with a calibration bar survives save, load, undo
     and the SVG, PDF and TIFF exports; the bar follows its channel's range and LUT. */
async function runLutCalibrationRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail ? ': ' + detail : '')); checks.push(name); };
  const load = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Cannot load ' + src)); document.head.append(s); });
  await load('tests/reference-check.js?run=' + Date.now());
  const luts = await import(new URL('js/image/luts.js', document.baseURI).href);
  const canvas = MFC.getCanvas();
  const rgb = (lut, i) => [lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]].join();
  const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

  // ---- the library ----
  assert('The library has the 14 LUTs of the roadmap, in three groups',
    JSON.stringify(luts.LUT_GROUPS.map(g => g.name)) === '["Colour-blind safe","Classic","Intensity"]' &&
    luts.LUT_NAMES.join() === 'viridis,cividis,magma,inferno,grey,red,green,blue,cyan,magenta,yellow,orange,fire,grey-inverted');
  assert('Every LUT is a 256 x 3 Uint8Array', luts.LUT_NAMES.every(n => { const l = luts.namedLUT(n); return l instanceof Uint8Array && l.length === 768; }));
  const ends = { viridis: ['68,1,84', '253,231,37'], magma: ['0,0,4', '252,253,191'], inferno: ['0,0,4', '252,255,164'], cividis: ['0,34,78', '254,232,56'] };
  assert('viridis, magma, inferno and cividis have matplotlib\'s first and last colours',
    Object.entries(ends).every(([n, [a, b]]) => rgb(luts.namedLUT(n), 0) === a && rgb(luts.namedLUT(n), 255) === b));
  const fire = luts.namedLUT('fire');
  // ImageJ LutLoader.fire(): 32 points, entry i interpolated at i * 32 / 256 and truncated.
  assert('Fire is ImageJ\'s: black, 69 blue at entry 10, control point 16 (240,79,0) at entry 128, white at the end', rgb(fire, 0) === '0,0,0' && fire[10 * 3 + 2] === 69 && rgb(fire, 255) === '255,255,255' && rgb(fire, 128) === '240,79,0');
  assert('Inverted grey runs from white to black', rgb(luts.namedLUT('grey-inverted'), 0) === '255,255,255' && rgb(luts.namedLUT('grey-inverted'), 200) === '55,55,55');
  assert('The 8 single colours are straight ramps (orange is half green)', rgb(luts.namedLUT('red'), 200) === '200,0,0' && rgb(luts.namedLUT('orange'), 200) === '200,100,0');

  // ---- ImageJ files ----
  // A 16-bit ImageJ TIFF whose first IFD carries IJMetadata (tags 50838/50839) with a 'luts' block:
  // one 768-byte LUT per channel, stored as ImageJ does (256 reds, 256 greens, 256 blues).
  const planar = lut => { const p = new Uint8Array(768); for (let i = 0; i < 256; i++) { p[i] = lut[i * 3]; p[256 + i] = lut[i * 3 + 1]; p[512 + i] = lut[i * 3 + 2]; } return p; };
  const imagejTiff = (name, pages, w, h, channelLuts) => {
    const desc = new TextEncoder().encode(`ImageJ=1.54p\nimages=${pages.length}\nchannels=${pages.length}\nmode=composite\n\0`);
    const header = new Uint8Array(4 + 8); header.set([73, 74, 73, 74]); header.set([108, 117, 116, 115], 4); // "IJIJ", "luts"
    new DataView(header.buffer).setInt32(8, channelLuts.length, false);
    const meta = new Uint8Array(header.length + 768 * channelLuts.length); meta.set(header);
    channelLuts.forEach((l, i) => meta.set(planar(l), header.length + i * 768));
    const counts = [header.length, ...channelLuts.map(() => 768)];
    const tags0 = 12, tags = 10, planeBytes = w * h * 2;
    let size = 8 + desc.length; const metaAt = size; size += meta.length; const countsAt = size; size += counts.length * 4;
    const layout = pages.map((_, i) => { const n = i === 0 ? tags0 : tags; const ifd = size; size += 2 + n * 12 + 4; const data = size; size += planeBytes; return { ifd, data, n }; });
    const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
    u8.set([0x4d, 0x4d]); dv.setUint16(2, 42); dv.setUint32(4, layout[0].ifd); // big-endian, like ImageJ
    u8.set(desc, 8); u8.set(meta, metaAt); counts.forEach((c, i) => dv.setUint32(countsAt + i * 4, c));
    pages.forEach((page, i) => {
      const { ifd, data, n } = layout[i]; let p = ifd; dv.setUint16(p, n); p += 2;
      const tag = (id, type, count, value) => { dv.setUint16(p, id); dv.setUint16(p + 2, type); dv.setUint32(p + 4, count); if (type === 3 && count === 1) dv.setUint16(p + 8, value); else dv.setUint32(p + 8, value); p += 12; };
      tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 16); tag(259, 3, 1, 1); tag(262, 3, 1, 1); tag(270, 2, desc.length, 8);
      tag(273, 4, 1, data); tag(277, 3, 1, 1); tag(278, 4, 1, h); tag(279, 4, 1, planeBytes);
      if (i === 0) { tag(50838, 4, counts.length, countsAt); tag(50839, 1, meta.length, metaAt); }
      dv.setUint32(p, i + 1 < pages.length ? layout[i + 1].ifd : 0);
      for (let k = 0; k < w * h; k++) dv.setUint16(data + k * 2, page[k]);
    });
    return new File([buf], name, { type: 'image/tiff' });
  };
  const W = 64, H = 48, ramp = Array.from({ length: W * H }, (_, k) => Math.round(k / (W * H - 1) * 4000));
  const custom = new Uint8Array(768); for (let i = 0; i < 256; i++) { custom[i * 3] = (i * 7) & 255; custom[i * 3 + 1] = 255 - i; custom[i * 3 + 2] = (i * i) >> 8; }
  const viridisNoisy = luts.namedLUT('viridis').map((v, k) => Math.max(0, Math.min(255, v + ((k % 3) - 1) * 2)));
  const four = await MFC_TIFF.decodeFile(imagejTiff('four.tif', [ramp, ramp, ramp, ramp], W, H, [luts.namedLUT('red'), fire, custom, viridisNoisy]));
  assert('An ImageJ red LUT, Fire, and viridis written with small rounding differences are recognised',
    four.channels[0].color === 'red' && four.channels[1].color === 'fire' && four.channels[3].color === 'viridis', four.channels.map(c => c.color).join());
  const keptBytes = luts.base64ToBytes(four.channels[2].lut);
  assert('A LUT that matches nothing is kept as "From file", with its 768 bytes in the right order',
    four.channels[2].color === 'file' && keptBytes.length === 768 && keptBytes.every((v, k) => v === custom[k]));
  assert('Image info says where each colour came from', four.meta.decodeInfo.channels[2].colorSource.includes('From file') && four.meta.decodeInfo.channels[0].colorSource === 'ImageJ LUT');

  // A "From file" channel is composited through its own table.
  {
    const raw = { width: 256, height: 1, brightness: 0, contrast: 0, channels: [{ data: Uint8Array.from({ length: 256 }, (_, i) => i), enabled: true, bitDepth: 8, min: 0, max: 255, color: 'file', lut: four.channels[2].lut }] };
    const px = (await MFC_TIFF.composite(raw, 1)).getContext('2d').getImageData(0, 0, 256, 1).data;
    assert('A "From file" channel is composited through the kept table', [0, 37, 128, 255].every(i => px[i * 4] === custom[i * 3] && px[i * 4 + 1] === custom[i * 3 + 1] && px[i * 4 + 2] === custom[i * 3 + 2]));
    raw.channels[0].color = 'viridis';
    const v = (await MFC_TIFF.composite(raw, 1)).getContext('2d').getImageData(0, 0, 256, 1).data, vl = luts.namedLUT('viridis');
    assert('A viridis channel shows exactly viridis from min to max', [0, 1, 100, 254, 255].every(i => v[i * 4] === vl[i * 3] && v[i * 4 + 1] === vl[i * 3 + 1] && v[i * 4 + 2] === vl[i * 3 + 2]));
  }

  // ---- the LUT popover ----
  // A real click gives the page focus first; the test runs in an iframe, so focus it explicitly (Firefox needs this).
  window.focus();
  await MFC_PROJECT.createProject({ name: 'lut', width: 900, height: 600, unit: 'px', dpi: 300 });
  await MFC.importFiles([imagejTiff('four.tif', [ramp, ramp, ramp, ramp], W, H, [luts.namedLUT('red'), fire, custom, viridisNoisy])]);
  await MFC_TIFF.whenIdle();
  const img4 = canvas.getActiveObject(), raw4 = () => MFC.getRegistry()[img4.mfcId].rawImage;
  const rows = () => [...document.querySelectorAll('#channel-list .channel-row')];
  const lutButton = i => rows()[i].querySelector('.ch-lut');
  assert('Each channel shows its LUT as a gradient button with a name and an explanation',
    lutButton(1).querySelector('.lut-name').textContent === 'Fire' && lutButton(2).querySelector('.lut-name').textContent === 'From file' &&
    lutButton(1).title.includes('LUT') && /linear-gradient/.test(lutButton(1).querySelector('.lut-swatch').style.background));
  lutButton(0).click();
  let popover = document.querySelector('.lut-popover');
  assert('Clicking the button opens the popover, grouped as Colour-blind safe, Classic and Intensity, with 14 gradients',
    popover && [...popover.querySelectorAll('.lut-group-title')].map(t => t.textContent).join() === 'Colour-blind safe,Classic,Intensity' &&
    popover.querySelectorAll('.lut-option').length === 14 && lutButton(0).getAttribute('aria-expanded') === 'true');
  assert('The current LUT is marked and has the focus', document.activeElement === popover.querySelector('.lut-option[data-lut="red"]') &&
    popover.querySelector('.lut-option[data-lut="red"]').getAttribute('aria-pressed') === 'true');
  const key = k => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  key('ArrowDown');
  assert('Arrow keys move between LUTs', document.activeElement.dataset.lut === 'green');
  key('Escape');
  assert('Escape closes the popover and gives the focus back to the button', !document.querySelector('.lut-popover') && document.activeElement === lutButton(0) && raw4().channels[0].color === 'red');
  const steps = MFC.getHistory().labels.length;
  lutButton(0).click(); key('Home'); document.activeElement.click();
  await MFC_TIFF.whenIdle();
  assert('Choosing a LUT (Enter or a click) applies it as one history step', raw4().channels[0].color === 'viridis' && MFC.getHistory().labels.length === steps + 1 && !document.querySelector('.lut-popover'));
  lutButton(2).click();
  popover = document.querySelector('.lut-popover');
  assert('A channel with a LUT from its file also offers "From file"', popover.querySelectorAll('.lut-option').length === 15 && popover.querySelector('.lut-option[data-lut="file"]'));
  popover.querySelector('.lut-option[data-lut="magma"]').click();
  lutButton(2).click(); document.querySelector('.lut-popover .lut-option[data-lut="file"]').click();
  assert('…which brings the kept table back after another LUT was chosen', raw4().channels[2].color === 'file' && raw4().channels[2].lut === four.channels[2].lut);
  lutButton(1).click();
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  assert('Clicking elsewhere closes the popover', !document.querySelector('.lut-popover'));
  {
    const state = MFC_PROJECT.captureState(), saved = state.objects.find(o => o.mfcType === 'mfcImage').display.channels;
    assert('The project stores LUT names, and the 768 bytes only for "From file" (schema 3)', state.schema === 3 &&
      saved[0].color === 'viridis' && saved[2].color === 'file' && luts.base64ToBytes(saved[2].lut).length === 768 && !('lut' in saved[0]));
  }

  // ---- acceptance: one viridis channel with a calibration bar ----
  await MFC_PROJECT.createProject({ name: 'calibration', width: 900, height: 600, unit: 'px', dpi: 300 });
  const big = Array.from({ length: 200 * 150 }, (_, k) => (k % 200) * 20);
  await MFC.importFiles([imagejTiff('viridis.tif', [big], 200, 150, [luts.namedLUT('viridis')])]);
  await MFC_TIFF.whenIdle();
  let img = canvas.getActiveObject();
  img.set({ left: 50, top: 60 }); img.setCoords();
  const ch = () => MFC.getRegistry()[img.mfcId].rawImage.channels[0];
  assert('A single-channel ImageJ file with a viridis LUT opens in viridis', ch().color === 'viridis' && MFC.getRegistry()[img.mfcId].rawImage.channels.length === 1);
  ch().min = 100; ch().max = 3900; MFC.recomposite(img); MFC.refreshChannelPanel();
  rows()[0].querySelector('.ch-calbar').click();
  const bars = () => canvas.getObjects().filter(o => o.mfcType === 'calibrationBar');
  const labels = bar => bar.getObjects().filter(o => o.type === 'text').map(t => t.text);
  const gradientOf = bar => { const el = bar.getObjects().find(o => o.type === 'image').getElement(); const c = document.createElement('canvas'); c.width = el.width || el.naturalWidth; c.height = el.height || el.naturalHeight; c.getContext('2d').drawImage(el, 0, 0); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
  const top = d => [d[0], d[1], d[2]], bottom = d => [d[d.length - 4], d[d.length - 3], d[d.length - 2]];
  const vir = luts.namedLUT('viridis'), lutRgb = (l, i) => [l[i * 3], l[i * 3 + 1], l[i * 3 + 2]];
  let bar = bars()[0];
  assert('The channel row adds a calibration bar linked to that channel, to the right of the image, as one history step',
    bars().length === 1 && bar.mfcCalImageId === img.mfcId && bar.mfcCalChannel === 0 && bar.left > img.getBoundingRect(true).left + img.getBoundingRect(true).width &&
    MFC.getHistory().labels.at(-1) === 'Added calibration bar');
  assert('The bar shows the max at the top and the min at the bottom', labels(bar).join() === '3900,100' &&
    near(top(gradientOf(bar)), lutRgb(vir, 255), 0) && near(bottom(gradientOf(bar)), lutRgb(vir, 0), 0));
  assert('The new bar is selected', canvas.getActiveObject() === bar);
  canvas.setActiveObject(img); MFC.refreshChannelPanel(); // edit the image's channel again
  const maxInput = rows()[0].querySelector('.ch-max-val'); maxInput.value = '3000'; maxInput.dispatchEvent(new Event('change', { bubbles: true }));
  bar = bars()[0];
  assert('Changing the channel\'s max updates the bar\'s label, in the same history step', labels(bar).join() === '3000,100' && /Changed channels/.test(MFC.getHistory().labels.at(-1)));
  lutButton(0).click(); document.querySelector('.lut-popover .lut-option[data-lut="magma"]').click();
  bar = bars()[0];
  assert('Changing the LUT recolours the bar', near(top(gradientOf(bar)), lutRgb(luts.namedLUT('magma'), 255), 0));
  await MFC.undo(); await MFC_TIFF.whenIdle();
  bar = bars()[0]; img = canvas.getObjects().find(o => o.mfcType === 'mfcImage');
  assert('Undo brings back viridis on the image and on the bar', ch().color === 'viridis' && near(top(gradientOf(bar)), lutRgb(vir, 255), 0) && labels(bar).join() === '3000,100');
  await MFC.undo(); await MFC_TIFF.whenIdle();
  assert('…and then the previous max', labels(bars()[0]).join() === '3900,100' && ch().max === 3900);
  await MFC.redo(); await MFC_TIFF.whenIdle();

  // Save and reopen.
  const next = MFC_PROJECT.prepareSave(true, 'calibration'), saved = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
  await MFC.closeDocument();
  await MFC_PROJECT.loadProject(new File([saved], 'calibration.fluoforge'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await MFC_TIFF.whenIdle();
  img = canvas.getObjects().find(o => o.mfcType === 'mfcImage'); bar = bars()[0];
  assert('After save and reopen: the image is in viridis and the bar is still linked, with its labels and colours',
    ch().color === 'viridis' && bar && bar.mfcCalImageId === img.mfcId && labels(bar).join() === '3000,100' && near(top(gradientOf(bar)), lutRgb(vir, 255), 0));
  ch().min = 500; MFC.recomposite(img);
  assert('…and it still follows its channel', labels(bars()[0]).join() === '3000,500');
  ch().min = 100; MFC.recomposite(img); MFC.pushHistory(); await MFC_TIFF.whenIdle();
  bar = bars()[0];
  const barBox = bar.getBoundingRect(true, true);

  // SVG: the gradient as a small raster, the frame and the labels as vectors.
  const svg = (await MFC_EXPORT.buildSVG()).svg;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const texts = [...doc.querySelectorAll('text')].map(t => t.textContent.trim());
  const images = [...doc.querySelectorAll('image')].map(i => i.getAttribute('xlink:href') || i.getAttribute('href'));
  const barImages = [];
  for (const href of images) { const d = await decodeDataImage(href); if (d.width === 1 && d.height === 256) barImages.push(d); }
  assert('SVG export: the bar\'s labels are vector text, its frame a vector rectangle, its gradient a 1 x 256 px raster in viridis',
    texts.includes('3000') && texts.includes('100') && doc.querySelectorAll('rect').length >= 1 && barImages.length === 1 &&
    near(top(barImages[0].data), lutRgb(vir, 255), 0) && near(bottom(barImages[0].data), lutRgb(vir, 0), 0));

  // PDF: the labels are real text.
  await load('node_modules/pdfjs-dist/build/pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'node_modules/pdfjs-dist/build/pdf.worker.min.js';
  const pdfBytes = new Uint8Array(await (await MFC_EXPORT.buildPDF()).blob.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(), isEvalSupported: false }).promise; // pdf.js takes (detaches) the bytes it is given
  const pdfText = (await (await pdf.getPage(1)).getTextContent()).items.map(i => i.str.trim());
  await pdf.destroy();
  assert('PDF export: the bar\'s labels are text in the PDF', pdfText.includes('3000') && pdfText.includes('100'), pdfText.join('|'));
  const pages = await rasterisePDF(pdfBytes), page = pages[0], s = page.width / 900;
  const pdfPx = (x, y) => { const i = (Math.round(y * s) * page.width + Math.round(x * s)) * 4; return [page.data[i], page.data[i + 1], page.data[i + 2]]; };
  // Sample the gradient at its centre line, 10 % in from each end: viridis entries 230 and 25.
  const midX = barBox.left + bar.mfcCalWidth / 2, highY = barBox.top + bar.mfcCalHeight * 0.1, lowY = barBox.top + bar.mfcCalHeight * 0.9;
  const highRgb = lutRgb(vir, Math.round(255 * 0.9)), lowRgb = lutRgb(vir, Math.round(255 * 0.1));
  assert('PDF export: the bar is drawn in viridis (near the top and the bottom)', near(pdfPx(midX, highY), highRgb, 16) && near(pdfPx(midX, lowY), lowRgb, 16),
    pdfPx(midX, highY) + ' vs ' + highRgb + ' / ' + pdfPx(midX, lowY) + ' vs ' + lowRgb);

  // TIFF: the pixels of the bar.
  const tif = decodeTiffRGBA(new Uint8Array(await (await MFC_EXPORT.buildTIFF()).blob.arrayBuffer()));
  const tifPx = (x, y) => { const i = (Math.round(y) * tif.width + Math.round(x)) * 4; return [tif.data[i], tif.data[i + 1], tif.data[i + 2]]; };
  assert('TIFF export: the bar is drawn in viridis (near the top and the bottom)', tif.width === 900 && near(tifPx(midX, highY), highRgb, 8) && near(tifPx(midX, lowY), lowRgb, 8),
    tifPx(midX, highY) + ' vs ' + highRgb + ' / ' + tifPx(midX, lowY) + ' vs ' + lowRgb);

  // Deleting the image keeps the bar as it is.
  canvas.remove(img); MFC.pushHistory();
  assert('Deleting the image leaves the bar with its last colours and labels', bars().length === 1 && labels(bars()[0]).join() === '3000,100');
  return { checks };
}

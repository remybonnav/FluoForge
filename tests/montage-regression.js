/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T1: split-channel montage ("Quick figure").
   - Acceptance: a 4-channel image yields 5 linked panels; cropping one crops all; the project stores
     the source once;
   - one row per selected image, one panel per chosen channel plus a merge, column headers named and
     coloured like the channels; options: grey or colour, merge first or last, gap in mm, channels;
   - panels are views of one source (shared pixels and sourceId); range, LUT, gamma, invert,
     brightness and contrast edits reach every panel, a grey panel stays grey; uncrop; undo; save
     and reopen keep the links; the dialog (button, fields, errors, keyboard, themes). */
async function runMontageRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await MFC_TIFF.whenIdle();
  const M = await import(new URL('js/image/montage.js', document.baseURI).href);
  const reg = MFC.getRegistry(), rawOf = o => reg[o.mfcId].rawImage;
  const dpi = MFC.getDocProps().dpi, mm = v => v / 25.4 * dpi;

  // A 4-channel, 16-bit ImageJ hyperstack, 120 × 90 px, written here (big-endian, uncompressed).
  const tiff4 = (name, w = 120, h = 90) => {
    const desc = new TextEncoder().encode('ImageJ=1.54p\nimages=4\nchannels=4\nmode=composite\n\0');
    const tags = 10, planeBytes = w * h * 2;
    let size = 8 + desc.length;
    const layout = [0, 1, 2, 3].map(() => { const ifd = size; size += 2 + tags * 12 + 4; const data = size; size += planeBytes; return { ifd, data }; });
    const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
    u8.set([0x4d, 0x4d]); dv.setUint16(2, 42); dv.setUint32(4, layout[0].ifd); u8.set(desc, 8);
    layout.forEach(({ ifd, data }, c) => {
      let p = ifd; dv.setUint16(p, tags); p += 2;
      const tag = (id, type, count, value) => { dv.setUint16(p, id); dv.setUint16(p + 2, type); dv.setUint32(p + 4, count); if (type === 3 && count === 1) dv.setUint16(p + 8, value); else dv.setUint32(p + 8, value); p += 12; };
      tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 16); tag(259, 3, 1, 1); tag(262, 3, 1, 1); tag(270, 2, desc.length, 8);
      tag(273, 4, 1, data); tag(277, 3, 1, 1); tag(278, 4, 1, h); tag(279, 4, 1, planeBytes);
      dv.setUint32(p, c < 3 ? layout[c + 1].ifd : 0);
      for (let k = 0; k < w * h; k++) dv.setUint16(data + k * 2, ((k % w) * (c + 1) * 97 + ((k / w) | 0) * 31 * (4 - c)) & 0x0fff);
    });
    return new File([buf], name, { type: 'image/tiff' });
  };
  const importOne = async name => {
    const before = new Set(canvas.getObjects());
    await MFC.importFiles([tiff4(name)]); await MFC_TIFF.whenIdle();
    return canvas.getObjects().find(o => !before.has(o) && o.mfcType === 'mfcImage');
  };
  const setup = (img, colours, names) => {
    rawOf(img).channels.forEach((c, i) => Object.assign(c, { color: colours[i], name: names[i], enabled: true, gamma: 1, invert: false, min: 0, max: 4095 }));
    img.set({ left: 40, top: 480, scaleX: 2, scaleY: 2 }); img.setCoords(); MFC.recomposite(img);
  };
  const montage = id => canvas.getObjects().filter(o => o.mfcType === 'mfcImage' && o.mfcMontageGroup === id).sort((a, b) => a.mfcMontageColumn - b.mfcMontageColumn);
  const headers = id => canvas.getObjects().filter(o => o.type === 'textbox' && o.mfcMontageGroup === id).sort((a, b) => a.mfcMontageColumn - b.mfcMontageColumn);
  const shown = o => rawOf(o).channels.map((c, i) => (c.enabled ? i : -1)).filter(i => i >= 0).join();

  const img = await importOne('four.tif');
  assert('The test image has 4 channels', img && rawOf(img).channels.length === 4, img && rawOf(img).channels.length);
  setup(img, ['blue', 'green', 'red', 'magenta'], ['DAPI', 'FLAG', 'WGA', 'Actin']);

  // ---- The button and the dialog ----
  const button = document.getElementById('btn-quick-figure');
  assert('A Quick figure button in the top bar, with a title saying what it does', button && /row of linked panels/.test(button.title) && !button.disabled);
  canvas.discardActiveObject(); document.getElementById('toast').textContent = '';
  button.click();
  assert('Without a selected image it says to select one and opens nothing', !document.querySelector('.quick-figure-modal') && /Select one or more images/.test(document.getElementById('toast').textContent));
  canvas.setActiveObject(img); button.click(); await frame();
  let dialog = document.querySelector('.quick-figure-modal');
  const $ = sel => dialog.querySelector(sel);
  assert('The dialog lists the 4 channels (shown ones checked) and opens on the first one', dialog && dialog.querySelectorAll('input[name="qf-channel"]').length === 4 &&
    [...dialog.querySelectorAll('input[name="qf-channel"]')].every(c => c.checked) && document.activeElement === $('#qf-channel-0') &&
    $('#qf-colour').value === 'colour' && $('#qf-merge').value === 'last' && $('#qf-gap').value === '1');
  const controls = [...dialog.querySelectorAll('input, select, button')];
  assert('Every control has a title (its own or its field\'s)', controls.every(c => (c.title || c.closest('[title]')?.title || '').length > 5));
  [...dialog.querySelectorAll('input[name="qf-channel"]')].forEach(c => { c.checked = false; });
  $('#qf-ok').click(); await frame();
  assert('No channel chosen: an error, the dialog stays open', document.querySelector('.quick-figure-modal') && /at least one channel/.test($('.export-error').textContent));
  [...dialog.querySelectorAll('input[name="qf-channel"]')].forEach(c => { c.checked = true; });
  $('#qf-gap').value = '-2'; $('#qf-ok').click(); await frame();
  assert('A negative gap is refused', /between 0 and 50 mm/.test($('.export-error').textContent));
  $('#qf-gap').value = '1';
  const last = $('#qf-ok'); last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert('Tab from Create wraps to the first control', document.activeElement === $('#qf-channel-0'));
  const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (x, y) => { const [h, l] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (h + 0.05) / (l + 0.05); };
  const savedTheme = document.documentElement.dataset.theme, ratios = [];
  for (const theme of ['light', 'sage', 'dark', 'slate']) {
    document.documentElement.dataset.theme = theme;
    const d = getComputedStyle(dialog), f = getComputedStyle(dialog.querySelector('.export-field')), s = getComputedStyle($('#qf-colour')), l = getComputedStyle(dialog.querySelector('.qf-channels label'));
    ratios.push(contrast(f.color, d.backgroundColor), contrast(s.color, s.backgroundColor), contrast(l.color, d.backgroundColor), contrast(getComputedStyle(button).color, getComputedStyle(button).backgroundColor));
  }
  if (savedTheme) document.documentElement.dataset.theme = savedTheme; else delete document.documentElement.dataset.theme;
  assert('The dialog and the button are readable in all four themes (contrast ≥ 4.5)', ratios.every(r => r >= 4.5), ratios.map(r => r.toFixed(1)).join());
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert('Escape closes it without changing anything', !document.querySelector('.quick-figure-modal') && !img.mfcMontageGroup && document.activeElement === button);

  // ---- Acceptance: a 4-channel image yields 5 linked panels ----
  canvas.setActiveObject(img); button.click(); await frame();
  dialog = document.querySelector('.quick-figure-modal'); dialog.querySelector('#qf-ok').click(); await MFC_TIFF.whenIdle();
  const id = img.mfcMontageGroup, panels = montage(id);
  assert('A 4-channel image yields 5 linked panels (one per channel, then the merge)', id && panels.length === 5 && panels.map(p => p.mfcMontageChannel).join() === '0,1,2,3,-1', panels.map(p => p.mfcMontageChannel).join());
  assert('The image itself is the merge panel, showing the 4 channels; each other panel shows one channel', panels[4] === img && shown(img) === '0,1,2,3' && panels.slice(0, 4).every((p, i) => shown(p) === String(i)));
  assert('Channel panels keep their channel\'s colour (colour option)', panels.slice(0, 4).map(p => rawOf(p).channels[p.mfcMontageChannel].color).join() === 'blue,green,red,magenta');
  assert('The panels are views of one source: same sourceId, same pixel arrays, own channel settings',
    panels.every(p => reg[p.mfcId].sourceId === reg[img.mfcId].sourceId && rawOf(p).channels.every((c, i) => c.data === rawOf(img).channels[i].data)) &&
    new Set(panels.map(p => rawOf(p).channels)).size === 5);
  const w = img.getScaledWidth(), h = img.getScaledHeight(), gap = mm(1);
  assert('One row: same size and top, 1 mm apart (at the document DPI), merge last',
    panels.every((p, c) => near(p.getScaledWidth(), w) && near(p.getScaledHeight(), h) && near(p.top, panels[0].top) && near(p.left, panels[0].left + c * (w + gap))),
    panels.map(p => `${p.left.toFixed(1)},${p.top.toFixed(1)} ${p.getScaledWidth().toFixed(1)}`).join(' | '));
  const heads = headers(id);
  assert('Column headers: the channel names and "Merge", each over its panel', heads.map(t => t.text).join() === 'DAPI,FLAG,WGA,Actin,Merge' &&
    heads.every((t, c) => near(t.left, panels[c].left) && near(t.width, w) && t.top + t.height <= panels[0].top + 0.5 && t.mfcType === 'text'));
  assert('…coloured like their channel (black for Merge)', heads.map(t => t.fill).join() === '#0000ff,#00ff00,#ff0000,#ff00ff,#000000', heads.map(t => t.fill).join());
  const page = MFC.pageBounds(0);
  assert('The row fits the page\'s width', panels[4].left + w <= page.left + page.width + 0.5);

  // ---- Edited once ----
  const panelRow = (p, idx) => { canvas.setActiveObject(p); MFC.refreshChannelPanel(); return document.querySelectorAll('#channel-list .channel-row')[idx]; };
  let row = panelRow(panels[1], 1);
  row.querySelector('.ch-max-val').value = '3000'; row.querySelector('.ch-max-val').dispatchEvent(new Event('change'));
  assert('A range edit on one panel reaches every panel', panels.every(p => rawOf(p).channels[1].max === 3000), panels.map(p => rawOf(p).channels[1].max).join());
  row = panelRow(img, 2);
  row.querySelector('.ch-gamma').value = '1.5'; row.querySelector('.ch-gamma').dispatchEvent(new Event('change'));
  assert('A gamma edit on the merge reaches every panel', panels.every(p => rawOf(p).channels[2].gamma === 1.5));
  row = panelRow(panels[0], 0);
  row.querySelector('.ch-lut').click(); document.querySelector('.lut-popover .lut-option[data-lut="cyan"]').click();
  assert('A LUT change reaches every panel', panels.every(p => rawOf(p).channels[0].color === 'cyan'));
  row = panelRow(panels[3], 3);
  row.querySelector('.ch-invert').checked = true; row.querySelector('.ch-invert').dispatchEvent(new Event('change'));
  assert('Invert reaches every panel', panels.every(p => rawOf(p).channels[3].invert === true));
  canvas.setActiveObject(panels[2]); MFC.applyBrightnessContrast(20, 0);
  assert('Brightness reaches every panel', panels.every(p => rawOf(p).brightness === 20));
  MFC.applyBrightnessContrast(0, 0);
  assert('Turning a channel off stays on that panel only (panels choose what they show)', (() => { row = panelRow(img, 0); row.querySelector('.ch-toggle').checked = false; row.querySelector('.ch-toggle').dispatchEvent(new Event('change')); return !rawOf(img).channels[0].enabled && rawOf(panels[0]).channels[0].enabled; })());
  row = panelRow(img, 0); row.querySelector('.ch-toggle').checked = true; row.querySelector('.ch-toggle').dispatchEvent(new Event('change'));
  await MFC_TIFF.whenIdle();

  // ---- Acceptance: cropping one crops all ----
  MFC.pushHistory();
  const origin = { x: panels[0].left, y: panels[0].top };
  canvas.setActiveObject(panels[2]); MFC.setTool('crop');
  document.getElementById('crop-mode-rect').click();
  document.getElementById('crop-width').value = '120'; document.getElementById('crop-height').value = '80';
  document.getElementById('crop-width').focus(); MFC.applyCropFieldsToRect(); MFC.applyCrop(); MFC.setTool('select');
  const cw = panels[2].getScaledWidth(), ch = panels[2].getScaledHeight();
  assert('Cropping one panel crops all five the same way', near(cw, 120, 1) && near(ch, 80, 1) &&
    panels.every(p => p.cropX === panels[2].cropX && p.cropY === panels[2].cropY && p.width === panels[2].width && p.height === panels[2].height && near(p.getScaledWidth(), cw)),
    panels.map(p => `${p.cropX},${p.cropY} ${p.width}x${p.height}`).join(' | '));
  assert('…and the row is laid out again from where it started, with the same gap; the headers follow',
    panels.every((p, c) => near(p.left, origin.x + c * (cw + gap)) && near(p.top, origin.y)) && headers(id).every((t, c) => near(t.left, panels[c].left) && near(t.width, cw) && t.top + t.height <= origin.y + 0.5),
    panels.map(p => p.left.toFixed(1)).join());
  MFC.uncropImage(panels[4]);
  assert('Uncropping one panel uncrops all of them', panels.every(p => !p.cropX && !p.cropY && near(p.getScaledWidth(), w) && near(p.left, origin.x + p.mfcMontageColumn * (w + gap))));
  await MFC.undo(); await MFC_TIFF.whenIdle();
  let again = montage(id);
  assert('Undo brings the crop back on all five', again.length === 5 && again.every(p => near(p.getScaledWidth(), cw)));
  await MFC.undo(); await MFC_TIFF.whenIdle(); again = montage(id);
  assert('…and once more, the uncropped row', again.length === 5 && again.every(p => near(p.getScaledWidth(), w)));

  // ---- Acceptance: the project stores the source once; save and reopen keep the links ----
  const next = MFC_PROJECT.prepareSave(true, 'montage'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
  const zip = await JSZip.loadAsync(archive);
  const sourceNames = Object.keys(zip.files).filter(n => n.startsWith('sources/') && !zip.files[n].dir);
  const ids = new Set(Object.values(reg).map(e => e.sourceId));
  assert('The saved project stores each source once: the five panels add no copy of the image', sourceNames.length === ids.size && again.every(p => reg[p.mfcId].sourceId === reg[img.mfcId].sourceId),
    `${sourceNames.length} files for ${ids.size} sources`);
  await MFC.closeDocument();
  await MFC_PROJECT.loadProject(new File([archive], 'montage.fluoforge'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await MFC_TIFF.whenIdle();
  const reopened = montage(id);
  assert('Reopened: the 5 panels are still one montage, with their channels, and the headers too', reopened.length === 5 && reopened.map(p => p.mfcMontageChannel).join() === '0,1,2,3,-1' &&
    reopened.slice(0, 4).every((p, i) => shown(p) === String(i)) && headers(id).length === 5);
  row = panelRow(reopened[0], 1);
  row.querySelector('.ch-min-val').value = '100'; row.querySelector('.ch-min-val').dispatchEvent(new Event('change'));
  assert('…and still linked: a range edit reaches all five', reopened.every(p => rawOf(p).channels[1].min === 100));

  // ---- Options: grey, merge first, gap, channel choice; two images make two rows ----
  const a = await importOne('a.tif'), b = await importOne('b.tif');
  setup(a, ['blue', 'green', 'red', 'grey'], ['A0', 'A1', 'A2', 'A3']); setup(b, ['blue', 'green', 'red', 'grey'], ['B0', 'B1', 'B2', 'B3']);
  a.set({ top: 300 }); b.set({ top: 500 }); a.setCoords(); b.setCoords();
  const made = M.quickFigure([b, a], { grey: true, mergeFirst: true, gapMm: 3, channels: [0, 2] });
  await MFC_TIFF.whenIdle();
  const ra = montage(a.mfcMontageGroup), rb = montage(b.mfcMontageGroup);
  assert('Two images make two rows, each its own montage, top image first', made.length === 2 && made[0] === a.mfcMontageGroup && ra.length === 3 && rb.length === 3 && rb[0].top > ra[0].top);
  assert('Merge first, then the chosen channels 0 and 2 only', ra.map(p => p.mfcMontageChannel).join() === '-1,0,2' && ra[0] === a && shown(a) === '0,2');
  assert('Grey: each channel panel shows its channel in grey; the merge keeps the colours', ra.slice(1).every(p => rawOf(p).channels[p.mfcMontageChannel].color === 'grey') && rawOf(a).channels[0].color === 'blue' && rawOf(a).channels[2].color === 'red');
  const g3 = mm(3), aw = a.getScaledWidth();
  assert('A 3 mm gap between panels; the next row 3 mm below', ra.every((p, c) => near(p.left, ra[0].left + c * (aw + g3))) && near(rb[0].top, ra[0].top + a.getScaledHeight() + g3));
  assert('Headers over the first row only, coloured like the merge (blue, red) to name the grey panels', headers(a.mfcMontageGroup).map(t => t.text + ':' + t.fill).join() === 'Merge:#000000,A0:#0000ff,A2:#ff0000' && headers(b.mfcMontageGroup).length === 0,
    headers(a.mfcMontageGroup).map(t => t.text + ':' + t.fill).join());
  row = panelRow(a, 0);
  row.querySelector('.ch-lut').click(); document.querySelector('.lut-popover .lut-option[data-lut="magma"]').click();
  assert('A LUT change on the merge leaves the grey panel grey', rawOf(a).channels[0].color === 'magma' && rawOf(ra[1]).channels[0].color === 'grey');
  row = panelRow(ra[1], 0);
  row.querySelector('.ch-max-val').value = '2000'; row.querySelector('.ch-max-val').dispatchEvent(new Event('change'));
  assert('A range edit on the grey panel still reaches the merge', rawOf(a).channels[0].max === 2000 && rawOf(ra[1]).channels[0].color === 'grey');

  // ---- Copy and paste: the copy is a montage of its own ----
  const originalId = a.mfcMontageGroup, originalMax = rawOf(a).channels[2].max;
  canvas.setActiveObject(new fabric.ActiveSelection(ra, { canvas })); MFC.copySelection(); await MFC.pasteSelection(); await MFC_TIFF.whenIdle();
  const pastedPanels = canvas.getActiveObjects().filter(o => o.mfcType === 'mfcImage');
  const copyId = pastedPanels[0] && pastedPanels[0].mfcMontageGroup;
  assert('Pasted montage panels get a montage id of their own, shared by the three copies', pastedPanels.length === 3 && copyId && copyId !== originalId &&
    pastedPanels.every(p => p.mfcMontageGroup === copyId) && montage(originalId).length === 3 && montage(copyId).length === 3, pastedPanels.map(p => p.mfcMontageGroup).join());
  canvas.discardActiveObject();
  const copyMerge = montage(copyId).find(p => p.mfcMontageChannel === -1);
  row = panelRow(copyMerge, 2);
  row.querySelector('.ch-max-val').value = '1234'; row.querySelector('.ch-max-val').dispatchEvent(new Event('change'));
  assert('A range edit on the copy reaches the copied panels, not the original montage', montage(copyId).every(p => rawOf(p).channels[2].max === 1234) && montage(originalId).every(p => rawOf(p).channels[2].max === originalMax),
    montage(originalId).map(p => rawOf(p).channels[2].max).join());
  row = panelRow(a, 2);
  row.querySelector('.ch-max-val').value = '2222'; row.querySelector('.ch-max-val').dispatchEvent(new Event('change'));
  assert('…and an edit on the original does not reach the copy', montage(copyId).every(p => rawOf(p).channels[2].max === 1234) && montage(originalId).every(p => rawOf(p).channels[2].max === 2222));
  const originalFrames = montage(originalId).map(p => `${p.cropX},${p.cropY},${p.width},${p.height}`).join('|');
  canvas.setActiveObject(montage(copyId)[1]); MFC.setTool('crop');
  document.getElementById('crop-mode-rect').click();
  document.getElementById('crop-width').value = '50'; document.getElementById('crop-height').value = '40';
  document.getElementById('crop-width').focus(); MFC.applyCropFieldsToRect(); MFC.applyCrop(); MFC.setTool('select');
  const copyFrames = new Set(montage(copyId).map(p => `${p.cropX},${p.cropY},${p.width},${p.height}`));
  assert('Cropping a copied panel crops the copies only', copyFrames.size === 1 && montage(originalId).map(p => `${p.cropX},${p.cropY},${p.width},${p.height}`).join('|') === originalFrames);
  canvas.setActiveObject(montage(copyId)[0]); MFC.copySelection(); await MFC.pasteSelection(); await MFC_TIFF.whenIdle();
  const single = canvas.getActiveObject();
  assert('A single pasted panel is not linked to the montage it was copied from', single && single.mfcMontageGroup && ![originalId, copyId].includes(single.mfcMontageGroup) && montage(copyId).length === 3);

  // ---- Refusals and undo ----
  document.getElementById('toast').textContent = '';
  M.quickFigure([a]);
  assert('An image already in a quick figure is refused with a message', /already part of a quick figure/.test(document.getElementById('toast').textContent));
  const c4 = await importOne('c.tif'); c4.set({ angle: 10 }); c4.setCoords();
  M.quickFigure([c4]);
  assert('A rotated image is refused with a message', /rotated/.test(document.getElementById('toast').textContent) && !c4.mfcMontageGroup);
  c4.set({ angle: 0 }); c4.setCoords(); MFC.pushHistory();
  const count = canvas.getObjects().length;
  M.quickFigure([c4]); await MFC_TIFF.whenIdle();
  assert('A quick figure adds the channel panels and headers', canvas.getObjects().length === count + 4 + 5);
  await MFC.undo(); await MFC_TIFF.whenIdle();
  assert('One undo removes the whole quick figure', canvas.getObjects().length === count && !canvas.getObjects().some(o => o.mfcId === c4.mfcId && o.mfcMontageGroup));
  return checks;
}

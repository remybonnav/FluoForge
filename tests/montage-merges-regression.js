/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* PI-T12: Quick figure with more merges.
   - Acceptance: a 4-channel image produces single channels plus two merges (C1 + C2, C1 + C3 + C4)
     in one step (one History step); the names follow the 10-character rule; the merges stay linked
     views of the one source;
   - the dialog: one merge of all channels by default, Add merge, Remove, the merge's name shown,
     errors (a merge of one channel, two merges alike, nothing chosen), titles, keyboard, themes;
   - headers: a channel's name in its colour (Ch1, Ch2… past 10 characters), a merge's channels
     joined with " + ", each part in its colour; SVG and PDF exports; save and reopen;
   - linked: range edits, crop and uncrop reach every panel, merges included; Replace image keeps
     each merge's channels (by name); grey and merges first; no merge at all. */
async function runMontageMergesRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await MFC_TIFF.whenIdle();
  const M = await import(new URL('js/image/montage.js', document.baseURI).href);
  const R = await import(new URL('js/image/replace.js', document.baseURI).href);
  assert('The montage module names channels and merges', typeof M.shortChannelName === 'function' && typeof M.mergeName === 'function');
  const reg = MFC.getRegistry(), rawOf = o => reg[o.mfcId].rawImage;

  // An ImageJ hyperstack of `n` 16-bit channels, 120 × 90 px, written here (big-endian, uncompressed).
  const tiff = (name, n = 4, w = 120, h = 90) => {
    const desc = new TextEncoder().encode(`ImageJ=1.54p\nimages=${n}\nchannels=${n}\nmode=composite\n\0`);
    const tags = 10, planeBytes = w * h * 2;
    let size = 8 + desc.length;
    const layout = Array.from({ length: n }, () => { const ifd = size; size += 2 + tags * 12 + 4; const data = size; size += planeBytes; return { ifd, data }; });
    const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
    u8.set([0x4d, 0x4d]); dv.setUint16(2, 42); dv.setUint32(4, layout[0].ifd); u8.set(desc, 8);
    layout.forEach(({ ifd, data }, c) => {
      let p = ifd; dv.setUint16(p, tags); p += 2;
      const tag = (id, type, count, value) => { dv.setUint16(p, id); dv.setUint16(p + 2, type); dv.setUint32(p + 4, count); if (type === 3 && count === 1) dv.setUint16(p + 8, value); else dv.setUint32(p + 8, value); p += 12; };
      tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 16); tag(259, 3, 1, 1); tag(262, 3, 1, 1); tag(270, 2, desc.length, 8);
      tag(273, 4, 1, data); tag(277, 3, 1, 1); tag(278, 4, 1, h); tag(279, 4, 1, planeBytes);
      dv.setUint32(p, c < n - 1 ? layout[c + 1].ifd : 0);
      for (let k = 0; k < w * h; k++) dv.setUint16(data + k * 2, ((k % w) * (c + 1) * 97 + ((k / w) | 0) * 31 * (4 - c)) & 0x0fff);
    });
    return new File([buf], name, { type: 'image/tiff' });
  };
  const importOne = async (name, n = 4) => {
    const before = new Set(canvas.getObjects());
    await MFC.importFiles([tiff(name, n)]); await MFC_TIFF.whenIdle();
    return canvas.getObjects().find(o => !before.has(o) && o.mfcType === 'mfcImage');
  };
  const setup = (img, colours, names, top = 480) => {
    rawOf(img).channels.forEach((c, i) => Object.assign(c, { color: colours[i], name: names[i], enabled: true, gamma: 1, invert: false, min: 0, max: 4095 }));
    img.set({ left: 40, top, scaleX: 1.5, scaleY: 1.5 }); img.setCoords(); MFC.recomposite(img);
  };
  const montage = id => canvas.getObjects().filter(o => o.mfcType === 'mfcImage' && o.mfcMontageGroup === id).sort((a, b) => a.mfcMontageColumn - b.mfcMontageColumn);
  const headers = id => canvas.getObjects().filter(o => o.type === 'textbox' && o.mfcMontageGroup === id).sort((a, b) => a.mfcMontageColumn - b.mfcMontageColumn);
  const shown = o => rawOf(o).channels.map((c, i) => (c.enabled ? i : -1)).filter(i => i >= 0).join();
  // A header's text in runs of one colour: "DAPI:#0000ff| + :#000000|Ch2:#00ff00".
  const runs = t => {
    const out = [];
    [...t.text].forEach((ch, k) => {
      const fill = (t.styles && t.styles[0] && t.styles[0][k] && t.styles[0][k].fill) || t.fill;
      if (out.length && out[out.length - 1][1] === fill) out[out.length - 1][0] += ch; else out.push([ch, fill]);
    });
    return out.map(r => r.join(':')).join('|');
  };

  // ---- Names: the 10-character rule ----
  assert('A channel named in 10 characters or fewer is named by it; a longer or empty name gives Ch1, Ch2…',
    M.shortChannelName({ name: 'Tubulin-AF' }, 2) === 'Tubulin-AF' && M.shortChannelName({ name: 'MitoTracker' }, 1) === 'Ch2' &&
    M.shortChannelName({ name: '  DAPI ' }, 0) === 'DAPI' && M.shortChannelName({ name: '' }, 3) === 'Ch4' && M.shortChannelName({}, 0) === 'Ch1');
  assert('A merge is named by its channels joined with " + "', M.mergeName([{ name: 'DAPI' }, { name: 'MitoTracker' }, { name: 'WGA' }], [0, 1, 2]) === 'DAPI + Ch2 + WGA');

  const img = await importOne('four.tif');
  assert('The test image has 4 channels', img && rawOf(img).channels.length === 4);
  setup(img, ['blue', 'green', 'red', 'magenta'], ['DAPI', 'MitoTracker', 'Tubulin-AF', 'Actin']);

  // ---- The dialog ----
  const button = document.getElementById('btn-quick-figure');
  canvas.setActiveObject(img); button.click(); await frame();
  const dialog = document.querySelector('.quick-figure-modal');
  const $ = sel => dialog.querySelector(sel), $$ = sel => [...dialog.querySelectorAll(sel)];
  const rows = () => $$('.qf-merge-row');
  const ticks = row => [...row.querySelectorAll('input[type=checkbox]')];
  const setTicks = (row, on) => { ticks(row).forEach(c => { c.checked = on.includes(Number(c.value)); }); row.dispatchEvent(new Event('change', { bubbles: true })); };
  const nameOf = row => row.querySelector('.qf-merge-name').textContent;
  assert('By default one merge, of all four channels, named by them', rows().length === 1 && ticks(rows()[0]).length === 4 && ticks(rows()[0]).every(c => c.checked) &&
    nameOf(rows()[0]) === 'DAPI + Ch2 + Tubulin-AF + Actin' && rows()[0].querySelector('.qf-merge-title').textContent === 'Merge 1:', nameOf(rows()[0]));
  setTicks(rows()[0], [0, 1]);
  assert('Unticking channels renames the merge as you go (C1 + C2)', nameOf(rows()[0]) === 'DAPI + Ch2');
  $('#qf-merge-add').focus(); $('#qf-merge-add').click(); await frame();
  assert('Add merge adds a second merge, all channels ticked, and moves the focus to its first tick', rows().length === 2 && ticks(rows()[1]).every(c => c.checked) &&
    document.activeElement === ticks(rows()[1])[0] && rows()[1].querySelector('.qf-merge-title').textContent === 'Merge 2:');
  const controls = $$('input, select, button');
  assert('Every control has a title (its own or its field\'s), the merges\' ticks and Remove too', controls.every(c => (c.title || c.closest('[title]')?.title || '').length > 5) &&
    /merge 2/.test(ticks(rows()[1])[2].closest('label').title) && $$('.qf-merge-remove').every(b => /Remove merge \d/.test(b.title) && b.getAttribute('aria-label') === b.title));
  setTicks(rows()[1], [2]);
  $('#qf-ok').click(); await frame();
  assert('A merge of one channel is refused: an error, the dialog stays open', document.querySelector('.quick-figure-modal') && /Merge 2 needs at least two channels/.test($('.export-error').textContent), $('.export-error').textContent);
  setTicks(rows()[1], [0, 1]);
  $('#qf-ok').click(); await frame();
  assert('Two merges of the same channels are refused', /Merges 1 and 2 have the same channels/.test($('.export-error').textContent), $('.export-error').textContent);
  $('#qf-merge-add').click(); await frame();
  const third = rows()[2], removeThird = third.querySelector('.qf-merge-remove');
  removeThird.focus(); removeThird.click(); await frame();
  assert('Remove takes a merge away; the focus goes to the merge before it', rows().length === 2 && !third.isConnected && document.activeElement === ticks(rows()[1])[0]);
  rows()[1].querySelector('.qf-merge-remove').click(); rows()[0].querySelector('.qf-merge-remove').click(); await frame();
  assert('Removing the last merge moves the focus to Add merge', rows().length === 0 && document.activeElement === $('#qf-merge-add'));
  $$('input[name="qf-channel"]').forEach(c => { c.checked = false; });
  $('#qf-ok').click(); await frame();
  assert('No channel and no merge: an error, the dialog stays open', /at least one channel, or add a merge/.test($('.export-error').textContent));
  $$('input[name="qf-channel"]').forEach(c => { c.checked = true; });
  $('#qf-merge-add').click(); $('#qf-merge-add').click(); await frame();
  setTicks(rows()[0], [0, 1]); setTicks(rows()[1], [0, 2, 3]);
  assert('Two merges: C1 + C2 and C1 + C3 + C4, renumbered after the removals', nameOf(rows()[0]) === 'DAPI + Ch2' && nameOf(rows()[1]) === 'DAPI + Tubulin-AF + Actin' &&
    rows().map(r => r.querySelector('.qf-merge-title').textContent).join() === 'Merge 1:,Merge 2:' && ticks(rows()[1])[0].id === 'qf-merge-1-0');
  const last = $('#qf-ok'); last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert('Tab from Create still wraps to the first control', document.activeElement === $('#qf-channel-0'));
  ticks(rows()[0])[2].focus();
  assert('The merges\' ticks take keyboard focus', document.activeElement === ticks(rows()[0])[2]);
  const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (x, y) => { const [hi, lo] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (hi + 0.05) / (lo + 0.05); };
  const savedTheme = document.documentElement.dataset.theme, ratios = [];
  for (const theme of ['light', 'sage', 'dark', 'slate']) {
    document.documentElement.dataset.theme = theme;
    const d = getComputedStyle(dialog).backgroundColor;
    for (const sel of ['.qf-merge-title', '.qf-merge-name', '.qf-merge-channels label']) ratios.push(contrast(getComputedStyle($(sel)).color, d));
    const b = getComputedStyle($('#qf-merge-add')); ratios.push(contrast(b.color, b.backgroundColor));
  }
  if (savedTheme) document.documentElement.dataset.theme = savedTheme; else delete document.documentElement.dataset.theme;
  assert('The merges are readable in all four themes (contrast ≥ 4.5)', ratios.every(r => r >= 4.5), ratios.map(r => r.toFixed(1)).join());

  // ---- Acceptance: single channels plus two merges in one step ----
  MFC.pushHistory();
  const before = canvas.getObjects().length;
  $('#qf-ok').click(); await MFC_TIFF.whenIdle();
  const id = img.mfcMontageGroup, panels = montage(id);
  assert('One step makes 4 channel panels and 2 merges, in that order', !document.querySelector('.quick-figure-modal') && id && panels.length === 6 &&
    panels.map(p => p.mfcMontageChannel).join() === '0,1,2,3,-1,-1', panels.map(p => p.mfcMontageChannel).join());
  assert('The merges show their channels (C1 + C2, C1 + C3 + C4); the image itself is the first merge; each other panel shows its channel',
    shown(panels[4]) === '0,1' && shown(panels[5]) === '0,2,3' && panels[4] === img && panels.slice(0, 4).every((p, i) => shown(p) === String(i)), panels.map(shown).join(' | '));
  assert('The dialog remembers the merges for next time', JSON.stringify(M.montageOptions.merges) === '[[0,1],[0,2,3]]');
  const w = img.getScaledWidth(), h = img.getScaledHeight(), gap = panels[0].mfcMontageGap;
  assert('One row: same size and top, one gap apart', panels.every((p, c) => near(p.getScaledWidth(), w) && near(p.getScaledHeight(), h) && near(p.top, panels[0].top) && near(p.left, panels[0].left + c * (w + gap))));
  const heads = headers(id);
  assert('Headers follow the 10-character rule: DAPI, Ch2 (MitoTracker is 11), Tubulin-AF (10), Actin, and each merge by its channels',
    heads.map(t => t.text).join() === 'DAPI,Ch2,Tubulin-AF,Actin,DAPI + Ch2,DAPI + Tubulin-AF + Actin' && heads.every((t, c) => near(t.left, panels[c].left) && near(t.width, w)),
    heads.map(t => t.text).join());
  assert('A channel header is in its channel\'s colour', heads.slice(0, 4).map(t => t.fill).join() === '#0000ff,#00ff00,#ff0000,#ff00ff', heads.map(t => t.fill).join());
  assert('A merge header has each part in its channel\'s colour, " + " in the text colour',
    runs(heads[4]) === 'DAPI:#0000ff| + :#000000|Ch2:#00ff00' && runs(heads[5]) === 'DAPI:#0000ff| + :#000000|Tubulin-AF:#ff0000| + :#000000|Actin:#ff00ff', runs(heads[4]) + ' / ' + runs(heads[5]));
  assert('The merge panels are named after their channels', /\(merge DAPI \+ Tubulin-AF \+ Actin\)$/.test(panels[5].mfcFileName), panels[5].mfcFileName);
  assert('…added in one History step: 5 panels and 6 headers', canvas.getObjects().length === before + 5 + 6);
  await MFC.undo(); await MFC_TIFF.whenIdle();
  assert('One undo removes the whole quick figure, merges included', canvas.getObjects().length === before && !canvas.getObjects().some(o => o.mfcMontageGroup === id));
  await MFC.redo(); await MFC_TIFF.whenIdle();
  let row = montage(id);
  assert('Redo brings it back', row.length === 6 && shown(row[4]) === '0,1' && shown(row[5]) === '0,2,3');

  // ---- Acceptance: the merges stay linked views of the one source ----
  const first = row[4];
  assert('Every panel is a view of one source: same sourceId, same pixel arrays, own channel settings',
    row.every(p => reg[p.mfcId].sourceId === reg[first.mfcId].sourceId && rawOf(p).channels.every((c, i) => c.data === rawOf(first).channels[i].data)) && new Set(row.map(p => rawOf(p).channels)).size === 6);
  const panelRow = (p, idx) => { canvas.setActiveObject(p); MFC.refreshChannelPanel(); return document.querySelectorAll('#channel-list .channel-row')[idx]; };
  let chRow = panelRow(row[5], 3);
  chRow.querySelector('.ch-max-val').value = '3000'; chRow.querySelector('.ch-max-val').dispatchEvent(new Event('change'));
  assert('A range edit on the second merge reaches every panel', row.every(p => rawOf(p).channels[3].max === 3000), row.map(p => rawOf(p).channels[3].max).join());
  chRow = panelRow(row[1], 1);
  chRow.querySelector('.ch-lut').click(); document.querySelector('.lut-popover .lut-option[data-lut="yellow"]').click();
  assert('A LUT change on a channel panel reaches both merges', rawOf(row[4]).channels[1].color === 'yellow' && rawOf(row[5]).channels[1].color === 'yellow');
  chRow = panelRow(row[5], 1);
  chRow.querySelector('.ch-toggle').checked = true; chRow.querySelector('.ch-toggle').dispatchEvent(new Event('change'));
  assert('Turning a channel on in one merge stays on that merge', shown(row[5]) === '0,1,2,3' && shown(row[4]) === '0,1');
  chRow = panelRow(row[5], 1); chRow.querySelector('.ch-toggle').checked = false; chRow.querySelector('.ch-toggle').dispatchEvent(new Event('change'));
  await MFC_TIFF.whenIdle();
  MFC.pushHistory();
  const origin = { x: row[0].left, y: row[0].top };
  canvas.setActiveObject(row[5]); MFC.setTool('crop');
  document.getElementById('crop-mode-rect').click();
  document.getElementById('crop-width').value = '80'; document.getElementById('crop-height').value = '60';
  document.getElementById('crop-width').focus(); MFC.applyCropFieldsToRect(); MFC.applyCrop(); MFC.setTool('select');
  const cw = row[5].getScaledWidth();
  assert('Cropping a merge crops all six panels the same way; the row is laid out again',
    row.every(p => p.cropX === row[5].cropX && p.cropY === row[5].cropY && p.width === row[5].width && p.height === row[5].height) &&
    row.every((p, c) => near(p.left, origin.x + c * (cw + gap)) && near(p.top, origin.y)) && headers(id).every((t, c) => near(t.left, row[c].left) && near(t.width, cw)),
    row.map(p => `${p.cropX},${p.cropY} ${p.width}x${p.height} @${p.left.toFixed(1)}`).join(' | '));
  MFC.uncropImage(row[0]);
  assert('Uncropping a channel panel uncrops the merges too', row.every(p => !p.cropX && !p.cropY && near(p.getScaledWidth(), w)));

  // ---- Exports, save and reopen ----
  const svg = (await MFC_EXPORT.buildSVG()).svg;
  const tspan = (text, rgb) => new RegExp(`<tspan[^>]*fill: ?${rgb.replace(/[(),]/g, m => '\\' + m)}[^>]*>${text.replace(/\+/g, '\\+')}</tspan>`).test(svg);
  assert('SVG export: each part of a merge header is text in its channel\'s colour', tspan('Ch2', 'rgb(0,255,0)') && tspan('Tubulin-AF', 'rgb(255,0,0)') && tspan('Actin', 'rgb(255,0,255)') && /DAPI/.test(svg),
    (svg.match(/<tspan[^>]*>(Ch2|Actin)<\/tspan>/g) || []).join(' '));
  const pdf = await MFC_EXPORT.buildPDF();
  assert('PDF export works with the merges and their headers', pdf.blob.size > 1000);
  const next = MFC_PROJECT.prepareSave(true, 'merges'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
  const zip = await JSZip.loadAsync(archive);
  const sourceNames = Object.keys(zip.files).filter(n => n.startsWith('sources/') && !zip.files[n].dir);
  assert('The saved project stores each source once: the merges add no copy of the image', sourceNames.length === new Set(Object.values(reg).map(e => e.sourceId)).size);
  const headRuns = headers(id).map(runs).join(' / ');
  await MFC.closeDocument();
  await MFC_PROJECT.loadProject(new File([archive], 'merges.fluoforge'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await MFC_TIFF.whenIdle();
  row = montage(id);
  assert('Reopened: six panels, the merges showing their channels, the headers in their colours', row.length === 6 && row.map(p => p.mfcMontageChannel).join() === '0,1,2,3,-1,-1' &&
    shown(row[4]) === '0,1' && shown(row[5]) === '0,2,3' && headers(id).map(runs).join(' / ') === headRuns, headers(id).map(runs).join(' / '));
  chRow = panelRow(row[4], 0);
  chRow.querySelector('.ch-min-val').value = '100'; chRow.querySelector('.ch-min-val').dispatchEvent(new Event('change'));
  assert('…and still linked: a range edit on a merge reaches all six', row.every(p => rawOf(p).channels[0].min === 100));

  // ---- Replace image: each merge keeps its channels, by name ----
  // The new file's channels are named Ch 1 to Ch 4, unlike the panels': matched by number…
  await R.replaceImage(row[4], tiff('reordered.tif'), { carry: false }); await MFC_TIFF.whenIdle();
  row = montage(id);
  assert('Replace image: the merges still show their own channels (by number when the names do not match)', row.length === 6 && shown(row[4]) === '0,1' && shown(row[5]) === '0,2,3' &&
    row.every(p => reg[p.mfcId].sourceId === reg[row[4].mfcId].sourceId), row.map(shown).join(' | '));
  // …and by name: the panels' first two channels renamed (as if the old file had them the other way round).
  row.forEach(p => { const ch = rawOf(p).channels; ch[0].name = 'Ch 2'; ch[1].name = 'Ch 1'; });
  await R.replaceImage(row[4], tiff('named.tif'), { carry: false }); await MFC_TIFF.whenIdle();
  row = montage(id);
  assert('…and by name when they match: "Ch 2", "Ch 3", "Ch 4" are the new file\'s channels 2 to 4', shown(row[5]) === '1,2,3' && shown(row[4]) === '0,1', row.map(shown).join(' | '));

  // ---- Options: grey and merges first; no merge ----
  const b = await importOne('b.tif');
  setup(b, ['blue', 'green', 'red', 'magenta'], ['B0', 'B1', 'B2', 'B3'], 300);
  M.quickFigure([b], { grey: true, mergeFirst: true, gapMm: 1, channels: [0, 2], merges: [[0, 1, 2, 3], [1, 3], [3, 1], [7], [2]] });
  await MFC_TIFF.whenIdle();
  const rb = montage(b.mfcMontageGroup);
  assert('Merges first, in the order given; a repeated merge and a channel the image lacks are left out', rb.map(p => p.mfcMontageChannel).join() === '-1,-1,-1,0,2' &&
    rb[0] === b && shown(rb[0]) === '0,1,2,3' && shown(rb[1]) === '1,3' && shown(rb[2]) === '2', rb.map(p => p.mfcMontageChannel + ':' + shown(p)).join(' | '));
  assert('A merge of one channel (given by a script) keeps its colour with the grey option', rawOf(rb[2]).channels[2].color === 'red');
  assert('Grey: channel panels are grey, merges keep their colours, the headers keep the channel colours',
    rawOf(rb[3]).channels[0].color === 'grey' && rawOf(rb[4]).channels[2].color === 'grey' && rawOf(rb[1]).channels[1].color === 'green' &&
    headers(b.mfcMontageGroup).map(t => t.text + ':' + t.fill).slice(3).join() === 'B0:#0000ff,B2:#ff0000', headers(b.mfcMontageGroup).map(runs).join(' / '));
  const c = await importOne('c.tif');
  setup(c, ['blue', 'green', 'red', 'magenta'], ['C0', 'C1', 'C2', 'C3'], 160);
  M.quickFigure([c], { grey: true, channels: [1, 2], merges: [] });
  await MFC_TIFF.whenIdle();
  const rc = montage(c.mfcMontageGroup);
  assert('No merge: only channel panels; the image itself is the first, in grey, its header in the channel\'s colour', rc.length === 2 && rc[0] === c &&
    rc.map(p => p.mfcMontageChannel + ':' + shown(p)).join() === '1:1,2:2' && rawOf(c).channels[1].color === 'grey' &&
    headers(c.mfcMontageGroup).map(t => t.text + ':' + t.fill).join() === 'C1:#00ff00,C2:#ff0000', headers(c.mfcMontageGroup).map(t => t.text + ':' + t.fill).join());
  const d = await importOne('d.tif');
  setup(d, ['blue', 'green', 'red', 'magenta'], ['D0', 'D1', 'D2', 'D3'], 60);
  M.quickFigure([d], { grey: false, mergeFirst: false, gapMm: 1, channels: [0, 2] });
  await MFC_TIFF.whenIdle();
  const rd = montage(d.mfcMontageGroup);
  assert('Without a merges option (as before PI-T12): one merge of the chosen channels, last', rd.map(p => p.mfcMontageChannel + ':' + shown(p)).join() === '0:0,2:2,-1:0,2' && rd[2] === d &&
    runs(headers(d.mfcMontageGroup)[2]) === 'D0:#0000ff| + :#000000|D2:#ff0000');

  // ---- One channel: nothing to merge ----
  const one = await importOne('one.tif', 1);
  M.montageOptions.merges = null;
  canvas.setActiveObject(one); button.click(); await frame();
  const d1 = document.querySelector('.quick-figure-modal');
  assert('A one-channel image: no merge by default', d1 && d1.querySelectorAll('.qf-merge-row').length === 0 && d1.querySelector('#qf-merge-add'));
  d1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return checks;
}

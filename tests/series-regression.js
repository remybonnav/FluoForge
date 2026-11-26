/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T9: series montages (the pure part: tests/series-model-regression.mjs).
   - From a time series or Z stack, a range and step give a strip or grid of panels, one per plane,
     each showing its plane (from the shared source, stored once) and labelled with its time or Z
     position (P3-T8 auto-labels, linked to their panel); one History step; the montage fits the page;
   - the panels are linked: a crop, a range edit, turning a channel on or off and the other axis's
     plane (Z display of a time series) reach them all, and the grid is laid out again;
   - save and reopen keep planes, links and labels; copy and paste make a montage of its own; SVG, PDF
     and TIFF export; replacing the image keeps each panel's plane; a template frame keeps its place;
   - refusals with messages; the dialog (button, fields, summary, errors, keyboard). */
async function runSeriesRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const S = await import(new URL('js/image/series.js', document.baseURI).href);
  const R = await import(new URL('js/image/replace.js', document.baseURI).href);
  const TM = await import(new URL('js/layout/template-model.js', document.baseURI).href);
  const reg = MFC.getRegistry(), rawOf = o => reg[o.mfcId].rawImage;

  // ImageJ hyperstacks, C channels × Z slices × T frames, 0.5 µm Z step, 30 s between frames. A pixel
  // says its plane: 100 + 1000 c + 100 z + 10 t (+ k % 7).
  const makeTiff = (name, { C = 2, Z = 5, T = 6, w = 40, h = 30 } = {}) => {
    const desc = new TextEncoder().encode(`ImageJ=1.54p\nimages=${C * Z * T}\nchannels=${C}\nslices=${Z}\nframes=${T}\nhyperstack=true\nmode=composite\nspacing=0.5\nunit=micron\nfinterval=30\nmin=0.0\nmax=4000.0\n\0`);
    const pages = [];
    for (let t = 0; t < T; t++) for (let z = 0; z < Z; z++) for (let c = 0; c < C; c++) pages.push({ c, z, t });
    const tagCount = 10, ifdSize = 2 + tagCount * 12 + 4, planeBytes = w * h * 2;
    let size = 8 + desc.length;
    const layout = pages.map(() => { const ifd = size; size += ifdSize; const data = size; size += planeBytes; return { ifd, data }; });
    const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
    u8.set([0x49, 0x49]); dv.setUint16(2, 42, true); dv.setUint32(4, layout[0].ifd, true); u8.set(desc, 8);
    pages.forEach(({ c, z, t }, i) => {
      const { ifd, data } = layout[i]; let p = ifd; dv.setUint16(p, tagCount, true); p += 2;
      const tag = (id, type, count, value) => { dv.setUint16(p, id, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true);
        if (type === 3 && count === 1) dv.setUint16(p + 8, value, true); else dv.setUint32(p + 8, value, true); p += 12; };
      tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 16); tag(259, 3, 1, 1); tag(262, 3, 1, 1); tag(270, 2, desc.length, 8);
      tag(273, 4, 1, data); tag(277, 3, 1, 1); tag(278, 4, 1, h); tag(279, 4, 1, planeBytes);
      dv.setUint32(p, i + 1 < pages.length ? layout[i + 1].ifd : 0, true);
      for (let k = 0; k < w * h; k++) dv.setUint16(data + k * 2, 100 + 1000 * c + 100 * z + 10 * t + (k % 7), true);
    });
    return new File([buf], name, { type: 'image/tiff' });
  };
  const importOne = async (file, at = { left: 40, top: 60, scaleX: 4, scaleY: 4 }) => {
    const before = new Set(canvas.getObjects());
    await MFC.importFiles([file]); await MFC_TIFF.whenIdle();
    const img = canvas.getObjects().find(o => !before.has(o) && o.mfcType === 'mfcImage');
    img.set(at); img.setCoords(); MFC.pushHistory();
    return img;
  };
  const group = id => canvas.getObjects().filter(o => o.mfcType === 'mfcImage' && o.mfcMontageGroup === id).sort((a, b) => a.mfcSeries.position - b.mfcSeries.position);
  const labelOf = p => canvas.getObjects().find(o => o.mfcAutoLabel && o.mfcAutoLabel.for === p.mfcId);
  const value = (p, c = 0) => rawOf(p).channels[c].data[0]; // the plane shown, read from its first pixel
  const inside = (l, p) => { const a = l.getBoundingRect(true, true), b = p.getBoundingRect(true, true); return a.left >= b.left - 0.5 && a.top >= b.top - 0.5 && a.left + a.width <= b.left + b.width + 0.5 && a.top + a.height <= b.top + b.height + 0.5; };
  // A time label keeps its place at the top right corner of its panel.
  const atCorner = (l, p) => { const a = l.getBoundingRect(true, true), b = p.getBoundingRect(true, true); return a.left + a.width <= b.left + b.width + 0.5 && a.left + a.width > b.left + b.width - 20 && a.top >= b.top && a.top < b.top + 20; };
  const toastText = () => $('toast').textContent;
  const idle = async () => { await MFC_TIFF.whenIdle(); await frame(); };

  try {
    await MFC_PROJECT.createProject({ name: 'Series', width: 1200, height: 900, unit: 'px', dpi: 300 });
    MFC.zoomReset && MFC.zoomReset(); await frame();
    const dpi = MFC.getDocProps().dpi, mm = v => v / 25.4 * dpi;

    // ================= The dialog =================
    const button = $('btn-series');
    assert('A Series button in the top bar, with a title saying what it does', button && /Series montage/.test(button.title) && /linked panels/.test(button.title) && !button.disabled);
    canvas.discardActiveObject(); $('toast').textContent = ''; button.click();
    assert('With no image selected, the button says what to select', !document.querySelector('.series-backdrop') && /Select a Z stack or time series first/.test(toastText()));
    const img = await importOne(makeTiff('cells.tif'));
    canvas.setActiveObject(img); button.click(); await frame();
    let dialog = document.querySelector('.series-modal');
    assert('With a stack selected, the dialog opens with the focus on its first field', dialog && document.activeElement === $('sm-axis'));
    assert('Both axes of the file, named with their counts; time first', [...$('sm-axis').options].map(o => o.value + ':' + o.textContent).join() === 't:Time frames (6),z:Z slices (5)' && $('sm-axis').value === 't');
    assert('First 1, last 6, step 1 by default; a strip; labels on', $('sm-from').value === '1' && $('sm-to').value === '6' && $('sm-step').value === '1' && $('sm-layout').value === 'strip' && $('sm-labels').checked);
    assert('The summary says which planes', /^6 panels \(6 × 1\): frames 1, 2, 3, 4, 5, 6\.$/.test($('sm-summary').textContent), $('sm-summary').textContent);
    assert('Every control has a title (on itself or its label)', [...dialog.querySelectorAll('select, input, button')].every(el => el.title || el.closest('label')?.title));
    assert('The columns field shows only for a grid', $('sm-columns').closest('label').classList.contains('hidden') && $('sm-columns').disabled);
    const set = (id, v) => { $(id).value = v; $(id).dispatchEvent(new Event('input', { bubbles: true })); };
    set('sm-step', '2');
    assert('A step of 2: frames 1, 3, 5', /^3 panels \(3 × 1\): frames 1, 3, 5\.$/.test($('sm-summary').textContent));
    set('sm-to', '9');
    assert('A last frame beyond the series: a message, and Create is off', /last frame between 1 and 6/.test(dialog.querySelector('.export-error').textContent) && $('sm-ok').disabled && !$('sm-summary').textContent);
    set('sm-to', '6');
    $('sm-layout').value = 'grid'; $('sm-layout').dispatchEvent(new Event('change', { bubbles: true }));
    assert('A grid shows the columns field (4 by default)', !$('sm-columns').closest('label').classList.contains('hidden') && !$('sm-columns').disabled && /\(3 × 1\)/.test($('sm-summary').textContent));
    set('sm-columns', '2');
    assert('…and the summary its shape', /^3 panels \(2 × 2\)/.test($('sm-summary').textContent));
    $('sm-axis').value = 'z'; $('sm-axis').dispatchEvent(new Event('change', { bubbles: true }));
    assert('Choosing Z slices resets the range to the 5 slices', $('sm-to').value === '5' && $('sm-from').value === '1' && /slices 1, 2, 3, 4, 5/.test($('sm-summary').textContent) && /1 to 5/.test($('sm-to').title));
    const items = [...dialog.querySelectorAll('input:not([disabled]), select:not([disabled]), button:not([disabled])')];
    items.at(-1).focus(); dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert('Tab from the last control goes back to the first (the focus stays in the dialog)', document.activeElement === items[0]);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert('Escape closes it without a change, the focus back on the button', !document.querySelector('.series-backdrop') && document.activeElement === button && !img.mfcMontageGroup);

    // ================= A time strip, made from the dialog =================
    const steps = MFC.getHistory().labels.length;
    canvas.setActiveObject(img); button.click(); await frame();
    $('sm-axis').value = 't'; $('sm-axis').dispatchEvent(new Event('change', { bubbles: true }));
    set('sm-step', '2'); $('sm-layout').value = 'strip'; $('sm-layout').dispatchEvent(new Event('change', { bubbles: true })); set('sm-gap', '1');
    $('sm-ok').click(); await idle();
    const id = img.mfcMontageGroup;
    let panels = group(id);
    assert('Frames 1, 3, 5 make three panels, the image first', panels.length === 3 && panels[0] === img && panels.map(p => rawOf(p).tIndex).join() === '0,2,4' && panels.every(p => p.mfcSeries.axis === 't'));
    assert('Each panel shows its frame (a Z projection of it, as the image did)', panels.map(p => value(p)).join() === '500,520,540' && panels.every(p => rawOf(p).zMode === 'max'), panels.map(p => value(p)).join());
    assert('…from one source, stored once (shared stack and source id)', panels.every(p => reg[p.mfcId].sourceId === reg[img.mfcId].sourceId && rawOf(p).stack === rawOf(img).stack));
    const w = img.getScaledWidth(), h = img.getScaledHeight(), gap = mm(1);
    assert('A strip: same size, 1 mm apart, from where the image was', panels.every((p, i) => near(p.getScaledWidth(), w) && near(p.getScaledHeight(), h) && near(p.left, 40 + i * (w + gap)) && near(p.top, 60)) && near(w, 160));
    assert('Each panel is labelled with its time, linked to it and inside it', panels.map(p => labelOf(p) && labelOf(p).text).join() === 't = 0 s,t = 1:00 min,t = 2:00 min' &&
      panels.every(p => labelOf(p).mfcAutoLabel.kind === 'time' && inside(labelOf(p), p)), panels.map(p => labelOf(p) && JSON.stringify([labelOf(p).text, labelOf(p).getBoundingRect(true, true), p.getBoundingRect(true, true)])).join(' '));
    assert('Panel names say their frame', panels.map(p => p.mfcFileName).join() === 'cells.tif (frame 1),cells.tif (frame 3),cells.tif (frame 5)', panels.map(p => p.mfcFileName).join());
    assert('One History step', MFC.getHistory().labels.length === steps + 1);
    assert('A message says what was made', /Series montage: 3 linked panels, frames 1, 3, 5/.test(toastText()));

    // ---- linked ----
    const panelRow = (p, idx) => { canvas.setActiveObject(p); MFC.refreshChannelPanel(); return document.querySelectorAll('#channel-list .channel-row')[idx]; };
    let row = panelRow(panels[1], 0);
    row.querySelector('.ch-max-val').value = '1500'; row.querySelector('.ch-max-val').dispatchEvent(new Event('change'));
    assert('A range edit on one panel reaches every panel', panels.every(p => rawOf(p).channels[0].max === 1500));
    row = panelRow(panels[2], 1);
    row.querySelector('.ch-toggle').checked = false; row.querySelector('.ch-toggle').dispatchEvent(new Event('change'));
    assert('Turning a channel off on one panel turns it off on all', panels.every(p => rawOf(p).channels[1].enabled === false && rawOf(p).channels[0].enabled === true));
    row = panelRow(panels[0], 1);
    row.querySelector('.ch-toggle').checked = true; row.querySelector('.ch-toggle').dispatchEvent(new Event('change'));
    assert('…and on again', panels.every(p => rawOf(p).channels[1].enabled === true));
    canvas.setActiveObject(panels[1]);
    await MFC.applyStackPlane({ zIndex: 2 }, true); await idle();
    assert('Showing Z slice 3 on one panel of a time series shows it on all, each keeping its frame', panels.every(p => rawOf(p).zMode === 'slice' && rawOf(p).zIndex === 2) &&
      panels.map(p => rawOf(p).tIndex).join() === '0,2,4' && panels.map(p => value(p)).join() === '300,320,340', panels.map(p => value(p)).join());
    await MFC.applyStackPlane({ tIndex: 5 }, true); await idle();
    assert('A new frame on one panel changes that panel only, and its label says so', rawOf(panels[1]).tIndex === 5 && rawOf(panels[0]).tIndex === 0 && rawOf(panels[2]).tIndex === 4 &&
      labelOf(panels[1]).text === 't = 2:30 min' && labelOf(panels[0]).text === 't = 0 s');
    await MFC.undo(); await idle(); panels = group(id);
    assert('Undo gives the panel its frame back', rawOf(panels[1]).tIndex === 2 && labelOf(panels[1]).text === 't = 1:00 min');
    canvas.setActiveObject(panels[2]); MFC.setTool('crop');
    $('crop-mode-rect').click();
    $('crop-width').value = '80'; $('crop-height').value = '60';
    $('crop-width').focus(); MFC.applyCropFieldsToRect(); MFC.applyCrop(); MFC.setTool('select'); await idle();
    const cw = panels[2].getScaledWidth();
    assert('Cropping one panel crops all of them, the same frame', new Set(panels.map(p => `${p.cropX},${p.cropY},${p.width},${p.height}`)).size === 1 && near(panels[0].width, 20) && near(cw, 80),
      panels.map(p => `${p.cropX},${p.cropY} ${p.width}x${p.height}`).join(' | '));
    assert('…and the strip is laid out again from where it started, labels following', panels.every((p, i) => near(p.left, 40 + i * (cw + gap)) && near(p.top, 60) && atCorner(labelOf(p), p)),
      panels.map(p => p.left.toFixed(1)).join());
    await MFC.undo(); await idle(); panels = group(id);
    assert('Undo uncrops all three', panels.every(p => near(p.getScaledWidth(), w)));

    // ---- save and reopen ----
    const next = MFC_PROJECT.prepareSave(true, 'series'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
    const zip = await JSZip.loadAsync(archive);
    const sourceFiles = Object.keys(zip.files).filter(n => n.startsWith('sources/') && !zip.files[n].dir);
    assert('The saved project stores the source once', sourceFiles.length === 1, sourceFiles.join());
    await MFC.closeDocument();
    await MFC_PROJECT.loadProject(new File([archive], 'series.fluoforge'));
    document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
    await idle();
    panels = group(id);
    assert('Reopened: the three panels, their frames and their pixels', panels.length === 3 && panels.map(p => rawOf(p).tIndex).join() === '0,2,4' && panels.map(p => value(p)).join() === '300,320,340' &&
      panels.every(p => reg[p.mfcId].sourceId === reg[panels[0].mfcId].sourceId), panels.map(p => value(p)).join());
    assert('…their labels, still linked', panels.map(p => labelOf(p) && labelOf(p).text).join() === 't = 0 s,t = 1:00 min,t = 2:00 min');
    row = panelRow(panels[0], 0);
    row.querySelector('.ch-min-val').value = '200'; row.querySelector('.ch-min-val').dispatchEvent(new Event('change'));
    assert('…and still linked: a range edit reaches all three', panels.every(p => rawOf(p).channels[0].min === 200));

    // ---- export ----
    canvas.discardActiveObject();
    const svg = (await MFC_EXPORT.buildSVG()).svg;
    assert('SVG export: the three panels as images and their labels as text', (svg.match(/<image/g) || []).length === 3 && ['t = 0 s', 't = 1:00 min', 't = 2:00 min'].every(t => svg.includes(t)));
    const pdf = await MFC_EXPORT.buildPDF();
    assert('PDF export succeeds', pdf && (pdf.blob ? pdf.blob.size : pdf.size || pdf.byteLength) > 1000);
    const tiff = await MFC_EXPORT.buildTIFF();
    assert('TIFF export succeeds', tiff && tiff.blob && tiff.blob.size > 1000);

    // ---- copy and paste ----
    canvas.setActiveObject(new fabric.ActiveSelection(panels, { canvas })); MFC.copySelection(); await MFC.pasteSelection(); await idle();
    const pasted = canvas.getActiveObjects().filter(o => o.mfcType === 'mfcImage');
    const copyId = pasted[0] && pasted[0].mfcMontageGroup;
    assert('Pasted panels form a series of their own, keeping their frames', pasted.length === 3 && copyId && copyId !== id && pasted.every(p => p.mfcMontageGroup === copyId && p.mfcSeries) &&
      pasted.map(p => rawOf(p).tIndex).sort().join() === '0,2,4' && group(id).length === 3);
    canvas.discardActiveObject();
    row = panelRow(group(copyId)[0], 0);
    row.querySelector('.ch-max-val').value = '1234'; row.querySelector('.ch-max-val').dispatchEvent(new Event('change'));
    assert('…linked to each other, not to the original', group(copyId).every(p => rawOf(p).channels[0].max === 1234) && group(id).every(p => rawOf(p).channels[0].max === 1500));
    canvas.remove(...group(copyId)); MFC.pushHistory(); canvas.discardActiveObject();

    // ---- template frame and replace ----
    const json = MFC_PROJECT.captureState().objects.find(o => o.mfcId === group(id)[2].mfcId);
    const asFrame = TM.imageToFrame(json);
    assert('A template keeps a series panel as a frame of the time series, at its place', asFrame.mfcFrameT === 2 && asFrame.mfcFrameGroup === id);
    await R.replaceImage(group(id)[0], makeTiff('shorter.tif', { T: 4 }), { carry: false }); await idle();
    panels = group(id);
    assert('Replacing the image keeps each panel\'s frame (the last one when the new file has fewer)', panels.length === 3 && panels.map(p => rawOf(p).tIndex).join() === '0,2,3' &&
      panels.every(p => /shorter\.tif/.test(p.mfcFileName)) && panels[2].mfcFileName === 'shorter.tif (frame 4)', panels.map(p => p.mfcFileName).join());

    // ================= A Z grid, through the API; fitted to the page =================
    const zimg = await importOne(makeTiff('stack.tif', { C: 1, Z: 5, T: 1 }), { left: 40, top: 400, scaleX: 8, scaleY: 8 });
    const zsteps = MFC.getHistory().labels.length;
    const zpanels = await S.seriesMontage(zimg, { axis: 'z', from: 1, to: 5, step: 1, columns: 3, gapMm: 2 }); await idle();
    const zw = zimg.getScaledWidth(), zh = zimg.getScaledHeight(), g2 = mm(2);
    assert('Five Z slices in a grid of 3 columns: rows 1 and 2', zpanels.length === 5 && zpanels.map(p => `${p.mfcMontageRow}${p.mfcMontageColumn}`).join() === '00,01,02,10,11');
    assert('Each shows its slice (not a projection)', zpanels.every((p, i) => rawOf(p).zMode === 'slice' && rawOf(p).zIndex === i && value(p) === 100 + 100 * i));
    assert('Labelled with their depth in µm', zpanels.map(p => labelOf(p).text).join() === 'z = 0 µm,z = 0.5 µm,z = 1 µm,z = 1.5 µm,z = 2 µm');
    assert('Laid out in rows and columns 2 mm apart', zpanels.every(p => near(p.left, 40 + p.mfcMontageColumn * (zw + g2)) && near(p.top, 400 + p.mfcMontageRow * (zh + g2))));
    const fit = Math.min(1, (1200 - 80 - 2 * g2) / (3 * 320), (900 - 400 - 40 - g2) / (2 * 240));
    assert('Scaled down to fit the page, with the left margin also on the right and below', fit < 1 && near(zw, 320 * fit, 0.5) && near(zh, 240 * fit, 0.5), `${zw.toFixed(1)} × ${zh.toFixed(1)}`);
    assert('…fully inside the page', zpanels.every(p => { const b = p.getBoundingRect(true, true); return b.left + b.width <= 1200.5 && b.top + b.height <= 900.5; }));
    assert('One History step', MFC.getHistory().labels.length === zsteps + 1);
    canvas.setActiveObject(zpanels[4]); MFC.setTool('crop');
    $('crop-mode-rect').click();
    $('crop-width').value = '100'; $('crop-height').value = '100';
    $('crop-width').focus(); MFC.applyCropFieldsToRect(); MFC.applyCrop(); MFC.setTool('select'); await idle();
    const cw2 = zpanels[4].getScaledWidth(), ch2 = zpanels[4].getScaledHeight();
    assert('Cropping a panel of the second row crops all, and the grid is laid out again from its corner', zpanels.every(p => p.width === zpanels[4].width && near(cw2, 100, 1) && near(p.left, 40 + p.mfcMontageColumn * (cw2 + g2)) && near(p.top, 400 + p.mfcMontageRow * (ch2 + g2))),
      zpanels.map(p => `${p.left.toFixed(1)},${p.top.toFixed(1)}`).join(' '));
    canvas.setActiveObject(zpanels[1]);
    await MFC.applyStackPlane({ zMode: 'max' }, true); await idle();
    assert('A Z display change on a Z-series panel is that panel\'s own', rawOf(zpanels[1]).zMode === 'max' && rawOf(zpanels[0]).zMode === 'slice' && labelOf(zpanels[1]).text === 'MIP z 0–2 µm');
    await MFC.undo(); await idle();
    await MFC.undo(); await idle();
    await MFC.undo(); await idle();
    assert('Undo removes the whole montage and its labels in one step', !canvas.getObjects().some(o => o.mfcMontageGroup && o.mfcSeries && o.mfcSeries.axis === 'z') &&
      canvas.getObjects().filter(o => o.mfcAutoLabel && /^z = /.test(o.text)).length === 0 && canvas.getObjects().some(o => o.mfcId === zimg.mfcId));

    // ---- options: no labels, part of the range ----
    const zimg2 = canvas.getObjects().find(o => o.mfcId === zimg.mfcId);
    const few = await S.seriesMontage(zimg2, { axis: 'z', from: 2, to: 5, step: 2, labels: false }); await idle();
    assert('Slices 2 to 5 every 2: slices 2 and 4, without labels', few.map(p => rawOf(p).zIndex).join() === '1,3' && few.every(p => !labelOf(p)));

    // ---- a Z series of a time series: a frame chosen on one panel reaches all ----
    const both = await importOne(makeTiff('both.tif'), { left: 600, top: 700, scaleX: 1, scaleY: 1 });
    const zt = await S.seriesMontage(both, { axis: 'z', step: 2 }); await idle();
    canvas.setActiveObject(zt[1]);
    await MFC.applyStackPlane({ tIndex: 3 }, true); await idle();
    assert('A frame chosen on one panel of a Z series shows on all, each keeping its slice', zt.every(p => rawOf(p).tIndex === 3) && zt.map(p => rawOf(p).zIndex).join() === '0,2,4' &&
      zt.map(p => value(p)).join() === '130,330,530', zt.map(p => value(p)).join());
    canvas.discardActiveObject();

    // ================= Refusals =================
    const fails = async (fn, re) => { try { await fn(); return false; } catch (e) { return re.test(e.message); } };
    const flat = await importOne(makeTiff('flat.tif', { C: 1, Z: 1, T: 1 }), { left: 900, top: 700, scaleX: 2, scaleY: 2 });
    assert('A single plane is refused: not a Z stack or a time series', await fails(() => S.seriesMontage(flat, {}), /not a Z stack or a time series/));
    assert('An image already in a montage is refused', await fails(() => S.seriesMontage(few[1], { axis: 'z' }), /already part of a quick figure or series montage/));
    const tonly = await importOne(makeTiff('tonly.tif', { C: 1, Z: 1, T: 3 }), { left: 900, top: 800, scaleX: 2, scaleY: 2, angle: 0 });
    assert('A Z series of a time series without Z is refused', await fails(() => S.seriesMontage(tonly, { axis: 'z' }), /not a Z stack/));
    assert('A range outside the series is refused with its message', await fails(() => S.seriesMontage(tonly, { axis: 't', to: 9 }), /last frame between 1 and 3/));
    tonly.set({ angle: 15 }); tonly.setCoords();
    assert('A rotated image is refused', await fails(() => S.seriesMontage(tonly, { axis: 't' }), /rotated/) && !tonly.mfcMontageGroup);
    canvas.setActiveObject(flat); $('toast').textContent = ''; button.click();
    assert('The dialog does not open for a single plane, and says why', !document.querySelector('.series-backdrop') && /flat\.tif is not a Z stack or a time series/.test(toastText()));
  } finally {
    document.querySelectorAll('.series-backdrop').forEach(b => b.remove());
  }
  return checks;
}

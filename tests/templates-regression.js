/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T6: templates and image replacement, in the editor (the pure part: tests/templates-model-regression.mjs).
   - Replace image keeps the panel's frame, letter, labels, grid cell, scale bar and insets and swaps the
     source; dropping a file on a panel does the same (and is not an import); undo and redo; the
     channel settings dialog (keep by name, or the new file's; keyboard); a quick-figure row is
     replaced as a whole;
   - Save as template keeps layout, styles and labels without image data; From template opens it with
     empty frames; dropping a file fills a frame (and its inset); empty frames are not exported and the
     figure check lists them;
   - the five built-in templates: split channels from one file, a comparison group, time and Z strips
     with their labels, an image with its inset; the dialog and the Fill frame button. */
async function runTemplatesRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), reg = MFC.getRegistry(), near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const byId = id => canvas.getObjects().find(o => o.mfcId === id) || null;
  const box = o => o.getBoundingRect(true, true);
  const sameBox = (a, b, tol = 1) => near(a.left, b.left, tol) && near(a.top, b.top, tol) && near(a.width, b.width, tol) && near(a.height, b.height, tol);
  const R = await import(new URL('js/image/replace.js', document.baseURI).href);
  const TU = await import(new URL('js/ui/templates.js', document.baseURI).href);
  const TM = await import(new URL('js/layout/template-model.js', document.baseURI).href);
  const GR = await import(new URL('js/layout/grid.js', document.baseURI).href);
  const LT = await import(new URL('js/layout/letters.js', document.baseURI).href);
  const FC = await import(new URL('js/ui/figure-check.js', document.baseURI).href);
  const MT = await import(new URL('js/image/montage.js', document.baseURI).href);
  const toasts = [], toast = MFC_UI.toast;
  MFC_UI.toast = message => { toasts.push(String(message)); };
  try {
    /** An ImageJ hyperstack (16-bit, big-endian, uncompressed): every plane p holds 100 × (p + 1) plus a ramp. */
    const tiff = (name, { w = 120, h = 90, c = 1, z = 1, t = 1 } = {}) => {
      const n = c * z * t;
      const desc = new TextEncoder().encode(`ImageJ=1.54p\nimages=${n}\nchannels=${c}\nslices=${z}\nframes=${t}\n${n > 1 ? 'hyperstack=true\n' : ''}mode=composite\n\0`);
      const tags = 10, planeBytes = w * h * 2;
      let size = 8 + desc.length;
      const layout = Array.from({ length: n }, () => { const ifd = size; size += 2 + tags * 12 + 4; const data = size; size += planeBytes; return { ifd, data }; });
      const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
      u8.set([0x4d, 0x4d]); dv.setUint16(2, 42); dv.setUint32(4, layout[0].ifd); u8.set(desc, 8);
      layout.forEach(({ ifd, data }, p) => {
        let q = ifd; dv.setUint16(q, tags); q += 2;
        const tag = (id, type, count, value) => { dv.setUint16(q, id); dv.setUint16(q + 2, type); dv.setUint32(q + 4, count); if (type === 3 && count === 1) dv.setUint16(q + 8, value); else dv.setUint32(q + 8, value); q += 12; };
        tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 16); tag(259, 3, 1, 1); tag(262, 3, 1, 1); tag(270, 2, desc.length, 8);
        tag(273, 4, 1, data); tag(277, 3, 1, 1); tag(278, 4, 1, h); tag(279, 4, 1, planeBytes);
        dv.setUint32(q, p < n - 1 ? layout[p + 1].ifd : 0);
        for (let k = 0; k < w * h; k++) dv.setUint16(data + k * 2, 100 * (p + 1) + (k % w));
      });
      return new File([buf], name, { type: 'image/tiff' });
    };
    /** Drops files at a page point, as a user does. */
    const dropAt = (point, files) => {
      const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
      const el = canvas.upperCanvasEl, rect = el.getBoundingClientRect(), vpt = canvas.viewportTransform;
      const p = fabric.util.transformPoint(point, vpt), k = rect.width / (el.width / (canvas.getRetinaScaling ? canvas.getRetinaScaling() : 1));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + p.x * k, clientY: rect.top + p.y * k }));
    };
    const until = async (test, what) => { for (let i = 0; i < 400; i++) { if (test()) { await MFC_TIFF.whenIdle(); await frame(); return; } await new Promise(r => setTimeout(r, 10)); } throw new Error('Timed out waiting: ' + what + ' ' + [...document.querySelectorAll('.error-title, .error-message')].map(e => e.textContent).join(' / ') + ' | ' + toasts.slice(-2).join(' | ')); };

    // ================= Replace image =================
    const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
    await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
    document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
    await MFC_TIFF.whenIdle();
    canvas.discardActiveObject();
    let img1 = byId('img1');
    LT.addLetters([img1]);
    const letter = () => LT.letterOf(byId('img1'));
    const before = { box: box(img1), source: reg.img1.sourceId, raw: img1.mfcRawWidth, contour: box(byId('refContour')), inset: box(byId('img3')), insetSource: reg.img3.sourceId,
      letter: letter().text, letterBox: box(letter()), objects: canvas.getObjects().length };
    assert('Setting up: img1 has an inset (img3), a scale bar (sb4) and a letter', byId('sb4').mfcAttachedTo === 'img1' && byId('img3').mfcInsetSourceId === 'img1' && !!before.letter);

    toasts.length = 0;
    await R.replaceImage(img1, tiff('replacement.tif', { w: 200, h: 100, c: 2 }), { carry: false });
    await MFC_TIFF.whenIdle(); await frame();
    img1 = byId('img1');
    assert('The panel keeps its id and its frame on the page', img1 && sameBox(box(img1), before.box), JSON.stringify([box(img1), before.box]));
    assert('It shows the new file: new source, its size, its name; the centre of the file fills the frame', reg.img1.sourceId !== before.source && MFC_PROJECT.sources.has(reg.img1.sourceId) &&
      img1.mfcRawWidth === 200 && img1.mfcFileName === 'replacement.tif' && near(img1.width / img1.height, before.box.width / before.box.height, 0.02) && near(img1.cropX, (200 - img1.width) / 2, 0.6));
    assert('Its letter stays, with the same text, on its corner', letter() && letter().text === before.letter && sameBox(box(letter()), before.letterBox, 1.5));
    assert('Its inset outline stays where it was on the page', sameBox(box(byId('refContour')), before.contour), JSON.stringify([box(byId('refContour')), before.contour, before.box]));
    assert('Its inset shows the new file, at the same size, from the outline', reg.img3.sourceId === reg.img1.sourceId && sameBox(box(byId('img3')), before.inset) &&
      near(byId('img3').cropX, byId('refContour').mfcCropX, 0.01) && near(byId('img3').width, byId('refContour').mfcCropW, 0.01));
    assert('Its scale bar stays attached; the file has no pixel size, which the user is told', byId('sb4').mfcAttachedTo === 'img1' && toasts.some(t => /no pixel size/.test(t)), toasts.join(' | '));
    assert('Nothing was added or removed', canvas.getObjects().length === before.objects);
    await MFC.undo(); await MFC_TIFF.whenIdle();
    assert('Undo brings the old source back', reg.img1.sourceId === before.source && byId('img1').mfcRawWidth === before.raw && reg.img3.sourceId === before.insetSource);
    await MFC.redo(); await MFC_TIFF.whenIdle();
    assert('Redo shows the new file again', reg.img1.sourceId !== before.source && byId('img1').mfcRawWidth === 200);

    // Dropping a file on a panel in a grid replaces it there.
    let img2 = byId('img2');
    const grid = GR.createGrid([img2], { rows: 1, cols: 1, cellW: 40, cellH: 30, mode: 'fit' });
    const cell = box(grid), count = canvas.getObjects().length, source2 = reg.img2.sourceId;
    canvas.discardActiveObject();
    dropAt(byId('img2').getCenterPoint(), [tiff('dropped.tif', { w: 60, h: 120, c: 2 })]);
    await until(() => reg.img2 && reg.img2.sourceId !== source2, 'the drop');
    img2 = byId('img2');
    assert('Dropping a file on a panel replaces it (no new image is imported)', canvas.getObjects().length === count && img2.mfcFileName === 'dropped.tif' && img2.mfcRawHeight === 120);
    const inside = box(img2);
    assert('It stays in its grid cell, fitted to it', GR.gridOfPanel(img2) === grid && inside.left >= cell.left - 1 && inside.top >= cell.top - 1 &&
      inside.left + inside.width <= cell.left + cell.width + 1 && inside.top + inside.height <= cell.top + cell.height + 1);

    // Channel settings with the same names: the dialog.
    reg.img2.rawImage.channels[0].color = 'magenta'; reg.img2.rawImage.channels[0].max = 321;
    const asking = R.replaceImage(img2, tiff('again.tif', { w: 60, h: 120, c: 2 }));
    await until(() => document.querySelector('.replace-backdrop'), 'the dialog');
    const dialog = document.querySelector('.replace-backdrop');
    assert('Same channel names: a dialog offers to keep their settings, naming them; Keep has the focus; both buttons have titles', /same names/.test(dialog.textContent) &&
      document.activeElement === dialog.querySelector('#replace-keep') && !!dialog.querySelector('#replace-keep').title && !!dialog.querySelector('#replace-fresh').title && dialog.querySelector('[role="dialog"]'),
      (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) + ' ' + dialog.textContent.slice(0, 120));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    assert('Tab moves between its two buttons', document.activeElement === dialog.querySelector('#replace-fresh'));
    dialog.querySelector('#replace-keep').click();
    await asking; await MFC_TIFF.whenIdle();
    assert('Keep settings: the channel keeps its LUT and range', reg.img2.rawImage.channels[0].color === 'magenta' && reg.img2.rawImage.channels[0].max === 321 && byId('img2').mfcFileName === 'again.tif');
    const fresh = R.replaceImage(byId('img2'), tiff('third.tif', { w: 60, h: 120, c: 2 }));
    await until(() => document.querySelector('.replace-backdrop'), 'the dialog');
    document.querySelector('.replace-backdrop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fresh; await MFC_TIFF.whenIdle();
    assert('Esc (the new file\'s settings): the file\'s own colour and range', !document.querySelector('.replace-backdrop') && reg.img2.rawImage.channels[0].color !== 'magenta' && reg.img2.rawImage.channels[0].max !== 321);

    // The selection bar's button.
    canvas.setActiveObject(byId('img2')); canvas.fire('selection:created', { selected: [byId('img2')] }); await frame();
    const button = document.getElementById('obj-replace-image');
    assert('One image selected: "Replace image…" in the selection bar, with a title', !button.classList.contains('hidden') && button.textContent === 'Replace image…' && !!button.title);
    canvas.discardActiveObject(); canvas.fire('selection:cleared'); await frame();
    assert('Nothing selected: no button', button.classList.contains('hidden'));

    // A quick-figure row is replaced as a whole.
    canvas.discardActiveObject();
    await MFC.importFiles([tiff('three.tif', { w: 80, h: 80, c: 3 })]); await MFC_TIFF.whenIdle();
    const three = canvas.getObjects().filter(o => o.mfcFileName === 'three.tif').pop();
    const [row] = MT.quickFigure([three], { grey: true, mergeFirst: false, gapMm: 1, channels: [0, 1, 2] }); await MFC_TIFF.whenIdle();
    const members = canvas.getObjects().filter(o => o.mfcMontageGroup === row && o.mfcType === 'mfcImage');
    await R.replaceImage(members[1], tiff('three-new.tif', { w: 80, h: 80, c: 3 }), { carry: false }); await MFC_TIFF.whenIdle();
    const after = canvas.getObjects().filter(o => o.mfcMontageGroup === row && o.mfcType === 'mfcImage');
    assert('Replacing one quick-figure panel replaces its row: every panel the new file, each its channel, in grey', after.length === 4 && new Set(after.map(o => reg[o.mfcId].sourceId)).size === 1 &&
      after.every(o => /three-new/.test(o.mfcFileName)) && after.filter(o => o.mfcMontageChannel >= 0).every(o => reg[o.mfcId].rawImage.channels.filter(c => c.enabled).length === 1 &&
        reg[o.mfcId].rawImage.channels[o.mfcMontageChannel].enabled && reg[o.mfcId].rawImage.channels[o.mfcMontageChannel].color === 'grey'),
      JSON.stringify(after.map(o => [o.mfcFileName, o.mfcMontageChannel, reg[o.mfcId].sourceId.slice(0, 9), reg[o.mfcId].rawImage.channels.map(c => (c.enabled ? 1 : 0) + c.color)])));

    // ================= Save as template =================
    let saved = null;
    const download = MFC_EXPORT.download;
    MFC_EXPORT.download = async (blob, name) => { saved = { name, text: await blob.text() }; };
    reg.img1.rawImage.channels[0].color = 'cyan'; // remembered by its frame
    try { TU.saveAsTemplate(); await until(() => saved, 'the template file'); } finally { MFC_EXPORT.download = download; }
    const template = JSON.parse(saved.text);
    const imagesBefore = canvas.getObjects().filter(o => o.mfcType === 'mfcImage').length;
    assert('Save as template writes a .fftemplate.json file named after the figure', /\.fftemplate\.json$/.test(saved.name) && template.format === 'fluoforge-template' && TM.templateProblems(template).length === 0, saved.name);
    assert('It has no image data: no image, source, display settings or file name', !TM.holdsImageData(template.objects) && !/"sourceId"|"display"|mfcFileName|replacement\.tif|data:image/.test(saved.text));
    assert('Each image is an empty frame; text, the grid, letters, the outline and the scale bar are kept', template.objects.filter(o => o.mfcType === 'imageFrame').length === imagesBefore &&
      template.objects.some(o => o.mfcType === 'layoutGrid') && template.objects.some(o => o.mfcLetterFor === 'img1') && template.objects.some(o => o.mfcId === 'refContour') &&
      template.objects.some(o => o.mfcId === 'sb4') && template.objects.some(o => o.text === MFC_PROJECT.captureState().objects.find(x => x.mfcId === 'refTextbox').text));

    // ================= From template =================
    await TU.openTemplate(template); await MFC_TIFF.whenIdle(); await frame();
    const frames = () => canvas.getObjects().filter(o => o.mfcType === 'imageFrame');
    assert('The template opens as a new figure with empty frames and no images', frames().length === imagesBefore && !canvas.getObjects().some(o => o.mfcType === 'mfcImage') &&
      !MFC_PROJECT.hasUnsavedChanges() === false && MFC.getDocProps().name === template.name);
    assert('Its labels and letters are there; the letter on its frame', canvas.getObjects().some(o => o.mfcId === 'refTextbox') && LT.letterOf(byId('img1')) && LT.letterOf(byId('img1')).text === before.letter);
    const svg = await MFC_EXPORT.buildSVG({ page: 0 });
    assert('Empty frames are not exported', !/8a94a6/i.test(svg) && !/<image/.test(svg));
    const findings = FC.checkFigure().filter(f => f.rule === 'empty-frame');
    assert('The figure check lists each empty frame on a page', findings.length >= 2 && findings.every(f => f.severity === 'info'), findings.length);
    canvas.setActiveObject(byId('img1')); canvas.fire('selection:created', { selected: [byId('img1')] }); await frame();
    assert('A frame selected: "Fill frame…" in the selection bar', !button.classList.contains('hidden') && button.textContent === 'Fill frame…');
    canvas.discardActiveObject();
    const frameBox = box(byId('img1')), insetBox = box(byId('img3'));
    canvas.bringToFront(byId('img1')); // the quick-figure row imported above lies over it
    dropAt(byId('img1').getCenterPoint(), [tiff('filled.tif', { w: 150, h: 150, c: 2 })]);
    await until(() => document.querySelector('.replace-backdrop'), 'the settings dialog');
    assert('The frame remembers the channel settings of its image: the dialog offers them for the same channel names', /same names/.test(document.querySelector('.replace-backdrop').textContent));
    document.querySelector('#replace-keep').click();
    await until(() => byId('img1') && byId('img1').mfcType === 'mfcImage', 'filling the frame');
    await until(() => byId('img3') && byId('img3').mfcType === 'mfcImage', 'filling the inset');
    assert('Dropping a file fills the frame: an image with the frame\'s id, place and size', sameBox(box(byId('img1')), frameBox) && byId('img1').mfcFileName === 'filled.tif');
    assert('Keep settings: the channel takes the colour its frame remembered', reg.img1.rawImage.channels[0].color === 'cyan');
    assert('Its inset frame fills from the outline, inside its frame', byId('img3').mfcIsInset && byId('img3').mfcInsetContourId === 'refContour' && reg.img3.sourceId === reg.img1.sourceId &&
      box(byId('img3')).width <= insetBox.width + 1 && box(byId('img3')).height <= insetBox.height + 1);
    assert('The letter and the scale bar are linked to the new image', LT.letterOf(byId('img1')).text === before.letter && byId('sb4').mfcAttachedTo === 'img1');
    await MFC.undo(); await MFC_TIFF.whenIdle();
    assert('Undo empties the frames again', byId('img1').mfcType === 'imageFrame' && byId('img3').mfcType === 'imageFrame');
    const state = MFC_PROJECT.captureState();
    await MFC_PROJECT.restoreState(JSON.parse(JSON.stringify(state)), { resetHistory: false }); await frame();
    assert('Saved and reopened, the frames stay frames with their hints', frames().length === imagesBefore && frames().every(f => f.__mfcFrameInstalled));

    // ================= Built-in templates =================
    await TU.openBuiltIn('split-channels'); await frame();
    assert('Split channels: four frames', frames().length === 4);
    dropAt(frames()[1].getCenterPoint(), [tiff('cells.tif', { c: 3 })]);
    await until(() => !frames().length, 'filling the row');
    const split = canvas.getObjects().filter(o => o.mfcType === 'mfcImage');
    const shown = o => reg[o.mfcId].rawImage.channels.map((c, i) => (c.enabled ? i : '')).join('');
    assert('One file fills all four: channels 1, 2 and 3 in grey and the merge, one source', split.length === 4 && split.map(shown).join() === '0,1,2,012' &&
      split.slice(0, 3).every((o, i) => reg[o.mfcId].rawImage.channels[i].color === 'grey') && new Set(split.map(o => reg[o.mfcId].sourceId)).size === 1,
      JSON.stringify(split.map(o => [o.mfcId, shown(o), reg[o.mfcId].rawImage.channels.map(c => c.color)])) + toasts.slice(-1));

    await TU.openBuiltIn('comparison-2x3'); await frame();
    dropAt(frames()[0].getCenterPoint(), [tiff('control.tif')]);
    await until(() => frames().length === 5, 'filling one frame');
    assert('2 × 3 comparison: a file fills its own frame, which is in comparison group 1', canvas.getObjects().filter(o => o.mfcType === 'mfcImage' && o.mfcCompareGroup === 1).length === 1);

    for (const [id, key, word] of [['time-series', 't', 'Frame'], ['z-series', 'z', 'Slice']]) {
      await TU.openBuiltIn(id); await frame();
      dropAt(frames()[2].getCenterPoint(), [tiff(id + '.tif', key === 't' ? { t: 9 } : { z: 5 })]);
      await until(() => !frames().length, 'filling the strip');
      const panels = canvas.getObjects().filter(o => o.mfcType === 'mfcImage').sort((a, b) => a.left - b.left);
      const planes = panels.map(o => (key === 't' ? reg[o.mfcId].rawImage.tIndex : reg[o.mfcId].rawImage.zIndex));
      const expected = key === 't' ? [0, 2, 4, 6, 8] : [0, 1, 2, 3, 4];
      assert(`${word === 'Frame' ? 'Time series' : 'Z series'} strip: five panels of one file, spread over the ${key === 't' ? 'time points' : 'slices'}`,
        panels.length === 5 && planes.join() === expected.join() && panels.every((o, i) => reg[o.mfcId].rawImage.channels[0].data[0] === 100 * (expected[i] + 1)), planes.join());
      const labels = canvas.getObjects().filter(o => o.mfcFrameSeriesLabel).sort((a, b) => a.left - b.left).map(o => o.text);
      assert(`Its labels name the ${key === 't' ? 'frames' : 'slices'} shown`, labels.join() === expected.map(n => `${word} ${n + 1}`).join(), labels.join());
    }

    await TU.openBuiltIn('single-inset'); await frame();
    dropAt(frames()[0].getCenterPoint(), [tiff('tissue.tif', { w: 200, h: 200 })]);
    await until(() => !frames().length, 'filling the image and its inset');
    const insetImg = canvas.getObjects().find(o => o.mfcIsInset);
    assert('Single image with inset: the image, and its inset from the outline', canvas.getObjects().filter(o => o.mfcType === 'mfcImage').length === 2 && insetImg &&
      byId(insetImg.mfcInsetContourId).mfcInsetSourceId === canvas.getObjects().find(o => o.mfcType === 'mfcImage' && !o.mfcIsInset).mfcId);
    assert('Both are lettered A and B', canvas.getObjects().filter(o => o.mfcLetterFor).map(o => o.text).sort().join() === 'A,B');

    // ================= The dialog =================
    document.getElementById('btn-new-from-template').click();
    const tdialog = document.querySelector('.template-backdrop');
    const radios = [...tdialog.querySelectorAll('input[name="template"]')];
    assert('From template: a dialog with the five built-ins (titled), a template file button, focus on the first', radios.length === 5 && radios.every(r => r.closest('label').title) &&
      document.activeElement === radios[0] && !!tdialog.querySelector('#template-file').title && !!document.getElementById('btn-new-from-template').title && !!document.getElementById('btn-save-template').title);
    tdialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert('Esc closes it', !document.querySelector('.template-backdrop'));
    document.getElementById('btn-new-from-template').click();
    document.querySelector('#template-comparison-2x3').checked = true;
    document.querySelector('#template-ok').click();
    await until(() => !document.querySelector('.template-backdrop'), 'the template');
    assert('Create opens the chosen template', frames().length === 6 && MFC.getDocProps().name === '2 × 3 comparison');
    let error = '';
    try { await TU.openTemplate({ ...template, objects: [{ type: 'image', mfcType: 'mfcImage', sourceId: 'x', mfcId: 'img1' }] }); } catch (e) { error = e.message; }
    assert('A template holding image data is refused', /image data/.test(error), error);
  } finally {
    MFC_UI.toast = toast;
  }
  return checks;
}

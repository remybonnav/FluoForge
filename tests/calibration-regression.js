/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T9a: calibration in the Channels panel (the pure part: tests/calibration-model-regression.mjs).
   - Z step and frame interval fields next to the pixel size, for Z stacks and time series only;
   - a value that is not the file's shows a warning under its field, with "Use file value";
   - the Z and time labels follow a typed value; the file's own value or an empty field goes back to
     the file; one History step; the panels of a series montage share a typed value;
   - several selected images, a file without a value, Image info, save and reopen;
   - the Annotate panel has no interval field any more. */
async function runCalibrationRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas();
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const A = await import(new URL('js/tools/annotate.js', document.baseURI).href);
  const S = await import(new URL('js/image/series.js', document.baseURI).href);
  const INFO = await import(new URL('js/ui/image-info.js', document.baseURI).href);
  const reg = MFC.getRegistry(), rawOf = o => reg[o.mfcId].rawImage;
  const idle = async () => { await MFC_TIFF.whenIdle(); await frame(); };

  // An ImageJ hyperstack, 1 channel × Z × T, with a 0.5 µm pixel (XResolution 2 per micron), and,
  // unless left out, a 0.5 µm Z step and 30 s between frames.
  const makeTiff = (name, { Z = 4, T = 5, w = 24, h = 16, spacing = 0.5, finterval = 30 } = {}) => {
    const desc = new TextEncoder().encode(`ImageJ=1.54p\nimages=${Z * T}\nslices=${Z}\nframes=${T}\nhyperstack=true\n` +
      (spacing ? `spacing=${spacing}\n` : '') + 'unit=micron\n' + (finterval ? `finterval=${finterval}\n` : '') + 'min=0.0\nmax=1000.0\n\0');
    const pages = Z * T, tagCount = 11, ifdSize = 2 + tagCount * 12 + 4, planeBytes = w * h * 2;
    const rational = 8 + desc.length;
    let size = rational + 8;
    const layout = Array.from({ length: pages }, () => { const ifd = size; size += ifdSize; const data = size; size += planeBytes; return { ifd, data }; });
    const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
    u8.set([0x49, 0x49]); dv.setUint16(2, 42, true); dv.setUint32(4, layout[0].ifd, true); u8.set(desc, 8);
    dv.setUint32(rational, 2, true); dv.setUint32(rational + 4, 1, true);
    layout.forEach(({ ifd, data }, i) => {
      let p = ifd; dv.setUint16(p, tagCount, true); p += 2;
      const tag = (id, type, count, value) => { dv.setUint16(p, id, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true);
        if (type === 3 && count === 1) dv.setUint16(p + 8, value, true); else dv.setUint32(p + 8, value, true); p += 12; };
      tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 16); tag(259, 3, 1, 1); tag(262, 3, 1, 1); tag(270, 2, desc.length, 8);
      tag(273, 4, 1, data); tag(277, 3, 1, 1); tag(278, 4, 1, h); tag(279, 4, 1, planeBytes); tag(282, 5, 1, rational);
      dv.setUint32(p, i + 1 < pages ? layout[i + 1].ifd : 0, true);
      for (let k = 0; k < w * h; k++) dv.setUint16(data + k * 2, 100 + k % 9, true);
    });
    return new File([buf], name, { type: 'image/tiff' });
  };
  const importOne = async (file, at) => {
    const before = new Set(canvas.getObjects());
    await MFC.importFiles([file]); await MFC_TIFF.whenIdle();
    const img = canvas.getObjects().find(o => !before.has(o) && o.mfcType === 'mfcImage');
    img.set(at); img.setCoords(); MFC.pushHistory();
    return img;
  };
  const select = async (...images) => {
    canvas.discardActiveObject();
    if (images.length === 1) canvas.setActiveObject(images[0]);
    else canvas.setActiveObject(new fabric.ActiveSelection(images, { canvas }));
    MFC.refreshChannelPanel(); await frame();
  };
  const type = async (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event('change')); await idle(); };
  const shown = id => !$(id).classList.contains('hidden') && !$(id).closest('.hidden');
  const warning = field => (shown(`ch-${field}-warn-row`) ? $(`ch-${field}-warn`).textContent : '');
  const labelOf = (img, kind) => canvas.getObjects().find(o => o.mfcAutoLabel && o.mfcAutoLabel.for === img.mfcId && o.mfcAutoLabel.kind === kind);
  const reopen = async name => {
    const next = MFC_PROJECT.prepareSave(true, name), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
    await MFC.closeDocument();
    await MFC_PROJECT.loadProject(new File([archive], name + '.fluoforge'));
    document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
    await idle();
  };

  await MFC_PROJECT.createProject({ name: 'Calibration', width: 1200, height: 900, unit: 'px', dpi: 300 });
  await frame();

  // ================= The fields =================
  const img = await importOne(makeTiff('cells.tif'), { left: 60, top: 60, scaleX: 8, scaleY: 8 });
  await select(img);
  A.addAutoLabel('z', [img]); A.addAutoLabel('time', [img]);
  const zLabel = () => labelOf(img, 'z'), tLabel = () => labelOf(img, 'time');
  MFC.applyStackPlane({ zMode: 'slice', zIndex: 2, tIndex: 3 }, true); await idle();
  assert('The file\'s values are read: 0.5 µm/px, Z step 0.5 µm, 30 s', rawOf(img).voxelSizeUm === 0.5 && rawOf(img).stack.zStepUm === 0.5 && rawOf(img).stack.frameIntervalS === 30);
  assert('Labels from the file: z = 1 µm and t = 1:30 min', zLabel().text === 'z = 1 µm' && tLabel().text === 't = 1:30 min', zLabel().text + ' / ' + tLabel().text);
  assert('A Z stack and time series shows the Z step and frame interval fields next to the pixel size',
    shown('ch-zstep-row') && shown('ch-finterval-row') && $('ch-zstep').value === '0.5' && $('ch-finterval').value === '30' && $('ch-pixelsize').value === '0.5');
  assert('Every new control has a title', ['ch-zstep', 'ch-finterval', 'ch-pixelsize', 'ch-zstep-reset', 'ch-finterval-reset', 'ch-pixelsize-reset'].every(id => $(id).title));
  assert('The file\'s values: no warning', !warning('pixelsize') && !warning('zstep') && !warning('finterval'));
  assert('The Annotate panel has no frame interval field any more', !$('annotate-interval'));

  // ---- Z step ----
  await type('ch-zstep', '0.75');
  assert('A typed Z step is kept on the image and the Z label follows: z = 1.5 µm', img.mfcZStepUm === 0.75 && zLabel().text === 'z = 1.5 µm', zLabel().text);
  assert('…and a warning under the field gives the file\'s value', warning('zstep') === 'Differs from the file: the file says 0.5 µm.', warning('zstep'));
  assert('…with a "Use file value" button', shown('ch-zstep-reset') && $('ch-zstep-reset').textContent === 'Use file value');
  assert('The panel\'s Z line says the Z step in use', /Z step 0\.75 µm/.test($('ch-stack-info').textContent), $('ch-stack-info').textContent);
  await MFC.undo(); await idle(); await select(canvas.getObjects().find(o => o.mfcId === img.mfcId));
  let im = canvas.getActiveObject();
  assert('One undo goes back to the file\'s Z step, label and no warning', !('mfcZStepUm' in im) && labelOf(im, 'z').text === 'z = 1 µm' && !warning('zstep'), labelOf(im, 'z').text);
  await MFC.redo(); await idle(); await select(canvas.getObjects().find(o => o.mfcId === img.mfcId)); im = canvas.getActiveObject();
  assert('Redo brings it back, with its warning', im.mfcZStepUm === 0.75 && /Differs from the file/.test(warning('zstep')));
  $('ch-zstep-reset').click(); await idle();
  assert('"Use file value" goes back to the file\'s Z step: no override, no warning', !('mfcZStepUm' in im) && $('ch-zstep').value === '0.5' && !warning('zstep') && labelOf(im, 'z').text === 'z = 1 µm');
  await type('ch-zstep', '0.5');
  assert('Typing the file\'s own value stores nothing and warns of nothing', !('mfcZStepUm' in im) && !warning('zstep'));
  await type('ch-zstep', '0.75'); await type('ch-zstep', '');
  assert('An empty field goes back to the file\'s Z step', !('mfcZStepUm' in im) && $('ch-zstep').value === '0.5' && !warning('zstep'));

  // ---- frame interval ----
  await type('ch-finterval', '2');
  assert('A typed frame interval: t = 6 s, kept on the image, with a warning', im.mfcTimeIntervalS === 2 && labelOf(im, 'time').text === 't = 6 s' &&
    warning('finterval') === 'Differs from the file: the file says 30 s.', labelOf(im, 'time').text + ' / ' + warning('finterval'));
  $('ch-finterval-reset').click(); await idle();
  assert('"Use file value" goes back to 30 s', !('mfcTimeIntervalS' in im) && labelOf(im, 'time').text === 't = 1:30 min' && !warning('finterval'));

  // ---- pixel size ----
  await type('ch-pixelsize', '0.6');
  assert('A typed pixel size warns that the file says otherwise', rawOf(im).voxelSizeUm === 0.6 && warning('pixelsize') === 'Differs from the file: the file says 0.5 µm/px.', warning('pixelsize'));
  $('ch-pixelsize-reset').click(); await idle();
  assert('"Use file value" sets the file\'s pixel size again, without a warning', rawOf(im).voxelSizeUm === 0.5 && $('ch-pixelsize').value === '0.5' && !warning('pixelsize'));
  await type('ch-pixelsize', '');
  assert('A cleared pixel size warns too: the file has one', rawOf(im).voxelSizeUm == null && warning('pixelsize') === 'No value set: the file says 0.5 µm/px.', warning('pixelsize'));
  $('ch-pixelsize-reset').click(); await idle();

  // ---- Image info ----
  await type('ch-finterval', '2');
  let rows = Object.fromEntries(INFO.imageInfoRows(rawOf(im), im));
  assert('Image info gives the frame interval in use and where it comes from', rows['Frame interval'] === '2 s' && /Entered in the Channels panel \(the file says 30\)/.test(rows['Frame interval source']), JSON.stringify(rows));
  assert('…and the Z step from the file', rows['Z step'] === '0.5 µm' && !('Z step source' in rows));

  // ---- save and reopen ----
  await type('ch-zstep', '0.8');
  await reopen('calibration');
  im = canvas.getObjects().find(o => o.mfcType === 'mfcImage' && o.mfcFileName === 'cells.tif');
  await select(im);
  assert('Save and reopen keep the typed values, the labels and the warnings', im.mfcZStepUm === 0.8 && im.mfcTimeIntervalS === 2 &&
    labelOf(im, 'z').text === 'z = 1.6 µm' && labelOf(im, 'time').text === 't = 6 s' && /0\.5 µm/.test(warning('zstep')) && /30 s/.test(warning('finterval')),
    labelOf(im, 'z').text + ' / ' + labelOf(im, 'time').text);

  // ================= A file without values; images without Z or time =================
  const bare = await importOne(makeTiff('bare.tif', { Z: 3, T: 4, spacing: 0, finterval: 0 }), { left: 600, top: 60, scaleX: 8, scaleY: 8 });
  await select(bare);
  assert('A file without Z step or interval: empty fields saying so', $('ch-zstep').value === '' && $('ch-finterval').value === '' && /not in the file/.test($('ch-finterval').placeholder));
  await type('ch-finterval', '5');
  assert('A value typed for a file that has none is used without a warning', bare.mfcTimeIntervalS === 5 && !warning('finterval'));
  const zOnly = await importOne(makeTiff('zonly.tif', { Z: 3, T: 1 }), { left: 600, top: 400, scaleX: 8, scaleY: 8 });
  await select(zOnly);
  assert('A Z stack without frames shows the Z step only', shown('ch-zstep-row') && !shown('ch-finterval-row'));
  const flat = await importOne(makeTiff('flat.tif', { Z: 1, T: 1 }), { left: 900, top: 400, scaleX: 8, scaleY: 8 });
  await select(flat);
  assert('A single plane shows neither field, only the pixel size', !shown('ch-zstep-row') && !shown('ch-finterval-row') && shown('ch-pixelsize'));

  // ---- several images ----
  await select(im, bare);
  assert('Two images, one differing from its file: the warning counts them', warning('finterval') === 'Differs from the file for 1 of the 2 selected images.', warning('finterval'));
  assert('…and their different intervals show as mixed', $('ch-finterval').value === '' && $('ch-finterval').placeholder === 'mixed');
  await type('ch-finterval', '30');
  assert('A value typed for both: the file\'s for one (no override), typed for the other', !('mfcTimeIntervalS' in im) && bare.mfcTimeIntervalS === 30 && !warning('finterval'));

  // ================= A series montage shares the typed values =================
  canvas.discardActiveObject();
  const panels = await S.seriesMontage(im, { axis: 't', step: 2 }); await idle();
  await select(panels[1]);
  await type('ch-finterval', '10');
  assert('An interval typed on one panel of a series reaches every panel and its label',
    panels.every(p => p.mfcTimeIntervalS === 10) && panels.map(p => labelOf(p, 'time').text).join() === 't = 0 s,t = 20 s,t = 40 s', panels.map(p => labelOf(p, 'time').text).join());
  $('ch-finterval-reset').click(); await idle();
  assert('"Use file value" on one panel resets them all', panels.every(p => !('mfcTimeIntervalS' in p)) && labelOf(panels[2], 'time').text === 't = 2:00 min', labelOf(panels[2], 'time').text);
  canvas.discardActiveObject();
  return checks;
}

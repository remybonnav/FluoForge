/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P2-T4: comparison groups.
   - Link / Unlink in the selection bar; members take the first image's range, LUT and gamma;
   - an edit of range, LUT or gamma on one member (sliders, typed values, popover, Auto) changes
     every member, as one History step; other settings stay per image;
   - the chain icon in the layers panel, and the warning badge when a paste makes the group diverge;
   - acceptance: linked edits are one History step, and the link survives save and load. */
async function runComparisonRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail ? ': ' + detail : '')); checks.push(name); };
  const comparison = await import(new URL('js/image/comparison.js', document.baseURI).href);
  const display = await import(new URL('js/image/display-settings.js', document.baseURI).href);
  const canvas = MFC.getCanvas();
  const idle = () => MFC_TIFF.whenIdle();
  const step = () => MFC.getHistory().index;
  const label = () => MFC.getHistory().labels[step()];

  // Little-endian TIFF, one 16-bit page per channel (no ImageJ header).
  const tiff = (name, pages, w, h) => {
    const planeBytes = w * h * 2, tags = 8;
    let size = 8;
    const layout = pages.map(() => { const ifd = size; size += 2 + tags * 12 + 4; const data = size; size += planeBytes; return { ifd, data }; });
    const buf = new ArrayBuffer(size), dv = new DataView(buf);
    dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, layout[0].ifd, true);
    pages.forEach((page, i) => {
      const { ifd, data } = layout[i]; let p = ifd; dv.setUint16(p, tags, true); p += 2;
      const tag = (id, type, value) => { dv.setUint16(p, id, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, 1, true); if (type === 3) dv.setUint16(p + 8, value, true); else dv.setUint32(p + 8, value, true); p += 12; };
      tag(256, 4, w); tag(257, 4, h); tag(258, 3, 16); tag(259, 3, 1); tag(262, 3, 1); tag(273, 4, data); tag(277, 3, 1); tag(279, 4, planeBytes);
      dv.setUint32(p, i + 1 < pages.length ? layout[i + 1].ifd : 0, true);
      for (let k = 0; k < w * h; k++) dv.setUint16(data + k * 2, page[k], true);
    });
    return new File([buf], name, { type: 'image/tiff' });
  };
  const plane = (k, top) => Uint16Array.from({ length: 64 * 48 }, (_, i) => (i * (k + 3)) % top);

  window.focus();
  await MFC_PROJECT.createProject({ name: 'compare', width: 900, height: 600, unit: 'px', dpi: 300 });
  await MFC.importFiles([tiff('control.tif', [plane(0, 4000), plane(1, 3000)], 64, 48)]);
  await MFC.importFiles([tiff('treated.tif', [plane(2, 2000), plane(3, 1000)], 64, 48)]);
  await MFC.importFiles([tiff('rescue.tif', [plane(4, 3500), plane(5, 2500), plane(6, 1500)], 64, 48)]);
  await MFC.importFiles([tiff('other.tif', [plane(7, 3900), plane(8, 3900)], 64, 48)]);
  await idle();
  const objs = () => canvas.getObjects().filter(o => o.mfcType === 'mfcImage');
  const byName = name => objs().find(o => o.mfcFileName === name);
  const chans = name => MFC.getRegistry()[byName(name).mfcId].rawImage.channels;
  objs().forEach((o, i) => { o.set({ left: 40 + i * 120, top: 60 }); o.setCoords(); });
  const select = names => {
    const list = names.map(byName);
    canvas.discardActiveObject();
    canvas.setActiveObject(list.length === 1 ? list[0] : new fabric.ActiveSelection(list, { canvas }));
    canvas.fire('selection:created'); MFC.refreshChannelPanel(); MFC.refreshSelectionBar();
  };
  const rows = () => [...document.querySelectorAll('#channel-list .channel-row')];
  const otherBefore = JSON.stringify(chans('other.tif'), (k, v) => (k === 'data' ? undefined : v));

  // ---- link ----
  Object.assign(chans('control.tif')[0], { color: 'viridis', min: 100, max: 3000, gamma: 0.8, invert: true });
  Object.assign(chans('control.tif')[1], { color: 'magenta', min: 50, max: 2500, gamma: 1.2 });
  MFC.recomposite(byName('control.tif')); MFC.pushHistory(); await idle();
  select(['control.tif', 'treated.tif', 'rescue.tif']);
  const linkBtn = document.getElementById('obj-link-compare'), unlinkBtn = document.getElementById('obj-unlink-compare');
  assert('The selection bar offers Link for several images, with an explanation; Unlink is off while none is linked',
    !linkBtn.disabled && unlinkBtn.disabled && linkBtn.title.includes('comparison group'));
  let before = step();
  linkBtn.click(); await idle();
  const linked = (a, b, i) => ['min', 'max', 'color', 'gamma'].every(f => (chans(a)[i][f] ?? 1) === (chans(b)[i][f] ?? 1));
  assert('Link makes one comparison group and gives every member the first image\'s range, LUT and gamma, channel by number',
    ['control.tif', 'treated.tif', 'rescue.tif'].every(n => byName(n).mfcCompareGroup === 1) &&
    linked('treated.tif', 'control.tif', 0) && linked('rescue.tif', 'control.tif', 1) && chans('treated.tif')[1].color === 'magenta');
  assert('…without copying the settings that are not linked (invert stays per image); the third channel of a 3-channel image is untouched',
    chans('treated.tif')[0].invert !== true && chans('rescue.tif')[2].color !== 'viridis' && chans('rescue.tif')[2].color !== 'magenta');
  assert('Linking is one History step, named', step() === before + 1 && /Linked for comparison/.test(label()), label());
  assert('An image outside the group is untouched', JSON.stringify(chans('other.tif'), (k, v) => (k === 'data' ? undefined : v)) === otherBefore);

  // ---- layers panel ----
  const layerRow = name => [...document.querySelectorAll('#layers-list .layer-row')].find(r => r.querySelector('.layer-name').textContent === name);
  assert('The layers panel shows a chain icon on each member, naming the group', ['control.tif', 'treated.tif', 'rescue.tif'].every(n => {
    const chain = layerRow(n).querySelector('.layer-chain');
    return chain && chain.title.startsWith('Comparison group 1 (3 images)') && chain.getAttribute('aria-label') === chain.title;
  }) && !layerRow('other.tif').querySelector('.layer-chain') && !document.querySelector('#layers-list .layer-diverged'));

  // ---- linked edits from the channel panel ----
  select(['treated.tif']);
  assert('The channel panel says the image is in a comparison group', /Comparison group 1 · 3 images/.test(document.querySelector('#channel-list .channel-compare').textContent) &&
    !document.querySelector('#channel-list .compare-warning'));
  before = step();
  const maxInput = rows()[0].querySelector('.ch-max-val');
  maxInput.value = '2222'; maxInput.dispatchEvent(new Event('change')); await idle();
  assert('Accept: typing a max on one member changes every member, as one History step',
    ['control.tif', 'treated.tif', 'rescue.tif'].every(n => chans(n)[0].max === 2222) && step() === before + 1 && chans('other.tif')[0].max !== 2222);
  before = step();
  const minSlider = rows()[1].querySelector('.ch-min');
  for (const v of [100, 200, 300]) { minSlider.value = String(v); minSlider.dispatchEvent(new Event('input')); }
  minSlider.dispatchEvent(new Event('change')); await idle();
  assert('Dragging a min slider moves every member live and ends as one History step',
    ['control.tif', 'treated.tif', 'rescue.tif'].every(n => chans(n)[1].min === 300) && step() === before + 1);
  before = step();
  rows()[0].querySelector('.ch-lut').click();
  document.querySelector('.lut-popover .lut-option[data-lut="fire"]').click(); await idle();
  assert('Choosing a LUT in the popover changes it on every member, as one History step',
    ['control.tif', 'treated.tif', 'rescue.tif'].every(n => chans(n)[0].color === 'fire') && step() === before + 1);
  before = step();
  const gamma = rows()[1].querySelector('.ch-gamma');
  gamma.value = '1.5'; gamma.dispatchEvent(new Event('input')); gamma.dispatchEvent(new Event('change')); await idle();
  assert('Gamma is linked too, as one History step', ['control.tif', 'treated.tif', 'rescue.tif'].every(n => chans(n)[1].gamma === 1.5) && step() === before + 1);
  before = step();
  const invertBox = rows()[0].querySelector('.ch-invert');
  invertBox.checked = !chans('treated.tif')[0].invert; invertBox.dispatchEvent(new Event('change')); await idle();
  assert('Invert is not linked: only the edited image changes', chans('treated.tif')[0].invert === invertBox.checked && chans('control.tif')[0].invert === true && chans('rescue.tif')[0].invert !== invertBox.checked);
  before = step();
  await MFC_TIFF.histogram(chans('treated.tif')[0].data);
  rows()[0].querySelector('.ch-auto').click(); await idle();
  const auto = chans('treated.tif')[0];
  assert('Auto on one member gives the whole group that image\'s range, as one History step',
    ['control.tif', 'rescue.tif'].every(n => chans(n)[0].min === auto.min && chans(n)[0].max === auto.max) && step() === before + 1 && auto.max <= 2000);
  await MFC.undo(); await idle();
  assert('One undo takes the linked edit back from every member', ['control.tif', 'treated.tif', 'rescue.tif'].every(n => chans(n)[0].max === 2222));
  await MFC.redo(); await idle();

  // A member inside a Fabric group still follows.
  select(['control.tif', 'other.tif']); MFC.groupSelection(); await idle();
  select(['rescue.tif']);
  before = step();
  rows()[0].querySelector('.ch-max-val').value = '1777'; rows()[0].querySelector('.ch-max-val').dispatchEvent(new Event('change')); await idle();
  const groupedControl = () => comparison.allImages().find(o => o.mfcFileName === 'control.tif');
  assert('A member inside a group of objects follows too', MFC.getRegistry()[groupedControl().mfcId].rawImage.channels[0].max === 1777 && step() === before + 1);
  canvas.setActiveObject(canvas.getObjects().find(o => o.type === 'group')); MFC.ungroupSelection(); await idle();
  assert('…and keeps its link after ungrouping', byName('control.tif').mfcCompareGroup === 1 && chans('control.tif')[0].max === 1777);

  // ---- divergence after a paste ----
  select(['other.tif']); display.copyDisplaySettings();
  select(['treated.tif']); display.pasteDisplaySettings(); await idle();
  assert('Pasting onto one member is not passed on: the group has diverged', chans('treated.tif')[0].color === chans('other.tif')[0].color && chans('control.tif')[0].color === 'fire' &&
    JSON.stringify(comparison.divergedChannels(1)) === '[0,1]');
  const badge = () => layerRow('control.tif').querySelector('.layer-diverged');
  assert('Every member\'s layer row shows a warning badge (a button saying which channels differ)', ['control.tif', 'treated.tif', 'rescue.tif'].every(n => layerRow(n).querySelector('.layer-diverged')) &&
    badge().tagName === 'BUTTON' && /channels 1, 2/.test(badge().title));
  assert('The channel panel warns too and offers to match the group', /channels 1, 2 differ/.test(document.querySelector('#channel-list .compare-warning').textContent) &&
    document.querySelector('#channel-list .compare-match').title.includes('treated.tif'));
  before = step();
  badge().click(); await idle();
  assert('Clicking the badge matches the group to that image, as one History step, and the badge goes',
    linked('treated.tif', 'control.tif', 0) && linked('rescue.tif', 'control.tif', 1) && chans('treated.tif')[0].color === 'fire' && step() === before + 1 &&
    !comparison.divergedChannels(1).length && !document.querySelector('#layers-list .layer-diverged'));
  select(['other.tif']); display.copyDisplaySettings(); select(['rescue.tif']); display.pasteDisplaySettings(); await idle();
  before = step();
  document.querySelector('#channel-list .compare-match').click(); await idle();
  assert('"Match group to this image" in the channel panel does the same from the selected image', chans('control.tif')[0].color === chans('other.tif')[0].color && step() === before + 1 && !comparison.divergedChannels(1).length);

  // ---- acceptance: save and reopen ----
  Object.assign(chans('rescue.tif')[0], { min: 321 }); MFC.pushHistory(); // a deliberate divergence, saved as is
  const next = MFC_PROJECT.prepareSave(true, 'compare'), saved = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
  await MFC.closeDocument();
  await MFC_PROJECT.loadProject(new File([saved], 'compare.fluoforge'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await idle();
  assert('Accept: after save and reopen the group is still there, with its diverged setting kept and flagged',
    ['control.tif', 'treated.tif', 'rescue.tif'].every(n => byName(n).mfcCompareGroup === 1) && byName('other.tif').mfcCompareGroup === undefined &&
    chans('rescue.tif')[0].min === 321 && JSON.stringify(comparison.divergedChannels(1)) === '[0]' && layerRow('rescue.tif').querySelector('.layer-diverged'));
  select(['control.tif']);
  before = step();
  rows()[0].querySelector('.ch-min-val').value = '55'; rows()[0].querySelector('.ch-min-val').dispatchEvent(new Event('change')); await idle();
  assert('…and edits are still linked, as one History step', ['control.tif', 'treated.tif', 'rescue.tif'].every(n => chans(n)[0].min === 55) && step() === before + 1 &&
    !comparison.divergedChannels(1).length);
  const savedState = MFC_PROJECT.captureState();
  assert('The state is schema 4 and stores the group on each member', savedState.schema === 4 && savedState.objects.filter(o => o.mfcCompareGroup === 1).length === 3);

  // ---- unlink ----
  select(['treated.tif']);
  before = step();
  unlinkBtn.click(); await idle();
  assert('Unlink takes the selected image out, as one History step; the others stay linked',
    byName('treated.tif').mfcCompareGroup === undefined && byName('control.tif').mfcCompareGroup === 1 && step() === before + 1 &&
    !layerRow('treated.tif').querySelector('.layer-chain') && /2 images/.test(layerRow('control.tif').querySelector('.layer-chain').title));
  select(['treated.tif']);
  rows()[0].querySelector('.ch-max-val').value = '999'; rows()[0].querySelector('.ch-max-val').dispatchEvent(new Event('change')); await idle();
  assert('An unlinked image is edited alone', chans('treated.tif')[0].max === 999 && chans('control.tif')[0].max !== 999);
  select(['rescue.tif']); unlinkBtn.click(); await idle();
  assert('A group left with one image is dissolved', byName('control.tif').mfcCompareGroup === undefined && !document.querySelector('#layers-list .layer-chain'));
  select(['other.tif', 'treated.tif']); linkBtn.click(); await idle();
  assert('A new group gets the first free number', byName('other.tif').mfcCompareGroup === 1 && byName('treated.tif').mfcCompareGroup === 1);
  return { checks };
}

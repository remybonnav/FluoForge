/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* PI-T7: adjusting a crop without uncropping. On the reference figure's image img1 (with an inset outline
   and a scale bar), first cropped to its middle:
   - Adjust crop (selection bar) shows the whole image, dimmed outside the crop border, with the border on
     the current crop; the panel and History do not change while adjusting;
   - the border's handles and body dragged with the mouse, then Apply: the crop is wider or elsewhere, the
     panel keeps its top-left corner and scale, in one History step; the inset outline stays on its pixels;
   - Cancel changes nothing; a border overhanging the image keeps the part on it; undo and redo; save and
     reopen; a quick-figure row is re-cropped as a whole; a rotated panel is refused. */
async function runAdjustCropRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = () => MFC.getCanvas();
  const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const byId = id => canvas().getObjects().find(o => o.mfcId === id) || null;
  const C = await import(new URL('js/tools/crop.js', document.baseURI).href);
  const M = await import(new URL('js/image/montage.js', document.baseURI).href);
  const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await MFC_TIFF.whenIdle();
  const index = () => MFC.getHistory().index;
  const helpers = () => canvas().getObjects().filter(o => o.mfcIsPreview);
  /** A real mouse drag in page pixels, from the crop border's handle `key` (or its middle: null). */
  const drag = async (key, dx, dy) => {
    const rect = C.cropRect;
    if (!rect) throw new Error('No crop border to drag (tool ' + MFC.currentTool + ', toast "' + $('toast').textContent + '", checks so far: ' + checks.length + ')');
    canvas().renderAll(); canvas().calcOffset(); rect.setCoords();
    const c = key ? rect.oCoords[key] : rect.getCenterPoint();
    const screen = key ? c : fabric.util.transformPoint(c, canvas().viewportTransform);
    const box = canvas().upperCanvasEl.getBoundingClientRect(), k = box.width / canvas().getWidth(), z = canvas().viewportTransform[0] * k;
    const x = box.left + screen.x * k, y = box.top + screen.y * k;
    canvas().upperCanvasEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, buttons: 1 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx * z / 2, clientY: y + dy * z / 2, buttons: 1 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx * z, clientY: y + dy * z, buttons: 1 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + dx * z, clientY: y + dy * z }));
    await frame();
  };
  const crop = o => ({ cropX: o.cropX || 0, cropY: o.cropY || 0, width: o.width, height: o.height, left: o.left, top: o.top, sx: o.scaleX, sy: o.scaleY });
  const same = (a, b) => Object.keys(a).every(k => near(a[k], b[k], 0.02)); // History and saves keep two decimals
  const adjustCrop = async obj => { canvas().setActiveObject(obj); MFC.setTool('select'); MFC.refreshSelectionBar(); await frame(); $('obj-adjust-crop').click(); await frame(); };

  let img = byId('img1');
  const inset = byId('img3'), contourId = inset && inset.mfcInsetContourId;
  assert('The reference figure has img1, unrotated, with an inset outline on it', img && !img.angle && contourId && byId(contourId) && byId(contourId).mfcInsetSourceId === 'img1');
  const sx = img.scaleX, sy = img.scaleY;
  const fullW = img.width, fullH = img.height;

  // ---- a first crop, to the middle ----
  canvas().setActiveObject(img); MFC.setTool('crop');
  C.cropRect.set({ left: img.left + 60, top: img.top + 40 }); C.cropRect.setCoords();
  $('crop-width').value = String(Math.round(img.getScaledWidth() - 140)); $('crop-height').value = String(Math.round(img.getScaledHeight() - 100));
  $('crop-width').focus(); MFC.applyCropFieldsToRect(); MFC.applyCrop(); MFC.setTool('select'); await frame();
  img = byId('img1');
  const first = crop(img);
  assert('Setting up: img1 cropped to its middle', near(first.cropX, 60 / sx, 1) && near(first.cropY, 40 / sy, 1) && first.width < fullW - 1, JSON.stringify(first));
  const contourOnImage = () => { const c = byId(contourId); return { x: (c.left - img.left) / sx + (img.cropX || 0), y: (c.top - img.top) / sy + (img.cropY || 0) }; };
  const contourPixels = contourOnImage();

  // ---- Adjust crop shows the whole image ----
  canvas().setActiveObject(img); MFC.refreshSelectionBar(); await frame();
  assert('A cropped panel shows Adjust crop in the selection bar, with a title', !$('obj-adjust-crop').classList.contains('hidden') && /whole image/.test($('obj-adjust-crop').title));
  const steps0 = index();
  await adjustCrop(img);
  const full = helpers().find(o => o.type === 'image'), dim = helpers().find(o => o.type === 'path');
  assert('Adjust crop opens the Crop tool on the whole image', MFC.currentTool === 'crop' && C.adjustingCrop() && full && near(full.width, fullW) && near(full.height, fullH) &&
    near(full.left, img.left - first.cropX * sx) && near(full.top, img.top - first.cropY * sy), full && JSON.stringify({ l: full.left, w: full.width, tool: MFC.currentTool }));
  assert('…dimmed outside the crop border (an even-odd veil over the image)', dim && dim.fillRule === 'evenodd' && /rgba\(0,\s*0,\s*0/.test(dim.fill));
  assert('…with the border on the current crop, its handles, and the panel\'s hint', C.cropRect && near(C.cropRect.left, img.left) && near(C.cropRect.width * C.cropRect.scaleX, img.getScaledWidth()) && C.cropRect.hasControls && !$('crop-adjust-hint').classList.contains('hidden'));
  assert('…none of it saved, exported or in the Layers panel', [full, dim].every(o => o.excludeFromExport && !o.mfcId) && !MFC_PROJECT.captureState().objects.some(o => o.mfcIsPreview));

  // ---- wider ----
  await drag('ml', -30, 0);
  await drag('mr', 20, 0);
  assert('Dragging the border\'s handles changes nothing yet: the panel and History stay', same(crop(img), first) && index() === steps0, `${index() - steps0}`);
  const dimAfter = helpers().find(o => o.type === 'path');
  assert('…and the veil follows the border', dimAfter && dimAfter !== dim && dimAfter.path.some(cmd => near(cmd[1], C.cropRect.left)), dimAfter && JSON.stringify(dimAfter.path.slice(5, 7)));
  $('crop-apply').click(); await frame();
  img = byId('img1');
  let now = crop(img);
  assert('Apply: re-cropped wider, 30 px further left and 20 px further right', near(now.cropX, first.cropX - 30 / sx, 1) && near(now.width, first.width + 50 / sx, 1.5) && near(now.cropY, first.cropY) && near(now.height, first.height), JSON.stringify(now));
  assert('…the panel keeps its place (top-left corner) and scale on the page', near(now.left, first.left) && near(now.top, first.top) && now.sx === sx && now.sy === sy, JSON.stringify(now));
  assert('…in one History step, with no helper left, back to the Select tool', index() === steps0 + 1 && !helpers().length && MFC.currentTool === 'select' && !C.adjustingCrop(), `${index() - steps0}`);
  const pix = contourOnImage();
  assert('…and the inset outline stays on the same pixels of the image', near(pix.x, contourPixels.x, 1) && near(pix.y, contourPixels.y, 1), JSON.stringify({ pix, contourPixels }));
  const wider = crop(img);

  // ---- elsewhere ----
  await adjustCrop(img);
  await drag(null, 50, 25);
  $('crop-apply').click(); await frame();
  img = byId('img1'); now = crop(img);
  assert('Moving the border elsewhere re-crops there: the same size, 50 and 25 px further', near(now.cropX, wider.cropX + 50 / sx, 1) && near(now.cropY, wider.cropY + 25 / sy, 1) && near(now.width, wider.width, 1) && near(now.height, wider.height, 1), JSON.stringify(now));
  assert('…the panel still in its place, one more History step', near(now.left, first.left) && near(now.top, first.top) && index() === steps0 + 2);
  const moved = crop(img);

  // ---- undo, redo ----
  await MFC.undo(); await MFC_TIFF.whenIdle(); img = byId('img1');
  assert('Undo brings back the previous crop', same(crop(img), wider), JSON.stringify(crop(img)));
  await MFC.redo(); await MFC_TIFF.whenIdle(); img = byId('img1');
  assert('…and redo the re-crop', same(crop(img), moved));

  // ---- cancel ----
  await adjustCrop(img);
  await drag('mr', 40, 0);
  $('crop-cancel').click(); await frame();
  assert('Cancel changes nothing and leaves no helper', same(crop(byId('img1')), moved) && !helpers().length && index() === steps0 + 2);

  // ---- overhanging the image ----
  await adjustCrop(img);
  await drag('ml', -(moved.cropX * sx + 80), 0); // 80 px past the image's left edge
  $('crop-apply').click(); await frame();
  img = byId('img1'); now = crop(img);
  assert('A border dragged past the image keeps only the part on the image', now.cropX === 0 && near(now.width, moved.cropX + moved.width, 1) && near(now.left, first.left), JSON.stringify(now));
  const overhang = crop(img);

  // ---- save and reopen ----
  const next = MFC_PROJECT.prepareSave(true, 'adjust'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
  await MFC.closeDocument();
  await MFC_PROJECT.loadProject(new File([archive], 'adjust.fluoforge'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await MFC_TIFF.whenIdle();
  img = byId('img1');
  assert('Saved and reopened: the adjusted crop and place', img && same(crop(img), overhang), img && JSON.stringify(crop(img)));

  // ---- a rotated panel ----
  img = byId('img1'); img.set('angle', 90); img.setCoords();
  await adjustCrop(img);
  assert('A rotated panel is refused with a message, nothing shown', !C.adjustingCrop() && !helpers().length && /not rotated/.test($('toast').textContent), $('toast').textContent);
  img.set('angle', 0); img.setCoords();
  // ---- a quick-figure row follows ----
  const oldGroups = new Set(canvas().getObjects().map(o => o.mfcMontageGroup).filter(Boolean));
  const source = canvas().getObjects().find(o => o.mfcType === 'mfcImage' && !o.mfcIsInset && !o.clipPath && !o.mfcMontageGroup && !o.angle && MFC.getRegistry()[o.mfcId].rawImage.channels.length > 1);
  assert('Setting up: an unrotated multichannel image without a shape crop', !!source);
  canvas().setActiveObject(source);
  M.quickFigure([source]); await MFC_TIFF.whenIdle(); await frame();
  const group = canvas().getObjects().map(o => o.mfcMontageGroup).find(g => g && !oldGroups.has(g));
  const row = () => canvas().getObjects().filter(o => o.mfcType === 'mfcImage' && o.mfcMontageGroup === group).sort((a, b) => a.mfcMontageColumn - b.mfcMontageColumn);
  assert('Setting up: a quick-figure row', row().length >= 3, row().length);
  const p1 = row()[1];
  canvas().setActiveObject(p1); MFC.setTool('crop');
  C.cropRect.set({ left: p1.left + 10, top: p1.top + 10 }); C.cropRect.setCoords();
  $('crop-width').value = String(Math.round(p1.getScaledWidth() - 40)); $('crop-height').value = String(Math.round(p1.getScaledHeight() - 40));
  $('crop-width').focus(); MFC.applyCropFieldsToRect(); MFC.applyCrop(); MFC.setTool('select'); await frame();
  const origin = { x: row()[0].left, y: row()[0].top };
  const rowSteps = index();
  await adjustCrop(row()[1]);
  await drag('mr', 16, 0);
  $('crop-apply').click(); await frame();
  const r = row(), w = r[1].getScaledWidth(), gap = r[1].mfcMontageGap || 0;
  assert('Adjusting one panel of a quick figure re-crops the whole row the same way, in one step', r.every(p => p.cropX === r[1].cropX && p.width === r[1].width && near(p.getScaledWidth(), w)) && index() === rowSteps + 1,
    r.map(p => `${p.cropX.toFixed(1)} ${p.width.toFixed(1)}`).join(' | '));
  assert('…and the row is laid out again from where it was', r.every((p, c) => near(p.left, origin.x + c * (w + gap), 1) && near(p.top, origin.y, 1)), r.map(p => p.left.toFixed(1)).join());

  MFC.setTool('select');
  return checks;
}

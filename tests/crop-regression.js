/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Crop tool, Square mode, on a non-square image (480 x 360 on the page):
   - Square makes the region a square of the smaller side, inside the image;
   - dragging a side or corner handle with the mouse keeps it square (it used to spring back to the
     image's rectangle), the opposite side staying in place; the Width and Height fields stay equal;
   - Apply gives a square crop, also when the region overhangs the image;
   - Rectangle mode still resizes freely; undo restores the image. */
async function runCropRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await MFC_TIFF.whenIdle();
  const C = await import(new URL('js/tools/crop.js', document.baseURI).href);
  const img = canvas.getObjects().find(o => o.mfcType === 'mfcImage' && !o.angle && !o.mfcIsInset && Math.abs(o.getScaledWidth() - o.getScaledHeight()) > 50);
  assert('The test image is not square', !!img, 'no non-square image in the reference figure');
  const imgW = img.getScaledWidth(), imgH = img.getScaledHeight();
  const field = id => Number(document.getElementById(id).value);
  const size = r => ({ w: r.width * r.scaleX, h: r.height * r.scaleY, left: r.left, top: r.top, right: r.left + r.width * r.scaleX, bottom: r.top + r.height * r.scaleY });
  // A real mouse drag of one of the crop region's handles, in page pixels.
  const drag = (rect, key, dx, dy) => {
    canvas.renderAll(); canvas.calcOffset(); rect.setCoords();
    const control = rect.oCoords[key], box = canvas.upperCanvasEl.getBoundingClientRect(), z = canvas.viewportTransform[0];
    const x = box.left + control.x, y = box.top + control.y;
    canvas.upperCanvasEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, buttons: 1 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx * z / 2, clientY: y + dy * z / 2, buttons: 1 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx * z, clientY: y + dy * z, buttons: 1 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + dx * z, clientY: y + dy * z }));
  };
  const square = (s, name) => assert(name, near(s.w, s.h) && near(field('crop-width'), field('crop-height'), 1), `${s.w.toFixed(1)} x ${s.h.toFixed(1)}, fields ${field('crop-width')} x ${field('crop-height')}`);

  // ---- Square mode ----
  canvas.setActiveObject(img); MFC.setTool('crop');
  let rect = C.cropRect;
  assert('The Crop tool starts with a region the size of the image, and the Width field says so (no extra pixel)', rect && near(size(rect).w, imgW) && near(size(rect).h, imgH) && field('crop-width') === Math.round(imgW), rect ? `${size(rect).w} x ${size(rect).h}, field ${field('crop-width')} vs ${imgW} x ${imgH}` : 'no region, tool ' + MFC.currentTool + ', toast ' + document.getElementById('toast').textContent);
  document.getElementById('crop-mode-square').click();
  let s = size(rect);
  square(s, 'Square: the region becomes a square');
  assert('…of the smaller side, inside the image', near(s.w, Math.min(imgW, imgH)) && s.left >= img.left - 0.5 && s.top >= img.top - 0.5 && s.right <= img.left + imgW + 0.5 && s.bottom <= img.top + imgH + 0.5, JSON.stringify(s));

  let before = size(rect);
  drag(rect, 'mr', -60, 0); s = size(rect);
  square(s, 'Dragging the right handle keeps it square (it used to spring back to a rectangle)');
  assert('…at the dragged width, with the left edge in place', near(s.w, before.w - 60, 2) && near(s.left, before.left), `${s.w} vs ${before.w - 60}, left ${s.left} vs ${before.left}`);

  before = size(rect);
  drag(rect, 'mb', 0, -40); s = size(rect);
  square(s, 'Dragging the bottom handle keeps it square');
  assert('…at the dragged height, with the top edge in place', near(s.h, before.h - 40, 2) && near(s.top, before.top), `${s.h} vs ${before.h - 40}`);

  before = size(rect);
  drag(rect, 'br', 30, 10); s = size(rect);
  square(s, 'Dragging a corner keeps it square');
  assert('…with the opposite corner in place', near(s.left, before.left) && near(s.top, before.top) && s.w > before.w);

  before = size(rect);
  drag(rect, 'ml', 25, 0); s = size(rect);
  square(s, 'Dragging the left handle keeps it square, with the right edge in place');
  assert('…the right edge stays', near(s.right, before.right) && near(s.w, before.w - 25, 2), `${s.right} vs ${before.right}`);

  document.getElementById('crop-width').value = '150'; document.getElementById('crop-width').focus();
  MFC.applyCropFieldsToRect(); s = size(rect);
  square(s, 'Typing a width keeps it square (150 x 150)');
  assert('…at the typed size', near(s.w, 150));

  // ---- Apply ----
  MFC.pushHistory();
  const saved = { cropX: img.cropX, cropY: img.cropY, width: img.width, height: img.height, left: img.left, top: img.top };
  MFC.applyCrop();
  assert('Apply gives a square crop of the typed size', near(img.getScaledWidth(), img.getScaledHeight()) && near(img.getScaledWidth(), 150, 1), `${img.getScaledWidth()} x ${img.getScaledHeight()}`);
  await MFC.undo(); await MFC_TIFF.whenIdle();
  const back = canvas.getObjects().find(o => o.mfcId === img.mfcId);
  assert('Undo restores the image', back && near(back.width, saved.width) && near(back.height, saved.height));

  // A square overhanging the image is cut to a square, not to a rectangle.
  canvas.setActiveObject(back); MFC.setTool('select'); MFC.setTool('crop'); rect = C.cropRect;
  document.getElementById('crop-mode-square').click();
  const big = Math.max(imgW, imgH);
  document.getElementById('crop-width').value = String(Math.round(big)); document.getElementById('crop-width').focus();
  MFC.applyCropFieldsToRect(); s = size(rect);
  assert('A square region can be made larger than the image\'s short side', near(s.w, s.h) && s.h > Math.min(imgW, imgH) + 10);
  MFC.applyCrop();
  assert('Applying it still gives a square crop (the smaller side that fits)', near(back.getScaledWidth(), back.getScaledHeight(), 1) && near(back.getScaledWidth(), Math.min(imgW, imgH), 1),
    `${back.getScaledWidth()} x ${back.getScaledHeight()}`);
  await MFC.undo(); await MFC_TIFF.whenIdle();

  // ---- Rectangle mode is unchanged ----
  const again = canvas.getObjects().find(o => o.mfcId === img.mfcId);
  canvas.setActiveObject(again); MFC.setTool('select'); MFC.setTool('crop'); rect = C.cropRect;
  document.getElementById('crop-mode-rect').click();
  before = size(rect);
  drag(rect, 'mr', -80, 0); s = size(rect);
  assert('Rectangle: the right handle changes only the width', near(s.w, before.w - 80, 2) && near(s.h, before.h), `${s.w} x ${s.h}`);
  MFC.cancelCrop(); MFC.setTool('select');
  return checks;
}

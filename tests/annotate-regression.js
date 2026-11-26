/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P3-T8: microscopy annotations in the editor (the pure part: tests/annotate-model-regression.mjs).
   - Pen arrow ends: filled and open arrowheads, on screen and in SVG and PDF export;
   - the Annotate tool (button, A key): stamps placed by a click (filled and open arrows, arrowhead,
     asterisk, markers), dashed ROIs drawn by a drag with a numbered label that follows the outline;
   - auto-labels linked to an image: channel names in their colours, Z position in µm, time stamp
     (interval from the file or typed once), magnification of an inset; they follow the image, update
     with it, keep the user's own text, survive save and reopen, and go when their image goes;
   - the Text panel: superscript and subscript toggles, the special-character palette, and every
     palette character embedded in PDF in all twelve Liberation faces (the export's glyph check). */
async function runAnnotateRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas(), near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const A = await import(new URL('js/tools/annotate.js', document.baseURI).href);
  const AM = await import(new URL('js/tools/annotate-model.js', document.baseURI).href);
  const TS = await import(new URL('js/tools/text-script.js', document.baseURI).href);
  const client = (x, y) => {
    const el = canvas.upperCanvasEl, rect = el.getBoundingClientRect(), vpt = canvas.viewportTransform, k = rect.width / canvas.getWidth();
    return { clientX: rect.left + (x * vpt[0] + vpt[4]) * k, clientY: rect.top + (y * vpt[3] + vpt[5]) * k };
  };
  const mouse = (type, at, target = canvas.upperCanvasEl) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...at }));
  const click = (x, y) => { mouse('mousedown', client(x, y)); mouse('mouseup', client(x, y), document); };
  const drag = (x1, y1, x2, y2) => { mouse('mousedown', client(x1, y1)); mouse('mousemove', client((x1 + x2) / 2, (y1 + y2) / 2), document); mouse('mousemove', client(x2, y2), document); mouse('mouseup', client(x2, y2), document); };
  const choose = (id, value) => { const el = $(id); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
  const box = o => o.getBoundingRect(true, true);
  const added = before => canvas.getObjects().filter(o => !before.includes(o) && !MFC.isHelper(o));
  const byId = id => canvas.getObjects().find(o => o.mfcId === id);
  const labelsOf = (img, kind) => canvas.getObjects().filter(o => o.mfcAutoLabel && o.mfcAutoLabel.for === img.mfcId && (!kind || o.mfcAutoLabel.kind === kind));

  // An ImageJ hyperstack, 2 channels × 3 slices × 4 frames, 0.5 µm Z step, 30 s between frames.
  const makeTiff = (name, pages, w, h, description) => {
    const tagCount = 10, ifdSize = 2 + tagCount * 12 + 4, planeBytes = w * h * 2, desc = new TextEncoder().encode(description + '\0');
    let size = 8 + desc.length;
    const layout = pages.map(() => { const ifd = size; size += ifdSize; const data = size; size += planeBytes; return { ifd, data }; });
    const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
    u8.set([0x49, 0x49]); dv.setUint16(2, 42, true); dv.setUint32(4, layout[0].ifd, true); u8.set(desc, 8);
    pages.forEach((page, i) => {
      const { ifd, data } = layout[i]; let p = ifd; dv.setUint16(p, tagCount, true); p += 2;
      const tag = (id, type, count, value) => { dv.setUint16(p, id, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true);
        if (type === 3 && count === 1) dv.setUint16(p + 8, value, true); else dv.setUint32(p + 8, value, true); p += 12; };
      tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 16); tag(259, 3, 1, 1); tag(262, 3, 1, 1); tag(270, 2, desc.length, 8);
      tag(273, 4, 1, data); tag(277, 3, 1, 1); tag(278, 4, 1, h); tag(279, 4, 1, planeBytes);
      dv.setUint32(p, i + 1 < pages.length ? layout[i + 1].ifd : 0, true);
      for (let k = 0; k < w * h; k++) dv.setUint16(data + k * 2, page[k], true);
    });
    return new File([buf], name, { type: 'image/tiff' });
  };
  const W = 40, H = 30, C = 2, Z = 3, T = 4, pages = [];
  for (let t = 0; t < T; t++) for (let z = 0; z < Z; z++) for (let c = 0; c < C; c++) pages.push(Array.from({ length: W * H }, (_, k) => 500 + 300 * c + 100 * z + 50 * t + (k % 37)));
  const header = `ImageJ=1.54p\nimages=${C * Z * T}\nchannels=${C}\nslices=${Z}\nframes=${T}\nhyperstack=true\nmode=composite\nspacing=0.5\nunit=micron\nfinterval=30\nmin=0.0\nmax=2000.0\n`;

  try {
    await MFC_PROJECT.createProject({ name: 'Annotate', width: 1200, height: 800, unit: 'px', dpi: 300 });
    MFC.zoomReset && MFC.zoomReset(); await frame();

    // ---- metadata ----
    const raw = await MFC_TIFF.decodeFile(makeTiff('series.tif', pages, W, H, header));
    assert('The frame interval is read from the ImageJ header (finterval=)', raw.stack.frameIntervalS === 30 && raw.stack.zStepUm === 0.5);
    const inMin = await MFC_TIFF.decodeFile(makeTiff('min.tif', pages, W, H, header.replace('finterval=30\n', 'finterval=2\ntunit=min\n')));
    assert('…in its time unit (tunit=min: 120 s)', inMin.stack.frameIntervalS === 120);
    const none = await MFC_TIFF.decodeFile(makeTiff('none.tif', pages, W, H, header.replace('finterval=30\n', '')));
    assert('…and is missing when the file has none', none.stack.frameIntervalS === null);

    // ---- the tool ----
    await MFC.importFiles([makeTiff('series.tif', pages, W, H, header)]); await MFC_TIFF.whenIdle();
    const img = canvas.getObjects().find(o => o.mfcType === 'mfcImage');
    img.set({ left: 600, top: 100, scaleX: 10, scaleY: 10 }); img.setCoords(); MFC.pushHistory();
    assert('The Annotate button has a title naming its key', /Annotate tool \(A\)/.test($('tool-annotate').title));
    canvas.setActiveObject(img);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await frame();
    assert('The A key chooses the Annotate tool and shows its panel', MFC.currentTool === 'annotate' && !$('panel-annotate').classList.contains('hidden'));
    assert('Every control of the panel has a title or a label', [...$('panel-annotate').querySelectorAll('select, input, button')].every(el => el.title || el.closest('label')?.title));
    assert('The auto-labels go on the image selected before the tool', /the selected image/.test($('annotate-status').textContent) && !$('panel-annotate').querySelector('[data-auto-label]').disabled);
    assert('The interval field shows the file\'s interval', /30 \(from the file\)/.test($('annotate-interval').placeholder));

    // ---- no image selected: nothing is placed ----
    const image = () => canvas.getObjects().find(o => o.mfcType === 'mfcImage' && !o.mfcIsInset);
    const toast = MFC_UI.toast, toasts = [];
    MFC.setTool('select'); canvas.discardActiveObject(); MFC.setTool('annotate');
    MFC_UI.toast = m => toasts.push(m);
    let before0 = canvas.getObjects().slice(); click(100, 300); drag(100, 100, 200, 200);
    MFC_UI.toast = toast;
    assert('With no image selected, a click or drag places nothing and says to select an image', added(before0).length === 0 && toasts.some(m => /Select an image first/.test(m)) &&
      /No image selected/.test($('annotate-status').textContent));
    assert('The default colour is yellow', $('annotate-color').value === '#ffff00');

    // ---- stamps ----
    const select = () => { MFC.setTool('select'); canvas.setActiveObject(image()); };
    const place = (kind, x, y) => { select(); MFC.setTool('annotate'); choose('annotate-place', kind); const before = canvas.getObjects().slice(); click(x, y); return added(before); };
    let made = place('arrow', 100, 300);
    const arrow = made[0];
    assert('A filled arrow: one editable Pen path, its tip on the point clicked', made.length === 1 && arrow.mfcShapeKind === 'path' && arrow.mfcArrowEnd === 'arrow' &&
      arrow.mfcArrowStart === 'none' && near(arrow.mfcPathNodes[1].x, 100, 1) && near(arrow.mfcPathNodes[1].y, 300, 1) && arrow.mfcPathNodes[0].x > 100 && arrow.mfcPathNodes[0].y < 300);
    assert('…in the panel\'s colour, three times the mark size long (12 pt at 300 dpi = 50 px)', arrow.stroke === '#ffff00' && arrow.mfcAnnotationFor === img.mfcId && near(Math.hypot(arrow.mfcPathNodes[0].x - 100, arrow.mfcPathNodes[0].y - 300), 150, 1));
    const open = place('open-arrow', 200, 300)[0];
    assert('An open arrow: an "open" arrow end', open.mfcArrowEnd === 'open' && open.mfcShapeKind === 'path');
    const stamps = {};
    for (const [kind, x] of [['arrowhead', 300], ['asterisk', 380], ['circle', 460], ['triangle', 540], ['star', 620]]) {
      made = place(kind, x, 600);
      stamps[kind] = made[0];
      assert(`A ${kind} stamp: one shape`, made.length === 1 && made[0].mfcStamp === kind && made[0].mfcShapeKind === 'stamp');
    }
    const headTri = stamps.arrowhead.path;
    assert('The arrowhead\'s tip is on the point', near(headTri[0][1], 300, 0.01) && near(headTri[0][2], 600, 0.01));
    for (const kind of ['circle', 'triangle', 'star']) { const b = box(stamps[kind]), x = { circle: 460, triangle: 540, star: 620 }[kind];
      const cy = kind === 'triangle' ? b.top + b.height * 2 / 3 : b.top + b.height / 2; // a triangle: on its centroid
      assert(`The ${kind} is centred on the point`, near(b.left + b.width / 2, x, 3) && Math.abs(cy - 600) < 3, JSON.stringify(b)); }
    assert('Markers are filled, the asterisk is stroked', stamps.circle.fill === '#ffff00' && stamps.circle.strokeWidth === 0 && stamps.asterisk.fill === 'transparent' && stamps.asterisk.strokeWidth > 0);
    const steps = MFC.getHistory().labels.length; place('circle', 700, 700);
    assert('Each stamp is one History step', MFC.getHistory().labels.length === steps + 1);
    assert('After a stamp the tool stays, for the next one', MFC.currentTool === 'annotate');
    // The Pen panel offers the open arrow too.
    assert('The Pen panel\'s arrow ends: None, Filled arrow, Open arrow', [...$('path-arrow-end').options].map(o => o.value).join() === 'none,arrow,open' && $('path-arrow-start').title);

    // ---- open and filled arrowheads in export ----
    let svg = (await MFC_EXPORT.buildSVG()).svg;
    assert('SVG: the filled arrowhead is a filled polygon, the open one a stroked polyline with no fill', /<polygon [^>]*fill="#ffff00"/.test(svg) && /<polyline [^>]*fill="none" stroke="#ffff00"/.test(svg));
    const openCanvas = document.createElement('canvas'); openCanvas.width = 120; openCanvas.height = 120;
    const ctx = openCanvas.getContext('2d'), ob = box(open);
    ctx.translate(-ob.left + 10, -ob.top + 10); open.render(ctx);
    const pixels = ctx.getImageData(0, 0, 120, 120).data;
    let painted = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) painted++;
    assert('The open arrow is drawn in the editor (line and chevron)', painted > 50);
    await MFC_EXPORT.buildPDF();
    checks.push('PDF export with open and filled arrows, stamps and markers');

    // ---- ROIs ----
    const roi = (kind, x1, y1, x2, y2) => { select(); MFC.setTool('annotate'); choose('annotate-place', kind); const before = canvas.getObjects().slice(); drag(x1, y1, x2, y2); return added(before); };
    made = roi('roi-rect', 100, 100, 300, 250);
    const rect = made.find(o => o.mfcRoi), rectLabel = made.find(o => o.mfcRoiFor);
    assert('A drag draws a dashed ROI box with a label', made.length === 2 && rect.type === 'rect' && rect.strokeDashArray && rect.strokeDashArray.length === 2 && rectLabel.mfcRoiFor === rect.mfcId);
    assert('…the size of the drag', near(rect.width, 200, 1) && near(rect.height, 150, 1));
    assert('The label reads "ROI 1", just above the outline\'s corner', rectLabel.text === 'ROI 1' && near(rectLabel.left, rect.left, 1) && rectLabel.top + rectLabel.height <= rect.top, JSON.stringify([rectLabel.text, rectLabel.left, rectLabel.top, rectLabel.height, rect.left, rect.top]));
    assert('After an ROI the tool stays, for the next one; the outline is linked to the image, its label in the panel\'s colour', MFC.currentTool === 'annotate' && rect.mfcAnnotationFor === img.mfcId && rectLabel.fill === '#ffff00' && !rectLabel.mfcAnnotationFor);
    made = roi('roi-ellipse', 400, 100, 500, 160);
    const ellipse = made.find(o => o.mfcRoi), ellipseLabel = made.find(o => o.mfcRoiFor);
    assert('An ROI ellipse is "ROI 2"', ellipse.type === 'ellipse' && ellipseLabel.text === 'ROI 2');
    choose('annotate-roi-dash', 'dotted');
    const dotted = roi('roi-rect', 700, 600, 760, 660).find(o => o.mfcRoi);
    assert('The ROI outline style is the panel\'s (dotted)', JSON.stringify(dotted.strokeDashArray) === '[2,5]');
    rect.set({ left: rect.left + 40, top: rect.top + 20 }); rect.setCoords(); canvas.fire('object:moving', { target: rect });
    assert('The label follows its outline while it moves', near(rectLabel.left, rect.left, 1) && rectLabel.top + rectLabel.height <= rect.top);
    rectLabel.set({ left: rect.left + 10, top: rect.top + 10 }); rectLabel.setCoords(); canvas.fire('object:modified', { target: rectLabel });
    rect.set({ left: rect.left + 30 }); rect.setCoords(); canvas.fire('object:modified', { target: rect });
    assert('A label moved inside the outline keeps its new place from it', near(rectLabel.left, rect.left + 10, 1) && near(rectLabel.top, rect.top + 10, 1));
    canvas.remove(ellipse); MFC.pushHistory();
    assert('Deleting an outline deletes its label', !canvas.getObjects().includes(ellipseLabel));
    await MFC.undo(); await MFC_TIFF.whenIdle(); await frame();
    assert('Undo brings both back', canvas.getObjects().some(o => o.mfcRoiFor && o.text === 'ROI 2' && byId(o.mfcRoiFor)));
    await MFC.redo(); await MFC_TIFF.whenIdle(); await frame();

    // ---- marks follow their image ----
    {
      const im0 = image(), find = id => byId(id);
      const star = place('star', 800, 250)[0], starId = star.mfcId;
      const roiMade = roi('roi-rect', 650, 150, 700, 200), outline = roiMade.find(o => o.mfcRoi), outlineLabel = roiMade.find(o => o.mfcRoiFor);
      assert('A mark placed on the image is linked to it', star.mfcAnnotationFor === im0.mfcId && outline.mfcAnnotationFor === im0.mfcId);
      MFC.setTool('select');
      const c0 = star.getCenterPoint(), o0 = { x: outline.left, y: outline.top }, l0 = { x: outlineLabel.left, y: outlineLabel.top };
      const ib0 = box(im0);
      im0.set({ left: im0.left + 60, top: im0.top + 30 }); im0.setCoords(); canvas.fire('object:moving', { target: im0 });
      const dx = box(im0).left - ib0.left, dy = box(im0).top - ib0.top; // (the image may snap)
      assert('Moving the image moves its marks, ROIs and ROI labels with it', Math.abs(dx) > 40 && near(star.getCenterPoint().x, c0.x + dx, 1) && near(star.getCenterPoint().y, c0.y + dy, 1) &&
        near(outline.left, o0.x + dx, 1) && near(outline.top, o0.y + dy, 1) && near(outlineLabel.left, l0.x + dx, 1) && near(outlineLabel.top, l0.y + dy, 1), JSON.stringify([c0, star.getCenterPoint(), o0, outline.left, outline.top, l0, outlineLabel.left, outlineLabel.top, star.mfcAnnotationAnchor]));
      canvas.fire('object:modified', { target: im0 });
      const b0 = box(im0), rel = { u: (star.getCenterPoint().x - b0.left) / b0.width, v: (star.getCenterPoint().y - b0.top) / b0.height }, size0 = star.getScaledWidth();
      im0.set({ scaleX: im0.scaleX * 1.5, scaleY: im0.scaleY * 1.5 }); im0.setCoords(); canvas.fire('object:modified', { target: im0 });
      const b1 = box(im0);
      assert('Resizing the image keeps each mark at the same place on it, at its own size', near((star.getCenterPoint().x - b1.left) / b1.width, rel.u, 0.005) &&
        near((star.getCenterPoint().y - b1.top) / b1.height, rel.v, 0.005) && near(star.getScaledWidth(), size0, 0.01));
      star.set({ left: star.left - 40 }); star.setCoords(); canvas.fire('object:modified', { target: star });
      const c1 = star.getCenterPoint();
      im0.set({ left: im0.left - 50 }); im0.setCoords(); canvas.fire('object:modified', { target: im0 });
      assert('A mark moved by the user keeps its new place on the image', near(star.getCenterPoint().x, c1.x - 50, 1) && near(star.getCenterPoint().y, c1.y, 1), JSON.stringify([c1, star.getCenterPoint(), star.mfcAnnotationAnchor]));
      star.set({ top: star.top + 20 }); star.setCoords(); MFC.pushHistory(); // moved without a modified event (arrow keys, typed position)
      const c2 = star.getCenterPoint();
      im0.set({ left: im0.left + 50 }); im0.setCoords(); canvas.fire('object:modified', { target: im0 });
      assert('…also when it was moved with the arrow keys or typed coordinates', near(star.getCenterPoint().x, c2.x + 50, 1) && near(star.getCenterPoint().y, c2.y, 1));
      canvas.setActiveObject(star); MFC.copySelection(); await MFC.pasteSelection();
      const freeMark = canvas.getActiveObject();
      assert('A mark pasted without its image is free', freeMark !== star && !freeMark.mfcAnnotationFor);
      canvas.remove(freeMark); canvas.remove(outline); canvas.remove(star); MFC.pushHistory();
      assert('(cleanup)', !find(starId) && !canvas.getObjects().includes(outlineLabel));
    }

    // ---- auto-labels ----
    const labelOn = (target, kind) => { canvas.setActiveObject(target); MFC.setTool('annotate'); $('panel-annotate').querySelector(`[data-auto-label="${kind}"]`).click(); return labelsOf(target, kind)[0]; };
    let im = image();
    const chLabel = labelOn(im, 'channels');
    assert('Channels: the shown channel names, each in its colour', chLabel && chLabel.text === 'Ch 1 Ch 2' && chLabel.styles[0][0].fill && chLabel.styles[0][5].fill && chLabel.styles[0][0].fill !== chLabel.styles[0][5].fill, chLabel && chLabel.text);
    const ib = box(im);
    assert('…at the top-left corner, inside the image', chLabel.left > ib.left && chLabel.left < ib.left + 20 && chLabel.top > ib.top && chLabel.top < ib.top + 20);
    const zLabel = labelOn(im, 'z');
    assert('Z: the projection depth, MIP z 0–1 µm (3 slices, 0.5 µm)', zLabel.text === 'MIP z 0–1 µm', zLabel.text);
    assert('…at the bottom-left corner', zLabel.top + zLabel.height < ib.top + ib.height && zLabel.top + zLabel.height > ib.top + ib.height - 20);
    const tLabel = labelOn(im, 'time');
    assert('Time: t = 0 s on the first frame, at the top-right corner', tLabel.text === 't = 0 s' && tLabel.left + tLabel.width > ib.left + ib.width - 20 && tLabel.left + tLabel.width < ib.left + ib.width);
    toasts.length = 0; MFC_UI.toast = m => toasts.push(m);
    labelOn(im, 'zoom');
    assert('Magnification on an image that is not an inset: refused with a reason', !labelsOf(im, 'zoom').length && toasts.some(m => /inset/.test(m)));
    MFC_UI.toast = toast;

    canvas.setActiveObject(im);
    await MFC.applyStackPlane({ zIndex: 2 }, true); await MFC_TIFF.whenIdle();
    assert('Showing slice 3 updates the Z label: z = 1 µm', zLabel.text === 'z = 1 µm', zLabel.text);
    await MFC.applyStackPlane({ tIndex: 3 }, true); await MFC_TIFF.whenIdle();
    assert('Frame 4 updates the time label: 3 × 30 s = 1:30 min', tLabel.text === 't = 1:30 min', tLabel.text);
    canvas.setActiveObject(im); MFC.setTool('annotate');
    $('annotate-interval').value = '2'; $('annotate-interval').dispatchEvent(new Event('change'));
    assert('A typed interval (2 s) replaces the file\'s: t = 6 s', tLabel.text === 't = 6 s' && im.mfcTimeIntervalS === 2, tLabel.text);
    $('annotate-interval').value = ''; $('annotate-interval').dispatchEvent(new Event('change'));
    assert('Clearing it goes back to the file\'s interval', tLabel.text === 't = 1:30 min' && !('mfcTimeIntervalS' in im));
    MFC.setTool('select');
    MFC.getRegistry()[im.mfcId].rawImage.channels[0].name = 'DAPI'; MFC.pushHistory();
    assert('Renaming a channel updates the channel label', chLabel.text === 'DAPI Ch 2', chLabel.text);

    const dz = { x: zLabel.left - box(im).left, y: zLabel.top - box(im).top };
    im.set({ left: im.left + 50, top: im.top + 40 }); im.setCoords(); canvas.fire('object:moving', { target: im });
    assert('Labels follow their image while it moves', near(zLabel.left - box(im).left, dz.x, 1) && near(zLabel.top - box(im).top, dz.y, 1));
    im.set({ scaleX: 12, scaleY: 12 }); im.setCoords(); canvas.fire('object:modified', { target: im });
    const ib2 = box(im);
    assert('…and keep their corner when it is resized', zLabel.top + zLabel.height < ib2.top + ib2.height && zLabel.top + zLabel.height > ib2.top + ib2.height - 20 && near(zLabel.left, ib2.left + (dz.x), 1));
    tLabel.set({ left: ib2.left + ib2.width + 10, top: ib2.top }); tLabel.setCoords(); canvas.fire('object:modified', { target: tLabel });
    im.set({ left: im.left - 100 }); im.setCoords(); canvas.fire('object:modified', { target: im });
    assert('A label dragged outside the image stays there, beside it', near(tLabel.left, box(im).left + box(im).width + 10, 1.5));

    zLabel.set('text', 'Deepest slice'); canvas.fire('object:modified', { target: zLabel });
    canvas.setActiveObject(im); await MFC.applyStackPlane({ zIndex: 0 }, true); await MFC_TIFF.whenIdle();
    assert('A label whose text the user edited keeps it', zLabel.text === 'Deepest slice' && zLabel.mfcAutoLabel.custom === true);
    assert('…while the others still update', tLabel.text === 't = 1:30 min');

    // ---- inset magnification ----
    $('inset-magnification').value = '3';
    const contour = new fabric.Rect({ left: box(im).left + 20, top: box(im).top + 20, width: 60, height: 60, fill: 'transparent', stroke: '#ffff00', strokeWidth: 2 });
    Object.assign(contour, { mfcId: 'ins' + Date.now(), mfcType: 'insetContour', mfcInsetSourceId: im.mfcId });
    canvas.add(contour); canvas.setActiveObject(contour); MFC.createInsetFromContour(contour); await MFC_TIFF.whenIdle();
    const inset = canvas.getObjects().find(o => o.mfcIsInset);
    const zoom = labelOn(inset, 'zoom');
    assert('Magnification of an inset: 3×, at its bottom-right corner', zoom && zoom.text === '3×' && zoom.left + zoom.width > box(inset).left + box(inset).width - 20, zoom && zoom.text);
    inset.set({ scaleX: inset.scaleX * 1.5, scaleY: inset.scaleY * 1.5 }); inset.setCoords(); canvas.fire('object:modified', { target: inset });
    assert('Resizing the inset updates it: 4.5×', zoom.text === '4.5×', zoom.text);

    // ---- save and reopen ----
    const state = MFC_PROJECT.captureState();
    const saved = state.objects.filter(o => o.mfcAutoLabel);
    assert('Labels are saved with their link (image, kind, corner)', saved.length === 4 && saved.every(o => o.mfcAutoLabel.for && o.mfcAutoLabel.kind && o.mfcAutoLabel.corner));
    await MFC_PROJECT.restoreState(state); await MFC_TIFF.whenIdle(); await frame();
    im = image();
    const reopened = labelsOf(im, 'time')[0];
    assert('Reopened, the labels read the same', reopened && reopened.text === 't = 1:30 min' && labelsOf(im, 'z')[0].text === 'Deepest slice' && canvas.getObjects().some(o => o.mfcRoiFor && o.text === 'ROI 1'));
    canvas.setActiveObject(im); await MFC.applyStackPlane({ tIndex: 1 }, true); await MFC_TIFF.whenIdle();
    assert('…and still update', labelsOf(im, 'time')[0].text === 't = 30 s');
    svg = (await MFC_EXPORT.buildSVG()).svg;
    assert('Labels export as text', svg.includes('t = 30 s') && svg.includes('ROI 1'));

    // ---- copy and paste ----
    const tl = labelsOf(im, 'time')[0];
    canvas.setActiveObject(tl); MFC.copySelection(); await MFC.pasteSelection();
    const pasted = canvas.getActiveObject();
    assert('A label pasted without its image is plain text', pasted !== tl && pasted.type === 'textbox' && !pasted.mfcAutoLabel);
    canvas.remove(pasted);

    // ---- deleting the image ----
    const labelCount = labelsOf(im).length, marks = canvas.getObjects().filter(o => o.mfcAnnotationFor === im.mfcId);
    canvas.remove(im); MFC.pushHistory();
    assert('Deleting an image deletes its labels, marks and ROIs (with their labels)', labelCount === 3 && marks.length > 5 && !canvas.getObjects().some(o => (o.mfcAutoLabel && o.mfcAutoLabel.for === im.mfcId) || o.mfcAnnotationFor === im.mfcId || o.mfcRoiFor));
    await MFC.undo(); await MFC_TIFF.whenIdle(); await frame();
    assert('Undo brings them all back', canvas.getObjects().filter(o => o.mfcAnnotationFor).length === marks.length && labelsOf(image()).length === 3);
    await MFC.redo(); await MFC_TIFF.whenIdle(); await frame();

    // ---- text: superscript, subscript, palette ----
    const text = new fabric.Textbox('Ca2+ and CO2', { left: 100, top: 400, width: 400, fontSize: 40, fontFamily: 'Liberation Sans' });
    Object.assign(text, { mfcId: 'txt' + Date.now(), mfcType: 'text' }); MFC.attachTextListeners(text);
    canvas.add(text); canvas.setActiveObject(text); MFC.refreshTextPanel();
    assert('The Text panel has Superscript and Subscript toggles with titles', $('text-superscript').title && $('text-subscript').title);
    text.enterEditing(); text.selectionStart = 2; text.selectionEnd = 4;
    $('text-superscript').click(); await frame();
    const st = i => (text.styles[0] || {})[i] || {};
    assert('Superscript: the highlighted "2+" raised and smaller', st(2).deltaY < 0 && near(st(2).fontSize, 24) && st(3).deltaY < 0 && !st(1).deltaY && !st(4).deltaY);
    canvas.setActiveObject(text); text.enterEditing(); text.selectionStart = 2; text.selectionEnd = 2; text.selectionEnd = 3; MFC.refreshTextPanel();
    assert('The toggle shows the script under the caret', $('text-superscript').classList.contains('active') && $('text-superscript').getAttribute('aria-pressed') === 'true');
    text.selectionStart = 11; text.selectionEnd = 12;
    $('text-subscript').click(); await frame();
    assert('Subscript: the "2" of CO2 lowered and smaller', st(11).deltaY > 0 && near(st(11).fontSize, 24));
    svg = (await MFC_EXPORT.buildSVG()).svg;
    const spans = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)];
    const sup = spans.find(m => m[1] === '2+'), sub = spans.find(m => m[1] === '2');
    assert('SVG: super- and subscripts are shifted tspans (dy), without a second baseline-shift', sup && /dy="-/.test(sup[0]) && sub && /dy="\d/.test(sub[0]) && !/baseline-shift/.test(svg), sup && sup[0]);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-5000px;top:0'; document.body.append(host);
    host.innerHTML = svg.replace(/<\?xml[^>]*>/, '');
    const tspans = [...host.querySelectorAll('tspan')], base = tspans.find(t => t.textContent.startsWith('Ca')), up = tspans.find(t => t.textContent === '2+');
    const rise = base.getBBox().y + base.getBBox().height - (up.getBBox().y + up.getBBox().height);
    host.remove();
    assert('…raised by the superscript shift once (0.35 × 40 px = 14 px, not twice)', rise > 9 && rise < 19, rise);
    canvas.setActiveObject(text); text.enterEditing(); text.selectionStart = 2; text.selectionEnd = 4;
    $('text-superscript').click(); await frame();
    assert('Superscript again on the same range takes it off', !st(2).deltaY && !st(2).fontSize && !st(3).deltaY);
    canvas.setActiveObject(text); text.enterEditing(); text.selectionStart = 11; text.selectionEnd = 12;
    $('text-superscript').click(); await frame();
    assert('Superscript on a subscript switches it', st(11).deltaY < 0 && near(st(11).fontSize, 24));
    canvas.setActiveObject(text); MFC.applyTextStyle('fontSize', 80);
    assert('A new box font size keeps the script proportional (48 px, raised)', near(st(11).fontSize, 48) && st(11).deltaY < -20 && text.fontSize === 80);

    const grid = $('text-special-grid'), buttons = [...grid.querySelectorAll('button')];
    const all = AM.SPECIAL_CHARACTERS.flatMap(([, list]) => list.map(([c]) => c));
    assert('The palette has a titled button for every character, in groups', buttons.length === all.length && buttons.every(b => b.title.startsWith('Insert ') && b.textContent === b.dataset.char) &&
      grid.querySelectorAll('[role="group"]').length === AM.SPECIAL_CHARACTERS.length);
    assert('The palette opens from a "Special characters" summary (keyboard: Enter)', $('text-special').tagName === 'DETAILS' && $('text-special').querySelector('summary').textContent === 'Special characters');
    canvas.setActiveObject(text); MFC.applyTextStyle('fontSize', 40);
    text.set('text', '5 m'); text.styles = {}; text.initDimensions();
    canvas.setActiveObject(text); text.enterEditing(); text.selectionStart = text.selectionEnd = 2;
    buttons.find(b => b.dataset.char === 'µ').click();
    assert('A palette button inserts at the caret, which moves after it', text.text === '5 µm' && text.selectionStart === 3 && text.isEditing);
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    buttons.find(b => b.dataset.char === '±').dispatchEvent(press);
    assert('…and does not take the focus from the text (its mousedown is cancelled)', press.defaultPrevented && text.isEditing);
    text.selectionStart = 0; text.selectionEnd = 1; buttons.find(b => b.dataset.char === 'α').click();
    assert('…replacing a highlighted range', text.text === 'α µm');
    text.exitEditing();
    canvas.discardActiveObject();
    toasts.length = 0; MFC_UI.toast = m => toasts.push(m);
    assert('With no text box selected it says what to do', TS.insertSpecialCharacter('°') === false && toasts.some(m => /text box/.test(m)));
    MFC_UI.toast = toast;

    // Every palette character must have a glyph in every embedded face: the PDF export checks each
    // character against the font (js/export.js), so a missing one would refuse the export.
    canvas.getObjects().filter(o => !MFC.isHelper(o)).forEach(o => canvas.remove(o));
    let y = 20;
    for (const family of ['Liberation Sans', 'Liberation Serif', 'Liberation Mono']) for (const [fontWeight, fontStyle] of [['normal', 'normal'], ['bold', 'normal'], ['normal', 'italic'], ['bold', 'italic']]) {
      const t = new fabric.Textbox(all.join(''), { left: 20, top: y, width: 1150, fontSize: 14, fontFamily: family, fontWeight, fontStyle });
      Object.assign(t, { mfcId: 'txt' + y, mfcType: 'text' }); canvas.add(t); y += 40;
    }
    MFC.pushHistory();
    const pdf = await MFC_EXPORT.buildPDF();
    assert('PDF: every palette character embeds in all twelve Liberation faces', pdf.blob.size > 10000 && pdf.fonts.length === 12, pdf.fonts.length);
    return checks;
  } finally {
    MFC.setTool('select');
  }
}

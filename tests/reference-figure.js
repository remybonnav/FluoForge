/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Reference figure: one figure with every object type, saved as tests/fixtures/reference.mfcproj.zip.
   Its SVG, PDF and TIFF exports are stored next to it, and tests/reference-check.js compares fresh
   exports of the saved project against them. Regenerate with `npm run make-reference` only when an
   export change is intended, and explain the change in the pull request. */

/** Minimal uncompressed 16-bit little-endian multipage TIFF with an ImageJ header. */
function referenceTiff(name, pages, w, h, description) {
  const desc = new TextEncoder().encode(description + '\0');
  const tagCount = 10, ifdSize = 2 + tagCount * 12 + 4, planeBytes = w * h * 2;
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
}

async function buildReferenceFigure() {
  const canvas = MFC.getCanvas();
  await MFC_PROJECT.createProject({ name: 'FluoForge reference figure', width: 1200, height: 800, unit: 'px', dpi: 300, pages: 2 });
  await document.fonts.load('40px "Liberation Sans"');
  await document.fonts.load('bold 40px "Liberation Serif"');

  // 1. A three-channel 16-bit TIFF with smooth structures (nuclei, filaments, a gradient).
  const W = 320, H = 240;
  const channel = fn => Array.from({ length: W * H }, (_, k) => Math.max(0, Math.min(65535, Math.round(fn(k % W, Math.floor(k / W))))));
  const blob = (x, y, cx, cy, r) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r));
  const pages = [
    channel((x, y) => 1500 + 52000 * (blob(x, y, 80, 70, 22) + blob(x, y, 210, 150, 30) + blob(x, y, 260, 60, 16))),
    channel((x, y) => 1200 + 30000 * (1 + Math.sin(x / 9 + y / 23)) * (0.5 + 0.5 * Math.cos(y / 31))),
    channel((x, y) => 400 + 180 * x + 40 * y)
  ];
  const tiff = referenceTiff('reference-cells.tif', pages, W, H,
    'ImageJ=1.54p\nimages=3\nchannels=3\nmode=composite\nunit=micron\nmin=0.0\nmax=60000.0\n');
  // 2. An 8-bit RGB raster (PNG) source.
  const rasterCanvas = document.createElement('canvas'); rasterCanvas.width = 160; rasterCanvas.height = 120;
  const rctx = rasterCanvas.getContext('2d');
  const gradient = rctx.createLinearGradient(0, 0, 160, 120); gradient.addColorStop(0, '#203060'); gradient.addColorStop(1, '#e0a030');
  rctx.fillStyle = gradient; rctx.fillRect(0, 0, 160, 120);
  rctx.fillStyle = '#ffffff'; rctx.beginPath(); rctx.arc(80, 60, 34, 0, Math.PI * 2); rctx.fill();
  const png = new File([await new Promise(resolve => rasterCanvas.toBlob(resolve, 'image/png'))], 'reference-raster.png', { type: 'image/png' });

  await MFC.importFiles([tiff]);
  const image = canvas.getObjects().find(o => o.mfcType === 'mfcImage' && o.mfcFileName === 'reference-cells.tif');
  const registry = MFC.getRegistry();
  registry[image.mfcId].rawImage.voxelSizeUm = 0.5;
  registry[image.mfcId].rawImage.channels[1].max = 50000;
  image.set({ left: 40, top: 40, scaleX: 1.5, scaleY: 1.5 }); image.setCoords(); MFC.recomposite(image);

  await MFC.importFiles([png]);
  const raster = canvas.getObjects().find(o => o.mfcType === 'mfcImage' && o.mfcFileName === 'reference-raster.png');
  raster.set({ left: 40, top: 470, scaleX: 1.4, scaleY: 1.4, angle: -6 }); raster.setCoords();

  // 3. Inset outline and its linked inset (dashed outline, enlarged copy).
  const contour = new fabric.Rect({ left: 150, top: 110, width: 90, height: 70, fill: 'transparent', stroke: '#ffff00', strokeWidth: 3, strokeDashArray: [10, 6] });
  contour.mfcId = 'refContour'; contour.mfcType = 'insetContour'; contour.mfcInsetSourceId = image.mfcId; canvas.add(contour);
  MFC.createInsetFromContour(contour);
  const inset = canvas.getActiveObject();
  inset.set({ left: 560, top: 40, scaleX: 4, scaleY: 4 }); inset.setCoords();

  // 4. Scale bar attached to the image.
  canvas.setActiveObject(image); MFC.refreshScaleBarRefList();
  document.getElementById('sb-length').value = 50; document.getElementById('sb-color').value = '#ffffff';
  MFC.placeScaleBarAtCorner('bottom-right', 5); canvas.discardActiveObject();

  // 5. Text box with a border, and a plain bold serif label.
  const textbox = new fabric.Textbox('Reference figure: every object type', { left: 560, top: 360, width: 560, fontFamily: 'Liberation Sans', fontSize: 34, fill: '#172031', textAlign: 'center' });
  textbox.mfcId = 'refTextbox'; textbox.mfcType = 'text'; textbox.mfcBorderWidth = 2; textbox.mfcBorderColor = '#76609e';
  MFC.attachTextListeners(textbox); canvas.add(textbox);
  const label = new fabric.Textbox('A', { left: 12, top: 6, width: 40, fontFamily: 'Liberation Serif', fontWeight: 'bold', fontSize: 40, fill: '#000000' });
  label.mfcId = 'refLabel'; label.mfcType = 'text'; MFC.attachTextListeners(label); canvas.add(label);

  // 6. Shapes: rectangle, ellipse, straight line, pen path with arrowheads.
  const rect = new fabric.Rect({ left: 600, top: 450, width: 160, height: 100, fill: 'rgba(118,96,158,0.25)', stroke: '#76609e', strokeWidth: 4, strokeUniform: true });
  rect.mfcId = 'refRect'; rect.mfcType = 'shape'; rect.mfcShapeKind = 'rect'; canvas.add(rect);
  const ellipse = new fabric.Ellipse({ left: 800, top: 450, rx: 80, ry: 50, fill: 'transparent', stroke: '#2f8f6b', strokeWidth: 4, strokeDashArray: [12, 8], strokeUniform: true });
  ellipse.mfcId = 'refEllipse'; ellipse.mfcType = 'shape'; ellipse.mfcShapeKind = 'ellipse'; canvas.add(ellipse);
  const line = new fabric.Path('M 600 600 L 780 640', { stroke: '#d0342c', strokeWidth: 5, fill: 'transparent', strokeUniform: true });
  line.mfcId = 'refLine'; line.mfcType = 'shape'; line.mfcShapeKind = 'line'; MFC.installCurveControls(line); canvas.add(line);
  const path = new fabric.Path('M 820 700 Q 900 590 1000 660 Q 1080 720 1150 600', { stroke: '#b31860', strokeWidth: 5, fill: 'transparent' });
  path.mfcId = 'refPath'; path.mfcType = 'shape'; path.mfcShapeKind = 'curve'; MFC.installCurveControls(path);
  path.mfcArrowStart = 'arrow'; path.mfcArrowEnd = 'arrow'; canvas.add(path);

  // 7. A group: a small rectangle with a caption.
  const groupRect = new fabric.Rect({ left: 980, top: 450, width: 150, height: 60, fill: '#ece5f7', stroke: '#172031', strokeWidth: 2 });
  groupRect.mfcId = 'refGroupRect'; groupRect.mfcType = 'shape'; groupRect.mfcShapeKind = 'rect'; canvas.add(groupRect);
  const groupText = new fabric.Text('Grouped', { left: 1000, top: 462, fontFamily: 'Liberation Sans', fontSize: 30, fill: '#172031' });
  groupText.mfcId = 'refGroupText'; canvas.add(groupText);
  canvas.setActiveObject(new fabric.ActiveSelection([groupRect, groupText], { canvas })); MFC.groupSelection(); canvas.discardActiveObject();

  // 8. An image copy cropped to a circle (crop to shape).
  canvas.setActiveObject(image); MFC.copySelection(); await MFC.pasteSelection();
  const copy = canvas.getActiveObject();
  copy.set({ left: 300, top: 470, scaleX: 1, scaleY: 1 }); copy.setCoords();
  const circle = new fabric.Ellipse({ left: 330, top: 490, rx: 90, ry: 90, fill: 'transparent', stroke: '#ffffff', strokeWidth: 3, strokeUniform: true });
  circle.mfcId = 'refCropCircle'; circle.mfcType = 'shape'; circle.mfcShapeKind = 'ellipse'; canvas.add(circle);
  canvas.setActiveObject(new fabric.ActiveSelection([copy, circle], { canvas })); canvas.fire('selection:created');
  await MFC.cropToShape(); canvas.discardActiveObject();

  // 9. Page 2: one label, so multi-page PDF export is covered.
  const page2 = MFC.pageBounds(1);
  const page2Text = new fabric.Textbox('Page 2', { left: page2.left + 60, top: page2.top + 60, width: 400, fontFamily: 'Liberation Mono', fontSize: 48, fill: '#172031' });
  page2Text.mfcId = 'refPage2Text'; page2Text.mfcType = 'text'; MFC.attachTextListeners(page2Text); canvas.add(page2Text);

  canvas.renderAll(); MFC.pushHistory();
  const next = MFC_PROJECT.prepareSave(true, 'Reference');
  return MFC_PROJECT.buildArchive(next);
}

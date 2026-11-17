/* Run in the locally served editor with: await runMfcRegressions() */
async function runMfcRegressions() {
  const checks = [];
  const assert = (name, condition) => {
    if (!condition) throw new Error('Regression failed: ' + name);
    checks.push(name);
  };
  MFC.applyDocProps({name:'Interaction regression',width:1000,height:700,unit:'px',dpi:300});
  const canvas = MFC.getCanvas();
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcCanvas.height = 64;
  srcCanvas.getContext('2d').fillRect(0, 0, 64, 64);
  const blob = await new Promise(resolve => srcCanvas.toBlob(resolve, 'image/png'));
  const files = [1, 2].map(i => new File([blob], 'regression' + i + '.png', { type: 'image/png' }));
  await MFC.importFiles(files);
  const images = canvas.getObjects().filter(o => o.mfcType === 'mfcImage');
  assert('two raster images import', images.length === 2);
  images.forEach(o => { MFC.getRegistry()[o.mfcId].rawImage.voxelSizeUm = 1; });
  const x = o => o.calcTransformMatrix()[4];
  const y = o => o.calcTransformMatrix()[5];
  canvas.setActiveObject(new fabric.ActiveSelection(images, { canvas }));
  MFC.placeScaleBarOnSelectedImages('bottom-right', 5);
  const bars = canvas.getObjects().filter(o => o.mfcType === 'scalebar');
  assert('one bar per image', bars.length === 2);
  assert('bars initially placed by their own images', bars.every(bar => {
    const img = images.find(o => o.mfcId === bar.mfcAttachedTo);
    return Math.abs(x(bar) - x(img)) < img.getScaledWidth() / 2 &&
      Math.abs(y(bar) - y(img)) < img.getScaledHeight() / 2;
  }));
  canvas.discardActiveObject();
  canvas.setActiveObject(new fabric.ActiveSelection(images, { canvas }));
  const barX = bars.map(x);
  MFC.nudgeSelection(25, 15, false);
  assert('bars follow multi-image keyboard move', bars.every((bar, i) => Math.abs(x(bar) - barX[i] - 25) < 1));
  const selection = canvas.getActiveObject();
  const dragBarX = bars.map(x);
  selection.set({ left: selection.left + 12, top: selection.top + 8 });
  selection.setCoords();
  canvas.fire('object:moving', { target: selection, e: { altKey: true } });
  assert('bars follow multi-image mouse drag', bars.every((bar, i) => Math.abs(x(bar) - dragBarX[i] - 12) < 1));
  canvas.discardActiveObject();
  const img = images[0];
  const contour = new fabric.Rect({ left: img.left + 5, top: img.top + 5,
    width: 24, height: 20, stroke: '#ffcc00', fill: 'transparent' });
  contour.mfcId = 'regressionContour'; contour.mfcType = 'insetContour'; contour.mfcInsetSourceId = img.mfcId;
  canvas.add(contour); canvas.setActiveObject(contour); MFC.createInsetFromContour(contour);
  const inset = canvas.getObjects().find(o => o.mfcIsInset);
  const crop = [inset.cropX, inset.cropY, inset.width, inset.height];
  const display = [inset.getScaledWidth(), inset.getScaledHeight()];
  img.set({ left: img.left + 18, top: img.top + 12 }); img.setCoords();
  canvas.fire('object:moving', { target: img, e: { altKey: true } });
  assert('source move preserves inset crop', crop.every((v, i) => v === [inset.cropX, inset.cropY, inset.width, inset.height][i]));
  assert('source move preserves inset size', display.every((v, i) => v === [inset.getScaledWidth(), inset.getScaledHeight()][i]));
  canvas.setActiveObject(inset); MFC.copySelection(); await MFC.pasteSelection();
  assert('inset copy retains source region', canvas.getActiveObject().mfcInsetContourId === contour.mfcId);
  const text = new fabric.Textbox('Border', { left: 10, top: 120, width: 80, fill: '#000000' });
  text.mfcId = 'regressionText'; text.mfcType = 'text'; text.mfcBorderWidth = 3;
  text.mfcBorderColor = '#ff00ff'; MFC.attachTextListeners(text); canvas.add(text);
  canvas.setActiveObject(text); MFC.copySelection(); await MFC.pasteSelection();
  assert('text border survives copy', canvas.getActiveObject().mfcBorderWidth === 3 &&
    canvas.getActiveObject().mfcBorderColor === '#ff00ff');
  const line = new fabric.Path('M 10 180 L 100 200', { stroke: '#ff0000', fill: 'transparent' });
  line.mfcId = 'regressionLine'; line.mfcType = 'shape'; line.mfcShapeKind = 'line'; canvas.add(line);
  const curve = new fabric.Path('M 10 220 Q 50 180 100 220', { stroke: '#00ff00', fill: 'transparent' });
  curve.mfcId = 'regressionCurve'; curve.mfcType = 'shape'; curve.mfcShapeKind = 'curve';
  MFC.installCurveControls(curve); canvas.add(curve);
  canvas.setActiveObject(curve); MFC.copySelection(); await MFC.pasteSelection();
  const curveCopy = canvas.getActiveObject(); MFC.enterPathEdit(curveCopy);
  assert('curve copy has editable nodes and handles', curveCopy.mfcShapeKind === 'path' &&
    curveCopy.mfcPathNodes.length === 2 && Object.keys(curveCopy.controls).some(key => key.startsWith('a')));
  MFC.exitPathEdit(curveCopy);
  assert('curve exports to SVG', canvas.getActiveObject().toSVG().includes('<path'));
  assert('new text defaults to black', document.getElementById('text-color').value === '#000000');
  canvas.setActiveObject(line);
  const oldX = x(line); MFC.nudgeSelection(1, 0, true);
  assert('keyboard passes snap points', Math.abs(x(line) - oldX - 1) < 0.01);
  const text2 = new fabric.Textbox('Second', { left: 120, top: 120, width: 80, fill: '#123456' });
  text2.mfcId = 'regressionText2'; text2.mfcType = 'text'; MFC.attachTextListeners(text2); canvas.add(text2);
  const pairs = [
    ['image + image', [images[0], images[1]]],
    ['image + text', [images[0], text]],
    ['image + scale bar', [images[0], bars[0]]],
    ['image + inset', [images[0], inset]],
    ['two texts', [text, text2]],
    ['mixed annotations', [images[0], text, line, curve]],
    ['images and bars', [images[0], images[1], bars[0], bars[1]]]
  ];
  for (const [name, objects] of pairs) {
    canvas.discardActiveObject();
    canvas.setActiveObject(new fabric.ActiveSelection(objects, { canvas }));
    const oldPositions = objects.map(o => [x(o), y(o)]);
    MFC.copySelection(); await MFC.pasteSelection();
    const copies = canvas.getActiveObjects();
    assert(name + ' copies all objects', copies.length === objects.length);
    assert(name + ' preserves relative positions', copies.every((o, i) =>
      Math.abs(x(o) - oldPositions[i][0] - 24) < 1 && Math.abs(y(o) - oldPositions[i][1] - 24) < 1));
    if (name === 'image + scale bar' || name === 'images and bars') {
      assert(name + ' remaps bar links', copies.filter(o => o.mfcType === 'scalebar').every(bar =>
        copies.some(img => img.mfcType === 'mfcImage' && img.mfcId === bar.mfcAttachedTo)));
    }
  }
  canvas.discardActiveObject(); canvas.setActiveObject(new fabric.ActiveSelection([text, text2], { canvas }));
  await MFC.duplicateSelection();
  assert('duplicate command copies multiple objects', canvas.getActiveObjects().length === 2);
  canvas.discardActiveObject(); canvas.setActiveObject(new fabric.ActiveSelection([images[0], images[1]], { canvas }));
  const oldMultiX = images.map(x); MFC.nudgeSelection(1, 0, true);
  assert('multi-selection arrow movement', images.every((o, i) => Math.abs(x(o) - oldMultiX[i] - 1) < 0.01));
  canvas.discardActiveObject();
  const oldBarWidth = bars[0]._objects[0].width;
  images[0].set({ scaleX: images[0].scaleX * 1.5, scaleY: images[0].scaleY * 1.5 });
  images[0].setCoords();
  canvas.fire('object:scaling', { target: images[0], e: {} });
  assert('scale bar recalibrates with image resize', bars[0]._objects[0].width > oldBarWidth * 1.4);
  return checks;
}

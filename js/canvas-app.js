/*
 * canvas-app.js
 * -----------------------------------------------------------------------
 * Fabric.js canvas orchestration: importing images as fabric objects,
 * the channel control panel, crop / text / scale-bar tools, alignment,
 * and a lightweight property-snapshot undo/redo stack.
 *
 * Design decisions (per the brief's open questions):
 *  - Aspect ratio is LOCKED BY DEFAULT on resize; hold Shift while
 *    dragging a corner handle to resize freely (unlocked).
 *  - Channel count is unlimited / dynamic, driven entirely by the number
 *    of pages found in the imported TIFF.
 *  - Large images: the on-canvas composite is capped at 2048px on the
 *    long edge for interactive performance (see tiff.js MAX_WORKING_DIM).
 *    Raw 16-bit channel arrays are kept in memory and re-composited at
 *    full resolution at export time, so exports are never downsampled.
 * -----------------------------------------------------------------------
 */

const MFC = (function () {

  const DASH_PRESETS = {
    solid: null,
    dashed: [12, 8],
    dotted: [2, 5],
    dashdot: [12, 5, 2, 5],
    longdash: [22, 10]
  };

  let canvas;                       // fabric.Canvas
  const MFC_VERSION = '0.18';
  function getAppVersion() { return MFC_VERSION; }

  let docProps = { name: 'Untitled Figure', width: 1748, height: 1240, unit: 'px', dpi: 300 }; // A4-ish default @300dpi
  let currentTool = 'select';
  let nextId = 1;
  const registry = {};              // id -> { rawImage (from tiff.js), fileBase64 }

  // ---- history (lightweight property snapshots, keyed by object id) ----
  const history = { stack: [], index: -1, limit: 200 };

  function snapshotState() {
    return canvas.getObjects().filter(o => !o.mfcIsPageBounds).map(o => serializeObjectState(o));
  }

  function serializeObjectState(o) {
    const base = {
      id: o.mfcId, type: o.mfcType || o.type,
      left: o.left, top: o.top, scaleX: o.scaleX, scaleY: o.scaleY,
      angle: o.angle, width: o.width, height: o.height,
      cropX: o.cropX || 0, cropY: o.cropY || 0,
      visible: o.visible !== false, locked: !!o.mfcLocked
    };
    if (o.mfcType === 'mfcImage') {
      const entry = registry[o.mfcId];
      base.channels = entry ? JSON.parse(JSON.stringify(
        entry.rawImage.channels.map(c => ({ enabled: c.enabled, color: c.color, min: c.min, max: c.max }))
      )) : null;
      if (entry) {
        base.brightness = entry.rawImage.brightness || 0;
        base.contrast = entry.rawImage.contrast || 0;
        base.alphaEnabled = entry.rawImage.alphaEnabled !== false;
        base.voxelSizeUm = entry.rawImage.voxelSizeUm != null ? entry.rawImage.voxelSizeUm : null;
      }
      base.mfcFileName = o.mfcFileName;
      base.mfcIsInset = !!o.mfcIsInset;
      base.mfcInsetContourId = o.mfcInsetContourId || null;
      base.mfcInsetSourceId = o.mfcInsetSourceId || null;
    } else if (o.type === 'textbox') {
      base.text = o.text;
      base.styles = JSON.parse(JSON.stringify(o.styles || {}));
      base.fontFamily = o.fontFamily; base.fontSize = o.fontSize; base.fill = o.fill;
      base.backgroundColor = o.backgroundColor; base.textAlign = o.textAlign;
      base.mfcBorderWidth = o.mfcBorderWidth || 0; base.mfcBorderColor = o.mfcBorderColor || '#000000';
    } else if (o.type === 'rect' && o.mfcType === 'shape') {
      base.stroke = o.stroke; base.strokeWidth = o.strokeWidth;
      base.fill = o.fill; base.strokeDashArray = o.strokeDashArray ? o.strokeDashArray.slice() : null;
    } else {
      // Everything else (scale bars, inset outlines, and any future misc object type):
      // capture a full Fabric serialization as a reconstruction fallback, so undo can
      // recreate one from scratch if it was deleted. Safe here (unlike mfcImage) since
      // none of these embed large pixel payloads in their toObject() output.
      base.fabricJSON = o.toObject([
        'mfcId', 'mfcType', 'mfcAttachedTo', 'mfcCorner', 'mfcMarginPct',
        'mfcInsetSourceId', 'mfcInsetTargetId', 'mfcRelX', 'mfcRelY', 'mfcRelW', 'mfcRelH'
      ]);
    }
    return base;
  }

  function pushHistory() {
    const snap = snapshotState();
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(snap);
    if (history.stack.length > history.limit) history.stack.shift();
    history.index = history.stack.length - 1;
  }

  /** Builds a fresh fabric object for a snapshot entry whose object no longer exists on canvas (i.e. undo needs to restore something that was deleted). Returns null (synchronously) for the fabricJSON-fallback types (scalebar/insetContour), which are handled separately in applySnapshot since enlivenObjects is async. */
  function reconstructObject(s) {
    if (s.type === 'mfcImage') {
      const entry = registry[s.id];
      if (!entry) { console.warn('Cannot restore image ' + s.id + ' — its source data is no longer available.'); return null; }
      const compositeCanvas = MFC_TIFF.compositeChannels(entry.rawImage, entry.workingScale);
      const img = new fabric.Image(compositeCanvas, {
        cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
      });
      img.mfcId = s.id;
      img.mfcType = 'mfcImage';
      img.mfcRawWidth = entry.rawImage.width;
      img.mfcRawHeight = entry.rawImage.height;
      img.mfcFileName = s.mfcFileName || entry.rawImage.fileName;
      img.mfcIsInset = !!s.mfcIsInset;
      img.mfcInsetContourId = s.mfcInsetContourId || null;
      img.mfcInsetSourceId = s.mfcInsetSourceId || null;
      return img;
    }
    if (s.type === 'textbox' || s.type === 'text') {
      const t = new fabric.Textbox(s.text || '', {
        fontFamily: s.fontFamily, fontSize: s.fontSize, fill: s.fill, styles: s.styles,
        backgroundColor: s.backgroundColor || '', textAlign: s.textAlign || 'left'
      });
      t.mfcId = s.id; t.mfcType = 'text';
      t.mfcBorderWidth = s.mfcBorderWidth || 0; t.mfcBorderColor = s.mfcBorderColor || '#000000';
      attachTextListeners(t);
      return t;
    }
    if (s.type === 'shape') {
      const r = new fabric.Rect({
        stroke: s.stroke, strokeWidth: s.strokeWidth, fill: s.fill, strokeDashArray: s.strokeDashArray,
        cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
      });
      r.mfcId = s.id; r.mfcType = 'shape';
      return r;
    }
    return null;
  }

  /** Reconstructs a fabricJSON-fallback object (scalebar/insetContour) via Fabric's async enlivenObjects. */
  function reconstructFromFabricJSON(s) {
    return new Promise((resolve) => {
      fabric.util.enlivenObjects([s.fabricJSON], (enlivened) => {
        const o = enlivened[0];
        o.mfcId = s.id; o.mfcType = s.type;
        const j = s.fabricJSON;
        if (j.mfcAttachedTo) o.mfcAttachedTo = j.mfcAttachedTo;
        if (j.mfcCorner) o.mfcCorner = j.mfcCorner;
        if (j.mfcMarginPct != null) o.mfcMarginPct = j.mfcMarginPct;
        if (j.mfcInsetSourceId) o.mfcInsetSourceId = j.mfcInsetSourceId;
        if (j.mfcInsetTargetId) o.mfcInsetTargetId = j.mfcInsetTargetId;
        if (j.mfcRelX != null) o.mfcRelX = j.mfcRelX;
        if (j.mfcRelY != null) o.mfcRelY = j.mfcRelY;
        if (j.mfcRelW != null) o.mfcRelW = j.mfcRelW;
        if (j.mfcRelH != null) o.mfcRelH = j.mfcRelH;
        resolve(o);
      });
    });
  }

  async function applySnapshot(snap) {
    const byId = {};
    canvas.getObjects().forEach(o => { if (!o.mfcIsPageBounds) byId[o.mfcId] = o; });
    const snapIds = new Set(snap.map(s => s.id));

    // Remove objects that exist on canvas but aren't in this snapshot — undo of an add,
    // or redo of a delete.
    Object.keys(byId).forEach(id => {
      if (!snapIds.has(id)) { canvas.remove(byId[id]); delete byId[id]; }
    });

    // Add back (or update) every object the snapshot describes.
    for (const s of snap) {
      let o = byId[s.id];
      if (!o) {
        // Undo of a delete, or redo of an add whose object was itself removed by a later
        // undo step — either way, it doesn't exist on canvas right now and needs rebuilding.
        o = s.fabricJSON ? await reconstructFromFabricJSON(s) : reconstructObject(s);
        if (!o) continue;
        canvas.add(o);
        byId[s.id] = o;
      }
      o.set({ left: s.left, top: s.top, scaleX: s.scaleX, scaleY: s.scaleY, angle: s.angle,
               width: s.width, height: s.height, cropX: s.cropX, cropY: s.cropY,
               visible: s.visible !== false });
      o.mfcLocked = !!s.locked;
      o.selectable = !o.mfcLocked;
      o.evented = !o.mfcLocked;
      if (s.type === 'mfcImage' && s.channels && registry[s.id]) {
        const entry = registry[s.id];
        entry.rawImage.channels.forEach((c, i) => Object.assign(c, s.channels[i]));
        if (s.brightness !== undefined) entry.rawImage.brightness = s.brightness;
        if (s.contrast !== undefined) entry.rawImage.contrast = s.contrast;
        if (s.alphaEnabled !== undefined) entry.rawImage.alphaEnabled = s.alphaEnabled;
        if (s.voxelSizeUm !== undefined) entry.rawImage.voxelSizeUm = s.voxelSizeUm;
        recomposite(o);
      }
      if (o.type === 'textbox') {
        o.set({ text: s.text, styles: s.styles, fontFamily: s.fontFamily, fontSize: s.fontSize, fill: s.fill,
                backgroundColor: s.backgroundColor, textAlign: s.textAlign || 'left' });
        o.mfcBorderWidth = s.mfcBorderWidth || 0; o.mfcBorderColor = s.mfcBorderColor || '#000000';
        o.initDimensions && o.initDimensions();
      }
      if (o.type === 'rect' && o.mfcType === 'shape') {
        o.set({ stroke: s.stroke, strokeWidth: s.strokeWidth, fill: s.fill, strokeDashArray: s.strokeDashArray });
      }
      o.setCoords();
    }

    canvas.discardActiveObject();
    canvas.requestRenderAll();
    refreshShapePanel();
    refreshChannelPanel();
    refreshTextPanel();
    refreshObjectSizePanel();
    refreshScaleBarRefList();
    refreshInsetPanel();
    refreshLayersPanel();
  }

  async function undo() {
    if (history.index <= 0) return;
    history.index--;
    await applySnapshot(history.stack[history.index]);
  }
  async function redo() {
    if (history.index >= history.stack.length - 1) return;
    history.index++;
    await applySnapshot(history.stack[history.index]);
  }

  // ---- init ----
  function init() {
    canvas = new fabric.Canvas('mfc-canvas', {
      preserveObjectStacking: true,
      selection: true
    });
    applyDocProps(docProps);

    canvas.on('object:modified', (e) => {
      const obj = e.target;
      // Textbox handles: corner/top/bottom drags change scaleX/scaleY (which stretch the
      // glyphs without touching the numeric fontSize property — that's the bug where the
      // Size field in the panel goes stale). Convert any leftover scale into a real
      // fontSize + width change and reset scale to 1, so what's on screen always matches
      // the number in the panel.
      if (obj && obj.type === 'textbox' && (obj.scaleX !== 1 || obj.scaleY !== 1)) {
        const newFontSize = Math.max(4, Math.round(obj.fontSize * obj.scaleY));
        const newWidth = Math.max(20, obj.width * obj.scaleX);
        obj.set({ fontSize: newFontSize, width: newWidth, scaleX: 1, scaleY: 1 });
        obj.setCoords();
        refreshTextPanel();
      }
      pushHistory();
    });
    canvas.on('selection:created', onSelectionChanged);
    canvas.on('selection:updated', onSelectionChanged);
    canvas.on('selection:cleared', onSelectionChanged);
    canvas.on('object:added', () => refreshLayersPanel());
    canvas.on('object:removed', () => refreshLayersPanel());
    canvas.on('text:changed', () => { /* debounced via object:modified on blur */ });
    canvas.on('mouse:down', onCanvasMouseDown);
    canvas.on('mouse:move', onCanvasMouseMove);
    canvas.on('mouse:up', onCanvasMouseUp);

    canvas.on('object:moving', (e) => {
      if (!e.target || e.target === cropRect) return;
      if (!(e.e && e.e.altKey)) snapObjectPosition(e.target); // hold Alt to move freely without snapping
      if (e.target.mfcType === 'mfcImage') { repositionAttachedScaleBars(e.target); followSourceImage(e.target); }
      if (e.target.mfcType === 'insetContour') syncInsetFromContour(e.target);
      if (e.target.type === 'activeSelection') {
        e.target.getObjects().forEach(o => { if (o.mfcType === 'mfcImage') { repositionAttachedScaleBars(o); followSourceImage(o); } });
      }
    });

    // Ctrl+scroll (or pinch, which browsers report as ctrlKey+wheel) zooms the CANVAS,
    // not the page. Plain scroll pans the canvas-wrap div as normal (its own scrollbars).
    canvas.on('mouse:wheel', (opt) => {
      if (!opt.e.ctrlKey) return; // let the page/div scroll normally otherwise
      opt.e.preventDefault();
      opt.e.stopPropagation();
      setZoom(zoomLevel * (0.999 ** opt.e.deltaY));
    });

    // default-locked aspect ratio; Shift unlocks (fabric convention: uniformScaling + key)
    canvas.uniformScaling = true;
    canvas.on('object:scaling', (e) => {
      const evt = e.e;
      const obj = e.target;

      if (obj === cropRect) {
        // crop rect resizing is handled by its own logic (free rectangle by default,
        // forced 1:1 only in "square" mode) — see setCropAspectMode/applyCrop section.
        if (cropAspectMode === 'square') {
          const s = Math.max(obj.scaleX, obj.scaleY);
          obj.scaleX = s; obj.scaleY = s;
        }
        syncCropFieldsFromRect();
        return;
      }

      if (evt && evt.shiftKey) {
        obj.lockUniScaling = false; // free resize while Shift held
      } else {
        // enforce uniform scale even if user grabs a side handle
        const s = Math.max(obj.scaleX, obj.scaleY);
        obj.scaleX = s; obj.scaleY = s;
      }

      if (obj.mfcType === 'mfcImage') { updateScaleBarsForImage(obj); followSourceImage(obj); }
      if (obj.mfcType === 'insetContour') syncInsetFromContour(obj);
      refreshObjectSizePanel();
      if (obj.type === 'textbox') refreshTextPanel();
    });

    pushHistory();
  }

  // ---- zoom (resizes the actual canvas element too, so the document boundary
  // visibly scales with it — not just the objects inside a fixed-size canvas) ----
  //
  // PAGE_PAD adds a pasteboard margin (in doc-space px, so it scales with zoom like
  // everything else) around the document on all sides. Object coordinates stay
  // doc-relative (0,0 = top-left of the page) exactly as before — we only shift the
  // canvas *viewport* by PAGE_PAD so the page renders inset from the canvas edge.
  // Before this, the fabric canvas element was sized to EXACTLY the document, so
  // anything positioned outside [0,docW]x[0,docH] fell outside the canvas's own pixel
  // bounds — it couldn't be drawn or receive mouse events, which is why dragging an
  // object past the document edge made it vanish and become permanently unselectable.
  const PAGE_PAD = 260;
  let zoomLevel = 1;
  let pageRect = null;

  /** Creates (or resizes/re-adds, e.g. after canvas.clear()) the white page-bounds rect that visually marks the document area within the larger pasteboard. Excluded from selection, history, save/export. */
  function ensurePageRect() {
    const docPx = docPropsToPixels(docProps);
    if (!pageRect || canvas.getObjects().indexOf(pageRect) === -1) {
      pageRect = new fabric.Rect({
        left: 0, top: 0, width: docPx.width, height: docPx.height,
        fill: '#ffffff', stroke: '#000000', strokeWidth: 1,
        selectable: false, evented: false, hoverCursor: 'default',
        shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.45)', blur: 30, offsetX: 0, offsetY: 12 })
      });
      pageRect.mfcIsPageBounds = true; // flag: never serialized, selected, copied, or history-tracked
      canvas.add(pageRect);
    } else {
      pageRect.set({ width: docPx.width, height: docPx.height });
    }
    canvas.sendToBack(pageRect);
  }

  function updateZoomDisplay() {
    const el = document.getElementById('zoom-display');
    if (el) el.textContent = Math.round(zoomLevel * 100) + '%';
  }
  function zoomIn() { setZoom(zoomLevel * 1.2); }
  function zoomOut() { setZoom(zoomLevel / 1.2); }
  function zoomReset() { setZoom(1); }
  function setZoom(z) {
    zoomLevel = Math.min(20, Math.max(0.05, z));
    const docPx = docPropsToPixels(docProps);
    canvas.setZoom(zoomLevel);
    canvas.setWidth((docPx.width + PAGE_PAD * 2) * zoomLevel);
    canvas.setHeight((docPx.height + PAGE_PAD * 2) * zoomLevel);
    // Pan the viewport so doc-space (0,0) lands PAGE_PAD in from the canvas edge,
    // leaving pasteboard margin on every side. renderFullResCanvas/exportSVG (export.js,
    // via withDocOnlyView below) temporarily undo this so exports only capture the page.
    const vpt = canvas.viewportTransform;
    vpt[4] = PAGE_PAD * zoomLevel;
    vpt[5] = PAGE_PAD * zoomLevel;
    canvas.setViewportTransform(vpt);
    canvas.requestRenderAll();
    updateZoomDisplay();
  }
  function getZoomLevel() { return zoomLevel; }

  /**
   * Runs `callback(docPx)` with the canvas temporarily resized to EXACTLY the document
   * (no pasteboard margin, no pan offset), so raster/SVG export only captures the page
   * itself — anything parked out in the pasteboard is naturally clipped out, never
   * baked into a TIFF/SVG/PDF export. Restores the normal pasteboard view afterward.
   */
  function withDocOnlyView(callback) {
    const docPx = docPropsToPixels(docProps);
    const prevW = canvas.getWidth(), prevH = canvas.getHeight();
    const prevVpt = canvas.viewportTransform.slice();
    canvas.setZoom(1);
    canvas.setWidth(docPx.width);
    canvas.setHeight(docPx.height);
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.requestRenderAll();
    try {
      return callback(docPx);
    } finally {
      canvas.setWidth(prevW);
      canvas.setHeight(prevH);
      canvas.setZoom(zoomLevel);
      canvas.setViewportTransform(prevVpt); // explicit, so it wins regardless of what setZoom() did to the translation
      canvas.requestRenderAll();
    }
  }

  function applyDocProps(props) {
    docProps = props;
    setZoom(zoomLevel); // recomputes canvas dimensions from the new docProps at current zoom
    ensurePageRect();
  }

  function docPropsToPixels(props) {
    let w = props.width, h = props.height;
    if (props.unit === 'cm') { w = (w / 2.54) * props.dpi; h = (h / 2.54) * props.dpi; }
    else if (props.unit === 'in') { w = w * props.dpi; h = h * props.dpi; }
    return { width: Math.round(w), height: Math.round(h) };
  }

  function getDocProps() { return docProps; }

  /** Updates just the project name, live as the user types — separate from applyDocProps
   * (which also resizes the canvas) so Save/Save As always use the name currently shown
   * in the field, even if the user never clicked "Apply". Previously, typing a new name
   * and immediately using Save As would silently save under the *old* name because
   * docProps.name was only ever touched by the Apply button. */
  function setDocName(name) {
    docProps.name = (name || '').trim() || 'Untitled Figure';
  }
  function getCanvas() { return canvas; }

  // ---- image import ----
  async function importFiles(fileList) {
    for (const file of Array.from(fileList)) {
      try {
        const isTiff = /\.tiff?$/i.test(file.name);
        const rawImage = isTiff ? await MFC_TIFF.decodeFile(file) : await MFC_TIFF.decodeRasterImage(file);
        await addImageToCanvas(rawImage, file);
      } catch (err) {
        console.error(err);
        MFC_UI.toast('Failed to import ' + file.name + ': ' + err.message);
      }
    }
  }

  async function addImageToCanvas(rawImage, sourceFile) {
    const scale = MFC_TIFF.workingScale(rawImage.width, rawImage.height);
    const compositeCanvas = MFC_TIFF.compositeChannels(rawImage, scale);

    const id = 'img' + (nextId++);
    let fileBase64 = null;
    if (sourceFile) {
      fileBase64 = await fileToBase64(sourceFile);
    }
    registry[id] = { rawImage, fileBase64, workingScale: scale };

    const fabricImg = new fabric.Image(compositeCanvas, {
      left: 40 + (canvas.getObjects().length * 20) % 200,
      top: 40 + (canvas.getObjects().length * 20) % 200,
      cornerStyle: 'circle',
      transparentCorners: false,
      cornerColor: '#5b8cff',
      borderColor: '#5b8cff'
    });
    fabricImg.mfcId = id;
    fabricImg.mfcType = 'mfcImage';
    fabricImg.mfcRawWidth = rawImage.width;
    fabricImg.mfcRawHeight = rawImage.height;
    fabricImg.mfcFileName = rawImage.fileName;

    canvas.add(fabricImg);
    canvas.setActiveObject(fabricImg);
    canvas.requestRenderAll();
    pushHistory();
    refreshChannelPanel();
    refreshScaleBarRefList();
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result); // data URL
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  /** Recompute the composite for a given fabric image object from its raw channel data. */
  function recomposite(fabricImg, fullRes) {
    const entry = registry[fabricImg.mfcId];
    if (!entry) return;
    const scale = fullRes ? 1 : entry.workingScale;
    const newCanvas = MFC_TIFF.compositeChannels(entry.rawImage, scale);
    const curScaleX = fabricImg.scaleX, curScaleY = fabricImg.scaleY;
    const curWidth = fabricImg.width, curHeight = fabricImg.height;
    const curCropX = fabricImg.cropX, curCropY = fabricImg.cropY;
    fabricImg.setElement(newCanvas);
    // Fabric's setElement() resets width/height to the new element's full native size
    // (via _setWidthHeight) but leaves cropX/cropY untouched — so a cropped image would
    // end up with a nonzero crop *offset* but a full-size crop *window*, drawing past the
    // intended crop out to the original image's edges with blank space filling the gap.
    // That's what made cropped images "un-crop" themselves on any channel edit, and (since
    // this ran again right after the crop was restored) on every project reload — and it
    // corrupted the image's bounding box, which is also why attached scale bars snapped
    // back to a corner of the original uncropped image instead of the cropped one.
    fabricImg.width = curWidth; fabricImg.height = curHeight;
    fabricImg.cropX = curCropX; fabricImg.cropY = curCropY;
    fabricImg.scaleX = curScaleX; fabricImg.scaleY = curScaleY;
    fabricImg.setCoords();
    canvas.requestRenderAll();
  }

  // ---- channel panel ----
  function refreshChannelPanel() {
    const listEl = document.getElementById('channel-list');
    const nameEl = document.getElementById('channel-image-name');
    const active = canvas.getActiveObject();
    const calibBox = document.getElementById('channel-calibration');
    const alphaBox = document.getElementById('channel-alpha');
    const toneBox = document.getElementById('channel-tone');

    if (!active || active.mfcType !== 'mfcImage') {
      listEl.innerHTML = '<p class="hint">Select an image to edit its channels.</p>';
      nameEl.textContent = '';
      calibBox.classList.add('hidden');
      alphaBox.classList.add('hidden');
      toneBox.classList.add('hidden');
      return;
    }
    const entry = registry[active.mfcId];
    nameEl.textContent = '— ' + active.mfcFileName;
    listEl.innerHTML = '';

    calibBox.classList.remove('hidden');
    const pxSizeInput = document.getElementById('ch-pixelsize');
    pxSizeInput.value = entry.rawImage.voxelSizeUm != null ? entry.rawImage.voxelSizeUm : '';
    document.getElementById('ch-pixelsize-hint').textContent = entry.rawImage.voxelSizeUm != null
      ? 'Used to calibrate scale bars for this image.'
      : 'No pixel size found in this file — enter one manually to enable scale bars for this image.';

    alphaBox.classList.toggle('hidden', !entry.rawImage.hasAlpha);
    if (entry.rawImage.hasAlpha) {
      document.getElementById('ch-alpha-toggle').checked = entry.rawImage.alphaEnabled !== false;
    }

    toneBox.classList.remove('hidden');
    document.getElementById('ch-brightness').value = entry.rawImage.brightness || 0;
    document.getElementById('ch-brightness-val').value = entry.rawImage.brightness || 0;
    document.getElementById('ch-contrast').value = entry.rawImage.contrast || 0;
    document.getElementById('ch-contrast-val').value = entry.rawImage.contrast || 0;

    entry.rawImage.channels.forEach((ch, idx) => {
      const row = document.createElement('div');
      row.className = 'channel-row';

      const colorOptions = Object.keys(MFC_TIFF.COLOR_PRESETS)
        .map(c => `<option value="${c}" ${c === ch.color ? 'selected' : ''}>${c}</option>`).join('');

      row.innerHTML = `
        <div class="row-top">
          <input type="checkbox" class="ch-toggle" ${ch.enabled ? 'checked' : ''}>
          <span class="ch-name">${ch.name}</span>
          <span class="swatch" style="background:${swatchColor(ch.color)}"></span>
          <select class="ch-color">${colorOptions}</select>
        </div>
        <div class="range-row">
          <span class="hint">min</span>
          <input type="range" class="ch-min" min="0" max="65535" value="${ch.min}">
          <input type="number" class="rv-input ch-min-val" min="0" max="65535" value="${Math.round(ch.min)}">
        </div>
        <div class="range-row">
          <span class="hint">max</span>
          <input type="range" class="ch-max" min="0" max="65535" value="${ch.max}">
          <input type="number" class="rv-input ch-max-val" min="0" max="65535" value="${Math.round(ch.max)}">
        </div>
      `;
      listEl.appendChild(row);

      const rangeCeil = ch.bitDepth > 8 ? 65535 : 255;
      const minSlider = row.querySelector('.ch-min'), maxSlider = row.querySelector('.ch-max');
      const minInput = row.querySelector('.ch-min-val'), maxInput = row.querySelector('.ch-max-val');
      [minSlider, maxSlider, minInput, maxInput].forEach(el => el.max = rangeCeil);

      row.querySelector('.ch-toggle').addEventListener('change', (e) => {
        ch.enabled = e.target.checked;
        recomposite(active); canvas.fire('object:modified', { target: active });
      });
      row.querySelector('.ch-color').addEventListener('change', (e) => {
        ch.color = e.target.value;
        row.querySelector('.swatch').style.background = swatchColor(ch.color);
        recomposite(active); canvas.fire('object:modified', { target: active });
      });

      // Slider <-> number input stay in sync in both directions; both funnel through
      // commitMin/commitMax so range validation (min < max, clamped to [0, rangeCeil])
      // always applies no matter which control the user touched.
      function commitMin(v) {
        if (!isFinite(v)) v = ch.min; // invalid input handled gracefully: keep previous value
        const clamped = Math.min(Math.max(v, 0), ch.max - 1);
        ch.min = clamped;
        minSlider.value = clamped;
        minInput.value = Math.round(clamped);
      }
      function commitMax(v) {
        if (!isFinite(v)) v = ch.max;
        const clamped = Math.max(Math.min(v, rangeCeil), ch.min + 1);
        ch.max = clamped;
        maxSlider.value = clamped;
        maxInput.value = Math.round(clamped);
      }

      minSlider.addEventListener('input', (e) => { commitMin(parseFloat(e.target.value)); recomposite(active); });
      maxSlider.addEventListener('input', (e) => { commitMax(parseFloat(e.target.value)); recomposite(active); });
      minSlider.addEventListener('change', () => canvas.fire('object:modified', { target: active }));
      maxSlider.addEventListener('change', () => canvas.fire('object:modified', { target: active }));

      // "change" fires on blur, and also right after Enter's explicit blur() below — this
      // is how typed values get confirmed (Enter, Tab, or clicking elsewhere all commit).
      minInput.addEventListener('change', (e) => {
        commitMin(parseFloat(e.target.value)); recomposite(active); canvas.fire('object:modified', { target: active });
      });
      maxInput.addEventListener('change', (e) => {
        commitMax(parseFloat(e.target.value)); recomposite(active); canvas.fire('object:modified', { target: active });
      });
      minInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); minInput.blur(); } });
      maxInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); maxInput.blur(); } });
    });
  }

  /** Manually set (or clear) an image's physical pixel size — the only way to calibrate scale bars for formats (JPEG/PNG/BMP) or TIFFs that carry no resolution metadata. */
  function applyPixelSize(value) {
    const active = canvas.getActiveObject();
    if (!active || active.mfcType !== 'mfcImage') return;
    const entry = registry[active.mfcId];
    const v = parseFloat(value);
    entry.rawImage.voxelSizeUm = (isFinite(v) && v > 0) ? v : null;
    refreshChannelPanel();
  }

  function applyAlphaToggle(enabled) {
    const active = canvas.getActiveObject();
    if (!active || active.mfcType !== 'mfcImage') return;
    const entry = registry[active.mfcId];
    if (!entry.rawImage.hasAlpha) return;
    entry.rawImage.alphaEnabled = !!enabled;
    recomposite(active);
    canvas.fire('object:modified', { target: active });
  }

  /** Applies the panel's current brightness/contrast values to the selected image's whole composite (see compositeChannels' tone-curve pass — works the same for RGB imports and TIFF composites alike). */
  function applyBrightnessContrast(brightness, contrast) {
    const active = canvas.getActiveObject();
    if (!active || active.mfcType !== 'mfcImage') return;
    const entry = registry[active.mfcId];
    const clamp = v => Math.max(-100, Math.min(100, v));
    entry.rawImage.brightness = isFinite(brightness) ? clamp(brightness) : 0;
    entry.rawImage.contrast = isFinite(contrast) ? clamp(contrast) : 0;
    document.getElementById('ch-brightness').value = entry.rawImage.brightness;
    document.getElementById('ch-brightness-val').value = entry.rawImage.brightness;
    document.getElementById('ch-contrast').value = entry.rawImage.contrast;
    document.getElementById('ch-contrast-val').value = entry.rawImage.contrast;
    recomposite(active);
  }

  function commitBrightnessContrast() {
    canvas.fire('object:modified', { target: canvas.getActiveObject() });
  }

  function resetToneCurve() {
    applyBrightnessContrast(0, 0);
    commitBrightnessContrast();
  }

  function swatchColor(name) {
    const [r, g, b] = MFC_TIFF.COLOR_PRESETS[name];
    return `rgb(${r * 255},${g * 255},${b * 255})`;
  }

  function onSelectionChanged() {
    refreshChannelPanel();
    refreshObjectSizePanel();
    refreshTextPanel();
    refreshScaleBarRefList();
    refreshShapePanel();
    refreshInsetPanel();
    refreshLayersPanel();
    const objs = canvas.getActiveObjects ? canvas.getActiveObjects() : [];
    document.getElementById('align-bar').classList.toggle('hidden', objs.length < 2);
  }

  // ---- object size panel (shows on-screen displayed size of the selected object,
  // editable so multiple images can be matched to the same size) ----
  function refreshObjectSizePanel() {
    const panel = document.getElementById('panel-object');
    const active = canvas.getActiveObject();
    if (!active || active.type === 'activeSelection' || currentTool === 'crop') {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    document.getElementById('obj-width').value = Math.round(active.getScaledWidth());
    document.getElementById('obj-height').value = Math.round(active.getScaledHeight());
    document.getElementById('obj-angle').value = Math.round(active.angle || 0);

    const uncropBtn = document.getElementById('obj-uncrop');
    if (uncropBtn) uncropBtn.classList.toggle('hidden', !isCropped(active));
  }

  /** Whether an image currently has an active (non-full-frame) crop applied. */
  function isCropped(img) {
    if (!img || img.mfcType !== 'mfcImage') return false;
    const entry = registry[img.mfcId];
    if (!entry) return false;
    const fullW = Math.max(1, Math.round(entry.rawImage.width * entry.workingScale));
    const fullH = Math.max(1, Math.round(entry.rawImage.height * entry.workingScale));
    return (img.cropX || 0) > 0.01 || (img.cropY || 0) > 0.01 ||
           Math.abs((img.width || 0) - fullW) > 0.5 || Math.abs((img.height || 0) - fullH) > 0.5;
  }

  /**
   * Restores an image to its full, uncropped frame. Registry entries are never purged
   * when an image is cropped, so the original full-resolution data is always still
   * there — "uncrop" is just resetting the crop window back to the whole thing. Keeps
   * the currently-visible crop content anchored at the same screen position (rather
   * than jumping) by shifting left/top back by the crop offset as the frame expands.
   */
  function uncropImage(img) {
    if (!isCropped(img)) return;
    const entry = registry[img.mfcId];
    const fullW = Math.max(1, Math.round(entry.rawImage.width * entry.workingScale));
    const fullH = Math.max(1, Math.round(entry.rawImage.height * entry.workingScale));
    const cx = img.cropX || 0, cy = img.cropY || 0;
    img.set({
      left: img.left - cx * img.scaleX,
      top: img.top - cy * img.scaleY,
      cropX: 0, cropY: 0,
      width: fullW, height: fullH
    });
    img.setCoords();
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: img });
    updateScaleBarsForImage(img);
    followSourceImage(img);
    refreshObjectSizePanel();
  }

  /** Rotate the selected object by a relative amount (e.g. ±90°), wrapped to 0-359. */
  function rotateSelected(deltaDeg) {
    const active = canvas.getActiveObject();
    if (!active) return;
    let a = ((active.angle || 0) + deltaDeg) % 360;
    if (a < 0) a += 360;
    active.set('angle', a);
    active.setCoords();
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
    refreshObjectSizePanel();
    if (active.mfcType === 'mfcImage') repositionAttachedScaleBars(active);
  }

  function setObjectAngle(deg) {
    const active = canvas.getActiveObject();
    if (!active) return;
    active.set('angle', ((deg % 360) + 360) % 360);
    active.setCoords();
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
    if (active.mfcType === 'mfcImage') repositionAttachedScaleBars(active);
  }

  function applyObjectSizeFromFields() {
    const active = canvas.getActiveObject();
    if (!active || active.type === 'activeSelection') return;
    const w = parseFloat(document.getElementById('obj-width').value);
    const h = parseFloat(document.getElementById('obj-height').value);
    const lockAspect = document.getElementById('obj-lock-aspect').checked;
    if (!w || !h) return;

    if (lockAspect) {
      const ratio = active.getScaledWidth() / active.getScaledHeight();
      const target = document.activeElement && document.activeElement.id === 'obj-height' ? h * ratio : w;
      const targetH = document.activeElement && document.activeElement.id === 'obj-height' ? h : w / ratio;
      active.set({ scaleX: target / active.width, scaleY: targetH / active.height });
      document.getElementById('obj-width').value = Math.round(active.getScaledWidth());
      document.getElementById('obj-height').value = Math.round(active.getScaledHeight());
    } else {
      active.set({ scaleX: w / active.width, scaleY: h / active.height });
    }
    active.setCoords();
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
    if (active.mfcType === "mfcImage") { updateScaleBarsForImage(active); followSourceImage(active); }
  }

  // ---- text panel (re-populates whenever a text box is selected/reselected) ----
  function refreshTextPanel() {
    const panel = document.getElementById('panel-text');
    const boxes = getSelectedTextboxes();
    panel.classList.toggle('hidden', !(boxes.length || currentTool === 'text'));
    if (!boxes.length) return;
    const active = boxes[0]; // representative values shown when multiple are selected — edits still apply to every selected box, see applyTextStyle/applyTextBorder/applyTextAlign

    document.getElementById('text-font').value = active.fontFamily || 'Arial';
    document.getElementById('text-size').value = Math.round(active.fontSize || 24);
    document.getElementById('text-color').value = /^#/.test(active.fill) ? active.fill : '#ffffff';
    const hasBg = active.backgroundColor && /^#/.test(active.backgroundColor);
    document.getElementById('text-bg-enabled').checked = !!hasBg;
    document.getElementById('text-bg-color').value = hasBg ? active.backgroundColor : '#000000';
    document.getElementById('text-border-enabled').checked = !!(active.mfcBorderWidth > 0);
    document.getElementById('text-border-width').value = active.mfcBorderWidth || 2;
    document.getElementById('text-border-color').value = active.mfcBorderColor || '#000000';
    document.getElementById('text-bold').classList.toggle('active', active.fontWeight === 'bold');
    document.getElementById('text-italic').classList.toggle('active', active.fontStyle === 'italic');
    document.getElementById('text-underline').classList.toggle('active', !!active.underline);
    ['left', 'center', 'right'].forEach(a =>
      document.getElementById('text-align-' + a).classList.toggle('active', (active.textAlign || 'left') === a));

    // Box width/height are inherently per-object — showing/editing them only makes sense
    // for a single selected text box, unlike the shared style properties above.
    const sizeFieldsHidden = boxes.length > 1;
    document.getElementById('text-width').closest('label').classList.toggle('hidden', sizeFieldsHidden);
    document.getElementById('text-height').closest('label').classList.toggle('hidden', sizeFieldsHidden);
    if (!sizeFieldsHidden) {
      document.getElementById('text-width').value = Math.round(active.getScaledWidth());
      document.getElementById('text-height').value = Math.round(active.getScaledHeight());
    }
  }

  function applyTextBoxSize(prop, value) {
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'textbox') return;
    if (prop === 'width') {
      // side-handle equivalent: reflow text into the new width at scale 1
      active.set({ width: Math.max(20, value / (active.scaleX || 1)) });
    } else if (prop === 'height') {
      // vertical stretch, matching the top/bottom drag-handle behavior
      active.set({ scaleY: Math.max(0.05, value / active.height) });
    }
    active.setCoords();
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
  }

  // ---- crop tool ----
  let cropRect = null, cropTargetImg = null, cropAspectMode = 'rect'; // 'rect' | 'square'
  let shapeAspectMode = 'rect'; // 'rect' | 'square' — used by the shape tool

  function startCrop() {
    const active = canvas.getActiveObject();
    if (!active || active.mfcType !== 'mfcImage') {
      MFC_UI.toast('Select an image first to crop it.');
      return;
    }
    cropTargetImg = active;
    document.getElementById('panel-crop').classList.remove('hidden');

    cropRect = new fabric.Rect({
      left: active.left, top: active.top,
      width: active.getScaledWidth(), height: active.getScaledHeight(),
      scaleX: 1, scaleY: 1,
      fill: 'rgba(91,140,255,0.15)', stroke: '#5b8cff', strokeDashArray: [6, 4],
      cornerColor: '#5b8cff', transparentCorners: false, cornerStyle: 'circle'
    });
    canvas.add(cropRect);
    canvas.setActiveObject(cropRect);
    canvas.requestRenderAll();
    syncCropFieldsFromRect();
  }

  /** Pull the crop rectangle's current on-screen size into the numeric fields (called live while dragging handles). */
  function syncCropFieldsFromRect() {
    if (!cropRect) return;
    document.getElementById('crop-width').value = Math.round(cropRect.getScaledWidth());
    document.getElementById('crop-height').value = Math.round(cropRect.getScaledHeight());
  }

  /** Push numeric field values back onto the crop rectangle (called when the user types a size). */
  function applyCropFieldsToRect() {
    if (!cropRect) return;
    let w = parseFloat(document.getElementById('crop-width').value);
    let h = parseFloat(document.getElementById('crop-height').value);
    if (!w || !h) return;
    if (cropAspectMode === 'square') {
      // whichever field the user is actively editing wins
      if (document.activeElement && document.activeElement.id === 'crop-height') w = h;
      else h = w;
      document.getElementById('crop-width').value = Math.round(w);
      document.getElementById('crop-height').value = Math.round(h);
    }
    cropRect.set({ scaleX: w / cropRect.width, scaleY: h / cropRect.height });
    cropRect.setCoords();
    canvas.requestRenderAll();
  }

  function setCropAspectMode(mode) {
    cropAspectMode = mode;
    document.getElementById('crop-mode-rect').classList.toggle('active', mode === 'rect');
    document.getElementById('crop-mode-square').classList.toggle('active', mode === 'square');
    if (mode === 'square' && cropRect) {
      const s = Math.max(cropRect.getScaledWidth(), cropRect.getScaledHeight());
      cropRect.set({ scaleX: s / cropRect.width, scaleY: s / cropRect.height });
      cropRect.setCoords();
      canvas.requestRenderAll();
      syncCropFieldsFromRect();
    }
  }

  /** Crop always applies exactly what's currently shown by the crop rectangle's handles/fields. */
  function applyCrop() {
    if (!cropRect || !cropTargetImg) return;
    const w = cropRect.getScaledWidth();
    const h = cropRect.getScaledHeight();
    const img = cropTargetImg;

    // translate crop rect position into the image's local (unscaled) coordinate space
    const localLeft = (cropRect.left - img.left) / img.scaleX;
    const localTop = (cropRect.top - img.top) / img.scaleY;

    img.set({
      cropX: Math.max(0, localLeft),
      cropY: Math.max(0, localTop),
      width: Math.min(img.width - Math.max(0, localLeft), w / img.scaleX),
      height: Math.min(img.height - Math.max(0, localTop), h / img.scaleY),
      left: cropRect.left, top: cropRect.top
    });
    img.setCoords();
    canvas.remove(cropRect);
    cropRect = null; cropTargetImg = null;
    document.getElementById('panel-crop').classList.add('hidden');
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: img });
  }

  function cancelCrop() {
    if (cropRect) canvas.remove(cropRect);
    cropRect = null; cropTargetImg = null;
    document.getElementById('panel-crop').classList.add('hidden');
    canvas.requestRenderAll();
  }

  // ---- text tool ----
  let lastTextSelection = null; // {id, start, end} — captured while editing so the side
                                 // panel can still restyle a highlighted range after the
                                 // panel control (e.g. color swatch) steals focus.

  function attachTextListeners(t) {
    t.on('selection:changed', () => {
      if (t.isEditing) lastTextSelection = { id: t.mfcId, start: t.selectionStart, end: t.selectionEnd };
    });
    t.on('editing:exited', () => { refreshTextPanel(); });
    t.on('editing:entered', () => { refreshTextPanel(); });
    installTextBorderRenderer(t);
  }

  // Matches installTextBorderRenderer's canvas _render override (below), but for the
  // canvas.toSVG() export path, which never calls _render at all — it uses Fabric's own
  // _toSVG() text-markup builder instead. Without this, the box border only showed up in
  // the app itself and in PDF export (which rasterizes the canvas, so it "sees" _render's
  // strokeRect), while SVG export silently dropped it. Patched once, globally, on the
  // Text prototype (mfcBorderWidth defaults to 0/undefined on plain text boxes, so this
  // is a no-op for any textbox that never had a border applied).
  fabric.util.object.extend(fabric.Text.prototype, {
    _toSVG: function () {
      const offsets = this._getSVGLeftTopOffsets();
      const textAndBg = this._getSVGTextAndBg(offsets.textTop, offsets.textLeft);
      const svg = this._wrapSVGTextAndBg(textAndBg);
      if (this.mfcBorderWidth > 0) {
        const toFixed = fabric.util.toFixed, digits = fabric.Object.NUM_FRACTION_DIGITS;
        svg.push(
          '\t\t<rect x="', toFixed(-this.width / 2, digits), '" y="', toFixed(-this.height / 2, digits),
          '" width="', toFixed(this.width, digits), '" height="', toFixed(this.height, digits),
          '" fill="none" stroke="', (this.mfcBorderColor || '#000000'),
          '" stroke-width="', this.mfcBorderWidth, '" />\n'
        );
      }
      return svg;
    }
  });

  /**
   * Fabric's native stroke/strokeWidth on a Textbox outlines each glyph, not the box —
   * so a true "box border" (line width + color around the whole text box) needs a small
   * custom renderer layered on top of the normal text render.
   */
  function installTextBorderRenderer(t) {
    if (t.__mfcBorderInstalled) return;
    t.__mfcBorderInstalled = true;
    if (t.mfcBorderWidth === undefined) t.mfcBorderWidth = 0;
    if (t.mfcBorderColor === undefined) t.mfcBorderColor = '#000000';
    // Fabric only re-renders an object's cached bitmap when it recognizes the changed
    // property as "cache-affecting." Our custom mfcBorderWidth/mfcBorderColor aren't in
    // that list, so edits to them (and sometimes backgroundColor) could silently redraw
    // a stale cached bitmap. Disabling caching for text boxes sidesteps the whole bug
    // class — cheap for the handful of small text objects a figure typically has.
    t.objectCaching = false;
    const originalRender = t._render.bind(t);
    t._render = function (ctx) {
      originalRender(ctx);
      if (this.mfcBorderWidth > 0) {
        ctx.save();
        ctx.strokeStyle = this.mfcBorderColor || '#000000';
        ctx.lineWidth = this.mfcBorderWidth;
        ctx.strokeRect(-this.width / 2, -this.height / 2, this.width, this.height);
        ctx.restore();
      }
    };
  }

  /** Every currently-selected text box — a single directly-selected one, or all text boxes within a multi-selection (non-textbox objects in a mixed selection are simply skipped). */
  function getSelectedTextboxes() {
    const active = canvas.getActiveObject();
    if (!active) return [];
    if (active.type === 'textbox') return [active];
    if (active.type === 'activeSelection') return active.getObjects().filter(o => o.type === 'textbox');
    return [];
  }

  function applyTextBorder(prop, value) {
    const boxes = getSelectedTextboxes();
    if (!boxes.length) return;
    boxes.forEach(box => {
      if (box.isEditing) box.exitEditing(); // avoid racing Fabric's async editing-exit
      box.set(prop, value);
      box.dirty = true;
      box.setCoords();
    });
    canvas.renderAll(); // synchronous — don't rely solely on the scheduled requestRenderAll
    canvas.fire('object:modified', { target: canvas.getActiveObject() });
  }

  function onCanvasMouseDown(opt) {
    if (currentTool === 'text' && !opt.target) {
      const p = canvas.getPointer(opt.e);
      const t = new fabric.Textbox('Text', {
        left: p.x, top: p.y, width: 200,
        fontFamily: document.getElementById('text-font').value,
        fontSize: parseInt(document.getElementById('text-size').value, 10),
        fill: document.getElementById('text-color').value,
        textAlign: 'left'
      });
      t.mfcId = 'txt' + (nextId++);
      t.mfcType = 'text';
      attachTextListeners(t);
      canvas.add(t);
      canvas.setActiveObject(t);
      t.enterEditing();
      canvas.requestRenderAll();
      pushHistory();
      setTool('select');
    } else if (currentTool === 'shape' && !opt.target) {
      startShapeDrag(canvas.getPointer(opt.e), opt.e);
    } else if (currentTool === 'inset' && opt.target && opt.target.mfcType === 'mfcImage') {
      startInsetDrag(canvas.getPointer(opt.e), opt.target);
    }
  }

  // ---- inset tool (draw an outline on an image, then "Create Inset" duplicates that
  // region as a separate, independently-editable image kept in sync with the outline) ----
  let insetDrag = null; // { rect, startX, startY }
  let insetAspectMode = 'square'; // 'square' | 'rect' — defaults to square so a drawn outline

  function setInsetAspectMode(mode) {
    insetAspectMode = mode;
    document.getElementById('inset-mode-square').classList.toggle('active', mode === 'square');
    document.getElementById('inset-mode-rect').classList.toggle('active', mode === 'rect');
  }

  function readInsetContourFormValues() {
    const dashKey = document.getElementById('inset-dash').value;
    return {
      stroke: document.getElementById('inset-stroke-color').value,
      strokeWidth: parseFloat(document.getElementById('inset-stroke-width').value) || 0,
      strokeDashArray: DASH_PRESETS[dashKey] || null
    };
  }

  function startInsetDrag(pointer, sourceImg) {
    const style = readInsetContourFormValues();
    const rect = new fabric.Rect({
      left: pointer.x, top: pointer.y, width: 1, height: 1,
      fill: 'transparent', stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDashArray: style.strokeDashArray,
      strokeUniform: true,
      cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
    });
    rect.mfcId = 'ins' + (nextId++);
    rect.mfcType = 'insetContour';
    rect.mfcInsetSourceId = sourceImg.mfcId;
    canvas.add(rect);
    insetDrag = { rect, startX: pointer.x, startY: pointer.y };
  }

  /** Live-apply the panel's current stroke settings to the selected inset contour. */
  function applyInsetContourStyle() {
    const active = canvas.getActiveObject();
    if (!active || active.mfcType !== 'insetContour') return;
    active.set(readInsetContourFormValues());
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
  }

  function refreshInsetPanel() {
    const active = canvas.getActiveObject();
    const isContour = active && active.mfcType === 'insetContour';
    const panel = document.getElementById('panel-inset');
    if (!panel) return;
    panel.classList.toggle('hidden', !(isContour || currentTool === 'inset'));
    const btn = document.getElementById('inset-create');
    if (btn) {
      btn.classList.toggle('hidden', !isContour);
      if (isContour) btn.textContent = active.mfcInsetTargetId ? 'Update linked inset now' : 'Create inset';
    }
    if (isContour) {
      document.getElementById('inset-stroke-color').value = toHexColor(active.stroke) || '#ffcc00';
      document.getElementById('inset-stroke-width').value = active.strokeWidth || 0;
      const dash = active.strokeDashArray;
      let dashKey = 'solid';
      for (const [k, v] of Object.entries(DASH_PRESETS)) {
        if (v && dash && v.length === dash.length && v.every((n, i) => n === dash[i])) { dashKey = k; break; }
      }
      document.getElementById('inset-dash').value = dashKey;
    }
  }

  /**
   * Duplicates the region marked by an inset contour rectangle as a new, independent
   * image (own registry entry — own channels, so it's separately editable per the
   * channel panel like any other image), linked back to the contour so future moves/
   * resizes of the *contour* keep the duplicate's crop window in sync (see
   * syncInsetFromContour). The duplicate's own on-screen size/position are never
   * touched by that sync — only which pixels it's showing.
   */
  function createInsetFromContour(contourRect) {
    if (!contourRect || contourRect.mfcType !== 'insetContour') return;
    const srcImg = canvas.getObjects().find(o => o.mfcId === contourRect.mfcInsetSourceId);
    const entry = srcImg && registry[srcImg.mfcId];
    if (!srcImg || !entry) {
      MFC_UI.toast('Could not find the source image for this outline.');
      return;
    }

    const srcBox = srcImg.getBoundingRect(true);
    const cBox = contourRect.getBoundingRect(true);
    // Clamp the outline to the source image's current bounds, in case it was dragged
    // partly outside the image.
    const clLeft = Math.max(cBox.left, srcBox.left), clTop = Math.max(cBox.top, srcBox.top);
    const clRight = Math.min(cBox.left + cBox.width, srcBox.left + srcBox.width);
    const clBottom = Math.min(cBox.top + cBox.height, srcBox.top + srcBox.height);
    const w = Math.max(1, clRight - clLeft), h = Math.max(1, clBottom - clTop);

    const cropX = srcImg.cropX + (clLeft - srcBox.left) / srcImg.scaleX;
    const cropY = srcImg.cropY + (clTop - srcBox.top) / srcImg.scaleY;
    const cropW = w / srcImg.scaleX, cropH = h / srcImg.scaleY;

    let insetImg = contourRect.mfcInsetTargetId
      ? canvas.getObjects().find(o => o.mfcId === contourRect.mfcInsetTargetId) : null;

    if (insetImg) {
      // Already linked — "Create inset" becomes "update now" (same effect as a
      // move/resize sync, just triggered manually).
      insetImg.set({ cropX, cropY, width: cropW, height: cropH });
      insetImg.setCoords();
      canvas.requestRenderAll();
      pushHistory();
      MFC_UI.toast('Inset updated.');
      return;
    }

    // Independent registry entry: its own channel settings (on/off, color, contrast) so
    // the inset is separately editable from here on — same duplication pattern used by
    // copy/paste. Raw pixel arrays are read-only and safe to share by reference.
    const clonedRaw = { ...entry.rawImage, channels: entry.rawImage.channels.map(c => ({ ...c })) };
    const insetId = 'img' + (nextId++);
    registry[insetId] = { rawImage: clonedRaw, fileBase64: entry.fileBase64, workingScale: entry.workingScale };
    const compositeCanvas = MFC_TIFF.compositeChannels(clonedRaw, entry.workingScale);

    insetImg = new fabric.Image(compositeCanvas, {
      left: srcBox.left + srcBox.width + 30, top: srcBox.top,
      cropX, cropY, width: cropW, height: cropH,
      scaleX: w / cropW, scaleY: h / cropH, // starts at the same on-screen size as the outline; freely resizable afterward
      cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
    });
    insetImg.mfcId = insetId;
    insetImg.mfcType = 'mfcImage';
    insetImg.mfcRawWidth = clonedRaw.width;
    insetImg.mfcRawHeight = clonedRaw.height;
    insetImg.mfcFileName = (clonedRaw.fileName || 'image') + ' (inset)';
    insetImg.mfcIsInset = true;
    insetImg.mfcInsetContourId = contourRect.mfcId;
    insetImg.mfcInsetSourceId = srcImg.mfcId;
    contourRect.mfcInsetTargetId = insetImg.mfcId;

    canvas.add(insetImg);
    canvas.setActiveObject(insetImg);
    canvas.requestRenderAll();
    pushHistory();
    refreshChannelPanel();
    refreshScaleBarRefList();
    MFC_UI.toast('Inset created — move/resize it freely; adjust the yellow outline on the original to change what it shows.');
  }

  /** Keeps a linked inset's crop *window* matching its contour rectangle's current position/size on the source image. Never touches the inset's own on-screen size/position — only which pixels it displays. */
  /** Keeps a linked inset's crop *window* matching its contour rectangle's current position/size on the source image. Never touches the inset's own on-screen size/position — only which pixels it displays. Also records the outline's position as fractions of the source image's bounds, so followSourceImage() can keep the outline anchored to the same region if the *source* is later moved or resized. */
  function syncInsetFromContour(contourRect) {
    const srcImg = canvas.getObjects().find(o => o.mfcId === contourRect.mfcInsetSourceId);
    if (!srcImg) return;

    const srcBox = srcImg.getBoundingRect(true);
    const cBox = contourRect.getBoundingRect(true);
    const clLeft = Math.max(cBox.left, srcBox.left), clTop = Math.max(cBox.top, srcBox.top);
    const clRight = Math.min(cBox.left + cBox.width, srcBox.left + srcBox.width);
    const clBottom = Math.min(cBox.top + cBox.height, srcBox.top + srcBox.height);
    const w = Math.max(1, clRight - clLeft), h = Math.max(1, clBottom - clTop);

    contourRect.mfcRelX = (clLeft - srcBox.left) / srcBox.width;
    contourRect.mfcRelY = (clTop - srcBox.top) / srcBox.height;
    contourRect.mfcRelW = w / srcBox.width;
    contourRect.mfcRelH = h / srcBox.height;

    if (!contourRect.mfcInsetTargetId) return; // outline drawn but no inset created yet
    const insetImg = canvas.getObjects().find(o => o.mfcId === contourRect.mfcInsetTargetId);
    if (!insetImg) return;

    insetImg.set({
      cropX: srcImg.cropX + (clLeft - srcBox.left) / srcImg.scaleX,
      cropY: srcImg.cropY + (clTop - srcBox.top) / srcImg.scaleY,
      width: w / srcImg.scaleX,
      height: h / srcImg.scaleY
    });
    insetImg.setCoords();
    canvas.requestRenderAll();
  }

  /** Keeps any inset outline(s) drawn on srcImg anchored to the same region of it when srcImg itself is moved or resized (the reverse direction of syncInsetFromContour, which handles the outline moving). Rotating the source is not tracked — only move/resize. */
  function followSourceImage(srcImg) {
    if (!srcImg || srcImg.mfcType !== 'mfcImage') return;
    const contours = canvas.getObjects().filter(o =>
      o.mfcType === 'insetContour' && o.mfcInsetSourceId === srcImg.mfcId && o.mfcRelX != null);
    if (!contours.length) return;
    const srcBox = srcImg.getBoundingRect(true);
    contours.forEach(contour => {
      const newW = contour.mfcRelW * srcBox.width;
      const newH = contour.mfcRelH * srcBox.height;
      contour.set({
        left: srcBox.left + contour.mfcRelX * srcBox.width,
        top: srcBox.top + contour.mfcRelY * srcBox.height,
        scaleX: newW / contour.width,
        scaleY: newH / contour.height
      });
      contour.setCoords();
      syncInsetFromContour(contour); // keep the linked inset's crop window in sync too
    });
    canvas.requestRenderAll();
  }

  // ---- shape tool (rectangle/square, drag-to-draw) ----
  let shapeDrag = null; // { rect, startX, startY }

  function readShapeFormValues() {
    const dashKey = document.getElementById('shape-dash').value;
    const fillEnabled = document.getElementById('shape-fill-enabled').checked;
    return {
      stroke: document.getElementById('shape-stroke-color').value,
      strokeWidth: parseFloat(document.getElementById('shape-stroke-width').value) || 0,
      strokeDashArray: DASH_PRESETS[dashKey] || null,
      fill: fillEnabled ? document.getElementById('shape-fill-color').value : 'transparent'
    };
  }

  function startShapeDrag(pointer, evt) {
    const style = readShapeFormValues();
    const rect = new fabric.Rect({
      left: pointer.x, top: pointer.y, width: 1, height: 1,
      stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDashArray: style.strokeDashArray,
      fill: style.fill, strokeUniform: true,
      cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
    });
    rect.mfcId = 'shp' + (nextId++);
    rect.mfcType = 'shape';
    canvas.add(rect);
    shapeDrag = { rect, startX: pointer.x, startY: pointer.y };
  }

  function onCanvasMouseMove(opt) {
    if (insetDrag) {
      const p = canvas.getPointer(opt.e);
      let w = p.x - insetDrag.startX, h = p.y - insetDrag.startY;
      const square = insetAspectMode === 'square' ? !opt.e.shiftKey : opt.e.shiftKey;
      if (square) {
        const s = Math.max(Math.abs(w), Math.abs(h));
        w = (w < 0 ? -1 : 1) * s;
        h = (h < 0 ? -1 : 1) * s;
      }
      insetDrag.rect.set({
        left: w < 0 ? insetDrag.startX + w : insetDrag.startX,
        top: h < 0 ? insetDrag.startY + h : insetDrag.startY,
        width: Math.abs(w), height: Math.abs(h)
      });
      insetDrag.rect.setCoords();
      canvas.requestRenderAll();
      return;
    }
    if (!shapeDrag) return;
    const p = canvas.getPointer(opt.e);
    let w = p.x - shapeDrag.startX;
    let h = p.y - shapeDrag.startY;
    const square = shapeAspectMode === 'square' || opt.e.shiftKey;
    if (square) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = (w < 0 ? -1 : 1) * s;
      h = (h < 0 ? -1 : 1) * s;
    }
    shapeDrag.rect.set({
      left: w < 0 ? shapeDrag.startX + w : shapeDrag.startX,
      top: h < 0 ? shapeDrag.startY + h : shapeDrag.startY,
      width: Math.abs(w), height: Math.abs(h)
    });
    shapeDrag.rect.setCoords();
    canvas.requestRenderAll();
  }

  function onCanvasMouseUp() {
    if (insetDrag) {
      const rect = insetDrag.rect;
      insetDrag = null;
      if (rect.width < 8 || rect.height < 8) {
        // too small a drag to be intentional — discard rather than leave a stray sliver
        canvas.remove(rect);
        canvas.requestRenderAll();
        return;
      }
      canvas.setActiveObject(rect);
      syncInsetFromContour(rect); // establishes mfcRelX/Y/W/H immediately, so followSourceImage works even before "Create inset" is pressed
      canvas.requestRenderAll();
      pushHistory();
      refreshInsetPanel();
      setTool('select');
      return;
    }
    if (!shapeDrag) return;
    const rect = shapeDrag.rect;
    // treat a near-zero drag (a simple click) as "place a default-sized shape here"
    if (rect.width < 5 && rect.height < 5) {
      rect.set({ width: 150, height: shapeAspectMode === 'square' ? 150 : 100 });
      rect.setCoords();
      canvas.requestRenderAll();
    }
    shapeDrag = null;
    canvas.setActiveObject(rect);
    canvas.requestRenderAll();
    pushHistory();
    refreshShapePanel();
    setTool('select');
  }

  function setShapeAspectMode(mode) {
    shapeAspectMode = mode;
    document.getElementById('shape-mode-rect').classList.toggle('active', mode === 'rect');
    document.getElementById('shape-mode-square').classList.toggle('active', mode === 'square');
  }

  /** Live-apply the panel's current stroke/fill/dash settings to the selected shape. */
  function applyShapeStyle() {
    const active = canvas.getActiveObject();
    if (!active || active.mfcType !== 'shape') return;
    const style = readShapeFormValues();
    active.set(style);
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
  }

  function refreshShapePanel() {
    const active = canvas.getActiveObject();
    const isShape = active && active.mfcType === 'shape';
    document.getElementById('panel-shape').classList.toggle('hidden', !(isShape || currentTool === 'shape'));
    if (!isShape) return;
    document.getElementById('shape-stroke-color').value = toHexColor(active.stroke) || '#ffffff';
    document.getElementById('shape-stroke-width').value = active.strokeWidth || 0;
    const hasFill = active.fill && active.fill !== 'transparent';
    document.getElementById('shape-fill-enabled').checked = !!hasFill;
    document.getElementById('shape-fill-color').value = hasFill ? toHexColor(active.fill) : '#ffffff';
    const dash = active.strokeDashArray;
    let dashKey = 'solid';
    for (const [k, v] of Object.entries(DASH_PRESETS)) {
      if (v && dash && v.length === dash.length && v.every((n, i) => n === dash[i])) { dashKey = k; break; }
    }
    document.getElementById('shape-dash').value = dashKey;
  }

  function toHexColor(c) {
    if (!c) return null;
    if (/^#/.test(c)) return c;
    const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return null;
    return '#' + [1, 2, 3].map(i => parseInt(m[i], 10).toString(16).padStart(2, '0')).join('');
  }

  /** Apply a style prop either to a highlighted text range (per-word/char formatting) or the whole box. */
  /** Applies a single style prop to one text box — respects a highlighted per-character range if allowRangeSelection is true (only meaningful when exactly one box is targeted directly; a range can't span multiple separate text box objects). */
  function applyTextStyleToBox(box, prop, value, allowRangeSelection) {
    // backgroundColor is a whole-textbox property in Fabric — there is no such thing as a
    // per-character "backgroundColor" (that's the separate `textBackgroundColor` style).
    // Routing it through the selection-range branch below was a silent no-op whenever a
    // leftover highlighted range existed (e.g. right after coloring some words), which is
    // why the "Box background" toggle sometimes stopped updating. Always apply it whole-box.
    if (prop === 'backgroundColor') {
      if (box.isEditing) box.exitEditing();
      box.set('backgroundColor', value);
      box.dirty = true;
      box.setCoords();
      return;
    }

    let sel = null;
    if (allowRangeSelection) {
      const savedSel = (lastTextSelection && lastTextSelection.id === box.mfcId) ? lastTextSelection : null;
      const liveSel = box.isEditing ? { start: box.selectionStart, end: box.selectionEnd } : null;
      sel = (liveSel && liveSel.start !== liveSel.end) ? liveSel
          : (savedSel && savedSel.start !== savedSel.end) ? savedSel
          : null;
    }
    if (box.isEditing) box.exitEditing(); // avoid racing Fabric's async editing-exit (captured sel above first)

    if (sel) {
      box.setSelectionStyles({ [prop]: value }, sel.start, sel.end);
    } else {
      box.set(prop, value);
    }
    box.dirty = true;
    box.setCoords();
  }

  function applyTextStyle(prop, value) {
    const boxes = getSelectedTextboxes();
    if (!boxes.length) return;
    // Highlighted-word-range styling only applies when the selection IS a single text box
    // being edited directly — with several boxes selected as a group there's no shared
    // "highlighted range" across separate objects, so each whole box gets the style.
    const isSingle = boxes.length === 1 && canvas.getActiveObject().type === 'textbox';
    boxes.forEach(box => applyTextStyleToBox(box, prop, value, isSingle));
    canvas.renderAll(); // synchronous — don't rely solely on the scheduled requestRenderAll
    canvas.fire('object:modified', { target: canvas.getActiveObject() });
  }

  function applyTextAlign(align) {
    const boxes = getSelectedTextboxes();
    if (!boxes.length) return;
    boxes.forEach(box => box.set('textAlign', align));
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: canvas.getActiveObject() });
    refreshTextPanel();
  }

  // ---- scale bar ----
  function refreshScaleBarRefList() {
    const sel = document.getElementById('sb-ref-image');
    const activeImg = canvas.getActiveObject();
    const prevValue = sel.value;
    sel.innerHTML = '';
    canvas.getObjects().filter(o => o.mfcType === 'mfcImage').forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.mfcId;
      opt.textContent = o.mfcFileName;
      sel.appendChild(opt);
    });
    // Auto-follow whatever image is currently selected on the canvas; otherwise
    // keep whatever was previously chosen (if it still exists).
    if (activeImg && activeImg.mfcType === 'mfcImage') {
      sel.value = activeImg.mfcId;
    } else if (prevValue && Array.from(sel.options).some(o => o.value === prevValue)) {
      sel.value = prevValue;
    }
  }

  function computeScaleBarPxLength(refObj, entry, lengthUm) {
    // pixel length at native resolution, then convert to on-canvas pixels via the
    // reference image's current display scale (composite-canvas px -> document px)
    const nativePxLen = lengthUm / entry.rawImage.voxelSizeUm;
    const compositeToNativeRatio = 1 / entry.workingScale;
    return (nativePxLen / compositeToNativeRatio) * refObj.scaleX;
  }

  function buildScaleBarGroup(onScreenPxLen, thickness, color, showLabel, lengthUm) {
    const bar = new fabric.Rect({
      left: 0, top: 0, width: onScreenPxLen, height: thickness,
      fill: color, originX: 'left', originY: 'top'
    });
    const items = [bar];
    if (showLabel) {
      items.push(new fabric.Text(lengthUm + ' µm', {
        left: 0, top: -20, fontSize: 16, fill: color, fontFamily: 'Arial', originX: 'left', originY: 'top'
      }));
    }
    const g = new fabric.Group(items, { left: 0, top: 0, originX: 'left', originY: 'top' });
    g.mfcId = 'sb' + (nextId++);
    g.mfcType = 'scalebar';
    return g;
  }

  function readScaleBarFormValues() {
    return {
      lengthUm: parseFloat(document.getElementById('sb-length').value) || 50,
      thickness: parseFloat(document.getElementById('sb-thickness').value) || 6,
      color: document.getElementById('sb-color').value,
      showLabel: document.getElementById('sb-showlabel').checked
    };
  }

  /**
   * Place a scale bar directly at a corner of a reference image, offset by a % margin
   * of that image's displayed size, and "attach" it: whenever the image moves or is
   * resized, the bar is automatically repositioned and rescaled to stay calibrated.
   */
  function placeScaleBarAtCorner(corner, marginPct) {
    const refId = document.getElementById('sb-ref-image').value;
    const entry = registry[refId];
    const refObj = canvas.getObjects().find(o => o.mfcId === refId);
    const { lengthUm, thickness, color, showLabel } = readScaleBarFormValues();

    if (!refObj || !entry || !entry.rawImage.voxelSizeUm) {
      MFC_UI.toast('No voxel size calibration found for that image — cannot compute scale bar length.');
      return;
    }
    const onScreenPxLen = computeScaleBarPxLength(refObj, entry, lengthUm);
    const g = buildScaleBarGroup(onScreenPxLen, thickness, color, showLabel, lengthUm);
    g.mfcAttachedTo = refObj.mfcId;
    g.mfcCorner = corner;
    g.mfcMarginPct = marginPct;
    g.mfcLengthUm = lengthUm;
    canvas.add(g);
    repositionAttachedScaleBars(refObj);
    canvas.setActiveObject(g);
    canvas.requestRenderAll();
    pushHistory();
  }

  /** Add scale bars to every selected image at once, using the current form settings for each. */
  function placeScaleBarOnSelectedImages(corner, marginPct) {
    const imgs = canvas.getActiveObjects().filter(o => o.mfcType === 'mfcImage');
    if (imgs.length < 2) {
      MFC_UI.toast('Select 2 or more images first to batch-apply a scale bar.');
      return;
    }
    const { lengthUm, thickness, color, showLabel } = readScaleBarFormValues();
    const refSelectEl = document.getElementById('sb-ref-image');
    const created = [];
    let skipped = 0;

    imgs.forEach((refObj) => {
      const entry = registry[refObj.mfcId];
      if (!entry || !entry.rawImage.voxelSizeUm) { skipped++; return; }
      const onScreenPxLen = computeScaleBarPxLength(refObj, entry, lengthUm);
      const g = buildScaleBarGroup(onScreenPxLen, thickness, color, showLabel, lengthUm);
      g.mfcAttachedTo = refObj.mfcId;
      g.mfcLengthUm = lengthUm;
      if (corner) { g.mfcCorner = corner; g.mfcMarginPct = marginPct; }
      canvas.add(g);
      if (corner) repositionAttachedScaleBars(refObj);
      created.push(g);
    });

    if (created.length) {
      canvas.setActiveObject(new fabric.ActiveSelection(created, { canvas }));
      canvas.requestRenderAll();
      pushHistory();
      refSelectEl.value = imgs[imgs.length - 1].mfcId;
    }
    if (skipped) {
      MFC_UI.toast(`Added ${created.length} scale bar(s) — skipped ${skipped} image(s) without voxel-size calibration.`);
    } else {
      MFC_UI.toast(`Added scale bars to ${created.length} image(s).`);
    }
  }

  /**
   * Recompute a single scale bar's physical length from scratch against its reference
   * image's *current* scale (rather than nudging it relative to the previous size), so it
   * never drifts. Resizes the bar rect directly (not the group's own scaleX/scaleY), so
   * line thickness and label size stay constant while only the bar's length changes —
   * exactly like a real scale bar should behave as the image is zoomed in figure layout.
   */
  function recalibrateScaleBar(bar) {
    if (!bar.mfcAttachedTo || bar.mfcLengthUm == null) return;
    const entry = registry[bar.mfcAttachedTo];
    const refObj = canvas.getObjects().find(o => o.mfcId === bar.mfcAttachedTo);
    if (!entry || !refObj || !entry.rawImage.voxelSizeUm) return;

    const targetPxLen = computeScaleBarPxLength(refObj, entry, bar.mfcLengthUm);
    const rectChild = bar._objects && bar._objects[0];
    if (!rectChild) return;
    const groupScaleX = bar.scaleX || 1;
    const desiredLocalWidth = targetPxLen / groupScaleX;
    if (Math.abs(rectChild.width - desiredLocalWidth) > 0.01) {
      rectChild.set({ width: desiredLocalWidth });
      bar.addWithUpdate(); // recompute the group's own bounding box from its (now resized) children
      bar.setCoords();
    }
  }

  /** Recalibrate (length) and reposition (if corner-attached) every scale bar linked to imgObj. Call whenever imgObj's scale/size changes. */
  function updateScaleBarsForImage(imgObj) {
    if (!imgObj || imgObj.mfcType !== 'mfcImage') return;
    const bars = canvas.getObjects().filter(o => o.mfcType === 'scalebar' && o.mfcAttachedTo === imgObj.mfcId);
    if (!bars.length) return;
    bars.forEach(recalibrateScaleBar);
    repositionAttachedScaleBars(imgObj);
    canvas.requestRenderAll();
  }

  /** Re-position every CORNER-attached scale bar linked to imgObj (freely-placed bars are only recalibrated in length, never moved — see updateScaleBarsForImage). */
  function repositionAttachedScaleBars(imgObj) {
    if (!imgObj || imgObj.mfcType !== 'mfcImage') return;
    const bars = canvas.getObjects().filter(o => o.mfcType === 'scalebar' && o.mfcAttachedTo === imgObj.mfcId && o.mfcCorner);
    if (!bars.length) return;
    const b = imgObj.getBoundingRect(true);
    bars.forEach(bar => {
      const barW = bar.getScaledWidth(), barH = bar.getScaledHeight();
      const mx = b.width * (bar.mfcMarginPct != null ? bar.mfcMarginPct : 5) / 100;
      const my = b.height * (bar.mfcMarginPct != null ? bar.mfcMarginPct : 5) / 100;
      let left, top;
      switch (bar.mfcCorner) {
        case 'bottom-left': left = b.left + mx; top = b.top + b.height - barH - my; break;
        case 'top-right':   left = b.left + b.width - barW - mx; top = b.top + my; break;
        case 'top-left':    left = b.left + mx; top = b.top + my; break;
        default:             left = b.left + b.width - barW - mx; top = b.top + b.height - barH - my; // bottom-right
      }
      bar.set({ left, top });
      bar.setCoords();
    });
    canvas.requestRenderAll();
  }

  // ---- snapping (drag-to-edges) ----
  const SNAP_THRESHOLD_SCREEN_PX = 8; // in on-screen px, so it feels consistent at any zoom

  /** Collects candidate x/y snap lines (edges + center) from the document bounds and every other object. */
  function getSnapTargets(excludeObj) {
    const docPx = docPropsToPixels(docProps);
    const targets = [{ x: [0, docPx.width / 2, docPx.width], y: [0, docPx.height / 2, docPx.height] }];
    const excludedChildren = excludeObj.type === 'activeSelection' ? excludeObj.getObjects() : [];
    canvas.getObjects().forEach(o => {
      if (o === excludeObj || o === cropRect || o.mfcIsPageBounds || excludedChildren.includes(o)) return;
      const b = o.getBoundingRect(true);
      targets.push({ x: [b.left, b.left + b.width / 2, b.left + b.width], y: [b.top, b.top + b.height / 2, b.top + b.height] });
    });
    return targets;
  }

  /** Nudges obj.left/top (in place) to align with the nearest snap target within threshold, if any. */
  function snapObjectPosition(obj) {
    const b = obj.getBoundingRect(true);
    const threshold = SNAP_THRESHOLD_SCREEN_PX / zoomLevel;
    const targets = getSnapTargets(obj);
    const selfXs = [b.left, b.left + b.width / 2, b.left + b.width];
    const selfYs = [b.top, b.top + b.height / 2, b.top + b.height];

    let bestDx = null, bestDy = null;
    targets.forEach(t => {
      selfXs.forEach(sx => t.x.forEach(tx => {
        const d = tx - sx;
        if (Math.abs(d) <= threshold && (bestDx === null || Math.abs(d) < Math.abs(bestDx))) bestDx = d;
      }));
      selfYs.forEach(sy => t.y.forEach(ty => {
        const d = ty - sy;
        if (Math.abs(d) <= threshold && (bestDy === null || Math.abs(d) < Math.abs(bestDy))) bestDy = d;
      }));
    });

    if (bestDx !== null) obj.left += bestDx;
    if (bestDy !== null) obj.top += bestDy;
    if (bestDx !== null || bestDy !== null) obj.setCoords();
  }

  // ---- keyboard nudge ----
  const NUDGE_SMALL = 1;   // doc px
  const NUDGE_LARGE = 10;  // doc px, with Shift held
  let nudgeHistoryTimer = null;

  /** Moves the current selection by (dx,dy) doc-px — works for images/text/shapes/groups/multi-selection alike, since they all expose the same left/top. Snaps to nearby edges unless snap=false. Debounces the history push so holding an arrow key doesn't spam undo steps. */
  function nudgeSelection(dx, dy, snap) {
    const active = canvas.getActiveObject();
    if (!active || active === cropRect) return;
    active.set({ left: active.left + dx, top: active.top + dy });
    if (snap) snapObjectPosition(active);
    active.setCoords();

    if (active.mfcType === 'mfcImage') repositionAttachedScaleBars(active);
    if (active.type === 'activeSelection') {
      active.getObjects().forEach(o => { if (o.mfcType === 'mfcImage') repositionAttachedScaleBars(o); });
    }
    canvas.requestRenderAll();

    clearTimeout(nudgeHistoryTimer);
    nudgeHistoryTimer = setTimeout(() => pushHistory(), 300);
  }

  // ---- layers panel ----
  function layerLabel(o) {
    if (o.mfcType === 'mfcImage') return (o.mfcFileName || 'Image') + (o.mfcIsInset ? ' (inset)' : '');
    if (o.type === 'textbox') {
      const t = (o.text || '').replace(/\n/g, ' ').trim();
      return 'Text: "' + (t.length > 18 ? t.slice(0, 18) + '…' : t || '(empty)') + '"';
    }
    if (o.mfcType === 'shape') return 'Shape';
    if (o.mfcType === 'scalebar') return 'Scale bar';
    if (o.mfcType === 'insetContour') return 'Inset outline';
    if (o.type === 'group') return 'Group';
    return o.type ? (o.type[0].toUpperCase() + o.type.slice(1)) : 'Object';
  }

  function refreshLayersPanel() {
    const listEl = document.getElementById('layers-list');
    if (!listEl) return;
    const objs = canvas.getObjects().filter(o => !o.mfcIsPageBounds);
    const activeIds = new Set((canvas.getActiveObjects ? canvas.getActiveObjects() : []).map(o => o.mfcId));

    if (!objs.length) {
      listEl.innerHTML = '<p class="hint">No objects on the canvas yet.</p>';
      return;
    }

    // Top of the list = front-most (matches the usual layers-panel convention), so
    // reverse the canvas's back-to-front stacking order for display.
    listEl.innerHTML = '';
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      const row = document.createElement('div');
      row.className = 'layer-row' + (activeIds.has(o.mfcId) ? ' active' : '');
      row.innerHTML = `
        <button class="layer-eye" title="${o.visible === false ? 'Show' : 'Hide'}">${o.visible === false ? '&#128065;&#8203;' : '&#128065;'}</button>
        <button class="layer-lock" title="${o.mfcLocked ? 'Unlock' : 'Lock'}">${o.mfcLocked ? '&#128274;' : '&#128275;'}</button>
        <span class="layer-name" title="${layerLabel(o)}">${layerLabel(o)}</span>
        <button class="layer-up" title="Move forward">&#9650;</button>
        <button class="layer-down" title="Move backward">&#9660;</button>
      `;
      if (o.visible === false) row.classList.add('layer-hidden');
      row.querySelector('.layer-name').addEventListener('click', () => selectLayer(o));
      row.querySelector('.layer-eye').addEventListener('click', (e) => { e.stopPropagation(); toggleLayerVisibility(o); });
      row.querySelector('.layer-lock').addEventListener('click', (e) => { e.stopPropagation(); toggleLayerLock(o); });
      row.querySelector('.layer-up').addEventListener('click', (e) => { e.stopPropagation(); moveLayer(o, 'up'); });
      row.querySelector('.layer-down').addEventListener('click', (e) => { e.stopPropagation(); moveLayer(o, 'down'); });
      listEl.appendChild(row);
    }
  }

  function selectLayer(o) {
    if (o.mfcLocked) { MFC_UI.toast('This layer is locked — unlock it first to select it.'); return; }
    canvas.discardActiveObject();
    canvas.setActiveObject(o);
    canvas.requestRenderAll();
  }

  function toggleLayerVisibility(o) {
    o.visible = o.visible === false ? true : false;
    if (!o.visible && canvas.getActiveObject() === o) canvas.discardActiveObject();
    canvas.requestRenderAll();
    pushHistory();
    refreshLayersPanel();
  }

  function toggleLayerLock(o) {
    o.mfcLocked = !o.mfcLocked;
    o.selectable = !o.mfcLocked;
    o.evented = !o.mfcLocked;
    if (o.mfcLocked && canvas.getActiveObject() === o) canvas.discardActiveObject();
    canvas.requestRenderAll();
    pushHistory();
    refreshLayersPanel();
  }

  /** direction: 'up' (toward front, one step) or 'down' (toward back, one step). */
  function moveLayer(o, direction) {
    if (direction === 'up') canvas.bringForward(o);
    else canvas.sendBackwards(o);
    if (pageRect) canvas.sendToBack(pageRect); // the page background must always stay behind everything
    canvas.requestRenderAll();
    pushHistory();
    refreshLayersPanel();
  }

  /**
   * Bundles the current multi-selection into a real, persistent fabric.Group (Ctrl+G).
   * Note: while grouped, the individual images/text/shapes inside are no longer top-level
   * canvas objects, so their type-specific panels (Channels, Text, Scale Bar reference
   * list, Inset tool) can't reach them — same as every other design tool, ungroup
   * (Ctrl+Shift+G) first to edit an object's own properties.
   */
  function groupSelection() {
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'activeSelection' || active.size() < 2) {
      MFC_UI.toast('Select 2 or more objects to group.');
      return;
    }
    const group = active.toGroup(); // Fabric's own, well-tested ActiveSelection -> Group conversion
    group.mfcId = 'grp' + (nextId++);
    group.mfcType = 'group';
    group.set({ cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff' });
    canvas.requestRenderAll();
    pushHistory();
    refreshLayersPanel();
  }

  /** Inverse of groupSelection (Ctrl+Shift+G) — dissolves the group and re-selects its former children as a normal multi-selection. Each child's own mfcId/mfcType/channel-registry linkage is untouched by this, since Fabric's toActiveSelection() only reparents objects, never rewrites their properties. */
  function ungroupSelection() {
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'group') {
      MFC_UI.toast('Select a group to ungroup.');
      return;
    }
    active.toActiveSelection();
    canvas.requestRenderAll();
    pushHistory();
    refreshLayersPanel();
  }

  // ---- alignment ----
  function align(mode) {
    const objs = canvas.getActiveObjects();
    if (objs.length < 2) return;
    const bounds = objs.map(o => o.getBoundingRect(true));
    const minX = Math.min(...bounds.map(b => b.left));
    const maxX = Math.max(...bounds.map(b => b.left + b.width));
    const minY = Math.min(...bounds.map(b => b.top));
    const maxY = Math.max(...bounds.map(b => b.top + b.height));

    objs.forEach((o, i) => {
      const b = bounds[i];
      switch (mode) {
        case 'left': o.left += (minX - b.left); break;
        case 'right': o.left += (maxX - (b.left + b.width)); break;
        case 'hcenter': o.left += ((minX + maxX) / 2 - (b.left + b.width / 2)); break;
        case 'top': o.top += (minY - b.top); break;
        case 'bottom': o.top += (maxY - (b.top + b.height)); break;
        case 'vcenter': o.top += ((minY + maxY) / 2 - (b.top + b.height / 2)); break;
      }
      o.setCoords();
    });

    if (mode === 'distH' && objs.length > 2) {
      const sorted = objs.map((o, i) => ({ o, b: bounds[i] })).sort((a, b) => a.b.left - b.b.left);
      const totalSpan = (sorted[sorted.length - 1].b.left + sorted[sorted.length - 1].b.width) - sorted[0].b.left;
      const totalW = sorted.reduce((s, x) => s + x.b.width, 0);
      const gap = (totalSpan - totalW) / (sorted.length - 1);
      let cursor = sorted[0].b.left;
      sorted.forEach(({ o, b }) => { o.left += (cursor - b.left); cursor += b.width + gap; o.setCoords(); });
    }
    if (mode === 'distV' && objs.length > 2) {
      const sorted = objs.map((o, i) => ({ o, b: bounds[i] })).sort((a, b) => a.b.top - b.b.top);
      const totalSpan = (sorted[sorted.length - 1].b.top + sorted[sorted.length - 1].b.height) - sorted[0].b.top;
      const totalH = sorted.reduce((s, x) => s + x.b.height, 0);
      const gap = (totalSpan - totalH) / (sorted.length - 1);
      let cursor = sorted[0].b.top;
      sorted.forEach(({ o, b }) => { o.top += (cursor - b.top); cursor += b.height + gap; o.setCoords(); });
    }

    canvas.requestRenderAll();
    pushHistory();
  }

  // ---- copy/paste ----
  let clipboardObj = null;

  /** Snapshot a single (non-selection) object into a clipboard-ready descriptor. Returns a Promise. */
  function copySingle(obj) {
    if (obj.mfcType === 'mfcImage') {
      return Promise.resolve({ kind: 'mfcImage', sourceId: obj.mfcId, props: serializeObjectState(obj) });
    }
    return new Promise((resolve) => {
      obj.clone((cloned) => resolve({ kind: 'fabric', obj: cloned, isTextbox: obj.type === 'textbox' }));
    });
  }

  function copySelection() {
    const active = canvas.getActiveObject();
    if (!active) return;

    if (active.type === 'activeSelection') {
      // Multiple objects selected: snapshot each one individually rather than cloning the
      // ActiveSelection wrapper itself. ActiveSelection is a transient UI grouping fabric
      // creates for multi-select — it isn't meant to live on the canvas as a real object.
      // canvas.add()-ing a clone of one (the old behavior) is what caused pasted groups to
      // turn into un-clickable, undeletable "ghost outline" objects — and since the images
      // inside it never got their own registry entry, they'd also fail to (re)composite,
      // which is why they could end up positioned off the visible area and stay stuck there.
      const items = active.getObjects();
      Promise.all(items.map(copySingle)).then((results) => { clipboardObj = { kind: 'multi', items: results }; });
      return;
    }

    copySingle(active).then((result) => { clipboardObj = result; });
  }

  /** Pastes one clipboard item, offset by (dx,dy). Adds it to the canvas and returns the new object (or null). Does not select it or push history. */
  function pasteSingle(item, dx, dy) {
    if (item.kind === 'mfcImage') {
      const src = registry[item.sourceId];
      if (!src) return null;
      // Independent copy: new registry entry with its own channel settings (on/off,
      // color, contrast), so the two images can be edited separately from here on.
      // The raw pixel arrays are read-only and safe to share by reference.
      const clonedRaw = { ...src.rawImage, channels: src.rawImage.channels.map(c => ({ ...c })) };
      const id = 'img' + (nextId++);
      registry[id] = { rawImage: clonedRaw, fileBase64: src.fileBase64, workingScale: src.workingScale };
      const compositeCanvas = MFC_TIFF.compositeChannels(clonedRaw, src.workingScale);

      const p = item.props;
      const fabricImg = new fabric.Image(compositeCanvas, {
        left: p.left + dx, top: p.top + dy, scaleX: p.scaleX, scaleY: p.scaleY, angle: p.angle,
        cropX: p.cropX || 0, cropY: p.cropY || 0, width: p.width, height: p.height,
        cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
      });
      fabricImg.mfcId = id;
      fabricImg.mfcType = 'mfcImage';
      fabricImg.mfcRawWidth = clonedRaw.width;
      fabricImg.mfcRawHeight = clonedRaw.height;
      fabricImg.mfcFileName = clonedRaw.fileName + ' copy';
      fabricImg.setCoords();
      canvas.add(fabricImg);
      return fabricImg;
    }

    const cloned = item.obj;
    cloned.set({ left: cloned.left + dx, top: cloned.top + dy, evented: true });
    cloned.mfcId = (cloned.mfcType || 'obj') + (nextId++);
    if (item.isTextbox) { cloned.mfcType = 'text'; attachTextListeners(cloned); }
    if (cloned.mfcType === 'insetContour') {
      // A pasted copy of a linked contour must not keep steering the *original*
      // outline's inset — clone()/toObject() would otherwise carry the old
      // mfcInsetTargetId straight over, so moving the new copy would silently also
      // update the original's linked inset image.
      cloned.mfcInsetTargetId = null;
    }
    cloned.setCoords();
    canvas.add(cloned);
    return cloned;
  }

  function pasteSelection() {
    if (!clipboardObj) return;
    const OFFSET = 24;

    if (canvas.getActiveObject() && canvas.getActiveObject().type === 'activeSelection') {
      canvas.discardActiveObject();
    }

    const items = clipboardObj.kind === 'multi' ? clipboardObj.items : [clipboardObj];
    const pasted = items.map(item => pasteSingle(item, OFFSET, OFFSET)).filter(Boolean);
    if (!pasted.length) return;

    if (pasted.length === 1) {
      canvas.setActiveObject(pasted[0]);
    } else {
      // Re-select the pasted objects as a fresh ActiveSelection purely to drive the
      // on-screen multi-select UI — this one is never added to the canvas itself, only
      // used transiently, so it doesn't hit the bug described above.
      canvas.setActiveObject(new fabric.ActiveSelection(pasted, { canvas }));
    }

    canvas.requestRenderAll();
    pushHistory();
    refreshChannelPanel();
    refreshScaleBarRefList();
  }

  // ---- grid layout assistant ----
  /**
   * Arranges images (the current multi-selection if 2+ are selected, otherwise every
   * image on the canvas) into a rows x cols grid, each fit-to-cell preserving aspect
   * ratio, with optional placeholder text boxes as column headers (above) and row
   * labels (to the left) for figure panels like "DAPI / GFP / Merge" x "Condition A/B/C".
   */
  function arrangeGrid(opts) {
    const { rows, cols, cellW, cellH, gap, headerRow, headerCol } = opts;
    let imgs = canvas.getActiveObjects().filter(o => o.mfcType === 'mfcImage');
    if (imgs.length < 2) imgs = canvas.getObjects().filter(o => o.mfcType === 'mfcImage');
    if (!imgs.length) { MFC_UI.toast('No images to arrange — import or select some first.'); return; }

    const headerRowH = headerRow ? 44 : 0;
    const headerColW = headerCol ? 120 : 0;
    const originX = 40 + headerColW;
    const originY = 40 + headerRowH;

    imgs.forEach((img, idx) => {
      if (idx >= rows * cols) return;
      const r = Math.floor(idx / cols), c = idx % cols;
      const s = Math.min(cellW / img.width, cellH / img.height);
      img.set({
        scaleX: s, scaleY: s, angle: 0,
        left: originX + c * (cellW + gap) + (cellW - img.width * s) / 2,
        top: originY + r * (cellH + gap) + (cellH - img.height * s) / 2
      });
      img.setCoords();
      updateScaleBarsForImage(img);
      followSourceImage(img);
    });

    if (headerRow) {
      for (let c = 0; c < cols; c++) {
        const t = new fabric.Textbox('Label', {
          left: originX + c * (cellW + gap), top: originY - headerRowH, width: cellW,
          fontSize: 18, textAlign: 'center', fontFamily: 'Arial', fill: '#000000'
        });
        t.mfcId = 'txt' + (nextId++); t.mfcType = 'text';
        attachTextListeners(t);
        canvas.add(t);
      }
    }
    if (headerCol) {
      for (let r = 0; r < rows; r++) {
        const t = new fabric.Textbox('Label', {
          left: 40, top: originY + r * (cellH + gap) + cellH / 2 - 12, width: headerColW - 12,
          fontSize: 18, textAlign: 'right', fontFamily: 'Arial', fill: '#000000'
        });
        t.mfcId = 'txt' + (nextId++); t.mfcType = 'text';
        attachTextListeners(t);
        canvas.add(t);
      }
    }
    canvas.requestRenderAll();
    pushHistory();
  }

  // ---- tool switching ----
  function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    document.getElementById('panel-crop').classList.toggle('hidden', tool !== 'crop');
    document.getElementById('panel-scalebar').classList.toggle('hidden', tool !== 'scalebar');
    canvas.isDrawingMode = false;
    canvas.selection = (tool === 'select' || tool === 'scalebar');
    canvas.forEachObject(o => { if (!o.mfcIsPageBounds) o.selectable = (tool === 'select' || tool === 'scalebar'); });
    if (tool === 'crop') startCrop();
    else cancelCrop();
    if (tool === 'scalebar') refreshScaleBarRefList();
    if (tool !== 'shape' && shapeDrag) { canvas.remove(shapeDrag.rect); shapeDrag = null; }
    if (tool !== 'inset' && insetDrag) { canvas.remove(insetDrag.rect); insetDrag = null; }
    refreshTextPanel();
    refreshObjectSizePanel();
    refreshShapePanel();
    refreshInsetPanel();
  }

  function getRegistry() { return registry; }
  function getNextIdCounter() { return nextId; }
  function setNextIdCounter(v) { nextId = v; }

  return {
    init, getCanvas, getDocProps, applyDocProps, setDocName, getAppVersion, docPropsToPixels,
    importFiles, addImageToCanvas, recomposite, refreshChannelPanel,
    applyPixelSize, applyAlphaToggle, applyBrightnessContrast, commitBrightnessContrast, resetToneCurve,
    undo, redo, pushHistory,
    setTool, align, copySelection, pasteSelection, nudgeSelection, refreshLayersPanel,
    groupSelection, ungroupSelection,
    applyCrop, cancelCrop, setCropAspectMode, applyCropFieldsToRect,
    applyTextStyle, applyTextAlign, applyTextBoxSize, applyTextBorder, refreshTextPanel, attachTextListeners,
    refreshObjectSizePanel, applyObjectSizeFromFields, rotateSelected, setObjectAngle, uncropImage,
    refreshScaleBarRefList, placeScaleBarAtCorner, placeScaleBarOnSelectedImages,
    arrangeGrid,
    applyShapeStyle, setShapeAspectMode, refreshShapePanel,
    createInsetFromContour, refreshInsetPanel, applyInsetContourStyle, setInsetAspectMode,
    zoomIn, zoomOut, zoomReset, updateZoomDisplay, setZoom, getZoomLevel, withDocOnlyView,
    getRegistry, getNextIdCounter, setNextIdCounter,
    get currentTool() { return currentTool; }
  };
})();

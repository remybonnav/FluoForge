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

  let canvas;                       // fabric.Canvas
  let docProps = { width: 1748, height: 1240, unit: 'px', dpi: 300 }; // A4-ish default @300dpi
  let currentTool = 'select';
  let nextId = 1;
  const registry = {};              // id -> { rawImage (from tiff.js), fileBase64 }

  // ---- history (lightweight property snapshots, keyed by object id) ----
  const history = { stack: [], index: -1, limit: 60 };

  function snapshotState() {
    return canvas.getObjects().map(o => serializeObjectState(o));
  }

  function serializeObjectState(o) {
    const base = {
      id: o.mfcId, type: o.mfcType || o.type,
      left: o.left, top: o.top, scaleX: o.scaleX, scaleY: o.scaleY,
      angle: o.angle, width: o.width, height: o.height,
      cropX: o.cropX || 0, cropY: o.cropY || 0
    };
    if (o.mfcType === 'mfcImage') {
      base.channels = registry[o.mfcId] ? JSON.parse(JSON.stringify(
        registry[o.mfcId].rawImage.channels.map(c => ({ enabled: c.enabled, color: c.color, min: c.min, max: c.max }))
      )) : null;
    }
    if (o.type === 'textbox') {
      base.text = o.text;
      base.styles = JSON.parse(JSON.stringify(o.styles || {}));
      base.fontFamily = o.fontFamily; base.fontSize = o.fontSize; base.fill = o.fill;
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

  function applySnapshot(snap) {
    const byId = {};
    canvas.getObjects().forEach(o => byId[o.mfcId] = o);
    snap.forEach(s => {
      const o = byId[s.id];
      if (!o) return;
      o.set({ left: s.left, top: s.top, scaleX: s.scaleX, scaleY: s.scaleY, angle: s.angle,
               width: s.width, height: s.height, cropX: s.cropX, cropY: s.cropY });
      if (s.type === 'mfcImage' && s.channels && registry[s.id]) {
        registry[s.id].rawImage.channels.forEach((c, i) => Object.assign(c, s.channels[i]));
        recomposite(o);
      }
      if (o.type === 'textbox') {
        o.set({ text: s.text, styles: s.styles, fontFamily: s.fontFamily, fontSize: s.fontSize, fill: s.fill });
        o.initDimensions && o.initDimensions();
      }
      o.setCoords();
    });
    canvas.requestRenderAll();
    refreshChannelPanel();
  }

  function undo() {
    if (history.index <= 0) return;
    history.index--;
    applySnapshot(history.stack[history.index]);
  }
  function redo() {
    if (history.index >= history.stack.length - 1) return;
    history.index++;
    applySnapshot(history.stack[history.index]);
  }

  // ---- init ----
  function init() {
    canvas = new fabric.Canvas('mfc-canvas', {
      preserveObjectStacking: true,
      selection: true
    });
    applyDocProps(docProps);

    canvas.on('object:modified', () => pushHistory());
    canvas.on('selection:created', onSelectionChanged);
    canvas.on('selection:updated', onSelectionChanged);
    canvas.on('selection:cleared', onSelectionChanged);
    canvas.on('text:changed', () => { /* debounced via object:modified on blur */ });
    canvas.on('mouse:down', onCanvasMouseDown);

    canvas.on('object:moving', (e) => {
      if (e.target && e.target.mfcType === 'mfcImage') repositionAttachedScaleBars(e.target);
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

      if (obj.mfcType === 'mfcImage') repositionAttachedScaleBars(obj);
      refreshObjectSizePanel();
      if (obj.type === 'textbox') refreshTextPanel();
    });

    pushHistory();
  }

  // ---- zoom (resizes the actual canvas element too, so the document boundary
  // visibly scales with it — not just the objects inside a fixed-size canvas) ----
  let zoomLevel = 1;
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
    canvas.setWidth(docPx.width * zoomLevel);
    canvas.setHeight(docPx.height * zoomLevel);
    canvas.requestRenderAll();
    updateZoomDisplay();
  }
  function getZoomLevel() { return zoomLevel; }

  function applyDocProps(props) {
    docProps = props;
    setZoom(zoomLevel); // recomputes canvas dimensions from the new docProps at current zoom
  }

  function docPropsToPixels(props) {
    let w = props.width, h = props.height;
    if (props.unit === 'cm') { w = (w / 2.54) * props.dpi; h = (h / 2.54) * props.dpi; }
    else if (props.unit === 'in') { w = w * props.dpi; h = h * props.dpi; }
    return { width: Math.round(w), height: Math.round(h) };
  }

  function getDocProps() { return docProps; }
  function getCanvas() { return canvas; }

  // ---- image import ----
  async function importFiles(fileList) {
    for (const file of Array.from(fileList)) {
      try {
        const rawImage = await MFC_TIFF.decodeFile(file);
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
    fabricImg.setElement(newCanvas);
    // keep on-screen size stable when working-resolution canvas dims are unchanged (they are)
    fabricImg.scaleX = curScaleX; fabricImg.scaleY = curScaleY;
    canvas.requestRenderAll();
  }

  // ---- channel panel ----
  function refreshChannelPanel() {
    const listEl = document.getElementById('channel-list');
    const nameEl = document.getElementById('channel-image-name');
    const active = canvas.getActiveObject();

    if (!active || active.mfcType !== 'mfcImage') {
      listEl.innerHTML = '<p class="hint">Select an image to edit its channels.</p>';
      nameEl.textContent = '';
      return;
    }
    const entry = registry[active.mfcId];
    nameEl.textContent = '— ' + active.mfcFileName;
    listEl.innerHTML = '';

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
          <span class="rv ch-min-val">${Math.round(ch.min)}</span>
        </div>
        <div class="range-row">
          <span class="hint">max</span>
          <input type="range" class="ch-max" min="0" max="65535" value="${ch.max}">
          <span class="rv ch-max-val">${Math.round(ch.max)}</span>
        </div>
      `;
      listEl.appendChild(row);

      const rangeCeil = ch.bitDepth > 8 ? 65535 : 255;
      row.querySelector('.ch-min').max = rangeCeil;
      row.querySelector('.ch-max').max = rangeCeil;

      row.querySelector('.ch-toggle').addEventListener('change', (e) => {
        ch.enabled = e.target.checked;
        recomposite(active); canvas.fire('object:modified', { target: active });
      });
      row.querySelector('.ch-color').addEventListener('change', (e) => {
        ch.color = e.target.value;
        row.querySelector('.swatch').style.background = swatchColor(ch.color);
        recomposite(active); canvas.fire('object:modified', { target: active });
      });
      row.querySelector('.ch-min').addEventListener('input', (e) => {
        ch.min = Math.min(parseFloat(e.target.value), ch.max - 1);
        row.querySelector('.ch-min-val').textContent = Math.round(ch.min);
        recomposite(active);
      });
      row.querySelector('.ch-max').addEventListener('input', (e) => {
        ch.max = Math.max(parseFloat(e.target.value), ch.min + 1);
        row.querySelector('.ch-max-val').textContent = Math.round(ch.max);
        recomposite(active);
      });
      row.querySelector('.ch-min').addEventListener('change', () => canvas.fire('object:modified', { target: active }));
      row.querySelector('.ch-max').addEventListener('change', () => canvas.fire('object:modified', { target: active }));
    });
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
  }

  function setObjectAngle(deg) {
    const active = canvas.getActiveObject();
    if (!active) return;
    active.set('angle', ((deg % 360) + 360) % 360);
    active.setCoords();
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
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
  }

  // ---- text panel (re-populates whenever a text box is selected/reselected) ----
  function refreshTextPanel() {
    const panel = document.getElementById('panel-text');
    const active = canvas.getActiveObject();
    const isText = active && active.type === 'textbox';
    panel.classList.toggle('hidden', !(isText || currentTool === 'text'));
    if (!isText) return;

    document.getElementById('text-font').value = active.fontFamily || 'Arial';
    document.getElementById('text-size').value = Math.round(active.fontSize || 24);
    document.getElementById('text-color').value = /^#/.test(active.fill) ? active.fill : '#ffffff';
    document.getElementById('text-bold').classList.toggle('active', active.fontWeight === 'bold');
    document.getElementById('text-italic').classList.toggle('active', active.fontStyle === 'italic');
    document.getElementById('text-underline').classList.toggle('active', !!active.underline);
    ['left', 'center', 'right'].forEach(a =>
      document.getElementById('text-align-' + a).classList.toggle('active', (active.textAlign || 'left') === a));
    document.getElementById('text-width').value = Math.round(active.getScaledWidth());
    document.getElementById('text-height').value = Math.round(active.getScaledHeight());
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
    } else if (currentTool === 'scalebar' && !opt.target && scaleBarArmed) {
      placeScaleBarAt(canvas.getPointer(opt.e));
    }
  }

  /** Apply a style prop either to a highlighted text range (per-word/char formatting) or the whole box. */
  function applyTextStyle(prop, value) {
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'textbox') return;

    const savedSel = (lastTextSelection && lastTextSelection.id === active.mfcId) ? lastTextSelection : null;
    const liveSel = active.isEditing ? { start: active.selectionStart, end: active.selectionEnd } : null;
    const sel = (liveSel && liveSel.start !== liveSel.end) ? liveSel
              : (savedSel && savedSel.start !== savedSel.end) ? savedSel
              : null;

    if (sel) {
      active.setSelectionStyles({ [prop]: value }, sel.start, sel.end);
      active.dirty = true;
    } else {
      active.set(prop, value);
    }
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
  }

  function applyTextAlign(align) {
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'textbox') return;
    active.set('textAlign', align);
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
    refreshTextPanel();
  }

  // ---- scale bar ----
  let scaleBarArmed = false;
  function armScaleBar() { scaleBarArmed = true; MFC_UI.toast('Click on the canvas to place the scale bar.'); }

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

  function buildScaleBarGroup(pointer, onScreenPxLen, thickness, color, showLabel, lengthUm) {
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
    const g = new fabric.Group(items, { left: pointer.x, top: pointer.y, originX: 'left', originY: 'top' });
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

  function placeScaleBarAt(pointer) {
    const refId = document.getElementById('sb-ref-image').value;
    const entry = registry[refId];
    const refObj = canvas.getObjects().find(o => o.mfcId === refId);
    const { lengthUm, thickness, color, showLabel } = readScaleBarFormValues();

    if (!entry || !entry.rawImage.voxelSizeUm) {
      MFC_UI.toast('No voxel size calibration found for that image — cannot compute scale bar length.');
      scaleBarArmed = false; setTool('select');
      return;
    }
    const onScreenPxLen = computeScaleBarPxLength(refObj, entry, lengthUm);
    const g = buildScaleBarGroup(pointer, onScreenPxLen, thickness, color, showLabel, lengthUm);
    canvas.add(g);
    canvas.setActiveObject(g);
    canvas.requestRenderAll();
    pushHistory();
    scaleBarArmed = false;
    setTool('select');
  }

  /**
   * Place a scale bar directly at a corner of a reference image, offset by a % margin
   * of that image's displayed size, and "attach" it: whenever the image moves or is
   * resized, the bar is automatically repositioned to keep the same corner + margin.
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
    const g = buildScaleBarGroup({ x: 0, y: 0 }, onScreenPxLen, thickness, color, showLabel, lengthUm);
    g.mfcAttachedTo = refObj.mfcId;
    g.mfcCorner = corner;
    g.mfcMarginPct = marginPct;
    canvas.add(g);
    repositionAttachedScaleBars(refObj);
    canvas.setActiveObject(g);
    canvas.requestRenderAll();
    pushHistory();
  }

  /** Re-position every scale bar attached to imgObj, called on that image's move/scale events. */
  function repositionAttachedScaleBars(imgObj) {
    if (!imgObj || imgObj.mfcType !== 'mfcImage') return;
    const bars = canvas.getObjects().filter(o => o.mfcType === 'scalebar' && o.mfcAttachedTo === imgObj.mfcId);
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
  function copySelection() {
    const active = canvas.getActiveObject();
    if (!active) return;
    if (active.mfcType === 'mfcImage') {
      clipboardObj = { kind: 'mfcImage', sourceId: active.mfcId, props: serializeObjectState(active) };
    } else {
      active.clone((cloned) => { clipboardObj = { kind: 'fabric', obj: cloned }; });
    }
  }

  function pasteSelection() {
    if (!clipboardObj) return;

    if (clipboardObj.kind === 'mfcImage') {
      const src = registry[clipboardObj.sourceId];
      if (!src) return;
      // Independent copy: new registry entry with its own channel settings (on/off,
      // color, contrast), so the two images can be edited separately from here on.
      // The raw pixel arrays are read-only and safe to share by reference.
      const clonedRaw = { ...src.rawImage, channels: src.rawImage.channels.map(c => ({ ...c })) };
      const id = 'img' + (nextId++);
      registry[id] = { rawImage: clonedRaw, fileBase64: src.fileBase64, workingScale: src.workingScale };
      const compositeCanvas = MFC_TIFF.compositeChannels(clonedRaw, src.workingScale);

      const p = clipboardObj.props;
      const fabricImg = new fabric.Image(compositeCanvas, {
        left: p.left + 24, top: p.top + 24, scaleX: p.scaleX, scaleY: p.scaleY, angle: p.angle,
        cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
      });
      fabricImg.mfcId = id;
      fabricImg.mfcType = 'mfcImage';
      fabricImg.mfcRawWidth = clonedRaw.width;
      fabricImg.mfcRawHeight = clonedRaw.height;
      fabricImg.mfcFileName = clonedRaw.fileName + ' copy';

      canvas.add(fabricImg);
      canvas.setActiveObject(fabricImg);
      canvas.requestRenderAll();
      pushHistory();
      refreshChannelPanel();
      refreshScaleBarRefList();
      return;
    }

    clipboardObj.obj.clone((cloned) => {
      cloned.set({ left: cloned.left + 20, top: cloned.top + 20, evented: true });
      cloned.mfcId = (cloned.mfcType || 'obj') + (nextId++);
      if (cloned.type === 'textbox') { cloned.mfcType = 'text'; attachTextListeners(cloned); }
      if (canvas.getActiveObject && canvas.getActiveObject() && canvas.getActiveObject().type === 'activeSelection') {
        canvas.discardActiveObject();
      }
      canvas.add(cloned);
      canvas.setActiveObject(cloned);
      canvas.requestRenderAll();
      pushHistory();
    });
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
      repositionAttachedScaleBars(img);
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
    canvas.selection = tool === 'select';
    canvas.forEachObject(o => o.selectable = tool === 'select');
    if (tool === 'crop') startCrop();
    else cancelCrop();
    if (tool === 'scalebar') { refreshScaleBarRefList(); armScaleBar(); }
    else scaleBarArmed = false;
    refreshTextPanel();
    refreshObjectSizePanel();
  }

  function getRegistry() { return registry; }
  function getNextIdCounter() { return nextId; }
  function setNextIdCounter(v) { nextId = v; }

  return {
    init, getCanvas, getDocProps, applyDocProps, docPropsToPixels,
    importFiles, addImageToCanvas, recomposite, refreshChannelPanel,
    undo, redo, pushHistory,
    setTool, align, copySelection, pasteSelection,
    applyCrop, cancelCrop, setCropAspectMode, applyCropFieldsToRect,
    applyTextStyle, applyTextAlign, applyTextBoxSize, refreshTextPanel,
    refreshObjectSizePanel, applyObjectSizeFromFields, rotateSelected, setObjectAngle,
    armScaleBar, refreshScaleBarRefList, placeScaleBarAtCorner,
    arrangeGrid,
    zoomIn, zoomOut, zoomReset, updateZoomDisplay, setZoom, getZoomLevel,
    getRegistry, getNextIdCounter, setNextIdCounter,
    get currentTool() { return currentTool; }
  };
})();

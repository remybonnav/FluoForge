/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
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
  fabric.Object.NUM_FRACTION_DIGITS = 8;

  const DASH_PRESETS = {
    solid: null,
    dashed: [12, 8],
    dotted: [2, 5],
    dashdot: [12, 5, 2, 5],
    longdash: [22, 10]
  };

  let canvas;                       // fabric.Canvas
  const MFC_VERSION = '0.1.1';
  function getAppVersion() { return MFC_VERSION; }

  let docProps = { name: 'Untitled Figure', width: 1748, height: 1240, unit: 'px', dpi: 300 }; // A4-ish default @300dpi
  let currentTool = 'select';
  let documentOpen = false;
  let nextId = 1;
  const registry = {};              // view id -> { rawImage, sourceId, sourceBlob, workingScale }

  // Undo, versions and recovery use one recursive serializer, without image bytes.
  // Each step also keeps a label (worked out by comparing it with the previous step)
  // and a time, for the History panel.
  const history = { stack: [], labels: [], times: [], index: -1, limit: 200, restoring: false };
  function pushHistory() {
    if (history.restoring) return;
    const state = MFC_PROJECT.captureState();
    const previous = history.stack[history.index];
    // Identical consecutive states (a field firing both input and change) are one step.
    if (previous && MFC_PROJECT.fingerprint(previous) === MFC_PROJECT.fingerprint(state)) return;
    history.stack = history.stack.slice(0, history.index + 1);
    history.labels = history.labels.slice(0, history.index + 1);
    history.times = history.times.slice(0, history.index + 1);
    history.stack.push(state);
    history.labels.push(previous ? describeHistoryStep(previous, state) : 'Opened figure');
    history.times.push(Date.now());
    if (history.stack.length > history.limit) { history.stack.shift(); history.labels.shift(); history.times.shift(); }
    history.index = history.stack.length - 1;
    refreshHistoryPanel();
    window.dispatchEvent(new Event('mfc:changed'));
  }
  function resetHistory() { history.stack = []; history.labels = []; history.times = []; history.index = -1; pushHistory(); }
  async function moveHistory(delta) { await jumpToHistory(history.index + delta); }
  /** Restores any step of the history; later steps stay available for redo until something new is done. */
  async function jumpToHistory(index) {
    if (history.restoring || index < 0 || index >= history.stack.length || index === history.index) return;
    history.restoring = true;
    try { await MFC_PROJECT.restoreState(history.stack[index], { resetHistory: false }); history.index = index; }
    finally { history.restoring = false; refreshHistoryPanel(); }
  }

  // ---- history labels ----
  function historyObjectName(json) {
    if (json.mfcType === 'mfcImage') return (json.mfcFileName || 'image') + (json.mfcIsInset && !/\(inset\)$/.test(json.mfcFileName || '') ? ' (inset)' : '');
    if (json.type === 'textbox' || json.mfcType === 'text') {
      const t = String(json.text || '').replace(/\s+/g, ' ').trim();
      return 'text "' + (t.length > 16 ? t.slice(0, 16) + '…' : t) + '"';
    }
    if (json.mfcType === 'scalebar') return 'scale bar' + (json.mfcLengthUm != null ? ' ' + json.mfcLengthUm + ' µm' : '');
    if (json.mfcType === 'insetContour') return 'inset outline';
    if (json.mfcShapeKind === 'path') return 'path';
    if (json.mfcType === 'shape') return json.mfcShapeKind || (json.type === 'ellipse' ? 'ellipse' : 'box');
    if (json.type === 'group') return 'group';
    return json.type || 'object';
  }
  /** What kind of change turned a into b (same object, two states). */
  function historyChangeKind(a, b) {
    const differs = keys => keys.some(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    const changed = new Set(Object.keys({ ...a, ...b }).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])));
    if (!a.clipPath && b.clipPath) return 'Cropped to shape';
    if (a.clipPath && !b.clipPath) return 'Removed shape crop';
    if (changed.has('visible')) return b.visible === false ? 'Hid' : 'Showed';
    if (changed.has('mfcLocked')) return b.mfcLocked ? 'Locked' : 'Unlocked';
    if (changed.has('mfcPositionLocked')) return b.mfcPositionLocked ? 'Locked position of' : 'Unlocked position of';
    if (changed.has('display')) {
      const strip = d => { const { zMode, zIndex, tIndex, ...rest } = d || {}; return JSON.stringify(rest); };
      if (strip(a.display) === strip(b.display)) {
        const z = d => JSON.stringify([(d || {}).zMode, (d || {}).zIndex]);
        return z(a.display) !== z(b.display) ? 'Changed Z plane of' : 'Changed time frame of';
      }
      return 'Changed channels of';
    }
    if (differs(['cropX', 'cropY']) && a.mfcType === 'mfcImage' && !a.mfcIsInset) return 'Cropped';
    if (changed.has('text') || changed.has('styles')) return 'Edited';
    if (differs(['scaleX', 'scaleY', 'width', 'height', 'rx', 'ry', 'mfcBoxHeight'])) return 'Resized';
    if (changed.has('angle')) return 'Rotated';
    if ([...changed].every(k => ['left', 'top'].includes(k))) return 'Moved';
    if (differs(['path', 'mfcPathNodes', 'mfcPathClosed'])) return 'Reshaped';
    if (differs(['stroke', 'strokeWidth', 'strokeDashArray', 'fill', 'opacity', 'strokeLineCap', 'strokeLineJoin', 'mfcArrowStart', 'mfcArrowEnd', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'underline', 'textAlign', 'mfcVAlign', 'backgroundColor', 'mfcBorderWidth', 'mfcBorderColor'])) return 'Restyled';
    return 'Changed';
  }
  function describeHistoryStep(prev, next) {
    const before = new Map(prev.objects.map(o => [o.mfcId, o])), after = new Map(next.objects.map(o => [o.mfcId, o]));
    const added = next.objects.filter(o => !before.has(o.mfcId)), removed = prev.objects.filter(o => !after.has(o.mfcId));
    const pagesBefore = Math.max(1, prev.docProps?.pages || 1), pagesAfter = Math.max(1, next.docProps?.pages || 1);
    if (pagesAfter > pagesBefore) return 'Added page ' + pagesAfter;
    if (pagesAfter < pagesBefore) return 'Removed page ' + pagesBefore;
    if (added.length === 1 && added[0].type === 'group' && added[0].mfcType !== 'scalebar' && removed.length > 1) return 'Grouped ' + removed.length + ' objects';
    if (removed.length === 1 && removed[0].type === 'group' && removed[0].mfcType !== 'scalebar' && !added.length) {
      const ids = new Set((removed[0].objects || []).map(o => o.mfcId));
      if (ids.size && [...ids].every(id => after.has(id))) return 'Ungrouped ' + ids.size + ' objects';
    }
    if (added.length === 1 && removed.length === 1 && added[0].mfcType === 'shape' && removed[0].mfcType === 'shape') return 'Changed ' + historyObjectName(added[0]);
    if (removed.length === 1 && !added.length && next.objects.some(o => o.clipPath && o.clipPath.mfcId === removed[0].mfcId)) {
      return 'Cropped ' + historyObjectName(next.objects.find(o => o.clipPath && o.clipPath.mfcId === removed[0].mfcId)) + ' to shape';
    }
    if (added.length === 1 && !removed.length && prev.objects.some(o => o.clipPath && o.clipPath.mfcId === added[0].mfcId)) {
      return 'Removed shape crop of ' + historyObjectName(prev.objects.find(o => o.clipPath && o.clipPath.mfcId === added[0].mfcId));
    }
    if (added.length && !removed.length) return added.length === 1 ? 'Added ' + historyObjectName(added[0]) : 'Added ' + added.length + ' objects';
    if (removed.length && !added.length) return removed.length === 1 ? 'Deleted ' + historyObjectName(removed[0]) : 'Deleted ' + removed.length + ' objects';
    if (added.length && removed.length) return 'Replaced ' + removed.length + ' object(s)';
    const changed = next.objects.filter(o => before.has(o.mfcId) && JSON.stringify(before.get(o.mfcId)) !== JSON.stringify(o));
    if (changed.length === 1) {
      const kind = historyChangeKind(before.get(changed[0].mfcId), changed[0]);
      return kind === 'Cropped to shape' || kind === 'Removed shape crop'
        ? kind.replace('Cropped', 'Cropped ' + historyObjectName(changed[0])).replace('Removed shape crop', 'Removed shape crop of ' + historyObjectName(changed[0]))
        : kind + ' ' + historyObjectName(changed[0]);
    }
    if (changed.length > 1) {
      const kinds = new Set(changed.map(o => historyChangeKind(before.get(o.mfcId), o)));
      return (kinds.size === 1 ? [...kinds][0] : 'Changed') + ' ' + changed.length + ' objects';
    }
    if (prev.objects.map(o => o.mfcId).join() !== next.objects.map(o => o.mfcId).join()) return 'Changed layer order';
    if (JSON.stringify(prev.docProps) !== JSON.stringify(next.docProps)) return 'Changed document properties';
    return 'Changed figure';
  }

  /** History panel: every step, oldest first; click one to go back (or forward) to it. */
  function refreshHistoryPanel() {
    const list = document.getElementById('history-list');
    if (!list) return;
    if (!history.stack.length) { list.innerHTML = '<p class="hint">No steps yet.</p>'; return; }
    const time = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    list.replaceChildren(...history.labels.map((label, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'history-row' + (i === history.index ? ' current' : '') + (i > history.index ? ' undone' : '');
      row.dataset.index = String(i);
      row.title = i === history.index ? 'Current state' : (i < history.index ? 'Go back to this step' : 'Redo up to this step');
      const name = document.createElement('span'); name.className = 'history-label'; name.textContent = label;
      const when = document.createElement('span'); when.className = 'history-time'; when.textContent = time(history.times[i]);
      row.append(name, when);
      row.addEventListener('click', () => jumpToHistory(i));
      return row;
    }));
    const current = list.querySelector('.history-row.current');
    if (current) list.scrollTop = Math.max(0, current.offsetTop - list.clientHeight + current.offsetHeight + 4);
    const undoBtn = document.getElementById('btn-undo'), redoBtn = document.getElementById('btn-redo');
    if (MFC_UI && documentOpen) { undoBtn.disabled = history.index <= 0; redoBtn.disabled = history.index >= history.stack.length - 1; }
  }
  function getHistory() { return { labels: history.labels.slice(), index: history.index }; }

  const undo = () => moveHistory(-1), redo = () => moveHistory(1);

  /** Page backgrounds, path drawing aids and scale bar previews: on the canvas but never part of the figure. */
  function isHelper(o) { return !!(o && (o.mfcIsPageBounds || o.mfcIsPathHelper || o.mfcIsPathDraft || o.mfcIsPreview)); }

  // ---- init ----
  function init() {
    canvas = new fabric.Canvas('mfc-canvas', {
      preserveObjectStacking: true,
      selection: true
    });
    setZoom(1);

    canvas.on('object:modified', (e) => {
      const obj = e.target;
      // Corner handles scale a text box; fontSize stays the single source of truth, so
      // the scale is folded into fontSize/width (and box height) and reset to 1.
      if (obj && obj.type === 'textbox' && normalizeTextScale(obj)) refreshTextPanel();
      if (obj && obj.type === 'activeSelection') obj.getObjects().forEach(o => { if (o.mfcType === 'mfcImage') syncAttachments(o); });
      else if (obj && obj.mfcType === 'mfcImage') syncAttachments(obj);
      refreshSelectionBar();
      if (obj && obj.mfcType === 'insetContour') refreshInsetPanel();
      if (currentTool === 'scalebar') refreshScaleBarPreview();
      pushHistory();
    });
    canvas.on('object:resizing', (e) => { refreshSelectionBar(); if (e.target && e.target.type === 'textbox') refreshTextPanel(); });

    // Shift while rotating snaps to 45° steps, pivoting on the object's center like Fabric's own rotation.
    canvas.on('object:rotating', (e) => {
      const obj = e.target;
      if (!obj) return;
      if (e.e && e.e.shiftKey) {
        const snapped = ((Math.round((obj.angle || 0) / 45) * 45) % 360 + 360) % 360;
        if (snapped !== obj.angle) {
          const center = obj.getCenterPoint();
          obj.set('angle', snapped);
          obj.setPositionByOrigin(center, 'center', 'center');
          obj.setCoords();
        }
      }
      if (obj.mfcType === 'mfcImage') syncAttachments(obj);
      refreshSelectionBar();
    });
    canvas.on('selection:created', onSelectionChanged);
    canvas.on('selection:updated', onSelectionChanged);
    canvas.on('selection:cleared', onSelectionChanged);
    canvas.on('object:added', e => { if (!isHelper(e.target)) refreshLayersPanel(); });
    canvas.on('object:removed', e => { if (!isHelper(e.target)) refreshLayersPanel(); });
    canvas.on('text:changed', () => { /* debounced via object:modified on blur */ });
    canvas.on('mouse:down', (opt) => {
      // A highlighted range belongs to the editing session in which it was made; any new
      // click on the canvas starts over, so later panel edits apply to the whole box.
      lastTextSelection = null;
      onCanvasMouseDown(opt);
    });
    canvas.on('mouse:move', onCanvasMouseMove);
    canvas.on('mouse:up', onCanvasMouseUp);
    canvas.on('mouse:dblclick', onCanvasDoubleClick);

    canvas.on('object:moving', (e) => {
      if (!e.target || e.target === cropRect) return;
      if (!(e.e && e.e.altKey)) snapObjectPosition(e.target); // hold Alt to move freely without snapping
      if (e.target.mfcType === 'mfcImage') { syncAttachments(e.target); }
      if (e.target.mfcType === 'insetContour') { syncInsetFromContour(e.target); updateInsetReadout(e.target); }
      if (e.target.type === 'activeSelection') {
        e.target.getObjects().forEach(o => { if (o.mfcType === 'mfcImage') syncAttachments(o); });
      }
      refreshSelectionBar();
    });

    // Ctrl+scroll (or pinch, which browsers report as ctrlKey+wheel) zooms the CANVAS,
    // not the page. Plain scroll pans the canvas-wrap div as normal (its own scrollbars).
    canvas.on('mouse:wheel', (opt) => {
      if (!opt.e.ctrlKey) return; // let the page/div scroll normally otherwise
      opt.e.preventDefault();
      opt.e.stopPropagation();
      setZoom(zoomLevel * (0.999 ** opt.e.deltaY), zoomAnchor(opt.e));
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

      if (obj.mfcType === 'mfcImage') { syncAttachments(obj); }
      if (obj.mfcType === 'insetContour') { syncInsetFromContour(obj); updateInsetReadout(obj); }
      refreshSelectionBar();
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
  let pageRects = [];

  // ---- pages: every page has the document size; pages are stacked vertically on one
  // canvas, PAGE_GAP apart, so objects (and links between them) can cross pages. ----
  const PAGE_GAP = 120;
  function pageCount(props = docProps) { return Math.max(1, Math.floor(props.pages) || 1); }
  /** Page i (0-based) in document coordinates. */
  function pageBounds(i, props = docProps) {
    const px = docPropsToPixels(props);
    return { left: 0, top: i * (px.height + PAGE_GAP), width: px.width, height: px.height };
  }
  /** The area holding every page, used to size the canvas. */
  function docExtent(props = docProps) {
    const last = pageBounds(pageCount(props) - 1, props);
    return { width: last.width, height: last.top + last.height };
  }
  /** Index of the page whose area overlaps the given box the most, or -1 for the pasteboard. */
  function pageIndexForBox(box) {
    let best = -1, bestArea = 0;
    for (let i = 0; i < pageCount(); i++) {
      const p = pageBounds(i);
      const w = Math.min(box.left + box.width, p.left + p.width) - Math.max(box.left, p.left);
      const h = Math.min(box.top + box.height, p.top + p.height) - Math.max(box.top, p.top);
      if (w > 0 && h > 0 && w * h > bestArea) { best = i; bestArea = w * h; }
    }
    return best;
  }

  /** Creates (or resizes/re-adds, e.g. after canvas.clear()) the white page rects that mark each page within the larger pasteboard. Excluded from selection, history, save/export. */
  function ensurePageRect() {
    if (!documentOpen) return;
    const count = pageCount();
    pageRects = pageRects.filter(rect => canvas.getObjects().includes(rect));
    while (pageRects.length > count * 2) canvas.remove(pageRects.pop());
    for (let i = 0; i < count; i++) {
      const b = pageBounds(i);
      let rect = pageRects[i * 2], label = pageRects[i * 2 + 1];
      if (!rect) {
        rect = new fabric.Rect({
          fill: '#ffffff', stroke: '#000000', strokeWidth: 1,
          selectable: false, evented: false, hoverCursor: 'default', objectCaching: false,
          shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.45)', blur: 30, offsetX: 0, offsetY: 12 })
        });
        rect.mfcIsPageBounds = true; // flag: never serialized, selected, copied, or history-tracked
        label = new fabric.Text('', { fontSize: 22, fill: '#8a90a0', fontFamily: 'Liberation Sans',
          selectable: false, evented: false, objectCaching: false });
        label.mfcIsPageBounds = true;
        pageRects[i * 2] = rect; pageRects[i * 2 + 1] = label;
        canvas.add(rect); canvas.add(label);
      }
      rect.set({ left: b.left, top: b.top, width: b.width, height: b.height });
      label.set({ left: b.left, top: b.top - 34, text: count > 1 ? 'Page ' + (i + 1) + ' of ' + count : '' });
      rect.setCoords(); label.setCoords();
    }
    for (let i = pageRects.length - 1; i >= 0; i--) canvas.sendToBack(pageRects[i]);
  }
  function sendPagesToBack() { for (let i = pageRects.length - 1; i >= 0; i--) canvas.sendToBack(pageRects[i]); }

  /** Adds a page after the last one. */
  function addPage() {
    if (!documentOpen) return;
    applyDocProps({ ...docProps, pages: pageCount() + 1 });
    pushHistory();
    MFC_UI.refreshPageControls();
    scrollToPage(pageCount() - 1);
  }
  /** Removes the last page; objects on it stay on the pasteboard (they are not exported). */
  function removeLastPage() {
    const count = pageCount();
    if (!documentOpen || count < 2) { MFC_UI.toast('A figure needs at least one page.'); return false; }
    const last = pageBounds(count - 1);
    const onIt = layerObjects().filter(o => pageIndexForBox(o.getBoundingRect(true, true)) === count - 1);
    if (onIt.length && !window.confirm(`Page ${count} holds ${onIt.length} object(s). Remove the page anyway? The objects stay on the pasteboard below page ${count - 1} and are not exported until you move them onto a page.`)) return false;
    applyDocProps({ ...docProps, pages: count - 1 });
    pushHistory();
    MFC_UI.refreshPageControls();
    return !!last;
  }
  function scrollToPage(i) {
    const b = pageBounds(Math.max(0, Math.min(i, pageCount() - 1))), wrap = document.getElementById('canvas-wrap');
    canvas.discardActiveObject(); canvas.requestRenderAll();
    scrollToAnchor({ doc: { x: b.left + b.width / 2, y: b.top }, view: { x: wrap.clientWidth / 2, y: 40 } });
  }

  function updateZoomDisplay() {
    const el = document.getElementById('zoom-display');
    if (el) el.textContent = Math.round(zoomLevel * 100) + '%';
  }
  function zoomIn() { setZoom(zoomLevel * 1.2, zoomAnchor()); }
  function zoomOut() { setZoom(zoomLevel / 1.2, zoomAnchor()); }
  function zoomReset() { setZoom(1, zoomAnchor()); }

  // The canvas element grows/shrinks with zoom inside the scrolling #canvas-wrap, so a
  // zoom anchor is a document point plus where it should appear in the visible area;
  // after resizing, the wrap is scrolled to put that point back there.
  function canvasViewMetrics() {
    const wrap = document.getElementById('canvas-wrap');
    const wrapRect = wrap.getBoundingClientRect(), elRect = canvas.lowerCanvasEl.getBoundingClientRect();
    return { wrap, rect: wrapRect,
      offsetX: elRect.left - wrapRect.left - wrap.clientLeft + wrap.scrollLeft,
      offsetY: elRect.top - wrapRect.top - wrap.clientTop + wrap.scrollTop };
  }
  function viewCenterAnchor() {
    const m = canvasViewMetrics();
    const view = { x: m.wrap.clientWidth / 2, y: m.wrap.clientHeight / 2 };
    return { view, doc: { x: (m.wrap.scrollLeft + view.x - m.offsetX) / zoomLevel - PAGE_PAD,
      y: (m.wrap.scrollTop + view.y - m.offsetY) / zoomLevel - PAGE_PAD } };
  }
  /** Selection center (brought to the middle of the view) if something is selected, otherwise the cursor (wheel) or the view center (buttons/shortcuts). */
  function zoomAnchor(pointerEvent) {
    if (!documentOpen) return null;
    const active = canvas.getActiveObject();
    const m = canvasViewMetrics();
    if (active) {
      const b = active.getBoundingRect(true, true);
      return { doc: { x: b.left + b.width / 2, y: b.top + b.height / 2 },
        view: { x: m.wrap.clientWidth / 2, y: m.wrap.clientHeight / 2 } };
    }
    if (pointerEvent) {
      const p = canvas.getPointer(pointerEvent);
      return { doc: { x: p.x, y: p.y }, view: { x: pointerEvent.clientX - m.rect.left, y: pointerEvent.clientY - m.rect.top } };
    }
    return viewCenterAnchor();
  }
  function scrollToAnchor(anchor) {
    const m = canvasViewMetrics();
    m.wrap.scrollLeft = m.offsetX + (anchor.doc.x + PAGE_PAD) * zoomLevel - anchor.view.x;
    m.wrap.scrollTop = m.offsetY + (anchor.doc.y + PAGE_PAD) * zoomLevel - anchor.view.y;
  }
  /** Fit the selection in the visible area, centered. */
  function zoomToSelection() {
    const active = canvas.getActiveObject();
    if (!active) { MFC_UI.toast('Select an object to zoom to it.'); return; }
    const b = active.getBoundingRect(true, true), wrap = document.getElementById('canvas-wrap');
    const z = 0.85 * Math.min(wrap.clientWidth / Math.max(1, b.width), wrap.clientHeight / Math.max(1, b.height));
    setZoom(z, { doc: { x: b.left + b.width / 2, y: b.top + b.height / 2 }, view: { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 } });
  }

  function setZoom(z, anchor = null) {
    zoomLevel = Math.min(20, Math.max(0.05, z));
    if (!documentOpen) {
      canvas.setDimensions({ width: Math.max(1, document.getElementById('canvas-wrap').clientWidth),
        height: Math.max(1, document.getElementById('canvas-wrap').clientHeight) });
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      canvas.requestRenderAll();
      updateZoomDisplay();
      return;
    }
    const docPx = docExtent();
    canvas.setZoom(zoomLevel);
    canvas.setWidth((docPx.width + PAGE_PAD * 2) * zoomLevel);
    canvas.setHeight((docPx.height + PAGE_PAD * 2) * zoomLevel);
    // Pan the viewport so doc-space (0,0) lands PAGE_PAD in from the canvas edge,
    // leaving pasteboard margin on every side. The export compositor uses document
    // coordinates directly and clips the generated SVG/PDF/TIFF to the page bounds.
    const vpt = canvas.viewportTransform;
    vpt[4] = PAGE_PAD * zoomLevel;
    vpt[5] = PAGE_PAD * zoomLevel;
    canvas.setViewportTransform(vpt);
    if (anchor) scrollToAnchor(anchor);
    canvas.calcOffset();
    canvas.requestRenderAll();
    updateZoomDisplay();
  }
  function getZoomLevel() { return zoomLevel; }

  function applyDocProps(props) {
    const px = docPropsToPixels(props);
    if (!Number.isFinite(px.width + px.height) || px.width < 1 || px.height < 1 || !(props.dpi > 0))
      throw new Error('Enter a positive width, height, and DPI.');
    docProps = { ...props, pages: pageCount(props) };
    documentOpen = true;
    MFC_UI.updateDocumentState(true);
    setZoom(zoomLevel); // recomputes canvas dimensions from the new docProps at current zoom
    ensurePageRect();
  }

  function closeDocument() {
    documentOpen = false;
    pageRects.forEach(rect => canvas.remove(rect));
    pageRects = [];
    MFC_UI.updateDocumentState(false);
    setZoom(1);
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
    const sourceId = await MFC_PROJECT.registerSource(sourceFile, rawImage);
    registry[id] = { rawImage, sourceId, sourceBlob: sourceFile, workingScale: scale };

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
  // With several images selected, the panel shows the first one and every edit is
  // applied to that same setting on each selected image (channel N of each image);
  // other settings of the other images are left as they were.
  function selectedImages() { return selectedObjects(o => o.mfcType === 'mfcImage' && registry[o.mfcId]); }
  function commitImages(images) {
    images.forEach(img => recomposite(img));
    canvas.fire('object:modified', { target: canvas.getActiveObject() });
  }

  function refreshChannelPanel() {
    const listEl = document.getElementById('channel-list');
    const nameEl = document.getElementById('channel-image-name');
    const images = selectedImages();
    const calibBox = document.getElementById('channel-calibration');
    const alphaBox = document.getElementById('channel-alpha');
    const toneBox = document.getElementById('channel-tone');

    refreshStackControls(images);
    if (!images.length) {
      listEl.innerHTML = '<p class="hint">Select an image to edit its channels.</p>';
      nameEl.textContent = '';
      calibBox.classList.add('hidden');
      alphaBox.classList.add('hidden');
      toneBox.classList.add('hidden');
      return;
    }
    const active = images[0];
    const entry = registry[active.mfcId];
    const raws = images.map(img => registry[img.mfcId].rawImage);
    nameEl.textContent = images.length > 1 ? '— ' + images.length + ' images (edits apply to all)' : '— ' + active.mfcFileName;
    listEl.innerHTML = '';

    calibBox.classList.remove('hidden');
    const pxSizeInput = document.getElementById('ch-pixelsize');
    const sameVoxel = raws.every(r => r.voxelSizeUm === entry.rawImage.voxelSizeUm);
    pxSizeInput.value = sameVoxel && entry.rawImage.voxelSizeUm != null ? entry.rawImage.voxelSizeUm : '';
    pxSizeInput.placeholder = sameVoxel ? 'unset' : 'mixed';
    document.getElementById('ch-pixelsize-hint').textContent = !sameVoxel
      ? 'The selected images have different pixel sizes; a value typed here is applied to all of them.'
      : entry.rawImage.voxelSizeUm != null
        ? 'Used to calibrate scale bars for this image.'
        : 'No pixel size found in this file — enter one manually to enable scale bars for this image.';

    const withAlpha = raws.filter(r => r.hasAlpha);
    alphaBox.classList.toggle('hidden', !withAlpha.length);
    if (withAlpha.length) {
      const alpha = document.getElementById('ch-alpha-toggle');
      alpha.checked = withAlpha[0].alphaEnabled !== false;
      alpha.indeterminate = !withAlpha.every(r => (r.alphaEnabled !== false) === alpha.checked);
    }

    toneBox.classList.remove('hidden');
    document.getElementById('ch-brightness').value = entry.rawImage.brightness || 0;
    document.getElementById('ch-brightness-val').value = entry.rawImage.brightness || 0;
    document.getElementById('ch-contrast').value = entry.rawImage.contrast || 0;
    document.getElementById('ch-contrast-val').value = entry.rawImage.contrast || 0;

    entry.rawImage.channels.forEach((ch, idx) => {
      const row = document.createElement('div');
      row.className = 'channel-row';
      // The same channel number on every selected image that has one.
      const peers = raws.map(r => r.channels[idx]).filter(Boolean);

      const colorOptions = Object.keys(MFC_TIFF.COLOR_PRESETS)
        .map(c => `<option value="${c}" ${c === ch.color ? 'selected' : ''}>${c}</option>`).join('');

      row.innerHTML = `
        <div class="row-top">
          <input type="checkbox" class="ch-toggle" ${ch.enabled ? 'checked' : ''}>
          <span class="ch-name"></span>
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
      row.querySelector('.ch-name').textContent = ch.name + (peers.length > 1 ? ' ×' + peers.length : '');
      const toggle = row.querySelector('.ch-toggle');
      toggle.indeterminate = !peers.every(p => !!p.enabled === !!ch.enabled);
      if (peers.length > 1 && !peers.every(p => p.color === ch.color)) row.querySelector('.ch-color').title = 'Colors differ between the selected images';
      listEl.appendChild(row);

      const rangeCeil = ch.bitDepth > 8 ? 65535 : 255;
      const minSlider = row.querySelector('.ch-min'), maxSlider = row.querySelector('.ch-max');
      const minInput = row.querySelector('.ch-min-val'), maxInput = row.querySelector('.ch-max-val');
      [minSlider, maxSlider, minInput, maxInput].forEach(el => el.max = rangeCeil);

      toggle.addEventListener('change', (e) => {
        peers.forEach(p => { p.enabled = e.target.checked; });
        commitImages(images);
      });
      row.querySelector('.ch-color').addEventListener('change', (e) => {
        peers.forEach(p => { p.color = e.target.value; });
        row.querySelector('.swatch').style.background = swatchColor(e.target.value);
        commitImages(images);
      });

      // Slider <-> number input stay in sync in both directions; both funnel through
      // commitMin/commitMax so range validation (min < max, clamped to each channel's
      // range) always applies no matter which control the user touched.
      function commitMin(v) {
        if (!isFinite(v)) v = ch.min; // invalid input handled gracefully: keep previous value
        peers.forEach(p => { p.min = Math.min(Math.max(v, 0), p.max - 1); });
        minSlider.value = ch.min;
        minInput.value = Math.round(ch.min);
      }
      function commitMax(v) {
        if (!isFinite(v)) v = ch.max;
        peers.forEach(p => { p.max = Math.max(Math.min(v, p.bitDepth > 8 ? 65535 : 255), p.min + 1); });
        maxSlider.value = ch.max;
        maxInput.value = Math.round(ch.max);
      }
      const recompositeAll = () => images.forEach(img => recomposite(img));

      minSlider.addEventListener('input', (e) => { commitMin(parseFloat(e.target.value)); recompositeAll(); });
      maxSlider.addEventListener('input', (e) => { commitMax(parseFloat(e.target.value)); recompositeAll(); });
      minSlider.addEventListener('change', () => canvas.fire('object:modified', { target: canvas.getActiveObject() }));
      maxSlider.addEventListener('change', () => canvas.fire('object:modified', { target: canvas.getActiveObject() }));

      // "change" fires on blur, and also right after Enter's explicit blur() below — this
      // is how typed values get confirmed (Enter, Tab, or clicking elsewhere all commit).
      minInput.addEventListener('change', (e) => { commitMin(parseFloat(e.target.value)); commitImages(images); });
      maxInput.addEventListener('change', (e) => { commitMax(parseFloat(e.target.value)); commitImages(images); });
      minInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); minInput.blur(); } });
      maxInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); maxInput.blur(); } });
    });
  }

  /** Z / time controls: shown when a selected image is a Z stack or time series. */
  function refreshStackControls(images) {
    const box = document.getElementById('channel-stack');
    const stacked = images.map(img => registry[img.mfcId].rawImage).filter(r => r.stack);
    box.classList.toggle('hidden', !stacked.length);
    if (!stacked.length) return;
    const raw = stacked[0], st = raw.stack;
    const maxZ = Math.max(...stacked.map(r => r.stack.sizeZ)), maxT = Math.max(...stacked.map(r => r.stack.sizeT));
    const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
    document.getElementById('ch-stack-info').textContent = stacked.length > 1
      ? stacked.length + ' selected images are Z stacks or time series; changes apply to all of them.'
      : plural(st.sizeC, 'channel') + ' × ' + plural(st.sizeZ, 'Z slice') + (st.sizeT > 1 ? ' × ' + plural(st.sizeT, 'time frame') : '') +
        (st.sizeZ > 1 && st.zStepUm ? ' (Z step ' + st.zStepUm + ' µm)' : '') + '.';
    const zModeRow = document.getElementById('ch-zmode-row');
    zModeRow.classList.toggle('hidden', maxZ < 2);
    const zMode = document.getElementById('ch-zmode');
    zMode.value = raw.zMode;
    zMode.title = stacked.every(r => r.zMode === raw.zMode) ? '' : 'The selected images use different Z displays';
    const setRange = (id, value, max, show) => {
      document.getElementById(id + '-row').classList.toggle('hidden', !show);
      [document.getElementById(id), document.getElementById(id + '-val')].forEach(el => { el.max = max; el.value = value + 1; });
    };
    setRange('ch-zslice', raw.zIndex, maxZ, maxZ > 1 && stacked.some(r => r.zMode === 'slice'));
    setRange('ch-tframe', raw.tIndex, maxT, maxT > 1);
  }

  /**
   * Choose the Z display (projection or slice) and time frame of the selected stacks.
   * `commit` records an undo step; without it (slider dragging) only the preview updates.
   */
  function applyStackPlane(change, commit) {
    const images = selectedImages().filter(img => registry[img.mfcId].rawImage.stack);
    if (!images.length) return;
    images.forEach(img => {
      const raw = registry[img.mfcId].rawImage;
      if (change.zMode) raw.zMode = change.zMode;
      if (Number.isFinite(change.zIndex) && raw.stack.sizeZ > 1) { raw.zIndex = change.zIndex; raw.zMode = 'slice'; }
      if (Number.isFinite(change.tIndex)) raw.tIndex = change.tIndex;
      MFC_TIFF.selectPlane(raw);
      recomposite(img);
    });
    refreshStackControls(images);
    if (commit) canvas.fire('object:modified', { target: canvas.getActiveObject() });
    else canvas.requestRenderAll();
  }

  /** Manually set (or clear) the physical pixel size of the selected image(s) — the only way to calibrate scale bars for formats (JPEG/PNG/BMP) or TIFFs that carry no resolution metadata. */
  function applyPixelSize(value) {
    const images = selectedImages();
    if (!images.length) return;
    const v = parseFloat(value);
    images.forEach(img => {
      registry[img.mfcId].rawImage.voxelSizeUm = (isFinite(v) && v > 0) ? v : null;
      updateScaleBarsForImage(img);
    });
    refreshChannelPanel();
    canvas.fire('object:modified', { target: canvas.getActiveObject() });
  }

  function applyAlphaToggle(enabled) {
    const images = selectedImages().filter(img => registry[img.mfcId].rawImage.hasAlpha);
    if (!images.length) return;
    images.forEach(img => { registry[img.mfcId].rawImage.alphaEnabled = !!enabled; });
    commitImages(images);
  }

  /** Applies the panel's current brightness/contrast values to the selected image(s)' whole composite (see compositeChannels' tone-curve pass — works the same for RGB imports and TIFF composites alike). */
  function applyBrightnessContrast(brightness, contrast) {
    const images = selectedImages();
    if (!images.length) return;
    const clamp = v => Math.max(-100, Math.min(100, v));
    const b = isFinite(brightness) ? clamp(brightness) : 0, c = isFinite(contrast) ? clamp(contrast) : 0;
    // Only the value that changed (relative to the image shown in the panel) is copied
    // to the other selected images, so moving brightness keeps each image's contrast.
    const shown = registry[images[0].mfcId].rawImage;
    const setBrightness = b !== (shown.brightness || 0) || images.length === 1;
    const setContrast = c !== (shown.contrast || 0) || images.length === 1;
    images.forEach(img => {
      const raw = registry[img.mfcId].rawImage;
      if (setBrightness) raw.brightness = b;
      if (setContrast) raw.contrast = c;
      recomposite(img);
    });
    document.getElementById('ch-brightness').value = b;
    document.getElementById('ch-brightness-val').value = b;
    document.getElementById('ch-contrast').value = c;
    document.getElementById('ch-contrast-val').value = c;
  }

  function commitBrightnessContrast() {
    canvas.fire('object:modified', { target: canvas.getActiveObject() });
  }

  function resetToneCurve() {
    selectedImages().forEach(img => { const raw = registry[img.mfcId].rawImage; raw.brightness = 0; raw.contrast = 0; });
    applyBrightnessContrast(0, 0);
    commitBrightnessContrast();
  }

  function swatchColor(name) {
    const [r, g, b] = MFC_TIFF.COLOR_PRESETS[name];
    return `rgb(${r * 255},${g * 255},${b * 255})`;
  }

  function onSelectionChanged() {
    const activeObject=canvas.getActiveObject();
    canvas.getObjects().filter(object=>object.__mfcNodeEdit&&object!==activeObject).forEach(path=>{
      path.__mfcNodeEdit=false;path.controls=path.__mfcStandardControls||fabric.Object.prototype.controls;
      path.hasBorders=true;applyLockState(path);path.setCoords();
    });
    applySelectionLock();
    refreshChannelPanel();
    refreshSelectionBar();
    refreshTextPanel();
    refreshScaleBarRefList();
    refreshScaleBarPanel();
    refreshScaleBarPreview();
    refreshShapePanel();
    refreshPathPanel();
    refreshInsetPanel();
    refreshLayersPanel();
    MFC_UI.focusSelection(activeObject, currentTool);
  }

  // ---- locks ----
  // Layer lock (mfcLocked) blocks everything: the object is not selectable, not
  // targetable by the mouse, and not editable. Position/size lock (mfcPositionLocked)
  // keeps the object selectable and editable (channels, colors, text, styles) but
  // blocks moving, scaling, rotating and skewing. Every code path derives Fabric's
  // flags from these two properties through applyLockState, including tool switches,
  // project loading, undo/redo and paste.
  function isTransformLocked(o) {
    if (!o) return false;
    if (o.type === 'activeSelection') return o.getObjects().some(isTransformLocked);
    return !!(o.mfcLocked || o.mfcPositionLocked);
  }
  function selectionToolActive() { return currentTool === 'select' || currentTool === 'scalebar'; }
  function applyLockState(o) {
    if (!o || isHelper(o)) return;
    const full = !!o.mfcLocked, fixed = full || !!o.mfcPositionLocked;
    const move = fixed || !!o.__mfcNodeEdit;
    o.set({ lockMovementX: move, lockMovementY: move, lockScalingX: fixed, lockScalingY: fixed,
      lockRotation: fixed, lockSkewingX: fixed, lockSkewingY: fixed, hasControls: !fixed || !!o.__mfcNodeEdit });
    o.selectable = !full && selectionToolActive();
    o.evented = !full;
    if (o.type === 'textbox') o.editable = !full;
    o.hoverCursor = fixed ? 'pointer' : null;
  }
  /** A multi-selection containing any locked object cannot be dragged, scaled or rotated as a whole. */
  function applySelectionLock() {
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'activeSelection') return;
    const fixed = isTransformLocked(active);
    active.set({ lockMovementX: fixed, lockMovementY: fixed, lockScalingX: fixed, lockScalingY: fixed,
      lockRotation: fixed, lockSkewingX: fixed, lockSkewingY: fixed, hasControls: !fixed });
  }
  function refuseLocked(o, what = 'moved, resized or rotated') {
    if (!isTransformLocked(o)) return false;
    MFC_UI.toast('Position/size is locked — unlock it to have it ' + what + '.');
    return true;
  }
  function setPositionLock(o, locked) {
    if (locked && o.__mfcNodeEdit) exitPathEdit(o);
    o.mfcPositionLocked = !!locked;
    applyLockState(o);
  }
  function togglePositionLockSelection() {
    const objs = canvas.getActiveObjects();
    if (!objs.length) return;
    const lock = !objs.every(o => o.mfcPositionLocked);
    objs.forEach(o => setPositionLock(o, lock));
    applySelectionLock();
    canvas.requestRenderAll();
    refreshSelectionBar(); refreshLayersPanel();
    pushHistory();
  }

  // ---- selection bar (contextual sub-bar under the top bar): position, size, rotation,
  // position lock and alignment for whatever is selected. Its height never changes. ----
  /** Width/height a user means by "size": the box itself for text boxes and inset outlines (no stroke), the drawn extent otherwise. */
  function objectSize(o) {
    if (o.type === 'textbox' || o.mfcType === 'insetContour')
      return { width: o.width * Math.abs(o.scaleX || 1), height: o.height * Math.abs(o.scaleY || 1) };
    return { width: o.getScaledWidth(), height: o.getScaledHeight() };
  }
  function setFieldValue(id, value, disabled) {
    const el = document.getElementById(id);
    if (document.activeElement !== el) el.value = value;
    el.disabled = !!disabled;
  }
  function refreshSelectionBar() {
    const label = document.getElementById('sel-label');
    if (!label) return;
    const active = canvas.getActiveObject();
    const transform = document.getElementById('sel-transform'), alignGroup = document.getElementById('sel-align');
    const note = document.getElementById('sel-lock-note');
    const objs = canvas.getActiveObjects();
    if (!active || active === cropRect) {
      label.textContent = active && active === cropRect ? 'Crop region — use the Crop panel' : 'Nothing selected';
      transform.classList.add('hidden'); alignGroup.classList.add('hidden'); note.classList.add('hidden');
      return;
    }
    const multi = active.type === 'activeSelection';
    const locked = isTransformLocked(active);
    label.textContent = multi ? objs.length + ' objects selected' : layerLabel(active);
    label.title = label.textContent;
    transform.classList.remove('hidden');
    alignGroup.classList.toggle('hidden', objs.length < 2);
    const box = active.getBoundingRect(true, true), size = multi ? box : objectSize(active);
    setFieldValue('obj-x', Math.round(box.left), locked);
    setFieldValue('obj-y', Math.round(box.top), locked);
    setFieldValue('obj-width', Math.round(size.width), locked || multi);
    setFieldValue('obj-height', Math.round(size.height), locked || multi);
    setFieldValue('obj-angle', multi ? '' : Math.round(active.angle || 0), locked || multi);
    document.getElementById('obj-lock-aspect').disabled = locked || multi || active.type === 'textbox';
    document.getElementById('obj-rotate-ccw').disabled = locked || multi;
    document.getElementById('obj-rotate-cw').disabled = locked || multi;
    const allPositionLocked = objs.length > 0 && objs.every(o => o.mfcPositionLocked);
    const lockBtn = document.getElementById('obj-position-lock');
    lockBtn.classList.toggle('active', allPositionLocked);
    lockBtn.setAttribute('aria-pressed', String(allPositionLocked));
    lockBtn.innerHTML = (allPositionLocked ? LAYER_ICONS.lock : LAYER_ICONS.unlock) + (allPositionLocked ? ' Position locked' : ' Lock position');
    note.classList.toggle('hidden', !locked || allPositionLocked);
    note.textContent = locked ? 'Contains position-locked objects' : '';
    document.getElementById('obj-release-clip').classList.toggle('hidden', multi || !active.clipPath);
    document.getElementById('obj-release-clip').disabled = locked;
    document.getElementById('btn-crop-shape').classList.toggle('hidden', !cropToShapePair());
    const uncropBtn = document.getElementById('obj-uncrop');
    uncropBtn.classList.toggle('hidden', multi || !isCropped(active));
    uncropBtn.disabled = locked;
  }
  // Kept for callers/tests written against the former right-hand size panel.
  const refreshObjectSizePanel = refreshSelectionBar;

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
    if (!isCropped(img) || refuseLocked(img, 'resized')) return;
    const entry = registry[img.mfcId];
    const fullW = Math.max(1, Math.round(entry.rawImage.width * entry.workingScale));
    const fullH = Math.max(1, Math.round(entry.rawImage.height * entry.workingScale));
    const cx = img.cropX || 0, cy = img.cropY || 0;
    const before = { cropX: cx, cropY: cy, width: img.width, height: img.height };
    img.set({
      left: img.left - cx * img.scaleX,
      top: img.top - cy * img.scaleY,
      cropX: 0, cropY: 0,
      width: fullW, height: fullH
    });
    keepClipOnContent(img, before);
    img.setCoords();
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: img });
    updateScaleBarsForImage(img);
    followSourceImage(img);
    refreshSelectionBar();
  }

  /** Rotate the selected object by a relative amount (e.g. ±90°), wrapped to 0-359. */
  function rotateSelected(deltaDeg) {
    const active = canvas.getActiveObject();
    if (!active || active.type === 'activeSelection' || refuseLocked(active, 'rotated')) return;
    let a = ((active.angle || 0) + deltaDeg) % 360;
    if (a < 0) a += 360;
    const center = active.getCenterPoint();
    active.set('angle', a);
    active.setPositionByOrigin(center, 'center', 'center');
    active.setCoords();
    canvas.requestRenderAll();
    if (active.mfcType === 'mfcImage') syncAttachments(active);
    canvas.fire('object:modified', { target: active });
  }

  function setObjectAngle(deg) {
    const active = canvas.getActiveObject();
    if (!active || active.type === 'activeSelection' || refuseLocked(active, 'rotated')) { refreshSelectionBar(); return; }
    const center = active.getCenterPoint();
    active.set('angle', ((deg % 360) + 360) % 360);
    active.setPositionByOrigin(center, 'center', 'center');
    active.setCoords();
    canvas.requestRenderAll();
    if (active.mfcType === 'mfcImage') syncAttachments(active);
    canvas.fire('object:modified', { target: active });
  }

  /** W/H fields: text boxes resize their box only (font size untouched); everything else is scaled. */
  function applyObjectSizeFromFields(changed = 'width') {
    const active = canvas.getActiveObject();
    if (!active || active.type === 'activeSelection') return;
    if (refuseLocked(active, 'resized')) { refreshSelectionBar(); return; }
    const w = parseFloat(document.getElementById('obj-width').value);
    const h = parseFloat(document.getElementById('obj-height').value);
    if (!(w > 0) || !(h > 0)) { refreshSelectionBar(); return; }
    if (active.type === 'textbox') { applyTextBoxSize(changed, changed === 'height' ? h : w); return; }

    const current = objectSize(active);
    let targetW = w, targetH = h;
    if (document.getElementById('obj-lock-aspect').checked) {
      const ratio = current.width / current.height;
      if (changed === 'height') targetW = h * ratio; else targetH = w / ratio;
    }
    // Keep the top-left of the bounding box where it was.
    const before = active.getBoundingRect(true, true);
    active.set({ scaleX: active.scaleX * targetW / current.width, scaleY: active.scaleY * targetH / current.height });
    active.setCoords();
    const after = active.getBoundingRect(true, true);
    active.set({ left: active.left + before.left - after.left, top: active.top + before.top - after.top });
    active.setCoords();
    if (active.mfcType === 'insetContour') syncInsetFromContour(active);
    if (active.mfcType === 'mfcImage') syncAttachments(active);
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
  }

  /** X/Y fields move the selection's bounding box to the typed document coordinates. */
  function applyObjectPositionFromFields() {
    const active = canvas.getActiveObject();
    if (!active) return;
    if (refuseLocked(active, 'moved')) { refreshSelectionBar(); return; }
    const x = parseFloat(document.getElementById('obj-x').value), y = parseFloat(document.getElementById('obj-y').value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { refreshSelectionBar(); return; }
    const box = active.getBoundingRect(true, true);
    active.set({ left: active.left + x - box.left, top: active.top + y - box.top });
    active.setCoords();
    const moved = active.type === 'activeSelection' ? active.getObjects() : [active];
    moved.forEach(o => { if (o.mfcType === 'mfcImage') syncAttachments(o); if (o.mfcType === 'insetContour') syncInsetFromContour(o); });
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
  }

  // ---- text panel (re-populates whenever a text box is selected/reselected) ----
  function refreshTextPanel() {
    const panel = document.getElementById('panel-text');
    const boxes = getSelectedTextboxes();
    panel.classList.toggle('hidden', !(boxes.length || currentTool === 'text'));
    if (!boxes.length) return;
    const active = boxes[0]; // representative values shown when multiple are selected — edits still apply to every selected box, see applyTextStyle/applyTextBorder/applyTextAlign

    document.getElementById('text-font').value = active.fontFamily || 'Arial';
    const sizeField = document.getElementById('text-size');
    if (document.activeElement !== sizeField) sizeField.value = Math.round(effectiveFontSize(active));
    document.getElementById('text-color').value = /^#/.test(active.fill) ? active.fill : '#000000';
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
    ['top', 'middle', 'bottom'].forEach(a =>
      document.getElementById('text-valign-' + a).classList.toggle('active', (active.mfcVAlign || 'top') === a));
  }

  /** The size the glyphs are actually drawn at: the style under the caret/selection while editing, else the box fontSize, times any not-yet-normalized scale (projects from earlier versions may still carry one). */
  function effectiveFontSize(box) {
    let size = box.fontSize || 24;
    if (box.isEditing && box.getSelectionStyles) {
      const style = box.getSelectionStyles(box.selectionStart, box.selectionStart + 1)[0];
      if (style && style.fontSize) size = style.fontSize;
    }
    return size * Math.abs(box.scaleY || 1);
  }

  /** Folds a text box's scale into fontSize (and character styles), width and box height, leaving scale at 1. Returns whether anything changed. */
  function normalizeTextScale(box) {
    const sx = Math.abs(box.scaleX || 1), sy = Math.abs(box.scaleY || 1);
    if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) return false;
    Object.values(box.styles || {}).forEach(line => Object.values(line).forEach(style => {
      if (style.fontSize) style.fontSize = Math.max(1, style.fontSize * sy);
    }));
    const boxHeight = box.mfcBoxHeight ? box.mfcBoxHeight * sy : null;
    box.set({ fontSize: Math.max(1, Math.round(box.fontSize * sy)), width: Math.max(10, box.width * sx),
      scaleX: 1, scaleY: 1 });
    if (boxHeight) box.set('mfcBoxHeight', boxHeight);
    box.initDimensions();
    box.setCoords();
    return true;
  }

  /** Resizes the text box only — the font size never changes. Height sets a minimum box height; the box still grows to fit its text. */
  function applyTextBoxSize(prop, value) {
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'textbox' || !(value > 0)) return;
    if (refuseLocked(active, 'resized')) { refreshSelectionBar(); return; }
    normalizeTextScale(active);
    if (prop === 'width') active.set({ width: Math.max(10, value) });
    else if (prop === 'height') active.set('mfcBoxHeight', value);
    active.setCoords();
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
    refreshTextPanel();
  }

  function applyTextVerticalAlign(align) {
    const boxes = getSelectedTextboxes();
    if (!boxes.length) return;
    boxes.forEach(box => { box.mfcVAlign = align; box.dirty = true; });
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: canvas.getActiveObject() });
    refreshTextPanel();
  }

  /** Centers the text both ways inside its box (C1). */
  function centerTextInBox() {
    const boxes = getSelectedTextboxes();
    if (!boxes.length) return;
    boxes.forEach(box => { if (box.isEditing) box.exitEditing(); box.set('textAlign', 'center'); box.mfcVAlign = 'middle'; box.dirty = true; });
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: canvas.getActiveObject() });
    refreshTextPanel();
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
    if (refuseLocked(active, 'cropped')) return;
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
    const before = { cropX: img.cropX || 0, cropY: img.cropY || 0, width: img.width, height: img.height };

    img.set({
      cropX: Math.max(0, localLeft),
      cropY: Math.max(0, localTop),
      width: Math.min(img.width - Math.max(0, localLeft), w / img.scaleX),
      height: Math.min(img.height - Math.max(0, localTop), h / img.scaleY),
      left: cropRect.left, top: cropRect.top
    });
    keepClipOnContent(img, before);
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
      refreshTextPanel();
    });
    t.on('changed', () => refreshSelectionBar());
    if (t.mfcBoxHeight) { t.initDimensions(); t.setCoords(); }
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

  // ---- text box geometry: a real box whose size is independent of the font size ----
  // mfcBoxHeight is a minimum box height (the box still grows to fit its text) and
  // mfcVAlign ('top' | 'middle' | 'bottom') places the text block inside it. Both are
  // optional, so projects saved before they existed load and render unchanged.
  const TextboxProto = fabric.Textbox.prototype;
  TextboxProto._dimensionAffectingProps = TextboxProto._dimensionAffectingProps.concat(['mfcBoxHeight']);
  const baseTextboxInitDimensions = TextboxProto.initDimensions;
  TextboxProto.initDimensions = function () {
    if (this.__skipDimension) return;
    baseTextboxInitDimensions.call(this);
    this._mfcTextHeight = this.height;
    if (this.mfcBoxHeight > this.height) this.height = this.mfcBoxHeight;
  };
  TextboxProto._mfcVerticalOffset = function () {
    const extra = this.height - (this._mfcTextHeight ?? this.height);
    return extra > 0 ? extra * ({ middle: 0.5, bottom: 1 }[this.mfcVAlign] || 0) : 0;
  };
  // Text drawing, decorations, the editing caret and selection all start from _getTopOffset.
  TextboxProto._getTopOffset = function () { return -this.height / 2 + this._mfcVerticalOffset(); };
  // SVG (and therefore PDF) export: the background still covers the whole box, the lines start at the offset.
  TextboxProto._getSVGLeftTopOffsets = function () {
    return { textLeft: -this.width / 2, textTop: this._getTopOffset(), lineTop: this.getHeightOfLine(0) };
  };
  const baseSelectionFromPointer = TextboxProto.getSelectionStartFromPointer;
  TextboxProto.getSelectionStartFromPointer = function (e) {
    const offset = this._mfcVerticalOffset();
    if (!offset) return baseSelectionFromPointer.call(this, e);
    const localPointer = this.getLocalPointer;
    this.getLocalPointer = function (...args) { const p = localPointer.apply(this, args); p.y -= offset * this.scaleY; return p; };
    try { return baseSelectionFromPointer.call(this, e); } finally { delete this.getLocalPointer; }
  };
  // Top/bottom handles resize the box height (like the side handles already resize its
  // width); only the corner handles scale the text itself.
  function changeTextBoxHeight(eventData, transform, x, y) {
    const target = transform.target;
    const localPoint = fabric.controlsUtils.getLocalPoint(transform, transform.originX, transform.originY, x, y);
    const multiplier = transform.originX === 'center' && transform.originY === 'center' ? 2 : 1;
    const oldHeight = target.height;
    target.set('mfcBoxHeight', Math.max(1, Math.abs(localPoint.y * multiplier / (target.scaleY || 1))));
    return target.height !== oldHeight;
  }
  const textBoxHeightHandler = fabric.controlsUtils.wrapWithFireEvent('resizing',
    fabric.controlsUtils.wrapWithFixedAnchor(changeTextBoxHeight));
  TextboxProto.controls = { ...TextboxProto.controls,
    mt: new fabric.Control({ x: 0, y: -0.5, actionHandler: textBoxHeightHandler,
      cursorStyleHandler: fabric.controlsUtils.scaleSkewCursorStyleHandler, actionName: 'resizing' }),
    mb: new fabric.Control({ x: 0, y: 0.5, actionHandler: textBoxHeightHandler,
      cursorStyleHandler: fabric.controlsUtils.scaleSkewCursorStyleHandler, actionName: 'resizing' }) };

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

  /** Selected objects matching pred: the active object itself, or the matching members of a multi-selection. */
  function selectedObjects(pred = () => true) {
    const active = canvas && canvas.getActiveObject();
    if (!active) return [];
    return (active.type === 'activeSelection' ? active.getObjects() : [active]).filter(pred);
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
    if (!documentOpen) return;
    if (currentTool === 'path') {
      beginPathPointer(canvas.getPointer(opt.e), opt.e);
      return;
    }
    // Shapes and labels are usually drawn over images: only an existing text box
    // (clicked to edit it) stops the Text tool, and nothing stops the Shape tool.
    if (currentTool === 'text' && !(opt.target && opt.target.type === 'textbox')) {
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
    } else if (currentTool === 'shape') {
      startShapeDrag(canvas.getPointer(opt.e), opt.e);
    } else if (currentTool === 'inset' && opt.target && opt.target.mfcType === 'mfcImage') {
      if (document.getElementById('inset-fixed-size').checked) placeFixedInsetContour(canvas.getPointer(opt.e), opt.target);
      else startInsetDrag(canvas.getPointer(opt.e), opt.target);
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

  // ---- exact-size insets: the size fields double as "same size as last inset" memory ----
  const INSET_PREFS_KEY = 'fluoforge-inset-size';
  function loadInsetSizePreferences() {
    let prefs = null;
    try { prefs = JSON.parse(localStorage.getItem(INSET_PREFS_KEY) || 'null'); } catch (_) { /* Preferences are optional. */ }
    if (!prefs) return;
    document.getElementById('inset-fixed-size').checked = !!prefs.fixed;
    if (prefs.width > 0) document.getElementById('inset-fixed-w').value = prefs.width;
    if (prefs.height > 0) document.getElementById('inset-fixed-h').value = prefs.height;
    if (prefs.magnification > 0) document.getElementById('inset-magnification').value = prefs.magnification;
  }
  function saveInsetSizePreferences() {
    const size = readInsetFixedSize();
    try { localStorage.setItem(INSET_PREFS_KEY, JSON.stringify({ fixed: document.getElementById('inset-fixed-size').checked,
      width: size.width, height: size.height, magnification: readInsetMagnification() })); } catch (_) { /* Preferences are optional. */ }
  }
  function readInsetFixedSize() {
    return { width: Math.max(2, parseFloat(document.getElementById('inset-fixed-w').value) || 100),
      height: Math.max(2, parseFloat(document.getElementById('inset-fixed-h').value) || 100) };
  }
  function readInsetMagnification() { return Math.max(0.05, parseFloat(document.getElementById('inset-magnification').value) || 1); }
  function rememberInsetSize(width, height) {
    document.getElementById('inset-fixed-w').value = Math.round(width * 100) / 100;
    document.getElementById('inset-fixed-h').value = Math.round(height * 100) / 100;
    saveInsetSizePreferences();
  }

  function makeInsetContour(left, top, width, height, sourceImg) {
    const style = readInsetContourFormValues();
    const rect = new fabric.Rect({
      left, top, width, height,
      fill: 'transparent', stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDashArray: style.strokeDashArray,
      strokeUniform: true,
      cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
    });
    rect.mfcId = 'ins' + (nextId++);
    rect.mfcType = 'insetContour';
    rect.mfcInsetSourceId = sourceImg.mfcId;
    canvas.add(rect);
    return rect;
  }

  function startInsetDrag(pointer, sourceImg) {
    const rect = makeInsetContour(pointer.x, pointer.y, 1, 1, sourceImg);
    insetDrag = { rect, startX: pointer.x, startY: pointer.y };
  }

  /** Places an outline of exactly the typed size, centered on the click and kept inside the image where possible. */
  function placeFixedInsetContour(pointer, sourceImg) {
    const { width, height } = readInsetFixedSize();
    const b = canvasBounds(sourceImg);
    const clamp = (v, min, max) => max < min ? min : Math.min(Math.max(v, min), max);
    const left = clamp(pointer.x - width / 2, b.left, b.left + b.width - width);
    const top = clamp(pointer.y - height / 2, b.top, b.top + b.height - height);
    finishInsetContour(makeInsetContour(left, top, width, height, sourceImg));
  }

  function finishInsetContour(rect) {
    applyLockState(rect);
    canvas.setActiveObject(rect);
    syncInsetFromContour(rect); // establishes mfcRelX/Y/W/H immediately, so followSourceImage works even before "Create inset" is pressed
    rememberInsetSize(rect.width * rect.scaleX, rect.height * rect.scaleY);
    canvas.requestRenderAll();
    pushHistory();
    refreshInsetPanel();
    setTool('select');
  }

  /** Gives the selected outline exactly the typed size, keeping its center. */
  function applyExactSizeToSelectedContour() {
    const active = canvas.getActiveObject();
    if (!active || active.mfcType !== 'insetContour' || refuseLocked(active, 'resized')) return;
    const { width, height } = readInsetFixedSize();
    const center = active.getCenterPoint();
    active.set({ width, height, scaleX: 1, scaleY: 1 });
    active.setPositionByOrigin(center, 'center', 'center');
    active.setCoords();
    syncInsetFromContour(active);
    saveInsetSizePreferences();
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: active });
  }

  const INSET_FIELD_PROPS = { 'inset-stroke-color': 'stroke', 'inset-stroke-width': 'strokeWidth', 'inset-dash': 'strokeDashArray' };
  /** Live-apply the changed outline setting (or all of them) to the selected inset outline(s). */
  function applyInsetContourStyle(field) {
    const contours = selectedObjects(o => o.mfcType === 'insetContour');
    if (!contours.length) return;
    const style = readInsetContourFormValues();
    const keys = INSET_FIELD_PROPS[field] ? [INSET_FIELD_PROPS[field]] : Object.keys(style);
    contours.forEach(contour => keys.forEach(key => contour.set(key, style[key])));
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: canvas.getActiveObject() });
  }

  function refreshInsetPanel() {
    const contours = selectedObjects(o => o.mfcType === 'insetContour');
    const active = contours[0];
    const isContour = !!active;
    const single = isContour && active === canvas.getActiveObject();
    const panel = document.getElementById('panel-inset');
    if (!panel) return;
    panel.classList.toggle('hidden', !(isContour || currentTool === 'inset'));
    document.getElementById('inset-apply-size').classList.toggle('hidden', !single);
    const btn = document.getElementById('inset-create');
    if (btn) {
      btn.classList.toggle('hidden', !single);
      if (isContour) btn.textContent = active.mfcInsetTargetId ? 'Update linked inset now' : 'Create inset';
    }
    if (!insetDrag) updateInsetReadout(isContour ? active : null);
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

    // The contour stores its source region in source-image pixel coordinates.
    syncInsetFromContour(contourRect);
    const srcBox = canvasBounds(srcImg);
    const cropX = contourRect.mfcCropX, cropY = contourRect.mfcCropY;
    const cropW = contourRect.mfcCropW, cropH = contourRect.mfcCropH;
    const magnification = readInsetMagnification();
    const w = cropW * srcBox.width / srcImg.width * magnification;
    const h = cropH * srcBox.height / srcImg.height * magnification;

    let insetImg = contourRect.mfcInsetTargetId
      ? canvas.getObjects().find(o => o.mfcId === contourRect.mfcInsetTargetId) : null;

    if (insetImg) {
      // Already linked — "Create inset" becomes "update now" (same effect as a
      // move/resize sync, just triggered manually).
      const displayW = insetImg.getScaledWidth(), displayH = insetImg.getScaledHeight();
      insetImg.set({ cropX, cropY, width: cropW, height: cropH,
        scaleX: displayW/cropW, scaleY: displayH/cropH });
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
    registry[insetId] = { rawImage: clonedRaw, sourceId: entry.sourceId, sourceBlob: entry.sourceBlob, workingScale: entry.workingScale };
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

  // Canvas bounds include an ActiveSelection's transform; child left/top alone do not.
  function canvasCorners(obj) {
    const m = obj.calcTransformMatrix();
    return [[-obj.width/2,-obj.height/2],[obj.width/2,-obj.height/2],
      [obj.width/2,obj.height/2],[-obj.width/2,obj.height/2]]
      .map(([x,y]) => fabric.util.transformPoint(new fabric.Point(x,y), m));
  }

  function canvasBounds(obj) {
    const corners = canvasCorners(obj);
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    return { left: Math.min(...xs), top: Math.min(...ys),
      width: Math.max(...xs)-Math.min(...xs), height: Math.max(...ys)-Math.min(...ys) };
  }

  /** The part of the source image (its displayed, cropped frame) that an outline covers, clamped to the image. */
  function contourSourceRegion(contour, src) {
    const inverse = fabric.util.invertTransform(src.calcTransformMatrix());
    const local = canvasCorners(contour).map(pt => fabric.util.transformPoint(pt, inverse));
    const xs = local.map(pt => pt.x + src.width/2);
    const ys = local.map(pt => pt.y + src.height/2);
    const left = Math.max(0, Math.min(...xs)), top = Math.max(0, Math.min(...ys));
    return { left, top, right: Math.min(src.width, Math.max(...xs)), bottom: Math.min(src.height, Math.max(...ys)) };
  }

  /** Live size of an outline (while drawing, resizing or selected) shown in the Inset panel. */
  function updateInsetReadout(contour) {
    const el = document.getElementById('inset-size-readout');
    if (!el) return;
    if (!contour) { el.textContent = 'Draw on an image: the outline size appears here while you drag.'; el.classList.remove('active'); return; }
    const round = n => Math.round(n * 10) / 10;
    const w = contour.width * Math.abs(contour.scaleX || 1), h = contour.height * Math.abs(contour.scaleY || 1);
    let text = `Outline ${round(w)} × ${round(h)} px on the page`;
    const src = canvas.getObjects().find(o => o.mfcId === contour.mfcInsetSourceId), entry = src && registry[src.mfcId];
    if (src && entry) {
      const r = contourSourceRegion(contour, src);
      const nw = Math.max(0, r.right - r.left) / entry.workingScale, nh = Math.max(0, r.bottom - r.top) / entry.workingScale;
      text += ` · ${Math.round(nw)} × ${Math.round(nh)} px of the source image`;
      const voxel = entry.rawImage.voxelSizeUm;
      if (voxel) text += ` · ${round(nw * voxel)} × ${round(nh * voxel)} µm`;
    }
    el.textContent = text;
    el.classList.add('active');
  }

  function syncInsetFromContour(contour) {
    const src = canvas.getObjects().find(o => o.mfcId === contour.mfcInsetSourceId);
    if (!src) return;
    const { left, top, right, bottom } = contourSourceRegion(contour, src);
    contour.mfcCropX = src.cropX + left;
    contour.mfcCropY = src.cropY + top;
    contour.mfcCropW = Math.max(1, right-left);
    contour.mfcCropH = Math.max(1, bottom-top);
    contour.mfcRelX = left/src.width;
    contour.mfcRelY = top/src.height;
    contour.mfcRelW = contour.mfcCropW/src.width;
    contour.mfcRelH = contour.mfcCropH/src.height;
    canvas.getObjects().filter(o => o.mfcIsInset && o.mfcInsetContourId === contour.mfcId).forEach(inset => {
      const displayW = inset.getScaledWidth(), displayH = inset.getScaledHeight();
      inset.set({ cropX: contour.mfcCropX, cropY: contour.mfcCropY,
        width: contour.mfcCropW, height: contour.mfcCropH,
        scaleX: displayW / contour.mfcCropW, scaleY: displayH / contour.mfcCropH });
      inset.setCoords();
    });
    canvas.requestRenderAll();
  }

  function followSourceImage(src) {
    const matrix = src.calcTransformMatrix();
    const d = fabric.util.qrDecompose(matrix);
    canvas.getObjects().filter(o => o.mfcType === 'insetContour' &&
      o.mfcInsetSourceId === src.mfcId && o.mfcCropX != null).forEach(contour => {
      if (contour.group && contour.group.type === 'activeSelection') return;
      const localX = contour.mfcCropX-src.cropX-src.width/2;
      const localY = contour.mfcCropY-src.cropY-src.height/2;
      const origin = fabric.util.transformPoint(new fabric.Point(localX,localY),matrix);
      contour.set({ left: origin.x, top: origin.y, angle: d.angle,
        scaleX: contour.mfcCropW*d.scaleX/contour.width,
        scaleY: contour.mfcCropH*d.scaleY/contour.height });
      contour.setCoords();
    });
    canvas.requestRenderAll();
  }

  function syncAttachments(img) {
    updateScaleBarsForImage(img);
    followSourceImage(img);
  }

  // ---- shape tool (rectangle/square, drag-to-draw) ----
  let shapeDrag = null; // { rect, startX, startY }
  let shapeKind = 'rect';

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

  function setShapeKind(kind) {
    shapeKind = kind;
    document.querySelectorAll('[data-shape-kind]').forEach(b => b.classList.toggle('active', b.dataset.shapeKind === kind));
  }

  function pathForDrag(kind, x1, y1, x2, y2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  // Kept as a compatibility entry point for projects created before v0.21.
  // Legacy Polyline/Curve objects are converted to the unified editable node model.
  function installCurveControls(path) {
    installPathControls(path);
  }

  function startShapeDrag(pointer, evt) {
    const style = readShapeFormValues();
    if (shapeKind === 'ellipse') {
      const ellipse = new fabric.Ellipse({
        left: pointer.x, top: pointer.y, rx: 0.5, ry: 0.5,
        stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDashArray: style.strokeDashArray,
        fill: style.fill, strokeUniform: true,
        cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
      });
      ellipse.mfcId = 'shp' + (nextId++); ellipse.mfcType = 'shape'; ellipse.mfcShapeKind = 'ellipse';
      canvas.add(ellipse);
      shapeDrag = { rect: ellipse, startX: pointer.x, startY: pointer.y, ellipse: true };
      return;
    }
    if (shapeKind !== 'rect') {
      const path = new fabric.Path(pathForDrag(shapeKind,pointer.x,pointer.y,pointer.x+1,pointer.y+1), {
        stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDashArray: style.strokeDashArray,
        fill: 'transparent', strokeUniform: true, perPixelTargetFind: false,
        cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
      });
      path.mfcId = 'shp' + (nextId++); path.mfcType = 'shape'; path.mfcShapeKind = shapeKind;
      installCurveControls(path);
      canvas.add(path);
      shapeDrag = { rect: path, startX: pointer.x, startY: pointer.y, kind: shapeKind };
      return;
    }
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
    if (currentTool === 'path') {
      movePathPointer(canvas.getPointer(opt.e), opt.e);
      return;
    }
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
      updateInsetReadout(insetDrag.rect);
      document.getElementById('inset-fixed-w').value = Math.round(Math.abs(w) * 100) / 100;
      document.getElementById('inset-fixed-h').value = Math.round(Math.abs(h) * 100) / 100;
      canvas.requestRenderAll();
      return;
    }
    if (!shapeDrag) return;
    const p = canvas.getPointer(opt.e);
    if (shapeDrag.ellipse) {
      let w = p.x - shapeDrag.startX, h = p.y - shapeDrag.startY;
      if (shapeAspectMode === 'square' || opt.e.shiftKey) {
        const size = Math.max(Math.abs(w), Math.abs(h));
        w = (w < 0 ? -1 : 1) * size; h = (h < 0 ? -1 : 1) * size;
      }
      shapeDrag.rect.set({ left: w < 0 ? shapeDrag.startX + w : shapeDrag.startX, top: h < 0 ? shapeDrag.startY + h : shapeDrag.startY,
        rx: Math.max(0.5, Math.abs(w) / 2), ry: Math.max(0.5, Math.abs(h) / 2) });
      shapeDrag.rect.setCoords();
      canvas.requestRenderAll();
      return;
    }
    if (shapeDrag.kind) {
      const obj = shapeDrag.rect;
      obj._setPath(pathForDrag(shapeDrag.kind,shapeDrag.startX,shapeDrag.startY,p.x,p.y));
      obj.setCoords(); obj.dirty = true; canvas.requestRenderAll();
      return;
    }
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

  function onCanvasMouseUp(opt) {
    if (currentTool === 'path') {
      endPathPointer(canvas.getPointer(opt.e), opt.e);
      return;
    }
    if (insetDrag) {
      const rect = insetDrag.rect;
      insetDrag = null;
      if (rect.width < 8 || rect.height < 8) {
        // too small a drag to be intentional — discard rather than leave a stray sliver
        canvas.remove(rect);
        canvas.requestRenderAll();
        return;
      }
      finishInsetContour(rect);
      return;
    }
    if (!shapeDrag) return;
    const rect = shapeDrag.rect;
    if (shapeDrag.ellipse && rect.rx < 2.5 && rect.ry < 2.5) {
      rect.set({ rx: 75, ry: shapeAspectMode === 'square' ? 75 : 50 });
      rect.setCoords();
    }
    // treat a near-zero drag (a simple click) as "place a default-sized shape here"
    if (!shapeDrag.kind && !shapeDrag.ellipse && rect.width < 5 && rect.height < 5) {
      rect.set({ width: 150, height: shapeAspectMode === 'square' ? 150 : 100 });
      rect.setCoords();
      canvas.requestRenderAll();
    }
    if (shapeDrag.kind && rect.width < 5 && rect.height < 5) {
      rect._setPath(pathForDrag(shapeDrag.kind,shapeDrag.startX,shapeDrag.startY,shapeDrag.startX+150,shapeDrag.startY+80));
      rect.setCoords();
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

  // Each panel control changes only its own property, on every selected object of the kind.
  const SHAPE_FIELD_PROPS = { 'shape-stroke-color': ['stroke'], 'shape-stroke-width': ['strokeWidth'],
    'shape-dash': ['strokeDashArray'], 'shape-fill-enabled': ['fill'], 'shape-fill-color': ['fill'] };
  function selectedShapes() { return selectedObjects(o => o.mfcType === 'shape' && o.mfcShapeKind !== 'path'); }

  /** Live-apply the changed stroke/fill/dash setting (or all of them) to the selected shape(s). */
  function applyShapeStyle(field) {
    const shapes = selectedShapes();
    if (!shapes.length) return;
    if (field === 'shape-fill-color' && !document.getElementById('shape-fill-enabled').checked) return;
    const style = readShapeFormValues();
    const props = SHAPE_FIELD_PROPS[field] || Object.keys(style);
    // A line has no inside to fill.
    shapes.forEach(shape => props.forEach(key => { if (!(key === 'fill' && shape.mfcShapeKind === 'line')) shape.set(key, style[key]); }));
    canvas.requestRenderAll();
    canvas.fire('object:modified', { target: canvas.getActiveObject() });
  }

  function refreshShapePanel() {
    const shapes = selectedShapes(), active = shapes[0];
    const isShape = !!active;
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

  // ---- unified Pen / Path tool ----
  // Nodes live in the same command-coordinate space as Fabric's path array. This keeps
  // the editable source geometry independent of the object's move/rotate/scale transform.
  let pathDefaultMode = 'straight';
  let pathDraft = null;
  let pathPointer = null;
  let pathHelpers = [];

  const point = (x, y) => ({ x, y });
  const copyPoint = p => p ? point(p.x, p.y) : null;
  const copyNodes = nodes => nodes.map(n => ({ x:n.x, y:n.y, type:n.type || 'corner',
    handleIn:copyPoint(n.handleIn), handleOut:copyPoint(n.handleOut) }));
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const mixPoint = (a,b,t) => point(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);

  function pathCommands(nodes, closed = false, preview = null) {
    if (!nodes.length) return [];
    const commands = [['M', nodes[0].x, nodes[0].y]];
    const addSegment = (from, to) => {
      if (from.handleOut || to.handleIn) commands.push(['C',
        (from.handleOut || from).x, (from.handleOut || from).y,
        (to.handleIn || to).x, (to.handleIn || to).y, to.x, to.y]);
      else commands.push(['L', to.x, to.y]);
    };
    for (let i=1;i<nodes.length;i++) addSegment(nodes[i-1],nodes[i]);
    if (preview) addSegment(nodes[nodes.length-1],preview);
    else if (closed && nodes.length > 2) { addSegment(nodes[nodes.length-1],nodes[0]); commands.push(['Z']); }
    return commands;
  }

  function pathStyleFromPanel() {
    return {
      stroke: document.getElementById('path-stroke-color').value,
      strokeWidth: Math.max(0.1, parseFloat(document.getElementById('path-stroke-width').value) || 3),
      strokeDashArray: DASH_PRESETS[document.getElementById('path-dash').value] || null,
      strokeLineCap: document.getElementById('path-line-cap').value,
      strokeLineJoin: document.getElementById('path-line-join').value,
      opacity: Math.max(0,Math.min(1,(parseFloat(document.getElementById('path-opacity').value) || 0)/100)),
      fill: 'transparent', strokeUniform: true, perPixelTargetFind: false,
      cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
    };
  }

  function setPathStatus(text, active = false) {
    const el = document.getElementById('path-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('path-status-active', active);
  }

  function setPathDefaultMode(mode) {
    pathDefaultMode = mode;
    document.getElementById('path-mode-straight').classList.toggle('active',mode === 'straight');
    document.getElementById('path-mode-bezier').classList.toggle('active',mode === 'bezier');
    setPathStatus(mode === 'bezier'
      ? 'Bézier default: click and drag to set tangent handles; plain clicks remain editable.'
      : 'Straight default: click to add corners; drag any new node to make that section curved.');
  }

  function constrainedPoint(p, origin, shift) {
    if (!shift || !origin) return point(p.x,p.y);
    const dx=p.x-origin.x,dy=p.y-origin.y,r=Math.hypot(dx,dy);
    if (!r) return point(p.x,p.y);
    const angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*(Math.PI/4);
    return point(origin.x+Math.cos(angle)*r,origin.y+Math.sin(angle)*r);
  }

  function pathNodeWorld(path, node) {
    return fabric.util.transformPoint(new fabric.Point(node.x-path.pathOffset.x,node.y-path.pathOffset.y),path.calcTransformMatrix());
  }

  function snapPathPoint(p, enabled, excludePath = null) {
    if (!enabled) return { point:point(p.x,p.y), snapped:false };
    const candidates=[];
    canvas.getObjects().forEach(obj => {
      if (obj === excludePath || isHelper(obj)) return;
      if (obj.mfcShapeKind === 'path' && obj.mfcPathNodes)
        obj.mfcPathNodes.forEach(node => candidates.push({ ...pathNodeWorld(obj,node), label:'node' }));
      const box=obj.getBoundingRect(true,true);
      const xs=[box.left,box.left+box.width/2,box.left+box.width];
      const ys=[box.top,box.top+box.height/2,box.top+box.height];
      xs.forEach(x=>ys.forEach(y=>candidates.push({x,y,label:'edge/center'})));
    });
    let best=null,bestDistance=12/zoomLevel;
    candidates.forEach(candidate=>{const d=distance(p,candidate);if(d<bestDistance){best=candidate;bestDistance=d;}});
    if (!best) return { point:point(p.x,p.y), snapped:false };
    setPathStatus('Snapped to nearby '+best.label+'.',true);
    return { point:point(best.x,best.y), snapped:true };
  }

  function helperObject(obj) {
    obj.set({ selectable:false,evented:false,excludeFromExport:true,objectCaching:false });
    obj.mfcIsPathHelper=true;
    pathHelpers.push(obj); canvas.add(obj); return obj;
  }

  function clearPathHelpers() {
    pathHelpers.forEach(obj=>canvas.remove(obj));
    pathHelpers=[];
  }

  function renderPathDraft() {
    clearPathHelpers();
    if (!pathDraft || !pathDraft.nodes.length) { canvas.requestRenderAll(); return; }
    const hover = pathPointer ? null : pathDraft.hover;
    const commands=pathCommands(pathDraft.nodes,false,hover);
    if (commands.length>1) {
      const preview=new fabric.Path(commands,{...pathDraft.style,opacity:Math.max(.3,pathDraft.style.opacity)});
      preview.mfcIsPathDraft=true; helperObject(preview);
    }
    const radius=5/zoomLevel,handleRadius=4/zoomLevel;
    pathDraft.nodes.forEach((node,index)=>{
      for (const handle of [node.handleIn,node.handleOut]) if (handle) {
        helperObject(new fabric.Line([node.x,node.y,handle.x,handle.y],{stroke:'#8fb0ff',strokeWidth:1/zoomLevel}));
        helperObject(new fabric.Circle({left:handle.x,top:handle.y,originX:'center',originY:'center',radius:handleRadius,
          fill:'#1b1e24',stroke:'#8fb0ff',strokeWidth:1/zoomLevel}));
      }
      helperObject(new fabric.Circle({left:node.x,top:node.y,originX:'center',originY:'center',radius,
        fill:index===pathDraft.nodes.length-1?'#5b8cff':'#ffffff',stroke:'#172031',strokeWidth:1/zoomLevel}));
    });
    if (pathDraft.snap && hover) helperObject(new fabric.Circle({left:hover.x,top:hover.y,originX:'center',originY:'center',
      radius:8/zoomLevel,fill:'transparent',stroke:'#5b8cff',strokeWidth:2/zoomLevel}));
    canvas.requestRenderAll();
  }

  function beginPathPointer(raw, evt) {
    if (evt.detail >= 2 && pathDraft) { finishPathDrawing(false); return; }
    if (!pathDraft) pathDraft={nodes:[],style:pathStyleFromPanel(),hover:null,snap:false};
    const previous=pathDraft.nodes.at(-1);
    let p=constrainedPoint(raw,previous,evt.shiftKey);
    const snapped=snapPathPoint(p,evt.ctrlKey);p=snapped.point;pathDraft.snap=snapped.snapped;
    const first=pathDraft.nodes[0];
    if (first && pathDraft.nodes.length>2 && distance(p,first)<=12/zoomLevel) { finishPathDrawing(true); return; }
    const node={x:p.x,y:p.y,type:'corner',handleIn:null,handleOut:null};
    pathDraft.nodes.push(node);
    pathPointer={index:pathDraft.nodes.length-1,start:point(p.x,p.y),moved:false};
    pathDraft.hover=null;
    renderPathDraft();
  }

  function movePathPointer(raw, evt) {
    if (!pathDraft || !pathDraft.nodes.length) return;
    if (pathPointer) {
      const node=pathDraft.nodes[pathPointer.index];
      const handlePoint=constrainedPoint(raw,pathPointer.start,evt.shiftKey);
      const dx=handlePoint.x-pathPointer.start.x,dy=handlePoint.y-pathPointer.start.y;
      pathPointer.moved=pathPointer.moved||Math.hypot(dx,dy)>3/zoomLevel;
      if (pathPointer.moved) {
        node.handleIn=point(node.x-dx,node.y-dy);node.handleOut=point(node.x+dx,node.y+dy);
        node.type=evt.altKey?'corner':'smooth';
        setPathStatus(evt.altKey?'Corner node: handles are independent.':'Smooth Bézier node.',true);
      }
    } else {
      const previous=pathDraft.nodes.at(-1);
      let p=constrainedPoint(raw,previous,evt.shiftKey);
      const snapped=snapPathPoint(p,evt.ctrlKey);pathDraft.hover=snapped.point;pathDraft.snap=snapped.snapped;
      if (evt.shiftKey) setPathStatus('Shift constraint: 45° angle.',true);
    }
    renderPathDraft();
  }

  function endPathPointer(_raw, _evt) {
    if (!pathPointer || !pathDraft) return;
    const index=pathPointer.index,node=pathDraft.nodes[index];
    if (!pathPointer.moved && pathDefaultMode==='bezier' && index>0) {
      const previous=pathDraft.nodes[index-1],dx=(node.x-previous.x)/3,dy=(node.y-previous.y)/3;
      if (!previous.handleOut) previous.handleOut=point(previous.x+dx,previous.y+dy);
      node.handleIn=point(node.x-dx,node.y-dy);node.handleOut=point(node.x+dx,node.y+dy);node.type='smooth';
    }
    pathPointer=null;
    setPathStatus(pathDraft.nodes.length===1?'Add another node to create a segment.':'Continue clicking, or double-click / press Enter to finish.',true);
    renderPathDraft();
  }

  function makeEditablePath(nodes,style,closed=false) {
    const path=new fabric.Path(pathCommands(nodes,closed),style);
    path.mfcId='pth'+(nextId++);path.mfcType='shape';path.mfcShapeKind='path';
    path.mfcPathNodes=copyNodes(nodes);path.mfcPathClosed=!!closed;
    path.mfcArrowStart=document.getElementById('path-arrow-start').value;
    path.mfcArrowEnd=document.getElementById('path-arrow-end').value;
    installPathControls(path);
    return path;
  }

  function finishPathDrawing(closed=false) {
    if (!pathDraft) return false;
    const draft=pathDraft;pathDraft=null;pathPointer=null;clearPathHelpers();
    if (draft.nodes.length<2) { setPathStatus('Path cancelled: add at least two nodes.');canvas.requestRenderAll();return false; }
    const path=makeEditablePath(draft.nodes,draft.style,closed);
    canvas.add(path);canvas.setActiveObject(path);canvas.requestRenderAll();pushHistory();
    setTool('select');refreshPathPanel();
    setPathStatus(closed?'Closed path created.':'Open path created. Select Edit nodes for direct geometry editing.');
    return true;
  }

  function cancelPathDrawing() {
    if (!pathDraft) return false;
    pathDraft=null;pathPointer=null;clearPathHelpers();canvas.requestRenderAll();
    setPathStatus('Unfinished path cancelled.');return true;
  }

  function pathArrowGeometry(path,atStart) {
    const nodes=path.mfcPathNodes||[];if(nodes.length<2)return null;
    const tip=atStart?nodes[0]:nodes[nodes.length-1];
    let reference;
    if(atStart){const next=nodes[1];reference=tip.handleOut||next.handleIn||next;}
    else{const previous=nodes[nodes.length-2];reference=tip.handleIn||previous.handleOut||previous;}
    let dx=atStart?tip.x-reference.x:tip.x-reference.x,dy=atStart?tip.y-reference.y:tip.y-reference.y;
    let length=Math.hypot(dx,dy);if(length<.001)return null;dx/=length;dy/=length;
    const size=Math.max(10,(path.strokeWidth||1)*4),half=size*.45;
    const base=point(tip.x-dx*size,tip.y-dy*size),perp=point(-dy*half,dx*half);
    return [tip,point(base.x+perp.x,base.y+perp.y),point(base.x-perp.x,base.y-perp.y)];
  }

  function installPathRendering(path) {
    if(path.__mfcPathRendering)return;path.__mfcPathRendering=true;path.objectCaching=false;
    const baseRender=path._render;
    path._render=function(ctx){
      baseRender.call(this,ctx);ctx.save();ctx.fillStyle=this.stroke||'#000';
      const draw=geometry=>{if(!geometry)return;ctx.beginPath();ctx.moveTo(geometry[0].x-this.pathOffset.x,geometry[0].y-this.pathOffset.y);
        ctx.lineTo(geometry[1].x-this.pathOffset.x,geometry[1].y-this.pathOffset.y);ctx.lineTo(geometry[2].x-this.pathOffset.x,geometry[2].y-this.pathOffset.y);ctx.closePath();ctx.fill();};
      if(this.mfcArrowStart==='arrow')draw(pathArrowGeometry(this,true));
      if(this.mfcArrowEnd==='arrow')draw(pathArrowGeometry(this,false));ctx.restore();
    };
    const baseSVG=path._toSVG;
    path._toSVG=function(){
      const parts=baseSVG.call(this),color=String(this.stroke||'#000').replace(/"/g,'');
      const polygon=geometry=>geometry?`<polygon points="${geometry.map(p=>`${p.x},${p.y}`).join(' ')}" transform="translate(${-this.pathOffset.x} ${-this.pathOffset.y})" fill="${color}" stroke="none" opacity="${this.opacity}" />\n`:'';
      if(this.mfcArrowStart==='arrow')parts.push(polygon(pathArrowGeometry(this,true)));
      if(this.mfcArrowEnd==='arrow')parts.push(polygon(pathArrowGeometry(this,false)));
      return parts;
    };
  }

  function nodesFromFabricPath(path) {
    const nodes=[];let closed=false;
    for(const command of path.path||[]){
      const type=command[0].toUpperCase();
      if(type==='M')nodes.push({x:command[1],y:command[2],type:'corner',handleIn:null,handleOut:null});
      else if(type==='L')nodes.push({x:command[1],y:command[2],type:'corner',handleIn:null,handleOut:null});
      else if(type==='Q'&&nodes.length){
        const previous=nodes.at(-1),control=point(command[1],command[2]),end=point(command[3],command[4]);
        previous.handleOut=mixPoint(previous,control,2/3);
        nodes.push({x:end.x,y:end.y,type:'smooth',handleIn:mixPoint(end,control,2/3),handleOut:null});
      }else if(type==='C'&&nodes.length){
        nodes.at(-1).handleOut=point(command[1],command[2]);
        nodes.push({x:command[5],y:command[6],type:'smooth',handleIn:point(command[3],command[4]),handleOut:null});
      }else if(type==='Z')closed=true;
    }
    return {nodes,closed};
  }

  function commandPointFromControl(path,x,y) {
    // Fabric's actionHandler receives document coordinates (getPointer already undoes
    // the viewport). Removing zoom/pasteboard a second time made nodes jump on dragging.
    const local=fabric.util.transformPoint(new fabric.Point(x,y),fabric.util.invertTransform(path.calcTransformMatrix()));
    return point(local.x+path.pathOffset.x,local.y+path.pathOffset.y);
  }

  function rebuildEditablePath(path,referenceIndex=0) {
    const nodes=path.mfcPathNodes;if(!nodes.length)return;
    const safe=Math.max(0,Math.min(referenceIndex,nodes.length-1));
    const before=pathNodeWorld(path,nodes[safe]);
    path._setPath(pathCommands(nodes,path.mfcPathClosed));
    const after=pathNodeWorld(path,nodes[safe]);
    // Position lives in the parent's coordinate space when a path is grouped.
    const inverseParent = path.group ? fabric.util.invertTransform(path.group.calcTransformMatrix()) : fabric.iMatrix;
    const delta = fabric.util.transformPoint(new fabric.Point(before.x-after.x,before.y-after.y),inverseParent,true);
    path.set({left:path.left+delta.x,top:path.top+delta.y});
    if(path.__mfcNodeEdit)path.controls=buildNodeControls(path);
    path.setCoords();path.dirty=true;installPathRendering(path);
  }

  function renderPathControl(ctx,left,top,styleOverride,fabricObject) {
    ctx.save();ctx.beginPath();ctx.arc(left,top,5,0,Math.PI*2);
    ctx.fillStyle=styleOverride.fill;ctx.strokeStyle=styleOverride.stroke;ctx.lineWidth=1.5;ctx.fill();ctx.stroke();ctx.restore();
  }

  function makeNodeControl(path,index,handleName=null) {
    return new fabric.Control({cursorStyle:handleName?'crosshair':'move',cornerSize:12,actionName:'modifyPath',
      positionHandler:(_dim,_matrix,obj)=>{
        const node=obj.mfcPathNodes[index],value=(handleName?node[handleName]:node)||node;
        const local=new fabric.Point(value.x-obj.pathOffset.x,value.y-obj.pathOffset.y);
        return fabric.util.transformPoint(local,fabric.util.multiplyTransformMatrices((obj.canvas?obj.canvas.viewportTransform:fabric.iMatrix),obj.calcTransformMatrix()));
      },
      mouseDownHandler:(_evt,transform,x,y)=>{
        const obj=transform.target,node=obj.mfcPathNodes[index],value=handleName?node[handleName]:node;
        const pointer=commandPointFromControl(obj,x,y);
        transform.mfcGrabOffset=point(value.x-pointer.x,value.y-pointer.y);
        obj.__mfcSelectedNode=index;refreshPathPanel();return true;
      },
      actionHandler:(evt,transform,x,y)=>{
        const obj=transform.target,nodes=obj.mfcPathNodes,node=nodes[index];obj.__mfcSelectedNode=index;
        let value=commandPointFromControl(obj,x,y);
        if(transform.mfcGrabOffset){value.x+=transform.mfcGrabOffset.x;value.y+=transform.mfcGrabOffset.y;}
        if(evt.ctrlKey){const raw=canvas.getPointer(evt),snapped=snapPathPoint(raw,true,obj);if(snapped.snapped){
          const inv=fabric.util.invertTransform(obj.calcTransformMatrix()),local=fabric.util.transformPoint(new fabric.Point(snapped.point.x,snapped.point.y),inv);
          value=point(local.x+obj.pathOffset.x,local.y+obj.pathOffset.y);
        }}
        const reference=index===0?Math.min(1,nodes.length-1):0;
        if(!handleName){const dx=value.x-node.x,dy=value.y-node.y;node.x=value.x;node.y=value.y;
          if(node.handleIn){node.handleIn.x+=dx;node.handleIn.y+=dy;}if(node.handleOut){node.handleOut.x+=dx;node.handleOut.y+=dy;}
        }else{
          node[handleName]=value;
          if(node.type==='smooth'&&!evt.altKey){const other=handleName==='handleIn'?'handleOut':'handleIn';
            const vx=value.x-node.x,vy=value.y-node.y,length=Math.hypot(vx,vy)||1;
            const old=node[other],otherLength=old?distance(node,old):length;
            node[other]=point(node.x-vx/length*otherLength,node.y-vy/length*otherLength);
          }else if(evt.altKey)node.type='corner';
        }
        rebuildEditablePath(obj,reference);refreshPathPanel();canvas.requestRenderAll();return true;
      },
      render:(ctx,left,top,_style,obj)=>{
        if(handleName){const anchor=obj.mfcPathNodes[index],anchorScreen=fabric.util.transformPoint(
          new fabric.Point(anchor.x-obj.pathOffset.x,anchor.y-obj.pathOffset.y),
          fabric.util.multiplyTransformMatrices((obj.canvas?obj.canvas.viewportTransform:fabric.iMatrix),obj.calcTransformMatrix()));
          ctx.save();ctx.beginPath();ctx.moveTo(anchorScreen.x,anchorScreen.y);ctx.lineTo(left,top);ctx.strokeStyle='#8fb0ff';ctx.lineWidth=1;ctx.stroke();ctx.restore();
        }
        renderPathControl(ctx,left,top,{fill:handleName?'#1b1e24':(obj.__mfcSelectedNode===index?'#5b8cff':'#fff'),stroke:'#5b8cff'},obj);
      }
    });
  }

  function buildNodeControls(path) {
    const controls={};path.mfcPathNodes.forEach((node,index)=>{
      controls['a'+index]=makeNodeControl(path,index);
      if(node.handleIn)controls['i'+index]=makeNodeControl(path,index,'handleIn');
      if(node.handleOut)controls['o'+index]=makeNodeControl(path,index,'handleOut');
    });return controls;
  }

  function installPathControls(path) {
    if(!path.mfcPathNodes&&(path.mfcShapeKind==='curve'||path.mfcShapeKind==='polyline')){
      const legacy=nodesFromFabricPath(path);path.mfcPathNodes=legacy.nodes;path.mfcPathClosed=legacy.closed;path.mfcShapeKind='path';
    }
    if(path.mfcShapeKind!=='path'||!path.mfcPathNodes)return;
    path.mfcPathNodes=copyNodes(path.mfcPathNodes);path.mfcArrowStart=path.mfcArrowStart||'none';path.mfcArrowEnd=path.mfcArrowEnd||'none';
    path.__mfcStandardControls=fabric.Object.prototype.controls;path.controls=path.__mfcStandardControls;path.__mfcNodeEdit=false;
    path.__mfcSelectedNode=0;path.hasBorders=true;installPathRendering(path);
  }

  function enterPathEdit(path=canvas.getActiveObject()) {
    if(!path||path.mfcShapeKind!=='path')return false;
    if(refuseLocked(path,'reshaped'))return false;
    path.__mfcNodeEdit=true;path.__mfcSelectedNode=Math.min(path.__mfcSelectedNode||0,path.mfcPathNodes.length-1);
    path.controls=buildNodeControls(path);path.hasBorders=false;path.lockMovementX=true;path.lockMovementY=true;
    canvas.setActiveObject(path);canvas.requestRenderAll();refreshPathPanel();MFC_UI.focusPanel('panel-path');setPathStatus('Node editing active. Double-click a segment to insert a node.',true);return true;
  }

  function exitPathEdit(path=canvas.getActiveObject()) {
    if(!path||path.mfcShapeKind!=='path')return false;
    path.__mfcNodeEdit=false;path.controls=path.__mfcStandardControls||fabric.Object.prototype.controls;path.hasBorders=true;
    applyLockState(path);path.setCoords();canvas.requestRenderAll();refreshPathPanel();return true;
  }

  function updatePathControls(path) { if(path&&path.__mfcNodeEdit)path.controls=buildNodeControls(path); }

  function deleteSelectedPathNode() {
    const path=canvas.getActiveObject();if(!path||!path.__mfcNodeEdit)return false;
    const minimum=path.mfcPathClosed?3:2;
    if(path.mfcPathNodes.length<=minimum){MFC_UI.toast('This path needs at least '+minimum+' nodes.');return true;}
    const index=path.__mfcSelectedNode||0,reference=index===0?1:0;path.mfcPathNodes.splice(index,1);
    path.__mfcSelectedNode=Math.min(index,path.mfcPathNodes.length-1);rebuildEditablePath(path,reference>path.__mfcSelectedNode?0:reference);
    updatePathControls(path);canvas.requestRenderAll();pushHistory();refreshPathPanel();return true;
  }

  function setSelectedNodeType(type) {
    const path=canvas.getActiveObject();if(!path||!path.__mfcNodeEdit)return;
    const nodes=path.mfcPathNodes,index=path.__mfcSelectedNode||0,node=nodes[index];node.type=type;
    if(type==='smooth'){
      const previous=nodes[index-1]||(path.mfcPathClosed?nodes.at(-1):null),next=nodes[index+1]||(path.mfcPathClosed?nodes[0]:null);
      const a=previous||point(node.x-60,node.y),b=next||point(node.x+60,node.y),dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
      const inLength=node.handleIn?distance(node,node.handleIn):(previous?distance(node,previous)/3:30);
      const outLength=node.handleOut?distance(node,node.handleOut):(next?distance(node,next)/3:30);
      node.handleIn=point(node.x-dx/length*inLength,node.y-dy/length*inLength);
      node.handleOut=point(node.x+dx/length*outLength,node.y+dy/length*outLength);
    }
    rebuildEditablePath(path,index===0?Math.min(1,nodes.length-1):0);updatePathControls(path);canvas.requestRenderAll();pushHistory();refreshPathPanel();
  }

  function setSelectedIncomingSegment(curve) {
    const path=canvas.getActiveObject();if(!path||!path.__mfcNodeEdit)return;
    const nodes=path.mfcPathNodes,index=path.__mfcSelectedNode||0;
    if(index===0&&!path.mfcPathClosed){MFC_UI.toast('Select a node after the first one to edit its incoming segment.');return;}
    const previousIndex=index===0?nodes.length-1:index-1,previous=nodes[previousIndex],node=nodes[index];
    if(curve){const dx=(node.x-previous.x)/3,dy=(node.y-previous.y)/3;
      previous.handleOut=point(previous.x+dx,previous.y+dy);node.handleIn=point(node.x-dx,node.y-dy);
    }else{previous.handleOut=null;node.handleIn=null;}
    rebuildEditablePath(path,index===0?Math.min(1,nodes.length-1):0);updatePathControls(path);canvas.requestRenderAll();pushHistory();refreshPathPanel();
  }

  const PATH_FIELD_PROPS={'path-stroke-color':'stroke','path-stroke-width':'strokeWidth','path-opacity':'opacity','path-dash':'strokeDashArray',
    'path-line-cap':'strokeLineCap','path-line-join':'strokeLineJoin','path-arrow-start':'mfcArrowStart','path-arrow-end':'mfcArrowEnd'};
  function applyPathStyle(field) {
    const paths=selectedObjects(o=>o.mfcShapeKind==='path');if(!paths.length)return;
    const style={...pathStyleFromPanel(),mfcArrowStart:document.getElementById('path-arrow-start').value,mfcArrowEnd:document.getElementById('path-arrow-end').value};
    const keys=PATH_FIELD_PROPS[field]?[PATH_FIELD_PROPS[field]]:Object.keys(style);
    paths.forEach(path=>{keys.forEach(key=>{if(key.startsWith('mfc'))path[key]=style[key];else path.set(key,style[key]);});path.dirty=true;});
    canvas.requestRenderAll();canvas.fire('object:modified',{target:canvas.getActiveObject()});
  }

  function togglePathClosed() {
    const path=canvas.getActiveObject();if(!path||path.mfcShapeKind!=='path')return;
    if(!path.mfcPathClosed&&path.mfcPathNodes.length<3){MFC_UI.toast('A closed path needs at least three nodes.');return;}
    path.mfcPathClosed=!path.mfcPathClosed;rebuildEditablePath(path,0);updatePathControls(path);canvas.requestRenderAll();pushHistory();refreshPathPanel();
  }

  function refreshPathPanel() {
    const panel=document.getElementById('panel-path');if(!panel)return;
    const active=canvas?selectedObjects(o=>o.mfcShapeKind==='path')[0]:null,isPath=!!active;
    panel.classList.toggle('hidden',!(isPath||currentTool==='path'));
    if(!isPath){document.getElementById('path-node-actions').classList.add('hidden');return;}
    // Node editing and closing work on one path at a time.
    const single=active===canvas.getActiveObject();
    document.getElementById('path-edit-nodes').disabled=!single;document.getElementById('path-close-toggle').disabled=!single;
    document.getElementById('path-stroke-color').value=toHexColor(active.stroke)||'#ffffff';
    document.getElementById('path-stroke-width').value=active.strokeWidth||3;document.getElementById('path-opacity').value=Math.round((active.opacity??1)*100);
    document.getElementById('path-line-cap').value=active.strokeLineCap||'round';document.getElementById('path-line-join').value=active.strokeLineJoin||'round';
    document.getElementById('path-arrow-start').value=active.mfcArrowStart||'none';document.getElementById('path-arrow-end').value=active.mfcArrowEnd||'none';
    let dashKey='solid';for(const [key,value] of Object.entries(DASH_PRESETS))if(value&&active.strokeDashArray&&value.length===active.strokeDashArray.length&&value.every((n,i)=>n===active.strokeDashArray[i]))dashKey=key;
    document.getElementById('path-dash').value=dashKey;document.getElementById('path-edit-nodes').textContent=active.__mfcNodeEdit?'Editing nodes':'Edit nodes';
    document.getElementById('path-close-toggle').textContent=active.mfcPathClosed?'Open path':'Close path';
    document.getElementById('path-node-actions').classList.toggle('hidden',!active.__mfcNodeEdit);
    if(active.__mfcNodeEdit){const node=active.mfcPathNodes[active.__mfcSelectedNode||0];setPathStatus(`Node ${(active.__mfcSelectedNode||0)+1} of ${active.mfcPathNodes.length}: ${node.type}.`,true);}
  }

  function localCommandPoint(path,world) {
    const local=fabric.util.transformPoint(new fabric.Point(world.x,world.y),fabric.util.invertTransform(path.calcTransformMatrix()));
    return point(local.x+path.pathOffset.x,local.y+path.pathOffset.y);
  }

  function segmentPoint(a,b,t) {
    if(!(a.handleOut||b.handleIn))return mixPoint(a,b,t);
    const p1=a.handleOut||a,p2=b.handleIn||b,u=1-t;
    return point(u*u*u*a.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t*t*t*b.x,
      u*u*u*a.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t*t*t*b.y);
  }

  function insertPathNode(path,world) {
    const nodes=path.mfcPathNodes,p=localCommandPoint(path,world),count=path.mfcPathClosed?nodes.length:nodes.length-1;
    let best={distance:Infinity,index:0,t:.5};
    for(let i=0;i<count;i++){const a=nodes[i],b=nodes[(i+1)%nodes.length];
      for(let step=1;step<40;step++){const t=step/40,d=distance(p,segmentPoint(a,b,t));if(d<best.distance)best={distance:d,index:i,t};}
    }
    const a=nodes[best.index],b=nodes[(best.index+1)%nodes.length],t=best.t,newNode={type:'corner',handleIn:null,handleOut:null};
    if(a.handleOut||b.handleIn){const p0=point(a.x,a.y),p1=a.handleOut||p0,p2=b.handleIn||b,p3=point(b.x,b.y);
      const ab=mixPoint(p0,p1,t),bc=mixPoint(p1,p2,t),cd=mixPoint(p2,p3,t),abc=mixPoint(ab,bc,t),bcd=mixPoint(bc,cd,t),split=mixPoint(abc,bcd,t);
      a.handleOut=ab;b.handleIn=cd;Object.assign(newNode,{x:split.x,y:split.y,type:'smooth',handleIn:abc,handleOut:bcd});
    }else{const split=mixPoint(a,b,t);Object.assign(newNode,{x:split.x,y:split.y});}
    const insertIndex=best.index+1;nodes.splice(insertIndex,0,newNode);path.__mfcSelectedNode=insertIndex;
    rebuildEditablePath(path,best.index);updatePathControls(path);canvas.requestRenderAll();pushHistory();refreshPathPanel();setPathStatus('Inserted node '+(insertIndex+1)+'.',true);
  }

  function onCanvasDoubleClick(opt) {
    if(pathDraft){finishPathDrawing(false);return;}
    const target=opt.target;
    if(target&&target.mfcShapeKind==='path'&&!isTransformLocked(target)){
      canvas.setActiveObject(target);enterPathEdit(target);insertPathNode(target,canvas.getPointer(opt.e));
    }
  }

  function handlePathKey(event) {
    if((event.key==='Enter')&&pathDraft){event.preventDefault();finishPathDrawing(false);return true;}
    if(event.key==='Escape'){
      if(pathDraft){event.preventDefault();cancelPathDrawing();return true;}
      const active=canvas.getActiveObject();if(active&&active.__mfcNodeEdit){event.preventDefault();exitPathEdit(active);return true;}
    }
    if((event.key==='Delete'||event.key==='Backspace')&&canvas.getActiveObject()?.__mfcNodeEdit){event.preventDefault();return deleteSelectedPathNode();}
    return false;
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

    if (prop === 'fontSize') normalizeTextScale(box);
    if (sel) {
      box.setSelectionStyles({ [prop]: value }, sel.start, sel.end);
    } else {
      // A whole-box value must win over older per-character overrides, otherwise the
      // field would show a size that isn't what's drawn.
      if (box.removeStyle) box.removeStyle(prop);
      box.set(prop, value);
    }
    if (prop === 'fontSize') box.initDimensions();
    box.dirty = true;
    box.setCoords();
  }

  function applyTextStyle(prop, value) {
    const boxes = getSelectedTextboxes();
    if (!boxes.length) return;
    if (prop === 'fontSize' && !(value > 0)) { refreshTextPanel(); return; }
    // Highlighted-word-range styling only applies when the selection IS a single text box
    // being edited directly — with several boxes selected as a group there's no shared
    // "highlighted range" across separate objects, so each whole box gets the style.
    const isSingle = boxes.length === 1 && canvas.getActiveObject().type === 'textbox';
    boxes.forEach(box => applyTextStyleToBox(box, prop, value, isSingle));
    canvas.renderAll(); // synchronous — don't rely solely on the scheduled requestRenderAll
    canvas.fire('object:modified', { target: canvas.getActiveObject() });
    refreshTextPanel();
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

  function buildScaleBarGroup(onScreenPxLen, thickness, color, showLabel, lengthUm, id = 'sb' + (nextId++)) {
    const bar = new fabric.Rect({
      left: 0, top: 0, width: onScreenPxLen, height: thickness,
      fill: color, originX: 'left', originY: 'top'
    });
    const items = [bar];
    if (showLabel) {
      items.push(new fabric.Text(lengthUm + ' µm', {
        left: 0, top: -20, fontSize: 16, fill: color, fontFamily: 'Liberation Sans', originX: 'left', originY: 'top'
      }));
    }
    const g = new fabric.Group(items, { left: 0, top: 0, originX: 'left', originY: 'top' });
    g.mfcId = id;
    g.mfcType = 'scalebar';
    return g;
  }

  function readScaleBarFormValues() {
    return {
      lengthUm: parseFloat(document.getElementById('sb-length').value) || 50,
      thickness: parseFloat(document.getElementById('sb-thickness').value) || 6,
      color: document.getElementById('sb-color').value,
      showLabel: document.getElementById('sb-showlabel').checked,
      corner: document.getElementById('sb-corner').value,
      marginPct: Math.max(0, parseFloat(document.getElementById('sb-margin').value) || 0)
    };
  }

  /** A scale bar's settings, read back from the bar itself, so bars made by any version can be shown and edited. */
  function scaleBarProps(bar) {
    const [rect, label] = bar._objects || [];
    const lengthUm = bar.mfcLengthUm != null ? bar.mfcLengthUm
      : (label && parseFloat(String(label.text).replace(',', '.')) > 0 ? parseFloat(String(label.text).replace(',', '.')) : null);
    return {
      lengthUm,
      thickness: rect ? rect.height * Math.abs(bar.scaleY || 1) : 6,
      color: rect && typeof rect.fill === 'string' ? rect.fill : '#ffffff',
      showLabel: !!label,
      corner: bar.mfcCorner || null,
      marginPct: bar.mfcMarginPct != null ? bar.mfcMarginPct : 5,
      lengthPx: rect ? rect.width * Math.abs(bar.scaleX || 1) : 0
    };
  }

  /** Where a bar of the given size goes in a corner of an image's on-canvas bounds. */
  function scaleBarCornerPosition(b, barW, barH, corner, marginPct) {
    const mx = b.width * (marginPct != null ? marginPct : 5) / 100;
    const my = b.height * (marginPct != null ? marginPct : 5) / 100;
    switch (corner) {
      case 'bottom-left': return { left: b.left + mx, top: b.top + b.height - barH - my };
      case 'top-right': return { left: b.left + b.width - barW - mx, top: b.top + my };
      case 'top-left': return { left: b.left + mx, top: b.top + my };
      default: return { left: b.left + b.width - barW - mx, top: b.top + b.height - barH - my }; // bottom-right
    }
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
    clearScaleBarPreview();
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
    // Release the transient selection so image coordinates become document coordinates
    // before bars are created and attached.
    canvas.discardActiveObject();
    clearScaleBarPreview();
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

  // ---- scale bar preview: while the Scale bar tool is active, the bar that the buttons
  // would add is drawn on the target image(s) — never selectable, saved or exported. ----
  let scaleBarPreviews = [];
  function clearScaleBarPreview() {
    if (!scaleBarPreviews.length) return;
    scaleBarPreviews.forEach(o => canvas.remove(o));
    scaleBarPreviews = [];
    canvas.requestRenderAll();
  }
  /** Images the placement buttons would use: every selected image (2+), else the reference image. */
  function scaleBarPreviewTargets() {
    if (selectedObjects(o => o.mfcType === 'scalebar').length) return [];
    const imgs = selectedObjects(o => o.mfcType === 'mfcImage');
    if (imgs.length >= 2) return imgs;
    const ref = canvas.getObjects().find(o => o.mfcId === document.getElementById('sb-ref-image').value);
    return ref ? [ref] : [];
  }
  function refreshScaleBarPreview() {
    clearScaleBarPreview();
    const status = document.getElementById('sb-preview-status');
    if (!documentOpen || currentTool !== 'scalebar') { if (status) status.textContent = ''; return; }
    const form = readScaleBarFormValues();
    const targets = scaleBarPreviewTargets();
    let shown = 0, uncalibrated = 0, firstPx = null;
    targets.forEach(img => {
      const entry = registry[img.mfcId];
      if (!entry || !entry.rawImage.voxelSizeUm) { uncalibrated++; return; }
      // Inside a multi-selection an image's own scale is relative to the selection.
      const scale = fabric.util.qrDecompose(img.calcTransformMatrix()).scaleX;
      const px = form.lengthUm / entry.rawImage.voxelSizeUm * entry.workingScale * scale;
      const g = buildScaleBarGroup(px, form.thickness, form.color, form.showLabel, form.lengthUm, null);
      delete g.mfcId; delete g.mfcType;
      g.set({ selectable: false, evented: false, excludeFromExport: true, objectCaching: false, opacity: 0.85 });
      g.mfcIsPreview = true;
      const pos = scaleBarCornerPosition(canvasBounds(img), g.getScaledWidth(), g.getScaledHeight(), form.corner, form.marginPct);
      g.set(pos); g.setCoords();
      const frame = new fabric.Rect({ left: pos.left - 4, top: pos.top - 4, width: g.getScaledWidth() + 8, height: g.getScaledHeight() + 8,
        fill: 'transparent', stroke: '#5b8cff', strokeWidth: 1.5 / zoomLevel, strokeDashArray: [5 / zoomLevel, 4 / zoomLevel],
        selectable: false, evented: false, excludeFromExport: true, objectCaching: false });
      frame.mfcIsPreview = true;
      canvas.add(frame); canvas.add(g);
      scaleBarPreviews.push(frame, g);
      shown++; if (firstPx == null) firstPx = px;
    });
    if (status) {
      if (!targets.length) status.textContent = selectedObjects(o => o.mfcType === 'scalebar').length ? '' : 'Choose a reference image (or select images) to preview the scale bar.';
      else if (!shown) status.textContent = 'Preview unavailable: the image has no pixel size. Enter one in the Channels panel.';
      else status.textContent = `Preview (dashed frame): ${form.lengthUm} µm = ${Math.round(firstPx * 10) / 10} px on the page` +
        (shown > 1 ? `, on ${shown} images` : '') + (uncalibrated ? ` — ${uncalibrated} image(s) without pixel size skipped` : '') + '. Nothing is added until you click a button.';
    }
    canvas.requestRenderAll();
  }

  // ---- selected scale bars: their settings are shown in the panel, and the panel edits them ----
  function selectedScaleBars() { return selectedObjects(o => o.mfcType === 'scalebar'); }
  function refreshScaleBarPanel() {
    const panel = document.getElementById('panel-scalebar');
    if (!panel) return;
    const bars = selectedScaleBars();
    panel.classList.toggle('hidden', !(bars.length || currentTool === 'scalebar'));
    const info = document.getElementById('sb-selected-info');
    info.classList.toggle('hidden', !bars.length);
    document.getElementById('sb-place-actions').classList.toggle('hidden', !!bars.length && currentTool !== 'scalebar');
    if (!bars.length) return;
    const p = scaleBarProps(bars[0]);
    const setValue = (id, value) => { const el = document.getElementById(id); if (document.activeElement !== el) el.value = value; };
    if (p.lengthUm != null) setValue('sb-length', p.lengthUm);
    setValue('sb-thickness', Math.round(p.thickness * 100) / 100);
    setValue('sb-color', toHexColor(p.color) || '#ffffff');
    document.getElementById('sb-showlabel').checked = p.showLabel;
    if (p.corner) setValue('sb-corner', p.corner);
    setValue('sb-margin', p.marginPct);
    const lines = bars.slice(0, 4).map(bar => {
      const q = scaleBarProps(bar), img = canvas.getObjects().find(o => o.mfcId === bar.mfcAttachedTo);
      const entry = img && registry[img.mfcId], voxel = entry && entry.rawImage.voxelSizeUm;
      const parts = [q.lengthUm != null ? `<strong>${q.lengthUm} µm</strong>` : '<strong>length not recorded</strong>'];
      if (img) parts.push('on ' + escapeHtml(img.mfcFileName || 'image'));
      if (voxel) parts.push(`pixel size ${Math.round(voxel * 10000) / 10000} µm/px`);
      if (q.lengthUm != null && voxel) parts.push(`${Math.round(q.lengthUm / voxel * 10) / 10} image px`);
      parts.push(`${Math.round(q.lengthPx * 10) / 10} px on the page`);
      parts.push(q.corner ? q.corner.replace('-', ' ') + ' corner' : 'free position');
      return parts.join(' · ');
    });
    if (bars.length > 4) lines.push(`… and ${bars.length - 4} more`);
    info.querySelector('.sb-info-text').innerHTML = (bars.length > 1 ? `${bars.length} scale bars selected — edits apply to all:<br>` : '') + lines.join('<br>');
  }
  function escapeHtml(text) { return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  /** Rebuilds a bar with new settings in place (same id, links, locks and stacking position), recalibrated against its image. */
  function rebuildScaleBar(bar, p) {
    const img = canvas.getObjects().find(o => o.mfcId === bar.mfcAttachedTo), entry = img && registry[img.mfcId];
    const old = scaleBarProps(bar), oldBox = bar.getBoundingRect(true, true);
    const px = img && entry && entry.rawImage.voxelSizeUm ? computeScaleBarPxLength(img, entry, p.lengthUm)
      : (old.lengthUm > 0 ? old.lengthPx * p.lengthUm / old.lengthUm : old.lengthPx);
    const g = buildScaleBarGroup(px, p.thickness, p.color, p.showLabel, p.lengthUm, bar.mfcId);
    for (const key of ['mfcAttachedTo', 'mfcLocked', 'mfcPositionLocked']) if (bar[key] != null) g[key] = bar[key];
    g.mfcLengthUm = p.lengthUm;
    if (p.corner) { g.mfcCorner = p.corner; g.mfcMarginPct = p.marginPct; }
    g.set({ visible: bar.visible, opacity: bar.opacity, angle: bar.angle || 0 });
    // A free bar keeps its bar line where it was; a corner bar is placed below.
    g.set({ left: oldBox.left, top: oldBox.top + oldBox.height - g.getScaledHeight() });
    const index = canvas.getObjects().indexOf(bar);
    canvas.remove(bar);
    canvas.insertAt(g, index);
    applyLockState(g);
    g.setCoords();
    if (p.corner && img) repositionAttachedScaleBars(img);
    return g;
  }

  /** Applies one changed scale bar field (length, thickness, color, label, corner, margin) to every selected bar. Returns false when no bar is selected. */
  function applyScaleBarFieldToSelection(field) {
    const bars = selectedScaleBars();
    if (!bars.length) return false;
    const form = readScaleBarFormValues();
    const others = canvas.getActiveObjects().filter(o => !bars.includes(o));
    canvas.discardActiveObject();
    const rebuilt = bars.map(bar => {
      const p = scaleBarProps(bar);
      if (field === 'length') p.lengthUm = form.lengthUm;
      if (p.lengthUm == null) p.lengthUm = form.lengthUm;
      if (field === 'thickness') p.thickness = form.thickness;
      if (field === 'color') p.color = form.color;
      if (field === 'label') p.showLabel = form.showLabel;
      if (field === 'corner') p.corner = form.corner;
      if (field === 'margin') { p.marginPct = form.marginPct; if (!p.corner) p.corner = form.corner; }
      return rebuildScaleBar(bar, p);
    });
    const reselect = [...rebuilt, ...others];
    canvas.setActiveObject(reselect.length === 1 ? reselect[0] : new fabric.ActiveSelection(reselect, { canvas }));
    canvas.requestRenderAll();
    pushHistory();
    refreshScaleBarPanel();
    refreshSelectionBar();
    return true;
  }

  /** A scale bar panel field changed: edit the selected bars, or update the preview of a new bar. */
  function onScaleBarFieldChanged(field, committed) {
    if (committed && applyScaleBarFieldToSelection(field)) return;
    refreshScaleBarPreview();
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
    const b = canvasBounds(imgObj);
    bars.forEach(bar => {
      if (bar.group && bar.group.type === 'activeSelection') return;
      bar.set(scaleBarCornerPosition(b, bar.getScaledWidth(), bar.getScaledHeight(), bar.mfcCorner, bar.mfcMarginPct));
      bar.setCoords();
    });
    canvas.requestRenderAll();
  }

  // ---- snapping (drag-to-edges) ----
  const SNAP_THRESHOLD_SCREEN_PX = 8; // in on-screen px, so it feels consistent at any zoom

  /** Collects candidate x/y snap lines (edges + center) from the document bounds and every other object. */
  function getSnapTargets(excludeObj) {
    const targets = [];
    for (let i = 0; i < pageCount(); i++) {
      const p = pageBounds(i);
      targets.push({ x: [p.left, p.left + p.width / 2, p.left + p.width], y: [p.top, p.top + p.height / 2, p.top + p.height] });
    }
    const excludedChildren = excludeObj.type === 'activeSelection' ? excludeObj.getObjects() : [];
    canvas.getObjects().forEach(o => {
      if (o === excludeObj || o === cropRect || isHelper(o) || excludedChildren.includes(o)) return;
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
    if (!active || active === cropRect || refuseLocked(active, 'moved')) return;
    active.set({ left: active.left + dx, top: active.top + dy });
    // Keyboard steps must pass through snap lines; snapping a 1px nudge can
    // otherwise cancel the same movement forever. Mouse dragging still snaps.
    if (snap && (Math.abs(dx) > SNAP_THRESHOLD_SCREEN_PX || Math.abs(dy) > SNAP_THRESHOLD_SCREEN_PX)) snapObjectPosition(active);
    active.setCoords();

    if (active.mfcType === 'mfcImage') syncAttachments(active);
    if (active.type === 'activeSelection') {
      active.getObjects().forEach(o => { if (o.mfcType === 'mfcImage') syncAttachments(o); });
    }
    if (active.mfcType === 'insetContour') syncInsetFromContour(active);
    canvas.requestRenderAll();
    refreshSelectionBar();

    clearTimeout(nudgeHistoryTimer);
    nudgeHistoryTimer = setTimeout(() => pushHistory(), 300);
  }

  // ---- layers panel ----
  function layerLabel(o) {
    const base = baseLayerLabel(o);
    return o.clipPath ? base + ' · cropped to shape' : base;
  }
  function baseLayerLabel(o) {
    if (o.mfcType === 'mfcImage') {
      const name = o.mfcFileName || 'Image';
      return name + (o.mfcIsInset && !/\(inset\)$/.test(name) ? ' (inset)' : '');
    }
    if (o.type === 'textbox') {
      const t = (o.text || '').replace(/\n/g, ' ').trim();
      return 'Text: "' + (t.length > 18 ? t.slice(0, 18) + '…' : t || '(empty)') + '"';
    }
    if (o.mfcType === 'shape') return o.mfcShapeKind === 'path' ? 'Path' : (o.mfcShapeKind ? o.mfcShapeKind[0].toUpperCase() + o.mfcShapeKind.slice(1) : 'Shape');
    if (o.mfcType === 'scalebar') { const um = scaleBarProps(o).lengthUm; return 'Scale bar' + (um != null ? ' · ' + um + ' µm' : ''); }
    if (o.mfcType === 'insetContour') return 'Inset outline';
    if (o.type === 'group') return 'Group';
    return o.type ? (o.type[0].toUpperCase() + o.type.slice(1)) : 'Object';
  }

  const LAYER_ICONS = {
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.9 17.9A10 10 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.1-5.9"/><path d="M9.9 4.2A9 9 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.2 3.2"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
    position: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="4"/></svg>'
  };
  function layerObjects() { return canvas.getObjects().filter(o => !isHelper(o)); }

  function refreshLayersPanel() {
    const listEl = document.getElementById('layers-list');
    if (!listEl) return;
    const objs = layerObjects();
    const activeIds = new Set((canvas.getActiveObjects ? canvas.getActiveObjects() : []).map(o => o.mfcId));
    const scrollTop = listEl.scrollTop;

    if (!objs.length) {
      listEl.innerHTML = '<p class="hint">No objects on the canvas yet.</p>';
      return;
    }

    // Top of the list = front-most (matches the usual layers-panel convention), so
    // reverse the canvas's back-to-front stacking order for display.
    listEl.innerHTML = '';
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      const hidden = o.visible === false, locked = !!o.mfcLocked, fixed = !!o.mfcPositionLocked;
      const row = document.createElement('div');
      row.className = 'layer-row' + (activeIds.has(o.mfcId) ? ' active' : '') + (hidden ? ' layer-hidden' : '') + (locked ? ' layer-locked' : '');
      row.innerHTML = `
        <button class="layer-eye layer-icon ${hidden ? 'off' : ''}" data-state="${hidden ? 'hidden' : 'visible'}" aria-pressed="${hidden}" title="${hidden ? 'Hidden — click to show' : 'Visible — click to hide'}">${hidden ? LAYER_ICONS.eyeOff : LAYER_ICONS.eye}</button>
        <button class="layer-lock layer-icon ${locked ? 'on' : 'off'}" data-state="${locked ? 'locked' : 'unlocked'}" aria-pressed="${locked}" title="${locked ? 'Layer locked (nothing can be changed) — click to unlock' : 'Lock layer (blocks selecting, moving and editing)'}">${locked ? LAYER_ICONS.lock : LAYER_ICONS.unlock}</button>
        <button class="layer-position-lock layer-icon ${fixed ? 'on' : 'off'}" data-state="${fixed ? 'locked' : 'unlocked'}" aria-pressed="${fixed}" title="${fixed ? 'Position/size locked — click to unlock' : 'Lock position and size (channels and styles stay editable)'}">${LAYER_ICONS.position}</button>
        <span class="layer-name"></span>
        <button class="layer-up" title="Move forward">&#9650;</button>
        <button class="layer-down" title="Move backward">&#9660;</button>
      `;
      const name = row.querySelector('.layer-name');
      name.textContent = layerLabel(o); name.title = layerLabel(o);
      name.addEventListener('click', () => selectLayer(o));
      row.querySelector('.layer-eye').addEventListener('click', (e) => { e.stopPropagation(); toggleLayerVisibility(o); });
      row.querySelector('.layer-lock').addEventListener('click', (e) => { e.stopPropagation(); toggleLayerLock(o); });
      row.querySelector('.layer-position-lock').addEventListener('click', (e) => { e.stopPropagation(); toggleLayerPositionLock(o); });
      row.querySelector('.layer-up').addEventListener('click', (e) => { e.stopPropagation(); moveLayer(o, 'up'); });
      row.querySelector('.layer-down').addEventListener('click', (e) => { e.stopPropagation(); moveLayer(o, 'down'); });
      listEl.appendChild(row);
    }
    listEl.scrollTop = scrollTop;
  }

  function selectLayer(o) {
    if (o.mfcLocked) { MFC_UI.toast('This layer is locked — unlock it first to select it.'); return; }
    if (o.visible === false) { MFC_UI.toast('This layer is hidden — show it first to select it.'); return; }
    canvas.discardActiveObject();
    canvas.setActiveObject(o);
    canvas.requestRenderAll();
  }

  /** Drops o from the current selection (if it is part of it) — used before hiding or locking it. */
  function releaseFromSelection(o) {
    if (o.isEditing) o.exitEditing();
    if (canvas.getActiveObjects().includes(o)) canvas.discardActiveObject();
  }

  function toggleLayerVisibility(o) {
    o.visible = o.visible === false;
    if (!o.visible) releaseFromSelection(o);
    canvas.requestRenderAll();
    pushHistory();
    refreshLayersPanel();
  }

  function setAllLayersVisible(visible) {
    const objs = layerObjects();
    if (!objs.length) return;
    if (!visible) canvas.discardActiveObject();
    objs.forEach(o => { o.visible = visible; });
    canvas.requestRenderAll();
    pushHistory();
    refreshLayersPanel();
  }

  function toggleLayerLock(o) {
    o.mfcLocked = !o.mfcLocked;
    if (o.mfcLocked) releaseFromSelection(o);
    applyLockState(o);
    canvas.requestRenderAll();
    pushHistory();
    refreshLayersPanel();
  }

  function toggleLayerPositionLock(o) {
    setPositionLock(o, !o.mfcPositionLocked);
    applySelectionLock();
    canvas.requestRenderAll();
    pushHistory();
    refreshLayersPanel();
    refreshSelectionBar();
  }

  /** direction: 'up' (toward front, one step) or 'down' (toward back, one step). */
  function moveLayer(o, direction) {
    if (direction === 'up') canvas.bringForward(o);
    else canvas.sendBackwards(o);
    sendPagesToBack(); // the page backgrounds must always stay behind everything
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
    // A group can be moved as a whole, which would carry position-locked members with it.
    if (refuseLocked(active, 'grouped')) return;
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

  // ---- crop to shape: a closed shape becomes the clip path of an image (or any other
  // object). The clip is stored in the object's own coordinates, so it moves, scales and
  // rotates with it, and SVG/PDF export keep it as a vector clipping path. ----
  function isClosedShape(o) {
    return !!o && o.mfcType === 'shape' && (o.type === 'rect' || o.type === 'ellipse' || o.type === 'circle' ||
      (o.mfcShapeKind === 'path' && !!o.mfcPathClosed));
  }
  /** The {shape, target} pair a "Crop to shape" would use: exactly two objects, the upper closed shape clips the other. */
  function cropToShapePair() {
    const objs = canvas.getActiveObjects();
    if (objs.length !== 2) return null;
    const [lower, upper] = [...objs].sort((a, b) => canvas.getObjects().indexOf(a) - canvas.getObjects().indexOf(b));
    const shape = isClosedShape(upper) ? upper : isClosedShape(lower) ? lower : null;
    const target = shape === upper ? lower : upper;
    if (!shape || !target || target.clipPath || target.mfcType === 'scalebar') return null;
    return { shape, target };
  }
  async function cropToShape() {
    const pair = cropToShapePair();
    if (!pair) { MFC_UI.toast('Select one image (or object) and one closed shape — box, ellipse or closed path — to crop it to that shape.'); return false; }
    const { shape, target } = pair;
    if (refuseLocked(target, 'cropped') || refuseLocked(shape, 'used as a crop')) return false;
    canvas.discardActiveObject(); // back to document coordinates
    const clip = await MFC_PROJECT.restoreObject(MFC_PROJECT.serializeObject(shape));
    fabric.util.applyTransformToObject(clip, fabric.util.multiplyTransformMatrices(
      fabric.util.invertTransform(target.calcTransformMatrix()), shape.calcTransformMatrix()));
    clip.set({ absolutePositioned: false, inverted: false });
    canvas.remove(shape);
    target.clipPath = clip;
    if (target.mfcType === 'mfcImage' && !target.mfcIsInset) cropImageFrameToClip(target);
    target.dirty = true;
    if (target.mfcType === 'mfcImage') syncAttachments(target);
    canvas.setActiveObject(target);
    canvas.requestRenderAll();
    pushHistory();
    refreshSelectionBar(); refreshLayersPanel();
    MFC_UI.toast('Cropped to shape. Remove shape crop (in the bar above) gives the shape back for editing.');
    return true;
  }
  /** Gives the clip shape back as a normal, editable shape at the same place on the canvas. */
  async function releaseShapeCrop(target = canvas.getActiveObject()) {
    if (!target || target.type === 'activeSelection' || !target.clipPath) return false;
    if (refuseLocked(target, 'uncropped')) return false;
    const clip = target.clipPath;
    const shape = await MFC_PROJECT.restoreObject(MFC_PROJECT.serializeObject(clip));
    fabric.util.applyTransformToObject(shape, fabric.util.multiplyTransformMatrices(target.calcTransformMatrix(), clip.calcOwnMatrix()));
    if (!shape.mfcId) shape.mfcId = 'shp' + (nextId++);
    if (!shape.mfcType) shape.mfcType = 'shape';
    target.clipPath = null;
    if (target.mfcPreShapeCrop) { setImageFrame(target, target.mfcPreShapeCrop); delete target.mfcPreShapeCrop; syncAttachments(target); }
    target.dirty = true;
    canvas.insertAt(shape, canvas.getObjects().indexOf(target) + 1);
    applyLockState(shape);
    shape.setCoords();
    canvas.setActiveObject(shape);
    canvas.requestRenderAll();
    pushHistory();
    refreshSelectionBar(); refreshLayersPanel();
    return true;
  }
  /**
   * Changes an image's crop window (in its preview pixels) while every pixel stays where
   * it is on the canvas, and the clip stays on the same pixels.
   */
  function setImageFrame(img, frame) {
    const before = { cropX: img.cropX || 0, cropY: img.cropY || 0, width: img.width, height: img.height };
    // The new frame's center, in the image's current local coordinates, then on the canvas.
    const local = new fabric.Point(frame.cropX + frame.width / 2 - (before.cropX + before.width / 2),
      frame.cropY + frame.height / 2 - (before.cropY + before.height / 2));
    const center = fabric.util.transformPoint(local, img.calcTransformMatrix());
    img.set({ cropX: frame.cropX, cropY: frame.cropY, width: frame.width, height: frame.height });
    img.setPositionByOrigin(center, 'center', 'center');
    keepClipOnContent(img, before);
    img.setCoords();
  }
  /** Shrinks an image's frame to its clip shape's bounding box (within the current frame), so the cropped image has no transparent surround. */
  function cropImageFrameToClip(img) {
    const clip = img.clipPath;
    const corners = canvasCorners(clip); // clip has no parent: corners in the image's local coordinates
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    const cropX = img.cropX || 0, cropY = img.cropY || 0;
    const x0 = Math.max(0, Math.min(...xs) + img.width / 2), x1 = Math.min(img.width, Math.max(...xs) + img.width / 2);
    const y0 = Math.max(0, Math.min(...ys) + img.height / 2), y1 = Math.min(img.height, Math.max(...ys) + img.height / 2);
    if (!(x1 - x0 >= 1 && y1 - y0 >= 1)) return;
    img.mfcPreShapeCrop = { cropX, cropY, width: img.width, height: img.height };
    setImageFrame(img, { cropX: cropX + x0, cropY: cropY + y0, width: x1 - x0, height: y1 - y0 });
  }

  /** Image crops move the image's local origin; shift its clip so it stays on the same pixels. */
  function keepClipOnContent(img, before) {
    if (!img.clipPath) return;
    img.clipPath.set({ left: img.clipPath.left + (before.cropX + before.width / 2) - ((img.cropX || 0) + img.width / 2),
      top: img.clipPath.top + (before.cropY + before.height / 2) - ((img.cropY || 0) + img.height / 2) });
    img.clipPath.setCoords();
    img.dirty = true;
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

    // Locked objects still count as alignment references but are never moved.
    objs.forEach((o, i) => {
      const b = bounds[i];
      if (isTransformLocked(o)) return;
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
      sorted.forEach(({ o, b }) => { if (!isTransformLocked(o)) { o.left += (cursor - b.left); o.setCoords(); } cursor += b.width + gap; });
    }
    if (mode === 'distV' && objs.length > 2) {
      const sorted = objs.map((o, i) => ({ o, b: bounds[i] })).sort((a, b) => a.b.top - b.b.top);
      const totalSpan = (sorted[sorted.length - 1].b.top + sorted[sorted.length - 1].b.height) - sorted[0].b.top;
      const totalH = sorted.reduce((s, x) => s + x.b.height, 0);
      const gap = (totalSpan - totalH) / (sorted.length - 1);
      let cursor = sorted[0].b.top;
      sorted.forEach(({ o, b }) => { if (!isTransformLocked(o)) { o.top += (cursor - b.top); o.setCoords(); } cursor += b.height + gap; });
    }

    objs.forEach(o => { if (o.mfcType === 'mfcImage') syncAttachments(o); });
    canvas.requestRenderAll();
    refreshSelectionBar();
    pushHistory();
  }

  // Clipboard snapshots share immutable sources but restore independent view settings.
  let clipboardObj = null;
  function copySelection() {
    const objects = canvas.getActiveObjects();
    if (objects.length) clipboardObj = objects.map(o => MFC_PROJECT.serializeObject(o, true));
  }
  async function pasteSelection() {
    if (!clipboardObj) return;
    const items = JSON.parse(JSON.stringify(clipboardObj)), idMap = new Map();
    const visit = (o, fn) => { fn(o); (o.objects || []).forEach(child => visit(child, fn)); if (o.clipPath) visit(o.clipPath, fn); };
    items.forEach(item => visit(item, o => {
      if (o.mfcId) { const id = (o.mfcType || 'obj') + nextId++; idMap.set(o.mfcId, id); o.mfcId = id; }
    }));
    items.forEach(item => visit(item, o => {
      for (const key of ['mfcAttachedTo','mfcInsetSourceId','mfcInsetContourId','mfcInsetTargetId'])
        if (idMap.has(o[key])) o[key] = idMap.get(o[key]);
      if (o.mfcType === 'insetContour' && ![...idMap.values()].includes(o.mfcInsetTargetId)) o.mfcInsetTargetId = null;
    }));
    canvas.discardActiveObject();
    const pasted = [];
    for (const item of items) {
      item.left += 24; item.top += 24;
      const obj = await MFC_PROJECT.restoreObject(item); canvas.add(obj); pasted.push(obj);
    }
    canvas.setActiveObject(pasted.length === 1 ? pasted[0] : new fabric.ActiveSelection(pasted, { canvas }));
    canvas.requestRenderAll(); pushHistory(); refreshChannelPanel(); refreshScaleBarRefList();
  }
  async function duplicateSelection() { copySelection(); await pasteSelection(); }

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
    const lockedCount = imgs.filter(isTransformLocked).length;
    imgs = imgs.filter(o => !isTransformLocked(o));
    if (lockedCount) MFC_UI.toast(lockedCount + ' locked image(s) were left in place.');
    if (!imgs.length) { MFC_UI.toast('No unlocked images to arrange — import, select or unlock some first.'); return; }

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
          fontSize: 18, textAlign: 'center', fontFamily: 'Liberation Sans', fill: '#000000'
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
          fontSize: 18, textAlign: 'right', fontFamily: 'Liberation Sans', fill: '#000000'
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
    if (!documentOpen) return;
    if (tool !== 'path' && pathDraft) cancelPathDrawing();
    currentTool = tool;
    // Non-selectable flags do not stop Fabric dragging an object that is already
    // active. Creation tools must release that selection before the next pointer down.
    if (['inset','shape','path','text'].includes(tool)) canvas.discardActiveObject();
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    document.getElementById('panel-crop').classList.toggle('hidden', tool !== 'crop');
    canvas.isDrawingMode = false;
    canvas.selection = (tool === 'select' || tool === 'scalebar');
    canvas.defaultCursor = tool === 'path' ? 'crosshair' : 'default';
    canvas.forEachObject(applyLockState);
    if (tool === 'crop') startCrop();
    else cancelCrop();
    if (tool === 'scalebar') refreshScaleBarRefList();
    refreshScaleBarPanel();
    refreshScaleBarPreview();
    if (tool !== 'shape' && shapeDrag) { canvas.remove(shapeDrag.rect); shapeDrag = null; }
    if (tool !== 'inset' && insetDrag) { canvas.remove(insetDrag.rect); insetDrag = null; }
    refreshTextPanel();
    refreshSelectionBar();
    refreshShapePanel();
    refreshPathPanel();
    refreshInsetPanel();
    MFC_UI.focusSelection(canvas.getActiveObject(), tool);
  }

  function getRegistry() { return registry; }
  function getNextIdCounter() { return nextId; }
  function setNextIdCounter(v) { nextId = v; }

  return {
    init, getCanvas, getDocProps, applyDocProps, closeDocument, setDocName, getAppVersion, docPropsToPixels,
    importFiles, addImageToCanvas, recomposite, refreshChannelPanel,
    applyPixelSize, applyAlphaToggle, applyStackPlane, applyBrightnessContrast, commitBrightnessContrast, resetToneCurve,
    undo, redo, pushHistory, resetHistory, jumpToHistory, getHistory, refreshHistoryPanel,
    setTool, setShapeKind, installCurveControls, installPathControls, align, copySelection, pasteSelection, duplicateSelection, nudgeSelection, refreshLayersPanel,
    groupSelection, ungroupSelection,
    applyCrop, cancelCrop, setCropAspectMode, applyCropFieldsToRect,
    applyTextStyle, applyTextAlign, applyTextBoxSize, applyTextBorder, refreshTextPanel, attachTextListeners,
    applyTextVerticalAlign, centerTextInBox, effectiveFontSize, normalizeTextScale,
    refreshObjectSizePanel, refreshSelectionBar, applyObjectSizeFromFields, applyObjectPositionFromFields, rotateSelected, setObjectAngle, uncropImage,
    applyLockState, isTransformLocked, togglePositionLockSelection, setPositionLock, toggleLayerLock, toggleLayerPositionLock,
    toggleLayerVisibility, setAllLayersVisible,
    refreshScaleBarRefList, placeScaleBarAtCorner, placeScaleBarOnSelectedImages,
    arrangeGrid,
    applyShapeStyle, setShapeAspectMode, refreshShapePanel,
    setPathDefaultMode, applyPathStyle, enterPathEdit, exitPathEdit, deleteSelectedPathNode,
    setSelectedNodeType, setSelectedIncomingSegment, togglePathClosed, refreshPathPanel,
    finishPathDrawing, cancelPathDrawing, handlePathKey, insertPathNode, pathArrowGeometry,
    createInsetFromContour, refreshInsetPanel, applyInsetContourStyle, setInsetAspectMode,
    loadInsetSizePreferences, saveInsetSizePreferences, applyExactSizeToSelectedContour,
    zoomIn, zoomOut, zoomReset, zoomToSelection, updateZoomDisplay, setZoom, getZoomLevel,
    getRegistry, getNextIdCounter, setNextIdCounter,
    pageCount, pageBounds, pageIndexForBox, addPage, removeLastPage, scrollToPage,
    selectedObjects, isHelper, scaleBarProps, refreshScaleBarPanel, refreshScaleBarPreview, onScaleBarFieldChanged,
    cropToShape, releaseShapeCrop, cropToShapePair,
    get hasDocument() { return documentOpen; },
    get currentTool() { return currentTool; }
  };
})();

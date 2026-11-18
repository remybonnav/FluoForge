/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Zoom: canvas size and viewport for a zoom level, zoom anchors (selection, cursor or view centre) and scrolling. */

import { docExtent } from './pages.js';
import { canvas, documentOpen } from './state.js';

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
export const PAGE_PAD = 260;
export let zoomLevel = 1;

export function updateZoomDisplay() {
  const el = document.getElementById('zoom-display');
  if (el) el.textContent = Math.round(zoomLevel * 100) + '%';
}
export function zoomIn() { setZoom(zoomLevel * 1.2, zoomAnchor()); }
export function zoomOut() { setZoom(zoomLevel / 1.2, zoomAnchor()); }
export function zoomReset() { setZoom(1, zoomAnchor()); }

// The canvas element grows/shrinks with zoom inside the scrolling #canvas-wrap, so a
// zoom anchor is a document point plus where it should appear in the visible area;
// after resizing, the wrap is scrolled to put that point back there.
export function canvasViewMetrics() {
  const wrap = document.getElementById('canvas-wrap');
  const wrapRect = wrap.getBoundingClientRect(), elRect = canvas.lowerCanvasEl.getBoundingClientRect();
  return { wrap, rect: wrapRect,
    offsetX: elRect.left - wrapRect.left - wrap.clientLeft + wrap.scrollLeft,
    offsetY: elRect.top - wrapRect.top - wrap.clientTop + wrap.scrollTop };
}
export function viewCenterAnchor() {
  const m = canvasViewMetrics();
  const view = { x: m.wrap.clientWidth / 2, y: m.wrap.clientHeight / 2 };
  return { view, doc: { x: (m.wrap.scrollLeft + view.x - m.offsetX) / zoomLevel - PAGE_PAD,
    y: (m.wrap.scrollTop + view.y - m.offsetY) / zoomLevel - PAGE_PAD } };
}
/** Selection center (brought to the middle of the view) if something is selected, otherwise the cursor (wheel) or the view center (buttons/shortcuts). */
export function zoomAnchor(pointerEvent) {
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
export function scrollToAnchor(anchor) {
  const m = canvasViewMetrics();
  m.wrap.scrollLeft = m.offsetX + (anchor.doc.x + PAGE_PAD) * zoomLevel - anchor.view.x;
  m.wrap.scrollTop = m.offsetY + (anchor.doc.y + PAGE_PAD) * zoomLevel - anchor.view.y;
}
/** Fit the selection in the visible area, centered. */
export function zoomToSelection() {
  const active = canvas.getActiveObject();
  if (!active) { MFC_UI.toast('Select an object to zoom to it.'); return; }
  const b = active.getBoundingRect(true, true), wrap = document.getElementById('canvas-wrap');
  const z = 0.85 * Math.min(wrap.clientWidth / Math.max(1, b.width), wrap.clientHeight / Math.max(1, b.height));
  setZoom(z, { doc: { x: b.left + b.width / 2, y: b.top + b.height / 2 }, view: { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 } });
}

export function setZoom(z, anchor = null) {
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
export function getZoomLevel() { return zoomLevel; }

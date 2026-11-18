/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Pages: every page has the document size, stacked vertically on one canvas; document properties and their pixel size. */

import { layerObjects } from '../canvas-app.js';
import { pushHistory } from './history.js';
import { canvas, docProps, documentOpen, setDocProps, setDocumentOpen } from './state.js';
import { scrollToAnchor, setZoom, zoomLevel } from './zoom.js';

export let pageRects = [];

// ---- pages: every page has the document size; pages are stacked vertically on one
// canvas, PAGE_GAP apart, so objects (and links between them) can cross pages. ----
export const PAGE_GAP = 120;
export function pageCount(props = docProps) { return Math.max(1, Math.floor(props.pages) || 1); }
/** Page i (0-based) in document coordinates. */
export function pageBounds(i, props = docProps) {
  const px = docPropsToPixels(props);
  return { left: 0, top: i * (px.height + PAGE_GAP), width: px.width, height: px.height };
}
/** The area holding every page, used to size the canvas. */
export function docExtent(props = docProps) {
  const last = pageBounds(pageCount(props) - 1, props);
  return { width: last.width, height: last.top + last.height };
}
/** Index of the page whose area overlaps the given box the most, or -1 for the pasteboard. */
export function pageIndexForBox(box) {
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
export function ensurePageRect() {
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
export function sendPagesToBack() { for (let i = pageRects.length - 1; i >= 0; i--) canvas.sendToBack(pageRects[i]); }

/** Adds a page after the last one. */
export function addPage() {
  if (!documentOpen) return;
  applyDocProps({ ...docProps, pages: pageCount() + 1 });
  pushHistory();
  MFC_UI.refreshPageControls();
  scrollToPage(pageCount() - 1);
}
/** Removes the last page; objects on it stay on the pasteboard (they are not exported). */
export function removeLastPage() {
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
export function scrollToPage(i) {
  const b = pageBounds(Math.max(0, Math.min(i, pageCount() - 1))), wrap = document.getElementById('canvas-wrap');
  canvas.discardActiveObject(); canvas.requestRenderAll();
  scrollToAnchor({ doc: { x: b.left + b.width / 2, y: b.top }, view: { x: wrap.clientWidth / 2, y: 40 } });
}

export function applyDocProps(props) {
  const px = docPropsToPixels(props);
  if (!Number.isFinite(px.width + px.height) || px.width < 1 || px.height < 1 || !(props.dpi > 0))
    throw new Error('Enter a positive width, height, and DPI.');
  setDocProps({ ...props, pages: pageCount(props) });
  setDocumentOpen(true);
  MFC_UI.updateDocumentState(true);
  setZoom(zoomLevel); // recomputes canvas dimensions from the new docProps at current zoom
  ensurePageRect();
}

export function closeDocument() {
  setDocumentOpen(false);
  pageRects.forEach(rect => canvas.remove(rect));
  pageRects = [];
  MFC_UI.updateDocumentState(false);
  setZoom(1);
}

export function docPropsToPixels(props) {
  let w = props.width, h = props.height;
  if (props.unit === 'cm') { w = (w / 2.54) * props.dpi; h = (h / 2.54) * props.dpi; }
  else if (props.unit === 'in') { w = w * props.dpi; h = h * props.dpi; }
  return { width: Math.round(w), height: Math.round(h) };
}

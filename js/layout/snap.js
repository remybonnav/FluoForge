/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Snapping to page and object edges and centres while dragging (with guides), and keyboard nudging.
   What snaps is set in Preferences → Snapping. */

import { pushHistory } from '../core/history.js';
import { pageBounds, pageCount } from '../core/pages.js';
import { canvas, isHelper } from '../core/state.js';
import { zoomLevel } from '../core/zoom.js';
import { getPreference } from '../core/preferences.js';
import { cropRect } from '../tools/crop.js';
import { syncAttachments, syncInsetFromContour } from '../tools/inset.js';
import { refuseLocked } from '../ui/locks.js';
import { refreshSelectionBar } from '../ui/selection-bar.js';

// ---- snapping (drag-to-edges) ----
// Default distance in on-screen px, so snapping feels the same at any zoom (Preferences → Snapping).
export const SNAP_THRESHOLD_SCREEN_PX = 8;
const X_EDGES = { left: b => b.left, hcenter: b => b.left + b.width / 2, right: b => b.left + b.width };
const Y_EDGES = { top: b => b.top, vcenter: b => b.top + b.height / 2, bottom: b => b.top + b.height };

/** The snap options in effect (Preferences → Snapping; a project can override them). */
export function snapOptions() {
  return { enabled: getPreference('snap.enabled'), toPage: getPreference('snap.toPage'), toObjects: getPreference('snap.toObjects'),
    edges: getPreference('snap.edges'), threshold: getPreference('snap.distance') / zoomLevel, guides: getPreference('snap.guides') };
}

/** Boxes to snap to: the pages and every other visible object (in document coordinates). */
export function getSnapTargets(excludeObj, { toPage = true, toObjects = true } = {}) {
  const targets = [];
  if (toPage) for (let i = 0; i < pageCount(); i++) targets.push(pageBounds(i));
  if (!toObjects) return targets;
  const excludedChildren = excludeObj && excludeObj.type === 'activeSelection' ? excludeObj.getObjects() : [];
  canvas.getObjects().forEach(o => {
    if (o === excludeObj || o === cropRect || isHelper(o) || o.visible === false || excludedChildren.includes(o)) return;
    targets.push(o.getBoundingRect(true, true));
  });
  return targets;
}

/** Pure: the offset that brings one of the box's chosen edges onto the nearest chosen edge of a target,
    within threshold, on each axis independently. Returns { dx, dy, guideX, guideY } (null where nothing snaps). */
export function computeSnap(box, targets, { edges = Object.keys(X_EDGES).concat(Object.keys(Y_EDGES)), threshold = SNAP_THRESHOLD_SCREEN_PX } = {}) {
  const xs = Object.keys(X_EDGES).filter(e => edges.includes(e)), ys = Object.keys(Y_EDGES).filter(e => edges.includes(e));
  const best = (selfEdges, getters, coord) => {
    let found = null;
    for (const t of targets) for (const te of selfEdges) {
      const target = getters[te](t);
      for (const se of selfEdges) {
        const d = target - getters[se](box);
        if (Math.abs(d) <= threshold && (found === null || Math.abs(d) < Math.abs(found.d))) found = { d, at: target };
      }
    }
    return found;
  };
  const x = best(xs, X_EDGES), y = best(ys, Y_EDGES);
  return { dx: x ? x.d : null, dy: y ? y.d : null, guideX: x ? x.at : null, guideY: y ? y.at : null };
}

// Guides of the drag in progress, drawn over the canvas (never part of the document or exports).
let guides = null;
export const snapGuides = () => guides;
export function clearSnapGuides() { if (guides) { guides = null; canvas && canvas.requestRenderAll(); } }

/** Moves obj (in place) so its chosen edges line up with the nearest page or object edge, if one is
    within the snap distance. Uses the object's current position: Fabric does not update its cached
    corners while it is being dragged. */
export function snapObjectPosition(obj, options = snapOptions()) {
  if (!options.enabled || !options.edges.length || (!options.toPage && !options.toObjects)) { guides = null; return; }
  const { dx, dy, guideX, guideY } = computeSnap(obj.getBoundingRect(true, true), getSnapTargets(obj, options), options);
  if (dx !== null) obj.left += dx;
  if (dy !== null) obj.top += dy;
  obj.setCoords();
  guides = options.guides && (guideX !== null || guideY !== null) ? { x: guideX, y: guideY } : null;
}

/** Draws the current snap guides over the canvas (canvas 'after:render'). */
export function drawSnapGuides(ctx) {
  if (!guides) return;
  const vpt = canvas.viewportTransform, w = canvas.getWidth(), h = canvas.getHeight();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = '#e0368f'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  ctx.beginPath();
  if (guides.x !== null) { const x = Math.round(guides.x * vpt[0] + vpt[4]) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  if (guides.y !== null) { const y = Math.round(guides.y * vpt[3] + vpt[5]) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
  ctx.restore();
}

// ---- keyboard nudge ----
export const NUDGE_SMALL = 1;   // doc px
export const NUDGE_LARGE = 10;  // doc px, with Shift held
export let nudgeHistoryTimer = null;

/** Moves the current selection by (dx,dy) doc-px — works for images/text/shapes/groups/multi-selection alike, since they all expose the same left/top. Snaps to nearby edges unless snap=false. Debounces the history push so holding an arrow key doesn't spam undo steps. */
export function nudgeSelection(dx, dy, snap) {
  const active = canvas.getActiveObject();
  if (!active || active === cropRect || refuseLocked(active, 'moved')) return;
  active.set({ left: active.left + dx, top: active.top + dy });
  // Keyboard steps must pass through snap lines; snapping a 1px nudge can
  // otherwise cancel the same movement forever. Mouse dragging still snaps.
  if (snap && (Math.abs(dx) > SNAP_THRESHOLD_SCREEN_PX || Math.abs(dy) > SNAP_THRESHOLD_SCREEN_PX)) { snapObjectPosition(active); guides = null; }
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

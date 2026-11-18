/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Snapping to page and object edges and centres while dragging, and keyboard nudging. */

import { pushHistory } from '../core/history.js';
import { pageBounds, pageCount } from '../core/pages.js';
import { canvas, isHelper } from '../core/state.js';
import { zoomLevel } from '../core/zoom.js';
import { cropRect } from '../tools/crop.js';
import { syncAttachments, syncInsetFromContour } from '../tools/inset.js';
import { refuseLocked } from '../ui/locks.js';
import { refreshSelectionBar } from '../ui/selection-bar.js';

// ---- snapping (drag-to-edges) ----
export const SNAP_THRESHOLD_SCREEN_PX = 8; // in on-screen px, so it feels consistent at any zoom

/** Collects candidate x/y snap lines (edges + center) from the document bounds and every other object. */
export function getSnapTargets(excludeObj) {
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
export function snapObjectPosition(obj) {
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

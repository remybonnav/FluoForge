/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Align and distribute the selected objects. */

import { syncAttachments } from '../canvas-app.js';
import { pushHistory } from '../core/history.js';
import { canvas } from '../core/state.js';
import { isTransformLocked } from '../ui/locks.js';
import { refreshSelectionBar } from '../ui/selection-bar.js';

// ---- alignment ----
export function align(mode) {
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

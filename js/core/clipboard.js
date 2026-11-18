/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Copy, paste and duplicate: clipboard snapshots share image sources but restore independent view settings. */

import { pushHistory } from './history.js';
import { canvas, takeId } from './state.js';
import { refreshChannelPanel } from '../image/channels.js';
import { refreshScaleBarRefList } from '../tools/scalebar.js';

// Clipboard snapshots share immutable sources but restore independent view settings.
export let clipboardObj = null;
export function copySelection() {
  const objects = canvas.getActiveObjects();
  if (objects.length) clipboardObj = objects.map(o => MFC_PROJECT.serializeObject(o, true));
}
export async function pasteSelection() {
  if (!clipboardObj) return;
  const items = JSON.parse(JSON.stringify(clipboardObj)), idMap = new Map();
  const visit = (o, fn) => { fn(o); (o.objects || []).forEach(child => visit(child, fn)); if (o.clipPath) visit(o.clipPath, fn); };
  items.forEach(item => visit(item, o => {
    if (o.mfcId) { const id = (o.mfcType || 'obj') + takeId(); idMap.set(o.mfcId, id); o.mfcId = id; }
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
export async function duplicateSelection() { copySelection(); await pasteSelection(); }

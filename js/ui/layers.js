/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Layers panel: one row per object with visibility, both locks and order, plus grouping and ungrouping. */

import { pushHistory } from '../core/history.js';
import { sendPagesToBack } from '../core/pages.js';
import { canvas, isHelper, takeId } from '../core/state.js';
import { scaleBarProps } from '../tools/scalebar.js';
import { applyLockState, applySelectionLock, refuseLocked, setPositionLock } from './locks.js';
import { refreshSelectionBar } from './selection-bar.js';

// ---- layers panel ----
export function layerLabel(o) {
  const base = baseLayerLabel(o);
  return o.clipPath ? base + ' · cropped to shape' : base;
}
export function baseLayerLabel(o) {
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

export const LAYER_ICONS = {
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.9 17.9A10 10 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.1-5.9"/><path d="M9.9 4.2A9 9 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.2 3.2"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
  position: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="4"/></svg>'
};
export function layerObjects() { return canvas.getObjects().filter(o => !isHelper(o)); }

export function refreshLayersPanel() {
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

export function selectLayer(o) {
  if (o.mfcLocked) { MFC_UI.toast('This layer is locked — unlock it first to select it.'); return; }
  if (o.visible === false) { MFC_UI.toast('This layer is hidden — show it first to select it.'); return; }
  canvas.discardActiveObject();
  canvas.setActiveObject(o);
  canvas.requestRenderAll();
}

/** Drops o from the current selection (if it is part of it) — used before hiding or locking it. */
export function releaseFromSelection(o) {
  if (o.isEditing) o.exitEditing();
  if (canvas.getActiveObjects().includes(o)) canvas.discardActiveObject();
}

export function toggleLayerVisibility(o) {
  o.visible = o.visible === false;
  if (!o.visible) releaseFromSelection(o);
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
}

export function setAllLayersVisible(visible) {
  const objs = layerObjects();
  if (!objs.length) return;
  if (!visible) canvas.discardActiveObject();
  objs.forEach(o => { o.visible = visible; });
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
}

export function toggleLayerLock(o) {
  o.mfcLocked = !o.mfcLocked;
  if (o.mfcLocked) releaseFromSelection(o);
  applyLockState(o);
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
}

export function toggleLayerPositionLock(o) {
  setPositionLock(o, !o.mfcPositionLocked);
  applySelectionLock();
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
  refreshSelectionBar();
}

/** direction: 'up' (toward front, one step) or 'down' (toward back, one step). */
export function moveLayer(o, direction) {
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
export function groupSelection() {
  const active = canvas.getActiveObject();
  if (!active || active.type !== 'activeSelection' || active.size() < 2) {
    MFC_UI.toast('Select 2 or more objects to group.');
    return;
  }
  // A group can be moved as a whole, which would carry position-locked members with it.
  if (refuseLocked(active, 'grouped')) return;
  const group = active.toGroup(); // Fabric's own, well-tested ActiveSelection -> Group conversion
  group.mfcId = 'grp' + takeId();
  group.mfcType = 'group';
  group.set({ cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff' });
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
}

/** Inverse of groupSelection (Ctrl+Shift+G) — dissolves the group and re-selects its former children as a normal multi-selection. Each child's own mfcId/mfcType/channel-registry linkage is untouched by this, since Fabric's toActiveSelection() only reparents objects, never rewrites their properties. */
export function ungroupSelection() {
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

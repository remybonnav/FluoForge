/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Locks: the layer lock (nothing can be changed) and the position/size lock (moving, scaling and rotating blocked), and the Fabric flags derived from them. */

import { pushHistory } from '../core/history.js';
import { canvas, currentTool, isHelper } from '../core/state.js';
import { exitPathEdit } from '../tools/path.js';
import { refreshLayersPanel } from './layers.js';
import { refreshSelectionBar } from './selection-bar.js';

// ---- locks ----
// Layer lock (mfcLocked) blocks everything: the object is not selectable, not
// targetable by the mouse, and not editable. Position/size lock (mfcPositionLocked)
// keeps the object selectable and editable (channels, colors, text, styles) but
// blocks moving, scaling, rotating and skewing. Every code path derives Fabric's
// flags from these two properties through applyLockState, including tool switches,
// project loading, undo/redo and paste.
export function isTransformLocked(o) {
  if (!o) return false;
  if (o.type === 'activeSelection') return o.getObjects().some(isTransformLocked);
  return !!(o.mfcLocked || o.mfcPositionLocked);
}
export function selectionToolActive() { return currentTool === 'select' || currentTool === 'scalebar' || currentTool === 'legend'; }
export function applyLockState(o) {
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
export function applySelectionLock() {
  const active = canvas.getActiveObject();
  if (!active || active.type !== 'activeSelection') return;
  const fixed = isTransformLocked(active);
  active.set({ lockMovementX: fixed, lockMovementY: fixed, lockScalingX: fixed, lockScalingY: fixed,
    lockRotation: fixed, lockSkewingX: fixed, lockSkewingY: fixed, hasControls: !fixed });
}
export function refuseLocked(o, what = 'moved, resized or rotated') {
  if (!isTransformLocked(o)) return false;
  MFC_UI.toast('Position/size is locked — unlock it to have it ' + what + '.');
  return true;
}
export function setPositionLock(o, locked) {
  if (locked && o.__mfcNodeEdit) exitPathEdit(o);
  o.mfcPositionLocked = !!locked;
  applyLockState(o);
}
export function togglePositionLockSelection() {
  const objs = canvas.getActiveObjects();
  if (!objs.length) return;
  const lock = !objs.every(o => o.mfcPositionLocked);
  objs.forEach(o => setPositionLock(o, lock));
  applySelectionLock();
  canvas.requestRenderAll();
  refreshSelectionBar(); refreshLayersPanel();
  pushHistory();
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Undo and redo: one captured state per step, a label worked out from the previous step, and the History panel. */

import { documentOpen } from './state.js';

// Undo, versions and recovery use one recursive serializer, without image bytes.
// Each step also keeps a label (worked out by comparing it with the previous step)
// and a time, for the History panel.
export const history = { stack: [], labels: [], times: [], index: -1, limit: 200, restoring: false };
export function pushHistory() {
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
export function resetHistory() { history.stack = []; history.labels = []; history.times = []; history.index = -1; pushHistory(); }
export async function moveHistory(delta) { await jumpToHistory(history.index + delta); }
/** Restores any step of the history; later steps stay available for redo until something new is done. */
export async function jumpToHistory(index) {
  if (history.restoring || index < 0 || index >= history.stack.length || index === history.index) return;
  history.restoring = true;
  try { await MFC_PROJECT.restoreState(history.stack[index], { resetHistory: false }); history.index = index; }
  finally { history.restoring = false; refreshHistoryPanel(); }
}

// ---- history labels ----
export function historyObjectName(json) {
  if (json.mfcType === 'mfcImage') return (json.mfcFileName || 'image') + (json.mfcIsInset && !/\(inset\)$/.test(json.mfcFileName || '') ? ' (inset)' : '');
  if (json.type === 'textbox' || json.mfcType === 'text') {
    const t = String(json.text || '').replace(/\s+/g, ' ').trim();
    return 'text "' + (t.length > 16 ? t.slice(0, 16) + '…' : t) + '"';
  }
  if (json.mfcType === 'scalebar') return 'scale bar' + (json.mfcLengthUm != null ? ' ' + json.mfcLengthUm + ' µm' : '');
  if (json.mfcType === 'insetContour') return 'inset outline';
  if (json.mfcType === 'calibrationBar') return 'calibration bar';
  if (json.mfcShapeKind === 'path') return 'path';
  if (json.mfcType === 'shape') return json.mfcShapeKind || (json.type === 'ellipse' ? 'ellipse' : 'box');
  if (json.type === 'group') return 'group';
  return json.type || 'object';
}
/** What kind of change turned a into b (same object, two states). */
export function historyChangeKind(a, b) {
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
export function describeHistoryStep(prev, next) {
  const before = new Map(prev.objects.map(o => [o.mfcId, o])), after = new Map(next.objects.map(o => [o.mfcId, o]));
  const added = next.objects.filter(o => !before.has(o.mfcId)), removed = prev.objects.filter(o => !after.has(o.mfcId));
  const pagesBefore = Math.max(1, prev.docProps?.pages || 1), pagesAfter = Math.max(1, next.docProps?.pages || 1);
  if (pagesAfter > pagesBefore) return 'Added page ' + pagesAfter;
  if (pagesAfter < pagesBefore) return 'Removed page ' + pagesBefore;
  if (added.length === 1 && added[0].type === 'group' && added[0].mfcType !== 'scalebar' && added[0].mfcType !== 'calibrationBar' && removed.length > 1) return 'Grouped ' + removed.length + ' objects';
  if (removed.length === 1 && removed[0].type === 'group' && removed[0].mfcType !== 'scalebar' && removed[0].mfcType !== 'calibrationBar' && !added.length) {
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
  let changed = next.objects.filter(o => before.has(o.mfcId) && JSON.stringify(before.get(o.mfcId)) !== JSON.stringify(o));
  // A calibration bar redrawn because its image's channel changed is part of that change.
  const followers = changed.filter(o => o.mfcType === 'calibrationBar' && changed.some(c => c.mfcId === o.mfcCalImageId));
  if (followers.length && followers.length < changed.length) changed = changed.filter(o => !followers.includes(o));
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
export function refreshHistoryPanel() {
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
export function getHistory() { return { labels: history.labels.slice(), index: history.index }; }

export const undo = () => moveHistory(-1), redo = () => moveHistory(1);

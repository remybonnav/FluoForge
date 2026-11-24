/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Figure check (Inspector → Check figure, and a summary at the top of the Export menu).
   buildCheckContext() turns the open figure into the plain data the rules of
   js/image/figure-check-rules.js read: absolute boxes and pages, texts in points at print size,
   scale bars, inset outlines, comparison groups, pasteboard objects, and the fraction of each
   channel's pixels clipped by its display range (over the panel's crop, cached).
   Clicking a finding selects its objects. A finding can be dismissed with a note; dismissals are
   kept per project in docProps.checkDismissals (optional: absent means none) and listed in the
   figure report. Text from files is inserted with textContent only. */

import { canvas, docProps, isHelper, registry } from '../core/state.js';
import { applyDocProps, pageIndexForBox } from '../core/pages.js';
import { pushHistory } from '../core/history.js';
import { panelGeometry } from './figure-report.js';
import { DEFAULT_PRESET, findingKey, runChecks, summarize } from '../image/figure-check-rules.js';
import { fontRangeText, presetLimits } from '../core/journal-presets.js';

const TEXT_TYPES = ['text', 'textbox', 'i-text'];
const SAMPLE_LIMIT = 4_000_000; // pixels counted per channel before sampling every n-th row and column
const clipCache = new WeakMap();

/** The limits the check uses: the figure's journal preset (docProps.journalPreset, set in the New figure
    dialog), or the default for a figure without one. */
export const activePreset = () => presetLimits(docProps && docProps.journalPreset, DEFAULT_PRESET);

/** Axis-aligned box of an object in document coordinates, including the transforms of its groups. */
export function absoluteBox(obj) {
  const m = obj.calcTransformMatrix(), w = obj.width / 2, h = obj.height / 2;
  const pts = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** Visible objects with their top-level ancestor (hidden groups hide their children). */
function visibleObjects() {
  const out = [];
  const walk = (objects, top) => objects.forEach(o => {
    if (o.visible === false || isHelper(o) || o.mfcType === 'layoutGrid') return; // a layout grid is not exported
    out.push({ obj: o, top: top || o });
    if (o.type === 'group' && o.getObjects) walk(o.getObjects(), top || o);
  });
  walk(canvas.getObjects().filter(o => o.mfcId), null);
  return out;
}
function findById(id) {
  let found = null;
  const walk = objects => objects.forEach(o => { if (found) return; if (o.mfcId === id) found = o; else if (o.type === 'group' && o.getObjects) walk(o.getObjects()); });
  walk(canvas.getObjects());
  return found;
}

/** Fractions of the region's pixels at or above max and at or below min. */
export function clippedFractions(data, width, region, min, max) {
  let byRange = clipCache.get(data);
  if (!byRange) { byRange = new Map(); clipCache.set(data, byRange); }
  const x0 = Math.max(0, Math.floor(region.x)), y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(width, Math.ceil(region.x + region.width)), y1 = Math.min(data.length / width, Math.ceil(region.y + region.height));
  const key = [min, max, x0, y0, x1, y1].join('|');
  if (byRange.has(key)) return byRange.get(key);
  const step = Math.max(1, Math.ceil(Math.sqrt((x1 - x0) * (y1 - y0) / SAMPLE_LIMIT)));
  let high = 0, low = 0, total = 0;
  for (let y = y0; y < y1; y += step) for (let i = y * width + x0, end = y * width + x1; i < end; i += step) {
    const v = data[i];
    if (v !== v) continue; // NaN
    total++;
    if (v >= max) high++; else if (v <= min) low++;
  }
  const out = { saturated: total ? high / total : 0, black: total ? low / total : 0 };
  byRange.set(key, out);
  return out;
}

const textOf = o => String(o.text || '');
function fontRange(o) {
  const sizes = [o.fontSize || 0];
  for (const line of Object.values(o.styles || {})) for (const style of Object.values(line || {})) if (style && style.fontSize) sizes.push(style.fontSize);
  const m = o.calcTransformMatrix(), scale = Math.hypot(m[2], m[3]), toPt = px => px * scale / docProps.dpi * 72;
  return { minPt: toPt(Math.min(...sizes)), maxPt: toPt(Math.max(...sizes)) };
}
function describe(o) {
  if (o.mfcType === 'mfcImage') return o.mfcFileName || 'An image';
  if (TEXT_TYPES.includes(o.type)) return `Text "${textOf(o).trim().slice(0, 30)}"`;
  if (o.mfcType === 'scalebar') return 'A scale bar';
  if (o.mfcType === 'insetContour') return 'An inset outline';
  if (o.type === 'group') return 'A group';
  return 'A ' + (o.mfcShapeKind || o.type || 'object');
}

/** The check context of the open figure (see js/image/figure-check-rules.js). */
export function buildCheckContext() {
  const objects = visibleObjects(), dpi = docProps.dpi;
  const pageOf = obj => pageIndexForBox(absoluteBox(obj));
  const images = objects.filter(({ obj }) => obj.mfcType === 'mfcImage' && registry[obj.mfcId]).map(({ obj, top }) => {
    const raw = registry[obj.mfcId].rawImage, geometry = panelGeometry(obj, dpi);
    let insetContour = null;
    if (obj.mfcIsInset && obj.mfcInsetContourId != null) {
      const contour = findById(obj.mfcInsetContourId);
      insetContour = { found: !!contour, visible: !!contour && contour.visible !== false && (contour.opacity ?? 1) > 0 && !!contour.stroke && contour.strokeWidth > 0 };
    }
    return {
      id: obj.mfcId, name: obj.mfcFileName || raw.fileName || 'Image', page: pageIndexForBox(absoluteBox(top)) < 0 ? -1 : pageOf(obj),
      box: absoluteBox(obj), inset: !!obj.mfcIsInset, insetContour, pixelSizeUm: raw.voxelSizeUm ?? null,
      brightness: raw.brightness || 0, contrast: raw.contrast || 0, compareGroup: Number.isInteger(obj.mfcCompareGroup) ? obj.mfcCompareGroup : null,
      effectivePpi: Math.min(geometry.ppiX, geometry.ppiY), enlarged: Math.min(geometry.ppiX, geometry.ppiY) < dpi - 0.05,
      channels: raw.channels.map((c, index) => ({ index, name: c.name, enabled: c.enabled !== false, color: c.color, lut: c.color === 'file' ? c.lut || null : null,
        min: c.min, max: c.max, gamma: c.gamma, invert: !!c.invert,
        ...(c.enabled !== false && c.data ? clippedFractions(c.data, raw.width, geometry.region, c.min, c.max) : { saturated: 0, black: 0 }) }))
    };
  });
  const scaleBars = objects.filter(({ obj }) => obj.mfcType === 'scalebar').map(({ obj, top }) =>
    ({ id: obj.mfcId, attachedTo: obj.mfcAttachedTo ?? null, page: pageIndexForBox(absoluteBox(top)) < 0 ? -1 : pageOf(obj), box: absoluteBox(obj) }));
  const texts = objects.filter(({ obj }) => TEXT_TYPES.includes(obj.type)).map(({ obj, top }) =>
    ({ id: obj.mfcId ?? top.mfcId, text: textOf(obj), page: pageIndexForBox(absoluteBox(top)) < 0 ? -1 : pageOf(obj), box: absoluteBox(obj), ...fontRange(obj) }));
  const pasteboard = objects.filter(({ obj, top }) => obj === top && pageIndexForBox(absoluteBox(obj)) < 0).map(({ obj }) => ({ id: obj.mfcId, label: describe(obj) }));
  return { dpi, preset: activePreset(), images, scaleBars, texts, pasteboard };
}

export const dismissals = () => (Array.isArray(docProps.checkDismissals) ? docProps.checkDismissals : []);
export function checkFigure() { return runChecks(buildCheckContext()); }

/** Dismisses a finding with a note (one undo step). */
export function dismissFinding(finding, note) {
  const list = dismissals().filter(d => d.key !== finding.key).concat([{ key: finding.key || findingKey(finding), rule: finding.rule,
    severity: finding.severity, objects: finding.objects, message: finding.message, note: String(note || '').trim() }]);
  applyDocProps({ ...docProps, checkDismissals: list });
  pushHistory();
  refreshCheckPanel();
}
export function restoreFinding(key) {
  const list = dismissals().filter(d => d.key !== key);
  const props = { ...docProps, checkDismissals: list };
  if (!list.length) delete props.checkDismissals;
  applyDocProps(props);
  pushHistory();
  refreshCheckPanel();
}

/** Selects the finding's objects (their top-level objects, which the canvas can select). */
export function selectFinding(finding) {
  const tops = [];
  for (const id of finding.objects) {
    let o = findById(id);
    while (o && o.group && o.group.type !== 'activeSelection') o = o.group;
    if (o && !tops.includes(o) && canvas.getObjects().includes(o)) tops.push(o);
  }
  if (!tops.length) { MFC_UI.toast('That object is no longer in the figure.'); return false; }
  const usable = tops.filter(o => o.visible !== false && !o.mfcLocked);
  if (!usable.length) { MFC_UI.toast('That object is locked or hidden: unlock or show it in the Layers panel first.'); return false; }
  canvas.discardActiveObject();
  canvas.setActiveObject(usable.length === 1 ? usable[0] : new fabric.ActiveSelection(usable, { canvas }));
  canvas.requestRenderAll();
  return true;
}

// ---- panel ----
const SEVERITY_LABEL = { error: 'Error', warning: 'Warning', info: 'Info' };
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = String(text);
  return e;
}
function btn(text, title, className) { const b = el('button', className, text); b.type = 'button'; b.title = title; return b; }
export function summaryText(s) {
  const parts = [[s.error, 'error'], [s.warning, 'warning'], [s.info, 'info']].filter(([n]) => n).map(([n, w]) => `${n} ${w}${n > 1 && w !== 'info' ? 's' : ''}`);
  return (parts.length ? parts.join(', ') : 'No findings') + (s.dismissed ? ` (${s.dismissed} dismissed)` : '') + '.';
}

let last = [];
/** Runs the check and redraws the Check figure panel. Returns the findings. */
export function refreshCheckPanel() {
  const list = document.getElementById('check-list');
  if (!list) return [];
  if (!MFC.hasDocument) { list.replaceChildren(); document.getElementById('check-summary').textContent = ''; return []; }
  last = checkFigure();
  const dismissed = dismissals(), keys = new Set(dismissed.map(d => d.key));
  document.getElementById('check-summary').textContent = summaryText(summarize(last, dismissed));
  const limits = activePreset(), hint = document.getElementById('check-limits');
  if (hint) hint.textContent = `Text sizes are checked against ${fontRangeText(limits)} and resolution against ${limits.minDpi} dpi (${limits.name}).`;
  list.replaceChildren(...last.filter(f => !keys.has(f.key)).map(findingItem));
  const box = document.getElementById('check-dismissed');
  box.replaceChildren(...dismissed.map(d => {
    const li = el('li', 'check-item');
    li.append(el('span', 'check-severity check-' + d.severity, SEVERITY_LABEL[d.severity] || d.severity), el('span', 'check-message', d.message),
      el('span', 'check-note', d.note ? 'Note: ' + d.note : 'No note'));
    const restore = btn('Restore', 'Show this finding again and take it out of the figure report', 'check-restore');
    restore.addEventListener('click', () => restoreFinding(d.key));
    li.append(restore);
    return li;
  }));
  document.getElementById('check-dismissed-count').textContent = String(dismissed.length);
  document.getElementById('check-dismissed-box').hidden = !dismissed.length;
  return last;
}

function findingItem(f) {
  const li = el('li', 'check-item');
  const select = btn('', 'Select ' + (f.objects.length > 1 ? 'these objects' : 'this object') + ' on the canvas', 'check-finding');
  select.append(el('span', 'check-severity check-' + f.severity, SEVERITY_LABEL[f.severity]), el('span', 'check-message', f.message));
  select.dataset.key = f.key;
  select.addEventListener('click', () => selectFinding(f));
  const dismiss = btn('Dismiss…', 'Dismiss this finding for this project, with a note for the figure report', 'check-dismiss');
  dismiss.addEventListener('click', () => {
    const form = el('div', 'check-dismiss-form');
    const input = el('input'); input.type = 'text'; input.placeholder = 'Why (goes into the figure report)';
    input.setAttribute('aria-label', 'Note for the figure report'); input.title = 'A note explaining why this finding is dismissed; it goes into the figure report';
    const save = btn('Dismiss', 'Dismiss with this note'), cancel = btn('Cancel', 'Keep the finding');
    const close = () => { form.remove(); dismiss.hidden = false; dismiss.focus(); };
    save.addEventListener('click', () => dismissFinding(f, input.value));
    cancel.addEventListener('click', close);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); dismissFinding(f, input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    form.append(input, save, cancel);
    dismiss.hidden = true; li.append(form); input.focus();
    // Firefox can ignore the first focus() on a field added in the same task; try again next frame.
    if (document.activeElement !== input) requestAnimationFrame(() => { if (form.isConnected) input.focus(); });
  });
  li.append(select, dismiss);
  return li;
}

/** The summary at the top of the Export menu: never blocks an export. */
export function refreshExportSummary() {
  const box = document.getElementById('export-check-summary');
  if (!box || !MFC.hasDocument) return;
  const s = summarize(checkFigure(), dismissals());
  box.querySelector('.export-check-text').textContent = 'Figure check: ' + summaryText(s);
  box.classList.toggle('has-errors', s.error > 0);
}

function openPanel() {
  const panel = document.getElementById('panel-check'), toggle = panel.querySelector('.panel-toggle');
  if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
  refreshCheckPanel();
  panel.scrollIntoView({ block: 'nearest' });
  const target = document.querySelector('#check-list .check-finding') || document.getElementById('check-run');
  target.focus();
  if (document.activeElement !== target) requestAnimationFrame(() => target.focus());
}

let timer = null;
const panelOpen = () => { const t = document.querySelector('#panel-check .panel-toggle'); return !t || t.getAttribute('aria-expanded') !== 'false'; };
function scheduleRefresh() { clearTimeout(timer); timer = setTimeout(() => { if (panelOpen() && MFC.hasDocument) refreshCheckPanel(); }, 400); }

document.getElementById('check-run').addEventListener('click', refreshCheckPanel);
document.getElementById('export-check-review').addEventListener('click', openPanel);
document.getElementById('btn-export').addEventListener('click', refreshExportSummary);
document.getElementById('panel-check').addEventListener('click', e => { if (e.target.closest('.panel-toggle')) scheduleRefresh(); });
// Every history step (an edit, undo, redo) and opening a project fire mfc:changed.
window.addEventListener('mfc:changed', scheduleRefresh);

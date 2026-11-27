/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Rulers and guides (P3-T7). Rulers along the top and left of the canvas, in the document unit,
   counting from each page's top-left corner. Dragging from a ruler onto the page makes a guide (from
   the top ruler a horizontal one, from the left ruler a vertical one); dragging a guide moves it, and
   dragging it back onto a ruler deletes it. Guides are kept in `docProps.guides` (saved, undoable).
   Margin and column guides come from `docProps.layoutGuides` (margin in mm) and the journal preset's
   column widths. Objects snap to all of them (js/layout/snap.js). Guides are drawn over the canvas in
   the editor only: exports never contain them.
   The top bar's Rulers and Snap buttons switch rulers and snapping on and off; Guides… opens a dialog
   that adds, moves and deletes guides by typing their position (the keyboard path). The pure part is
   js/layout/guides-model.js. */

import { pushHistory } from '../core/history.js';
import { loadJournalPresets } from '../core/journal-presets.js';
import { applyDocProps, pageBounds, pageCount } from '../core/pages.js';
import { getPreference, isProjectOverride, onPreferenceChange, setGlobalPreference, setProjectPreference } from '../core/preferences.js';
import { canvas, currentTool, docProps, documentOpen } from '../core/state.js';
import { canvasViewMetrics } from '../core/zoom.js';
import * as M from './guides-model.js';

const GUIDE_COLOUR = '#12a4c4', LAYOUT_COLOUR = '#9b6ad6', RULER = 18;
let families = null; // journal presets, for the column widths of a figure's journal
let dragging = null;  // { axis, pos, index } while a guide is dragged
const $ = id => document.getElementById(id);

// ---- the guides ----
/** The manual guides of the open figure. */
export const manualGuides = () => (documentOpen ? M.guidesOf(docProps) : []);
/** The column widths (mm) of the figure's journal: every width of its family, else the chosen one. */
export function presetColumns(preset = docProps && docProps.journalPreset) {
  if (!preset || !(preset.widthMm > 0)) return [];
  const family = families && families.find(f => f.id === preset.family);
  return family ? [...new Set(family.widths.map(w => w.mm))].sort((a, b) => a - b) : [preset.widthMm];
}
/** Margin and column guides of every page. */
export function layoutGuideLines() {
  if (!documentOpen) return [];
  const s = M.layoutSettings(docProps), columnsMm = s.columns ? presetColumns() : [];
  if (!s.marginMm && !columnsMm.length) return [];
  const seen = new Set(), out = [];
  for (let i = 0; i < pageCount(); i++) for (const g of M.layoutGuides(pageBounds(i), { marginMm: s.marginMm, columnsMm }, docProps.dpi)) {
    const key = g.axis + g.pos.toFixed(3);
    if (!seen.has(key)) { seen.add(key); out.push(g); }
  }
  return out;
}
/** The guides objects snap to: none while guides are hidden. */
export const snapGuideLines = () => (documentOpen && getPreference('view.guides') ? [...manualGuides(), ...layoutGuideLines()] : []);

/** Replaces the figure's guides (one History step). */
export function setGuides(list) {
  const props = { ...docProps, guides: M.guidesOf({ guides: list }) };
  if (!props.guides.length) delete props.guides;
  applyDocProps(props);
  pushHistory();
  refreshGuides();
}
export const addGuide = (axis, pos) => setGuides([...manualGuides(), { axis, pos }]);
export const moveGuide = (index, pos) => setGuides(manualGuides().map((g, i) => (i === index ? { ...g, pos } : g)));
export const removeGuide = index => setGuides(manualGuides().filter((_, i) => i !== index));
/** Sets the margin (mm) and whether the journal's column guides show (one History step). */
export function setLayoutGuides(values) {
  const next = { ...M.layoutSettings(docProps), ...values };
  const props = { ...docProps, layoutGuides: { marginMm: Math.max(0, Number(next.marginMm) || 0), columns: next.columns !== false } };
  if (!props.layoutGuides.marginMm && props.layoutGuides.columns) delete props.layoutGuides;
  applyDocProps(props);
  pushHistory();
  refreshGuides();
}

// ---- drawing over the canvas ----
function drawGuides(ctx) {
  if (!documentOpen || !getPreference('view.guides')) return;
  const vpt = canvas.viewportTransform, w = canvas.getWidth(), h = canvas.getHeight();
  const line = (g, colour, dash) => {
    ctx.strokeStyle = colour; ctx.setLineDash(dash); ctx.beginPath();
    if (g.axis === 'v') { const x = Math.round(g.pos * vpt[0] + vpt[4]) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    else { const y = Math.round(g.pos * vpt[3] + vpt[5]) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  };
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = 1;
  layoutGuideLines().forEach(g => line(g, LAYOUT_COLOUR, [6, 4]));
  manualGuides().forEach((g, i) => { if (!(dragging && dragging.index === i)) line(g, GUIDE_COLOUR, []); });
  if (dragging && dragging.pos != null) line(dragging, GUIDE_COLOUR, [3, 3]);
  ctx.restore();
}

// ---- rulers ----
const cssVar = name => getComputedStyle(document.body).getPropertyValue(name).trim() || '#888';
function sizeCanvas(el, w, h) {
  const r = window.devicePixelRatio || 1;
  if (el.width !== Math.round(w * r) || el.height !== Math.round(h * r)) { el.width = Math.round(w * r); el.height = Math.round(h * r); }
  el.style.width = w + 'px'; el.style.height = h + 'px';
  const ctx = el.getContext('2d'); ctx.setTransform(r, 0, 0, r, 0, 0);
  return ctx;
}
/** Where document px land on the visible canvas area (screen px from its top-left corner). */
function viewMap() {
  const m = canvasViewMetrics(), vpt = canvas.viewportTransform;
  return { wrap: m.wrap, k: vpt[0], x0: m.offsetX - m.wrap.scrollLeft + vpt[4], y0: m.offsetY - m.wrap.scrollTop + vpt[5] };
}
/** Draws both rulers for the current zoom and scroll position. */
export function drawRulers() {
  const box = $('rulers');
  if (!box || !canvas) return;
  const show = documentOpen && getPreference('view.rulers');
  box.hidden = !show;
  if (!show) return;
  const v = viewMap(), W = v.wrap.clientWidth, H = v.wrap.clientHeight, unit = docProps.unit || 'px', dpi = docProps.dpi || 300;
  const bg = cssVar('--panel'), fg = cssVar('--text-dim'), line = cssVar('--border'), mark = cssVar('--accent');
  $('ruler-corner').textContent = unit;
  // Top ruler: x from the page's left edge.
  let ctx = sizeCanvas($('ruler-top'), W, RULER);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, RULER);
  ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(0, RULER - 0.5); ctx.lineTo(W, RULER - 0.5); ctx.stroke();
  ctx.font = '10px "Liberation Sans", sans-serif'; ctx.fillStyle = fg; ctx.strokeStyle = fg; ctx.textBaseline = 'top';
  const top = M.rulerTicks((RULER - v.x0) / v.k, (W - v.x0) / v.k, 0, unit, dpi, v.k);
  ctx.beginPath();
  for (const t of top.ticks) {
    const x = Math.round(v.x0 + t.pos * v.k) + 0.5;
    if (x < RULER) continue;
    ctx.moveTo(x, RULER); ctx.lineTo(x, RULER - (t.major ? 10 : 4));
    if (t.major) ctx.fillText(M.tickLabel(t.value), x + 2, 1);
  }
  ctx.stroke();
  // Left ruler: y from each page's top edge.
  ctx = sizeCanvas($('ruler-left'), RULER, H);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, RULER, H);
  ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(RULER - 0.5, 0); ctx.lineTo(RULER - 0.5, H); ctx.stroke();
  ctx.font = '10px "Liberation Sans", sans-serif'; ctx.fillStyle = fg; ctx.strokeStyle = fg;
  const fromY = (RULER - v.y0) / v.k, toY = (H - v.y0) / v.k;
  for (let i = 0; i < pageCount(); i++) {
    const p = pageBounds(i), next = i + 1 < pageCount() ? pageBounds(i + 1).top : Infinity, prev = i > 0 ? pageBounds(i - 1).top + pageBounds(i - 1).height : -Infinity;
    const lo = Math.max(fromY, i > 0 ? (prev + p.top) / 2 : -Infinity), hi = Math.min(toY, next < Infinity ? (p.top + p.height + next) / 2 : Infinity);
    if (lo >= hi) continue;
    ctx.beginPath();
    for (const t of M.rulerTicks(lo, hi, p.top, unit, dpi, v.k).ticks) {
      const y = Math.round(v.y0 + t.pos * v.k) + 0.5;
      if (y < RULER || t.pos < lo || t.pos > hi) continue;
      ctx.moveTo(RULER, y); ctx.lineTo(RULER - (t.major ? 10 : 4), y);
      if (t.major) { ctx.save(); ctx.translate(1, y - 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'top'; ctx.fillText(M.tickLabel(t.value), 0, 0); ctx.restore(); }
    }
    ctx.stroke();
  }
  // The selection's extent, on both rulers.
  const active = canvas.getActiveObject();
  if (active) {
    const b = active.getBoundingRect(true, true);
    ctx.fillStyle = mark; ctx.globalAlpha = 0.25; ctx.fillRect(0, v.y0 + b.top * v.k, RULER, b.height * v.k);
    const tctx = $('ruler-top').getContext('2d'); tctx.fillStyle = mark; tctx.globalAlpha = 0.25; tctx.fillRect(v.x0 + b.left * v.k, 0, b.width * v.k, RULER); tctx.globalAlpha = 1;
    ctx.globalAlpha = 1;
  }
}

// ---- dragging guides ----
const overRuler = (x, y) => ['ruler-top', 'ruler-left'].some(id => { const el = $(id), r = el && !$('rulers').hidden ? el.getBoundingClientRect() : null; return r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
function startDrag(axis, index) {
  dragging = { axis, pos: index >= 0 ? manualGuides()[index].pos : null, index };
  const move = e => { const p = canvas.getPointer(e); dragging.pos = axis === 'v' ? p.x : p.y; canvas.requestRenderAll(); };
  const up = e => {
    window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
    const d = dragging; dragging = null;
    if (overRuler(e.clientX, e.clientY) || d.pos == null) { if (d.index >= 0) removeGuide(d.index); else canvas.requestRenderAll(); return; }
    if (d.index >= 0) moveGuide(d.index, d.pos); else addGuide(d.axis, d.pos);
  };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
}
/** The manual guide under a pointer event on the canvas (within 4 screen px), or -1. */
function guideUnder(e) {
  if (!documentOpen || !getPreference('view.guides') || currentTool !== 'select') return -1;
  return M.guideAt(manualGuides(), canvas.getPointer(e), 4 / canvas.viewportTransform[0]);
}

// ---- the top bar ----
function toggle(key) {
  const next = !getPreference(key);
  if (isProjectOverride(key)) setProjectPreference(key, next); else setGlobalPreference(key, next);
}
function refreshButtons() {
  for (const [id, key, on, off] of [['btn-snap', 'snap.enabled', 'Snap on', 'Snap off'], ['btn-rulers', 'view.rulers', 'Rulers', 'Rulers']]) {
    const b = $(id); if (!b) continue;
    const value = !!getPreference(key);
    b.setAttribute('aria-pressed', String(value)); b.classList.toggle('active', value); b.textContent = value ? on : off;
  }
}
/** Redraws guides and rulers and refreshes the buttons (and the dialog, if open). */
export function refreshGuides() {
  refreshButtons();
  if (canvas) canvas.requestRenderAll();
  drawRulers();
  const dialog = document.querySelector('.guides-backdrop');
  if (dialog && dialog.refresh) dialog.refresh();
}

// ---- the Guides dialog (the keyboard path) ----
const unitPx = () => M.pxPerUnit(docProps.unit || 'px', docProps.dpi || 300);
const pageOfY = y => { let best = 0; for (let i = 0; i < pageCount(); i++) if (pageBounds(i).top <= y) best = i; return best; };
const shownPos = g => (g.axis === 'v' ? g.pos / unitPx() : (g.pos - pageBounds(pageOfY(g.pos)).top) / unitPx());
const docPos = (axis, value, page = 0) => (axis === 'v' ? value * unitPx() : pageBounds(Math.min(page, pageCount() - 1)).top + value * unitPx());
const round = v => String(Math.round(v * 1000) / 1000);

export function showGuidesDialog() {
  if (!documentOpen || document.querySelector('.guides-backdrop')) return;
  const active = document.activeElement, opener = active && active !== document.body ? active : $('btn-guides');
  const el = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text != null) e.textContent = text; return e; };
  const backdrop = el('div', 'modal-backdrop guides-backdrop'), dialog = el('div', 'modal guides-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'guides-title');
  const title = el('h2', null, 'Guides'); title.id = 'guides-title';
  const intro = el('p', 'hint', 'Drag from a ruler onto the page to make a guide; drag a guide back onto a ruler to delete it. Positions are from the page\'s top-left corner. Guides are never exported.');
  const check = (id, text, tip, value, onChange) => {
    const label = el('label', 'guides-check'), box = el('input'); box.type = 'checkbox'; box.id = id; box.checked = value; label.title = tip;
    box.addEventListener('change', () => onChange(box.checked)); label.append(box, document.createTextNode(' ' + text)); return label;
  };
  const list = el('div', 'guides-list'); list.setAttribute('role', 'list');
  const addAxis = el('select'); addAxis.id = 'guides-add-axis'; addAxis.title = 'A vertical guide (at a distance from the left edge) or a horizontal one (from the top edge)';
  for (const [v, t] of [['v', 'Vertical'], ['h', 'Horizontal']]) { const o = el('option', null, t); o.value = v; addAxis.append(o); }
  const addPos = el('input'); addPos.type = 'number'; addPos.step = 'any'; addPos.id = 'guides-add-pos'; addPos.value = '1';
  const addButton = el('button', null, 'Add guide'); addButton.id = 'guides-add'; addButton.title = 'Add a guide at this position';
  const unitLabel = el('span', 'unit-suffix');
  const addRow = el('div', 'guides-row'); addRow.append(addAxis, addPos, unitLabel, addButton);
  const margin = el('input'); margin.type = 'number'; margin.min = '0'; margin.step = '0.5'; margin.id = 'guides-margin';
  const marginLabel = el('label', 'guides-field', 'Margin (mm) '); marginLabel.title = 'Margin guides this far inside every page edge (0: none); the column guides start at the left margin'; marginLabel.append(margin);
  const columnsBox = el('div');
  const clear = el('button', null, 'Delete all guides'); clear.id = 'guides-clear'; clear.title = 'Delete every guide dragged from the rulers (the margin and column guides stay)';
  const close = el('button', 'primary-button', 'Close'); close.id = 'guides-close'; close.title = 'Close (Esc)';
  const buttons = el('div', 'btn-row'); buttons.append(clear, close);
  dialog.append(title, intro, check('guides-show', 'Show guides', 'Show the guides and the margin and column guides', getPreference('view.guides'), v => setGlobalPreference('view.guides', v)),
    check('guides-snap', 'Snap to guides', 'Snap object edges and centres to the guides', getPreference('snap.toGuides'), v => setGlobalPreference('snap.toGuides', v)),
    list, addRow, marginLabel, columnsBox, buttons);
  backdrop.append(dialog); document.body.append(backdrop);

  backdrop.refresh = () => {
    unitLabel.textContent = docProps.unit || 'px';
    addPos.title = `Distance from the page's ${addAxis.value === 'v' ? 'left' : 'top'} edge, in ${docProps.unit || 'px'}`;
    const guides = manualGuides();
    list.replaceChildren(...(guides.length ? guides.map((g, i) => {
      const row = el('div', 'guides-row'); row.setAttribute('role', 'listitem');
      const name = el('span', 'guides-name', g.axis === 'v' ? 'Vertical' : `Horizontal${pageCount() > 1 ? ', page ' + (pageOfY(g.pos) + 1) : ''}`);
      const input = el('input'); input.type = 'number'; input.step = 'any'; input.value = round(shownPos(g)); input.id = 'guides-pos-' + i;
      input.title = `Distance from the page's ${g.axis === 'v' ? 'left' : 'top'} edge, in ${docProps.unit || 'px'}`;
      input.addEventListener('change', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) moveGuide(i, docPos(g.axis, v, pageOfY(g.pos))); });
      const del = el('button', null, 'Delete'); del.id = 'guides-delete-' + i; del.title = 'Delete this guide';
      del.addEventListener('click', () => { removeGuide(i); (list.querySelector('input') || addPos).focus(); });
      row.append(name, input, el('span', 'unit-suffix', docProps.unit || 'px'), del);
      return row;
    }) : [el('p', 'hint', 'No guides yet.')]));
    const s = M.layoutSettings(docProps);
    if (document.activeElement !== margin) margin.value = String(s.marginMm);
    const widths = presetColumns();
    columnsBox.replaceChildren(widths.length
      ? check('guides-columns', `Column guides of ${docProps.journalPreset.name} (${widths.join(', ')} mm)`, 'Vertical guides at the journal\'s column widths, measured from the left margin', s.columns, v => setLayoutGuides({ columns: v }))
      : el('p', 'hint', 'Column guides: choose a journal in Create figure to get its column widths.'));
    clear.disabled = !guides.length;
  };
  addAxis.addEventListener('change', backdrop.refresh);
  addButton.addEventListener('click', () => { const v = parseFloat(addPos.value); if (Number.isFinite(v)) addGuide(addAxis.value, docPos(addAxis.value, v)); });
  margin.addEventListener('change', () => { const v = parseFloat(margin.value); if (Number.isFinite(v) && v >= 0) setLayoutGuides({ marginMm: v }); });
  clear.addEventListener('click', () => setGuides([]));
  const done = () => { backdrop.remove(); if (opener && opener.focus) opener.focus(); };
  close.addEventListener('click', done);
  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); done(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('input, select, button')].filter(x => !x.disabled), first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  backdrop.refresh();
  dialog.querySelector('#guides-show').focus();
}

/** Connects rulers, guides and the top bar buttons (once, when the editor loads; the canvas comes later). */
export function installGuides() {
  if (installGuides.done) return;
  installGuides.done = true;
  loadJournalPresets().then(f => { families = f; refreshGuides(); }).catch(() => {});
  $('btn-snap').addEventListener('click', () => toggle('snap.enabled'));
  $('btn-rulers').addEventListener('click', () => toggle('view.rulers'));
  $('btn-guides').addEventListener('click', showGuidesDialog);
  ['ruler-top', 'ruler-left'].forEach(id => $(id).addEventListener('mousedown', e => {
    if (!documentOpen || e.button !== 0) return;
    e.preventDefault();
    if (!getPreference('view.guides')) setGlobalPreference('view.guides', true);
    startDrag(id === 'ruler-top' ? 'h' : 'v', -1);
  }));
  $('canvas-wrap').addEventListener('scroll', drawRulers, { passive: true });
  window.addEventListener('resize', drawRulers);
  window.addEventListener('mfc:changed', refreshGuides);
  onPreferenceChange(refreshGuides);
  const attach = () => {
    if (!canvas) { requestAnimationFrame(attach); return; }
    canvas.on('after:render', opt => { drawGuides(opt && opt.ctx ? opt.ctx : canvas.getContext()); drawRulers(); });
    // A guide on the canvas is picked up before Fabric sees the click.
    // A handle of the selected object wins over a guide under it: an edge that just snapped onto a
    // guide can be grabbed again (PI-T6).
    const handleUnder = e => { const a = canvas.getActiveObject(); return !!(a && a.hasControls && a._findTargetCorner && a._findTargetCorner(canvas.getPointer(e, true))); };
    canvas.wrapperEl.addEventListener('mousedown', e => {
      const i = e.button === 0 ? guideUnder(e) : -1;
      if (i < 0 || handleUnder(e)) return;
      e.stopPropagation(); e.preventDefault();
      startDrag(manualGuides()[i].axis, i);
    }, true);
    canvas.on('mouse:move', opt => { if (!opt.target && !dragging) { const i = guideUnder(opt.e); if (i >= 0) canvas.setCursor(manualGuides()[i].axis === 'v' ? 'col-resize' : 'row-resize'); } });
    refreshGuides();
  };
  attach();
}

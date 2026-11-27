/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Text tool: text boxes with a box size independent of the font size, borders, the Text panel and styling (also of a highlighted range). */

import { canvas, currentTool, takeId } from '../core/state.js';
import { pushHistory } from '../core/history.js';
import { getPreference, setGlobalPreference } from '../core/preferences.js';
import { zoomLevel } from '../core/zoom.js';
import { align } from '../layout/align.js';
import { refuseLocked } from '../ui/locks.js';
import { refreshSelectionBar } from '../ui/selection-bar.js';

// ---- text panel (re-populates whenever a text box is selected/reselected) ----
export function refreshTextPanel() {
  const panel = document.getElementById('panel-text');
  const boxes = getSelectedTextboxes();
  panel.classList.toggle('hidden', !(boxes.length || currentTool === 'text'));
  // Snap when resizing (PI-T6): the Text tool's option, a preference (also in Preferences → Text).
  const snapBox = document.getElementById('text-snap-resize');
  if (snapBox) {
    snapBox.checked = !!getPreference('text.snapResize');
    if (!snapBox.__mfcWired) { snapBox.__mfcWired = true; snapBox.addEventListener('change', e => setGlobalPreference('text.snapResize', e.target.checked)); }
  }
  if (!boxes.length) return;
  const active = boxes[0]; // representative values shown when multiple are selected — edits still apply to every selected box, see applyTextStyle/applyTextBorder/applyTextAlign

  document.getElementById('text-font').value = active.fontFamily || 'Arial';
  const sizeField = document.getElementById('text-size');
  if (document.activeElement !== sizeField) sizeField.value = Math.round(effectiveFontSize(active) * 100) / 100; // px; the field may show pt
  document.getElementById('text-color').value = /^#/.test(active.fill) ? active.fill : '#000000';
  const hasBg = active.backgroundColor && /^#/.test(active.backgroundColor);
  document.getElementById('text-bg-enabled').checked = !!hasBg;
  document.getElementById('text-bg-color').value = hasBg ? active.backgroundColor : '#000000';
  document.getElementById('text-border-enabled').checked = !!(active.mfcBorderWidth > 0);
  document.getElementById('text-border-width').value = active.mfcBorderWidth || 2;
  document.getElementById('text-border-color').value = active.mfcBorderColor || '#000000';
  document.getElementById('text-bold').classList.toggle('active', active.fontWeight === 'bold');
  document.getElementById('text-italic').classList.toggle('active', active.fontStyle === 'italic');
  document.getElementById('text-underline').classList.toggle('active', !!active.underline);
  // Super- and subscript: of the character at the caret (or the first highlighted one) while editing, else the first.
  const at = active.isEditing ? active.selectionStart : (lastTextSelection && lastTextSelection.id === active.mfcId ? lastTextSelection.start : 0);
  const script = scriptAt(active, at);
  for (const kind of ['superscript', 'subscript']) {
    const b = document.getElementById('text-' + kind);
    if (b) { b.classList.toggle('active', script === kind); b.setAttribute('aria-pressed', String(script === kind)); }
  }
  ['left', 'center', 'right'].forEach(a =>
    document.getElementById('text-align-' + a).classList.toggle('active', (active.textAlign || 'left') === a));
  ['top', 'middle', 'bottom'].forEach(a =>
    document.getElementById('text-valign-' + a).classList.toggle('active', (active.mfcVAlign || 'top') === a));
}

/** The size the glyphs are actually drawn at: the style under the caret/selection while editing, else the box fontSize, times any not-yet-normalized scale (projects from earlier versions may still carry one). */
export function effectiveFontSize(box) {
  let size = box.fontSize || 24;
  if (box.isEditing && box.getSelectionStyles) {
    const style = box.getSelectionStyles(box.selectionStart, box.selectionStart + 1)[0];
    if (style && style.fontSize) size = style.fontSize;
  }
  return size * Math.abs(box.scaleY || 1);
}

/** Folds a text box's scale into fontSize (and character styles), width and box height, leaving scale at 1. Returns whether anything changed. */
export function normalizeTextScale(box) {
  const sx = Math.abs(box.scaleX || 1), sy = Math.abs(box.scaleY || 1);
  if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) return false;
  Object.values(box.styles || {}).forEach(line => Object.values(line).forEach(style => {
    if (style.fontSize) style.fontSize = Math.max(1, style.fontSize * sy);
    if (style.deltaY) style.deltaY *= sy; // a super- or subscript keeps its place
  }));
  const boxHeight = box.mfcBoxHeight ? box.mfcBoxHeight * sy : null;
  box.set({ fontSize: Math.max(1, Math.round(box.fontSize * sy)), width: Math.max(10, box.width * sx),
    scaleX: 1, scaleY: 1 });
  if (boxHeight) box.set('mfcBoxHeight', boxHeight);
  box.initDimensions();
  box.setCoords();
  return true;
}

/** Resizes the text box only — the font size never changes. Height sets a minimum box height; the box still grows to fit its text. */
export function applyTextBoxSize(prop, value) {
  const active = canvas.getActiveObject();
  if (!active || active.type !== 'textbox' || !(value > 0)) return;
  if (refuseLocked(active, 'resized')) { refreshSelectionBar(); return; }
  normalizeTextScale(active);
  if (prop === 'width') active.set({ width: Math.max(10, value) });
  else if (prop === 'height') active.set('mfcBoxHeight', value);
  active.setCoords();
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: active });
  refreshTextPanel();
}

export function applyTextVerticalAlign(align) {
  const boxes = getSelectedTextboxes();
  if (!boxes.length) return;
  boxes.forEach(box => { box.mfcVAlign = align; box.dirty = true; });
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: canvas.getActiveObject() });
  refreshTextPanel();
}

/** Centers the text both ways inside its box (C1). */
export function centerTextInBox() {
  const boxes = getSelectedTextboxes();
  if (!boxes.length) return;
  boxes.forEach(box => { if (box.isEditing) box.exitEditing(); box.set('textAlign', 'center'); box.mfcVAlign = 'middle'; box.dirty = true; });
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: canvas.getActiveObject() });
  refreshTextPanel();
}

// ---- text tool ----
export let lastTextSelection = null; // {id, start, end} — captured while editing so the side
                               // panel can still restyle a highlighted range after the
                               // panel control (e.g. color swatch) steals focus.
export function forgetTextSelection() { lastTextSelection = null; }
/** Remembers a caret or range of a text box for the panel (after a palette insert). */
export function rememberTextSelection(sel) { lastTextSelection = sel; }
/** 'superscript', 'subscript' or null: the script of the character at `index` (Fabric's deltaY style). */
export function scriptAt(box, index) {
  if (!box || !box.text) return null;
  const loc = box.get2DCursorLocation(Math.max(0, Math.min(index, box.text.length - 1)), true);
  const style = box.styles && box.styles[loc.lineIndex] && box.styles[loc.lineIndex][loc.charIndex];
  return style && style.deltaY ? (style.deltaY < 0 ? 'superscript' : 'subscript') : null;
}

export function attachTextListeners(t) {
  t.on('selection:changed', () => {
    if (t.isEditing) lastTextSelection = { id: t.mfcId, start: t.selectionStart, end: t.selectionEnd };
    refreshTextPanel();
  });
  t.on('changed', () => refreshSelectionBar());
  if (t.mfcBoxHeight) { t.initDimensions(); t.setCoords(); }
  t.on('editing:exited', () => { refreshTextPanel(); });
  t.on('editing:entered', () => { refreshTextPanel(); });
  installTextBorderRenderer(t);
}

// Matches installTextBorderRenderer's canvas _render override (below), but for the
// canvas.toSVG() export path, which never calls _render at all — it uses Fabric's own
// _toSVG() text-markup builder instead. Without this, the box border only showed up in
// the app itself and in PDF export (which rasterizes the canvas, so it "sees" _render's
// strokeRect), while SVG export silently dropped it. Patched once, globally, on the
// Text prototype (mfcBorderWidth defaults to 0/undefined on plain text boxes, so this
// is a no-op for any textbox that never had a border applied).
// Super- and subscripts (a deltaY style): Fabric writes both a dy attribute and a baseline-shift style on
// their tspan. Chromium applies both (the character is raised twice as far), Firefox and svg2pdf only dy;
// so exports keep dy alone, which every renderer reads the same way.
const baseSpanStyles = fabric.Text.prototype.getSvgSpanStyles;
fabric.Text.prototype.getSvgSpanStyles = function (style, useWhiteSpace) {
  return baseSpanStyles.call(this, style, useWhiteSpace).replace(/baseline-shift: [^;]*; /, '');
};

fabric.util.object.extend(fabric.Text.prototype, {
  _toSVG: function () {
    const offsets = this._getSVGLeftTopOffsets();
    const textAndBg = this._getSVGTextAndBg(offsets.textTop, offsets.textLeft);
    const svg = this._wrapSVGTextAndBg(textAndBg);
    if (this.mfcBorderWidth > 0) {
      const toFixed = fabric.util.toFixed, digits = fabric.Object.NUM_FRACTION_DIGITS;
      svg.push(
        '\t\t<rect x="', toFixed(-this.width / 2, digits), '" y="', toFixed(-this.height / 2, digits),
        '" width="', toFixed(this.width, digits), '" height="', toFixed(this.height, digits),
        '" fill="none" stroke="', (this.mfcBorderColor || '#000000'),
        '" stroke-width="', this.mfcBorderWidth, '" />\n'
      );
    }
    return svg;
  }
});

// ---- text box geometry: a real box whose size is independent of the font size ----
// mfcBoxHeight is a minimum box height (the box still grows to fit its text) and
// mfcVAlign ('top' | 'middle' | 'bottom') places the text block inside it. Both are
// optional, so projects saved before they existed load and render unchanged.
export const TextboxProto = fabric.Textbox.prototype;
TextboxProto._dimensionAffectingProps = TextboxProto._dimensionAffectingProps.concat(['mfcBoxHeight']);
export const baseTextboxInitDimensions = TextboxProto.initDimensions;
TextboxProto.initDimensions = function () {
  if (this.__skipDimension) return;
  baseTextboxInitDimensions.call(this);
  this._mfcTextHeight = this.height;
  if (this.mfcBoxHeight > this.height) this.height = this.mfcBoxHeight;
};
TextboxProto._mfcVerticalOffset = function () {
  const extra = this.height - (this._mfcTextHeight ?? this.height);
  return extra > 0 ? extra * ({ middle: 0.5, bottom: 1 }[this.mfcVAlign] || 0) : 0;
};
// Text drawing, decorations, the editing caret and selection all start from _getTopOffset.
TextboxProto._getTopOffset = function () { return -this.height / 2 + this._mfcVerticalOffset(); };
// SVG (and therefore PDF) export: the background still covers the whole box, the lines start at the offset.
TextboxProto._getSVGLeftTopOffsets = function () {
  return { textLeft: -this.width / 2, textTop: this._getTopOffset(), lineTop: this.getHeightOfLine(0) };
};
export const baseSelectionFromPointer = TextboxProto.getSelectionStartFromPointer;
TextboxProto.getSelectionStartFromPointer = function (e) {
  const offset = this._mfcVerticalOffset();
  if (!offset) return baseSelectionFromPointer.call(this, e);
  const localPointer = this.getLocalPointer;
  this.getLocalPointer = function (...args) { const p = localPointer.apply(this, args); p.y -= offset * this.scaleY; return p; };
  try { return baseSelectionFromPointer.call(this, e); } finally { delete this.getLocalPointer; }
};
// Top/bottom handles resize the box height (like the side handles already resize its
// width); only the corner handles scale the text itself.
export function changeTextBoxHeight(eventData, transform, x, y) {
  const target = transform.target;
  const localPoint = fabric.controlsUtils.getLocalPoint(transform, transform.originX, transform.originY, x, y);
  const multiplier = transform.originX === 'center' && transform.originY === 'center' ? 2 : 1;
  const oldHeight = target.height;
  target.set('mfcBoxHeight', Math.max(1, Math.abs(localPoint.y * multiplier / (target.scaleY || 1))));
  return target.height !== oldHeight;
}
export const textBoxHeightHandler = fabric.controlsUtils.wrapWithFireEvent('resizing',
  fabric.controlsUtils.wrapWithFixedAnchor(changeTextBoxHeight));
TextboxProto.controls = { ...TextboxProto.controls,
  mt: new fabric.Control({ x: 0, y: -0.5, actionHandler: textBoxHeightHandler,
    cursorStyleHandler: fabric.controlsUtils.scaleSkewCursorStyleHandler, actionName: 'resizing' }),
  mb: new fabric.Control({ x: 0, y: 0.5, actionHandler: textBoxHeightHandler,
    cursorStyleHandler: fabric.controlsUtils.scaleSkewCursorStyleHandler, actionName: 'resizing' }) };

/**
 * Fabric's native stroke/strokeWidth on a Textbox outlines each glyph, not the box —
 * so a true "box border" (line width + color around the whole text box) needs a small
 * custom renderer layered on top of the normal text render.
 */
export function installTextBorderRenderer(t) {
  if (t.__mfcBorderInstalled) return;
  t.__mfcBorderInstalled = true;
  if (t.mfcBorderWidth === undefined) t.mfcBorderWidth = 0;
  if (t.mfcBorderColor === undefined) t.mfcBorderColor = '#000000';
  // Fabric only re-renders an object's cached bitmap when it recognizes the changed
  // property as "cache-affecting." Our custom mfcBorderWidth/mfcBorderColor aren't in
  // that list, so edits to them (and sometimes backgroundColor) could silently redraw
  // a stale cached bitmap. Disabling caching for text boxes sidesteps the whole bug
  // class — cheap for the handful of small text objects a figure typically has.
  t.objectCaching = false;
  const originalRender = t._render.bind(t);
  t._render = function (ctx) {
    originalRender(ctx);
    if (this.mfcBorderWidth > 0) {
      ctx.save();
      ctx.strokeStyle = this.mfcBorderColor || '#000000';
      ctx.lineWidth = this.mfcBorderWidth;
      ctx.strokeRect(-this.width / 2, -this.height / 2, this.width, this.height);
      ctx.restore();
    }
  };
}

/** Every currently-selected text box — a single directly-selected one, or all text boxes within a multi-selection (non-textbox objects in a mixed selection are simply skipped). */
export function getSelectedTextboxes() {
  const active = canvas.getActiveObject();
  if (!active) return [];
  if (active.type === 'textbox') return [active];
  if (active.type === 'activeSelection') return active.getObjects().filter(o => o.type === 'textbox');
  return [];
}

export function applyTextBorder(prop, value) {
  const boxes = getSelectedTextboxes();
  if (!boxes.length) return;
  boxes.forEach(box => {
    if (box.isEditing) box.exitEditing(); // avoid racing Fabric's async editing-exit
    box.set(prop, value);
    box.dirty = true;
    box.setCoords();
  });
  canvas.renderAll(); // synchronous — don't rely solely on the scheduled requestRenderAll
  canvas.fire('object:modified', { target: canvas.getActiveObject() });
}

export function toHexColor(c) {
  if (!c) return null;
  if (/^#/.test(c)) return c;
  const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return '#' + [1, 2, 3].map(i => parseInt(m[i], 10).toString(16).padStart(2, '0')).join('');
}

/** Apply a style prop either to a highlighted text range (per-word/char formatting) or the whole box. */
/** Applies a single style prop to one text box — respects a highlighted per-character range if allowRangeSelection is true (only meaningful when exactly one box is targeted directly; a range can't span multiple separate text box objects). */
export function applyTextStyleToBox(box, prop, value, allowRangeSelection) {
  // backgroundColor is a whole-textbox property in Fabric — there is no such thing as a
  // per-character "backgroundColor" (that's the separate `textBackgroundColor` style).
  // Routing it through the selection-range branch below was a silent no-op whenever a
  // leftover highlighted range existed (e.g. right after coloring some words), which is
  // why the "Box background" toggle sometimes stopped updating. Always apply it whole-box.
  if (prop === 'backgroundColor') {
    if (box.isEditing) box.exitEditing();
    box.set('backgroundColor', value);
    box.dirty = true;
    box.setCoords();
    return;
  }

  let sel = null;
  if (allowRangeSelection) {
    const savedSel = (lastTextSelection && lastTextSelection.id === box.mfcId) ? lastTextSelection : null;
    const liveSel = box.isEditing ? { start: box.selectionStart, end: box.selectionEnd } : null;
    sel = (liveSel && liveSel.start !== liveSel.end) ? liveSel
        : (savedSel && savedSel.start !== savedSel.end) ? savedSel
        : null;
  }
  if (box.isEditing) box.exitEditing(); // avoid racing Fabric's async editing-exit (captured sel above first)

  if (prop === 'fontSize') normalizeTextScale(box);
  if (sel) {
    box.setSelectionStyles({ [prop]: value }, sel.start, sel.end);
  } else {
    // A whole-box value must win over older per-character overrides, otherwise the
    // field would show a size that isn't what's drawn.
    if (prop === 'fontSize') {
      // Super- and subscripts keep their size and shift relative to the new size; other sizes go.
      const ratio = value / (box.fontSize || value);
      Object.values(box.styles || {}).forEach(line => Object.entries(line).forEach(([i, style]) => {
        if (style.deltaY) { style.deltaY *= ratio; if (style.fontSize) style.fontSize *= ratio; }
        else { delete style.fontSize; if (!Object.keys(style).length) delete line[i]; }
      }));
    } else if (box.removeStyle) box.removeStyle(prop);
    box.set(prop, value);
  }
  if (prop === 'fontSize') box.initDimensions();
  box.dirty = true;
  box.setCoords();
}

export function applyTextStyle(prop, value) {
  const boxes = getSelectedTextboxes();
  if (!boxes.length) return;
  if (prop === 'fontSize' && !(value > 0)) { refreshTextPanel(); return; }
  // Highlighted-word-range styling only applies when the selection IS a single text box
  // being edited directly — with several boxes selected as a group there's no shared
  // "highlighted range" across separate objects, so each whole box gets the style.
  const isSingle = boxes.length === 1 && canvas.getActiveObject().type === 'textbox';
  boxes.forEach(box => applyTextStyleToBox(box, prop, value, isSingle));
  canvas.renderAll(); // synchronous — don't rely solely on the scheduled requestRenderAll
  canvas.fire('object:modified', { target: canvas.getActiveObject() });
  refreshTextPanel();
}

export function applyTextAlign(align) {
  const boxes = getSelectedTextboxes();
  if (!boxes.length) return;
  boxes.forEach(box => box.set('textAlign', align));
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: canvas.getActiveObject() });
  refreshTextPanel();
}

// ---- tool interface (used by tools/tool-switch.js) ----
/** Choosing or leaving the Text tool changes nothing by itself: the next click on the canvas adds a text box. */
function activateTextTool() {}
function deactivateTextTool() {}
export { activateTextTool as activate, deactivateTextTool as deactivate, refreshTextPanel as refreshPanel };

// ---- drawing a text box (PI-T6) ----
// With the Text tool, a click inserts a text box as before (200 px wide); a drag draws one of the dragged
// size: its width, and its height as the box's own height (mfcBoxHeight), so it keeps that size when typed
// into (it still grows if its text needs more room). A dashed rectangle shows the box while dragging.
const DRAG_MIN_SCREEN_PX = 4;
let textDrag = null;
export const textDragActive = () => !!textDrag;
export function startTextDrag(pointer) {
  textDrag = { start: { x: pointer.x, y: pointer.y }, preview: null };
}
/** Follows the pointer while drawing a text box; returns whether a text drag is in progress. */
export function moveTextDrag(opt) {
  if (!textDrag) return false;
  const p = canvas.getPointer(opt.e), s = textDrag.start;
  if (!textDrag.preview) {
    if (Math.hypot(p.x - s.x, p.y - s.y) * zoomLevel < DRAG_MIN_SCREEN_PX) return true;
    textDrag.preview = new fabric.Rect({ fill: 'rgba(91, 140, 255, 0.08)', stroke: '#5b8cff', strokeWidth: 1, strokeUniform: true, strokeDashArray: [6, 4],
      selectable: false, evented: false, objectCaching: false });
    textDrag.preview.mfcIsPreview = true;
    canvas.add(textDrag.preview);
  }
  textDrag.preview.set({ left: Math.min(s.x, p.x), top: Math.min(s.y, p.y), width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y) });
  textDrag.preview.setCoords();
  canvas.requestRenderAll();
  return true;
}
/** Ends a click or a drag of the Text tool with a new text box; returns whether there was one. */
export function endTextDrag() {
  if (!textDrag) return false;
  const { start, preview } = textDrag;
  textDrag = null;
  let box = null;
  if (preview) {
    box = { left: preview.left, top: preview.top, width: preview.width, height: preview.height };
    canvas.remove(preview);
  }
  addTextBox(start, box);
  return true;
}
/** A new text box at `point` (a click), or filling `box` (a drag); one History step, then the Select tool. */
export function addTextBox(point, box = null) {
  const t = new fabric.Textbox('Text', {
    left: box ? box.left : point.x, top: box ? box.top : point.y, width: box ? Math.max(10, box.width) : 200,
    // Preferences → Text (a project can override them).
    fontFamily: getPreference('text.fontFamily'),
    fontSize: getPreference('text.fontSize'),
    fill: getPreference('text.color'),
    textAlign: 'left'
  });
  t.mfcId = 'txt' + takeId();
  t.mfcType = 'text';
  if (box && box.height > 1) t.mfcBoxHeight = box.height;
  attachTextListeners(t);
  canvas.add(t);
  t.initDimensions(); t.setCoords();
  canvas.setActiveObject(t);
  t.enterEditing();
  canvas.requestRenderAll();
  pushHistory();
  MFC.setTool('select');
  return t;
}

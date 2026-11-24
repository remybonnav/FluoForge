/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Panel letters (P3-T3). A lettered panel is an image with `mfcLetter` ({ skip, text }: skipped, or its
   own text instead of the automatic letter); its letter is an ordinary text box with `mfcLetterFor` (the
   panel's id). Letters are numbered A, B, C… in reading order over the whole document (js/layout/
   letters-model.js) and styled from `docProps.letterStyle`, set once per document. They follow their
   panel (syncAttachments) and are renumbered before every History step, so after any change that can
   reorder, add or delete panels (a drag, a grid, a quick figure, paste, delete) they are in order. Deleting a letter takes its panel out of the lettering; editing a letter's text
   gives that panel its own text. */

import { history, onBeforeHistoryStep, pushHistory } from '../core/history.js';
import { applyDocProps, pageIndexForBox } from '../core/pages.js';
import { getPreference } from '../core/preferences.js';
import { canvas, docProps, documentOpen, registry, takeId } from '../core/state.js';
import * as L from './letters-model.js';
import { attachTextListeners } from '../tools/text.js';
import { refreshLayersPanel } from '../ui/layers.js';

export const isPanel = o => !!(o && o.mfcType === 'mfcImage' && registry[o.mfcId] && !(o.group && o.group.type !== 'activeSelection'));
export const isLetter = o => !!(o && o.type === 'textbox' && o.mfcLetterFor);
const byId = id => canvas.getObjects().find(o => o.mfcId === id) || null;
export const letteredPanels = () => canvas.getObjects().filter(o => isPanel(o) && o.mfcLetter);
const letterObjects = () => canvas.getObjects().filter(isLetter);
export const letterOf = panel => (panel ? letterObjects().find(l => l.mfcLetterFor === panel.mfcId) || null : null);
/** The document's letter style (complete). */
export const letterStyle = () => L.normalizeStyle(docProps.letterStyle);
const ptToPx = pt => (pt / 72) * docProps.dpi;
const mmToPx = mm => (mm / 25.4) * docProps.dpi;
/** A panel's box on the page, also while it is in a selection (its transform includes the selection's). */
function boxOf(o) {
  const m = o.calcTransformMatrix(), w = o.width / 2, h = o.height / 2;
  return fabric.util.makeBoundingBoxFromPoints([[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => fabric.util.transformPoint(new fabric.Point(x, y), m)));
}
let internal = false; // removals made here are not the user's

function makeLetter(panel, text) {
  const letter = new fabric.Textbox(text, { fontFamily: getPreference('text.fontFamily'), textAlign: 'left', originX: 'left', originY: 'top' });
  Object.assign(letter, { mfcId: 'txt' + takeId(), mfcType: 'text', mfcLetterFor: panel.mfcId });
  attachTextListeners(letter);
  // Just above its panel, so it is drawn on top of it.
  canvas.insertAt(letter, canvas.getObjects().indexOf(panel) + 1);
  return letter;
}
/** Text, size, weight and colour of a letter from the style; its box fits the text. */
function styleLetter(letter, text, style) {
  const fontSize = ptToPx(style.sizePt), fontWeight = style.bold ? 'bold' : 'normal';
  if (!letter.isEditing) letter.set('text', text);
  const measure = new fabric.Text(letter.text || ' ', { fontFamily: letter.fontFamily, fontSize, fontWeight });
  letter.set({ fontSize, fontWeight, fill: style.color, width: Math.ceil(measure.width) + 2, scaleX: 1, scaleY: 1, angle: 0 });
  letter.initDimensions();
}
function placeOn(letter, panel, style = letterStyle()) {
  if (letter.group || letter.isEditing) return;
  const p = L.placeLetter(boxOf(panel), { width: letter.width, height: letter.height }, style, mmToPx(style.offsetMm));
  letter.setPositionByOrigin(new fabric.Point(p.left, p.top), 'left', 'top');
  letter.setCoords();
}
/** Keeps a panel's letter on its corner (called with the panel's other attachments). */
export function followPanel(panel) {
  const letter = panel && panel.mfcLetter ? letterOf(panel) : null;
  if (letter) placeOn(letter, panel);
}

/** The letters panels get now: Map panel id → text (skipped panels have none). */
function currentTexts(except = null) {
  const panels = letteredPanels();
  const order = L.readingOrder(panels.map(p => { const b = boxOf(p); return { id: p.mfcId, page: Math.max(0, pageIndexForBox(b)), left: b.left, top: b.top, width: b.width, height: b.height }; }));
  const byIdMap = new Map(panels.map(p => [p.mfcId, p]));
  return L.assignLetters(order.map(id => { const p = byIdMap.get(id); return { id, skip: !!p.mfcLetter.skip, text: id === except ? null : p.mfcLetter.text }; }), letterStyle().case);
}

/** Gives every lettered panel its letter (in reading order), styled and placed; removes letters that have no panel. */
export function renumberLetters() {
  if (!canvas) return;
  const style = letterStyle(), texts = currentTexts(), seen = new Set();
  internal = true;
  try {
    for (const l of letterObjects()) {
      const panel = byId(l.mfcLetterFor);
      if (!panel || !texts.has(panel.mfcId) || seen.has(panel.mfcId)) canvas.remove(l);
      else seen.add(panel.mfcId);
    }
  } finally { internal = false; }
  for (const [id, text] of texts) {
    const panel = byId(id), letter = letterOf(panel) || makeLetter(panel, text);
    styleLetter(letter, text, style);
    placeOn(letter, panel, style);
  }
  canvas.requestRenderAll();
}

// ---- commands (each one History step) ----
/** Letters `panels` (images; a grid stands for its panels, see the panel module). Returns how many. */
export function addLetters(panels) {
  const list = panels.filter(isPanel);
  if (!list.length) { MFC_UI.toast('Select the panels (images) or a grid to letter them A, B, C.'); return 0; }
  list.forEach(p => { p.mfcLetter = { ...(p.mfcLetter || {}), skip: false }; });
  renumberLetters(); pushHistory(); refreshLayersPanel();
  return list.length;
}
export function removeLetters(panels) {
  const list = panels.filter(p => isPanel(p) && p.mfcLetter);
  if (!list.length) return 0;
  list.forEach(p => { delete p.mfcLetter; });
  renumberLetters(); pushHistory(); refreshLayersPanel();
  return list.length;
}
/** Skips a panel (no letter; the next panels move up) or lets it count again. */
export function setSkip(panel, skip) {
  if (!isPanel(panel) || !panel.mfcLetter) return false;
  panel.mfcLetter = { ...panel.mfcLetter, skip: !!skip };
  renumberLetters(); pushHistory();
  return true;
}
/** A panel's own text instead of its automatic letter (empty or null: automatic again). */
export function setOverride(panel, text) {
  if (!isPanel(panel) || !panel.mfcLetter) return false;
  const value = typeof text === 'string' && text.trim() ? text.trim() : null;
  panel.mfcLetter = { ...panel.mfcLetter, text: value };
  if (value === null) delete panel.mfcLetter.text;
  renumberLetters(); pushHistory();
  return true;
}
/** Changes the document's letter style (any of its fields); every letter follows. */
export function setLetterStyle(changes) {
  if (!documentOpen) return false;
  applyDocProps({ ...docProps, letterStyle: L.normalizeStyle({ ...letterStyle(), ...changes }) });
  renumberLetters(); pushHistory();
  return true;
}

// ---- canvas hooks (js/core/canvas-events.js) ----
/** After a change (before its History step, which renumbers): an edited letter's text becomes its panel's own text. */
export function onObjectModified(obj) {
  if (isLetter(obj) && !obj.isEditing) {
    const panel = byId(obj.mfcLetterFor);
    if (panel && panel.mfcLetter) {
      const auto = currentTexts(panel.mfcId).get(panel.mfcId), text = (obj.text || '').trim();
      if (!text || text === auto) { panel.mfcLetter = { ...panel.mfcLetter }; delete panel.mfcLetter.text; }
      else if (text !== panel.mfcLetter.text) panel.mfcLetter = { ...panel.mfcLetter, text };
    }
  }
}
// Every History step renumbers first (when the figure has letters).
onBeforeHistoryStep(() => { if (canvas && (letteredPanels().length || letterObjects().length)) renumberLetters(); });
/** A lettered panel deleted: the others move up. A letter deleted by the user: its panel is no longer lettered. */
export function onObjectRemoved(obj) {
  if (internal || history.restoring || !documentOpen || !obj) return;
  if (isLetter(obj)) {
    const panel = byId(obj.mfcLetterFor);
    if (panel && panel.mfcLetter) { delete panel.mfcLetter; renumberLetters(); }
  } else if (obj.mfcLetter) renumberLetters();
}

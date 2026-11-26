/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Text panel extras (P3-T8): superscript and subscript toggles for a highlighted range (or the whole
   box), and a palette of special characters (µ, °, ±, Greek, arrows…) inserted at the caret. Super- and
   subscripts are Fabric's own character styles (a smaller fontSize and a deltaY); SVG export writes
   them as a shifted tspan, and PDF export embeds their glyphs like any other text. */

import { canvas } from '../core/state.js';
import { SPECIAL_CHARACTERS } from './annotate-model.js';
import { lastTextSelection, refreshTextPanel, rememberTextSelection, scriptAt } from './text.js';

const SCRIPTS = { superscript: 'setSuperscript', subscript: 'setSubscript' };
const activeTextbox = () => { const a = canvas && canvas.getActiveObject(); return a && a.type === 'textbox' && !a.mfcLocked ? a : null; };
/** The range to change in a box: the highlighted one (live, or remembered after a panel click), else null. */
function rangeOf(box) {
  const live = box.isEditing && box.selectionStart !== box.selectionEnd ? { start: box.selectionStart, end: box.selectionEnd } : null;
  const saved = lastTextSelection && lastTextSelection.id === box.mfcId && lastTextSelection.start !== lastTextSelection.end ? lastTextSelection : null;
  return live || saved;
}
/** Takes super- and subscript off characters start…end (back to the size and baseline of the box). */
function clearScript(box, start, end) {
  for (let i = start; i < end; i++) {
    const loc = box.get2DCursorLocation(i, true), line = box.styles && box.styles[loc.lineIndex], style = line && line[loc.charIndex];
    if (!style || !style.deltaY) continue;
    delete style.deltaY; delete style.fontSize;
    if (!Object.keys(style).length) delete line[loc.charIndex];
  }
}

/** Toggles superscript or subscript on the highlighted range of the selected text box (or all its text). */
export function applyScript(kind) {
  const box = activeTextbox();
  if (!box || !SCRIPTS[kind]) return false;
  const sel = rangeOf(box) || { start: 0, end: box.text.length };
  if (box.isEditing) box.exitEditing();
  if (sel.end <= sel.start) return false;
  const current = scriptAt(box, sel.start);
  clearScript(box, sel.start, sel.end);
  if (current !== kind) box[SCRIPTS[kind]](sel.start, sel.end);
  box.initDimensions();
  box.dirty = true;
  box.setCoords();
  canvas.renderAll();
  canvas.fire('object:modified', { target: box });
  refreshTextPanel();
  return true;
}

/** Inserts a character at the caret of the selected text box (replacing a highlighted range); with no
    caret, at the end. The box stays in editing, so typing goes on after it. */
export function insertSpecialCharacter(ch) {
  const box = activeTextbox();
  if (!box) { MFC_UI.toast('Select a text box (or double-click into one) to insert a character.'); return false; }
  const live = box.isEditing ? { start: box.selectionStart, end: box.selectionEnd } : null;
  const saved = lastTextSelection && lastTextSelection.id === box.mfcId ? lastTextSelection : null;
  const sel = live || saved || { start: box.text.length, end: box.text.length };
  if (!box.isEditing) box.enterEditing();
  box.insertChars(ch, undefined, sel.start, sel.end);
  const caret = sel.start + Array.from(ch).length;
  box.selectionStart = box.selectionEnd = caret;
  if (box.hiddenTextarea) { box.hiddenTextarea.value = box.text; box.hiddenTextarea.selectionStart = box.hiddenTextarea.selectionEnd = caret; box.hiddenTextarea.focus(); }
  rememberTextSelection({ id: box.mfcId, start: caret, end: caret });
  box.initDimensions();
  box.setCoords();
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: box });
  return true;
}

/** Builds the palette (textContent only) and connects the Text panel's extra controls (once). */
export function installTextExtras() {
  const grid = document.getElementById('text-special-grid');
  if (grid && !grid.childElementCount) {
    for (const [group, chars] of SPECIAL_CHARACTERS) {
      const heading = document.createElement('p');
      heading.className = 'text-special-group';
      heading.textContent = group;
      const row = document.createElement('div');
      row.className = 'text-special-row';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', group);
      for (const [ch, name] of chars) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = ch;
        b.title = `Insert ${ch} (${name})`;
        b.dataset.char = ch;
        // Keep the text box's caret: the button takes no focus from a mouse click.
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', () => insertSpecialCharacter(ch));
        row.append(b);
      }
      grid.append(heading, row);
    }
  }
  for (const kind of Object.keys(SCRIPTS)) {
    const b = document.getElementById('text-' + kind);
    if (b) { b.addEventListener('mousedown', e => e.preventDefault()); b.addEventListener('click', () => applyScript(kind)); }
  }
}

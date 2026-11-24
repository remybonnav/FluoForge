/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Panel letters (P3-T3), the pure part: the letter sequence, the reading order of panels and where a
   letter goes on its panel. No Fabric, no page. The editor side is js/layout/letters.js.

   The style is set once per document (`docProps.letterStyle`):
     { case: 'upper' | 'lower', bold, sizePt, position: 'top-left' | 'top-right' | 'bottom-left' |
       'bottom-right', placement: 'inside' | 'outside', offsetMm, color } */

export const DEFAULT_STYLE = Object.freeze({ case: 'upper', bold: true, sizePt: 10, position: 'top-left', placement: 'inside', offsetMm: 1, color: '#ffffff' });
export const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** A complete, valid style from a saved or partial one (unknown or invalid values fall back to the default). */
export function normalizeStyle(style = {}) {
  const s = style && typeof style === 'object' ? style : {};
  return {
    case: s.case === 'lower' ? 'lower' : 'upper',
    bold: typeof s.bold === 'boolean' ? s.bold : DEFAULT_STYLE.bold,
    sizePt: Number.isFinite(s.sizePt) && s.sizePt >= 2 && s.sizePt <= 200 ? s.sizePt : DEFAULT_STYLE.sizePt,
    position: POSITIONS.includes(s.position) ? s.position : DEFAULT_STYLE.position,
    placement: s.placement === 'outside' ? 'outside' : 'inside',
    offsetMm: Number.isFinite(s.offsetMm) && s.offsetMm >= 0 && s.offsetMm <= 50 ? s.offsetMm : DEFAULT_STYLE.offsetMm,
    color: typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : DEFAULT_STYLE.color
  };
}

/** The letter of position `index` (0: A … 25: Z, 26: AA, 27: AB …), in the style's case. */
export function letterFor(index, letterCase = 'upper') {
  let n = Math.max(0, Math.floor(index)), text = '';
  do { text = String.fromCharCode(65 + (n % 26)) + text; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return letterCase === 'lower' ? text.toLowerCase() : text;
}

/**
 * Reading order of panels: by page, then row by row, then left to right. A panel is in a row when it
 * overlaps the row's first panel vertically by at least half the smaller of the two heights, so panels
 * aligned at the top, centred (as in a grid row) or at the bottom read as one row, while a panel more
 * than half its height lower starts the next one. `items`: [{ id, page, left, top, width, height }].
 * Returns the ids in order.
 */
export function readingOrder(items) {
  const byPage = new Map();
  for (const it of items) { if (!byPage.has(it.page)) byPage.set(it.page, []); byPage.get(it.page).push(it); }
  const out = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const list = byPage.get(page).slice().sort((a, b) => a.top - b.top || a.left - b.left);
    const rows = [];
    const overlap = (a, b) => Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
    for (const it of list) {
      const row = rows.find(r => overlap(r.first, it) >= Math.min(r.first.height, it.height) / 2);
      if (row) row.items.push(it); else rows.push({ first: it, items: [it] });
    }
    for (const row of rows) out.push(...row.items.sort((a, b) => a.left - b.left).map(it => it.id));
  }
  return out;
}

/**
 * The letters of panels in reading order. `panels`: [{ id, skip, text }] already in reading order.
 * A skipped panel gets none and does not count; a panel with its own text keeps that text and counts.
 * Returns Map id → text.
 */
export function assignLetters(panels, letterCase = 'upper') {
  const out = new Map();
  let n = 0;
  for (const p of panels) {
    if (p.skip) continue;
    out.set(p.id, typeof p.text === 'string' && p.text.trim() ? p.text : letterFor(n, letterCase));
    n++;
  }
  return out;
}

/** Where a letter of size { width, height } goes on a panel box (all in page px), `offset` in page px. */
export function placeLetter(box, size, style, offset) {
  const s = normalizeStyle(style), right = s.position.endsWith('right'), bottom = s.position.startsWith('bottom');
  if (s.placement === 'inside') {
    return { left: right ? box.left + box.width - offset - size.width : box.left + offset,
      top: bottom ? box.top + box.height - offset - size.height : box.top + offset };
  }
  // Outside: above (or below) the panel, aligned with its left (or right) edge.
  return { left: right ? box.left + box.width - size.width : box.left,
    top: bottom ? box.top + box.height + offset : box.top - offset - size.height };
}

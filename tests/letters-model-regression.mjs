// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* P3-T3: the panel letters' pure model (js/layout/letters-model.js), in Node: the letter sequence (A…Z,
   AA…, lower case), the style's defaults and checks, the reading order (pages, rows of panels with the
   same centre, left to right, uneven heights in a grid row), letters with skipped and overridden panels,
   and where a letter goes (four corners, inside and outside). Run alone: node tests/letters-model-regression.mjs */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runLettersModelRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const L = await import(pathToFileURL(join(ROOT, 'js/layout/letters-model.js')).href);

  // ---- letters ----
  assert('A, B … Z, then AA, AB … AZ, BA', [0, 1, 25, 26, 27, 51, 52].map(i => L.letterFor(i)).join() === 'A,B,Z,AA,AB,AZ,BA');
  assert('Lower case', [0, 2, 27].map(i => L.letterFor(i, 'lower')).join() === 'a,c,ab');

  // ---- style ----
  assert('The default style: upper case, bold, 10 pt, top left inside, 1 mm, white', JSON.stringify(L.normalizeStyle()) === JSON.stringify({ case: 'upper', bold: true, sizePt: 10, position: 'top-left', placement: 'inside', offsetMm: 1, color: '#ffffff' }));
  const odd = L.normalizeStyle({ case: 'lower', bold: false, sizePt: 1, position: 'middle', placement: 'outside', offsetMm: -1, color: 'red' });
  assert('A saved style keeps valid values and replaces invalid ones', odd.case === 'lower' && odd.bold === false && odd.sizePt === 10 && odd.position === 'top-left' && odd.placement === 'outside' && odd.offsetMm === 1 && odd.color === '#ffffff');

  // ---- reading order ----
  const box = (id, left, top, width = 100, height = 80, page = 0) => ({ id, page, left, top, width, height });
  let order = L.readingOrder([box('c', 0, 200), box('b', 120, 0), box('a', 0, 0), box('d', 120, 200)]);
  assert('Rows top to bottom, each left to right', order.join() === 'a,b,c,d', order.join());
  order = L.readingOrder([box('wide', 0, 10, 200, 60), box('tall', 220, 0, 60, 80), box('next', 0, 120)]);
  assert('Panels fitted in a grid row (same centre, different heights) read as one row', order.join() === 'wide,tall,next', order.join());
  order = L.readingOrder([box('p2', 0, 0, 100, 80, 1), box('p1b', 120, 0), box('p1a', 0, 0)]);
  assert('Page by page', order.join() === 'p1a,p1b,p2', order.join());
  order = L.readingOrder([box('low', 0, 30), box('high', 150, 0)]);
  assert('A panel a little higher on the right stays in the same row (left first)', order.join() === 'low,high', order.join());
  order = L.readingOrder([box('small', 300, 0, 100, 30), box('big', 0, 0, 100, 200), box('under', 300, 100, 100, 30)]);
  assert('Top-aligned panels of different heights are one row; a small panel lower down, beside the big one, joins its row too', order.join() === 'big,small,under', order.join());
  order = L.readingOrder([box('top', 150, 0), box('below', 0, 60)]);
  assert('A panel more than half a panel lower starts the next row', order.join() === 'top,below', order.join());

  // ---- letters with skip and override ----
  const t = L.assignLetters([{ id: 'a' }, { id: 'b', skip: true }, { id: 'c', text: 'X' }, { id: 'd' }]);
  assert('A skipped panel gets no letter and the next panels move up; an own text keeps its place', t.get('a') === 'A' && !t.has('b') && t.get('c') === 'X' && t.get('d') === 'C', JSON.stringify([...t]));
  assert('Lower case follows the style, own text does not', L.assignLetters([{ id: 'a' }, { id: 'b', text: 'Q' }], 'lower').get('a') === 'a' && L.assignLetters([{ id: 'b', text: 'Q' }], 'lower').get('b') === 'Q');

  // ---- placement ----
  const panel = { left: 100, top: 200, width: 300, height: 150 }, size = { width: 20, height: 30 };
  const at = (position, placement) => L.placeLetter(panel, size, { position, placement }, 5);
  assert('Inside: each corner, offset inwards', JSON.stringify([at('top-left', 'inside'), at('top-right', 'inside'), at('bottom-left', 'inside'), at('bottom-right', 'inside')]) ===
    JSON.stringify([{ left: 105, top: 205 }, { left: 375, top: 205 }, { left: 105, top: 315 }, { left: 375, top: 315 }]));
  assert('Outside: above or below the panel, on its left or right edge, offset away', JSON.stringify([at('top-left', 'outside'), at('top-right', 'outside'), at('bottom-left', 'outside'), at('bottom-right', 'outside')]) ===
    JSON.stringify([{ left: 100, top: 165 }, { left: 380, top: 165 }, { left: 100, top: 355 }, { left: 380, top: 355 }]));
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const checks = await runLettersModelRegressions(); console.log(`PASS letters-model-regression: ${checks.length} checks`); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

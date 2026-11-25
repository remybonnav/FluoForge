// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* P3-T7: the pure part of rulers, guides and smart guides (js/layout/guides-model.js), in Node: ruler
   ticks in cm, inches and px for the zoom; guides read from docProps; margin and journal column guides;
   guides as snap targets; equal spacing (same gap as two other objects, or centred between neighbours).
   Run alone: node tests/guides-model-regression.mjs */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runGuidesModelRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const M = await import(pathToFileURL(join(ROOT, 'js/layout/guides-model.js')).href);
  const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

  // ---- rulers ----
  const cm = M.rulerTicks(0, 1181.1, 0, 'cm', 300, 0.5); // 10 cm at 300 dpi, half size on screen
  assert('cm at 300 dpi, zoom 0.5: ticks every mm (5.9 screen px is too close: every 2 mm), labels every cm', cm.minor === 0.2 && cm.major === 1, `${cm.minor} ${cm.major}`);
  const labels = cm.ticks.filter(t => t.major).map(t => M.tickLabel(t.value));
  assert('…labelled 0, 1, 2 … 10, at their positions', labels.join() === '0,1,2,3,4,5,6,7,8,9,10' && near(cm.ticks.find(t => t.value === 1).pos, 300 / 2.54), labels.join());
  const zoomed = M.rulerTicks(0, 300, 0, 'cm', 300, 4);
  assert('Zoomed in (×4): mm ticks and a label every 2 mm', zoomed.minor === 0.1 && zoomed.major === 0.2);
  const inch = M.rulerTicks(0, 900, 0, 'in', 300, 1);
  assert('Inches at 100 %: ticks every eighth, a label every quarter', inch.minor === 0.125 && inch.major === 0.25 && inch.ticks.filter(t => t.major).slice(0, 5).map(t => M.tickLabel(t.value)).join() === '0,0.25,0.5,0.75,1');
  const inchOut = M.rulerTicks(0, 900, 0, 'in', 300, 0.1);
  assert('…and zoomed out (10 %), a label every 2 in', inchOut.major === 2);
  const px = M.rulerTicks(-100, 1200, 0, 'px', 300, 1);
  assert('Pixels: ticks every 10 px, labels every 50, negative on the pasteboard', px.minor === 10 && px.major === 50 && px.ticks[0].value === -100);
  const page2 = M.rulerTicks(1000, 1200, 1000, 'px', 300, 1);
  assert('A second page counts from its own top edge', page2.ticks[0].pos === 1000 && page2.ticks[0].value === 0);
  assert('Labels: no trailing zeros, no "-0"', M.tickLabel(2.5000001) === '2.5' && M.tickLabel(-0) === '0' && M.tickLabel(0.125) === '0.125');

  // ---- guides ----
  assert('Guides from docProps: only valid ones', JSON.stringify(M.guidesOf({ guides: [{ axis: 'v', pos: 10 }, { axis: 'x', pos: 1 }, { axis: 'h', pos: 'a' }, null, { axis: 'h', pos: 5, extra: 1 }] })) ===
    JSON.stringify([{ axis: 'v', pos: 10 }, { axis: 'h', pos: 5 }]) && M.guidesOf({}).length === 0 && M.guidesOf(null).length === 0);
  assert('Layout settings: margin 0 and columns on by default', JSON.stringify(M.layoutSettings({})) === JSON.stringify({ marginMm: 0, columns: true }) &&
    JSON.stringify(M.layoutSettings({ layoutGuides: { marginMm: 5, columns: false } })) === JSON.stringify({ marginMm: 5, columns: false }));
  const mm = v => (v / 25.4) * 300, page = { left: 0, top: 0, width: mm(210), height: mm(297) };
  const lines = M.layoutGuides(page, { marginMm: 10, columnsMm: [183, 89, 120, 89] }, 300);
  const v = lines.filter(g => g.axis === 'v'), h = lines.filter(g => g.axis === 'h');
  assert('Margin 10 mm: four margin guides', lines.filter(g => g.kind === 'margin').length === 4 && near(h[0].pos, mm(10)) && near(h[1].pos, mm(287)) && near(v[1].pos, mm(200)));
  assert('Nature\'s columns from the left margin: 99, 130 and 193 mm, each once, in order', v.filter(g => g.kind === 'column').map(g => Math.round(g.pos / mm(1))).join() === '99,130,193' &&
    v.filter(g => g.kind === 'column').map(g => g.label).join() === '89 mm,120 mm,183 mm');
  const narrow = M.layoutGuides({ left: 0, top: 1000, width: mm(100), height: mm(50) }, { columnsMm: [89, 120] }, 300);
  assert('Columns wider than the page are left out; a page further down has its own', narrow.length === 1 && near(narrow[0].pos, mm(89)));
  assert('A margin of half the page or more draws nothing', M.layoutGuides({ left: 0, top: 0, width: 100, height: 100 }, { marginMm: 10 }, 300).length === 0);
  const tv = M.guideTarget({ axis: 'v', pos: 42 }), th = M.guideTarget({ axis: 'h', pos: 7 });
  assert('A guide snaps on its own axis only', tv.left === 42 && Number.isNaN(tv.top) && th.top === 7 && Number.isNaN(th.left));
  assert('The guide under a point, within the tolerance; the nearest wins', M.guideAt([{ axis: 'v', pos: 100 }, { axis: 'v', pos: 104 }, { axis: 'h', pos: 50 }], { x: 103, y: 0 }, 4) === 1 &&
    M.guideAt([{ axis: 'h', pos: 50 }], { x: 0, y: 60 }, 4) === -1);

  // ---- equal spacing ----
  const a = { left: 0, top: 0, width: 100, height: 50 }, b = { left: 150, top: 0, width: 100, height: 50 };
  const moving = { left: 296, top: 10, width: 100, height: 40 };
  const s = M.spacingSnapAxis(moving, [a, b], 8, 'x');
  assert('The same gap as A–B (50): the box moves to 300, and both gaps are marked', s && near(s.d, 4) && s.gap === 50 && s.marks.length === 2 && s.marks.some(m => m.from === 250 && m.to === 300) && s.marks.some(m => m.from === 100 && m.to === 150), JSON.stringify(s));
  const centred = M.spacingSnapAxis({ left: 195, top: 0, width: 100, height: 50 }, [a, { left: 400, top: 0, width: 50, height: 50 }], 8, 'x');
  assert('Between two neighbours: centred, gaps of 100 each, both marked', centred && near(centred.d, 5) && centred.gap === 100 && centred.marks.length === 2, JSON.stringify(centred));
  assert('Too far from an equal gap: nothing', M.spacingSnapAxis({ left: 320, top: 0, width: 100, height: 50 }, [a, b], 8, 'x') === null);
  assert('Objects of another row do not count', M.spacingSnapAxis({ left: 296, top: 500, width: 100, height: 40 }, [a, b], 8, 'x') === null);
  const col = M.computeSpacingSnap({ left: 0, top: 316, width: 50, height: 100 }, [{ left: 0, top: 0, width: 50, height: 100 }, { left: 0, top: 160, width: 50, height: 100 }], 8);
  assert('Vertically too: the same gap as the two above (60); nothing horizontally', near(col.dy, 4) && col.marks.y.length === 2 && col.dx === null, JSON.stringify(col));
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const checks = await runGuidesModelRegressions(); console.log(`PASS guides-model-regression: ${checks.length} checks`); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

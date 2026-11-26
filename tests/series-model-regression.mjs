// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* P3-T9: the pure part of series montages (js/image/series-model.js), in Node: the planes a range and
   step pick, the checks of a range, the strip or grid shape, the cell of each panel and the summary text.
   Run alone: node tests/series-model-regression.mjs */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runSeriesModelRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const S = await import(pathToFileURL(join(ROOT, 'js/image/series-model.js')).href);
  const fails = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

  // ---- planes ----
  assert('All planes by default: 1 to the last, step 1 (0-based out)', S.seriesPlanes(5).join() === '0,1,2,3,4');
  assert('A range and a step: frames 1, 11, 21 … of 121', S.seriesPlanes(121, { from: 1, to: 121, step: 10 }).join() === '0,10,20,30,40,50,60,70,80,90,100,110,120');
  assert('The last plane is included only when the step reaches it', S.seriesPlanes(10, { from: 2, to: 9, step: 3 }).join() === '1,4,7');
  assert('A single plane is a series of one panel', S.seriesPlanes(10, { from: 4, to: 4, step: 1 }).join() === '3');
  assert('A one-plane image has no series, with a message naming the axis', fails(() => S.seriesPlanes(1, {}, 'z'), /single slice/) && fails(() => S.seriesPlanes(1, {}, 't'), /single frame/));
  assert('First and last must be whole planes inside the series', fails(() => S.seriesPlanes(10, { from: 0 }), /first frame between 1 and 10/) &&
    fails(() => S.seriesPlanes(10, { to: 11 }), /last frame between 1 and 10/) && fails(() => S.seriesPlanes(10, { from: 1.5 }), /first/) && fails(() => S.seriesPlanes(10, { from: NaN }), /first/));
  assert('The last must come after the first', fails(() => S.seriesPlanes(10, { from: 6, to: 3 }, 'z'), /last slice must come after the first/));
  assert('The step is a whole number of 1 or more', fails(() => S.seriesPlanes(10, { step: 0 }), /step of 1 or more/) && fails(() => S.seriesPlanes(10, { step: 2.5 }), /step/));
  assert(`At most ${S.MAX_PANELS} panels, with a way out`, fails(() => S.seriesPlanes(500, { step: 1 }), /500 panels; at most 100: use a larger step/) && S.seriesPlanes(500, { step: 5 }).length === 100);
  assert('The default step shows the whole series in about eight panels', S.defaultStep(121) === 16 && S.seriesPlanes(121, { step: S.defaultStep(121) }).length === 8 &&
    S.defaultStep(5) === 1 && S.defaultStep(1) === 1);

  // ---- shape ----
  assert('A strip: one row of every panel', JSON.stringify(S.gridShape(7)) === '{"columns":7,"rows":1}' && JSON.stringify(S.gridShape(7, 0)) === '{"columns":7,"rows":1}');
  assert('A grid: the columns asked, as many rows as needed', JSON.stringify(S.gridShape(7, 3)) === '{"columns":3,"rows":3}' && JSON.stringify(S.gridShape(8, 4)) === '{"columns":4,"rows":2}');
  assert('…never more columns than panels', JSON.stringify(S.gridShape(3, 10)) === '{"columns":3,"rows":1}');
  assert('Cells fill row by row, left to right', JSON.stringify([0, 2, 3, 6].map(i => S.cellOf(i, 3))) === '[{"row":0,"column":0},{"row":0,"column":2},{"row":1,"column":0},{"row":2,"column":0}]');

  // ---- text ----
  assert('The summary counts as the user does (from 1), shortened when long', S.describePlanes([0, 4, 8]) === '1, 5, 9' &&
    S.describePlanes(S.seriesPlanes(121, { step: 16 })) === '1, 17, 33 … 113');
  assert('Both axes have their words', S.AXES.z.one === 'slice' && S.AXES.t.many === 'frames' && S.AXES.z.label === 'Z slices');
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const checks = await runSeriesModelRegressions(); console.log(`PASS series-model-regression: ${checks.length} checks`); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

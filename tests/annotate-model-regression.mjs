// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* P3-T8: the pure part of microscopy annotations (js/tools/annotate-model.js), in Node: Z, time and
   magnification label texts, channel label colours, label placement on an image corner, ROI numbering,
   stamp shapes and the special-character palette.
   Run alone: node tests/annotate-model-regression.mjs */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runAnnotateModelRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const M = await import(pathToFileURL(join(ROOT, 'js/tools/annotate-model.js')).href);
  const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

  // ---- time ----
  assert('Seconds under a minute: "45 s", "2.5 s", "0 s"', M.formatSeconds(45) === '45 s' && M.formatSeconds(2.5) === '2.5 s' && M.formatSeconds(0) === '0 s');
  assert('Minutes: "2:05 min"; hours: "1:02:03 h"', M.formatSeconds(125) === '2:05 min' && M.formatSeconds(3723) === '1:02:03 h', M.formatSeconds(125) + ' ' + M.formatSeconds(3723));
  assert('Time label: frame × interval, or the frame number without an interval', M.timeLabel({ sizeT: 40, tIndex: 3 }, 30) === 't = 1:30 min' &&
    M.timeLabel({ sizeT: 40, tIndex: 5 }) === 't 6/40' && M.timeLabel({ sizeT: 1, tIndex: 0 }, 5) === null);
  assert('…the frame is clamped to the series', M.timeLabel({ sizeT: 4, tIndex: 9 }, 10) === 't = 30 s');

  // ---- Z ----
  assert('A slice: its depth from the first slice, in µm', M.zLabel({ sizeZ: 25, zMode: 'slice', zIndex: 7, zStepUm: 0.5 }) === 'z = 3.5 µm');
  assert('…or its number without a Z step', M.zLabel({ sizeZ: 25, zMode: 'slice', zIndex: 7 }) === 'z 8/25');
  assert('A projection: the depth it covers', M.zLabel({ sizeZ: 25, zMode: 'max', zStepUm: 0.5 }) === 'MIP z 0–12 µm' && M.zLabel({ sizeZ: 25, zMode: 'mean' }) === 'Mean of 25 slices');
  assert('No Z stack: no label', M.zLabel({ sizeZ: 1, zMode: 'slice' }) === null && M.zLabel() === null);

  // ---- magnification and channels ----
  assert('Magnification: the inset\'s scale over its source\'s, one decimal', M.magnificationLabel(3, 1) === '3×' && M.magnificationLabel(1.25, 0.5) === '2.5×' && M.magnificationLabel(1, 0) === null);
  const ch = M.channelsText([{ name: 'DAPI', color: '#0000ff' }, { name: 'GFP', color: '#00ff00' }]);
  assert('Channel label: names separated by a space, each character in its channel\'s colour', ch.text === 'DAPI GFP' && ch.styles[0][0].fill === '#0000ff' &&
    ch.styles[0][3].fill === '#0000ff' && !ch.styles[0][4] && ch.styles[0][5].fill === '#00ff00' && ch.styles[0][7].fill === '#00ff00');

  // ---- placement ----
  const img = { left: 100, top: 200, width: 400, height: 300 }, size = { width: 50, height: 20 };
  const br = M.placeLabel(img, size, { corner: 'br', ...M.insideOffset('br', 5) });
  assert('Default place: inside the corner, a margin from both edges', br.left === 445 && br.top === 475 && JSON.stringify(M.placeLabel(img, size, { corner: 'tl', ...M.insideOffset('tl', 5) })) === '{"left":105,"top":205}');
  const moved = M.offsetFrom(img, size, { left: 460, top: 520 });
  assert('A label moved below the image keeps its offset from the nearest corner', moved.corner === 'br' && moved.dx === 10 && moved.dy === 40);
  const bigger = { left: 0, top: 0, width: 800, height: 600 }, again = M.placeLabel(bigger, size, moved);
  assert('…and keeps it when the image is resized', again.left === 760 && again.top === 620);

  // ---- ROI ----
  assert('ROI numbers: the first free one', M.nextRoiNumber([]) === 1 && M.nextRoiNumber(['ROI 1', 'ROI 3', 'other']) === 2 && M.nextRoiNumber(['ROI 1', 'ROI 2']) === 3);

  // ---- stamps ----
  const head = M.stampCommands('arrowhead', 40);
  assert('Arrowhead: a closed triangle with its tip on the point, pointing down and to the left', head[0].join() === 'M,0,0' && head.at(-1)[0] === 'Z' &&
    head.slice(1, 3).every(([, x, y]) => x > 0 && y < 0) && near(Math.hypot((head[1][1] + head[2][1]) / 2, (head[1][2] + head[2][2]) / 2), 40));
  const star = M.stampCommands('star', 40), xs = star.filter(c => c.length === 3).map(c => c[1]), ys = star.filter(c => c.length === 3).map(c => c[2]);
  assert('Star: ten points, centred, as tall as asked (radius 20)', star.length === 11 && near(Math.min(...ys), -20) && near(Math.max(...xs), -Math.min(...xs)));
  const tri = M.stampCommands('triangle', 30);
  assert('Triangle: 30 tall, centred on its centroid', near(tri[0][2], -20) && near(tri[1][2], 10) && near(tri[1][1] + tri[2][1], 0));
  assert('Asterisk: three strokes through the point', M.stampCommands('asterisk', 20).filter(c => c[0] === 'M').length === 3 &&
    M.stampCommands('asterisk', 20).every(c => Math.hypot(c[1], c[2]) <= 10.001));
  assert('Dot: a closed circle of four curves', M.stampCommands('circle', 10).filter(c => c[0] === 'C').length === 4);
  assert('An unknown stamp has no shape', M.stampCommands('nope', 10) === null && Object.keys(M.STAMPS).every(k => M.stampCommands(k, 10)));
  const nodes = M.arrowStampNodes(100);
  assert('Arrow stamp: 100 long, from the upper right to its tip on the point', nodes[1].x === 0 && nodes[1].y === 0 && near(Math.hypot(nodes[0].x, nodes[0].y), 100, 0.01) && nodes[0].x > 0 && nodes[0].y < 0);

  // ---- palette ----
  const chars = M.SPECIAL_CHARACTERS.flatMap(([, list]) => list.map(([c]) => c));
  assert('The palette has µ, °, ±, Greek and arrows, each once and each named', ['µ', '°', '±', 'α', 'β', 'Δ', '→', '↑'].every(c => chars.includes(c)) &&
    new Set(chars).size === chars.length && M.SPECIAL_CHARACTERS.every(([g, list]) => g && list.every(([c, name]) => c.length === 1 && name)));
  assert('µ is the micro sign (U+00B5), as journals and ImageJ write it', chars.includes('µ'));
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const checks = await runAnnotateModelRegressions(); console.log(`PASS annotate-model-regression: ${checks.length} checks`); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

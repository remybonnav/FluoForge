// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* P3-T10: the pure part of vector panels (js/image/vector-model.js), in Node: an SVG's size on paper,
   its viewBox transform, the embedded face for a font family, CSS scoping and id renaming, external
   links, and the size of a rasterised PDF page.
   Run alone: node tests/vector-model-regression.mjs */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runVectorModelRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const V = await import(pathToFileURL(join(ROOT, 'js/image/vector-model.js')).href);
  const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
  const fails = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

  // ---- size ----
  assert('Lengths in pt, px, mm, cm, in, pc; a bare number is in CSS pixels', near(V.lengthInches('288pt'), 4) && near(V.lengthInches('96'), 1) && near(V.lengthInches('96px'), 1) &&
    near(V.lengthInches('25.4mm'), 1) && near(V.lengthInches('2.54cm'), 1) && near(V.lengthInches('2in'), 2) && near(V.lengthInches('6pc'), 1) && near(V.lengthInches(' 230.4pt '), 3.2) && near(V.lengthInches('1e2px'), 100 / 96));
  assert('A relative or missing length is no size', [null, '', '100%', 'auto', '-5pt', '0', 'abc', '12em'].every(v => V.lengthInches(v) === null));
  assert('A viewBox, with commas or spaces; a bad one is none', JSON.stringify(V.parseViewBox('0 0 288 216')) === '{"x":0,"y":0,"width":288,"height":216}' &&
    JSON.stringify(V.parseViewBox('-5,10, 20 30')) === '{"x":-5,"y":10,"width":20,"height":30}' && V.parseViewBox('0 0 0 10') === null && V.parseViewBox('0 0 10') === null && V.parseViewBox(null) === null);
  let g = V.vectorGeometry({ width: '230.4pt', height: '172.8pt', viewBox: '0 0 230.4 172.8' });
  assert('A matplotlib SVG: 3.2 × 2.4 inches', near(g.widthIn, 3.2) && near(g.heightIn, 2.4) && g.viewBox.width === 230.4);
  g = V.vectorGeometry({ viewBox: '0 0 480 360' });
  assert('Only a viewBox: its units are CSS pixels (5 × 3.75 in)', near(g.widthIn, 5) && near(g.heightIn, 3.75));
  g = V.vectorGeometry({ width: '100%', height: '100%', viewBox: '0 0 192 96' });
  assert('Relative sizes fall back to the viewBox', near(g.widthIn, 2) && near(g.heightIn, 1));
  g = V.vectorGeometry({ width: '4in', viewBox: '0 0 400 100' });
  assert('A width alone: the height keeps the viewBox aspect', near(g.heightIn, 1));
  g = V.vectorGeometry({ width: '192', height: '96' });
  assert('Width and height without a viewBox make one, in CSS pixels', near(g.widthIn, 2) && JSON.stringify(g.viewBox) === '{"x":0,"y":0,"width":192,"height":96}');
  assert('No size at all is refused with a message', fails(() => V.vectorGeometry({}), /no size: it needs a width and height, or a viewBox/));
  assert('The panel size in document pixels at the document dpi', JSON.stringify(V.naturalSize(V.vectorGeometry({ width: '288pt', height: '216pt' }), 300)) === '{"width":1200,"height":900}');

  // ---- viewBox transform ----
  let t = V.viewportTransform({ x: 0, y: 0, width: 288, height: 216 }, 1200, 900);
  assert('Same aspect: one scale, no offset', near(t.sx, 1200 / 288) && near(t.sy, t.sx) && near(t.tx, 0, 1e-9) && near(t.ty, 0, 1e-9));
  t = V.viewportTransform({ x: 10, y: 20, width: 100, height: 50 }, 400, 400);
  assert('xMidYMid meet: the smaller scale, centred (and the viewBox origin moved)', near(t.sx, 4) && near(t.sy, 4) && near(t.tx, -40) && near(t.ty, -80 + 100));
  t = V.viewportTransform({ x: 0, y: 0, width: 100, height: 50 }, 400, 400, 'none');
  assert('preserveAspectRatio="none" stretches', near(t.sx, 4) && near(t.sy, 8) && t.tx === 0 && t.ty === 0);
  t = V.viewportTransform({ x: 0, y: 0, width: 100, height: 50 }, 400, 400, 'xMinYMax slice');
  assert('slice takes the larger scale; xMin, YMax align', near(t.sx, 8) && near(t.tx, 0) && near(t.ty, 0) && near(V.viewportTransform({ x: 0, y: 0, width: 100, height: 50 }, 400, 100, 'xMaxYMin meet').tx, 200));

  // ---- fonts ----
  assert('Sans families become Liberation Sans', ["'DejaVu Sans'", 'Arial', 'Helvetica', '"Helvetica Neue", Arial, sans-serif', 'sans-serif', 'Liberation Sans', 'Arimo'].every(f => V.faceFor(f) === 'Liberation Sans'));
  assert('Serif families become Liberation Serif', ['Times New Roman', 'Times', 'serif', 'Georgia', 'cmr10', 'STIXGeneral'].every(f => V.faceFor(f) === 'Liberation Serif'));
  assert('Monospaced families become Liberation Mono', ['Courier New', 'monospace', "'DejaVu Sans Mono'", 'Consolas'].every(f => V.faceFor(f) === 'Liberation Mono'));
  assert('The first family the list knows decides; unknown names alone give Liberation Sans; no family, Serif',
    V.faceFor('Fancy Font, Times, Arial') === 'Liberation Serif' && V.faceFor('Fancy Font') === 'Liberation Sans' && V.faceFor('') === 'Liberation Serif' && V.faceFor(null) === 'Liberation Serif');
  assert('Font styles: bold from a word or a weight, italic or oblique', V.styleKey('bold') === 'bold' && V.styleKey('700') === 'bold' && V.styleKey(600) === 'bold' && V.styleKey('400') === 'normal' &&
    V.styleKey('normal', 'italic') === 'italic' && V.styleKey('bold', 'oblique') === 'bolditalic' && V.styleKey() === 'normal');
  assert('A font shorthand becomes longhands with the face', V.expandFontShorthand("10px 'DejaVu Sans'") === "font-style: normal; font-weight: normal; font-size: 10px; font-family: 'Liberation Sans'" &&
    V.expandFontShorthand('italic bold 12px/1.2 Times, serif') === "font-style: italic; font-weight: bold; font-size: 12px; font-family: 'Liberation Serif'" && V.expandFontShorthand('inherit') === null);
  assert('Style attributes and stylesheets: families and shorthands mapped, the rest kept',
    V.mapDeclarations("font: 10px 'DejaVu Sans'; text-anchor: middle") === "font-style: normal; font-weight: normal; font-size: 10px; font-family: 'Liberation Sans'; text-anchor: middle" &&
    V.mapDeclarations('text{font-family: "Courier New"; fill: red}') === "text{font-family: 'Liberation Mono'; fill: red}");

  // ---- CSS and ids ----
  assert('Rules are limited to the panel: *, lists, descendants', V.scopeCSS('*{stroke-linejoin: round}', '#p') === '#p *{stroke-linejoin: round}' &&
    V.scopeCSS('.svglite line, .svglite rect { fill: none; }', '#p') === '#p .svglite line, #p .svglite rect{ fill: none; }');
  assert('@font-face and @import are dropped, @media scoped, comments removed', V.scopeCSS("/* c */ @font-face{src:url(a.ttf)} @import 'x.css'; @media print{text{fill:red}} a{b:c}", '#p') === '@media print{#p text{fill:red}}#p a{b:c}',
    V.scopeCSS("/* c */ @font-face{src:url(a.ttf)} @media print{text{fill:red}} a{b:c}", '#p'));
  const ids = new Map([['p1', 'v1-p1'], ['m0', 'v1-m0']]);
  assert('References to renamed ids follow: url(#…), quoted, and "#id" links', V.renameRefs('url(#p1)', ids) === 'url(#v1-p1)' && V.renameRefs("url('#p1')", ids) === 'url(#v1-p1)' &&
    V.renameRefs('#m0', ids) === '#v1-m0' && V.renameRefs('url(#other)', ids) === 'url(#other)' && V.renameRefs('fill: url(#p1); stroke: url(#m0)', ids) === 'fill: url(#v1-p1); stroke: url(#v1-m0)');
  assert('Links that leave the file: anything but #id and data:', V.isExternal('https://x.org/a.png') && V.isExternal('plot_files/img.png') && V.isExternal('file:///tmp/a.png') &&
    !V.isExternal('#a') && !V.isExternal('data:image/png;base64,AAAA') && !V.isExternal('') && !V.isExternal(null));
  assert('URLs in CSS, @import included', V.cssURLs("a{background:url('x.png')} b{fill:url(#g)} @import 'y.css';").join() === 'x.png,#g,y.css');

  // ---- files ----
  assert('SVG and PDF files by name or type', V.isSVGFile({ name: 'plot.SVG' }) && V.isSVGFile({ name: 'p.svgz' }) && V.isSVGFile({ name: 'x', type: 'image/svg+xml' }) && !V.isSVGFile({ name: 'a.tif' }) &&
    V.isPDFFile({ name: 'fig.pdf' }) && V.isPDFFile({ name: 'x', type: 'application/pdf' }) && !V.isPDFFile({ name: 'a.svg' }));
  assert('A PDF page at the document dpi: a US-letter page at 300 dpi is 2550 × 3300 px', JSON.stringify(V.pdfRaster(612, 792, 300)) === '{"width":2550,"height":3300,"scale":4.166666666666667}');
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const checks = await runVectorModelRegressions(); console.log(`PASS vector-model-regression: ${checks.length} checks`); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

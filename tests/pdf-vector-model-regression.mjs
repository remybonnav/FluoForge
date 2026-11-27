// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* P3-T10a: the pure part of turning a PDF page into SVG (js/image/pdf-vector-model.js), in Node:
   affine matrices, how a transform scales lines, numbers and transforms for SVG, pdf.js path data,
   PDF font names and which ones the Liberation faces stand in for, and text SVG can carry.
   Run alone: node tests/pdf-vector-model-regression.mjs */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runPdfVectorModelRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const P = await import(pathToFileURL(join(ROOT, 'js/image/pdf-vector-model.js')).href);
  const same = (a, b, tol = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
  const fails = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

  // ---- matrices ----
  const scale2 = [2, 0, 0, 2, 0, 0], move = [1, 0, 0, 1, 10, 5];
  assert('multiply(m, n) applies n first, then m (as canvas transform does)', same(P.apply(P.multiply(scale2, move), 1, 1), [22, 12]) && same(P.apply(P.multiply(move, scale2), 1, 1), [12, 7]));
  const m = [0.12001, 0.3, -0.2, -0.12, 7, 234];
  assert('invert gives back the identity; a flat transform has no inverse', same(P.multiply(m, P.invert(m)), P.IDENTITY, 1e-9) && P.invert([1, 2, 2, 4, 0, 0]) === null);
  assert('The page flip of a PDF (y up) to SVG (y down)', same(P.apply([1, 0, 0, -1, 0, 72], 10, 60), [10, 12]));
  let s = P.lengthScale([3, 0, 0, -3, 5, 5]);
  assert('A scale with a flip is uniform; lines scale by it', s.uniform && Math.abs(s.scale - 3) < 1e-9);
  s = P.lengthScale([0, 2, -2, 0, 0, 0]);
  assert('A rotation with a scale is uniform', s.uniform && Math.abs(s.scale - 2) < 1e-9);
  assert('Prism\'s 0.12001 × 0.12 counts as uniform (within 1 %); 1 × 2 and a skew do not', P.lengthScale([0.12001, 0, 0, -0.12, 0, 0]).uniform &&
    !P.lengthScale([1, 0, 0, 2, 0, 0]).uniform && !P.lengthScale([1, 0, 0.5, 1, 0, 0]).uniform);

  // ---- numbers, transforms, paths ----
  assert('Numbers: 3 decimals, no trailing zeros, never -0', P.num(1.23456) === '1.235' && P.num(2) === '2' && P.num(2.5) === '2.5' && P.num(-0.0001) === '0' && P.num(0.12001, 6) === '0.12001');
  assert('A transform attribute keeps 6 decimals of scale and 3 of offset', P.matrixAttr([0.12001, 0, 0, 0.12, 72.12555, 203.4]) === 'matrix(0.12001 0 0 0.12 72.126 203.4)');
  const D = P.DRAW;
  const ops = [D.moveTo, 0, 0, D.lineTo, 10, 0, D.curveTo, 10, 5, 5, 10, 0, 10, D.quadraticCurveTo, 0, 5, 1, 1, D.closePath];
  assert('pdf.js path data becomes SVG path data (M, L, C, Q, Z)', P.pathData(ops) === 'M0 0L10 0C10 5 5 10 0 10Q0 5 1 1Z', P.pathData(ops));
  assert('…its points mapped by a transform', P.pathData([D.moveTo, 10, 60, D.lineTo, 20, 60], [1, 0, 0, -1, 0, 72]) === 'M10 12L20 12');
  assert('…in a typed array, as pdf.js sends it', P.pathData(new Float32Array([D.moveTo, 1.5, 2, D.lineTo, 3, 4])) === 'M1.5 2L3 4');
  assert('An empty path is empty; an unknown operator fails loudly', P.pathData(null) === '' && P.pathData([]) === '' && fails(() => P.pathData([9, 1, 2]), /Unknown path operator 9/));
  assert('Text is escaped for SVG', P.escapeXML('a<b & "c">') === 'a&lt;b &amp; &quot;c&quot;&gt;');
  assert('Line caps and joins by PDF number', P.CAPS[1] === 'round' && P.CAPS[2] === 'square' && P.JOINS[0] === 'miter' && P.JOINS[2] === 'bevel');

  // ---- fonts ----
  const f = (name, flags) => { const r = P.pdfFont(name, flags); return [r.family, r.bold, r.italic, r.compatible].join('|'); };
  assert('Prism\'s "Arial,Bold": Arial, bold, a Liberation face has its widths', f('Arial,Bold', { bold: true }) === 'Arial|true|false|true', f('Arial,Bold'));
  assert('A subset prefix and MT/PS suffixes go: "ABCDEF+Arial-BoldMT", "ArialMT"', f('ABCDEF+Arial-BoldMT') === 'Arial|true|false|true' && f('ArialMT') === 'Arial|false|false|true');
  assert('Times: "TimesNewRomanPS-ItalicMT", "Times-Roman", "Times-BoldItalic"', f('TimesNewRomanPS-ItalicMT') === 'Times New Roman|false|true|true' && f('Times-Roman') === 'Times|false|false|true' &&
    f('Times-BoldItalic') === 'Times|true|true|true');
  assert('Courier and Helvetica, and an oblique', f('CourierNewPS-BoldMT') === 'Courier New|true|false|true' && f('Helvetica-Oblique') === 'Helvetica|false|true|true');
  assert('The style in the name with no separator: "ArialBold"', f('ArialBold') === 'Arial|true|false|true', f('ArialBold'));
  assert('pdf.js\'s flags count too', f('Helvetica', { italic: true }) === 'Helvetica|false|true|true' && f('Helvetica', { black: true }).split('|')[1] === 'true');
  assert('Other fonts are not stood in for (they are drawn by their outlines)', f('DejaVuSans').endsWith('|false') && f('Symbol').endsWith('|false') && f('Calibri').endsWith('|false') && f('ArialNarrow').endsWith('|false'));
  assert('No name at all is sans-serif, not compatible', f('') === 'sans-serif|false|false|false');
  assert('Writable text: letters, µ, ligatures; not empty, control or private-use characters', P.writableText('A') && P.writableText('µ') && P.writableText('ﬁ') &&
    !P.writableText('') && !P.writableText(null) && !P.writableText('\u0001') && !P.writableText('') && !P.writableText('�'));
  assert('Each kind of problem has a sentence for the user', Object.values(P.ISSUES).every(t => typeof t === 'string' && t.length > 8) && P.ISSUES.blend === 'blend modes other than normal');
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const checks = await runPdfVectorModelRegressions(); console.log(`PASS pdf-vector-model-regression: ${checks.length} checks`); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

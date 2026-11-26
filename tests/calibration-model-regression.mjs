// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* P3-T9a: the pure part of the calibration warnings (js/image/calibration-model.js), in Node: usable
   values, equality allowing for rounding, the warning text and where a value comes from.
   Run alone: node tests/calibration-model-regression.mjs */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runCalibrationModelRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const C = await import(pathToFileURL(join(ROOT, 'js/image/calibration-model.js')).href);

  assert('A usable value is a number above 0, typed or not', C.positive(0.5) === 0.5 && C.positive('2') === 2 && C.positive(' 0.25 ') === 0.25 &&
    [0, -1, '', '  ', 'abc', NaN, Infinity, null, undefined].every(v => C.positive(v) === null));
  assert('Equal values allow for the rounding of a file\'s metadata', C.sameValue(0.1 + 0.2, 0.3) && !C.sameValue(0.3, 0.30001) && C.sameValue(null, null) && !C.sameValue(0.5, null));
  assert('Numbers print as people type them', C.showNumber(0.1 + 0.2) === '0.3' && C.showNumber(30) === '30' && C.showNumber(0.000123456789) === '0.000123457');
  assert('No warning for the file\'s value, or when the file has none', C.differenceWarning(0.5, 0.5, 'µm') === '' && C.differenceWarning(2, null, 's') === '' && C.differenceWarning(null, null, 's') === '');
  assert('A different value: the warning gives the file\'s, with its unit', C.differenceWarning(0.75, 0.5, 'µm') === 'Differs from the file: the file says 0.5 µm.');
  assert('A cleared value the file has: the warning says so', C.differenceWarning(null, 0.25, 'µm/px') === 'No value set: the file says 0.25 µm/px.');
  assert('Where a value comes from', C.valueSource(null, 1) === 'Not set' && C.valueSource(1, 1, 'ImageJ header') === 'ImageJ header' &&
    C.valueSource(2, 30) === 'Entered in the Channels panel (the file says 30)' && C.valueSource(2, null) === 'Entered in the Channels panel');
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const checks = await runCalibrationModelRegressions(); console.log(`PASS calibration-model-regression: ${checks.length} checks`); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

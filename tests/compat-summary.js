/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The content of tests/compat/<fixture>/expected.json: what a figure must still contain after it is
   opened by a later version. Works on a plain figure state (MFC_PROJECT.captureState() or a state
   read from a project file), so it runs unchanged in old and new versions of the app:
   tests/make-compat-fixture.mjs runs it in the version that saved the fixture, and
   tests/compat-regression.js runs it in the current version and compares the two. */
function compatSummary(state) {
  const round = n => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
  const pick = (obj, keys) => {
    const out = {};
    for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) out[key] = round(obj[key]);
    return out;
  };
  const node = obj => {
    const out = pick(obj, ['type', 'mfcType', 'mfcId', 'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle',
      'flipX', 'flipY', 'originX', 'originY', 'opacity', 'visible', 'fill', 'stroke', 'strokeWidth', 'mfcShapeKind',
      'mfcLocked', 'mfcPositionLocked', 'mfcFileName', 'mfcLengthUm', 'mfcAttachedTo', 'mfcInsetSourceId', 'mfcIsInset',
      'mfcCropX', 'mfcCropY', 'mfcCropW', 'mfcCropH', 'cropX', 'cropY']);
    if (typeof obj.text === 'string') Object.assign(out, { text: obj.text }, pick(obj, ['fontFamily', 'fontSize', 'fontWeight', 'textAlign']));
    if (obj.display) {
      out.channels = (obj.display.channels || []).map(c => pick(c, ['enabled', 'color', 'min', 'max']));
      Object.assign(out, pick(obj.display, ['voxelSizeUm', 'brightness', 'contrast', 'zMode', 'zIndex', 'tIndex']));
    }
    if (Array.isArray(obj.path)) out.pathCommands = obj.path.length;
    if (obj.objects) out.objects = obj.objects.map(node);
    if (obj.clipPath) out.clipPath = node(obj.clipPath);
    return out;
  };
  const props = state.docProps || {};
  return {
    docProps: pick(props, ['name', 'width', 'height', 'unit', 'dpi']),
    pages: Math.max(1, Math.floor(props.pages) || 1),
    objectCount: (state.objects || []).length,
    objects: (state.objects || []).map(node)
  };
}

/** Differences between two summaries, as readable paths ("objects[3].left: 120 ≠ 121"). Numbers may differ by `tolerance`. */
function compatDifferences(actual, expected, tolerance = 0.02, path = '') {
  if (typeof expected === 'number' && typeof actual === 'number')
    return Math.abs(actual - expected) <= tolerance ? [] : [`${path}: ${actual} ≠ ${expected}`];
  if (expected === null || typeof expected !== 'object' || actual === null || typeof actual !== 'object')
    return actual === expected ? [] : [`${path}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`];
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  return [...keys].flatMap(key => compatDifferences(actual[key], expected[key], tolerance, path ? `${path}${Array.isArray(expected) ? `[${key}]` : '.' + key}` : key));
}

/** A summary without the sizes the browser measures from fonts when a text is opened (a text's width and
    height, a text box's height): they are not saved data, and Chromium and Firefox measure slightly differently. */
function compatWithoutMeasuredText(summary) {
  const strip = obj => {
    const out = { ...obj };
    if (out.type === 'text' || out.type === 'i-text') { delete out.width; delete out.height; }
    if (out.type === 'textbox') delete out.height;
    if (out.objects) out.objects = out.objects.map(strip);
    if (out.clipPath) out.clipPath = strip(out.clipPath);
    return out;
  };
  return { ...summary, objects: summary.objects.map(strip) };
}

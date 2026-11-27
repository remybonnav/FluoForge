/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Templates (P3-T6), the pure part: a figure without its images, and the five built-in templates.
   A template is a JSON file:
     { format: 'fluoforge-template', version: 1, name, appVersion, schema, docProps, nextId, objects }
   Its objects are those of a saved figure (js/project.js captureState), except that every image has
   become an empty frame: a rectangle of the image's place and size, with `mfcType: 'imageFrame'`,
   keeping the image's id and links (grid cell, panel letter, comparison group, quick-figure row,
   inset outline, scale bar) but no pixels, no source and no file name. A frame can remember the
   image's channel settings (names, LUTs, ranges, gamma) as `mfcFrameDisplay`, offered again when an
   image is dropped in. Frames filled together from one file share `mfcFrameGroup`, each showing one
   channel (`mfcFrameChannel`, -1 for all), Z slice (`mfcFrameZ`) or time point (`mfcFrameT`).
   An inset frame (`mfcFrameInsetContour`) is filled from its outline on another frame's image. */

import * as G from './grid-model.js';

export const TEMPLATE_FORMAT = 'fluoforge-template';
export const TEMPLATE_VERSION = 1;
export const FRAME_TYPE = 'imageFrame';
/** How an empty frame looks in the editor (it is never exported). */
export const FRAME_STYLE = { fill: 'rgba(120,130,150,0.12)', stroke: '#8a94a6', strokeWidth: 1, strokeDashArray: [6, 4], strokeUniform: true };

const copy = value => JSON.parse(JSON.stringify(value));
/** Image fields that hold pixels or point at a file: a template keeps none of them. */
const IMAGE_ONLY = ['sourceId', 'workingScale', 'cropX', 'cropY', 'filters', 'display', 'src', 'crossOrigin', 'mfcRawWidth', 'mfcRawHeight', 'mfcFileName', 'resizeFilter',
  'mfcVectorSource', 'mfcVectorDpi', 'mfcRasterised', 'mfcConverted', 'mfcImportMessage'];
/** An inset view's links, kept on its frame under other names (the inset code would act on them). */
const INSET_LINKS = ['mfcIsInset', 'mfcInsetContourId', 'mfcInsetSourceId'];

/** The channel settings of an image's saved display, without pixel data or calibration. */
export function displaySettings(display) {
  if (!display || !Array.isArray(display.channels)) return null;
  return {
    channels: display.channels.map(c => ({ name: c.name ?? null, enabled: c.enabled !== false, color: c.color ?? null, min: c.min, max: c.max,
      gamma: Number.isFinite(c.gamma) && c.gamma > 0 ? c.gamma : 1, invert: !!c.invert, ...(c.lut ? { lut: c.lut } : {}) })),
    brightness: display.brightness || 0, contrast: display.contrast || 0
  };
}

/** An image's saved object (captureState) as an empty frame of the same place, size and links. */
export function imageToFrame(json) {
  const frame = { type: 'rect', originX: json.originX || 'left', originY: json.originY || 'top', left: json.left || 0, top: json.top || 0,
    width: Math.abs((json.width || 1) * (json.scaleX ?? 1)), height: Math.abs((json.height || 1) * (json.scaleY ?? 1)),
    scaleX: 1, scaleY: 1, angle: json.angle || 0, flipX: false, flipY: false, opacity: json.opacity ?? 1, visible: json.visible !== false, ...FRAME_STYLE };
  for (const [key, value] of Object.entries(json)) {
    if (!key.startsWith('mfc') || IMAGE_ONLY.includes(key) || INSET_LINKS.includes(key)) continue;
    frame[key] = copy(value);
  }
  frame.mfcType = FRAME_TYPE;
  if (json.mfcIsInset && json.mfcInsetContourId) frame.mfcFrameInsetContour = json.mfcInsetContourId;
  // A quick-figure row fills again from one file: each panel its channel.
  if (typeof json.mfcMontageGroup === 'string') { frame.mfcFrameGroup = json.mfcMontageGroup; frame.mfcFrameChannel = Number.isInteger(json.mfcMontageChannel) ? json.mfcMontageChannel : -1; if (json.mfcMontageGrey) frame.mfcFrameGrey = true; }
  // A series montage panel: the frame shows its place in the series (spread over the new file's planes).
  if (json.mfcSeries && typeof json.mfcSeries === 'object' && Number.isInteger(json.mfcSeries.position)) frame[json.mfcSeries.axis === 'z' ? 'mfcFrameZ' : 'mfcFrameT'] = json.mfcSeries.position;
  const display = displaySettings(json.display);
  if (display) frame.mfcFrameDisplay = display;
  return frame;
}

/** An object of a saved figure with its images (also inside groups) turned into frames. */
function stripObject(json) {
  if (json.mfcType === 'mfcImage' || json.mfcType === 'mfcVector') return imageToFrame(json); // a plot leaves a frame too (P3-T10)
  const out = copy(json);
  if (Array.isArray(json.objects)) out.objects = json.objects.map(stripObject);
  // A shape crop of an image goes with the image; others stay.
  if (json.clipPath && (json.clipPath.mfcType === 'mfcImage' || json.clipPath.mfcType === 'mfcVector')) delete out.clipPath;
  return out;
}

/** The template of a saved figure state (js/project.js captureState): layout, styles and labels, no image data. */
export function templateFromState(state, name, appVersion) {
  const docProps = copy(state.docProps || {});
  delete docProps.checkDismissals; // findings of the figure's own images
  docProps.name = String(name || docProps.name || 'Template').trim() || 'Template';
  return { format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, name: docProps.name, appVersion: appVersion || null,
    schema: state.schema, docProps, nextId: state.nextId || 1, objects: (state.objects || []).map(stripObject) };
}

/** Whether any saved object (also inside groups) holds image data. */
export function holdsImageData(objects) {
  return (objects || []).some(o => o && (o.mfcType === 'mfcImage' || o.sourceId != null || o.display != null || (typeof o.src === 'string' && o.src.length > 0) ||
    (Array.isArray(o.objects) && holdsImageData(o.objects)) || (o.clipPath && holdsImageData([o.clipPath]))));
}

/** The problems of a template file (an empty list when it can be opened). */
export function templateProblems(t) {
  if (!t || typeof t !== 'object' || t.format !== TEMPLATE_FORMAT) return ['This is not a FluoForge template (format "fluoforge-template").'];
  const out = [];
  if (!(t.version >= 1)) out.push('The template has no version.');
  if (t.version > TEMPLATE_VERSION) out.push(`The template is version ${t.version}, from a newer FluoForge; this one opens version ${TEMPLATE_VERSION}.`);
  if (!Number.isInteger(t.schema) || t.schema < 0) out.push('The template has no schema number.');
  if (!t.docProps || !(t.docProps.width > 0) || !(t.docProps.height > 0) || !(t.docProps.dpi > 0)) out.push('The template has no page size.');
  if (!Array.isArray(t.objects)) out.push('The template has no objects.');
  else if (holdsImageData(t.objects)) out.push('The template holds image data; a template keeps the layout only.');
  return out;
}

/** The figure state a template opens as (its frames empty). */
export const stateFromTemplate = t => ({ schema: t.schema, documentOpen: true, docProps: copy(t.docProps), nextId: t.nextId || 1, objects: copy(t.objects) });

// ---- the built-in templates ----
const FONT = 'Liberation Sans';
/** The built-in templates: id, name, description. */
export const BUILT_IN = [
  { id: 'single-inset', name: 'Single image with inset', description: 'One image and a magnified inset beside it, with its outline on the image.' },
  { id: 'split-channels', name: 'Split channels', description: 'Three channels in grey and their merge in a row; one file fills all four.' },
  { id: 'comparison-2x3', name: '2 × 3 comparison', description: 'Two rows of three images linked as a comparison group (same range, LUT and gamma).' },
  { id: 'time-series', name: 'Time series strip', description: 'Five time points of one file in a row, labelled with their frame.' },
  { id: 'z-series', name: 'Z series strip', description: 'Five Z slices of one file in a row, labelled with their slice.' }
];

/**
 * The template of a built-in: an A4-wide page (174 mm content) at `dpi`, frames in a grid with their
 * labels. Ids are made with the template's own counter.
 */
export function builtInTemplate(id, dpi = 300, fontSizePt = 8) {
  const info = BUILT_IN.find(b => b.id === id);
  if (!info) throw new Error('No built-in template "' + id + '".');
  let next = 1;
  const take = prefix => prefix + next++;
  const px = mm => G.mmToPx(mm, dpi), fontSize = (fontSizePt / 72) * dpi;
  const page = { width: 18.4, height: 12, unit: 'cm' }, origin = { x: px(5), y: px(5) };
  const objects = [];
  const frame = (box, extra = {}) => {
    const f = { type: 'rect', originX: 'left', originY: 'top', left: origin.x + px(box.left), top: origin.y + px(box.top), width: px(box.width), height: px(box.height),
      scaleX: 1, scaleY: 1, angle: 0, ...FRAME_STYLE, mfcId: take('img'), mfcType: FRAME_TYPE, ...extra };
    objects.push(f);
    return f;
  };
  const text = (value, box, extra = {}) => {
    const t = { type: 'textbox', text: value, originX: 'left', originY: 'top', left: origin.x + px(box.left), top: origin.y + px(box.top), width: px(box.width),
      fontSize, fontFamily: FONT, fill: '#000000', textAlign: 'center', mfcId: take('txt'), mfcType: 'text', mfcVAlign: 'middle', mfcBoxHeight: px(box.height), ...extra };
    objects.push(t);
    return t;
  };
  /** A grid of frames (rows × cols of cellW × cellH mm) with column labels; extra(row, col) gives each frame's fields. */
  const grid = (rows, cols, cellW, cellH, labels, extra) => {
    let g = G.makeGrid({ rows, cols, cellW, cellH, gutter: 2, colBand: labels ? 5 : 0, rowBand: 0 });
    const gridId = take('grid'), frames = [];
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const f = { ...frame({ left: 0, top: 0, width: 1, height: 1 }) };
      objects.pop();
      g = G.place(g, f.mfcId, row, col, 'fill');
      const box = G.areaBox(g, G.areaOf(g, f.mfcId));
      Object.assign(f, { left: origin.x + px(box.left), top: origin.y + px(box.top), width: px(box.width), height: px(box.height), mfcGridId: gridId, ...extra(row, col) });
      frames.push(f);
    }
    const size = G.gridSize(g);
    objects.push({ type: 'rect', originX: 'left', originY: 'top', left: origin.x, top: origin.y, width: px(size.width), height: px(size.height),
      fill: 'rgba(0,0,0,0)', strokeWidth: 0, mfcId: gridId, mfcType: 'layoutGrid', mfcGrid: g });
    objects.push(...frames);
    if (labels) labels.forEach((value, col) => text(value, G.colLabelBox(g, col), { mfcGridId: gridId, mfcGridLabel: 'col', mfcGridIndex: col }));
    return { g, frames };
  };
  if (id === 'single-inset') {
    const main = frame({ left: 0, top: 0, width: 100, height: 100 }, { mfcLetter: { skip: false } });
    const insetBox = { left: 104, top: 0, width: 60, height: 60 };
    // The outline on the main frame: a quarter of its width, near its centre.
    const contour = { type: 'rect', originX: 'left', originY: 'top', left: main.left + px(55), top: main.top + px(35), width: px(25), height: px(25), scaleX: 1, scaleY: 1,
      fill: 'rgba(0,0,0,0)', stroke: '#ffff00', strokeWidth: 2, strokeUniform: true, mfcId: take('contour'), mfcType: 'insetContour', mfcInsetSourceId: main.mfcId };
    objects.push(contour);
    const inset = frame(insetBox, { mfcFrameInsetContour: contour.mfcId, mfcLetter: { skip: false } });
    contour.mfcInsetTargetId = inset.mfcId;
  } else if (id === 'split-channels') {
    const group = 'tplgrp' + next++;
    grid(1, 4, 42, 42, ['Channel 1', 'Channel 2', 'Channel 3', 'Merge'], (row, col) => ({ mfcFrameGroup: group, mfcFrameChannel: col < 3 ? col : -1, ...(col < 3 ? { mfcFrameGrey: true } : {}) }));
  } else if (id === 'comparison-2x3') {
    grid(2, 3, 52, 52, ['Condition 1', 'Condition 2', 'Condition 3'], () => ({ mfcCompareGroup: 1, mfcLetter: { skip: false } }));
  } else if (id === 'time-series' || id === 'z-series') {
    const group = 'tplgrp' + next++, key = id === 'time-series' ? 'mfcFrameT' : 'mfcFrameZ', word = id === 'time-series' ? 'Frame' : 'Slice';
    const { frames } = grid(1, 5, 33.6, 33.6, [1, 2, 3, 4, 5].map(n => `${word} ${n}`), (row, col) => ({ mfcFrameGroup: group, [key]: col }));
    // The labels say which frame or slice each panel shows once filled.
    objects.filter(o => o.mfcGridLabel === 'col').forEach((label, i) => { label.mfcFrameSeriesLabel = { frame: frames[i].mfcId, word }; });
  }
  return { format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, name: info.name, appVersion: null, schema: 9,
    docProps: { name: info.name, ...page, dpi, pages: 1 }, nextId: next, objects };
}

// ---- filling frames from one file ----
/** The channel settings to give an image dropped in a frame: the frame's saved settings for the channels with the same name. */
export function matchChannels(newChannels, saved) {
  const byName = new Map();
  for (const c of (saved && saved.channels) || []) { const key = String(c.name ?? '').trim().toLowerCase(); if (key && !byName.has(key)) byName.set(key, c); }
  return newChannels.map(c => { const key = String(c.name ?? '').trim().toLowerCase(); return key ? byName.get(key) || null : null; });
}

/** The plane a series frame shows: `count` frames spread over `size` planes, first and last included. */
export function seriesIndex(position, count, size) {
  if (size <= 1) return 0;
  if (count <= 1) return 0;
  if (size >= count) return Math.round(position * (size - 1) / (count - 1));
  return Math.min(position, size - 1);
}

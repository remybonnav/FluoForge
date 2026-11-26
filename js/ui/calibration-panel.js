/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The calibration fields of the Channels panel (P3-T9a): pixel size (its field and hint are filled by
   js/image/channels.js), Z step for a Z stack and frame interval for a time series. Under each field,
   a warning says when the value in use is not the one stored in the image file, with a button that
   goes back to the file's value. A typed Z step or interval reaches every panel of the image's
   quick-figure or series montage, so the labels of a montage agree; it is one History step and the
   Z and time labels follow it. */

import { pushHistory } from '../core/history.js';
import { canvas, registry } from '../core/state.js';
import { withMontageMembers } from '../image/comparison.js';
import { currentCalibration, fileCalibration } from '../image/calibration.js';
import { differenceWarning, positive, sameValue, showNumber } from '../image/calibration-model.js';
import { refreshChannelPanel, resetPixelSize } from '../image/channels.js';
import { selectedObjects } from './selection-bar.js';

const FIELDS = {
  pixelsize: { key: 'pixelSizeUm', unit: 'µm/px' },
  zstep: { key: 'zStepUm', unit: 'µm', prop: 'mfcZStepUm' },
  finterval: { key: 'frameIntervalS', unit: 's', prop: 'mfcTimeIntervalS' }
};
const isImage = o => !!(o && o.mfcType === 'mfcImage' && registry[o.mfcId]);
const selectedImages = () => selectedObjects(isImage);
const $ = id => document.getElementById(id);

/** The warning for `images` on one field, or '' when every image uses its file's value (or has none). */
export function calibrationWarning(images, field) {
  const { key, unit } = FIELDS[field];
  const differing = images.filter(img => differenceWarning(currentCalibration(img)[key], fileCalibration(img)[key], unit));
  if (!differing.length) return '';
  if (images.length === 1) return differenceWarning(currentCalibration(images[0])[key], fileCalibration(images[0])[key], unit);
  return `Differs from the file for ${differing.length} of the ${images.length} selected images.`;
}

function showWarning(field, images) {
  const text = calibrationWarning(images, field);
  $(`ch-${field}-warn`).textContent = text;
  $(`ch-${field}-warn-row`).classList.toggle('hidden', !text);
}

/** One shared value of `images` for a field (null for none), or undefined when they differ. */
function shared(images, key) {
  const first = currentCalibration(images[0])[key];
  return images.every(img => sameValue(currentCalibration(img)[key], first)) ? first : undefined;
}

/** Fills the Z step and frame interval fields and the three warnings for the selected images. */
export function refreshCalibration(images = selectedImages()) {
  if (!$('ch-zstep')) return;
  showWarning('pixelsize', images);
  const stackOf = img => registry[img.mfcId].rawImage.stack;
  for (const [field, size] of [['zstep', 'sizeZ'], ['finterval', 'sizeT']]) {
    const own = images.filter(img => (stackOf(img) || {})[size] > 1);
    $(`ch-${field}-row`).classList.toggle('hidden', !own.length);
    if (!own.length) continue;
    const input = $(`ch-${field}`), { key } = FIELDS[field], value = shared(own, key);
    if (document.activeElement !== input) input.value = value == null ? '' : showNumber(value);
    const files = own.map(img => fileCalibration(img)[key]);
    input.placeholder = value === undefined ? 'mixed' : files[0] != null ? `${showNumber(files[0])} (file)` : 'not in the file';
    showWarning(field, own);
  }
}

/**
 * Sets the Z step ('zstep') or frame interval ('finterval') of the selected images and the other
 * panels of their montages. Empty, or the file's own value, goes back to the file's value.
 */
export function applyCalibration(field, value) {
  const { prop, key } = FIELDS[field];
  const size = field === 'zstep' ? 'sizeZ' : 'sizeT';
  const images = withMontageMembers(selectedImages()).filter(img => (registry[img.mfcId].rawImage.stack || {})[size] > 1);
  if (!images.length) return;
  const v = positive(value);
  for (const img of images) {
    if (v == null || sameValue(v, fileCalibration(img)[key])) delete img[prop];
    else img[prop] = v;
  }
  pushHistory(); // re-fills the Z and time labels
  canvas.requestRenderAll();
  refreshChannelPanel(); // the Z line, the fields and the warnings
}

/** Connects the Z step and frame interval fields and the "Use file value" buttons (once). */
export function installCalibration() {
  for (const field of ['zstep', 'finterval']) {
    const input = $(`ch-${field}`);
    if (!input) continue;
    input.addEventListener('change', e => applyCalibration(field, e.target.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    $(`ch-${field}-reset`).addEventListener('click', () => { input.value = ''; applyCalibration(field, ''); });
  }
  const reset = $('ch-pixelsize-reset');
  if (reset) reset.addEventListener('click', () => resetPixelSize());
}

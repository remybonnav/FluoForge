/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Channel panel: channel colours, display ranges and visibility, Z and time controls, pixel size, alpha and the tone curve (brightness and contrast). */

import { updateScaleBarsForImage } from '../canvas-app.js';
import { canvas, registry } from '../core/state.js';
import { recomposite } from './import.js';
import { selectedObjects } from '../ui/selection-bar.js';

// ---- channel panel ----
// With several images selected, the panel shows the first one and every edit is
// applied to that same setting on each selected image (channel N of each image);
// other settings of the other images are left as they were.
export function selectedImages() { return selectedObjects(o => o.mfcType === 'mfcImage' && registry[o.mfcId]); }
export function commitImages(images) {
  images.forEach(img => recomposite(img));
  canvas.fire('object:modified', { target: canvas.getActiveObject() });
}

export function refreshChannelPanel() {
  const listEl = document.getElementById('channel-list');
  const nameEl = document.getElementById('channel-image-name');
  const images = selectedImages();
  const calibBox = document.getElementById('channel-calibration');
  const alphaBox = document.getElementById('channel-alpha');
  const toneBox = document.getElementById('channel-tone');

  refreshStackControls(images);
  if (!images.length) {
    listEl.innerHTML = '<p class="hint">Select an image to edit its channels.</p>';
    nameEl.textContent = '';
    calibBox.classList.add('hidden');
    alphaBox.classList.add('hidden');
    toneBox.classList.add('hidden');
    return;
  }
  const active = images[0];
  const entry = registry[active.mfcId];
  const raws = images.map(img => registry[img.mfcId].rawImage);
  nameEl.textContent = images.length > 1 ? '— ' + images.length + ' images (edits apply to all)' : '— ' + active.mfcFileName;
  listEl.innerHTML = '';

  calibBox.classList.remove('hidden');
  const pxSizeInput = document.getElementById('ch-pixelsize');
  const sameVoxel = raws.every(r => r.voxelSizeUm === entry.rawImage.voxelSizeUm);
  pxSizeInput.value = sameVoxel && entry.rawImage.voxelSizeUm != null ? entry.rawImage.voxelSizeUm : '';
  pxSizeInput.placeholder = sameVoxel ? 'unset' : 'mixed';
  document.getElementById('ch-pixelsize-hint').textContent = !sameVoxel
    ? 'The selected images have different pixel sizes; a value typed here is applied to all of them.'
    : entry.rawImage.voxelSizeUm != null
      ? 'Used to calibrate scale bars for this image.'
      : 'No pixel size found in this file — enter one manually to enable scale bars for this image.';

  const withAlpha = raws.filter(r => r.hasAlpha);
  alphaBox.classList.toggle('hidden', !withAlpha.length);
  if (withAlpha.length) {
    const alpha = document.getElementById('ch-alpha-toggle');
    alpha.checked = withAlpha[0].alphaEnabled !== false;
    alpha.indeterminate = !withAlpha.every(r => (r.alphaEnabled !== false) === alpha.checked);
  }

  toneBox.classList.remove('hidden');
  document.getElementById('ch-brightness').value = entry.rawImage.brightness || 0;
  document.getElementById('ch-brightness-val').value = entry.rawImage.brightness || 0;
  document.getElementById('ch-contrast').value = entry.rawImage.contrast || 0;
  document.getElementById('ch-contrast-val').value = entry.rawImage.contrast || 0;

  entry.rawImage.channels.forEach((ch, idx) => {
    const row = document.createElement('div');
    row.className = 'channel-row';
    // The same channel number on every selected image that has one.
    const peers = raws.map(r => r.channels[idx]).filter(Boolean);

    const colorOptions = Object.keys(MFC_TIFF.COLOR_PRESETS)
      .map(c => `<option value="${c}" ${c === ch.color ? 'selected' : ''}>${c}</option>`).join('');

    row.innerHTML = `
        <div class="row-top">
          <input type="checkbox" class="ch-toggle" ${ch.enabled ? 'checked' : ''}>
          <span class="ch-name"></span>
          <span class="swatch" style="background:${swatchColor(ch.color)}"></span>
          <select class="ch-color">${colorOptions}</select>
        </div>
        <div class="range-row">
          <span class="hint">min</span>
          <input type="range" class="ch-min" min="0" max="65535" value="${ch.min}">
          <input type="number" class="rv-input ch-min-val" min="0" max="65535" value="${Math.round(ch.min)}">
        </div>
        <div class="range-row">
          <span class="hint">max</span>
          <input type="range" class="ch-max" min="0" max="65535" value="${ch.max}">
          <input type="number" class="rv-input ch-max-val" min="0" max="65535" value="${Math.round(ch.max)}">
        </div>
      `;
    row.querySelector('.ch-name').textContent = ch.name + (peers.length > 1 ? ' ×' + peers.length : '');
    const toggle = row.querySelector('.ch-toggle');
    toggle.indeterminate = !peers.every(p => !!p.enabled === !!ch.enabled);
    if (peers.length > 1 && !peers.every(p => p.color === ch.color)) row.querySelector('.ch-color').title = 'Colors differ between the selected images';
    listEl.appendChild(row);

    const rangeCeil = ch.bitDepth > 8 ? 65535 : 255;
    const minSlider = row.querySelector('.ch-min'), maxSlider = row.querySelector('.ch-max');
    const minInput = row.querySelector('.ch-min-val'), maxInput = row.querySelector('.ch-max-val');
    [minSlider, maxSlider, minInput, maxInput].forEach(el => el.max = rangeCeil);

    toggle.addEventListener('change', (e) => {
      peers.forEach(p => { p.enabled = e.target.checked; });
      commitImages(images);
    });
    row.querySelector('.ch-color').addEventListener('change', (e) => {
      peers.forEach(p => { p.color = e.target.value; });
      row.querySelector('.swatch').style.background = swatchColor(e.target.value);
      commitImages(images);
    });

    // Slider <-> number input stay in sync in both directions; both funnel through
    // commitMin/commitMax so range validation (min < max, clamped to each channel's
    // range) always applies no matter which control the user touched.
    function commitMin(v) {
      if (!isFinite(v)) v = ch.min; // invalid input handled gracefully: keep previous value
      peers.forEach(p => { p.min = Math.min(Math.max(v, 0), p.max - 1); });
      minSlider.value = ch.min;
      minInput.value = Math.round(ch.min);
    }
    function commitMax(v) {
      if (!isFinite(v)) v = ch.max;
      peers.forEach(p => { p.max = Math.max(Math.min(v, p.bitDepth > 8 ? 65535 : 255), p.min + 1); });
      maxSlider.value = ch.max;
      maxInput.value = Math.round(ch.max);
    }
    const recompositeAll = () => images.forEach(img => recomposite(img));

    minSlider.addEventListener('input', (e) => { commitMin(parseFloat(e.target.value)); recompositeAll(); });
    maxSlider.addEventListener('input', (e) => { commitMax(parseFloat(e.target.value)); recompositeAll(); });
    minSlider.addEventListener('change', () => canvas.fire('object:modified', { target: canvas.getActiveObject() }));
    maxSlider.addEventListener('change', () => canvas.fire('object:modified', { target: canvas.getActiveObject() }));

    // "change" fires on blur, and also right after Enter's explicit blur() below — this
    // is how typed values get confirmed (Enter, Tab, or clicking elsewhere all commit).
    minInput.addEventListener('change', (e) => { commitMin(parseFloat(e.target.value)); commitImages(images); });
    maxInput.addEventListener('change', (e) => { commitMax(parseFloat(e.target.value)); commitImages(images); });
    minInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); minInput.blur(); } });
    maxInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); maxInput.blur(); } });
  });
}

/** Z / time controls: shown when a selected image is a Z stack or time series. */
export function refreshStackControls(images) {
  const box = document.getElementById('channel-stack');
  const stacked = images.map(img => registry[img.mfcId].rawImage).filter(r => r.stack);
  box.classList.toggle('hidden', !stacked.length);
  if (!stacked.length) return;
  const raw = stacked[0], st = raw.stack;
  const maxZ = Math.max(...stacked.map(r => r.stack.sizeZ)), maxT = Math.max(...stacked.map(r => r.stack.sizeT));
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  document.getElementById('ch-stack-info').textContent = stacked.length > 1
    ? stacked.length + ' selected images are Z stacks or time series; changes apply to all of them.'
    : plural(st.sizeC, 'channel') + ' × ' + plural(st.sizeZ, 'Z slice') + (st.sizeT > 1 ? ' × ' + plural(st.sizeT, 'time frame') : '') +
      (st.sizeZ > 1 && st.zStepUm ? ' (Z step ' + st.zStepUm + ' µm)' : '') + '.';
  const zModeRow = document.getElementById('ch-zmode-row');
  zModeRow.classList.toggle('hidden', maxZ < 2);
  const zMode = document.getElementById('ch-zmode');
  zMode.value = raw.zMode;
  zMode.title = stacked.every(r => r.zMode === raw.zMode) ? '' : 'The selected images use different Z displays';
  const setRange = (id, value, max, show) => {
    document.getElementById(id + '-row').classList.toggle('hidden', !show);
    [document.getElementById(id), document.getElementById(id + '-val')].forEach(el => { el.max = max; el.value = value + 1; });
  };
  setRange('ch-zslice', raw.zIndex, maxZ, maxZ > 1 && stacked.some(r => r.zMode === 'slice'));
  setRange('ch-tframe', raw.tIndex, maxT, maxT > 1);
}

/**
 * Choose the Z display (projection or slice) and time frame of the selected stacks.
 * `commit` records an undo step; without it (slider dragging) only the preview updates.
 */
export function applyStackPlane(change, commit) {
  const images = selectedImages().filter(img => registry[img.mfcId].rawImage.stack);
  if (!images.length) return;
  images.forEach(img => {
    const raw = registry[img.mfcId].rawImage;
    if (change.zMode) raw.zMode = change.zMode;
    if (Number.isFinite(change.zIndex) && raw.stack.sizeZ > 1) { raw.zIndex = change.zIndex; raw.zMode = 'slice'; }
    if (Number.isFinite(change.tIndex)) raw.tIndex = change.tIndex;
    MFC_TIFF.selectPlane(raw);
    recomposite(img);
  });
  refreshStackControls(images);
  if (commit) canvas.fire('object:modified', { target: canvas.getActiveObject() });
  else canvas.requestRenderAll();
}

/** Manually set (or clear) the physical pixel size of the selected image(s) — the only way to calibrate scale bars for formats (JPEG/PNG/BMP) or TIFFs that carry no resolution metadata. */
export function applyPixelSize(value) {
  const images = selectedImages();
  if (!images.length) return;
  const v = parseFloat(value);
  images.forEach(img => {
    registry[img.mfcId].rawImage.voxelSizeUm = (isFinite(v) && v > 0) ? v : null;
    updateScaleBarsForImage(img);
  });
  refreshChannelPanel();
  canvas.fire('object:modified', { target: canvas.getActiveObject() });
}

export function applyAlphaToggle(enabled) {
  const images = selectedImages().filter(img => registry[img.mfcId].rawImage.hasAlpha);
  if (!images.length) return;
  images.forEach(img => { registry[img.mfcId].rawImage.alphaEnabled = !!enabled; });
  commitImages(images);
}

/** Applies the panel's current brightness/contrast values to the selected image(s)' whole composite (see compositeChannels' tone-curve pass — works the same for RGB imports and TIFF composites alike). */
export function applyBrightnessContrast(brightness, contrast) {
  const images = selectedImages();
  if (!images.length) return;
  const clamp = v => Math.max(-100, Math.min(100, v));
  const b = isFinite(brightness) ? clamp(brightness) : 0, c = isFinite(contrast) ? clamp(contrast) : 0;
  // Only the value that changed (relative to the image shown in the panel) is copied
  // to the other selected images, so moving brightness keeps each image's contrast.
  const shown = registry[images[0].mfcId].rawImage;
  const setBrightness = b !== (shown.brightness || 0) || images.length === 1;
  const setContrast = c !== (shown.contrast || 0) || images.length === 1;
  images.forEach(img => {
    const raw = registry[img.mfcId].rawImage;
    if (setBrightness) raw.brightness = b;
    if (setContrast) raw.contrast = c;
    recomposite(img);
  });
  document.getElementById('ch-brightness').value = b;
  document.getElementById('ch-brightness-val').value = b;
  document.getElementById('ch-contrast').value = c;
  document.getElementById('ch-contrast-val').value = c;
}

export function commitBrightnessContrast() {
  canvas.fire('object:modified', { target: canvas.getActiveObject() });
}

export function resetToneCurve() {
  selectedImages().forEach(img => { const raw = registry[img.mfcId].rawImage; raw.brightness = 0; raw.contrast = 0; });
  applyBrightnessContrast(0, 0);
  commitBrightnessContrast();
}

export function swatchColor(name) {
  const [r, g, b] = MFC_TIFF.COLOR_PRESETS[name];
  return `rgb(${r * 255},${g * 255},${b * 255})`;
}

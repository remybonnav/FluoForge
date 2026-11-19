/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Channel panel: channel colours, display ranges and visibility, Z and time controls, pixel size, alpha and the tone curve (brightness and contrast). */

import { canvas, registry } from '../core/state.js';
import { recomposite } from './import.js';
import { updateScaleBarsForImage } from '../tools/scalebar.js';
import { selectedObjects } from '../ui/selection-bar.js';
import { LUT_GROUPS, LUT_LABELS, FILE_LUT, channelLUT, lutGradient } from './luts.js';
import { addCalibrationBar } from '../tools/calibration-bar.js';
import { autoRange, logBins, sliderLimits } from './composite-core.js';

// ---- channel panel ----
// With several images selected, the panel shows the first one and every edit is
// applied to that same setting on each selected image (channel N of each image);
// other settings of the other images are left as they were.
const gammaOf = ch => (Number.isFinite(ch.gamma) && ch.gamma > 0 ? ch.gamma : 1);
const HIST_BINS = 128;
const isFloatData = data => data instanceof Float32Array || data instanceof Float64Array;
/** What a channel's min and max may be: the data type's range for integers (min < max by 1). */
const typeRange = ch => (isFloatData(ch.data) ? { lo: -Infinity, hi: Infinity, gap: 1e-6 } : { lo: 0, hi: ch.bitDepth > 8 ? 65535 : 255, gap: 1 });
const rangeValues = ch => [ch.min, ch.max, ch.fileMin, ch.fileMax].filter(Number.isFinite);

/** The log-scale histogram behind a channel's sliders, with the display range shaded. */
function drawHistogram(row, hist, limits, ch) {
  const svg = row.querySelector('.ch-hist');
  if (!svg) return;
  const span = limits.hi - limits.lo || 1;
  const x0 = Math.max(0, Math.min(1, (ch.min - limits.lo) / span)), x1 = Math.max(0, Math.min(1, (ch.max - limits.lo) / span));
  const shade = svg.querySelector('.ch-hist-range');
  shade.setAttribute('x', String(x0 * HIST_BINS)); shade.setAttribute('width', String(Math.max(0, x1 - x0) * HIST_BINS));
  if (!hist) { svg.dataset.state = 'pending'; return; }
  const key = limits.lo + '|' + limits.hi;
  if (svg.dataset.key === key) return;
  svg.dataset.key = key; svg.dataset.state = 'ready';
  const bars = logBins(hist, limits.lo, limits.hi, HIST_BINS);
  let d = 'M0 1';
  for (let b = 0; b < HIST_BINS; b++) { const y = (1 - bars[b]).toFixed(3); d += `V${y}H${b + 1}`; }
  svg.querySelector('.ch-hist-bars').setAttribute('d', d + 'V1Z');
}
export function selectedImages() { return selectedObjects(o => o.mfcType === 'mfcImage' && registry[o.mfcId]); }
export function commitImages(images) {
  images.forEach(img => recomposite(img));
  canvas.fire('object:modified', { target: canvas.getActiveObject() });
}

export function refreshChannelPanel() {
  closeLutPicker(false);
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


    row.innerHTML = `
        <div class="row-top">
          <input type="checkbox" class="ch-toggle" ${ch.enabled ? 'checked' : ''}>
          <span class="ch-name"></span>
          <button type="button" class="ch-lut" aria-haspopup="true" aria-expanded="false"><span class="lut-swatch"></span><span class="lut-name"></span></button>
          <button type="button" class="ch-calbar icon-btn" title="Add a calibration bar for this channel: a gradient with its min and max, next to the image. It follows the channel's range and LUT.">▮</button>
        </div>
        <div class="ch-ranges">
          <svg class="ch-hist" viewBox="0 0 ${HIST_BINS} 1" preserveAspectRatio="none" aria-hidden="true">
            <rect class="ch-hist-range" x="0" y="0" width="0" height="1"></rect><path class="ch-hist-bars" d=""></path>
          </svg>
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
        </div>
        <div class="ch-range-buttons">
          <button type="button" class="ch-auto" title="Auto contrast, as ImageJ's Auto and Enhance Contrast (saturated 0.35 %): saturate 0.175 % of the pixels at each end of the displayed plane">Auto</button>
          <button type="button" class="ch-full" title="Show the full range of the data type (for example 0–4095 for 12-bit data)">Full range</button>
          <button type="button" class="ch-reset" title="Go back to the display range stored in the file">Reset to file</button>
        </div>
        <div class="range-row ch-display-row">
          <label class="hint" for="ch-gamma-${idx}">gamma</label>
          <input type="number" class="rv-input ch-gamma" id="ch-gamma-${idx}" min="0.1" max="5" step="0.05" value="${gammaOf(ch)}"
            title="Gamma for this channel's display (1 = linear). Above 1 darkens the dim parts, below 1 brightens them. The raw data is not changed.">
          <label class="ch-invert-label" title="Invert this channel's display: bright becomes dark (like Invert LUT in Fiji). The raw data is not changed."><input type="checkbox" class="ch-invert" ${ch.invert ? 'checked' : ''}> invert</label>
        </div>
      `;
    row.querySelector('.ch-name').textContent = ch.name + (peers.length > 1 ? ' ×' + peers.length : '');
    const toggle = row.querySelector('.ch-toggle');
    toggle.indeterminate = !peers.every(p => !!p.enabled === !!ch.enabled);
    const gammaInput = row.querySelector('.ch-gamma'), invertBox = row.querySelector('.ch-invert');
    if (peers.length > 1 && !peers.every(p => gammaOf(p) === gammaOf(ch))) gammaInput.title += ' The selected images use different values.';
    invertBox.indeterminate = !peers.every(p => !!p.invert === !!ch.invert);
    const lutButton = row.querySelector('.ch-lut');
    showLut(lutButton, ch, peers.length > 1 && !peers.every(p => p.color === ch.color && p.lut === ch.lut));
    listEl.appendChild(row);

    const minSlider = row.querySelector('.ch-min'), maxSlider = row.querySelector('.ch-max');
    const minInput = row.querySelector('.ch-min-val'), maxInput = row.querySelector('.ch-max-val');
    minSlider.setAttribute('aria-label', 'Display minimum of ' + ch.name);
    maxSlider.setAttribute('aria-label', 'Display maximum of ' + ch.name);
    minSlider.title = 'Display minimum: values at or below it show as the darkest colour of the LUT. The raw data is not changed.';
    maxSlider.title = 'Display maximum: values at or above it show as the brightest colour of the LUT. The raw data is not changed.';
    const isFloat = isFloatData(ch.data);
    // Typed values may use the whole data type; the sliders follow the data (see applyLimits).
    const typeCeil = isFloat ? null : ch.bitDepth > 8 ? 65535 : 255;
    [minInput, maxInput].forEach(el => { if (isFloat) { el.removeAttribute('min'); el.removeAttribute('max'); el.step = 'any'; } else el.max = typeCeil; });
    let hist = null, limits = sliderLimits(null, isFloat ? 32 : ch.bitDepth, rangeValues(ch));
    const hasFile = peers.some(p => Number.isFinite(p.fileMin) && Number.isFinite(p.fileMax));
    const resetBtn = row.querySelector('.ch-reset');
    resetBtn.disabled = !hasFile;
    if (!hasFile) resetBtn.title = 'This image has no display range from its file';
    const fmt = v => (isFloat ? String(+v.toPrecision(4)) : String(Math.round(v)));
    function applyLimits() {
      limits = sliderLimits(hist, isFloat ? 32 : ch.bitDepth, rangeValues(ch));
      const step = limits.integer ? 1 : (limits.hi - limits.lo) / 1000;
      for (const slider of [minSlider, maxSlider]) { slider.min = limits.lo; slider.max = limits.hi; slider.step = step; }
      minSlider.value = ch.min; maxSlider.value = ch.max;
      drawHistogram(row, hist, limits, ch);
    }
    applyLimits();
    MFC_TIFF.histogram(ch.data).then(h => { if (h && row.isConnected) { hist = h; applyLimits(); } }).catch(() => {});

    toggle.addEventListener('change', (e) => {
      peers.forEach(p => { p.enabled = e.target.checked; });
      commitImages(images);
    });
    lutButton.addEventListener('click', () => openLutPicker(lutButton, ch, (color, lut) => {
      peers.forEach(p => { p.color = color; if (color === FILE_LUT) p.lut = lut; });
      showLut(lutButton, ch, false);
      commitImages(images);
    }));
    row.querySelector('.ch-calbar').addEventListener('click', () => addCalibrationBar(images, idx));

    // Slider <-> number input stay in sync in both directions; both funnel through
    // commitMin/commitMax so range validation (min < max, clamped to each channel's
    // range) always applies no matter which control the user touched.
    function commitMin(v) {
      if (!isFinite(v)) v = ch.min; // invalid input handled gracefully: keep previous value
      peers.forEach(p => { const t = typeRange(p); p.min = Math.min(Math.max(v, t.lo), p.max - t.gap); });
      showRange();
    }
    function commitMax(v) {
      if (!isFinite(v)) v = ch.max;
      peers.forEach(p => { const t = typeRange(p); p.max = Math.max(Math.min(v, t.hi), p.min + t.gap); });
      showRange();
    }
    function showRange() {
      minInput.value = fmt(ch.min); maxInput.value = fmt(ch.max);
      if (ch.min < limits.lo || ch.max > limits.hi) applyLimits();
      else { minSlider.value = ch.min; maxSlider.value = ch.max; drawHistogram(row, hist, limits, ch); }
    }
    minInput.value = fmt(ch.min); maxInput.value = fmt(ch.max);
    // Auto, Full range and Reset to file: each selected image gets its own range (Auto and Full
    // range from its own displayed plane), as one History step.
    const setRanges = async compute => {
      const ranges = await Promise.all(peers.map(async p => compute(p, await MFC_TIFF.histogram(p.data))));
      peers.forEach((p, i) => { const r = ranges[i]; if (r && r.max > r.min) { p.min = r.min; p.max = r.max; } });
      if (!row.isConnected) { commitImages(images); return; }
      showRange();
      commitImages(images);
    };
    const run = compute => MFC_TIFF.track(setRanges(compute)).catch(error => MFC_ERRORS.report(error, { title: 'Could not set the display range' }));
    row.querySelector('.ch-auto').addEventListener('click', () => run((p, h) => h && autoRange(h)));
    row.querySelector('.ch-full').addEventListener('click', () => run((p, h) => { const l = sliderLimits(h, isFloatData(p.data) ? 32 : p.bitDepth); return { min: l.lo, max: l.hi }; }));
    resetBtn.addEventListener('click', () => run(p => (Number.isFinite(p.fileMin) && Number.isFinite(p.fileMax) ? { min: p.fileMin, max: p.fileMax } : null)));
    const recompositeAll = () => images.forEach(img => recomposite(img));

    minSlider.addEventListener('input', (e) => { commitMin(parseFloat(e.target.value)); recompositeAll(); });
    maxSlider.addEventListener('input', (e) => { commitMax(parseFloat(e.target.value)); recompositeAll(); });
    minSlider.addEventListener('change', () => canvas.fire('object:modified', { target: canvas.getActiveObject() }));
    maxSlider.addEventListener('change', () => canvas.fire('object:modified', { target: canvas.getActiveObject() }));

    // "change" fires on blur, and also right after Enter's explicit blur() below — this
    // is how typed values get confirmed (Enter, Tab, or clicking elsewhere all commit).
    minInput.addEventListener('change', (e) => { commitMin(parseFloat(e.target.value)); commitImages(images); });
    maxInput.addEventListener('change', (e) => { commitMax(parseFloat(e.target.value)); commitImages(images); });
    // Gamma: live while typing or using the arrows, committed to the history on change.
    const commitGamma = v => {
      const g = Number.isFinite(v) ? Math.min(5, Math.max(0.1, Math.round(v * 100) / 100)) : gammaOf(ch);
      peers.forEach(p => { p.gamma = g; });
      return g;
    };
    gammaInput.addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0.1 && v <= 5) { commitGamma(v); recompositeAll(); } });
    gammaInput.addEventListener('change', (e) => { gammaInput.value = commitGamma(parseFloat(e.target.value)); commitImages(images); });
    gammaInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gammaInput.blur(); } });
    invertBox.addEventListener('change', (e) => { peers.forEach(p => { p.invert = e.target.checked; }); commitImages(images); });
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
export async function applyStackPlane(change, commit) {
  const images = selectedImages().filter(img => registry[img.mfcId].rawImage.stack);
  if (!images.length) return;
  // The settings change at once (so the controls and history see them); the planes follow when
  // a projection, computed off the main thread, is ready.
  const planes = images.map(img => {
    const raw = registry[img.mfcId].rawImage;
    if (change.zMode) raw.zMode = change.zMode;
    if (Number.isFinite(change.zIndex) && raw.stack.sizeZ > 1) { raw.zIndex = change.zIndex; raw.zMode = 'slice'; }
    if (Number.isFinite(change.tIndex)) raw.tIndex = change.tIndex;
    return MFC_TIFF.track(MFC_TIFF.selectPlane(raw).then(() => recomposite(img)));
  });
  refreshStackControls(images);
  if (commit) canvas.fire('object:modified', { target: canvas.getActiveObject() });
  else canvas.requestRenderAll();
  await Promise.all(planes);
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

/** Applies the panel's current brightness/contrast values to the selected image(s)' whole composite (see the tone-curve pass in js/image/composite-core.js — works the same for RGB imports and TIFF composites alike). */
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

/** The LUT button of a channel row: its gradient and name. */
function showLut(button, ch, mixed) {
  const name = LUT_LABELS[ch.color] || ch.color;
  button.querySelector('.lut-swatch').style.background = lutGradient(channelLUT(ch.color, ch.lut));
  button.querySelector('.lut-name').textContent = mixed ? 'Mixed' : name;
  button.title = 'Colour table (LUT) of ' + (ch.name || 'this channel') + ': ' + (mixed ? 'differs between the selected images' : name) + '. Click (or Enter) to choose another.';
}

let openPicker = null;
/** Closes the LUT popover, if one is open, and gives the focus back to its button. */
export function closeLutPicker(returnFocus = true) {
  if (!openPicker) return;
  const { box, button, onOutside } = openPicker;
  openPicker = null;
  document.removeEventListener('pointerdown', onOutside, true);
  box.remove();
  button.setAttribute('aria-expanded', 'false');
  if (returnFocus) button.focus();
}

/**
 * The LUT popover: gradient swatches grouped as in LUT_GROUPS, plus "From file" when the channel
 * has a LUT read from its file. Arrow keys move, Enter or Space choose, Escape closes.
 */
function openLutPicker(button, ch, choose) {
  if (openPicker && openPicker.button === button) { closeLutPicker(); return; }
  closeLutPicker(false);
  const box = document.createElement('div');
  box.className = 'lut-popover'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Choose a colour table (LUT)');
  const groups = LUT_GROUPS.map(g => ({ name: g.name, luts: g.luts.map(name => ({ name, lut: channelLUT(name) })) }));
  // The file's own LUT stays available after another LUT was chosen.
  if (typeof ch.lut === 'string' && ch.lut) groups.push({ name: 'From the image file', luts: [{ name: FILE_LUT, lut: channelLUT(FILE_LUT, ch.lut), bytes: ch.lut }] });
  const options = [];
  for (const group of groups) {
    const title = document.createElement('div'); title.className = 'lut-group-title'; title.textContent = group.name;
    const list = document.createElement('div'); list.className = 'lut-group'; list.setAttribute('role', 'group'); list.setAttribute('aria-label', group.name);
    for (const item of group.luts) {
      const option = document.createElement('button');
      option.type = 'button'; option.className = 'lut-option'; option.dataset.lut = item.name;
      option.setAttribute('aria-pressed', String(item.name === ch.color));
      option.title = LUT_LABELS[item.name] + (item.name === FILE_LUT ? ': the LUT stored in the image file' : '');
      const swatch = document.createElement('span'); swatch.className = 'lut-swatch'; swatch.style.background = lutGradient(item.lut);
      const label = document.createElement('span'); label.textContent = LUT_LABELS[item.name];
      option.append(swatch, label);
      option.addEventListener('click', () => { closeLutPicker(); choose(item.name, item.bytes || null); });
      list.append(option); options.push(option);
    }
    box.append(title, list);
  }
  box.addEventListener('keydown', e => {
    const at = options.indexOf(document.activeElement);
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (move) { e.preventDefault(); options[(at + move + options.length) % options.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); options[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); options[options.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLutPicker(); }
    else if (e.key === 'Tab') closeLutPicker(false);
  });
  document.body.append(box);
  const r = button.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(window.innerWidth - box.offsetWidth - 8, r.right - box.offsetWidth)) + 'px';
  const below = r.bottom + box.offsetHeight + 4 < window.innerHeight ? r.bottom + 4 : r.top - box.offsetHeight - 4;
  box.style.top = Math.max(8, Math.min(window.innerHeight - box.offsetHeight - 8, below)) + 'px'; // always inside the window
  const onOutside = e => { if (!box.contains(e.target) && e.target !== button && !button.contains(e.target)) closeLutPicker(false); };
  document.addEventListener('pointerdown', onOutside, true);
  openPicker = { box, button, onOutside };
  button.setAttribute('aria-expanded', 'true');
  (options.find(o => o.dataset.lut === ch.color) || options[0]).focus();
}

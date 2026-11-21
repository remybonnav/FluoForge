/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Colour-vision and grey-scale preview (top bar → Vision). View only: an SVG colour-matrix filter
   (index.html, #vision-filters) on the canvas container. Nothing in the figure, the history, the
   project or the exports changes (exports recomposite from the source data), and the choice is not
   remembered: every session starts in normal colours. A badge over the canvas says a preview is on. */

export const VISION_MODES = {
  normal: { label: 'Normal', filter: null },
  deuteranopia: { label: 'Deuteranopia (no green cones)', filter: 'vision-deuteranopia' },
  protanopia: { label: 'Protanopia (no red cones)', filter: 'vision-protanopia' },
  tritanopia: { label: 'Tritanopia (no blue cones)', filter: 'vision-tritanopia' },
  greyscale: { label: 'Grey-scale', filter: 'vision-greyscale' }
};

let current = 'normal';
export const visionPreview = () => current;

/** Shows the canvas as seen with the given mode ('normal' turns the preview off). */
export function setVisionPreview(mode) {
  if (!VISION_MODES[mode]) mode = 'normal';
  current = mode;
  const { label, filter } = VISION_MODES[mode];
  document.getElementById('canvas-scroll').style.filter = filter ? `url(#${filter})` : '';
  document.getElementById('vision-select').value = mode;
  const badge = document.getElementById('vision-badge');
  badge.hidden = !filter;
  document.getElementById('vision-badge-text').textContent = filter ? `Preview: ${label}. View only, not exported.` : '';
  return mode;
}

document.getElementById('vision-select').addEventListener('change', event => setVisionPreview(event.target.value));
document.getElementById('vision-normal').addEventListener('click', () => {
  setVisionPreview('normal');
  const select = document.getElementById('vision-select');
  select.focus();
  // Firefox can ignore a focus() made while the clicked button is being hidden; try again next frame.
  if (document.activeElement !== select) requestAnimationFrame(() => select.focus());
});

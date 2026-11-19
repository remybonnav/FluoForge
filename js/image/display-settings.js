/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Copy and paste display settings between images (selection bar and the image context menu).
   What is copied: each channel's on/off, LUT, min, max, gamma and invert, and the image's
   brightness and contrast. Pasting matches channels by number (channel 1 to channel 1, ...);
   extra channels on either side are left as they are. One paste is one History step.
   The copied settings live in memory only, for this tab. */

import { canvas, registry } from '../core/state.js';
import { commitImages, refreshChannelPanel, selectedImages } from './channels.js';
import { FILE_LUT } from './luts.js';

let copied = null;

/** The display settings of one image, as plain data. */
export function displaySettingsOf(img) {
  const raw = registry[img.mfcId].rawImage;
  return {
    fileName: img.mfcFileName || '',
    brightness: raw.brightness || 0, contrast: raw.contrast || 0,
    channels: raw.channels.map(ch => ({ enabled: !!ch.enabled, color: ch.color, lut: ch.color === FILE_LUT ? ch.lut || null : null,
      min: ch.min, max: ch.max, gamma: Number.isFinite(ch.gamma) && ch.gamma > 0 ? ch.gamma : 1, invert: !!ch.invert }))
  };
}

export function copiedDisplaySettings() { return copied; }

/** Copies the display settings of the one selected image. Returns false when that is not one image. */
export function copyDisplaySettings(images = selectedImages()) {
  if (images.length !== 1) return false;
  copied = displaySettingsOf(images[0]);
  refreshDisplayButtons();
  MFC_UI.toast('Copied the display settings of ' + (copied.fileName || 'the image') + ' (' + copied.channels.length + ' channel' + (copied.channels.length === 1 ? '' : 's') + ').');
  return true;
}

/** Applies the copied settings to every selected image, channel by number, as one History step. */
export function pasteDisplaySettings(images = selectedImages(), settings = copied) {
  if (!settings || !images.length) return false;
  let partial = false;
  for (const img of images) {
    const raw = registry[img.mfcId].rawImage;
    if (raw.channels.length !== settings.channels.length) partial = true;
    raw.brightness = settings.brightness; raw.contrast = settings.contrast;
    raw.channels.forEach((ch, i) => {
      const s = settings.channels[i];
      if (!s) return;
      // A "From file" LUT goes with its table; a channel without one keeps its own colour.
      if (s.color !== FILE_LUT || s.lut) { ch.color = s.color; if (s.color === FILE_LUT) ch.lut = s.lut; }
      ch.enabled = s.enabled; ch.gamma = s.gamma; ch.invert = s.invert;
      // Integer data keeps a range its type can hold (8-bit: 0..255).
      const ceiling = ch.data instanceof Float32Array || ch.data instanceof Float64Array ? Infinity : ch.bitDepth > 8 ? 65535 : 255;
      const floor = Number.isFinite(ceiling) ? 0 : -Infinity;
      const gap = Number.isFinite(ceiling) ? 1 : 1e-6;
      ch.min = Math.min(Math.max(s.min, floor), ceiling - gap);
      ch.max = Math.max(Math.min(s.max, ceiling), ch.min + gap);
    });
  }
  commitImages(images);
  refreshChannelPanel();
  MFC_UI.toast('Pasted display settings onto ' + (images.length === 1 ? images[0].mfcFileName || 'the image' : images.length + ' images') +
    (partial ? '. The channel counts differ, so channels were matched by number and the others left as they were.' : '.'));
  return true;
}

// ---- selection bar ----
export function refreshDisplayButtons() {
  const group = document.getElementById('sel-display');
  if (!group) return;
  const images = selectedImages();
  group.classList.toggle('hidden', !images.length);
  if (!images.length) closeImageMenu(false);
  const copyBtn = document.getElementById('obj-copy-display'), pasteBtn = document.getElementById('obj-paste-display');
  copyBtn.disabled = images.length !== 1;
  pasteBtn.disabled = !copied || !images.length;
  pasteBtn.title = copied
    ? 'Paste the display settings copied from ' + (copied.fileName || 'an image') + ' onto the selected images, channel by number (one undo step)'
    : 'Paste display settings: copy them from an image first';
}

// ---- context menu (right click on an image, or the Menu key / Shift+F10 with an image selected) ----
let menu = null, menuReturn = null;
export function closeImageMenu(restoreFocus = true) {
  if (!menu) return;
  menu.remove(); menu = null;
  document.removeEventListener('pointerdown', outside, true);
  if (restoreFocus && menuReturn && menuReturn.isConnected) menuReturn.focus();
  menuReturn = null;
}
const outside = event => { if (menu && !menu.contains(event.target)) closeImageMenu(false); };

/** Opens the image context menu at client coordinates (x, y). */
export function openImageMenu(x, y) {
  closeImageMenu(false);
  const images = selectedImages();
  if (!images.length) return null;
  menuReturn = document.activeElement;
  menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Image');
  const item = (label, title, enabled, run) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'context-item'; b.setAttribute('role', 'menuitem');
    b.textContent = label; b.title = title; b.disabled = !enabled;
    b.addEventListener('click', () => { closeImageMenu(); run(); });
    menu.append(b);
  };
  item('Copy display settings', 'Copy the LUTs, ranges, gamma and invert of this image\'s channels, and its brightness and contrast', images.length === 1, () => copyDisplaySettings(images));
  item('Paste display settings', copied ? 'Paste the copied display settings, channel by number (one undo step)' : 'Copy display settings from an image first', !!copied, () => pasteDisplaySettings(images));
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('.context-item:not(:disabled)')];
    const at = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); items[event.key === 'Home' ? 0 : items.length - 1]?.focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); closeImageMenu(); }
    else if (event.key === 'Tab') { closeImageMenu(false); return; }
    event.stopPropagation(); // keep the canvas shortcuts (arrows nudge, Delete) away from the menu
  });
  document.body.append(menu);
  menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, x)) + 'px';
  menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, y)) + 'px';
  document.addEventListener('pointerdown', outside, true);
  menu.querySelector('.context-item:not(:disabled)')?.focus();
  return menu;
}

/** Called once the canvas exists (canvas-events init). */
export function installImageMenu() {
  const upper = canvas.upperCanvasEl;
  if (!upper || upper.__mfcImageMenu) return;
  upper.__mfcImageMenu = true;
  upper.addEventListener('contextmenu', event => {
    const target = canvas.findTarget(event, false);
    const hit = target && (target.mfcType === 'mfcImage' ? target
      : target.type === 'activeSelection' && target.getObjects().some(o => o.mfcType === 'mfcImage') ? target : null);
    if (!hit || !(hit.type === 'activeSelection' || registry[hit.mfcId])) return; // the browser's own menu elsewhere
    event.preventDefault();
    if (hit !== canvas.getActiveObject()) { canvas.setActiveObject(hit); canvas.requestRenderAll(); }
    openImageMenu(event.clientX, event.clientY);
  });
}

window.addEventListener('keydown', event => {
  if (!(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || document.querySelector('.modal-backdrop')) return;
  if (!MFC.hasDocument || !selectedImages().length) return;
  event.preventDefault();
  const box = canvas.getActiveObject().getBoundingRect(), r = canvas.upperCanvasEl.getBoundingClientRect();
  // getBoundingRect() is in pixels of the canvas element (zoom and scroll included).
  openImageMenu(r.left + box.left + box.width / 2, r.top + box.top + box.height / 2);
});

document.getElementById('obj-copy-display')?.addEventListener('click', () => copyDisplaySettings());
document.getElementById('obj-paste-display')?.addEventListener('click', () => pasteDisplaySettings());

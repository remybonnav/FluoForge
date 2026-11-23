/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Channel legend tool: select an image, choose the tool, and a text box lists the image's shown channels,
   each name in its channel's colour ("FLAG WGA"). The box is as wide as the image is displayed and sits
   above it, or as long as the image is tall and turned 90° against its left side. Options: background
   (black, white or transparent), border (on by default, black) and which image side sizes the box.
   The tool only creates: the result is an ordinary text box (mfcType "text") with no link to the image,
   edited afterwards with the Text panel like any other. The panel's options apply to the next legend
   and never change an existing text box, so edits (renamed channels, colours) are never overwritten. */

import { pushHistory } from '../core/history.js';
import { getPreference } from '../core/preferences.js';
import { canvas, currentTool, registry, takeId } from '../core/state.js';
import { calibrationColours } from '../image/composite-core.js';
import { attachTextListeners } from './text.js';
import { refreshLayersPanel } from '../ui/layers.js';
import { selectedObjects } from '../ui/selection-bar.js';

export const LEGEND_BACKGROUNDS = { black: '#000000', white: '#ffffff', transparent: '' };
/** The options of the next legend (the panel's choices). */
export const legendOptions = { background: 'black', border: true, borderColor: '#000000', fit: 'width' };

const isImage = o => o && o.mfcType === 'mfcImage';
const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
function luminance(color) {
  const v = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const contrast = (a, b) => { const [h, l] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
/** The text colour that reads on a background: white on black, black on white or transparent. */
const plainColor = background => (background === 'black' ? '#ffffff' : '#000000');

/** A channel's colour in the legend: its colour table at the channel's max (pure green for a green
    channel, yellow for viridis). On a black or white background, a colour that would not show
    (contrast below 1.2: grey or yellow on white, black on black) becomes black or white; green,
    cyan and blue keep their colour. */
export function legendColor(ch, background = 'black') {
  const c = calibrationColours(ch), color = hex([c[765], c[766], c[767]]);
  const bg = LEGEND_BACKGROUNDS[background];
  return bg && contrast(color, bg) < 1.2 ? plainColor(background) : color;
}

/** The shown channels of an image as [{ name, color }], in channel order. */
export function legendEntries(img, background = 'black') {
  const raw = registry[img.mfcId]?.rawImage;
  if (!raw) return [];
  return raw.channels.map((ch, i) => ({ ch, i })).filter(({ ch }) => ch.enabled)
    .map(({ ch, i }) => ({ name: String(ch.name || `Ch ${i + 1}`).trim() || `Ch ${i + 1}`, color: legendColor(ch, background) }));
}

/** The image's displayed box on the page: { left, top, width, height } (crop, scale, groups included). */
function displayedBox(img) {
  const box = fabric.util.makeBoundingBoxFromPoints(img.getCoords(true, true));
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}

/** The text, its per-character colours and the box's look, from the image's channels. */
function applyContent(box, img, background) {
  const entries = legendEntries(img, background);
  const text = entries.map(e => e.name).join(' ');
  const line = {}; let at = 0;
  for (const e of entries) { for (let k = 0; k < e.name.length; k++) line[at + k] = { fill: e.color }; at += e.name.length + 1; }
  box.set({ text, styles: { 0: line }, fill: plainColor(background), backgroundColor: LEGEND_BACKGROUNDS[background] });
}

/** Sizes and places the box against the image: above it (width) or turned 90° on its left side (height). */
function applyLayout(box, img, fit) {
  const r = displayedBox(img), length = Math.max(1, fit === 'height' ? r.height : r.width);
  // The default text size, smaller when the names would not fit on one line.
  let fontSize = Math.max(1, getPreference('text.fontSize'));
  const measure = new fabric.Text(box.text || ' ', { fontFamily: box.fontFamily, fontSize, fontWeight: box.fontWeight });
  if (measure.width > length * 0.92) fontSize = Math.max(4, Math.floor(fontSize * length * 0.92 / measure.width));
  const height = Math.round(fontSize * 1.6);
  box.set({ fontSize, width: length, mfcBoxHeight: height, scaleX: 1, scaleY: 1, angle: fit === 'height' ? -90 : 0, flipX: false, flipY: false });
  box.initDimensions();
  if (fit === 'height') box.setPositionByOrigin(new fabric.Point(r.left - height / 2, r.top + r.height / 2), 'center', 'center');
  else box.set({ left: r.left, top: r.top - height });
  box.mfcBorderWidth = legendOptions.border ? Math.max(1, Math.round(fontSize / 12)) : 0;
  box.mfcBorderColor = legendOptions.borderColor;
  box.setCoords();
}

/** Adds a legend for each image (default: the selected images). Returns the legends made. */
export function addChannelLegend(images = selectedObjects(isImage)) {
  const made = [];
  for (const img of images.filter(isImage)) {
    if (!legendEntries(img).length) { MFC_UI.toast('This image shows no channel: turn one on to make a legend.'); continue; }
    const box = new fabric.Textbox('', { fontFamily: getPreference('text.fontFamily'), fontSize: getPreference('text.fontSize'),
      textAlign: 'center', originX: 'left', originY: 'top' });
    Object.assign(box, { mfcId: 'txt' + takeId(), mfcType: 'text', mfcVAlign: 'middle' });
    applyContent(box, img, legendOptions.background);
    applyLayout(box, img, legendOptions.fit);
    attachTextListeners(box);
    canvas.add(box);
    made.push(box);
  }
  if (!images.some(isImage)) MFC_UI.toast('Select an image first: the legend lists its channels in their colours.');
  if (!made.length) return made;
  canvas.discardActiveObject();
  canvas.setActiveObject(made.length > 1 ? new fabric.ActiveSelection(made, { canvas }) : made[0]);
  canvas.requestRenderAll();
  pushHistory();
  refreshLayersPanel();
  refreshPanel();
  return made;
}

/** Sets one option (background, border, borderColor or fit) for the next legends. Existing text boxes,
    legends included, are never changed: edit them with the Text panel. */
export function setLegendOption(key, value) {
  if (!(key in legendOptions)) return;
  legendOptions[key] = value;
  refreshPanel();
}

/** Shows the panel while the tool is active, with the options of the next legend. */
export function refreshPanel() {
  const panel = document.getElementById('panel-legend');
  if (!panel) return;
  const images = selectedObjects(isImage);
  panel.classList.toggle('hidden', currentTool !== 'legend');
  document.getElementById('legend-background').value = legendOptions.background;
  document.getElementById('legend-border').checked = legendOptions.border;
  document.getElementById('legend-border-color').value = legendOptions.borderColor;
  document.getElementById('legend-border-color').disabled = !legendOptions.border;
  document.getElementById('legend-fit').value = legendOptions.fit;
  document.getElementById('legend-add').disabled = !images.length;
  document.getElementById('legend-status').textContent = images.length ? '' : 'Select an image to add its legend.';
}

/** Connects the Channel legend panel's controls (once, when the editor loads). */
export function installLegendPanel() {
  const on = (id, event, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(event, fn); };
  on('legend-background', 'change', e => setLegendOption('background', e.target.value));
  on('legend-border', 'change', e => setLegendOption('border', e.target.checked));
  on('legend-border-color', 'change', e => setLegendOption('borderColor', e.target.value));
  on('legend-fit', 'change', e => setLegendOption('fit', e.target.value));
  on('legend-add', 'click', () => addChannelLegend());
}

/** Choosing the tool with images selected adds their legends at once. */
export function activate() {
  if (selectedObjects(isImage).length) addChannelLegend();
  refreshPanel();
}
export function deactivate() {}

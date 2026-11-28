/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Seeing which images are linked (PI-T10). An image can be linked to others in three ways:
   - a comparison group (`mfcCompareGroup`, js/image/comparison.js): range, LUT and gamma shared;
   - a quick figure or a series montage (`mfcMontageGroup`, js/image/montage.js, series.js): views of one image;
   - insets (`mfcIsInset`, `mfcInsetSourceId`, js/tools/inset.js): a source image and its inset views.
   While a panel is selected, every image of its groups gets an amber dashed outline (drawn over the
   canvas, like snap guides: never part of the figure or of an export) and a small chain badge whose
   tooltip names the groups. The Layers panel names them too (js/ui/layers.js). */

import { canvas, registry } from '../core/state.js';
import { allImages, groupLabel, groupMembers, groupOf, montageMembers, montageOf, onComparisonChange } from '../image/comparison.js';
import { LAYER_ICONS } from './layers.js';

export const LINK_OUTLINE = '#f0a020'; // amber: unlike the selection's accent blue, seen on white and dark pages
const fileOf = img => (img && registry[img.mfcId] && registry[img.mfcId].rawImage.fileName) || (img && img.mfcFileName) || 'an image';

/** The link groups of `obj`: [{ key, kind: 'comparison' | 'montage' | 'series' | 'insets', name, members: [images] }]. */
export function linkedGroupsOf(obj) {
  if (!obj) return [];
  const groups = [];
  const images = allImages();
  const byId = id => images.find(o => o.mfcId === id) || null;
  if (obj.mfcType === 'mfcImage') {
    const compare = groupOf(obj);
    if (compare != null) groups.push({ key: 'comparison:' + compare, kind: 'comparison', name: groupLabel(compare), members: groupMembers(compare) });
    const montage = montageOf(obj);
    if (montage) {
      const members = montageMembers(montage), series = members.some(m => m.mfcSeries && typeof m.mfcSeries === 'object');
      groups.push({ key: 'montage:' + montage, kind: series ? 'series' : 'montage', name: (series ? 'Series montage of ' : 'Quick figure of ') + fileOf(members[0] || obj), members });
    }
  }
  // Insets: from the inset view, its outline or its source image.
  const source = obj.mfcIsInset || obj.mfcType === 'insetContour' ? byId(obj.mfcInsetSourceId) : obj.mfcType === 'mfcImage' ? obj : null;
  if (source) {
    const insets = images.filter(o => o.mfcIsInset && o.mfcInsetSourceId === source.mfcId);
    if (insets.length) groups.push({ key: 'insets:' + source.mfcId, kind: 'insets', name: 'Insets of ' + fileOf(source), members: [source, ...insets] });
  }
  return groups;
}

/** What the current selection highlights: { groups, members (a Set of images), selected (a Set) }. */
export function linkedHighlight() {
  const active = canvas && canvas.getActiveObject();
  const selected = !active ? [] : active.type === 'activeSelection' ? active.getObjects() : [active];
  const groups = new Map();
  selected.forEach(o => linkedGroupsOf(o).forEach(g => groups.set(g.key, g)));
  const members = new Set();
  groups.forEach(g => g.members.forEach(m => members.add(m)));
  return { groups: [...groups.values()], members, selected: new Set(selected) };
}

/** Draws the outlines (canvas 'after:render'), and places the badges. */
export function drawLinkHighlight(ctx) {
  const { groups, members, selected } = linkedHighlight();
  placeBadges(groups, members);
  if (!members.size) return;
  const vpt = canvas.viewportTransform;
  ctx.save();
  ctx.setTransform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
  ctx.strokeStyle = LINK_OUTLINE; ctx.lineWidth = 2 / vpt[0]; ctx.setLineDash([6 / vpt[0], 4 / vpt[0]]);
  members.forEach(m => {
    if (selected.has(m) || !m.visible || !m.canvas) return; // the selection has its own border
    const b = m.getBoundingRect(true, true), pad = 3 / vpt[0];
    ctx.strokeRect(b.left - pad, b.top - pad, b.width + 2 * pad, b.height + 2 * pad);
  });
  ctx.restore();
}

// ---- badges: small DOM elements over the canvas, so they have a tooltip and follow the theme ----
let layer = null;
function badgeLayer() {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'link-badges';
  layer.setAttribute('aria-hidden', 'false');
  canvas.wrapperEl.append(layer);
  return layer;
}
/** A badge passes the mouse on to the canvas: it only shows its tooltip. */
function passThrough(badge) {
  for (const type of ['mousedown', 'dblclick', 'contextmenu', 'wheel']) badge.addEventListener(type, event => {
    event.preventDefault(); event.stopPropagation();
    const Copy = type === 'wheel' ? WheelEvent : MouseEvent;
    canvas.upperCanvasEl.dispatchEvent(new Copy(type, event));
  });
}
function placeBadges(groups, members) {
  const host = badgeLayer();
  const k = canvas.upperCanvasEl.getBoundingClientRect().width / canvas.getWidth() || 1, vpt = canvas.viewportTransform;
  const wanted = [...members].filter(m => m.visible !== false && m.canvas);
  while (host.children.length > wanted.length) host.lastChild.remove();
  wanted.forEach((m, i) => {
    let badge = host.children[i];
    if (!badge) { badge = document.createElement('span'); badge.className = 'link-badge'; badge.setAttribute('role', 'img'); badge.innerHTML = LAYER_ICONS.chain; passThrough(badge); host.append(badge); }
    const names = groups.filter(g => g.members.includes(m)).map(g => `${g.name} (${g.members.length} images)`);
    const title = `${m.mfcFileName || 'Image'}: linked in ${names.join('; ')}`;
    if (badge.title !== title) { badge.title = title; badge.setAttribute('aria-label', title); }
    badge.dataset.id = m.mfcId;
    const b = m.getBoundingRect(true, true);
    const right = (b.left + b.width) * vpt[0] + vpt[4], top = b.top * vpt[3] + vpt[5];
    badge.style.left = Math.round((right - 30) * k) + 'px'; // inside the top-right corner, clear of the resize handle
    badge.style.top = Math.round((top + 10) * k) + 'px';
  });
}
onComparisonChange(() => { if (canvas) canvas.requestRenderAll(); }); // linked or unlinked: the highlight changes

/** Removes every badge (a new or closed document). */
export function clearLinkBadges() { if (layer) layer.replaceChildren(); }

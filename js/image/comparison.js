/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Comparison groups (for example control versus treated): images whose channel range, LUT and
   gamma are linked, channel by number, so changing one changes all of them.
   An image in a group carries `mfcCompareGroup` (the group's number); like every mfc* property it
   is saved with the project and kept by undo. On/off, invert, names, brightness and contrast stay
   per image. Pasting display settings onto one member is deliberately not passed on, so a group
   can diverge; the layers panel then shows a warning badge and offers to match the group again. */

import { pushHistory } from '../core/history.js';
import { canvas, registry } from '../core/state.js';
import { recomposite } from './import.js';

/** Per channel, the settings a comparison group keeps equal. */
export const LINKED_FIELDS = ['min', 'max', 'color', 'lut', 'gamma'];
const gammaOf = ch => (Number.isFinite(ch.gamma) && ch.gamma > 0 ? ch.gamma : 1);
const valueOf = (ch, field) => (field === 'gamma' ? gammaOf(ch) : field === 'lut' ? (ch.color === 'file' ? ch.lut || null : null) : ch[field]);

/** Every image of the figure, including those inside groups. */
export function allImages() {
  const out = [];
  const walk = objects => objects.forEach(o => {
    if (o.mfcType === 'mfcImage' && registry[o.mfcId]) out.push(o);
    else if (o.type === 'group' && o.getObjects) walk(o.getObjects());
  });
  walk(canvas.getObjects());
  return out;
}
export const groupOf = img => (img && Number.isInteger(img.mfcCompareGroup) ? img.mfcCompareGroup : null);
export const groupMembers = id => (id == null ? [] : allImages().filter(img => groupOf(img) === id));
export const groupLabel = id => 'Comparison group ' + id;
const channelsOf = img => registry[img.mfcId].rawImage.channels;

/** The images an edit of `images` reaches: those images and every member of their groups. */
export function withGroupMembers(images) {
  const out = new Set(images);
  for (const id of new Set(images.map(groupOf).filter(g => g != null))) groupMembers(id).forEach(img => out.add(img));
  return [...out];
}

/** Copies one channel's linked fields from `source` to `target` (integer data keeps a range its type can hold). */
function copyChannel(source, target, fields) {
  for (const field of fields) {
    if (field === 'lut') { if (source.color === 'file' && source.lut) target.lut = source.lut; continue; }
    if (field === 'color' && source.color === 'file' && !source.lut) continue;
    target[field] = field === 'gamma' ? gammaOf(source) : source[field];
  }
  if (fields.includes('min') || fields.includes('max')) {
    const float = target.data instanceof Float32Array || target.data instanceof Float64Array;
    if (!float) {
      const ceiling = target.bitDepth > 8 ? 65535 : 255;
      target.min = Math.min(Math.max(target.min, 0), ceiling - 1);
      target.max = Math.max(Math.min(target.max, ceiling), target.min + 1);
    }
  }
}

/**
 * After an edit of channel `idx` on `images`, gives the other members of their groups the same
 * values of `fields` (the first edited member of each group is the source). Returns the images changed.
 */
export function propagate(images, idx, fields) {
  const changed = [];
  const done = new Set();
  for (const source of images) {
    const id = groupOf(source);
    if (id == null || done.has(id)) continue;
    done.add(id);
    const from = channelsOf(source)[idx];
    if (!from) continue;
    for (const member of groupMembers(id)) {
      if (member === source || images.includes(member)) continue;
      const to = channelsOf(member)[idx];
      if (!to) continue;
      copyChannel(from, to, fields);
      changed.push(member);
    }
  }
  return changed;
}

/** Gives every member of `source`'s group the linked settings of `source`, on every channel they share. */
function matchGroupTo(source) {
  const members = groupMembers(groupOf(source)).filter(m => m !== source);
  channelsOf(source).forEach((from, idx) => members.forEach(m => { const to = channelsOf(m)[idx]; if (to) copyChannel(from, to, LINKED_FIELDS); }));
  return members;
}

/** Channel numbers on which a group's members differ (only channels every member has). */
export function divergedChannels(id) {
  const members = groupMembers(id);
  if (members.length < 2) return [];
  const count = Math.min(...members.map(m => channelsOf(m).length));
  const out = [];
  for (let idx = 0; idx < count; idx++) {
    const first = channelsOf(members[0])[idx];
    if (members.some(m => LINKED_FIELDS.some(f => valueOf(channelsOf(m)[idx], f) !== valueOf(first, f)))) out.push(idx);
  }
  return out;
}

function nextGroupId() {
  const used = new Set(allImages().map(groupOf));
  let id = 1;
  while (used.has(id)) id++;
  return id;
}

/**
 * Makes `images` one comparison group (or adds them to the group of the first one already in a
 * group). Every member is matched to the first image. One History step.
 */
export function linkImages(images) {
  if (images.length < 2) { MFC_UI.toast('Select at least two images to link them as a comparison group.'); return null; }
  const id = images.map(groupOf).find(g => g != null) ?? nextGroupId();
  const source = images.find(img => groupOf(img) === id) || images[0];
  images.forEach(img => { img.mfcCompareGroup = id; });
  const members = groupMembers(id);
  matchGroupTo(source);
  members.forEach(img => recomposite(img));
  pushHistory();
  refreshComparisonViews();
  MFC_UI.toast(`${groupLabel(id)}: ${members.length} images now share the range, LUT and gamma of ${source.mfcFileName || 'the first image'}, channel by number.`);
  return id;
}

/** Takes `images` out of their groups; a group left with one image is dissolved. One History step. */
export function unlinkImages(images) {
  const ids = new Set(images.map(groupOf).filter(g => g != null));
  if (!ids.size) return false;
  images.forEach(img => { delete img.mfcCompareGroup; });
  for (const id of ids) { const rest = groupMembers(id); if (rest.length === 1) delete rest[0].mfcCompareGroup; }
  pushHistory();
  refreshComparisonViews();
  MFC_UI.toast(images.length === 1 ? (images[0].mfcFileName || 'The image') + ' is no longer linked.' : images.length + ' images are no longer linked.');
  return true;
}

/** Matches the whole group of `source` to it again (after the settings diverged). One History step. */
export function matchGroup(source) {
  const members = matchGroupTo(source);
  [source, ...members].forEach(img => recomposite(img));
  pushHistory();
  refreshComparisonViews();
  return members.length;
}

// The panels that show groups register here (avoids import cycles with the layers panel).
const views = [];
export function onComparisonChange(refresh) { views.push(refresh); }
export function refreshComparisonViews() { views.forEach(refresh => refresh()); }

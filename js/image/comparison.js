/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Comparison groups (for example control versus treated): images whose channel range, LUT and
   gamma are linked, channel by number, so changing one changes all of them.
   An image in a group carries `mfcCompareGroup` (the group's number); like every mfc* property it
   is saved with the project and kept by undo. On/off, invert, names, brightness and contrast stay
   per image. Pasting display settings onto one member is deliberately not passed on, so a group
   can diverge; the layers panel then shows a warning badge and offers to match the group again.
   The panels of a split-channel montage (`mfcMontageGroup`, js/image/montage.js) are linked the same
   way, and also on invert: they are views of one image. A grey channel panel keeps its grey LUT. The
   panels of a series montage (js/image/series.js) also share turning a channel on or off. */

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

export const montageOf = img => (img && typeof img.mfcMontageGroup === 'string' ? img.mfcMontageGroup : null);
export const montageMembers = id => (id == null ? [] : allImages().filter(img => montageOf(img) === id));
/** `images` and every panel of their montages (for settings a montage shares, such as brightness and contrast). */
export function withMontageMembers(images) {
  const out = new Set(images);
  for (const id of new Set(images.map(montageOf).filter(Boolean))) montageMembers(id).forEach(img => out.add(img));
  return [...out];
}
/** A grey channel panel of a montage showing channel `idx`: its LUT stays grey. */
const keepsGrey = (img, idx) => !!(montageOf(img) && img.mfcMontageGrey && img.mfcMontageChannel === idx);

/** The images an edit of `images` reaches: those images, every member of their groups and every panel of their montages. */
export function withGroupMembers(images) {
  const out = new Set(withMontageMembers(images));
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
  // A comparison group links only LINKED_FIELDS (invert, for one, stays per image).
  const groupFields = fields.filter(f => LINKED_FIELDS.includes(f));
  for (const source of groupFields.length ? images : []) {
    const id = groupOf(source);
    if (id == null || done.has(id)) continue;
    done.add(id);
    const from = channelsOf(source)[idx];
    if (!from) continue;
    for (const member of groupMembers(id)) {
      if (member === source || images.includes(member)) continue;
      const to = channelsOf(member)[idx];
      if (!to) continue;
      copyChannel(from, to, groupFields);
      changed.push(member);
    }
  }
  // Montage panels: the same channel on every panel of the row (a grey panel keeps grey, and its
  // grey is not passed on).
  const doneMontages = new Set();
  for (const source of images) {
    const id = montageOf(source);
    if (!id || doneMontages.has(id)) continue;
    doneMontages.add(id);
    const from = channelsOf(source)[idx];
    if (!from) continue;
    for (const member of montageMembers(id)) {
      if (member === source || images.includes(member)) continue;
      const to = channelsOf(member)[idx];
      if (!to) continue;
      let own = keepsGrey(source, idx) || keepsGrey(member, idx) ? fields.filter(f => f !== 'color' && f !== 'lut') : fields;
      // On/off is per panel in a quick figure (each shows its channel), shared by a series montage's panels.
      if (!(source.mfcSeries && member.mfcSeries)) own = own.filter(f => f !== 'enabled');
      if (!own.length) continue;
      copyChannel(from, to, own);
      if (!changed.includes(member)) changed.push(member);
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

const names = list => { const n = list.map(img => img.mfcFileName || 'an image'); return n.length > 3 ? n.slice(0, 3).join(', ') + ' and ' + (n.length - 3) + ' more' : n.join(', '); };
/** What Link would do with `images`, in words (PI-T10): which group, which images, whose settings they take. */
export function describeLink(images) {
  if (images.length < 2) return 'Link: select two or more images to link them as a comparison group (their range, LUT and gamma stay equal, channel by number)';
  const id = images.map(groupOf).find(g => g != null) ?? nextGroupId();
  const source = images.find(img => groupOf(img) === id) || images[0];
  const added = images.filter(img => groupOf(img) !== id);
  if (!added.length) return `Link: ${names(images)} are already in ${groupLabel(id)}`;
  const existing = groupMembers(id);
  return existing.length ? `Link: add ${names(added)} to ${groupLabel(id)} (then ${existing.length + added.length} images); they take the range, LUT and gamma of ${source.mfcFileName || 'its first image'}, channel by number`
    : `Link ${names(images)} as ${groupLabel(id)}: they take the range, LUT and gamma of ${source.mfcFileName || 'the first image'}, channel by number`;
}
/** What Unlink would do with `images`, in words (PI-T10): which images leave which group, and what stays linked. */
export function describeUnlink(images) {
  const leaving = images.filter(img => groupOf(img) != null);
  const views = images.some(img => montageOf(img)) ? ' Quick-figure and series panels stay linked as views of one image.' : '';
  if (!leaving.length) return 'Unlink: none of the selected images is in a comparison group.' + views;
  const parts = [...new Set(leaving.map(groupOf))].map(id => {
    const rest = groupMembers(id).filter(img => !leaving.includes(img));
    return `${names(leaving.filter(img => groupOf(img) === id))} out of ${groupLabel(id)}` + (rest.length > 1 ? ` (${names(rest)} stay linked)` : ' (the group ends)');
  });
  return 'Unlink: take ' + parts.join('; ') + '.' + views;
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

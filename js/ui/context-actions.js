/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The actions of the right-click menu (PI-T9), registered in js/core/actions.js in menu order.
   menu: 'default' entries are in the menu until the user removes them (Preferences ▸ Context menu);
   'optional' ones are there once the user adds them. An item is shown only where it applies.
   Each action calls the same function as its button in the selection bar, the Layers panel or a
   shortcut, so the menu never does anything those do not. */

import { registerAction } from '../core/actions.js';
import { canvas, isHelper, registry } from '../core/state.js';
import { duplicateSelection } from '../core/clipboard.js';
import { pushHistory } from '../core/history.js';
import { zoomToSelection } from '../core/zoom.js';
import { copiedDisplaySettings, copyDisplaySettings, pasteDisplaySettings, refreshDisplayButtons } from '../image/display-settings.js';
import { describeLink, describeUnlink, groupOf, linkImages, unlinkImages } from '../image/comparison.js';
import { isFrame } from '../layout/frames.js';
import { cropToShape, cropToShapePair, releaseShapeCrop } from '../tools/crop.js';
import { pathMenuItems } from '../tools/path.js';
import { setTool } from '../tools/tool-switch.js';
import { showCopyDialog } from './copy-external.js';
import { showPanelInfo } from './image-info.js';
import { groupSelection, layerObjects, moveLayer, moveLayerToEdge, toggleLayerLock, ungroupSelection } from './layers.js';
import { isTransformLocked, togglePositionLockSelection } from './locks.js';
import { isCropped, uncropImage } from './selection-bar.js';

const single = ctx => (ctx.active && ctx.active.type !== 'activeSelection' ? ctx.active : null);
const panelKind = o => (o && o.mfcType === 'mfcImage' && registry[o.mfcId] ? 'Image' : o && o.mfcType === 'mfcVector' ? 'Plot' : null);
const isPanel = o => !!panelKind(o);
const locked = ctx => !!ctx.active && isTransformLocked(ctx.active);
/** Where the selection is in the stacking order: { bottom, top } (true when nothing is below / above it). */
function stackEnds(ctx) {
  const layers = layerObjects(), mine = new Set(ctx.objects);
  const at = layers.map((o, i) => (mine.has(o) ? i : -1)).filter(i => i >= 0);
  if (!at.length) return { bottom: true, top: true };
  const others = layers.map((o, i) => (mine.has(o) ? -1 : i)).filter(i => i >= 0);
  return { bottom: !others.some(i => i < Math.max(...at)), top: !others.some(i => i > Math.min(...at)) };
}
const what = ctx => (ctx.objects.length > 1 ? 'the selected objects' : 'this object');

// ---- information and editing of one panel ----
registerAction({ id: 'info', group: 'info', menu: 'default', option: 'Image info… / Plot info…',
  applies: ctx => isPanel(single(ctx)),
  label: ctx => panelKind(single(ctx)) + ' info…',
  title: ctx => (panelKind(single(ctx)) === 'Image' ? 'Image info: dimensions, bit depth, channels, Z and T, pixel size, and the file\'s header'
    : 'Plot info: the file, format and page, size on paper, the message shown at import and what was left out'),
  run: ctx => showPanelInfo(single(ctx)) });
registerAction({ id: 'modify-points', group: 'points', menu: 'default', option: 'Modify points (paths and lines)',
  entries: ctx => pathMenuItems(single(ctx), ctx.point) });
registerAction({ id: 'adjust-crop', group: 'crop', menu: 'default', option: 'Adjust crop',
  applies: ctx => isCropped(single(ctx)),
  enabled: ctx => !locked(ctx),
  label: 'Adjust crop',
  title: 'Adjust the crop: show the whole image, dimmed outside the crop, and move or resize the crop border; the panel keeps its place (Crop tool)',
  run: () => { setTool('select'); setTool('crop'); } });
registerAction({ id: 'crop', group: 'crop', menu: 'optional', option: 'Crop (Crop tool)',
  applies: ctx => isPanel(single(ctx)) && !isCropped(single(ctx)),
  enabled: ctx => !locked(ctx),
  label: 'Crop', title: 'Crop this panel: drag the crop border, then Apply (Crop tool, C)',
  run: () => { setTool('select'); setTool('crop'); } });
registerAction({ id: 'uncrop', group: 'crop', menu: 'optional', option: 'Uncrop',
  applies: ctx => isCropped(single(ctx)),
  enabled: ctx => !locked(ctx),
  label: 'Uncrop', title: 'Restore this image to its full, uncropped frame',
  run: ctx => uncropImage(single(ctx)) });
registerAction({ id: 'inset', group: 'crop', menu: 'optional', option: 'Draw an inset (Inset tool)',
  applies: ctx => panelKind(single(ctx)) === 'Image' && !single(ctx).mfcIsInset,
  label: 'Draw an inset', title: 'Draw a region on this image to show it enlarged as an inset (Inset tool, I)',
  run: () => setTool('inset') });

// ---- display settings ----
registerAction({ id: 'copy-display', group: 'display', menu: 'default', option: 'Copy display settings',
  applies: ctx => ctx.images.length > 0,
  enabled: ctx => ctx.images.length === 1,
  label: 'Copy display settings',
  title: 'Copy the LUTs, ranges, gamma and invert of this image\'s channels, and its brightness and contrast',
  run: ctx => copyDisplaySettings(ctx.images) });
registerAction({ id: 'paste-display', group: 'display', menu: 'default', option: 'Paste display settings',
  applies: ctx => ctx.images.length > 0,
  enabled: () => !!copiedDisplaySettings(),
  label: 'Paste display settings',
  title: () => (copiedDisplaySettings() ? 'Paste the copied display settings, channel by number (one undo step)' : 'Copy display settings from an image first'),
  run: ctx => pasteDisplaySettings(ctx.images) });
registerAction({ id: 'link', group: 'display', menu: 'optional', option: 'Link (comparison group)',
  applies: ctx => ctx.images.length > 1,
  label: 'Link', title: ctx => describeLink(ctx.images),
  run: ctx => { linkImages(ctx.images); refreshDisplayButtons(); } });
registerAction({ id: 'unlink', group: 'display', menu: 'optional', option: 'Unlink',
  applies: ctx => ctx.images.some(img => groupOf(img) != null),
  label: 'Unlink', title: ctx => describeUnlink(ctx.images),
  run: ctx => { unlinkImages(ctx.images); refreshDisplayButtons(); } });

// ---- the object ----
registerAction({ id: 'replace', group: 'object', menu: 'default', option: 'Replace image… / Fill frame…',
  applies: ctx => { const o = single(ctx); return !!o && ((o.mfcType === 'mfcImage' && !!registry[o.mfcId]) || isFrame(o)); },
  label: ctx => (isFrame(single(ctx)) ? 'Fill frame…' : 'Replace image…'),
  title: ctx => (isFrame(single(ctx)) ? 'Fill this empty frame with an image file' :
    'Replace this image with another file: its frame, letter, labels, grid cell, scale bar and insets stay'),
  run: () => document.getElementById('obj-replace-image').click() }); // the button keeps the file picker and its target
registerAction({ id: 'lock-position', group: 'object', menu: 'default', option: 'Lock position',
  applies: ctx => ctx.objects.length > 0,
  label: ctx => (ctx.objects.every(o => o.mfcPositionLocked) ? 'Unlock position' : 'Lock position'),
  title: ctx => (ctx.objects.every(o => o.mfcPositionLocked) ? 'Unlock position and size: ' + what(ctx) + ' can be moved, resized and rotated again'
    : 'Lock position and size: ' + what(ctx) + ' cannot be moved, resized or rotated, but channels, colours and styles stay editable'),
  run: () => togglePositionLockSelection() });
registerAction({ id: 'lock', group: 'object', menu: 'optional', option: 'Lock (cannot be selected)',
  applies: ctx => !!single(ctx),
  label: 'Lock', title: 'Lock this object: it can no longer be selected, moved or edited on the canvas. Unlock it with its lock in the Layers panel.',
  run: ctx => toggleLayerLock(single(ctx)) });
registerAction({ id: 'duplicate', group: 'object', menu: 'optional', option: 'Duplicate',
  applies: ctx => ctx.objects.length > 0,
  label: 'Duplicate', title: 'Duplicate the selection, a little offset (the Duplicate button of the top bar)',
  run: () => duplicateSelection() });
registerAction({ id: 'delete', group: 'object', menu: 'optional', option: 'Delete',
  applies: ctx => ctx.objects.length > 0,
  label: 'Delete', title: 'Delete the selection (Delete)',
  run: ctx => { // as the Delete key does
    const gone = ctx.objects.filter(o => !o.mfcLocked);
    if (!gone.length) return;
    canvas.discardActiveObject();
    gone.forEach(o => canvas.remove(o));
    canvas.requestRenderAll(); pushHistory();
  } });
registerAction({ id: 'zoom', group: 'object', menu: 'optional', option: 'Zoom to selection',
  applies: ctx => ctx.objects.length > 0,
  label: 'Zoom to selection', title: 'Zoom to fit the selection in view (Shift+2)',
  run: () => zoomToSelection() });

// ---- stacking order ----
const order = (id, label, title, end, run) => registerAction({ id, group: 'order', menu: 'default', option: label,
  applies: ctx => ctx.objects.length > 0 && ctx.objects.every(o => !isHelper(o)),
  enabled: ctx => !stackEnds(ctx)[end],
  label, title: ctx => title.replace('{what}', what(ctx)), run: ctx => run(ctx.active) });
order('bring-forward', 'Bring forward', 'Move {what} one step toward the front', 'top', o => moveLayer(o, 'up'));
order('send-backward', 'Send backward', 'Move {what} one step toward the back', 'bottom', o => moveLayer(o, 'down'));
order('bring-to-front', 'Bring to front', 'Move {what} in front of every other object', 'top', o => moveLayerToEdge(o, 'front'));
order('send-to-back', 'Send to back', 'Move {what} behind every other object (the page stays behind)', 'bottom', o => moveLayerToEdge(o, 'back'));

// ---- several objects ----
registerAction({ id: 'group', group: 'arrange', menu: 'default', option: 'Group / Ungroup',
  applies: ctx => (ctx.active && ctx.active.type === 'activeSelection' && ctx.objects.length > 1) || (ctx.active && ctx.active.type === 'group'),
  enabled: ctx => ctx.active.type === 'group' || !locked(ctx),
  label: ctx => (ctx.active.type === 'group' ? 'Ungroup' : 'Group'),
  title: ctx => (ctx.active.type === 'group' ? 'Ungroup: the objects of this group become separate again (Ctrl+Shift+G)' : 'Group the selected objects into one (Ctrl+G)'),
  run: ctx => (ctx.active.type === 'group' ? ungroupSelection() : groupSelection()) });
registerAction({ id: 'crop-to-shape', group: 'arrange', menu: 'default', option: 'Crop to shape',
  applies: () => !!cropToShapePair(),
  label: 'Crop to shape', title: 'Crop the selected image (or object) to the selected closed shape: box, ellipse or closed path',
  run: () => cropToShape() });
registerAction({ id: 'release-clip', group: 'arrange', menu: 'optional', option: 'Remove shape crop',
  applies: ctx => !!single(ctx) && !!single(ctx).clipPath,
  enabled: ctx => !locked(ctx),
  label: 'Remove shape crop', title: 'Remove the shape crop and give the shape back as an editable shape',
  run: ctx => releaseShapeCrop(single(ctx)) });

// ---- always last ----
registerAction({ id: 'copy-external', group: 'copy', menu: 'default', option: 'Copy for other software…',
  label: 'Copy for other software…',
  title: ctx => { const t = ctx.copy || { scope: 'page' }; return 'Copy ' + (t.scope === 'selection' ? 'the selection' : 'page ' + ((t.page ?? 0) + 1)) +
    ' to the clipboard as an SVG picture, a PNG or SVG code, to paste into PowerPoint, Word, Inkscape, Illustrator or Figma (Ctrl+Shift+C)'; },
  run: ctx => showCopyDialog(ctx.copy || { scope: 'page' }) });

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Scale bar tool: bars calibrated from an image's pixel size, corner placement, the live preview and the Scale bar panel. */

import { pushHistory } from '../core/history.js';
import { canvas, currentTool, documentOpen, registry, takeId } from '../core/state.js';
import { zoomLevel } from '../core/zoom.js';
import { canvasBounds } from './inset.js';
import { toHexColor } from './text.js';
import { applyLockState } from '../ui/locks.js';
import { refreshSelectionBar, selectedObjects } from '../ui/selection-bar.js';

// ---- scale bar ----
export function refreshScaleBarRefList() {
  const sel = document.getElementById('sb-ref-image');
  const activeImg = canvas.getActiveObject();
  const prevValue = sel.value;
  sel.innerHTML = '';
  canvas.getObjects().filter(o => o.mfcType === 'mfcImage').forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.mfcId;
    opt.textContent = o.mfcFileName;
    sel.appendChild(opt);
  });
  // Auto-follow whatever image is currently selected on the canvas; otherwise
  // keep whatever was previously chosen (if it still exists).
  if (activeImg && activeImg.mfcType === 'mfcImage') {
    sel.value = activeImg.mfcId;
  } else if (prevValue && Array.from(sel.options).some(o => o.value === prevValue)) {
    sel.value = prevValue;
  }
}

export function computeScaleBarPxLength(refObj, entry, lengthUm) {
  // pixel length at native resolution, then convert to on-canvas pixels via the
  // reference image's current display scale (composite-canvas px -> document px)
  const nativePxLen = lengthUm / entry.rawImage.voxelSizeUm;
  const compositeToNativeRatio = 1 / entry.workingScale;
  return (nativePxLen / compositeToNativeRatio) * refObj.scaleX;
}

export function buildScaleBarGroup(onScreenPxLen, thickness, color, showLabel, lengthUm, id = 'sb' + takeId()) {
  const bar = new fabric.Rect({
    left: 0, top: 0, width: onScreenPxLen, height: thickness,
    fill: color, originX: 'left', originY: 'top'
  });
  const items = [bar];
  if (showLabel) {
    items.push(new fabric.Text(lengthUm + ' µm', {
      left: 0, top: -20, fontSize: 16, fill: color, fontFamily: 'Liberation Sans', originX: 'left', originY: 'top'
    }));
  }
  const g = new fabric.Group(items, { left: 0, top: 0, originX: 'left', originY: 'top' });
  g.mfcId = id;
  g.mfcType = 'scalebar';
  return g;
}

export function readScaleBarFormValues() {
  return {
    lengthUm: parseFloat(document.getElementById('sb-length').value) || 50,
    thickness: parseFloat(document.getElementById('sb-thickness').value) || 6,
    color: document.getElementById('sb-color').value,
    showLabel: document.getElementById('sb-showlabel').checked,
    corner: document.getElementById('sb-corner').value,
    marginPct: Math.max(0, parseFloat(document.getElementById('sb-margin').value) || 0)
  };
}

/** A scale bar's settings, read back from the bar itself, so bars made by any version can be shown and edited. */
export function scaleBarProps(bar) {
  const [rect, label] = bar._objects || [];
  const lengthUm = bar.mfcLengthUm != null ? bar.mfcLengthUm
    : (label && parseFloat(String(label.text).replace(',', '.')) > 0 ? parseFloat(String(label.text).replace(',', '.')) : null);
  return {
    lengthUm,
    thickness: rect ? rect.height * Math.abs(bar.scaleY || 1) : 6,
    color: rect && typeof rect.fill === 'string' ? rect.fill : '#ffffff',
    showLabel: !!label,
    corner: bar.mfcCorner || null,
    marginPct: bar.mfcMarginPct != null ? bar.mfcMarginPct : 5,
    lengthPx: rect ? rect.width * Math.abs(bar.scaleX || 1) : 0
  };
}

/** Where a bar of the given size goes in a corner of an image's on-canvas bounds. */
export function scaleBarCornerPosition(b, barW, barH, corner, marginPct) {
  const mx = b.width * (marginPct != null ? marginPct : 5) / 100;
  const my = b.height * (marginPct != null ? marginPct : 5) / 100;
  switch (corner) {
    case 'bottom-left': return { left: b.left + mx, top: b.top + b.height - barH - my };
    case 'top-right': return { left: b.left + b.width - barW - mx, top: b.top + my };
    case 'top-left': return { left: b.left + mx, top: b.top + my };
    default: return { left: b.left + b.width - barW - mx, top: b.top + b.height - barH - my }; // bottom-right
  }
}

/**
 * Place a scale bar directly at a corner of a reference image, offset by a % margin
 * of that image's displayed size, and "attach" it: whenever the image moves or is
 * resized, the bar is automatically repositioned and rescaled to stay calibrated.
 */
export function placeScaleBarAtCorner(corner, marginPct) {
  const refId = document.getElementById('sb-ref-image').value;
  const entry = registry[refId];
  const refObj = canvas.getObjects().find(o => o.mfcId === refId);
  const { lengthUm, thickness, color, showLabel } = readScaleBarFormValues();

  if (!refObj || !entry || !entry.rawImage.voxelSizeUm) {
    MFC_UI.toast('No voxel size calibration found for that image — cannot compute scale bar length.');
    return;
  }
  clearScaleBarPreview();
  const onScreenPxLen = computeScaleBarPxLength(refObj, entry, lengthUm);
  const g = buildScaleBarGroup(onScreenPxLen, thickness, color, showLabel, lengthUm);
  g.mfcAttachedTo = refObj.mfcId;
  g.mfcCorner = corner;
  g.mfcMarginPct = marginPct;
  g.mfcLengthUm = lengthUm;
  canvas.add(g);
  repositionAttachedScaleBars(refObj);
  canvas.setActiveObject(g);
  canvas.requestRenderAll();
  pushHistory();
}

/** Add scale bars to every selected image at once, using the current form settings for each. */
export function placeScaleBarOnSelectedImages(corner, marginPct) {
  const imgs = canvas.getActiveObjects().filter(o => o.mfcType === 'mfcImage');
  if (imgs.length < 2) {
    MFC_UI.toast('Select 2 or more images first to batch-apply a scale bar.');
    return;
  }
  // Release the transient selection so image coordinates become document coordinates
  // before bars are created and attached.
  canvas.discardActiveObject();
  clearScaleBarPreview();
  const { lengthUm, thickness, color, showLabel } = readScaleBarFormValues();
  const refSelectEl = document.getElementById('sb-ref-image');
  const created = [];
  let skipped = 0;

  imgs.forEach((refObj) => {
    const entry = registry[refObj.mfcId];
    if (!entry || !entry.rawImage.voxelSizeUm) { skipped++; return; }
    const onScreenPxLen = computeScaleBarPxLength(refObj, entry, lengthUm);
    const g = buildScaleBarGroup(onScreenPxLen, thickness, color, showLabel, lengthUm);
    g.mfcAttachedTo = refObj.mfcId;
    g.mfcLengthUm = lengthUm;
    if (corner) { g.mfcCorner = corner; g.mfcMarginPct = marginPct; }
    canvas.add(g);
    if (corner) repositionAttachedScaleBars(refObj);
    created.push(g);
  });

  if (created.length) {
    canvas.setActiveObject(new fabric.ActiveSelection(created, { canvas }));
    canvas.requestRenderAll();
    pushHistory();
    refSelectEl.value = imgs[imgs.length - 1].mfcId;
  }
  if (skipped) {
    MFC_UI.toast(`Added ${created.length} scale bar(s) — skipped ${skipped} image(s) without voxel-size calibration.`);
  } else {
    MFC_UI.toast(`Added scale bars to ${created.length} image(s).`);
  }
}

// ---- scale bar preview: while the Scale bar tool is active, the bar that the buttons
// would add is drawn on the target image(s) — never selectable, saved or exported. ----
export let scaleBarPreviews = [];
export function clearScaleBarPreview() {
  if (!scaleBarPreviews.length) return;
  scaleBarPreviews.forEach(o => canvas.remove(o));
  scaleBarPreviews = [];
  canvas.requestRenderAll();
}
/** Images the placement buttons would use: every selected image (2+), else the reference image. */
export function scaleBarPreviewTargets() {
  if (selectedObjects(o => o.mfcType === 'scalebar').length) return [];
  const imgs = selectedObjects(o => o.mfcType === 'mfcImage');
  if (imgs.length >= 2) return imgs;
  const ref = canvas.getObjects().find(o => o.mfcId === document.getElementById('sb-ref-image').value);
  return ref ? [ref] : [];
}
export function refreshScaleBarPreview() {
  clearScaleBarPreview();
  const status = document.getElementById('sb-preview-status');
  if (!documentOpen || currentTool !== 'scalebar') { if (status) status.textContent = ''; return; }
  const form = readScaleBarFormValues();
  const targets = scaleBarPreviewTargets();
  let shown = 0, uncalibrated = 0, firstPx = null;
  targets.forEach(img => {
    const entry = registry[img.mfcId];
    if (!entry || !entry.rawImage.voxelSizeUm) { uncalibrated++; return; }
    // Inside a multi-selection an image's own scale is relative to the selection.
    const scale = fabric.util.qrDecompose(img.calcTransformMatrix()).scaleX;
    const px = form.lengthUm / entry.rawImage.voxelSizeUm * entry.workingScale * scale;
    const g = buildScaleBarGroup(px, form.thickness, form.color, form.showLabel, form.lengthUm, null);
    delete g.mfcId; delete g.mfcType;
    g.set({ selectable: false, evented: false, excludeFromExport: true, objectCaching: false, opacity: 0.85 });
    g.mfcIsPreview = true;
    const pos = scaleBarCornerPosition(canvasBounds(img), g.getScaledWidth(), g.getScaledHeight(), form.corner, form.marginPct);
    g.set(pos); g.setCoords();
    const frame = new fabric.Rect({ left: pos.left - 4, top: pos.top - 4, width: g.getScaledWidth() + 8, height: g.getScaledHeight() + 8,
      fill: 'transparent', stroke: '#5b8cff', strokeWidth: 1.5 / zoomLevel, strokeDashArray: [5 / zoomLevel, 4 / zoomLevel],
      selectable: false, evented: false, excludeFromExport: true, objectCaching: false });
    frame.mfcIsPreview = true;
    canvas.add(frame); canvas.add(g);
    scaleBarPreviews.push(frame, g);
    shown++; if (firstPx == null) firstPx = px;
  });
  if (status) {
    if (!targets.length) status.textContent = selectedObjects(o => o.mfcType === 'scalebar').length ? '' : 'Choose a reference image (or select images) to preview the scale bar.';
    else if (!shown) status.textContent = 'Preview unavailable: the image has no pixel size. Enter one in the Channels panel.';
    else status.textContent = `Preview (dashed frame): ${form.lengthUm} µm = ${Math.round(firstPx * 10) / 10} px on the page` +
      (shown > 1 ? `, on ${shown} images` : '') + (uncalibrated ? ` — ${uncalibrated} image(s) without pixel size skipped` : '') + '. Nothing is added until you click a button.';
  }
  canvas.requestRenderAll();
}

// ---- selected scale bars: their settings are shown in the panel, and the panel edits them ----
export function selectedScaleBars() { return selectedObjects(o => o.mfcType === 'scalebar'); }
export function refreshScaleBarPanel() {
  const panel = document.getElementById('panel-scalebar');
  if (!panel) return;
  const bars = selectedScaleBars();
  panel.classList.toggle('hidden', !(bars.length || currentTool === 'scalebar'));
  const info = document.getElementById('sb-selected-info');
  info.classList.toggle('hidden', !bars.length);
  document.getElementById('sb-place-actions').classList.toggle('hidden', !!bars.length && currentTool !== 'scalebar');
  if (!bars.length) return;
  const p = scaleBarProps(bars[0]);
  const setValue = (id, value) => { const el = document.getElementById(id); if (document.activeElement !== el) el.value = value; };
  if (p.lengthUm != null) setValue('sb-length', p.lengthUm);
  setValue('sb-thickness', Math.round(p.thickness * 100) / 100);
  setValue('sb-color', toHexColor(p.color) || '#ffffff');
  document.getElementById('sb-showlabel').checked = p.showLabel;
  if (p.corner) setValue('sb-corner', p.corner);
  setValue('sb-margin', p.marginPct);
  const lines = bars.slice(0, 4).map(bar => {
    const q = scaleBarProps(bar), img = canvas.getObjects().find(o => o.mfcId === bar.mfcAttachedTo);
    const entry = img && registry[img.mfcId], voxel = entry && entry.rawImage.voxelSizeUm;
    const parts = [q.lengthUm != null ? `<strong>${q.lengthUm} µm</strong>` : '<strong>length not recorded</strong>'];
    if (img) parts.push('on ' + escapeHtml(img.mfcFileName || 'image'));
    if (voxel) parts.push(`pixel size ${Math.round(voxel * 10000) / 10000} µm/px`);
    if (q.lengthUm != null && voxel) parts.push(`${Math.round(q.lengthUm / voxel * 10) / 10} image px`);
    parts.push(`${Math.round(q.lengthPx * 10) / 10} px on the page`);
    parts.push(q.corner ? q.corner.replace('-', ' ') + ' corner' : 'free position');
    return parts.join(' · ');
  });
  if (bars.length > 4) lines.push(`… and ${bars.length - 4} more`);
  info.querySelector('.sb-info-text').innerHTML = (bars.length > 1 ? `${bars.length} scale bars selected — edits apply to all:<br>` : '') + lines.join('<br>');
}
export function escapeHtml(text) { return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

/** Rebuilds a bar with new settings in place (same id, links, locks and stacking position), recalibrated against its image. */
export function rebuildScaleBar(bar, p) {
  const img = canvas.getObjects().find(o => o.mfcId === bar.mfcAttachedTo), entry = img && registry[img.mfcId];
  const old = scaleBarProps(bar), oldBox = bar.getBoundingRect(true, true);
  const px = img && entry && entry.rawImage.voxelSizeUm ? computeScaleBarPxLength(img, entry, p.lengthUm)
    : (old.lengthUm > 0 ? old.lengthPx * p.lengthUm / old.lengthUm : old.lengthPx);
  const g = buildScaleBarGroup(px, p.thickness, p.color, p.showLabel, p.lengthUm, bar.mfcId);
  for (const key of ['mfcAttachedTo', 'mfcLocked', 'mfcPositionLocked']) if (bar[key] != null) g[key] = bar[key];
  g.mfcLengthUm = p.lengthUm;
  if (p.corner) { g.mfcCorner = p.corner; g.mfcMarginPct = p.marginPct; }
  g.set({ visible: bar.visible, opacity: bar.opacity, angle: bar.angle || 0 });
  // A free bar keeps its bar line where it was; a corner bar is placed below.
  g.set({ left: oldBox.left, top: oldBox.top + oldBox.height - g.getScaledHeight() });
  const index = canvas.getObjects().indexOf(bar);
  canvas.remove(bar);
  canvas.insertAt(g, index);
  applyLockState(g);
  g.setCoords();
  if (p.corner && img) repositionAttachedScaleBars(img);
  return g;
}

/** Applies one changed scale bar field (length, thickness, color, label, corner, margin) to every selected bar. Returns false when no bar is selected. */
export function applyScaleBarFieldToSelection(field) {
  const bars = selectedScaleBars();
  if (!bars.length) return false;
  const form = readScaleBarFormValues();
  const others = canvas.getActiveObjects().filter(o => !bars.includes(o));
  canvas.discardActiveObject();
  const rebuilt = bars.map(bar => {
    const p = scaleBarProps(bar);
    if (field === 'length') p.lengthUm = form.lengthUm;
    if (p.lengthUm == null) p.lengthUm = form.lengthUm;
    if (field === 'thickness') p.thickness = form.thickness;
    if (field === 'color') p.color = form.color;
    if (field === 'label') p.showLabel = form.showLabel;
    if (field === 'corner') p.corner = form.corner;
    if (field === 'margin') { p.marginPct = form.marginPct; if (!p.corner) p.corner = form.corner; }
    return rebuildScaleBar(bar, p);
  });
  const reselect = [...rebuilt, ...others];
  canvas.setActiveObject(reselect.length === 1 ? reselect[0] : new fabric.ActiveSelection(reselect, { canvas }));
  canvas.requestRenderAll();
  pushHistory();
  refreshScaleBarPanel();
  refreshSelectionBar();
  return true;
}

/** A scale bar panel field changed: edit the selected bars, or update the preview of a new bar. */
export function onScaleBarFieldChanged(field, committed) {
  if (committed && applyScaleBarFieldToSelection(field)) return;
  refreshScaleBarPreview();
}

/**
 * Recompute a single scale bar's physical length from scratch against its reference
 * image's *current* scale (rather than nudging it relative to the previous size), so it
 * never drifts. Resizes the bar rect directly (not the group's own scaleX/scaleY), so
 * line thickness and label size stay constant while only the bar's length changes —
 * exactly like a real scale bar should behave as the image is zoomed in figure layout.
 */
export function recalibrateScaleBar(bar) {
  if (!bar.mfcAttachedTo || bar.mfcLengthUm == null) return;
  const entry = registry[bar.mfcAttachedTo];
  const refObj = canvas.getObjects().find(o => o.mfcId === bar.mfcAttachedTo);
  if (!entry || !refObj || !entry.rawImage.voxelSizeUm) return;

  const targetPxLen = computeScaleBarPxLength(refObj, entry, bar.mfcLengthUm);
  const rectChild = bar._objects && bar._objects[0];
  if (!rectChild) return;
  const groupScaleX = bar.scaleX || 1;
  const desiredLocalWidth = targetPxLen / groupScaleX;
  if (Math.abs(rectChild.width - desiredLocalWidth) > 0.01) {
    rectChild.set({ width: desiredLocalWidth });
    bar.addWithUpdate(); // recompute the group's own bounding box from its (now resized) children
    bar.setCoords();
  }
}

/** Recalibrate (length) and reposition (if corner-attached) every scale bar linked to imgObj. Call whenever imgObj's scale/size changes. */
export function updateScaleBarsForImage(imgObj) {
  if (!imgObj || imgObj.mfcType !== 'mfcImage') return;
  const bars = canvas.getObjects().filter(o => o.mfcType === 'scalebar' && o.mfcAttachedTo === imgObj.mfcId);
  if (!bars.length) return;
  bars.forEach(recalibrateScaleBar);
  repositionAttachedScaleBars(imgObj);
  canvas.requestRenderAll();
}

/** Re-position every CORNER-attached scale bar linked to imgObj (freely-placed bars are only recalibrated in length, never moved — see updateScaleBarsForImage). */
export function repositionAttachedScaleBars(imgObj) {
  if (!imgObj || imgObj.mfcType !== 'mfcImage') return;
  const bars = canvas.getObjects().filter(o => o.mfcType === 'scalebar' && o.mfcAttachedTo === imgObj.mfcId && o.mfcCorner);
  if (!bars.length) return;
  const b = canvasBounds(imgObj);
  bars.forEach(bar => {
    if (bar.group && bar.group.type === 'activeSelection') return;
    bar.set(scaleBarCornerPosition(b, bar.getScaledWidth(), bar.getScaledHeight(), bar.mfcCorner, bar.mfcMarginPct));
    bar.setCoords();
  });
  canvas.requestRenderAll();
}

// ---- tool interface (used by tools/tool-switch.js) ----
/** Leaving the Scale bar tool needs nothing here: refreshPanel removes the preview once another tool is active. */
function deactivateScaleBarTool() {}
/** The Scale bar panel and the preview of the bar the buttons would add. */
function refreshScaleBarTool() {
  refreshScaleBarPanel();
  refreshScaleBarPreview();
}
export { refreshScaleBarRefList as activate, deactivateScaleBarTool as deactivate, refreshScaleBarTool as refreshPanel };

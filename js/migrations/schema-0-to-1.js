/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Schema 0 → 1. Schema 0 is what the legacy loaders in js/project.js produce from projects saved before
   the 0.1.0 reset (v0.18–v0.22: manifest versions 1 and 2, as JSON, gzip or zip). Their objects are
   already plain Fabric JSON with sourceIds, but two things are still in the old form:
   - a v0.18 scale bar has no mfcLengthUm; its label ("20 µm") holds the length;
   - an inset outline records its region as fractions of the source image (mfcRelX/Y/W/H)
     instead of source pixels (mfcCropX/Y/W/H).
   Pure function on plain JSON: no Fabric, no DOM, no images. */

const walk = (objects, visit) => objects.forEach(obj => {
  visit(obj);
  if (obj.objects) walk(obj.objects, visit);
  if (obj.clipPath) walk([obj.clipPath], visit);
});

export function migrate(state) {
  const next = JSON.parse(JSON.stringify(state));
  const flat = [];
  walk(next.objects || [], obj => flat.push(obj));

  for (const bar of flat.filter(o => o.mfcType === 'scalebar' && o.mfcLengthUm == null)) {
    const label = (bar.objects || []).find(o => typeof o.text === 'string');
    const value = label && parseFloat(label.text.replace(',', '.'));
    if (value > 0) bar.mfcLengthUm = value;
  }

  for (const outline of flat.filter(o => o.mfcType === 'insetContour' && o.mfcCropX == null)) {
    const image = flat.find(i => i.mfcId === outline.mfcInsetSourceId);
    if (!image) continue;
    Object.assign(outline, {
      mfcCropX: (image.cropX || 0) + (outline.mfcRelX || 0) * image.width,
      mfcCropY: (image.cropY || 0) + (outline.mfcRelY || 0) * image.height,
      mfcCropW: (outline.mfcRelW || 1) * image.width,
      mfcCropH: (outline.mfcRelH || 1) * image.height
    });
  }

  next.schema = 1;
  return next;
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Schema 4 → 5 (FluoForge 0.1.10). TIFF images record which decoder made their channels in
   `display.decoder`. Decoder 2 (0.1.10) reads OME-XML, RGB pages as three channels, float, signed
   and packed samples; decoder 1 is how every earlier version read a TIFF. An image saved before
   schema 5 was made by decoder 1, and its saved channels (count, order, ranges) only fit what
   decoder 1 produces, so every image of the state gets `display.decoder: 1`, including images
   inside groups. Raster sources (PNG, JPEG, BMP) do not use it; marking them changes nothing.
   Pure function on plain JSON. */

function mark(object) {
  if (!object || typeof object !== 'object') return;
  if (object.mfcType === 'mfcImage' && object.display && typeof object.display === 'object' && object.display.decoder == null) object.display.decoder = 1;
  if (Array.isArray(object.objects)) object.objects.forEach(mark);
  if (object.clipPath) mark(object.clipPath);
}

export function migrate(state) {
  const next = JSON.parse(JSON.stringify(state));
  next.schema = 5;
  if (Array.isArray(next.objects)) next.objects.forEach(mark);
  return next;
}

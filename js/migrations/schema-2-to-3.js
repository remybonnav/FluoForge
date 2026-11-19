/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Schema 2 → 3 (FluoForge 0.1.7). Three additions, none of which changes an existing figure:
   - a channel's `color` may name any LUT of the library (viridis, cividis, magma, inferno, fire,
     grey-inverted) besides the 8 single colours, or be "file": the LUT read from the image file,
     whose 768 bytes (256 x R, G, B interleaved, base64) are kept in `lut` whichever LUT is shown;
   - a new object type, the calibration bar (mfcType "calibrationBar").
   A schema-2 state uses none of them, so it is already valid schema 3: only the number changes.
   Pure function on plain JSON. */

export function migrate(state) {
  const next = JSON.parse(JSON.stringify(state));
  next.schema = 3;
  return next;
}

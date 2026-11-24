/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Schema 6 → 7 (FluoForge 0.1.26). One addition: the layout grid (P3-T2), a new object type
   (`mfcType: "layoutGrid"`, a rect whose `mfcGrid` describes the grid in mm), its panels (images with
   `mfcGridId`) and its labels (text boxes with `mfcGridId`, `mfcGridLabel`, `mfcGridIndex`). A schema-6
   state has no grid, so it is already valid schema 7: only the number changes. Grids made by the former
   one-shot Grid button were never saved as objects; those figures open exactly as before.
   Pure function on plain JSON. */

export function migrate(state) {
  const next = JSON.parse(JSON.stringify(state));
  next.schema = 7;
  return next;
}

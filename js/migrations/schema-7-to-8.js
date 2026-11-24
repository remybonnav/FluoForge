/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Schema 7 → 8 (FluoForge 0.1.28). Layout grids get two label options in `mfcGrid`: `labelGap` (each
   label band one gutter away from the cells) and `rowLabelTurn` (row labels turned 90° to read bottom to
   top). New grids have both; a grid saved before them had neither, so this migration writes
   `labelGap: false` and `rowLabelTurn: false` into every grid (also inside groups) that has no value yet.
   Its panels and labels stay exactly where they were, also when the grid is edited later.
   Pure function on plain JSON. */

export function migrate(state) {
  const next = JSON.parse(JSON.stringify(state));
  const visit = o => {
    if (!o || typeof o !== 'object') return;
    if (o.mfcType === 'layoutGrid' && o.mfcGrid && typeof o.mfcGrid === 'object') {
      if (typeof o.mfcGrid.labelGap !== 'boolean') o.mfcGrid.labelGap = false;
      if (typeof o.mfcGrid.rowLabelTurn !== 'boolean') o.mfcGrid.rowLabelTurn = false;
    }
    (o.objects || []).forEach(visit);
  };
  (next.objects || []).forEach(visit);
  next.schema = 8;
  return next;
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Schema 3 → 4 (FluoForge 0.1.9). One addition: an image may carry `mfcCompareGroup`, the number
   of the comparison group it belongs to (its channel range, LUT and gamma are linked with the other
   members). It changes how edits spread, not how anything is drawn. A schema-3 state has no group,
   so it is already valid schema 4: only the number changes.
   Pure function on plain JSON. */

export function migrate(state) {
  const next = JSON.parse(JSON.stringify(state));
  next.schema = 4;
  return next;
}

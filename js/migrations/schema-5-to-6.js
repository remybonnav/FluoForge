/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Schema 5 → 6 (FluoForge 0.1.25). One addition: split-channel montages (Quick figure). The panels
   of a montage are images carrying `mfcMontageGroup` (the montage's id), `mfcMontageChannel` (the
   channel the panel shows, or -1 for the merge), `mfcMontageGrey` and `mfcMontageGap`; its column
   headers are text boxes with `mfcMontageGroup` and `mfcMontageChannel`. They change how edits and
   crops spread, not how anything is drawn. A schema-5 state has no montage, so it is already valid
   schema 6: only the number changes.
   Pure function on plain JSON. */

export function migrate(state) {
  const next = JSON.parse(JSON.stringify(state));
  next.schema = 6;
  return next;
}

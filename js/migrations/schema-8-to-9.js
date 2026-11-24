/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Schema 8 → 9 (FluoForge 0.1.29). One addition: panel letters (P3-T3). A lettered panel is an image
   with `mfcLetter` ({ skip, text }), its letter a text box with `mfcLetterFor` (the panel's id), and the
   document's letter style is `docProps.letterStyle`. They change how letters are numbered and kept on
   their panels, not how anything is drawn. A schema-8 state has no panel letter (text boxes typed as
   letters stay ordinary text), so it is already valid schema 9: only the number changes.
   Pure function on plain JSON. */

export function migrate(state) {
  const next = JSON.parse(JSON.stringify(state));
  next.schema = 9;
  return next;
}

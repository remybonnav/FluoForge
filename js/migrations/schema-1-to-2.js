/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Schema 1 → 2 (FluoForge 0.1.6). Each image channel gains a display gamma and an invert flag
   (display.channels[i].gamma, default 1, and .invert, default false). A state of schema 1 has
   neither, which means gamma 1 and no inversion: this migration writes those defaults on every
   image, including images inside groups and clip paths. Pure function on plain JSON. */

const walk = (objects, visit) => objects.forEach(obj => {
  visit(obj);
  if (obj.objects) walk(obj.objects, visit);
  if (obj.clipPath) walk([obj.clipPath], visit);
});

export function migrate(state) {
  const next = JSON.parse(JSON.stringify(state));
  walk(next.objects || [], obj => {
    if (obj.mfcType !== 'mfcImage' || !obj.display || !Array.isArray(obj.display.channels)) return;
    obj.display.channels = obj.display.channels.map(c => ({ ...c, gamma: Number.isFinite(c.gamma) && c.gamma > 0 ? c.gamma : 1, invert: !!c.invert }));
  });
  next.schema = 2;
  return next;
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Empty image frames (P3-T6): the places a template keeps for its images (js/layout/template-model.js).
   A frame is a dashed rectangle with a hint in the middle ("Drop an image", or which channel, slice or
   time point it will show). It keeps the id of the image it stands for, so the grid cell, panel letter,
   inset outline and scale bar linked to it are linked to the image dropped in (js/image/replace.js).
   Frames guide editing only: exports leave them out, and the figure check lists them. */

import { canvas } from '../core/state.js';
import { FRAME_TYPE } from './template-model.js';

export const isFrame = o => !!(o && o.mfcType === FRAME_TYPE);
export const frames = () => canvas.getObjects().filter(isFrame);

/** What a frame says it is waiting for. */
export function frameHint(f) {
  if (f.mfcFrameInsetContour) return 'Inset: filled from its outline';
  if (Number.isInteger(f.mfcFrameChannel)) return f.mfcFrameChannel < 0 ? 'Drop an image: merge' : `Drop an image: channel ${f.mfcFrameChannel + 1}`;
  if (Number.isInteger(f.mfcFrameT)) return `Drop a time series: point ${f.mfcFrameT + 1}`;
  if (Number.isInteger(f.mfcFrameZ)) return `Drop a Z stack: slice ${f.mfcFrameZ + 1}`;
  return 'Drop an image here';
}

function drawFrame(ctx) {
  fabric.Rect.prototype._render.call(this, ctx);
  const zoom = (canvas && canvas.viewportTransform[0]) || 1, k = 1 / (zoom * Math.abs(this.scaleX || 1));
  const size = Math.max(9, Math.min(13, (this.width * zoom) / 14));
  ctx.save();
  ctx.scale(k, k * Math.abs(this.scaleX || 1) / Math.abs(this.scaleY || 1));
  ctx.font = `${size}px "Liberation Sans", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5d6676';
  const text = frameHint(this), max = this.width / k - 8;
  let shown = text;
  while (shown.length > 4 && ctx.measureText(shown).width > max) shown = shown.slice(0, -2);
  if (shown !== text) shown = shown.slice(0, -1) + '…';
  ctx.fillText(shown, 0, 0);
  ctx.restore();
}

/** Gives a frame its look and hint (also after loading, undo and paste). */
export function installFrameObject(o) {
  if (!isFrame(o) || o.__mfcFrameInstalled) return;
  o.__mfcFrameInstalled = true;
  o._render = drawFrame;
  o.objectCaching = false;
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Grid layout assistant: arranges images in rows and columns, with optional header and label text boxes. */

import { attachTextListeners, followSourceImage, updateScaleBarsForImage } from '../canvas-app.js';
import { pushHistory } from '../core/history.js';
import { canvas, takeId } from '../core/state.js';
import { isTransformLocked } from '../ui/locks.js';

// ---- grid layout assistant ----
/**
 * Arranges images (the current multi-selection if 2+ are selected, otherwise every
 * image on the canvas) into a rows x cols grid, each fit-to-cell preserving aspect
 * ratio, with optional placeholder text boxes as column headers (above) and row
 * labels (to the left) for figure panels like "DAPI / GFP / Merge" x "Condition A/B/C".
 */
export function arrangeGrid(opts) {
  const { rows, cols, cellW, cellH, gap, headerRow, headerCol } = opts;
  let imgs = canvas.getActiveObjects().filter(o => o.mfcType === 'mfcImage');
  if (imgs.length < 2) imgs = canvas.getObjects().filter(o => o.mfcType === 'mfcImage');
  const lockedCount = imgs.filter(isTransformLocked).length;
  imgs = imgs.filter(o => !isTransformLocked(o));
  if (lockedCount) MFC_UI.toast(lockedCount + ' locked image(s) were left in place.');
  if (!imgs.length) { MFC_UI.toast('No unlocked images to arrange — import, select or unlock some first.'); return; }

  const headerRowH = headerRow ? 44 : 0;
  const headerColW = headerCol ? 120 : 0;
  const originX = 40 + headerColW;
  const originY = 40 + headerRowH;

  imgs.forEach((img, idx) => {
    if (idx >= rows * cols) return;
    const r = Math.floor(idx / cols), c = idx % cols;
    const s = Math.min(cellW / img.width, cellH / img.height);
    img.set({
      scaleX: s, scaleY: s, angle: 0,
      left: originX + c * (cellW + gap) + (cellW - img.width * s) / 2,
      top: originY + r * (cellH + gap) + (cellH - img.height * s) / 2
    });
    img.setCoords();
    updateScaleBarsForImage(img);
    followSourceImage(img);
  });

  if (headerRow) {
    for (let c = 0; c < cols; c++) {
      const t = new fabric.Textbox('Label', {
        left: originX + c * (cellW + gap), top: originY - headerRowH, width: cellW,
        fontSize: 18, textAlign: 'center', fontFamily: 'Liberation Sans', fill: '#000000'
      });
      t.mfcId = 'txt' + takeId(); t.mfcType = 'text';
      attachTextListeners(t);
      canvas.add(t);
    }
  }
  if (headerCol) {
    for (let r = 0; r < rows; r++) {
      const t = new fabric.Textbox('Label', {
        left: 40, top: originY + r * (cellH + gap) + cellH / 2 - 12, width: headerColW - 12,
        fontSize: 18, textAlign: 'right', fontFamily: 'Liberation Sans', fill: '#000000'
      });
      t.mfcId = 'txt' + takeId(); t.mfcType = 'text';
      attachTextListeners(t);
      canvas.add(t);
    }
  }
  canvas.requestRenderAll();
  pushHistory();
}

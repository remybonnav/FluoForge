/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* An image's calibration (P3-T9a): pixel size, Z step and frame interval, as used now and as stored
   in its file. The pixel size is the view's `rawImage.voxelSizeUm` (the file's is in
   `meta.decodeInfo.pixelSizeUm`). The Z step and frame interval come from the file (`rawImage.stack`)
   unless one was typed in the Channels panel: then the image carries `mfcZStepUm` or
   `mfcTimeIntervalS`, saved with the project like every mfc* property. */

import { registry } from '../core/state.js';
import { positive } from './calibration-model.js';

const rawOf = img => (img && registry[img.mfcId] ? registry[img.mfcId].rawImage : null);

/** The values stored in the image's file: { pixelSizeUm, zStepUm, frameIntervalS } (null when absent). */
export function fileCalibration(img) {
  const raw = rawOf(img), info = raw && raw.meta && raw.meta.decodeInfo, stack = raw && raw.stack;
  return { pixelSizeUm: positive(info && info.pixelSizeUm), zStepUm: positive(stack && stack.zStepUm), frameIntervalS: positive(stack && stack.frameIntervalS) };
}

/** The Z step the image uses, in µm: the typed one, else the file's; null when neither. */
export const zStepOf = img => positive(img && img.mfcZStepUm) ?? fileCalibration(img).zStepUm;
/** The frame interval the image uses, in seconds: the typed one, else the file's; null when neither. */
export const frameIntervalOf = img => positive(img && img.mfcTimeIntervalS) ?? fileCalibration(img).frameIntervalS;
/** The pixel size the image uses, in µm/px, or null. */
export const pixelSizeOf = img => positive(rawOf(img) && rawOf(img).voxelSizeUm);

/** The values the image uses now: { pixelSizeUm, zStepUm, frameIntervalS }. */
export const currentCalibration = img => ({ pixelSizeUm: pixelSizeOf(img), zStepUm: zStepOf(img), frameIntervalS: frameIntervalOf(img) });

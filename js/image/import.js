/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Image import: decodes TIFF and raster files, adds them to the canvas as images, and recomposites an image from its raw channels. */

import { pushHistory } from '../core/history.js';
import { canvas, registry, takeId } from '../core/state.js';
import { refreshChannelPanel } from './channels.js';
import { refreshScaleBarRefList } from '../tools/scalebar.js';

// ---- image import ----
export async function importFiles(fileList) {
  for (const file of Array.from(fileList)) {
    try {
      const isTiff = /\.tiff?$/i.test(file.name);
      const rawImage = isTiff ? await MFC_TIFF.decodeFile(file) : await MFC_TIFF.decodeRasterImage(file);
      await addImageToCanvas(rawImage, file);
    } catch (err) {
      console.error(err);
      MFC_UI.toast('Failed to import ' + file.name + ': ' + err.message);
    }
  }
}

export async function addImageToCanvas(rawImage, sourceFile) {
  const scale = MFC_TIFF.workingScale(rawImage.width, rawImage.height);
  const compositeCanvas = MFC_TIFF.compositeChannels(rawImage, scale);

  const id = 'img' + takeId();
  const sourceId = await MFC_PROJECT.registerSource(sourceFile, rawImage);
  registry[id] = { rawImage, sourceId, sourceBlob: sourceFile, workingScale: scale };

  const fabricImg = new fabric.Image(compositeCanvas, {
    left: 40 + (canvas.getObjects().length * 20) % 200,
    top: 40 + (canvas.getObjects().length * 20) % 200,
    cornerStyle: 'circle',
    transparentCorners: false,
    cornerColor: '#5b8cff',
    borderColor: '#5b8cff'
  });
  fabricImg.mfcId = id;
  fabricImg.mfcType = 'mfcImage';
  fabricImg.mfcRawWidth = rawImage.width;
  fabricImg.mfcRawHeight = rawImage.height;
  fabricImg.mfcFileName = rawImage.fileName;

  canvas.add(fabricImg);
  canvas.setActiveObject(fabricImg);
  canvas.requestRenderAll();
  pushHistory();
  refreshChannelPanel();
  refreshScaleBarRefList();
}

/** Recompute the composite for a given fabric image object from its raw channel data. */
export function recomposite(fabricImg, fullRes) {
  const entry = registry[fabricImg.mfcId];
  if (!entry) return;
  const scale = fullRes ? 1 : entry.workingScale;
  const newCanvas = MFC_TIFF.compositeChannels(entry.rawImage, scale);
  const curScaleX = fabricImg.scaleX, curScaleY = fabricImg.scaleY;
  const curWidth = fabricImg.width, curHeight = fabricImg.height;
  const curCropX = fabricImg.cropX, curCropY = fabricImg.cropY;
  fabricImg.setElement(newCanvas);
  // Fabric's setElement() resets width/height to the new element's full native size
  // (via _setWidthHeight) but leaves cropX/cropY untouched — so a cropped image would
  // end up with a nonzero crop *offset* but a full-size crop *window*, drawing past the
  // intended crop out to the original image's edges with blank space filling the gap.
  // That's what made cropped images "un-crop" themselves on any channel edit, and (since
  // this ran again right after the crop was restored) on every project reload — and it
  // corrupted the image's bounding box, which is also why attached scale bars snapped
  // back to a corner of the original uncropped image instead of the cropped one.
  fabricImg.width = curWidth; fabricImg.height = curHeight;
  fabricImg.cropX = curCropX; fabricImg.cropY = curCropY;
  fabricImg.scaleX = curScaleX; fabricImg.scaleY = curScaleY;
  fabricImg.setCoords();
  canvas.requestRenderAll();
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Image import: decodes TIFF and raster files, adds them to the canvas as images, and recomposites an image from its raw channels. */

import { pushHistory } from '../core/history.js';
import { canvas, registry, takeId } from '../core/state.js';
import { refreshChannelPanel } from './channels.js';
import { refreshScaleBarRefList } from '../tools/scalebar.js';
import { updateCalibrationBarsForImage } from '../tools/calibration-bar.js';

// Microscope formats a browser cannot read: Fiji (Bio-Formats) converts them to OME-TIFF.
export const MICROSCOPE_FORMATS = /\.(czi|lif|lof|nd2|oib|oif|vsi|ims|dv|r3d|zvi|sld|lei|mvd2)$/i;
export const CONVERSION_MACRO = 'tools/Export_for_FluoForge.ijm';
const macroLink = { href: CONVERSION_MACRO, download: 'Export_for_FluoForge.ijm', text: 'Download the Fiji macro Export_for_FluoForge.ijm',
  title: 'A Fiji macro that converts a folder of microscope files (CZI, LIF, ND2, ...) to OME-TIFF with Bio-Formats, keeping channels, Z, time and pixel size' };

/** The error for a microscope format FluoForge does not read, naming the way to convert it. */
export function microscopeFormatError(name) {
  const ext = (name.match(/\.([^.]+)$/) || [])[1] || '';
  const error = new Error(`${name} is a ${ext.toUpperCase()} file. FluoForge reads TIFF (including OME-TIFF and ImageJ TIFF), PNG, JPEG and BMP; ` +
    'microscope formats such as CZI, LIF and ND2 cannot be decoded in a browser. Convert them to OME-TIFF in Fiji with the ' +
    'Export_for_FluoForge macro (Plugins > Macros > Run...), which keeps the channels, Z slices, time frames and pixel size.');
  error.name = 'UnsupportedFormatError';
  return error;
}

// ---- image import ----
export async function importFiles(fileList) {
  for (const file of Array.from(fileList)) {
    try {
      if (MICROSCOPE_FORMATS.test(file.name)) throw microscopeFormatError(file.name);
      const isTiff = /\.tiff?$/i.test(file.name);
      const rawImage = isTiff ? await MFC_TIFF.decodeFile(file) : await MFC_TIFF.decodeRasterImage(file);
      await addImageToCanvas(rawImage, file);
    } catch (err) {
      // Nothing was added: decoding happens before the image touches the canvas.
      if (err.name === 'ImportCancelled') MFC_UI.toast(err.message);
      else MFC_ERRORS.report(err, { title: 'Could not import ' + file.name, link: err.name === 'UnsupportedFormatError' ? macroLink : null });
    }
  }
}

export async function addImageToCanvas(rawImage, sourceFile) {
  const scale = MFC_TIFF.workingScale(rawImage.width, rawImage.height);
  const compositeCanvas = await MFC_TIFF.composite(rawImage, scale, null, null, null, { cache: true });

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

/* Recomposites are scheduled: several changes within one animation frame (a slider drag fires
   many input events) give one composite per image, and while one is being computed only the
   latest settings are composited next. MFC_TIFF.whenIdle() waits for all of them. */
const scheduled = new Map(); // image -> fullRes, for the next frame
const running = new Set(), again = new Map();
let frame = 0, frameDone = null;
const nextFrame = callback => (document.hidden ? setTimeout(callback, 0) : requestAnimationFrame(callback));

/** Recompute the composite for a given fabric image object from its raw channel data (in the next frame). */
export function recomposite(fabricImg, fullRes) {
  if (!registry[fabricImg.mfcId]) return;
  // Calibration bars follow at once (they are small), so the history step that follows has them.
  updateCalibrationBarsForImage(fabricImg);
  scheduled.set(fabricImg, !!fullRes);
  if (!frame) {
    MFC_TIFF.track(new Promise(resolve => { frameDone = resolve; }));
    frame = nextFrame(runScheduled);
  }
}

function runScheduled() {
  frame = 0;
  const batch = [...scheduled]; scheduled.clear();
  for (const [img, fullRes] of batch) {
    if (running.has(img)) again.set(img, fullRes);
    else MFC_TIFF.track(compositeInto(img, fullRes));
  }
  const done = frameDone; frameDone = null; done();
}

async function compositeInto(fabricImg, fullRes) {
  running.add(fabricImg);
  try {
    const entry = registry[fabricImg.mfcId];
    if (!entry) return;
    const scale = fullRes ? 1 : entry.workingScale;
    const newCanvas = await MFC_TIFF.composite(entry.rawImage, scale, null, null, null, { cache: !fullRes });
    if (registry[fabricImg.mfcId] === entry) applyComposite(fabricImg, newCanvas);
  } catch (error) {
    MFC_ERRORS.report(error, { title: 'Could not redraw ' + (fabricImg.mfcFileName || 'the image') });
  } finally {
    running.delete(fabricImg);
    if (again.has(fabricImg)) { const fullRes = again.get(fabricImg); again.delete(fabricImg); recomposite(fabricImg, fullRes); }
  }
}

function applyComposite(fabricImg, newCanvas) {
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

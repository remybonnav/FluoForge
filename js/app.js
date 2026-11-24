/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* app.js: the module entry point. It publishes the editor's public API as `window.MFC`, the same
   object, with the same names, that the classic scripts (main.js, project.js, export.js…) and the tests use. */
/*
 * Editor layout (formerly one file, canvas-app.js):
 *   core/    state, canvas set-up and events, undo history, pages, zoom, clipboard
 *   image/   import and the channel panel
 *   tools/   one file per tool (crop, text, shape, path, inset, scalebar) and tool switching
 *   layout/  align, grid, snapping and nudge
 *   ui/      layers panel, selection bar, locks
 *
 * Design decisions (per the brief's open questions):
 *  - Aspect ratio is LOCKED BY DEFAULT on resize; hold Shift while
 *    dragging a corner handle to resize freely (unlocked).
 *  - Channel count is unlimited / dynamic, driven entirely by the number
 *    of pages found in the imported TIFF.
 *  - Large images: the on-canvas composite is capped at 2048px on the
 *    long edge for interactive performance (see tiff.js MAX_WORKING_DIM).
 *    Raw 16-bit channel arrays are kept in memory and re-composited at
 *    full resolution at export time, so exports are never downsampled.
 * -----------------------------------------------------------------------
 */

import { init } from './core/canvas-events.js';
import { copySelection, duplicateSelection, pasteSelection } from './core/clipboard.js';
import { getHistory, jumpToHistory, pushHistory, redo, refreshHistoryPanel, resetHistory, undo } from './core/history.js';
import { addPage, applyDocProps, closeDocument, docPropsToPixels, pageBounds, pageCount, pageIndexForBox, removeLastPage, scrollToPage } from './core/pages.js';
import { currentTool, documentOpen, getAppVersion, getCanvas, getDocProps, getNextIdCounter, getRegistry, isHelper, setDocName, setNextIdCounter } from './core/state.js';
import { getZoomLevel, setZoom, updateZoomDisplay, zoomIn, zoomOut, zoomReset, zoomToSelection } from './core/zoom.js';
import { applyAlphaToggle, applyBrightnessContrast, applyPixelSize, applyStackPlane, commitBrightnessContrast, refreshChannelPanel, resetToneCurve } from './image/channels.js';
import { addImageToCanvas, importFiles, recomposite } from './image/import.js';
import { align } from './layout/align.js';
import { arrangeGrid } from './layout/grid.js';
import { installGridPanel } from './layout/grid-panel.js';
import { nudgeSelection } from './layout/snap.js';
import { applyCrop, applyCropFieldsToRect, cancelCrop, cropToShape, cropToShapePair, releaseShapeCrop, setCropAspectMode } from './tools/crop.js';
import { applyExactSizeToSelectedContour, applyInsetContourStyle, createInsetFromContour, loadInsetSizePreferences, refreshInsetPanel, saveInsetSizePreferences, setInsetAspectMode } from './tools/inset.js';
import { applyPathStyle, cancelPathDrawing, deleteSelectedPathNode, enterPathEdit, exitPathEdit, finishPathDrawing, handlePathKey, insertPathNode, installPathControls, pathArrowGeometry, refreshPathPanel, setPathDefaultMode, setSelectedIncomingSegment, setSelectedNodeType, togglePathClosed } from './tools/path.js';
import { onScaleBarFieldChanged, placeScaleBarAtCorner, placeScaleBarOnSelectedImages, refreshScaleBarPanel, refreshScaleBarPreview, refreshScaleBarRefList, scaleBarProps } from './tools/scalebar.js';
import { installLegendPanel } from './tools/legend.js';
import { installQuickFigure } from './ui/quick-figure-dialog.js';
import { applyShapeStyle, installCurveControls, refreshShapePanel, setShapeAspectMode, setShapeKind } from './tools/shape.js';
import { applyTextAlign, applyTextBorder, applyTextBoxSize, applyTextStyle, applyTextVerticalAlign, attachTextListeners, centerTextInBox, effectiveFontSize, normalizeTextScale, refreshTextPanel } from './tools/text.js';
import { setTool } from './tools/tool-switch.js';
import './ui/image-info.js'; // wires the Image info button of the Channels panel
import './ui/figure-report.js'; // the figure report (Export menu); js/export.js and js/main.js import it
import './ui/figure-check.js'; // wires the Check figure panel and the summary in the Export menu
import './ui/vision-preview.js'; // the Vision selector in the top bar (view-only colour-vision preview)
import './ui/preferences-dialog.js'; // the Preferences dialog (top bar, Ctrl+,)
import './ui/export-dialog.js'; // Export ▸ Export… (js/main.js imports it on demand)
import './ui/export-panels.js'; // Export ▸ Export panels (zip)
import './ui/copy-external.js'; // Export ▸ Copy for other software (Ctrl+Shift+C)
import { groupSelection, refreshLayersPanel, setAllLayersVisible, toggleLayerLock, toggleLayerPositionLock, toggleLayerVisibility, ungroupSelection } from './ui/layers.js';
import { applyLockState, isTransformLocked, setPositionLock, togglePositionLockSelection } from './ui/locks.js';
import { applyObjectPositionFromFields, applyObjectSizeFromFields, refreshObjectSizePanel, refreshSelectionBar, rotateSelected, selectedObjects, setObjectAngle, uncropImage } from './ui/selection-bar.js';

export const MFC = {
  init, getCanvas, getDocProps, applyDocProps, closeDocument, setDocName, getAppVersion, docPropsToPixels,
  importFiles, addImageToCanvas, recomposite, refreshChannelPanel,
  applyPixelSize, applyAlphaToggle, applyStackPlane, applyBrightnessContrast, commitBrightnessContrast, resetToneCurve,
  undo, redo, pushHistory, resetHistory, jumpToHistory, getHistory, refreshHistoryPanel,
  setTool, setShapeKind, installCurveControls, installPathControls, align, copySelection, pasteSelection, duplicateSelection, nudgeSelection, refreshLayersPanel,
  groupSelection, ungroupSelection,
  applyCrop, cancelCrop, setCropAspectMode, applyCropFieldsToRect,
  applyTextStyle, applyTextAlign, applyTextBoxSize, applyTextBorder, refreshTextPanel, attachTextListeners,
  applyTextVerticalAlign, centerTextInBox, effectiveFontSize, normalizeTextScale,
  refreshObjectSizePanel, refreshSelectionBar, applyObjectSizeFromFields, applyObjectPositionFromFields, rotateSelected, setObjectAngle, uncropImage,
  applyLockState, isTransformLocked, togglePositionLockSelection, setPositionLock, toggleLayerLock, toggleLayerPositionLock,
  toggleLayerVisibility, setAllLayersVisible,
  refreshScaleBarRefList, placeScaleBarAtCorner, placeScaleBarOnSelectedImages,
  arrangeGrid,
  applyShapeStyle, setShapeAspectMode, refreshShapePanel,
  setPathDefaultMode, applyPathStyle, enterPathEdit, exitPathEdit, deleteSelectedPathNode,
  setSelectedNodeType, setSelectedIncomingSegment, togglePathClosed, refreshPathPanel,
  finishPathDrawing, cancelPathDrawing, handlePathKey, insertPathNode, pathArrowGeometry,
  createInsetFromContour, refreshInsetPanel, applyInsetContourStyle, setInsetAspectMode,
  loadInsetSizePreferences, saveInsetSizePreferences, applyExactSizeToSelectedContour,
  zoomIn, zoomOut, zoomReset, zoomToSelection, updateZoomDisplay, setZoom, getZoomLevel,
  getRegistry, getNextIdCounter, setNextIdCounter,
  pageCount, pageBounds, pageIndexForBox, addPage, removeLastPage, scrollToPage,
  selectedObjects, isHelper, scaleBarProps, refreshScaleBarPanel, refreshScaleBarPreview, onScaleBarFieldChanged,
  cropToShape, releaseShapeCrop, cropToShapePair,
  get hasDocument() { return documentOpen; },
  get currentTool() { return currentTool; }
};

window.MFC = MFC;
installLegendPanel();
installQuickFigure();
installGridPanel();

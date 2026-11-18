/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* app.js: the module entry point. It publishes the editor's public API as `window.MFC`, the same
   object, with the same names, that the classic scripts (main.js, project.js, export.js…) and the tests use. */
import { currentTool, documentOpen, getAppVersion, getCanvas, getDocProps, getNextIdCounter, getRegistry, isHelper, setDocName, setNextIdCounter } from './core/state.js';
import { getHistory, jumpToHistory, pushHistory, redo, refreshHistoryPanel, resetHistory, undo } from './core/history.js';
import { addPage, applyDocProps, closeDocument, docPropsToPixels, pageBounds, pageCount, pageIndexForBox, removeLastPage, scrollToPage } from './core/pages.js';
import { getZoomLevel, setZoom, updateZoomDisplay, zoomIn, zoomOut, zoomReset, zoomToSelection } from './core/zoom.js';
import { addImageToCanvas, align, applyAlphaToggle, applyBrightnessContrast, applyCrop, applyCropFieldsToRect, applyExactSizeToSelectedContour, applyInsetContourStyle, applyLockState, applyObjectPositionFromFields, applyObjectSizeFromFields, applyPathStyle, applyPixelSize, applyShapeStyle, applyStackPlane, applyTextAlign, applyTextBorder, applyTextBoxSize, applyTextStyle, applyTextVerticalAlign, arrangeGrid, attachTextListeners, cancelCrop, cancelPathDrawing, centerTextInBox, commitBrightnessContrast, copySelection, createInsetFromContour, cropToShape, cropToShapePair, deleteSelectedPathNode, duplicateSelection, effectiveFontSize, enterPathEdit, exitPathEdit, finishPathDrawing, groupSelection, handlePathKey, importFiles, init, insertPathNode, installCurveControls, installPathControls, isTransformLocked, loadInsetSizePreferences, normalizeTextScale, nudgeSelection, onScaleBarFieldChanged, pasteSelection, pathArrowGeometry, placeScaleBarAtCorner, placeScaleBarOnSelectedImages, recomposite, refreshChannelPanel, refreshInsetPanel, refreshLayersPanel, refreshObjectSizePanel, refreshPathPanel, refreshScaleBarPanel, refreshScaleBarPreview, refreshScaleBarRefList, refreshSelectionBar, refreshShapePanel, refreshTextPanel, releaseShapeCrop, resetToneCurve, rotateSelected, saveInsetSizePreferences, scaleBarProps, selectedObjects, setAllLayersVisible, setCropAspectMode, setInsetAspectMode, setObjectAngle, setPathDefaultMode, setPositionLock, setSelectedIncomingSegment, setSelectedNodeType, setShapeAspectMode, setShapeKind, setTool, toggleLayerLock, toggleLayerPositionLock, toggleLayerVisibility, togglePathClosed, togglePositionLockSelection, uncropImage, ungroupSelection } from './canvas-app.js';

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

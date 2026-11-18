/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* ES modules (P1-T3): the editor is split into modules under js/, loaded from the single entry js/app.js.
   The public API stays exactly the one canvas-app.js exposed before the split, and no module leaks a global. */
async function runModuleApiRegressions() {
  const checks=[];
  const assert=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};

  // The 121 names of the public API before the split (v0.1.1). Adding or removing one is an API change, not a refactor.
  const API=('addImageToCanvas addPage align applyAlphaToggle applyBrightnessContrast applyCrop applyCropFieldsToRect applyDocProps '+
    'applyExactSizeToSelectedContour applyInsetContourStyle applyLockState applyObjectPositionFromFields applyObjectSizeFromFields applyPathStyle '+
    'applyPixelSize applyShapeStyle applyStackPlane applyTextAlign applyTextBorder applyTextBoxSize applyTextStyle applyTextVerticalAlign arrangeGrid '+
    'attachTextListeners cancelCrop cancelPathDrawing centerTextInBox closeDocument commitBrightnessContrast copySelection createInsetFromContour '+
    'cropToShape cropToShapePair currentTool deleteSelectedPathNode docPropsToPixels duplicateSelection effectiveFontSize enterPathEdit exitPathEdit '+
    'finishPathDrawing getAppVersion getCanvas getDocProps getHistory getNextIdCounter getRegistry getZoomLevel groupSelection handlePathKey '+
    'hasDocument importFiles init insertPathNode installCurveControls installPathControls isHelper isTransformLocked jumpToHistory '+
    'loadInsetSizePreferences normalizeTextScale nudgeSelection onScaleBarFieldChanged pageBounds pageCount pageIndexForBox pasteSelection '+
    'pathArrowGeometry placeScaleBarAtCorner placeScaleBarOnSelectedImages pushHistory recomposite redo refreshChannelPanel refreshHistoryPanel '+
    'refreshInsetPanel refreshLayersPanel refreshObjectSizePanel refreshPathPanel refreshScaleBarPanel refreshScaleBarPreview refreshScaleBarRefList '+
    'refreshSelectionBar refreshShapePanel refreshTextPanel releaseShapeCrop removeLastPage resetHistory resetToneCurve rotateSelected '+
    'saveInsetSizePreferences scaleBarProps scrollToPage selectedObjects setAllLayersVisible setCropAspectMode setDocName setInsetAspectMode '+
    'setNextIdCounter setObjectAngle setPathDefaultMode setPositionLock setSelectedIncomingSegment setSelectedNodeType setShapeAspectMode '+
    'setShapeKind setTool setZoom toggleLayerLock toggleLayerPositionLock toggleLayerVisibility togglePathClosed togglePositionLockSelection '+
    'uncropImage undo ungroupSelection updateZoomDisplay zoomIn zoomOut zoomReset zoomToSelection').split(' ');
  const GETTERS=['currentTool','hasDocument'];
  // Globals the page defines today: the vendored libraries, MFC, and the function declarations of the classic scripts.
  const GLOBALS=('JSZip MFC UTIF attachColorPalette attachColorPalettesToAllInputs clearImmediate copyGLTo2DDrawImage copyGLTo2DPutImageData '+
    'fabric jsdom jspdf pako resizeCanvasIfNeeded setImmediate showAboutDialog showDocPropsModal svg2pdf syncDocPropsPanel '+
    'updateDocPixelPreview virtualWindow').split(' ');

  const modules=[...document.querySelectorAll('script[type="module"]')].map(s=>s.getAttribute('src'));
  assert('The editor is loaded from one module entry, js/app.js',modules.length===1&&/^js\/app\.js(\?|$)/.test(modules[0]));
  assert('canvas-app.js is no longer loaded as a classic script',![...document.querySelectorAll('script[src]:not([type="module"])')]
    .some(s=>/canvas-app/.test(s.getAttribute('src'))));
  assert('window.MFC is the API object the classic scripts and tests use',typeof window.MFC==='object'&&MFC===window.MFC);

  const names=Object.keys(MFC).sort();
  const missing=API.filter(n=>!names.includes(n)), extra=names.filter(n=>!API.includes(n));
  assert(`MFC exposes exactly the ${API.length} names of the API before the split`+(missing.length||extra.length?
    ` (missing: ${missing.join(', ')||'none'}; extra: ${extra.join(', ')||'none'})`:''),!missing.length&&!extra.length);
  const notFunctions=API.filter(n=>!GETTERS.includes(n)&&typeof MFC[n]!=='function');
  assert('Every API name except the two getters is a function'+(notFunctions.length?' (not functions: '+notFunctions.join(', ')+')':''),!notFunctions.length);
  assert('hasDocument and currentTool are read-only getters',GETTERS.every(n=>{const d=Object.getOwnPropertyDescriptor(MFC,n);return d&&d.get&&!d.set;})&&
    typeof MFC.hasDocument==='boolean'&&typeof MFC.currentTool==='string');
  assert('The app version is unchanged by the split',MFC.getAppVersion()==='0.1.1');

  // Module code lives in module scope: compare the page's globals with those of a blank frame.
  const blank=document.createElement('iframe');document.body.append(blank);
  const base=new Set(Object.getOwnPropertyNames(blank.contentWindow));blank.remove();
  const added=Object.getOwnPropertyNames(window).filter(n=>!base.has(n)&&n!=='runModuleApiRegressions').sort();
  const leaked=added.filter(n=>!GLOBALS.includes(n)), gone=GLOBALS.filter(n=>!added.includes(n));
  assert('No module leaks a new global, and no existing global disappears'+(leaked.length||gone.length?
    ` (new: ${leaked.join(', ')||'none'}; gone: ${gone.join(', ')||'none'})`:''),!leaked.length&&!gone.length);
  assert('The classic scripts still define their APIs',typeof MFC_TIFF==='object'&&typeof MFC_PROJECT==='object'&&
    typeof MFC_EXPORT==='object'&&typeof MFC_AUTOSAVE==='object'&&typeof MFC_UI==='object');
  return {checks};
}

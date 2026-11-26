/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Switching tools: updates the toolbar, canvas selection mode and cursor, and activates or deactivates each tool. */

import { canvas, documentOpen, setCurrentTool } from '../core/state.js';
import * as annotateTool from './annotate.js';
import * as cropTool from './crop.js';
import * as insetTool from './inset.js';
import * as legendTool from './legend.js';
import * as pathTool from './path.js';
import * as scaleBarTool from './scalebar.js';
import * as shapeTool from './shape.js';
import * as textTool from './text.js';
import { applyLockState } from '../ui/locks.js';
import { refreshSelectionBar } from '../ui/selection-bar.js';

// ---- tool switching ----
export function setTool(tool) {
  if (!documentOpen) return;
  if (tool !== 'path') pathTool.deactivate();
  setCurrentTool(tool);
  if (tool === 'annotate') annotateTool.activate(); // remembers the selected images (auto-labels go on them)
  else annotateTool.deactivate();
  // Non-selectable flags do not stop Fabric dragging an object that is already
  // active. Creation tools must release that selection before the next pointer down.
  if (['inset','shape','path','text'].includes(tool)) canvas.discardActiveObject();
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  cropTool.refreshPanel();
  canvas.isDrawingMode = false;
  canvas.selection = (tool === 'select' || tool === 'scalebar' || tool === 'legend');
  canvas.defaultCursor = tool === 'path' ? 'crosshair' : 'default';
  canvas.forEachObject(applyLockState);
  if (tool === 'crop') cropTool.activate();
  else cropTool.deactivate();
  if (tool === 'scalebar') scaleBarTool.activate();
  scaleBarTool.refreshPanel();
  if (tool !== 'shape') shapeTool.deactivate();
  if (tool !== 'inset') insetTool.deactivate();
  textTool.refreshPanel();
  refreshSelectionBar();
  shapeTool.refreshPanel();
  pathTool.refreshPanel();
  insetTool.refreshPanel();
  if (tool === 'legend') legendTool.activate();
  legendTool.refreshPanel();
  annotateTool.refreshPanel();
  MFC_UI.focusSelection(canvas.getActiveObject(), tool);
}

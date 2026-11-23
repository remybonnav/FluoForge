/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Shared editor state: the Fabric canvas, document properties, the object registry, the id counter and the current tool.
   Other modules read these as live bindings and change them through the setters. */

export let canvas;                       // fabric.Canvas
export function setCanvas(c) { canvas = c; }
export const MFC_VERSION = '0.1.23';
export function getAppVersion() { return MFC_VERSION; }

export let docProps = { name: 'Untitled Figure', width: 1748, height: 1240, unit: 'px', dpi: 300 }; // A4-ish default @300dpi
export function setDocProps(props) { docProps = props; }
export let currentTool = 'select';
export function setCurrentTool(tool) { currentTool = tool; }
export let documentOpen = false;
export function setDocumentOpen(open) { documentOpen = open; }
export let nextId = 1;
/** The next object id number (the counter is saved in projects). */
export function takeId() { return nextId++; }
export const registry = {};              // view id -> { rawImage, sourceId, sourceBlob, workingScale }

/** Page backgrounds, path drawing aids and scale bar previews: on the canvas but never part of the figure. */
export function isHelper(o) { return !!(o && (o.mfcIsPageBounds || o.mfcIsPathHelper || o.mfcIsPathDraft || o.mfcIsPreview)); }

export function getDocProps() { return docProps; }

/** Updates just the project name, live as the user types — separate from applyDocProps
 * (which also resizes the canvas) so Save/Save As always use the name currently shown
 * in the field, even if the user never clicked "Apply". Previously, typing a new name
 * and immediately using Save As would silently save under the *old* name because
 * docProps.name was only ever touched by the Apply button. */
export function setDocName(name) {
  docProps.name = (name || '').trim() || 'Untitled Figure';
}
export function getCanvas() { return canvas; }

export function getRegistry() { return registry; }
export function getNextIdCounter() { return nextId; }
export function setNextIdCounter(v) { nextId = v; }

fabric.Object.NUM_FRACTION_DIGITS = 8;

export const DASH_PRESETS = {
  solid: null,
  dashed: [12, 8],
  dotted: [2, 5],
  dashdot: [12, 5, 2, 5],
  longdash: [22, 10]
};

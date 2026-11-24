/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/*
 * main.js — app bootstrap & UI wiring
 */

const MFC_UI = (function () {
  const themeIds = ['light', 'sage', 'dark', 'slate'];
  let focusedPanel = null;
  function applyTheme(theme) {
    if (!themeIds.includes(theme)) theme = 'light';
    document.documentElement.dataset.theme = theme;
    document.getElementById('theme-select').value = theme;
    try { localStorage.setItem('fluoforge-theme', theme); } catch (_) { /* Preferences are optional. */ }
  }
  // Panels only collapse/expand through their own toggle (or Collapse all). The
  // chosen state is remembered per panel; selection never changes it.
  const COLLAPSED_KEY = 'fluoforge-collapsed-panels';
  function readCollapsed() {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '["panel-docprops"]')); }
    catch (_) { return new Set(['panel-docprops']); }
  }
  function setPanelExpanded(panel, expanded, remember = true) {
    panel.querySelector('.panel-body').hidden = !expanded;
    panel.querySelector('.panel-toggle').setAttribute('aria-expanded', String(expanded));
    if (!remember) return;
    const collapsed = readCollapsed();
    if (expanded) collapsed.delete(panel.id); else collapsed.add(panel.id);
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch (_) { /* Preferences are optional. */ }
  }
  function initInspector() {
    let savedTheme;
    try { savedTheme = localStorage.getItem('fluoforge-theme'); } catch (_) { /* Use system theme. */ }
    applyTheme(savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'slate' : 'light'));
    document.getElementById('theme-select').addEventListener('change', event => applyTheme(event.target.value));
    const collapsed = readCollapsed();
    document.querySelectorAll('#side-panel > .panel').forEach(panel => {
      const heading = panel.querySelector(':scope > h3');
      const body = document.createElement('div'); body.className = 'panel-body'; body.id = panel.id + '-body';
      Array.from(panel.childNodes).filter(child => child !== heading).forEach(child => body.append(child));
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'panel-toggle';
      while (heading.firstChild) toggle.append(heading.firstChild);
      toggle.setAttribute('aria-controls', body.id);
      toggle.title = 'Collapse or expand this section';
      heading.append(toggle); panel.append(body);
      setPanelExpanded(panel, !collapsed.has(panel.id), false);
      toggle.addEventListener('click', () => setPanelExpanded(panel, body.hidden));
    });
    document.getElementById('inspector-collapse-all').addEventListener('click', () => {
      document.querySelectorAll('#side-panel > .panel').forEach(panel => setPanelExpanded(panel, false));
    });
    document.getElementById('side-panel').addEventListener('focusin', event => {
      const panel = event.target.closest('.panel');
      if (panel) highlightPanel(panel);
    });

    updateDocumentState(false);
  }
  /** Visual emphasis only: never reorders, resizes, scrolls, opens or closes a panel. */
  function highlightPanel(panel) {
    document.querySelectorAll('#side-panel > .panel').forEach(item => {
      item.classList.toggle('panel-focused', item === panel);
    });
    focusedPanel = panel.id;
    document.getElementById('inspector-context').textContent = panel.querySelector('.panel-toggle').textContent.trim();
  }
  function focusPanel(id, force = false) {
    const panel = document.getElementById(id);
    if (!panel || panel.classList.contains('hidden')) return;
    if (focusedPanel === id && !force) return;
    highlightPanel(panel);
    // Only an explicit request (Document / Grid buttons, new figure) opens and reveals a panel.
    if (force) { setPanelExpanded(panel, true); panel.scrollIntoView({ block: 'nearest' }); }
  }
  function focusSelection(object, tool, force = false) {
    const tools = {crop:'panel-crop',text:'panel-text',scalebar:'panel-scalebar',shape:'panel-shape',path:'panel-path',inset:'panel-inset',legend:'panel-legend'};
    let panel = tool !== 'select' ? tools[tool] : null;
    if (!panel && object) {
      panel = object.mfcShapeKind === 'path' ? 'panel-path' :
        ({mfcImage:'panel-channels',text:'panel-text',scalebar:'panel-scalebar',shape:'panel-shape',insetContour:'panel-inset',layoutGrid:'panel-grid'})[object.mfcType] || null;
    }
    if (panel) focusPanel(panel, force);
    else {
      document.querySelectorAll('.panel-focused').forEach(item => item.classList.remove('panel-focused'));
      focusedPanel = null; document.getElementById('inspector-context').textContent = MFC.hasDocument ? 'Select an object or tool' : 'No document open';
    }
  }
  function updateDocumentState(open) {
    document.body.classList.toggle('document-open', open);
    document.getElementById('workspace-empty').hidden = open;
    document.querySelectorAll('[data-requires-document]').forEach(element => { element.disabled = !open; });
    if (!open) document.getElementById('inspector-context').textContent = 'No document open';
  }
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.classList.add('hidden'), 300); }, 2600);
  }

  let savingBackdrop = null;
  /** Shows an in-page "Saving…" dialog (a normal DOM overlay, not a native browser popup) so a slow save on a large project doesn't look like the app has frozen. */
  function showSavingDialog(message) {
    if (savingBackdrop) { savingBackdrop.querySelector('.saving-msg').textContent = message || 'Saving…'; return; }
    savingBackdrop = document.createElement('div');
    savingBackdrop.className = 'modal-backdrop';
    savingBackdrop.innerHTML = `
      <div class="modal saving-modal">
        <div class="spinner"></div>
        <p class="saving-msg">${message || 'Saving…'}</p>
      </div>`;
    document.body.appendChild(savingBackdrop);
  }
  function hideSavingDialog() {
    if (savingBackdrop) { savingBackdrop.remove(); savingBackdrop = null; }
  }

  /** Page navigator (top bar) and page count (Document panel) follow the document's pages. */
  function refreshPageControls() {
    const count = MFC.hasDocument ? MFC.pageCount() : 1;
    const nav = document.getElementById('page-nav');
    nav.replaceChildren(...Array.from({ length: count }, (_, i) => new Option('Page ' + (i + 1) + ' / ' + count, String(i))));
    nav.hidden = count < 2;
    document.getElementById('doc-pages-count').textContent = String(count);
    document.getElementById('doc-remove-page').disabled = count < 2;
  }

  return { toast, showSavingDialog, hideSavingDialog, initInspector, applyTheme,
    focusPanel, focusSelection, updateDocumentState, refreshPageControls };
})();

function showDocPropsModal(onConfirm) {
  if (document.querySelector('.document-start-modal')) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop document-start-modal';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="create-document-title">
      <h2 id="create-document-title">Create a figure</h2>
      <label style="display:flex;justify-content:space-between;margin-bottom:8px;">Project name
        <input type="text" id="m-name" value="Untitled Figure" style="width:160px;">
      </label>
      <label style="display:flex;justify-content:space-between;margin-bottom:8px;">Width
        <input type="number" id="m-width" value="21" step="any" style="width:120px;">
      </label>
      <label style="display:flex;justify-content:space-between;margin-bottom:8px;">Height
        <input type="number" id="m-height" value="14.8" step="any" style="width:120px;">
      </label>
      <label style="display:flex;justify-content:space-between;margin-bottom:8px;">Unit
        <select id="m-unit" style="width:120px;">
          <option value="cm" selected>cm</option>
          <option value="in">inches</option>
          <option value="px">pixels</option>
        </select>
      </label>
      <label style="display:flex;justify-content:space-between;margin-bottom:8px;">DPI
        <input type="number" id="m-dpi" value="300" step="1" style="width:120px;">
      </label>
      <label style="display:flex;justify-content:space-between;margin-bottom:8px;">Pages
        <input type="number" id="m-pages" value="1" min="1" max="50" step="1" style="width:120px;">
      </label>
      <p id="m-error" class="storage-error" role="alert"></p>
      <div class="btn-row"><button id="m-cancel">Cancel</button><button id="m-ok">Create Document</button></div>
    </div>`;
  document.body.appendChild(backdrop);
  document.getElementById('m-ok').addEventListener('click', () => {
    const props = {
      name: document.getElementById('m-name').value.trim() || 'Untitled Figure',
      width: parseFloat(document.getElementById('m-width').value),
      height: parseFloat(document.getElementById('m-height').value),
      unit: document.getElementById('m-unit').value,
      dpi: parseInt(document.getElementById('m-dpi').value, 10),
      pages: Math.min(50, Math.max(1, parseInt(document.getElementById('m-pages').value, 10) || 1))
    };
    const pixels = MFC.docPropsToPixels(props);
    if (!Number.isFinite(pixels.width + pixels.height) || pixels.width < 1 || pixels.height < 1 || !(props.dpi > 0)) {
      document.getElementById('m-error').textContent = 'Enter a positive width, height, and DPI.'; return;
    }
    onConfirm(props).then(() => backdrop.remove()).catch(error => {
      document.getElementById('m-error').textContent = error.message;
    });
  });
  document.getElementById('m-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('keydown', event => { if (event.key === 'Escape') backdrop.remove(); });
  document.getElementById('m-name').focus();
}

/* About dialog: copyright, licence, and the AGPL section 13 offer of the running version's source. */
const FLUOFORGE_REPO = 'https://github.com/remybonnav/FluoForge';
function showAboutDialog() {
  if (document.querySelector('.about-backdrop')) return;
  const version = MFC.getAppVersion();
  const active = document.activeElement;
  const opener = active && active !== document.body ? active : document.getElementById('brand-about');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop about-backdrop';
  backdrop.innerHTML = `
    <div class="modal about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title" aria-describedby="about-licence">
      <h2 id="about-title"><img src="assets/FluoForge-app-icons/fluoforge-icon-small.svg" alt="">FluoForge</h2>
      <p class="about-dim">Version <span id="about-version"></span></p>
      <p>Copyright (C) 2026 Remy Bonnavion</p>
      <p id="about-licence">Licensed under the <a href="LICENSE" target="_blank" rel="noopener">GNU Affero General Public License v3.0 only</a>.</p>
      <p class="about-dim">FluoForge comes with ABSOLUTELY NO WARRANTY. You may redistribute and modify it under the terms of that licence.</p>
      <ul>
        <li><a id="about-source" target="_blank" rel="noopener">Source code</a></li>
        <li><a href="COMMERCIAL-LICENSE.md" target="_blank" rel="noopener">Commercial licence</a></li>
        <li><a href="THIRD-PARTY-NOTICES.md" target="_blank" rel="noopener">Third-party notices</a></li>
      </ul>
      <div class="btn-row"><button type="button" id="about-close">Close</button></div>
    </div>`;
  backdrop.querySelector('#about-version').textContent = 'v' + version;
  backdrop.querySelector('#about-source').href = FLUOFORGE_REPO + '/tree/v' + encodeURIComponent(version);
  const close = () => { backdrop.remove(); if (opener && opener.focus) opener.focus(); };
  backdrop.querySelector('#about-close').addEventListener('click', close);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    // Keep keyboard focus inside the dialog while it is open.
    const items = [...backdrop.querySelectorAll('a[href], button')];
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.body.appendChild(backdrop);
  backdrop.querySelector('#about-close').focus();
}

function syncDocPropsPanel(props) {
  document.getElementById('doc-name').value = props.name || 'Untitled Figure';
  document.getElementById('doc-width').value = props.width;
  document.getElementById('doc-height').value = props.height;
  document.getElementById('doc-unit').value = props.unit;
  document.getElementById('doc-dpi').value = props.dpi;
  updateDocPixelPreview();
  MFC_UI.refreshPageControls();
}

function updateDocPixelPreview() {
  const props = {
    width: parseFloat(document.getElementById('doc-width').value),
    height: parseFloat(document.getElementById('doc-height').value),
    unit: document.getElementById('doc-unit').value,
    dpi: parseInt(document.getElementById('doc-dpi').value, 10)
  };
  const px = MFC.docPropsToPixels(props);
  document.getElementById('doc-pixel-preview').textContent = `= ${px.width} × ${px.height} px at ${props.dpi} DPI`;
}

window.addEventListener('DOMContentLoaded', async () => {
  await document.fonts.load('24px "Liberation Sans"');
  MFC_UI.initInspector();
  MFC.init();
  document.getElementById('app-version').textContent = 'v' + MFC.getAppVersion();
  document.getElementById('doc-version-info').textContent = 'Created with v' + MFC.getAppVersion() + '.';
  document.getElementById('brand-about').addEventListener('click', showAboutDialog);
  MFC.refreshLayersPanel();

  syncDocPropsPanel(MFC.getDocProps());
  const createDocument = () => showDocPropsModal(async props => {
    await MFC_PROJECT.createProject(props);
    MFC_UI.focusPanel('panel-docprops', true);
  });
  document.getElementById('btn-new-document').addEventListener('click', createDocument);
  document.getElementById('empty-create-document').addEventListener('click', createDocument);
  document.getElementById('empty-open-project').addEventListener('click', () => MFC_PROJECT.pickAndLoadProject());

  MFC_AUTOSAVE.init();
  document.getElementById('btn-versions').addEventListener('click', MFC_PROJECT.showVersions);

  // ---- document properties panel ----
  document.getElementById('doc-name').addEventListener('input', (e) => MFC.setDocName(e.target.value));
  ['doc-width', 'doc-height', 'doc-unit', 'doc-dpi'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateDocPixelPreview);
  });
  document.getElementById('doc-apply').addEventListener('click', () => {
    const props = {
      ...MFC.getDocProps(), // keeps other document fields, such as dismissed figure checks
      name: document.getElementById('doc-name').value.trim() || 'Untitled Figure',
      width: parseFloat(document.getElementById('doc-width').value),
      height: parseFloat(document.getElementById('doc-height').value),
      unit: document.getElementById('doc-unit').value,
      dpi: parseInt(document.getElementById('doc-dpi').value, 10),
      pages: MFC.pageCount()
    };
    MFC.applyDocProps(props);
    MFC.pushHistory();
  });
  document.getElementById('doc-add-page').addEventListener('click', () => MFC.addPage());
  document.getElementById('btn-add-page').addEventListener('click', () => MFC.addPage());
  document.getElementById('doc-remove-page').addEventListener('click', () => MFC.removeLastPage());
  document.getElementById('page-nav').addEventListener('change', e => MFC.scrollToPage(parseInt(e.target.value, 10) || 0));

  // Closing or reloading the tab with unsaved work asks for confirmation (the browser
  // shows its own "Leave site?" dialog; recovery drafts are a fallback, not a save).
  window.addEventListener('beforeunload', event => {
    if (!MFC_PROJECT.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  document.getElementById('btn-docprops').addEventListener('click', () => {
    MFC_UI.focusPanel('panel-docprops', true);
  });

  // ---- toolbar tools ----
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => MFC.setTool(btn.dataset.tool));
  });

  // ---- undo/redo ----
  document.getElementById('btn-duplicate').addEventListener('click', MFC.duplicateSelection);
  document.getElementById('btn-undo').addEventListener('click', MFC.undo);
  document.getElementById('btn-redo').addEventListener('click', MFC.redo);

  // ---- import ----
  const fileInput = document.getElementById('file-input');
  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => { MFC.importFiles(e.target.files); fileInput.value = ''; });

  const canvasWrap = document.getElementById('canvas-wrap');
  const dropHint = document.getElementById('drop-hint');
  ['dragenter', 'dragover'].forEach(evt => canvasWrap.addEventListener(evt, (e) => {
    e.preventDefault(); dropHint.classList.remove('hidden');
  }));
  ['dragleave', 'drop'].forEach(evt => canvasWrap.addEventListener(evt, (e) => {
    e.preventDefault(); dropHint.classList.add('hidden');
  }));
  canvasWrap.addEventListener('drop', (e) => {
    if (!MFC.hasDocument) { MFC_UI.toast('Create or open a figure first.'); return; }
    if (e.dataTransfer.files && e.dataTransfer.files.length) MFC.importFiles(e.dataTransfer.files);
  });

  // ---- export menu ----
  const exportBtn = document.getElementById('btn-export');
  const exportMenu = document.getElementById('export-menu');
  exportBtn.addEventListener('click', () => exportMenu.classList.toggle('hidden'));
  document.addEventListener('click', (e) => {
    if (!exportBtn.contains(e.target) && !exportMenu.contains(e.target)) exportMenu.classList.add('hidden');
  });
  exportMenu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    exportMenu.classList.add('hidden');
    if (b.dataset.export === 'tiff') MFC_EXPORT.exportTIFF();
    if (b.dataset.export === 'svg') MFC_EXPORT.exportSVG();
    if (b.dataset.export === 'pdf') MFC_EXPORT.exportPDF();
    if (b.dataset.export === 'png') MFC_EXPORT.exportPNG();
    if (b.dataset.export === 'dialog') import(new URL('js/ui/export-dialog.js', document.baseURI).href).then(m => m.showExportDialog());
    if (b.dataset.export === 'copy') import(new URL('js/ui/copy-external.js', document.baseURI).href).then(m => m.showCopyDialog());
    if (b.dataset.export === 'panels') import(new URL('js/ui/export-panels.js', document.baseURI).href).then(m => m.exportPanels());
    if (b.dataset.export === 'report') import(new URL('js/ui/figure-report.js', document.baseURI).href).then(m => m.showReportDialog());
  }));

  // ---- project save/load ----
  // "Save Project": first time this session it prompts for a location (on
  // browsers that support the File System Access API); every click after
  // that overwrites the same file directly — fast, no new download each time.
  document.getElementById('btn-save-project').addEventListener('click', () => MFC_PROJECT.saveProject(false));

  // "Save As": always prompts for a new file/location and switches future
  // "Save Project" clicks to target that new file.
  const saveAsBtn = document.getElementById('btn-save-project-as');
  if (saveAsBtn) saveAsBtn.addEventListener('click', () => MFC_PROJECT.saveProject(true));

  // "Load Project": tries the native file picker (and remembers the picked
  // file so Save Project overwrites it going forward); falls back to the
  // plain <input type="file"> below on browsers without that API.
  const projInput = document.getElementById('project-input');
  document.getElementById('btn-load-project').addEventListener('click', () => MFC_PROJECT.pickAndLoadProject());
  projInput.addEventListener('change', (e) => {
    if (e.target.files[0]) MFC_PROJECT.loadProject(e.target.files[0]).catch(error => MFC_UI.toast(error.message));
    projInput.value = '';
  });

  // ---- crop panel ----
  document.getElementById('crop-width').addEventListener('input', () => MFC.applyCropFieldsToRect());
  document.getElementById('crop-height').addEventListener('input', () => MFC.applyCropFieldsToRect());
  document.getElementById('crop-mode-rect').addEventListener('click', () => MFC.setCropAspectMode('rect'));
  document.getElementById('crop-mode-square').addEventListener('click', () => MFC.setCropAspectMode('square'));

  // ---- shape panel ----
  document.querySelectorAll('[data-shape-kind]').forEach(b => b.addEventListener('click', () => MFC.setShapeKind(b.dataset.shapeKind)));
  document.getElementById('shape-mode-rect').addEventListener('click', () => MFC.setShapeAspectMode('rect'));
  document.getElementById('inset-mode-square').addEventListener('click', () => MFC.setInsetAspectMode('square'));
  document.getElementById('inset-mode-rect').addEventListener('click', () => MFC.setInsetAspectMode('rect'));
  document.getElementById('inset-create').addEventListener('click', () => {
    const active = MFC.getCanvas().getActiveObject();
    if (active) MFC.createInsetFromContour(active);
  });
  MFC.loadInsetSizePreferences();
  ['inset-fixed-size', 'inset-fixed-w', 'inset-fixed-h', 'inset-magnification'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => MFC.saveInsetSizePreferences());
  });
  document.getElementById('inset-apply-size').addEventListener('click', () => MFC.applyExactSizeToSelectedContour());
  ['inset-stroke-color', 'inset-stroke-width', 'inset-dash'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => MFC.applyInsetContourStyle(id));
    document.getElementById(id).addEventListener('change', () => MFC.applyInsetContourStyle(id));
  });
  document.getElementById('shape-mode-square').addEventListener('click', () => MFC.setShapeAspectMode('square'));
  ['shape-stroke-color', 'shape-stroke-width', 'shape-dash', 'shape-fill-enabled', 'shape-fill-color'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => MFC.applyShapeStyle(id));
    document.getElementById(id).addEventListener('change', () => MFC.applyShapeStyle(id));
  });
  document.getElementById('path-mode-straight').addEventListener('click', () => MFC.setPathDefaultMode('straight'));
  document.getElementById('path-mode-bezier').addEventListener('click', () => MFC.setPathDefaultMode('bezier'));
  ['path-stroke-color','path-stroke-width','path-opacity','path-dash','path-line-cap','path-line-join','path-arrow-start','path-arrow-end'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => MFC.applyPathStyle(id));
    document.getElementById(id).addEventListener('change', () => MFC.applyPathStyle(id));
  });
  document.getElementById('path-edit-nodes').addEventListener('click', () => {
    const active=MFC.getCanvas().getActiveObject();
    if(active?.__mfcNodeEdit)MFC.exitPathEdit(active);else MFC.enterPathEdit(active);
  });
  document.getElementById('path-edit-done').addEventListener('click', () => MFC.exitPathEdit());
  document.getElementById('path-close-toggle').addEventListener('click', () => MFC.togglePathClosed());
  document.getElementById('path-node-corner').addEventListener('click', () => MFC.setSelectedNodeType('corner'));
  document.getElementById('path-node-smooth').addEventListener('click', () => MFC.setSelectedNodeType('smooth'));
  document.getElementById('path-node-delete').addEventListener('click', () => MFC.deleteSelectedPathNode());
  document.getElementById('path-segment-line').addEventListener('click', () => MFC.setSelectedIncomingSegment(false));
  document.getElementById('path-segment-curve').addEventListener('click', () => MFC.setSelectedIncomingSegment(true));
  document.getElementById('crop-apply').addEventListener('click', () => {
    MFC.applyCrop();
    MFC.setTool('select');
  });
  document.getElementById('crop-cancel').addEventListener('click', () => MFC.setTool('select'));

  // ---- object size panel ----
  document.getElementById('obj-width').addEventListener('change', () => MFC.applyObjectSizeFromFields('width'));
  document.getElementById('obj-height').addEventListener('change', () => MFC.applyObjectSizeFromFields('height'));
  document.getElementById('obj-x').addEventListener('change', () => MFC.applyObjectPositionFromFields());
  document.getElementById('obj-y').addEventListener('change', () => MFC.applyObjectPositionFromFields());
  document.querySelectorAll('#selection-bar input[type=number]').forEach(input => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  });
  document.getElementById('obj-position-lock').addEventListener('click', () => MFC.togglePositionLockSelection());
  document.getElementById('obj-angle').addEventListener('change', (e) => MFC.setObjectAngle(parseFloat(e.target.value) || 0));
  document.getElementById('obj-rotate-ccw').addEventListener('click', () => MFC.rotateSelected(-90));
  document.getElementById('obj-rotate-cw').addEventListener('click', () => MFC.rotateSelected(90));
  document.getElementById('obj-uncrop').addEventListener('click', () => {
    const active = MFC.getCanvas().getActiveObject();
    if (active) MFC.uncropImage(active);
  });

  // ---- scale bar panel ----
  document.getElementById('sb-place-corner').addEventListener('click', () => {
    const corner = document.getElementById('sb-corner').value;
    const margin = parseFloat(document.getElementById('sb-margin').value) || 5;
    MFC.placeScaleBarAtCorner(corner, margin);
  });
  document.getElementById('sb-place-corner-multi').addEventListener('click', () => {
    const corner = document.getElementById('sb-corner').value;
    const margin = parseFloat(document.getElementById('sb-margin').value) || 5;
    MFC.placeScaleBarOnSelectedImages(corner, margin);
  });
  // Typing previews a new bar; a committed change (change event) edits the selected bars.
  [['sb-length','length'],['sb-thickness','thickness'],['sb-color','color'],['sb-showlabel','label'],['sb-corner','corner'],['sb-margin','margin']].forEach(([id, field]) => {
    document.getElementById(id).addEventListener('input', () => MFC.onScaleBarFieldChanged(field, false));
    document.getElementById(id).addEventListener('change', () => MFC.onScaleBarFieldChanged(field, true));
  });
  document.getElementById('sb-ref-image').addEventListener('change', () => MFC.onScaleBarFieldChanged('ref', false));

  // ---- channel panel: calibration / alpha / tone (brightness+contrast) ----
  document.getElementById('ch-pixelsize').addEventListener('change', (e) => MFC.applyPixelSize(e.target.value));
  document.getElementById('ch-pixelsize').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  document.getElementById('ch-alpha-toggle').addEventListener('change', (e) => MFC.applyAlphaToggle(e.target.checked));

  // ---- channel panel: Z stack / time series plane ----
  document.getElementById('ch-zmode').addEventListener('change', (e) => MFC.applyStackPlane({ zMode: e.target.value }, true));
  [['ch-zslice', 'zIndex'], ['ch-tframe', 'tIndex']].forEach(([id, key]) => {
    const slider = document.getElementById(id), input = document.getElementById(id + '-val');
    slider.addEventListener('input', () => MFC.applyStackPlane({ [key]: parseInt(slider.value, 10) - 1 }, false));
    slider.addEventListener('change', () => MFC.applyStackPlane({ [key]: parseInt(slider.value, 10) - 1 }, true));
    input.addEventListener('change', () => MFC.applyStackPlane({ [key]: parseInt(input.value, 10) - 1 }, true));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  });

  function readToneValues() {
    return {
      brightness: parseFloat(document.getElementById('ch-brightness-val').value),
      contrast: parseFloat(document.getElementById('ch-contrast-val').value)
    };
  }
  document.getElementById('ch-brightness').addEventListener('input', (e) => {
    MFC.applyBrightnessContrast(parseFloat(e.target.value), readToneValues().contrast);
  });
  document.getElementById('ch-contrast').addEventListener('input', (e) => {
    MFC.applyBrightnessContrast(readToneValues().brightness, parseFloat(e.target.value));
  });
  document.getElementById('ch-brightness-val').addEventListener('change', (e) => {
    MFC.applyBrightnessContrast(parseFloat(e.target.value), readToneValues().contrast);
    MFC.commitBrightnessContrast();
  });
  document.getElementById('ch-contrast-val').addEventListener('change', (e) => {
    MFC.applyBrightnessContrast(readToneValues().brightness, parseFloat(e.target.value));
    MFC.commitBrightnessContrast();
  });
  ['ch-brightness', 'ch-contrast'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => MFC.commitBrightnessContrast());
  });
  ['ch-brightness-val', 'ch-contrast-val'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  });
  document.getElementById('ch-tone-reset').addEventListener('click', () => MFC.resetToneCurve());

  // ---- text panel ----
  document.getElementById('text-font').addEventListener('change', async (e) => {
    await document.fonts.load('24px "' + e.target.value + '"');
    MFC.applyTextStyle('fontFamily', e.target.value);
  });
  document.getElementById('text-size').addEventListener('change', (e) => MFC.applyTextStyle('fontSize', parseInt(e.target.value, 10)));
  document.getElementById('text-color').addEventListener('input', (e) => MFC.applyTextStyle('fill', e.target.value));
  document.getElementById('text-bg-enabled').addEventListener('change', (e) => {
    MFC.applyTextStyle('backgroundColor', e.target.checked ? document.getElementById('text-bg-color').value : '');
  });
  document.getElementById('text-bg-color').addEventListener('input', (e) => {
    if (document.getElementById('text-bg-enabled').checked) MFC.applyTextStyle('backgroundColor', e.target.value);
  });
  document.getElementById('text-border-enabled').addEventListener('change', (e) => {
    MFC.applyTextBorder('mfcBorderWidth', e.target.checked ? (parseFloat(document.getElementById('text-border-width').value) || 2) : 0);
  });
  document.getElementById('text-border-width').addEventListener('input', (e) => {
    if (document.getElementById('text-border-enabled').checked) MFC.applyTextBorder('mfcBorderWidth', parseFloat(e.target.value) || 0);
  });
  document.getElementById('text-border-color').addEventListener('input', (e) => MFC.applyTextBorder('mfcBorderColor', e.target.value));
  document.getElementById('text-bold').addEventListener('click', (e) => {
    e.target.classList.toggle('active');
    MFC.applyTextStyle('fontWeight', e.target.classList.contains('active') ? 'bold' : 'normal');
  });
  document.getElementById('text-italic').addEventListener('click', (e) => {
    e.target.classList.toggle('active');
    MFC.applyTextStyle('fontStyle', e.target.classList.contains('active') ? 'italic' : 'normal');
  });
  document.getElementById('text-underline').addEventListener('click', (e) => {
    e.target.classList.toggle('active');
    MFC.applyTextStyle('underline', e.target.classList.contains('active'));
  });
  ['left', 'center', 'right'].forEach(a => {
    document.getElementById('text-align-' + a).addEventListener('click', () => MFC.applyTextAlign(a));
  });
  ['top', 'middle', 'bottom'].forEach(a => {
    document.getElementById('text-valign-' + a).addEventListener('click', () => MFC.applyTextVerticalAlign(a));
  });
  document.getElementById('text-center-both').addEventListener('click', () => MFC.centerTextInBox());

  // ---- grid layout panel ----
  document.getElementById('btn-grid').addEventListener('click', () => {
    document.getElementById('panel-grid').classList.remove('hidden');
    MFC_UI.focusPanel('panel-grid', true);
  });
  // Its fields and buttons: js/layout/grid-panel.js.

  // ---- zoom (canvas, not page) ----
  document.getElementById('zoom-in').addEventListener('click', () => MFC.zoomIn());
  document.getElementById('zoom-out').addEventListener('click', () => MFC.zoomOut());
  document.getElementById('zoom-reset').addEventListener('click', () => MFC.zoomReset());
  document.getElementById('zoom-selection').addEventListener('click', () => MFC.zoomToSelection());
  MFC.updateZoomDisplay();

  // ---- alignment bar ----
  document.querySelectorAll('#selection-bar button[data-align]').forEach(b => {
    b.addEventListener('click', () => MFC.align(b.dataset.align));
  });
  document.getElementById('btn-group').addEventListener('click', () => MFC.groupSelection());
  document.getElementById('btn-crop-shape').addEventListener('click', () => MFC.cropToShape());
  document.getElementById('obj-release-clip').addEventListener('click', () => MFC.releaseShapeCrop());
  document.getElementById('btn-ungroup').addEventListener('click', () => MFC.ungroupSelection());
  document.getElementById('layers-show-all').addEventListener('click', () => MFC.setAllLayersVisible(true));
  document.getElementById('layers-hide-all').addEventListener('click', () => MFC.setAllLayersVisible(false));

  // ---- keyboard shortcuts ----
  window.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (!MFC.hasDocument || document.querySelector('.modal-backdrop')) return;
    if (MFC.handlePathKey(e)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); MFC.undo(); }
    else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); MFC.redo(); }
    else if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); MFC.duplicateSelection(); }
    else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); import(new URL('js/ui/copy-external.js', document.baseURI).href).then(m => m.showCopyDialog()); }
    else if (ctrl && e.key.toLowerCase() === 'c') { MFC.copySelection(); }
    else if (ctrl && e.key.toLowerCase() === 'v') { MFC.pasteSelection(); }
    else if (ctrl && e.key.toLowerCase() === 'g' && e.shiftKey) { e.preventDefault(); MFC.ungroupSelection(); }
    else if (ctrl && e.key.toLowerCase() === 'g') { e.preventDefault(); MFC.groupSelection(); }
    else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); MFC_PROJECT.saveProject(false); }
    else if (e.key.toLowerCase() === 'v') { MFC.setTool('select'); }
    else if (e.key.toLowerCase() === 'c') { MFC.setTool('crop'); }
    else if (e.key.toLowerCase() === 't') { MFC.setTool('text'); }
    else if (e.key.toLowerCase() === 's' && !ctrl) { MFC.setTool('scalebar'); }
    else if (e.key.toLowerCase() === 'r' && !ctrl) { MFC.setTool('shape'); }
    else if (e.key.toLowerCase() === 'p' && !ctrl) { MFC.setTool('path'); }
    else if (e.key.toLowerCase() === 'i' && !ctrl) { MFC.setTool('inset'); }
    else if (e.key.toLowerCase() === 'l' && !ctrl) { MFC.setTool('legend'); }
    else if (!ctrl && (e.key === '+' || e.key === '=')) { e.preventDefault(); MFC.zoomIn(); }
    else if (!ctrl && (e.key === '-' || e.key === '_')) { e.preventDefault(); MFC.zoomOut(); }
    else if (!ctrl && e.key === '0') { MFC.zoomReset(); }
    else if (!ctrl && e.shiftKey && (e.key === '@' || e.code === 'Digit2')) { e.preventDefault(); MFC.zoomToSelection(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = MFC.getCanvas().getActiveObjects().filter(o => !o.mfcLocked);
      if (active.length) { active.forEach(o => MFC.getCanvas().remove(o)); MFC.getCanvas().discardActiveObject(); MFC.getCanvas().requestRenderAll(); MFC.pushHistory(); }
    }
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      if (!MFC.getCanvas().getActiveObject()) return; // let arrows do nothing (not scroll-hijack) with no selection
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      // Snap only for single-px nudges — with Shift's coarser 10px step the user is
      // clearly going for a specific offset, so snapping there would fight the input.
      MFC.nudgeSelection(dx, dy, !e.shiftKey);
    }
  });

  // ---- color palette swatches (quick-pick row under every color input) ----
  attachColorPalettesToAllInputs();
});

function attachColorPalettesToAllInputs() {
  const NORMAL = ['#e6194b', '#f58231', '#ffe119', '#3cb44b', '#46f0f0', '#4363d8', '#911eb4', '#f032e6', '#000000', '#ffffff'];
  const PASTEL = ['#ffb3ba', '#ffdfba', '#ffffba', '#baffc9', '#bae1ff', '#d5baff', '#e8d5c4', '#d0d0d0'];
  const DARK = ['#8f3049', '#8f5329', '#72621f', '#315f4c', '#275b69', '#3f4e87', '#604a78', '#493d45'];
  const GRAYS = ['#f4f4f4', '#d0d0d0', '#a0a0a0', '#707070', '#484848', '#242424'];
  // Pure ImageJ channel colors first, so fluorescence annotations can match LUTs exactly.
  const IMAGEJ = [['#FF0000', 'Red'], ['#00FF00', 'Green'], ['#0000FF', 'Blue'], ['#FF00FF', 'Magenta'], ['#00FFFF', 'Cyan'], ['#FFFF00', 'Yellow']];
  const PALETTE = [...IMAGEJ, null, ...NORMAL, ...PASTEL, ...DARK, ...GRAYS];

  ['text-color', 'text-bg-color', 'text-border-color', 'shape-stroke-color', 'shape-fill-color', 'path-stroke-color', 'sb-color', 'inset-stroke-color', 'legend-border-color'].forEach(id => {
    const input = document.getElementById(id);
    if (input) attachColorPalette(input, PALETTE);
  });
}

function attachColorPalette(input, colors) {
  const row = document.createElement('div');
  row.className = 'color-palette';
  colors.forEach(entry => {
    if (entry === null) { const br = document.createElement('span'); br.className = 'palette-break'; row.appendChild(br); return; }
    const [c, name] = Array.isArray(entry) ? entry : [entry, ''];
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.title = name ? `${name} ${c} (ImageJ)` : c;
    if (name) b.dataset.imagej = name.toLowerCase();
    b.addEventListener('click', () => {
      input.value = c.toLowerCase();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    row.appendChild(b);
  });
  const anchor = input.closest('label') || input;
  anchor.insertAdjacentElement('afterend', row);
}

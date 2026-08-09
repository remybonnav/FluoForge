/*
 * main.js — app bootstrap & UI wiring
 */

const MFC_UI = (function () {
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

  return { toast, showSavingDialog, hideSavingDialog };
})();

function showDocPropsModal(onConfirm) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h2>Document Properties</h2>
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
      <div class="btn-row"><button id="m-ok">Create Document</button></div>
    </div>`;
  document.body.appendChild(backdrop);
  document.getElementById('m-ok').addEventListener('click', () => {
    const props = {
      name: document.getElementById('m-name').value.trim() || 'Untitled Figure',
      width: parseFloat(document.getElementById('m-width').value),
      height: parseFloat(document.getElementById('m-height').value),
      unit: document.getElementById('m-unit').value,
      dpi: parseInt(document.getElementById('m-dpi').value, 10)
    };
    document.body.removeChild(backdrop);
    onConfirm(props);
  });
}

function syncDocPropsPanel(props) {
  document.getElementById('doc-name').value = props.name || 'Untitled Figure';
  document.getElementById('doc-width').value = props.width;
  document.getElementById('doc-height').value = props.height;
  document.getElementById('doc-unit').value = props.unit;
  document.getElementById('doc-dpi').value = props.dpi;
  updateDocPixelPreview();
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

window.addEventListener('DOMContentLoaded', () => {
  MFC.init();
  document.getElementById('app-version').textContent = 'v' + MFC.getAppVersion();
  document.getElementById('doc-version-info').textContent = 'Created with v' + MFC.getAppVersion() + '.';

  showDocPropsModal((props) => {
    MFC.applyDocProps(props);
    syncDocPropsPanel(props);
  });

  // ---- document properties panel ----
  document.getElementById('doc-name').addEventListener('input', (e) => MFC.setDocName(e.target.value));
  ['doc-width', 'doc-height', 'doc-unit', 'doc-dpi'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateDocPixelPreview);
  });
  document.getElementById('doc-apply').addEventListener('click', () => {
    const props = {
      name: document.getElementById('doc-name').value.trim() || 'Untitled Figure',
      width: parseFloat(document.getElementById('doc-width').value),
      height: parseFloat(document.getElementById('doc-height').value),
      unit: document.getElementById('doc-unit').value,
      dpi: parseInt(document.getElementById('doc-dpi').value, 10)
    };
    MFC.applyDocProps(props);
  });
  document.getElementById('btn-docprops').addEventListener('click', () => {
    document.getElementById('panel-docprops').scrollIntoView({ behavior: 'smooth' });
  });

  // ---- toolbar tools ----
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => MFC.setTool(btn.dataset.tool));
  });

  // ---- undo/redo ----
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
  }));

  // ---- project save/load ----
  // "Save Project": first time this session it prompts for a location (on
  // browsers that support the File System Access API); every click after
  // that overwrites the same file directly — fast, no new download each time.
  document.getElementById('btn-save-project').addEventListener('click', () => MFC_EXPORT.saveProject(false));

  // "Save As": always prompts for a new file/location and switches future
  // "Save Project" clicks to target that new file.
  const saveAsBtn = document.getElementById('btn-save-project-as');
  if (saveAsBtn) saveAsBtn.addEventListener('click', () => MFC_EXPORT.saveProject(true));

  // "Load Project": tries the native file picker (and remembers the picked
  // file so Save Project overwrites it going forward); falls back to the
  // plain <input type="file"> below on browsers without that API.
  const projInput = document.getElementById('project-input');
  document.getElementById('btn-load-project').addEventListener('click', () => MFC_EXPORT.pickAndLoadProject());
  projInput.addEventListener('change', (e) => {
    if (e.target.files[0]) MFC_EXPORT.loadProject(e.target.files[0]);
    projInput.value = '';
  });

  // ---- crop panel ----
  document.getElementById('crop-width').addEventListener('input', () => MFC.applyCropFieldsToRect());
  document.getElementById('crop-height').addEventListener('input', () => MFC.applyCropFieldsToRect());
  document.getElementById('crop-mode-rect').addEventListener('click', () => MFC.setCropAspectMode('rect'));
  document.getElementById('crop-mode-square').addEventListener('click', () => MFC.setCropAspectMode('square'));

  // ---- shape panel ----
  document.getElementById('shape-mode-rect').addEventListener('click', () => MFC.setShapeAspectMode('rect'));
  document.getElementById('inset-mode-square').addEventListener('click', () => MFC.setInsetAspectMode('square'));
  document.getElementById('inset-mode-rect').addEventListener('click', () => MFC.setInsetAspectMode('rect'));
  document.getElementById('inset-create').addEventListener('click', () => {
    const active = MFC.getCanvas().getActiveObject();
    if (active) MFC.createInsetFromContour(active);
  });
  ['inset-stroke-color', 'inset-stroke-width', 'inset-dash'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => MFC.applyInsetContourStyle());
    document.getElementById(id).addEventListener('change', () => MFC.applyInsetContourStyle());
  });
  document.getElementById('shape-mode-square').addEventListener('click', () => MFC.setShapeAspectMode('square'));
  ['shape-stroke-color', 'shape-stroke-width', 'shape-dash', 'shape-fill-enabled', 'shape-fill-color'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => MFC.applyShapeStyle());
    document.getElementById(id).addEventListener('change', () => MFC.applyShapeStyle());
  });
  document.getElementById('crop-apply').addEventListener('click', () => {
    MFC.applyCrop();
    MFC.setTool('select');
  });
  document.getElementById('crop-cancel').addEventListener('click', () => MFC.setTool('select'));

  // ---- object size panel ----
  document.getElementById('obj-width').addEventListener('change', () => MFC.applyObjectSizeFromFields());
  document.getElementById('obj-height').addEventListener('change', () => MFC.applyObjectSizeFromFields());
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

  // ---- channel panel: calibration / alpha / tone (brightness+contrast) ----
  document.getElementById('ch-pixelsize').addEventListener('change', (e) => MFC.applyPixelSize(e.target.value));
  document.getElementById('ch-pixelsize').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  document.getElementById('ch-alpha-toggle').addEventListener('change', (e) => MFC.applyAlphaToggle(e.target.checked));

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
  document.getElementById('text-font').addEventListener('change', (e) => MFC.applyTextStyle('fontFamily', e.target.value));
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
  document.getElementById('text-width').addEventListener('change', (e) => MFC.applyTextBoxSize('width', parseFloat(e.target.value)));
  document.getElementById('text-height').addEventListener('change', (e) => MFC.applyTextBoxSize('height', parseFloat(e.target.value)));

  // ---- grid layout panel ----
  document.getElementById('btn-grid').addEventListener('click', () => {
    document.getElementById('panel-grid').classList.remove('hidden');
    document.getElementById('panel-grid').scrollIntoView({ behavior: 'smooth' });
  });
  document.getElementById('grid-cancel').addEventListener('click', () => document.getElementById('panel-grid').classList.add('hidden'));
  document.getElementById('grid-arrange').addEventListener('click', () => {
    MFC.arrangeGrid({
      rows: parseInt(document.getElementById('grid-rows').value, 10) || 1,
      cols: parseInt(document.getElementById('grid-cols').value, 10) || 1,
      cellW: parseFloat(document.getElementById('grid-cellw').value) || 300,
      cellH: parseFloat(document.getElementById('grid-cellh').value) || 300,
      gap: parseFloat(document.getElementById('grid-gap').value) || 16,
      headerRow: document.getElementById('grid-header-row').checked,
      headerCol: document.getElementById('grid-header-col').checked
    });
  });

  // ---- zoom (canvas, not page) ----
  document.getElementById('zoom-in').addEventListener('click', () => MFC.zoomIn());
  document.getElementById('zoom-out').addEventListener('click', () => MFC.zoomOut());
  document.getElementById('zoom-reset').addEventListener('click', () => MFC.zoomReset());
  MFC.updateZoomDisplay();

  // ---- alignment bar ----
  document.querySelectorAll('#align-bar button').forEach(b => {
    b.addEventListener('click', () => MFC.align(b.dataset.align));
  });

  // ---- keyboard shortcuts ----
  window.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); MFC.undo(); }
    else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); MFC.redo(); }
    else if (ctrl && e.key.toLowerCase() === 'c') { MFC.copySelection(); }
    else if (ctrl && e.key.toLowerCase() === 'v') { MFC.pasteSelection(); }
    else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); MFC_EXPORT.saveProject(false); }
    else if (e.key.toLowerCase() === 'v') { MFC.setTool('select'); }
    else if (e.key.toLowerCase() === 'c') { MFC.setTool('crop'); }
    else if (e.key.toLowerCase() === 't') { MFC.setTool('text'); }
    else if (e.key.toLowerCase() === 's' && !ctrl) { MFC.setTool('scalebar'); }
    else if (e.key.toLowerCase() === 'r' && !ctrl) { MFC.setTool('shape'); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = MFC.getCanvas().getActiveObjects();
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
  const PALETTE = [...NORMAL, ...PASTEL];

  ['text-color', 'text-bg-color', 'text-border-color', 'shape-stroke-color', 'shape-fill-color', 'sb-color', 'inset-stroke-color'].forEach(id => {
    const input = document.getElementById(id);
    if (input) attachColorPalette(input, PALETTE);
  });
}

function attachColorPalette(input, colors) {
  const row = document.createElement('div');
  row.className = 'color-palette';
  colors.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => {
      input.value = c;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    row.appendChild(b);
  });
  const anchor = input.closest('label') || input;
  anchor.insertAdjacentElement('afterend', row);
}
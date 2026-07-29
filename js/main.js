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
  return { toast };
})();

function showDocPropsModal(onConfirm) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h2>Document Properties</h2>
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

  showDocPropsModal((props) => {
    MFC.applyDocProps(props);
    syncDocPropsPanel(props);
  });

  // ---- document properties panel ----
  ['doc-width', 'doc-height', 'doc-unit', 'doc-dpi'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateDocPixelPreview);
  });
  document.getElementById('doc-apply').addEventListener('click', () => {
    const props = {
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
  document.getElementById('btn-save-project').addEventListener('click', () => MFC_EXPORT.saveProject());
  const projInput = document.getElementById('project-input');
  document.getElementById('btn-load-project').addEventListener('click', () => projInput.click());
  projInput.addEventListener('change', (e) => {
    if (e.target.files[0]) MFC_EXPORT.loadProject(e.target.files[0]);
    projInput.value = '';
  });

  // ---- crop panel ----
  document.getElementById('crop-width').addEventListener('input', () => MFC.applyCropFieldsToRect());
  document.getElementById('crop-height').addEventListener('input', () => MFC.applyCropFieldsToRect());
  document.getElementById('crop-mode-rect').addEventListener('click', () => MFC.setCropAspectMode('rect'));
  document.getElementById('crop-mode-square').addEventListener('click', () => MFC.setCropAspectMode('square'));
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

  // ---- scale bar panel ----
  document.getElementById('sb-place').addEventListener('click', () => MFC.armScaleBar());
  document.getElementById('sb-place-corner').addEventListener('click', () => {
    const corner = document.getElementById('sb-corner').value;
    const margin = parseFloat(document.getElementById('sb-margin').value) || 5;
    MFC.placeScaleBarAtCorner(corner, margin);
  });

  // ---- text panel ----
  document.getElementById('text-font').addEventListener('change', (e) => MFC.applyTextStyle('fontFamily', e.target.value));
  document.getElementById('text-size').addEventListener('change', (e) => MFC.applyTextStyle('fontSize', parseInt(e.target.value, 10)));
  document.getElementById('text-color').addEventListener('input', (e) => MFC.applyTextStyle('fill', e.target.value));
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
    else if (e.key.toLowerCase() === 'v') { MFC.setTool('select'); }
    else if (e.key.toLowerCase() === 'c') { MFC.setTool('crop'); }
    else if (e.key.toLowerCase() === 't') { MFC.setTool('text'); }
    else if (e.key.toLowerCase() === 's' && !ctrl) { MFC.setTool('scalebar'); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = MFC.getCanvas().getActiveObjects();
      if (active.length) { active.forEach(o => MFC.getCanvas().remove(o)); MFC.getCanvas().discardActiveObject(); MFC.getCanvas().requestRenderAll(); MFC.pushHistory(); }
    }
  });
});

/*
 * export.js
 * -----------------------------------------------------------------------
 * TIFF (via UTIF.js encode), SVG (via fabric's native toSVG, which already
 * embeds raster layers as base64 PNG and renders text/shapes as true
 * vector elements), and PDF (via jsPDF) export.
 *
 * Also: Project save/load as JSON. Original TIFF bytes are embedded as
 * base64 so a reloaded project remains fully re-editable at full bit depth
 * (channel toggles / colors / contrast are not baked in).
 * -----------------------------------------------------------------------
 */

const MFC_EXPORT = (function () {

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** Render the full document at full DPI to a data URL, regardless of the current on-screen zoom. */
  function renderFullResCanvas() {
    const canvas = MFC.getCanvas();
    const docProps = MFC.getDocProps();
    const pxAtDpi = MFC.docPropsToPixels(docProps); // target output size, defined by the doc's DPI — independent of on-screen zoom

    const prevZoom = MFC.getZoomLevel();
    MFC.setZoom(1); // canvas element now matches pxAtDpi exactly (see canvas-app.js setZoom)
    const dataURL = canvas.toDataURL({ format: 'png', multiplier: 1 });
    MFC.setZoom(prevZoom); // restore whatever the user was looking at

    return { dataURL, width: pxAtDpi.width, height: pxAtDpi.height };
  }

  async function exportTIFF() {
    const { dataURL, width, height } = renderFullResCanvas();
    const img = await loadImage(dataURL);
    const off = document.createElement('canvas');
    off.width = width; off.height = height;
    const ctx = off.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);

    const rgba = imgData.data; // Uint8ClampedArray RGBA
    const tiffBytes = UTIF.encodeImage(rgba, width, height);
    const blob = new Blob([tiffBytes], { type: 'image/tiff' });
    download(blob, 'figure_export.tiff');
    MFC_UI.toast('TIFF exported.');
  }

  function exportSVG() {
    const canvas = MFC.getCanvas();
    const prevZoom = MFC.getZoomLevel();
    MFC.setZoom(1);
    const svgStr = canvas.toSVG();
    MFC.setZoom(prevZoom);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    download(blob, 'figure_export.svg');
    MFC_UI.toast('SVG exported.');
  }

  async function exportPDF() {
    const docProps = MFC.getDocProps();
    const { dataURL, width, height } = renderFullResCanvas();
    const { jsPDF } = window.jspdf;

    // convert document size to mm for the PDF page
    let widthMm, heightMm;
    if (docProps.unit === 'cm') { widthMm = docProps.width * 10; heightMm = docProps.height * 10; }
    else if (docProps.unit === 'in') { widthMm = docProps.width * 25.4; heightMm = docProps.height * 25.4; }
    else { widthMm = (docProps.width / docProps.dpi) * 25.4; heightMm = (docProps.height / docProps.dpi) * 25.4; }

    const pdf = new jsPDF({
      orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
      unit: 'mm', format: [widthMm, heightMm]
    });
    pdf.addImage(dataURL, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST');
    pdf.save('figure_export.pdf');
    MFC_UI.toast('PDF exported.');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // ---------------- Project save/load ----------------

  function saveProject() {
    const canvas = MFC.getCanvas();
    const registry = MFC.getRegistry();
    const docProps = MFC.getDocProps();

    const objects = canvas.getObjects().map(o => {
      const common = {
        mfcId: o.mfcId, mfcType: o.mfcType || o.type,
        left: o.left, top: o.top, scaleX: o.scaleX, scaleY: o.scaleY,
        angle: o.angle, width: o.width, height: o.height,
        cropX: o.cropX || 0, cropY: o.cropY || 0
      };
      if (o.mfcType === 'mfcImage') {
        const entry = registry[o.mfcId];
        return Object.assign(common, {
          fileName: o.mfcFileName,
          fileBase64: entry.fileBase64,
          channels: entry.rawImage.channels.map(c => ({ enabled: c.enabled, color: c.color, min: c.min, max: c.max, name: c.name }))
        });
      }
      if (o.type === 'textbox') {
        return Object.assign(common, {
          text: o.text, styles: o.styles, fontFamily: o.fontFamily, fontSize: o.fontSize, fill: o.fill
        });
      }
      if (o.mfcType === 'scalebar') {
        return Object.assign(common, {
          fabricJSON: o.toObject(['mfcId', 'mfcType', 'mfcAttachedTo', 'mfcCorner', 'mfcMarginPct'])
        });
      }
      return Object.assign(common, { fabricJSON: o.toObject(['mfcId', 'mfcType']) });
    });

    const project = { version: 1, docProps, nextId: MFC.getNextIdCounter(), objects };
    const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
    download(blob, 'figure_project.mfcproj.json');
    MFC_UI.toast('Project saved.');
  }

  async function loadProject(file) {
    const text = await file.text();
    const project = JSON.parse(text);
    const canvas = MFC.getCanvas();
    canvas.clear();

    MFC.applyDocProps(project.docProps);
    MFC.setNextIdCounter(project.nextId || 1);
    document.getElementById('doc-width').value = project.docProps.width;
    document.getElementById('doc-height').value = project.docProps.height;
    document.getElementById('doc-unit').value = project.docProps.unit;
    document.getElementById('doc-dpi').value = project.docProps.dpi;

    for (const objDef of project.objects) {
      if (objDef.mfcType === 'mfcImage') {
        const blob = await (await fetch(objDef.fileBase64)).blob();
        const file2 = new File([blob], objDef.fileName, { type: 'image/tiff' });
        const rawImage = await MFC_TIFF.decodeFile(file2);
        rawImage.channels.forEach((c, i) => Object.assign(c, objDef.channels[i]));
        await MFC.addImageToCanvas(rawImage, file2);
        const added = canvas.getObjects()[canvas.getObjects().length - 1];
        added.mfcId = objDef.mfcId;
        MFC.getRegistry()[objDef.mfcId] = MFC.getRegistry()[added.mfcId] || MFC.getRegistry()[added.mfcId];
        added.set({ left: objDef.left, top: objDef.top, scaleX: objDef.scaleX, scaleY: objDef.scaleY,
                    angle: objDef.angle, width: objDef.width, height: objDef.height,
                    cropX: objDef.cropX, cropY: objDef.cropY });
        added.setCoords();
        MFC.recomposite(added, false);
      } else if (objDef.mfcType === 'textbox' || objDef.mfcType === 'text') {
        const t = new fabric.Textbox(objDef.text, {
          left: objDef.left, top: objDef.top, scaleX: objDef.scaleX, scaleY: objDef.scaleY,
          angle: objDef.angle, width: objDef.width, fontFamily: objDef.fontFamily,
          fontSize: objDef.fontSize, fill: objDef.fill, styles: objDef.styles
        });
        t.mfcId = objDef.mfcId; t.mfcType = 'text';
        canvas.add(t);
      } else if (objDef.fabricJSON) {
        fabric.util.enlivenObjects([objDef.fabricJSON], (enlivened) => {
          const o = enlivened[0];
          o.mfcId = objDef.mfcId; o.mfcType = objDef.mfcType;
          if (objDef.fabricJSON.mfcAttachedTo) o.mfcAttachedTo = objDef.fabricJSON.mfcAttachedTo;
          if (objDef.fabricJSON.mfcCorner) o.mfcCorner = objDef.fabricJSON.mfcCorner;
          if (objDef.fabricJSON.mfcMarginPct != null) o.mfcMarginPct = objDef.fabricJSON.mfcMarginPct;
          canvas.add(o);
        });
      }
    }
    canvas.requestRenderAll();
    MFC.pushHistory();
    MFC.refreshChannelPanel();
    MFC.refreshScaleBarRefList();
    MFC_UI.toast('Project loaded.');
  }

  return { exportTIFF, exportSVG, exportPDF, saveProject, loadProject };
})();

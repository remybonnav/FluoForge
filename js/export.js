/*
 * export.js
 * -----------------------------------------------------------------------
 * TIFF (via UTIF.js encode), SVG (via fabric's native toSVG, which already
 * embeds raster layers as base64 PNG and renders text/shapes as true
 * vector elements), and PDF (via jsPDF) export.
 *
 * Also: Project save/load. Projects are saved as a .mfcproj.zip archive
 * (via JSZip) containing:
 *   - manifest.json   (lightweight metadata: doc props, object positions,
 *                       styles, channel settings, etc. — NO large binary data)
 *   - images/*.tiff    (original TIFF bytes, stored raw/binary, so a
 *                       reloaded project remains fully re-editable at full
 *                       bit depth — channel toggles / colors / contrast are
 *                       not baked in)
 *
 * NOTE: We intentionally never JSON.stringify the raw image bytes together
 * in one big object/string. Large multi-channel TIFFs, once base64-encoded
 * and concatenated into a single JS string via JSON.stringify, can exceed
 * the JS engine's maximum string length (RangeError: Invalid string length).
 * Storing each image as its own binary entry in the zip avoids this entirely
 * and also avoids the ~33% size bloat of base64.
 *
 * PERFORMANCE NOTE (save speed): TIFF pixel data barely benefits from
 * DEFLATE compression relative to the CPU cost of compressing it, so image
 * entries are stored with compression:'STORE' (no compression) in the zip.
 * Only the small manifest.json would ever be worth compressing, and even
 * that is skipped by default since it's tiny. This is what makes repeated
 * saves fast — we're not re-deflating megabytes of pixel data every time.
 *
 * FILE HANDLE REUSE: On browsers that support the File System Access API
 * (Chrome/Edge/Opera), the first Save Project (or Load Project) call asks
 * the user to pick a location once via a native file picker, and we keep
 * that FileSystemFileHandle around. Every subsequent "Save Project" click
 * writes directly to that same file (a fast in-place overwrite, no new
 * "Save As" dialog, no new file cluttering the Downloads folder). "Save As"
 * lets you deliberately pick a new file/location. Browsers without that API
 * (Firefox, Safari) transparently fall back to the old "trigger a download"
 * behavior — every save there will still produce a new downloaded file,
 * since there is no browser API to overwrite an arbitrary local file.
 *
 * Legacy support: old *.mfcproj.json / *.mfcproj.json.gz project files
 * (single embedded-base64-JSON format) are still detected and loaded fine.
 * -----------------------------------------------------------------------
 */

const MFC_EXPORT = (function () {

  // Remembered after the first successful Save/Load on browsers that support
  // the File System Access API, so subsequent saves overwrite this same file.
  let projectFileHandle = null;
  const supportsFSAccess = ('showSaveFilePicker' in window) && ('showOpenFilePicker' in window);

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /**
   * Render the full document at full DPI to a data URL, regardless of the current on-screen
   * zoom/pasteboard pan. Uses MFC.withDocOnlyView so the canvas is temporarily sized to
   * exactly the document (no pasteboard margin) — anything a user has parked outside the
   * page bounds is naturally clipped out and never appears in the exported file, while still
   * staying visible/editable on the normal canvas view.
   */
  function renderFullResCanvas() {
    const canvas = MFC.getCanvas();
    return MFC.withDocOnlyView((pxAtDpi) => {
      const dataURL = canvas.toDataURL({ format: 'png', multiplier: 1 });
      return { dataURL, width: pxAtDpi.width, height: pxAtDpi.height };
    });
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
    const svgStr = MFC.withDocOnlyView(() => canvas.toSVG());
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

  function sanitizeFilename(name) {
    return (name || 'figure_project').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ') || 'figure_project';
  }

  /** Picks a MIME type for the File re-materialized from an archived image on load — browsers use a Blob's declared type (not just its bytes) to decide how to render it via <img src="blob:...">, so this has to be right for JPEG/PNG/BMP. */
  function guessMimeType(fileName, sourceFormat) {
    if (sourceFormat === 'tiff') return 'image/tiff';
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'bmp') return 'image/bmp';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    return 'image/png'; // safe fallback — decodeRasterImage doesn't actually depend on this being exact
  }

  async function gzipBlob(blob) {
    const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
    return await new Response(stream).blob();
  }
  async function gunzipBlob(blob) {
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).blob();
  }

  /** Builds the project zip Blob in memory. Does NOT trigger any download/save UI. */
  async function buildProjectZipBlob() {
    const canvas = MFC.getCanvas();
    const registry = MFC.getRegistry();
    const docProps = MFC.getDocProps();

    const zip = new JSZip();
    const imagesFolder = zip.folder('images');
    let imgCounter = 0;

    const objects = canvas.getObjects().filter(o => !o.mfcIsPageBounds).map(o => {
      const common = {
        mfcId: o.mfcId, mfcType: o.mfcType || o.type,
        left: o.left, top: o.top, scaleX: o.scaleX, scaleY: o.scaleY,
        angle: o.angle, width: o.width, height: o.height,
        cropX: o.cropX || 0, cropY: o.cropY || 0
      };
      if (o.mfcType === 'mfcImage') {
        const entry = registry[o.mfcId];
        const archiveName = `img_${imgCounter++}.tiff`;
        // entry.fileBase64 is a data URL ("data:...;base64,XXXX"); strip the
        // prefix and store the raw bytes directly in the zip (not JSON) so
        // we never build one giant string via JSON.stringify.
        const commaIdx = entry.fileBase64.indexOf(',');
        const base64Data = commaIdx >= 0 ? entry.fileBase64.slice(commaIdx + 1) : entry.fileBase64;
        // STORE (no compression) — TIFF pixel data barely compresses anyway,
        // and skipping DEFLATE here is what makes repeated saves fast.
        imagesFolder.file(archiveName, base64Data, { base64: true, compression: 'STORE' });
        return Object.assign(common, {
          fileName: o.mfcFileName,
          imageArchivePath: `images/${archiveName}`,
          sourceFormat: entry.rawImage.sourceFormat || 'tiff', // which decoder to use on load — must match the archived original bytes' actual format
          channels: entry.rawImage.channels.map(c => ({ enabled: c.enabled, color: c.color, min: c.min, max: c.max, name: c.name })),
          voxelSizeUm: entry.rawImage.voxelSizeUm != null ? entry.rawImage.voxelSizeUm : null,
          brightness: entry.rawImage.brightness || 0,
          contrast: entry.rawImage.contrast || 0,
          alphaEnabled: entry.rawImage.alphaEnabled !== false,
          mfcIsInset: !!o.mfcIsInset, mfcInsetContourId: o.mfcInsetContourId || null, mfcInsetSourceId: o.mfcInsetSourceId || null
        });
      }
      if (o.type === 'textbox') {
        return Object.assign(common, {
          text: o.text, styles: o.styles, fontFamily: o.fontFamily, fontSize: o.fontSize, fill: o.fill,
          backgroundColor: o.backgroundColor, textAlign: o.textAlign,
          mfcBorderWidth: o.mfcBorderWidth || 0, mfcBorderColor: o.mfcBorderColor || '#000000'
        });
      }
      if (o.mfcType === 'scalebar') {
        return Object.assign(common, {
          fabricJSON: o.toObject(['mfcId', 'mfcType', 'mfcAttachedTo', 'mfcCorner', 'mfcMarginPct'])
        });
      }
      if (o.mfcType === 'insetContour') {
        return Object.assign(common, {
          fabricJSON: o.toObject(['mfcId', 'mfcType', 'mfcInsetSourceId', 'mfcInsetTargetId'])
        });
      }
      return Object.assign(common, { fabricJSON: o.toObject(['mfcId', 'mfcType']) });
    });

    // manifest.json holds only lightweight metadata now — no embedded binary
    // data — so JSON.stringify here is always safe regardless of project size.
    const project = { version: 2, appVersion: MFC.getAppVersion(), projectName: docProps.name || 'Untitled Figure', docProps, nextId: MFC.getNextIdCounter(), objects };
    zip.file('manifest.json', JSON.stringify(project));

    const outBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'STORE' // images are already STORE'd above; this avoids compressing anything else too
    });

    return outBlob;
  }

  /**
   * Save the current project.
   * - forceNewLocation=false (default, "Save Project"): if we already have a
   *   remembered file handle, overwrite it directly (fast, no dialog). If we
   *   don't have one yet (first save this session, or unsupported browser),
   *   behaves the same as forceNewLocation=true.
   * - forceNewLocation=true ("Save As"): always prompts for a new file/location
   *   (when supported) and remembers that as the new target for future saves.
   */
  async function saveProject(forceNewLocation = false) {
    const docProps = MFC.getDocProps();
    const filename = sanitizeFilename(docProps.name) + '.mfcproj.zip';

    // Grab/confirm the file handle FIRST, before any heavy async work. showSaveFilePicker
    // requires a live "user activation" (the click that triggered this call) — awaiting
    // the zip build first was silently burning through that window on larger projects, so
    // the picker call would then throw (activation expired), get swallowed by the catch
    // below, and every save quietly fell back to downloading a brand-new file instead of
    // overwriting the same one. Doing the picker call immediately fixes that. (Also: this
    // native dialog is shown before our own "Saving…" overlay, so the two never overlap.)
    if (supportsFSAccess) {
      try {
        if (!projectFileHandle || forceNewLocation) {
          projectFileHandle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'MFC Project', accept: { 'application/zip': ['.mfcproj.zip'] } }]
          });
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return; // user cancelled the picker — do nothing
        console.warn('File System Access picker failed, falling back to download:', err);
        projectFileHandle = null; // don't keep a bad handle around
      }
    }

    MFC_UI.showSavingDialog('Saving project…');
    try {
      let blob;
      try {
        blob = await buildProjectZipBlob();
      } catch (err) {
        console.error(err);
        MFC_UI.toast('Failed to build project file: ' + err.message);
        return;
      }

      const versionNote = document.getElementById('doc-version-info');
      if (supportsFSAccess && projectFileHandle) {
        try {
          const writable = await projectFileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
          MFC_UI.toast(`Saved "${projectFileHandle.name}" (${sizeMB} MB)`);
          if (versionNote) versionNote.textContent = `Saved with v${MFC.getAppVersion()}.`;
          return;
        } catch (err) {
          console.warn('File System Access write failed, falling back to download:', err);
          // fall through to the download() fallback below
        }
      }

      // Fallback for browsers without the File System Access API (Firefox, Safari), or if
      // the write above failed: triggers a normal "download a new file" — there is no
      // browser API on those platforms to overwrite an arbitrary local file in place.
      download(blob, filename);
      const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
      MFC_UI.toast(`Saved "${filename}" (${sizeMB} MB)`);
      if (versionNote) versionNote.textContent = `Saved with v${MFC.getAppVersion()}.`;
    } finally {
      MFC_UI.hideSavingDialog();
    }
  }

  /**
   * Opens the native file picker (when supported) and remembers the chosen
   * file handle so future "Save Project" calls overwrite THIS file. Falls
   * back to the plain <input type="file"> click when unsupported.
   */
  async function pickAndLoadProject() {
    if (supportsFSAccess) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'MFC Project', accept: { 'application/zip': ['.mfcproj.zip'] } }],
          excludeAcceptAllOption: false
        });
        const file = await handle.getFile();
        await loadProject(file);
        projectFileHandle = handle; // remember AFTER successful load, so a failed load doesn't poison future saves
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // user cancelled the picker
        console.warn('File System Access open failed, falling back to file input:', err);
      }
    }
    // Fallback: trigger the hidden <input type="file"> (wired up in main.js)
    document.getElementById('project-input').click();
  }

  async function loadProject(file) {
    MFC_UI.showSavingDialog('Loading project…');
    try {
      return await loadProjectInner(file);
    } finally {
      MFC_UI.hideSavingDialog();
    }
  }

  async function loadProjectInner(file) {
    const buf = await file.arrayBuffer();
    const magic = new Uint8Array(buf.slice(0, 4));
    const isZip = magic[0] === 0x50 && magic[1] === 0x4b; // 'PK' — zip signature (current format)
    const isGzip = magic[0] === 0x1f && magic[1] === 0x8b; // legacy gzip-wrapped JSON format

    let project, zip = null;

    if (isZip) {
      zip = await JSZip.loadAsync(buf);
      const manifestText = await zip.file('manifest.json').async('string');
      project = JSON.parse(manifestText);
    } else {
      // Legacy support: old single-JSON project files (*.mfcproj.json / *.mfcproj.json.gz)
      // that embedded images as base64 strings directly in the JSON.
      let text;
      if (isGzip) {
        const decompressed = await gunzipBlob(new Blob([buf]));
        text = await decompressed.text();
      } else {
        text = new TextDecoder().decode(buf);
      }
      project = JSON.parse(text);
    }

    const canvas = MFC.getCanvas();
    canvas.clear();

    MFC.applyDocProps(project.docProps);
    MFC.setNextIdCounter(project.nextId || 1);
    document.getElementById('doc-name').value = project.projectName || project.docProps.name || 'Untitled Figure';
    document.getElementById('doc-width').value = project.docProps.width;
    document.getElementById('doc-height').value = project.docProps.height;
    document.getElementById('doc-unit').value = project.docProps.unit;
    document.getElementById('doc-dpi').value = project.docProps.dpi;

    for (const objDef of project.objects) {
      if (objDef.mfcType === 'mfcImage') {
        let blob;
        if (zip && objDef.imageArchivePath) {
          blob = await zip.file(objDef.imageArchivePath).async('blob');
        } else if (objDef.fileBase64) {
          // legacy fallback
          blob = await (await fetch(objDef.fileBase64)).blob();
        }
        const sourceFormat = objDef.sourceFormat || 'tiff'; // absent = saved before raster-image support existed, so it was necessarily a TIFF
        const file2 = new File([blob], objDef.fileName, { type: guessMimeType(objDef.fileName, sourceFormat) });
        // Must match whichever decoder originally produced the archived bytes — the raw
        // file content is exactly what was uploaded (TIFF binary vs JPEG/PNG/BMP), so
        // using the wrong decoder here would fail outright (e.g. UTIF on a JPEG).
        const rawImage = sourceFormat === 'raster'
          ? await MFC_TIFF.decodeRasterImage(file2)
          : await MFC_TIFF.decodeFile(file2);
        rawImage.channels.forEach((c, i) => Object.assign(c, objDef.channels[i]));
        // Decoding re-derives these from the file itself (or resets to defaults), so the
        // user's saved settings — manual pixel-size calibration, brightness/contrast,
        // and the alpha-preservation toggle — need restoring explicitly.
        if (objDef.voxelSizeUm != null) rawImage.voxelSizeUm = objDef.voxelSizeUm;
        rawImage.brightness = objDef.brightness || 0;
        rawImage.contrast = objDef.contrast || 0;
        if (objDef.alphaEnabled != null) rawImage.alphaEnabled = objDef.alphaEnabled;
        await MFC.addImageToCanvas(rawImage, file2);
        const added = canvas.getObjects()[canvas.getObjects().length - 1];
        const autoId = added.mfcId;
        const reg = MFC.getRegistry();
        reg[objDef.mfcId] = reg[autoId];
        if (objDef.mfcId !== autoId) delete reg[autoId];
        added.mfcId = objDef.mfcId;
        added.set({ left: objDef.left, top: objDef.top, scaleX: objDef.scaleX, scaleY: objDef.scaleY,
                    angle: objDef.angle, width: objDef.width, height: objDef.height,
                    cropX: objDef.cropX, cropY: objDef.cropY });
        added.mfcIsInset = !!objDef.mfcIsInset;
        added.mfcInsetContourId = objDef.mfcInsetContourId || null;
        added.mfcInsetSourceId = objDef.mfcInsetSourceId || null;
        added.setCoords();
      } else if (objDef.mfcType === 'textbox' || objDef.mfcType === 'text') {
        const t = new fabric.Textbox(objDef.text, {
          left: objDef.left, top: objDef.top, scaleX: objDef.scaleX, scaleY: objDef.scaleY,
          angle: objDef.angle, width: objDef.width, fontFamily: objDef.fontFamily,
          fontSize: objDef.fontSize, fill: objDef.fill, styles: objDef.styles,
          backgroundColor: objDef.backgroundColor || '', textAlign: objDef.textAlign || 'left'
        });
        t.mfcId = objDef.mfcId; t.mfcType = 'text';
        t.mfcBorderWidth = objDef.mfcBorderWidth || 0;
        t.mfcBorderColor = objDef.mfcBorderColor || '#000000';
        MFC.attachTextListeners(t);
        canvas.add(t);
      } else if (objDef.fabricJSON) {
        fabric.util.enlivenObjects([objDef.fabricJSON], (enlivened) => {
          const o = enlivened[0];
          o.mfcId = objDef.mfcId; o.mfcType = objDef.mfcType;
          if (objDef.fabricJSON.mfcAttachedTo) o.mfcAttachedTo = objDef.fabricJSON.mfcAttachedTo;
          if (objDef.fabricJSON.mfcCorner) o.mfcCorner = objDef.fabricJSON.mfcCorner;
          if (objDef.fabricJSON.mfcMarginPct != null) o.mfcMarginPct = objDef.fabricJSON.mfcMarginPct;
          if (objDef.fabricJSON.mfcInsetSourceId) o.mfcInsetSourceId = objDef.fabricJSON.mfcInsetSourceId;
          if (objDef.fabricJSON.mfcInsetTargetId) o.mfcInsetTargetId = objDef.fabricJSON.mfcInsetTargetId;
          canvas.add(o);
        });
      }
    }
    canvas.requestRenderAll();
    MFC.pushHistory();
    MFC.refreshChannelPanel();
    MFC.refreshScaleBarRefList();

    const versionLabel = project.appVersion ? `v${project.appVersion}` : 'an earlier version (pre-0.13)';
    document.getElementById('doc-version-info').textContent = `Saved with ${versionLabel} — currently running v${MFC.getAppVersion()}.`;
    MFC_UI.toast(`Project loaded (saved with ${versionLabel}).`);
  }

  return { exportTIFF, exportSVG, exportPDF, saveProject, loadProject, pickAndLoadProject };
})();
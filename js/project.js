/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Versioned projects: immutable source blobs and recursive, pixel-free figure states. */
const MFC_PROJECT = (() => {
  const FORMAT = 3;
  const sources = new Map();
  const decoded = new Map();
  const uuid = () => crypto.randomUUID();
  let context = freshContext();
  let fileHandle = null;
  let busy = false;
  let restoring = false;
  function freshContext() {
    return { projectId: uuid(), versions: [], states: {}, currentVersionId: null,
      workingBaseVersionId: null, savedAt: 0, savedFingerprint: '' };
  }
  const copy = value => JSON.parse(JSON.stringify(value));
  async function hashBlob(blob) {
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
  }
  async function registerSource(blob, raw, suppliedId) {
    if (!blob) throw new Error('The original image file is required to save this source.');
    const id = suppliedId || 'src-' + await hashBlob(blob);
    if (!sources.has(id)) sources.set(id, { id, name: blob.name || raw.fileName || 'image.tif',
      type: blob.type || 'application/octet-stream', format: raw.sourceFormat || 'tiff', blob });
    if (raw) decoded.set(id, raw);
    return id;
  }
  function propsFor(obj) { return [...Object.keys(obj).filter(k => k.startsWith('mfc') && k !== 'mfcIsPageBounds'), 'inverted', 'absolutePositioned']; }
  function serializeObject(obj, top = false) {
    let json;
    if (obj.mfcType === 'mfcImage' || obj.type === 'group') {
      // Calling Image/Group.toObject would embed preview PNGs, including nested ones.
      json = fabric.Object.prototype.toObject.call(obj, propsFor(obj));
      json.type = obj.type;
    } else json = obj.toObject(propsFor(obj));
    if (obj.type === 'group') json.objects = obj.getObjects().map(o => serializeObject(o));
    if (obj.mfcType === 'mfcImage') {
      const entry = MFC.getRegistry()[obj.mfcId];
      if (!entry || !entry.sourceId || !sources.has(entry.sourceId)) throw new Error('Missing original source for ' + obj.mfcFileName);
      json.sourceId = entry.sourceId;
      json.workingScale = entry.workingScale;
      json.cropX = obj.cropX || 0; json.cropY = obj.cropY || 0;
      if (obj.filters?.length) json.filters = obj.filters.map(filter => filter.toObject());
      const raw = entry.rawImage;
      json.display = { channels: raw.channels.map(c => ({ enabled: c.enabled, color: c.color, min: c.min, max: c.max, name: c.name })),
        brightness: raw.brightness || 0, contrast: raw.contrast || 0,
        alphaEnabled: raw.alphaEnabled !== false, voxelSizeUm: raw.voxelSizeUm ?? null };
      if (raw.stack) Object.assign(json.display, { zMode: raw.zMode, zIndex: raw.zIndex, tIndex: raw.tIndex });
    }
    if (obj.clipPath) json.clipPath = serializeObject(obj.clipPath);
    if (top && obj.group?.type === 'activeSelection') {
      const m = obj.calcTransformMatrix(), d = fabric.util.qrDecompose(m);
      Object.assign(json, { originX: 'center', originY: 'center', left: m[4], top: m[5],
        scaleX: Math.abs(d.scaleX), scaleY: Math.abs(d.scaleY), angle: d.angle,
        skewX: d.skewX, skewY: 0, flipX: d.scaleX < 0, flipY: d.scaleY < 0 });
    }
    return json;
  }
  function captureState() {
    return { schema: 1, documentOpen: MFC.hasDocument, docProps: copy(MFC.getDocProps()), nextId: MFC.getNextIdCounter(),
      objects: MFC.getCanvas().getObjects().filter(o => !o.mfcIsPageBounds && o.mfcId).map(o => serializeObject(o, true)) };
  }
  // Projects saved before multi-page figures have no docProps.pages; they are one page.
  const pageCountOf = state => Math.max(1, Math.floor(state.docProps?.pages) || 1);
  function fingerprint(state) {
    return JSON.stringify({schema:state.schema, documentOpen:state.documentOpen !== false,
      docProps:state.docProps && {...state.docProps, pages: pageCountOf(state)}, nextId:state.nextId, objects:state.objects});
  }
  async function sourceRaw(id) {
    if (decoded.has(id)) return decoded.get(id);
    const source = sources.get(id);
    if (!source) throw new Error('Project source is missing: ' + id);
    const file = new File([source.blob], source.name, { type: source.type });
    const raw = source.format === 'raster' ? await MFC_TIFF.decodeRasterImage(file) : await MFC_TIFF.decodeFile(file);
    decoded.set(id, raw);
    return raw;
  }
  const enliven = json => new Promise((resolve, reject) => {
    try { fabric.util.enlivenObjects([json], items => items[0] ? resolve(items[0]) : reject(new Error('Unsupported object: ' + json.type))); }
    catch (error) { reject(error); }
  });
  async function restoreObject(json, registry = MFC.getRegistry(), forExport = false) {
    const options = copy(json); delete options.objects; delete options.clipPath;
    delete options.display; delete options.sourceId; delete options.workingScale;
    let obj;
    if (json.mfcType === 'mfcImage') {
      const original = await sourceRaw(json.sourceId);
      const raw = { ...original, ...json.display,
        channels: original.channels.map((channel, i) => ({ ...channel, ...json.display.channels[i] })) };
      MFC_TIFF.selectPlane(raw); // Z slice / projection and time frame saved with the object
      const workingScale = json.workingScale || MFC_TIFF.workingScale(raw.width, raw.height);
      obj = new fabric.Image(forExport ? document.createElement('canvas') : MFC_TIFF.compositeChannels(raw, workingScale), options);
      registry[json.mfcId] = { rawImage: raw, workingScale, sourceId: json.sourceId, sourceBlob: sources.get(json.sourceId).blob };
    } else if (json.type === 'group') {
      const children = [];
      for (const child of json.objects || []) children.push(await restoreObject(child, registry, forExport));
      obj = new fabric.Group(children, options, true); // saved children already use group-local coordinates
    } else {
      if (['text','textbox','i-text'].includes(json.type)) {
        const families = new Set([json.fontFamily]);
        const collect = value => {
          if (!value || typeof value !== 'object') return;
          if (value.fontFamily) families.add(value.fontFamily);
          Object.values(value).forEach(collect);
        };
        collect(json.styles);
        for (const family of families) if (family) {
          for (const style of ['normal','italic']) for (const weight of [400,700])
            await document.fonts.load(`${style} ${weight} 24px "${family.replace(/"/g,'')}"`);
        }
      }
      obj = await enliven(options);
    }
    for (const key of Object.keys(json).filter(k => k.startsWith('mfc'))) obj[key] = json[key];
    if (json.clipPath) obj.clipPath = await restoreObject(json.clipPath, registry, forExport);
    if (obj.type === 'textbox') MFC.attachTextListeners(obj);
    if (['path','curve','polyline'].includes(obj.mfcShapeKind)) MFC.installPathControls(obj);
    // Lock flags are derived from mfcLocked/mfcPositionLocked rather than stored, so
    // loading, undo/redo and paste all end up with the same Fabric lock state.
    MFC.applyLockState(obj);
    obj.setCoords();
    return obj;
  }
  async function restoreState(state, { resetHistory = true } = {}) {
    restoring = true;
    try {
      // Prepare before clearing so a missing/corrupt source cannot destroy the working canvas.
      const registry = {}, objects = [];
      for (const json of state.objects) objects.push(await restoreObject(json, registry));
      const canvas = MFC.getCanvas();
      canvas.discardActiveObject(); canvas.clear();
      const live = MFC.getRegistry(); Object.keys(live).forEach(k => delete live[k]); Object.assign(live, registry);
      if (state.documentOpen === false) MFC.closeDocument();
      else MFC.applyDocProps(copy(state.docProps));
      MFC.setNextIdCounter(state.nextId || 1);
      objects.forEach(o => canvas.add(o));
      if (MFC.hasDocument) MFC.setTool('select');
      if (resetHistory) MFC.resetHistory();
      syncDocPropsPanel(state.docProps);
      MFC.refreshLayersPanel(); MFC.refreshChannelPanel(); MFC.refreshScaleBarRefList();
      canvas.requestRenderAll();
    } finally { restoring = false; }
    window.dispatchEvent(new Event('mfc:changed'));
  }
  function referencedSources(states) {
    const ids = new Set();
    const visit = obj => { if (obj.sourceId) ids.add(obj.sourceId); (obj.objects || []).forEach(visit); if (obj.clipPath) visit(obj.clipPath); };
    states.forEach(state => state.objects.forEach(visit));
    return [...ids];
  }
  function prepareSave(newVersion, name = '') {
    if (!MFC.hasDocument) throw new Error('Create or open a figure before saving.');
    if (!newVersion && context.currentVersionId && context.workingBaseVersionId !== context.currentVersionId)
      throw new Error('An earlier version is restored. Use Save As to create a new version without replacing the latest saved version.');
    const next = copy(context), state = captureState(), now = Date.now();
    let id = next.currentVersionId;
    if (newVersion || !id) {
      id = uuid();
      next.versions.push({ id, timestamp: now, updatedAt: now, name: name.trim(), parentVersionId: next.workingBaseVersionId,
        statePath: 'versions/' + id + '.json' });
    } else next.versions.find(v => v.id === id).updatedAt = now;
    next.states[id] = state; next.currentVersionId = id; next.workingBaseVersionId = id;
    next.savedAt = now; next.savedFingerprint = fingerprint(state);
    return next;
  }
  async function buildArchive(next) {
    const zip = new JSZip(), ids = referencedSources(Object.values(next.states));
    const sourceDefs = ids.map(id => {
      const source = sources.get(id);
      if (!source) throw new Error('Missing source ' + id);
      const path = 'sources/' + id + '.bin'; zip.file(path, source.blob, { compression: 'STORE' });
      return { id, path, name: source.name, type: source.type, format: source.format };
    });
    next.versions.forEach(version => zip.file(version.statePath, JSON.stringify(next.states[version.id])));
    zip.file('manifest.json', JSON.stringify({ format: 'FluoForge', version: FORMAT, projectId: next.projectId,
      appVersion: MFC.getAppVersion(), savedAt: next.savedAt, currentVersionId: next.currentVersionId,
      versions: next.versions, sources: sourceDefs }));
    return zip.generateAsync({ type: 'blob', compression: 'STORE' });
  }
  function status(message) { document.getElementById('project-status').textContent = message; }
  async function commitSave(next, handle) {
    context = next; if (handle !== undefined) fileHandle = handle;
    status('Saved ' + new Date(next.savedAt).toLocaleString());
    await MFC_AUTOSAVE.markSaved(next);
  }
  async function saveProject(saveAs = false) {
    if (busy) return;
    if (!MFC.hasDocument) { MFC_UI.toast('Create or open a figure before saving.'); return; }
    if (!saveAs && context.currentVersionId && context.workingBaseVersionId !== context.currentVersionId) {
      MFC_UI.toast('Earlier version restored. Use Save As to create a new version.'); return;
    }
    busy = true;
    try {
      let handle = fileHandle;
      const filename = (MFC.getDocProps().name || 'figure').replace(/[\\/:*?"<>|]/g, '_') + '.mfcproj.zip';
      if (window.showSaveFilePicker && (!handle || saveAs)) {
        handle = await window.showSaveFilePicker({ suggestedName: filename,
          types: [{ description: 'FluoForge project', accept: { 'application/zip': ['.mfcproj.zip'] } }] });
        if (saveAs && fileHandle && await handle.isSameEntry(fileHandle))
          throw new Error('Save As needs a different file. The previous project file was not changed.');
      }
      MFC_UI.showSavingDialog('Saving project and versions…');
      const name = document.getElementById('version-name').value;
      const next = prepareSave(saveAs, name), blob = await buildArchive(next);
      if (handle) {
        const writable = await handle.createWritable();
        try { await writable.write(blob); await writable.close(); }
        catch (error) { await writable.abort().catch(() => {}); throw error; }
      } else MFC_EXPORT.download(blob, filename);
      await commitSave(next, handle);
      document.getElementById('version-name').value = '';
      MFC_UI.toast(handle ? 'Project saved.' : 'Project downloaded. This browser cannot overwrite a chosen file; keep the downloaded copy.');
    } catch (error) { if (error.name !== 'AbortError') { status('Save failed: ' + error.message); MFC_UI.toast(error.message); } }
    finally { busy = false; MFC_UI.hideSavingDialog(); }
  }
  async function migrateLegacy(project, zip, savedAt) {
    const migrateObject = async old => {
      // v2 top-level entries carry mfcType only, but children nested in a saved group
      // (scale bar rect/label, grouped text and shapes) are plain Fabric JSON whose
      // own type must be kept.
      let json = old.fabricJSON ? copy(old.fabricJSON) : { ...old, type: old.type || (old.mfcType === 'text' ? 'textbox' : old.mfcType) };
      for (const key of ['left','top','scaleX','scaleY','angle','width','height','cropX','cropY']) if (old[key] != null) json[key] = old[key];
      if (old.mfcId || json.mfcId || old.mfcType) json.mfcId = old.mfcId || json.mfcId || uuid();
      if (old.mfcType || json.mfcType) json.mfcType = old.mfcType || json.mfcType;
      if (json.mfcType === 'mfcImage') {
        let blob;
        if (old.imageArchivePath && zip) blob = await zip.file(old.imageArchivePath).async('blob');
        else if (old.fileBase64 || json.src) blob = await (await fetch(old.fileBase64 || json.src)).blob();
        else throw new Error('Legacy project is missing an original image.');
        const sourceFormat = old.sourceFormat || (old.imageArchivePath || old.fileBase64 ? 'tiff' : 'raster');
        const file = new File([blob], old.fileName || json.mfcFileName || 'image.tif');
        const raw = sourceFormat === 'raster' ? await MFC_TIFF.decodeRasterImage(file) : await MFC_TIFF.decodeFile(file);
        json.sourceId = await registerSource(file, raw); json.type = 'image';
        json.mfcFileName = old.fileName || json.mfcFileName || file.name;
        json.workingScale = MFC_TIFF.workingScale(raw.width, raw.height);
        json.display = { channels: old.channels || raw.channels.map(({ data, ...settings }) => settings),
          brightness: old.brightness || 0, contrast: old.contrast || 0,
          voxelSizeUm: old.voxelSizeUm ?? raw.voxelSizeUm, alphaEnabled: old.alphaEnabled !== false };
        for (const key of ['fileBase64','src','fileName','imageArchivePath','sourceFormat','channels','voxelSizeUm','brightness','contrast','alphaEnabled'])
          delete json[key];
      }
      if (json.objects) json.objects = await Promise.all(json.objects.map(migrateObject));
      // v0.18 did not store a scale bar's length; its label ("20 µm") still has it.
      if (json.mfcType === 'scalebar' && json.mfcLengthUm == null) {
        const label = (json.objects || []).find(o => typeof o.text === 'string');
        const value = label && parseFloat(label.text.replace(',', '.'));
        if (value > 0) json.mfcLengthUm = value;
      }
      return json;
    };
    const state = { schema: 1, docProps: project.docProps, nextId: project.nextId,
      objects: await Promise.all(project.objects.map(migrateObject)) };
    // Legacy outlines recorded source-relative fractions, not pixel coordinates.
    const flat = []; const walk = o => { flat.push(o); (o.objects || []).forEach(walk); }; state.objects.forEach(walk);
    flat.filter(o => o.mfcType === 'insetContour' && o.mfcCropX == null).forEach(o => {
      const image = flat.find(i => i.mfcId === o.mfcInsetSourceId);
      if (image) Object.assign(o, { mfcCropX: (image.cropX || 0) + (o.mfcRelX || 0)*image.width,
        mfcCropY: (image.cropY || 0) + (o.mfcRelY || 0)*image.height,
        mfcCropW: (o.mfcRelW || 1)*image.width, mfcCropH: (o.mfcRelH || 1)*image.height });
    });
    const next = freshContext(), id = uuid();
    Object.assign(next, { currentVersionId: id, workingBaseVersionId: id, savedAt,
      savedFingerprint: fingerprint(state), states: { [id]: state },
      versions: [{ id, timestamp: savedAt, updatedAt: savedAt, name: 'Version 1 (imported)', parentVersionId: null, statePath: 'versions/'+id+'.json' }] });
    return next;
  }
  async function readArchive(file) {
    const bytes = await file.arrayBuffer(), magic = new Uint8Array(bytes, 0, 2);
    let zip, manifest;
    if (magic[0] === 0x50 && magic[1] === 0x4b) {
      zip = await JSZip.loadAsync(bytes); manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    } else {
      const blob = new Blob([bytes]);
      const text = magic[0] === 0x1f && magic[1] === 0x8b ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text() : await blob.text();
      manifest = JSON.parse(text);
    }
    if (manifest.version !== FORMAT) {
      if (manifest.version > FORMAT) throw new Error('This project was saved by a newer FluoForge format.');
      const next = await migrateLegacy(manifest, zip, file.lastModified || Date.now());
      next.projectId = 'legacy-' + await hashBlob(file); next.migrated = true; return next;
    }
    const next = { ...manifest, states: {}, workingBaseVersionId: manifest.currentVersionId };
    for (const source of manifest.sources) {
      const entry = zip.file(source.path); if (!entry) throw new Error('Missing source file: ' + source.name);
      sources.set(source.id, { ...source, blob: await entry.async('blob') });
    }
    for (const version of manifest.versions) {
      const entry = zip.file(version.statePath); if (!entry) throw new Error('Missing version state: ' + version.id);
      next.states[version.id] = JSON.parse(await entry.async('string'));
    }
    if (!next.states[next.currentVersionId]) throw new Error('Missing current project version.');
    next.savedFingerprint = fingerprint(next.states[next.currentVersionId]);
    return next;
  }
  async function loadProject(file, handle = null) {
    if (busy) return; busy = true;
    MFC_UI.showSavingDialog('Loading project…');
    try {
      const next = await readArchive(file);
      await restoreState(next.states[next.currentVersionId]); context = next; fileHandle = handle;
      // A migrated legacy state is not in the editor's normalized form; what was just
      // opened is, by definition, what the file holds.
      if (next.migrated) { delete next.migrated; next.savedFingerprint = fingerprint(captureState()); }
      status('Opened ' + file.name); document.querySelector('.document-start-modal')?.remove();
    } catch (error) { status('Load failed: ' + error.message); throw error; }
    finally { busy = false; MFC_UI.hideSavingDialog(); }
    await MFC_AUTOSAVE.offerRecovery(context.projectId);
  }
  async function pickAndLoadProject() {
    try {
      if (!window.showOpenFilePicker) { document.getElementById('project-input').click(); return; }
      const [handle] = await window.showOpenFilePicker({ types: [{ description: 'FluoForge project', accept: { 'application/zip': ['.mfcproj.zip'] } }] });
      await loadProject(await handle.getFile(), handle);
    } catch (error) { if (error.name !== 'AbortError') MFC_UI.toast(error.message); }
  }
  async function createProject(props) {
    if (busy) throw new Error('Wait for the current project operation to finish.');
    if (MFC.hasDocument) await MFC_AUTOSAVE.checkpoint();
    busy = true;
    try {
      await restoreState({schema:1, documentOpen:true, docProps:copy(props), nextId:1, objects:[]});
      context = freshContext(); fileHandle = null;
      status('New figure — not saved yet');
    } finally { busy = false; }
  }
  async function restoreVersion(id) {
    if (!context.states[id]) throw new Error('Version not found.');
    await MFC_AUTOSAVE.checkpoint();
    await restoreState(context.states[id]); context.workingBaseVersionId = id;
    status('Restored ' + (context.versions.find(v => v.id === id).name || 'version') + '. Use Save As to branch from this state.');
  }
  function showVersions() {
    const modal = document.createElement('div'); modal.className = 'modal-backdrop';
    const box = document.createElement('div'); box.className = 'modal versions-modal';
    const heading = document.createElement('h2'); heading.textContent = 'Project versions'; box.append(heading);
    for (const [index, version] of context.versions.entries()) {
      const row = document.createElement('div'); row.className = 'version-row';
      const label = document.createElement('span'); label.textContent = `${index+1}. ${version.name || 'Unnamed'} — ${new Date(version.updatedAt).toLocaleString()}${version.id === context.currentVersionId ? ' (latest)' : ''}`;
      const button = document.createElement('button'); button.textContent = 'Restore';
      button.onclick = async () => { try { await restoreVersion(version.id); modal.remove(); } catch (error) { MFC_UI.toast(error.message); } };
      row.append(label, button); box.append(row);
    }
    if (!context.versions.length) { const p = document.createElement('p'); p.textContent = 'No saved versions yet. Save Project creates version 1; Save As creates another version in a new file.'; box.append(p); }
    const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => modal.remove(); box.append(close);
    modal.append(box); document.body.append(modal);
  }
  function adoptRecovery(next) { context = next; fileHandle = null; }
  /** True when the open figure differs from its last manual save (or was never saved and has content). */
  function hasUnsavedChanges() {
    if (!MFC.hasDocument) return false;
    try {
      const state = captureState();
      if (!context.currentVersionId) return state.objects.length > 0 || pageCountOf(state) > 1;
      return fingerprint(state) !== context.savedFingerprint;
    } catch (_) { return true; } // cannot tell: better to ask than to lose work
  }
  return { registerSource, sources, captureState, restoreState, restoreObject, serializeObject, fingerprint,
    referencedSources, prepareSave, buildArchive, commitSave, readArchive, saveProject, loadProject,
    pickAndLoadProject, createProject, restoreVersion, showVersions, status, adoptRecovery, hasUnsavedChanges,
    get context() { return context; }, get suspended() { return restoring || busy; } };
})();

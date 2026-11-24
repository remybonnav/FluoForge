/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Versioned projects: immutable source blobs and recursive, pixel-free figure states.
   The file format is described in docs/PROJECT-FORMAT.md. */
const MFC_PROJECT = (() => {
  const FORMAT = 3;   // manifest.version
  const SCHEMA = 7;   // state.schema written by captureState; equals CURRENT_SCHEMA in js/migrations/index.js
  // Migrations are ES modules (pure functions on JSON), loaded the first time a project is opened.
  const MIGRATIONS_URL = new URL('migrations/index.js', document.currentScript?.src || new URL('js/', document.baseURI)).href;
  let migrations = null;
  const loadMigrations = () => (migrations ||= import(MIGRATIONS_URL).then(module => {
    if (module.CURRENT_SCHEMA !== SCHEMA) throw new Error(`js/migrations/index.js is at format ${module.CURRENT_SCHEMA}, js/project.js at ${SCHEMA}.`);
    return module;
  }));
  /** Brings a saved state up to the current schema (a no-op for current and newer states). */
  async function migrateState(state) { return (await loadMigrations()).migrateState(state); }
  const sources = new Map();
  const decoded = new Map();
  const uuid = () => crypto.randomUUID();
  let context = freshContext();
  let fileHandle = null;
  let busy = false;
  let restoring = false;
  // What the open figure holds that this version does not understand (from a newer FluoForge):
  // unknown state fields, the newer schema number, and objects it cannot draw. captureState puts
  // them back, so saving, undo and recovery keep them unchanged.
  let kept = { schema: null, fields: {}, objects: [] };
  const STATE_KEYS = ['schema', 'documentOpen', 'docProps', 'nextId', 'objects'];
  const MANIFEST_KEYS = ['format', 'version', 'projectId', 'appVersion', 'savedAt', 'currentVersionId', 'versions', 'sources'];
  // Keys serializeObject writes itself; anything else in a saved object that toObject does not
  // produce is a field this version does not know, kept on the object as ffUnknownFields.
  const WRITTEN_KEYS = ['type', 'objects', 'sourceId', 'workingScale', 'cropX', 'cropY', 'filters', 'display', 'clipPath'];
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
    if (raw) decoded.set(id + '|' + (raw.decoder === 2 ? 2 : 1), raw);
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
      json.display = { channels: raw.channels.map(c => ({ enabled: c.enabled, color: c.color, min: c.min, max: c.max, name: c.name,
          gamma: Number.isFinite(c.gamma) && c.gamma > 0 ? c.gamma : 1, invert: !!c.invert,
          ...(typeof c.lut === 'string' && c.lut ? { lut: c.lut } : {}) })),
        brightness: raw.brightness || 0, contrast: raw.contrast || 0,
        alphaEnabled: raw.alphaEnabled !== false, voxelSizeUm: raw.voxelSizeUm ?? null };
      // Which TIFF decoder made the channels: reopening uses the same one (schema 5).
      if (raw.sourceFormat === 'tiff') json.display.decoder = raw.decoder === 2 ? 2 : 1;
      if (raw.stack) Object.assign(json.display, { zMode: raw.zMode, zIndex: raw.zIndex, tIndex: raw.tIndex });
    }
    if (obj.clipPath) json.clipPath = serializeObject(obj.clipPath);
    if (obj.ffUnknownFields) for (const [key, value] of Object.entries(obj.ffUnknownFields)) if (!(key in json)) json[key] = copy(value);
    if (top && obj.group?.type === 'activeSelection') {
      const m = obj.calcTransformMatrix(), d = fabric.util.qrDecompose(m);
      Object.assign(json, { originX: 'center', originY: 'center', left: m[4], top: m[5],
        scaleX: Math.abs(d.scaleX), scaleY: Math.abs(d.scaleY), angle: d.angle,
        skewX: d.skewX, skewY: 0, flipX: d.scaleX < 0, flipY: d.scaleY < 0 });
    }
    return json;
  }
  function captureState() {
    const objects = MFC.getCanvas().getObjects().filter(o => !o.mfcIsPageBounds && o.mfcId).map(o => serializeObject(o, true));
    for (const { index, json } of kept.objects) objects.splice(Math.min(index, objects.length), 0, copy(json));
    return { ...copy(kept.fields), schema: kept.schema ?? SCHEMA, documentOpen: MFC.hasDocument, docProps: copy(MFC.getDocProps()),
      nextId: MFC.getNextIdCounter(), objects };
  }
  // Projects saved before multi-page figures have no docProps.pages; they are one page.
  const pageCountOf = state => Math.max(1, Math.floor(state.docProps?.pages) || 1);
  function fingerprint(state) {
    return JSON.stringify({schema:state.schema, documentOpen:state.documentOpen !== false,
      docProps:state.docProps && {...state.docProps, pages: pageCountOf(state)}, nextId:state.nextId, objects:state.objects});
  }
  /** A source decoded once per TIFF decoder version (images saved before schema 5 use decoder 1). */
  async function sourceRaw(id, decoder = 1) {
    const key = id + '|' + decoder;
    if (decoded.has(key)) return decoded.get(key);
    const source = sources.get(id);
    if (!source) throw new Error('Project source is missing: ' + id);
    const file = new File([source.blob], source.name, { type: source.type });
    const raw = source.format === 'raster' ? await MFC_TIFF.decodeRasterImage(file) : await MFC_TIFF.decodeFile(file, { decoder });
    decoded.set(key, raw);
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
    if (json.mfcType !== 'mfcImage' && !(json.type && fabric.util.getKlass(json.type, 'fabric'))) {
      const error = new Error(`This figure contains a "${json.mfcType || json.type || 'unknown'}" object from a newer FluoForge, which this version cannot draw.`);
      error.name = 'UnsupportedObject'; throw error;
    }
    if (json.mfcType === 'mfcImage') {
      const original = await sourceRaw(json.sourceId, json.display && json.display.decoder === 2 ? 2 : 1);
      const raw = { ...original, ...json.display,
        channels: original.channels.map((channel, i) => ({ ...channel, ...json.display.channels[i] })) };
      await MFC_TIFF.selectPlane(raw); // Z slice / projection and time frame saved with the object
      const workingScale = json.workingScale || MFC_TIFF.workingScale(raw.width, raw.height);
      obj = new fabric.Image(forExport ? document.createElement('canvas') : await MFC_TIFF.composite(raw, workingScale, null, null, null, { cache: true }), options);
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
    // Fields from a newer version that toObject would drop are kept and written back unchanged.
    const written = forExport ? null : obj.mfcType === 'mfcImage' || obj.type === 'group' ? fabric.Object.prototype.toObject.call(obj, propsFor(obj)) : obj.toObject(propsFor(obj));
    const unknown = written ? Object.keys(json).filter(key => !(key in written) && !WRITTEN_KEYS.includes(key)) : [];
    if (unknown.length) obj.ffUnknownFields = Object.fromEntries(unknown.map(key => [key, copy(json[key])]));
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
      const registry = {}, objects = [], unsupported = [];
      for (const [index, json] of state.objects.entries()) {
        try { objects.push(await restoreObject(json, registry)); }
        catch (error) { if (error.name !== 'UnsupportedObject') throw error; unsupported.push({ index, json: copy(json) }); }
      }
      kept = { schema: state.schema > SCHEMA ? state.schema : null,
        fields: Object.fromEntries(Object.entries(state).filter(([key]) => !STATE_KEYS.includes(key)).map(([k, v]) => [k, copy(v)])),
        objects: unsupported };
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
    // The first save of a migrated project must not overwrite the version it was opened from: that
    // state stays in versions/ exactly as it was read, and the migrated figure becomes a new version.
    const keepOriginal = next.originalVersionId && next.originalVersionId === id;
    if (newVersion || !id || keepOriginal) {
      id = uuid();
      next.versions.push({ id, timestamp: now, updatedAt: now,
        name: name.trim() || (keepOriginal ? 'Updated by FluoForge ' + MFC.getAppVersion() : ''), parentVersionId: next.workingBaseVersionId,
        statePath: 'versions/' + id + '.json' });
    } else next.versions.find(v => v.id === id).updatedAt = now;
    next.states[id] = state; next.currentVersionId = id; next.workingBaseVersionId = id;
    next.savedAt = now; next.savedFingerprint = fingerprint(state);
    delete next.originalVersionId;
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
    zip.file('manifest.json', JSON.stringify({ ...next.manifestExtras, format: 'FluoForge', version: Math.max(FORMAT, next.formatVersion || 0), projectId: next.projectId,
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
  // New projects are saved as .fluoforge (a zip whose manifest.format is "FluoForge").
  // Opening detects zip, gzip and JSON from the content, so older names keep working.
  const PROJECT_EXTENSION = '.fluoforge';
  const SAVE_TYPES = [{ description: 'FluoForge project', accept: { 'application/zip': [PROJECT_EXTENSION] } }];
  const OPEN_TYPES = [{ description: 'FluoForge project (.fluoforge, or older .mfcproj.zip, .json and .gz)',
    accept: { 'application/zip': [PROJECT_EXTENSION, '.mfcproj.zip', '.zip'], 'application/json': ['.json'], 'application/gzip': ['.gz'] } }];
  async function saveProject(saveAs = false) {
    if (busy) return;
    if (!MFC.hasDocument) { MFC_UI.toast('Create or open a figure before saving.'); return; }
    if (!saveAs && context.currentVersionId && context.workingBaseVersionId !== context.currentVersionId) {
      MFC_UI.toast('Earlier version restored. Use Save As to create a new version.'); return;
    }
    busy = true;
    try {
      let handle = fileHandle;
      const filename = (MFC.getDocProps().name || 'figure').replace(/[\\/:*?"<>|]/g, '_') + PROJECT_EXTENSION;
      if (window.showSaveFilePicker && (!handle || saveAs)) {
        handle = await window.showSaveFilePicker({ suggestedName: filename, types: SAVE_TYPES });
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
  /** Legacy projects embed images as data: URLs. They are decoded here, because the page's
   *  Content-Security-Policy (connect-src 'self') does not let fetch() read data: URLs. */
  async function legacyImageBlob(url) {
    const match = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(url);
    if (!match) return (await fetch(url)).blob();
    const text = match[2] ? atob(match[3]) : match[3].replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const bytes = Uint8Array.from(text, ch => ch.charCodeAt(0));
    return new Blob([bytes], { type: match[1] || 'application/octet-stream' });
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
        else if (old.fileBase64 || json.src) blob = await legacyImageBlob(old.fileBase64 || json.src);
        else throw new Error('Legacy project is missing an original image.');
        const sourceFormat = old.sourceFormat || (old.imageArchivePath || old.fileBase64 ? 'tiff' : 'raster');
        const file = new File([blob], old.fileName || json.mfcFileName || 'image.tif');
        const raw = sourceFormat === 'raster' ? await MFC_TIFF.decodeRasterImage(file) : await MFC_TIFF.decodeFile(file, { decoder: 1 });
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
      return json;
    };
    // Schema 0: the legacy objects as plain Fabric JSON with registered sources. The remaining
    // fixes (scale bar length from its label, inset outlines in source pixels) are the pure
    // migration js/migrations/schema-0-to-1.js, run when the state is opened.
    const state = { schema: 0, docProps: project.docProps, nextId: project.nextId,
      objects: await Promise.all(project.objects.map(migrateObject)) };
    const next = freshContext(), id = uuid();
    Object.assign(next, { currentVersionId: id, workingBaseVersionId: id, savedAt,
      savedFingerprint: fingerprint(state), states: { [id]: state },
      versions: [{ id, timestamp: savedAt, updatedAt: savedAt, name: 'Original (imported from ' + (project.appVersion ? 'v' + project.appVersion : 'an older format') + ')',
        parentVersionId: null, statePath: 'versions/'+id+'.json' }] });
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
    // Manifest versions 1 and 2 are the legacy formats (before 0.1.0). Their loader stays forever.
    if (!(manifest.version >= FORMAT)) {
      const next = await migrateLegacy(manifest, zip, file.lastModified || Date.now());
      next.projectId = 'legacy-' + await hashBlob(file); return next;
    }
    // A newer format is read with this version's reader: it loads what it understands.
    if (!zip || !Array.isArray(manifest.versions) || !Array.isArray(manifest.sources))
      throw new Error(`This project was saved by FluoForge ${manifest.appVersion ? 'v' + manifest.appVersion : '(a newer version)'} in a format this version cannot read. Open it with that version or a later one.`);
    const next = { ...manifest, states: {}, workingBaseVersionId: manifest.currentVersionId, formatVersion: manifest.version,
      manifestExtras: Object.fromEntries(Object.entries(manifest).filter(([key]) => !MANIFEST_KEYS.includes(key))) };
    for (const key of Object.keys(next.manifestExtras)) delete next[key];
    for (const source of manifest.sources) {
      const entry = zip.file(source.path); if (!entry) throw new Error('Missing source file: ' + source.name);
      const blob = await entry.async('blob');
      // Source ids are the SHA-256 of the original file; a mismatch means the copy is damaged.
      const hash = /^src-([0-9a-f]{64})$/.exec(source.id);
      if (hash && await hashBlob(blob) !== hash[1]) throw new Error(`The image ${source.name} inside this project is damaged: its bytes do not match its checksum.`);
      sources.set(source.id, { ...source, blob });
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
      const opened = await migrateState(next.states[next.currentVersionId]);
      await restoreState(opened.state); context = next; fileHandle = handle;
      if (opened.applied.length) {
        // The file's state stays untouched in context.states; the first save adds the migrated
        // figure as a new version instead of overwriting it (prepareSave). What was just opened
        // is, by definition, what the file holds, so it counts as saved.
        next.originalVersionId = next.currentVersionId;
        next.savedFingerprint = fingerprint(captureState());
      }
      // Newer means a later format or schema. App version numbers cannot tell: versions from before
      // the 0.1.0 reset were numbered 0.18 to 0.24, and any new kind of content bumps the schema anyway.
      const newer = opened.newer || next.formatVersion > FORMAT;
      status(newer ? newerNotice(next.appVersion) : 'Opened ' + file.name); document.querySelector('.document-start-modal')?.remove();
      if (newer) MFC_UI.toast(newerNotice(next.appVersion));
    } catch (error) { status('Load failed: ' + error.message); throw error; }
    finally { busy = false; MFC_UI.hideSavingDialog(); }
    await MFC_AUTOSAVE.offerRecovery(context.projectId);
  }
  const newerNotice = version => `Saved by FluoForge ${version ? 'v' + version : '(a newer version)'}; some content may not display.`;
  async function pickAndLoadProject() {
    try {
      if (!window.showOpenFilePicker) { document.getElementById('project-input').click(); return; }
      const [handle] = await window.showOpenFilePicker({ types: OPEN_TYPES });
      await loadProject(await handle.getFile(), handle);
    } catch (error) { if (error.name !== 'AbortError') MFC_UI.toast(error.message); }
  }
  async function createProject(props) {
    if (busy) throw new Error('Wait for the current project operation to finish.');
    if (MFC.hasDocument) await MFC_AUTOSAVE.checkpoint();
    busy = true;
    try {
      await restoreState({schema:SCHEMA, documentOpen:true, docProps:copy(props), nextId:1, objects:[]});
      context = freshContext(); fileHandle = null;
      status('New figure — not saved yet');
    } finally { busy = false; }
  }
  async function restoreVersion(id) {
    if (!context.states[id]) throw new Error('Version not found.');
    await MFC_AUTOSAVE.checkpoint();
    await restoreState((await migrateState(context.states[id])).state); context.workingBaseVersionId = id;
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
  return { SCHEMA, FORMAT, migrateState, registerSource, sources, captureState, restoreState, restoreObject, serializeObject, fingerprint,
    referencedSources, prepareSave, buildArchive, commitSave, readArchive, saveProject, loadProject,
    pickAndLoadProject, createProject, restoreVersion, showVersions, status, adoptRecovery, hasUnsavedChanges,
    get context() { return context; }, get suspended() { return restoring || busy; } };
})();

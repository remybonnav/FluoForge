/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* IndexedDB drafts are recovery checkpoints, never permanent project versions. */
const MFC_AUTOSAVE = (() => {
  const testId = new URLSearchParams(location.search).get('test');
  const DB_NAME = 'FluoForge-recovery-v1' + (testId ? '-test-' + testId.replace(/[^\w-]/g, '') : ''), LIMIT = 8;
  let dbPromise, timer, running = false, offering = false, lastFingerprint = '', lastProjectId = null, initialized = false;
  let persistRequested = false, warnedFull = false;
  const isQuotaError = error => !!error && (error.name === 'QuotaExceededError' || /quota/i.test(error.message || ''));
  function storageError(error) {
    const el = document.getElementById('autosave-status');
    if (isQuotaError(error)) {
      // The figure is untouched; only the recovery copy in the browser could not be written.
      el.textContent = 'Browser storage is full, so recovery drafts cannot be kept (' + (error.message || error.name) +
        '). Your figure is not affected: save it to a file with Save Project (Ctrl+S). To free space, remove old site data for this page in the browser settings.';
      if (!warnedFull) {
        warnedFull = true;
        MFC_UI.toast('Browser storage is full: recovery drafts are paused. Save your project to a file.');
      }
    } else {
      el.textContent = 'Browser recovery unavailable: ' + (error && error.message || error) + '. Save your project manually.';
    }
    el.classList.add('storage-error');
    refreshStorageStatus();
  }
  const formatBytes = n => n >= 2 ** 30 ? (n / 2 ** 30).toFixed(1) + ' GB' : n >= 2 ** 20 ? (n / 2 ** 20).toFixed(1) + ' MB' : Math.round(n / 1024) + ' kB';
  /** "Browser storage: 12.4 MB used of 2.1 GB (persistent)", next to the recovery status. */
  async function refreshStorageStatus() {
    const el = document.getElementById('storage-status');
    if (!el || !navigator.storage || !navigator.storage.estimate) return;
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      el.textContent = `Browser storage: ${formatBytes(usage)} used of ${quota ? formatBytes(quota) : 'an unknown amount'}` +
        (persisted ? ' (kept until you clear it)' : ' (the browser may clear it when space runs low)');
    } catch (error) { el.textContent = ''; }
  }
  /** Once there is a draft worth keeping, ask the browser not to evict recovery data under storage pressure. */
  function requestPersistence() {
    if (persistRequested || !navigator.storage || !navigator.storage.persist) return;
    persistRequested = true;
    Promise.resolve().then(() => navigator.storage.persist()).then(refreshStorageStatus, () => {});
  }
  function openDB() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('sources', { keyPath: 'id' });
        db.createObjectStore('projects', { keyPath: 'projectId' });
        const store = db.createObjectStore('checkpoints', { keyPath: 'id' }); store.createIndex('projectId', 'projectId');
      };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Recovery database is blocked by another tab. Close older FluoForge tabs.'));
    });
    return dbPromise;
  }
  const result = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const complete = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted')); });
  async function all(store) { const db = await openDB(); return result(db.transaction(store).objectStore(store).getAll()); }
  async function ensureSources(ids) {
    const db = await openDB();
    const keys = new Set(await result(db.transaction('sources').objectStore('sources').getAllKeys()));
    const missing = ids.filter(id => !keys.has(id));
    if (!missing.length) return;
    const tx = db.transaction('sources', 'readwrite'), done = complete(tx);
    for (const id of missing) {
      const source = MFC_PROJECT.sources.get(id);
      if (!source) { tx.abort(); await done; }
      tx.objectStore('sources').put(source);
    }
    await done;
  }
  async function checkpoint() {
    if (running || offering || !MFC.hasDocument || MFC_PROJECT.suspended || !initialized) return null;
    running = true;
    try {
      const capturedAt = Date.now(), state = MFC_PROJECT.captureState(), context = MFC_PROJECT.context;
      const fp = MFC_PROJECT.fingerprint(state);
      if ((context.projectId === lastProjectId && fp === lastFingerprint) || fp === context.savedFingerprint || (!state.objects.length && !context.currentVersionId)) return null;
      const ids = MFC_PROJECT.referencedSources([state, ...Object.values(context.states)]);
      await ensureSources(ids);
      const db = await openDB();
      const checkpoints = (await all('checkpoints')).filter(c => c.projectId === context.projectId).sort((a,b) => b.timestamp-a.timestamp);
      if (MFC_PROJECT.context !== context || MFC_PROJECT.suspended) return null;
      const record = { id: crypto.randomUUID(), projectId: context.projectId, timestamp: capturedAt,
        baseVersionId: context.workingBaseVersionId, state, fingerprint: fp };
      const tx = db.transaction(['projects','checkpoints'], 'readwrite'), done = complete(tx);
      tx.objectStore('projects').put({ projectId: context.projectId, context: structuredClone(context), sourceIds: ids,
        name: state.docProps.name, lastSavedAt: context.savedAt });
      tx.objectStore('checkpoints').put(record);
      checkpoints.slice(LIMIT-1).forEach(c => tx.objectStore('checkpoints').delete(c.id));
      await done; lastFingerprint = fp; lastProjectId = context.projectId;
      document.getElementById('autosave-status').classList.remove('storage-error');
      document.getElementById('autosave-status').textContent = 'Recovery saved ' + new Date(record.timestamp).toLocaleTimeString();
      warnedFull = false;
      requestPersistence();
      refreshStorageStatus();
      return record;
    } catch (error) { storageError(error); return null; }
    finally { running = false; }
  }
  async function markSaved(context) {
    try {
      const ids = MFC_PROJECT.referencedSources(Object.values(context.states)); await ensureSources(ids);
      const db = await openDB(), existing = await all('checkpoints');
      const tx = db.transaction(['projects','checkpoints'], 'readwrite'), done = complete(tx);
      tx.objectStore('projects').put({ projectId: context.projectId, context: structuredClone(context), sourceIds: ids,
        name: MFC.getDocProps().name, lastSavedAt: context.savedAt });
      existing.filter(c => c.projectId === context.projectId && c.timestamp <= context.savedAt).forEach(c => tx.objectStore('checkpoints').delete(c.id));
      await done; lastFingerprint = context.savedFingerprint; lastProjectId = context.projectId;
    } catch (error) { storageError(error); }
  }
  async function candidates(projectId) {
    const projects = await all('projects'), checkpoints = await all('checkpoints');
    return projects.filter(p => !projectId || p.projectId === projectId).flatMap(project => {
      const openedSaved = MFC_PROJECT.context.projectId === project.projectId ? MFC_PROJECT.context.savedAt : 0;
      const cutoff = Math.max(project.lastSavedAt || 0, openedSaved);
      const draft = checkpoints.filter(c => c.projectId === project.projectId && c.timestamp > cutoff).sort((a,b) => b.timestamp-a.timestamp)[0];
      return draft ? [{ project, draft }] : [];
    });
  }
  async function discard(projectId) {
    const db = await openDB(), checkpoints = await all('checkpoints');
    const tx = db.transaction('checkpoints', 'readwrite'), done = complete(tx);
    checkpoints.filter(c => c.projectId === projectId).forEach(c => tx.objectStore('checkpoints').delete(c.id)); await done;
  }
  async function recover({ project, draft }) {
    const db = await openDB();
    for (const id of project.sourceIds) {
      const source = await result(db.transaction('sources').objectStore('sources').get(id));
      if (!source) throw new Error('Recovery source is missing: ' + id);
      MFC_PROJECT.sources.set(id, source);
    }
    const next = structuredClone(project.context); next.workingBaseVersionId = draft.baseVersionId;
    // A draft written by an earlier version is migrated like a project file.
    await MFC_PROJECT.restoreState((await MFC_PROJECT.migrateState(draft.state)).state); MFC_PROJECT.adoptRecovery(next);
    lastFingerprint = draft.fingerprint; lastProjectId = project.projectId;
    document.querySelector('.document-start-modal')?.remove();
    MFC_PROJECT.status('Recovered draft from ' + new Date(draft.timestamp).toLocaleString() + '. Save manually to keep it.');
  }
  async function offerRecovery(projectId) {
    try {
      const list = await candidates(projectId); if (!list.length) return;
      offering = true;
      const overlay = document.createElement('div'); overlay.className = 'modal-backdrop recovery-modal';
      const box = document.createElement('div'); box.className = 'modal';
      const heading = document.createElement('h2'); heading.textContent = 'Recover browser draft?'; box.append(heading);
      for (const item of list) {
        const row = document.createElement('div'); row.className = 'version-row';
        const label = document.createElement('p'); label.textContent = `${item.project.name || 'Untitled Figure'} — ${new Date(item.draft.timestamp).toLocaleString()}`;
        const recoverButton = document.createElement('button'); recoverButton.textContent = 'Recover';
        recoverButton.onclick = async () => {
          try { await recover(item); overlay.remove(); offering = false; }
          catch (error) { storageError(error); }
        };
        const discardButton = document.createElement('button'); discardButton.textContent = 'Discard';
        discardButton.onclick = async () => {
          try { await discard(item.project.projectId); row.remove(); if (!box.querySelector('.version-row')) { overlay.remove(); offering = false; } }
          catch (error) { storageError(error); }
        };
        row.append(label, recoverButton, discardButton); box.append(row);
      }
      overlay.append(box); document.body.append(overlay);
    } catch (error) { storageError(error); }
  }
  function schedule() {
    if (offering || MFC_PROJECT.suspended) return;
    clearTimeout(timer); timer = setTimeout(checkpoint, 1200);
  }
  async function init() {
    initialized = true;
    window.addEventListener('mfc:changed', schedule);
    MFC.getCanvas().on('object:modified', schedule);
    MFC.getCanvas().on('text:changed', schedule);
    document.addEventListener('change', schedule);
    document.addEventListener('input', schedule);
    setInterval(checkpoint, 15000); // bounded delay even while edits continue
    refreshStorageStatus();
    document.addEventListener('visibilitychange', () => { if (document.hidden) checkpoint(); });
    await offerRecovery();
  }
  return { init, checkpoint, markSaved, candidates, recover, discard, offerRecovery, openDB, storageError, refreshStorageStatus, DB_NAME };
})();

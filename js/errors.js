/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Unexpected errors: instead of failing silently (or only in the console), show a message that stays
   until dismissed, with "Copy details" for a bug report. The handlers never throw and close a stuck
   "Saving…" overlay, so the figure stays editable. Loaded right after debug.js, before everything else. */
const MFC_ERRORS = (() => {
  let box = null, last = null;

  function describe(error) {
    if (error instanceof Error) return error.message || error.name || 'Unknown error';
    if (typeof error === 'string') return error;
    try { return JSON.stringify(error); } catch (e) { return String(error); }
  }

  /** Plain-text report for "Copy details": what failed, where, in which version and browser. */
  function details(title, error, extra) {
    const version = (() => { try { return MFC.getAppVersion(); } catch (e) { return 'unknown'; } })();
    return [
      'FluoForge error report',
      'What: ' + title,
      'Message: ' + describe(error),
      error && error.name ? 'Type: ' + error.name : '',
      extra && extra.source ? `Where: ${extra.source}:${extra.line || 0}:${extra.column || 0}` : '',
      'Version: ' + version,
      'Time: ' + new Date().toISOString(),
      'Browser: ' + navigator.userAgent,
      'Page: ' + location.origin + location.pathname,
      error && error.stack ? '\nStack:\n' + error.stack : ''
    ].filter(Boolean).join('\n');
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* not allowed: fall back */ }
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.append(area); area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    area.remove();
    return ok;
  }

  function build() {
    box = document.createElement('div');
    box.id = 'error-toast'; box.setAttribute('role', 'alert');
    const title = document.createElement('p'); title.className = 'error-title';
    const message = document.createElement('p'); message.className = 'error-message';
    const row = document.createElement('div'); row.className = 'error-actions';
    const copyButton = document.createElement('button'); copyButton.type = 'button'; copyButton.className = 'error-copy';
    copyButton.textContent = 'Copy details'; copyButton.title = 'Copy a text report of this error, to paste into a bug report';
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'error-dismiss';
    dismiss.textContent = 'Dismiss'; dismiss.title = 'Close this message';
    const fallback = document.createElement('textarea'); fallback.className = 'error-details hidden'; fallback.readOnly = true;
    fallback.setAttribute('aria-label', 'Error details: select all and copy');
    copyButton.addEventListener('click', async () => {
      if (await copy(box.dataset.details)) { copyButton.textContent = 'Copied'; return; }
      // Clipboard refused: show the report so it can be selected and copied by hand.
      fallback.value = box.dataset.details; fallback.classList.remove('hidden'); fallback.focus(); fallback.select();
    });
    dismiss.addEventListener('click', hide);
    box.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); hide(); } });
    row.append(copyButton, dismiss);
    box.append(title, message, row, fallback);
    document.body.append(box);
  }

  function hide() { if (box) { box.classList.add('hidden'); last = null; } }

  /** Shows `title` and the error's message; "Copy details" copies the full report. */
  function report(error, { title = 'Something went wrong', extra = null } = {}) {
    try {
      MFC_DEBUG.warn('[FluoForge error]', title, error);
      if (!document.body) return;
      if (!box) build();
      const message = describe(error);
      const key = title + '\n' + message;
      const count = last && last.key === key ? last.count + 1 : 1;
      last = { key, count };
      box.querySelector('.error-title').textContent = title;
      box.querySelector('.error-message').textContent = message + (count > 1 ? ` (×${count})` : '');
      box.dataset.details = details(title, error, extra);
      box.querySelector('.error-copy').textContent = 'Copy details';
      box.querySelector('.error-details').classList.add('hidden');
      box.classList.remove('hidden');
      // A failure in the middle of a save or load must not leave the screen blocked.
      try { if (typeof MFC_UI !== 'undefined') MFC_UI.hideSavingDialog(); } catch (e) { /* not ready yet */ }
    } catch (e) { /* reporting must never throw */ }
  }

  window.addEventListener('error', event => {
    if (!(event instanceof ErrorEvent)) return; // failed <img>/<script> loads are not script errors
    event.preventDefault();
    report(event.error || event.message, { title: 'Unexpected error',
      extra: { source: event.filename, line: event.lineno, column: event.colno } });
  });
  window.addEventListener('unhandledrejection', event => {
    event.preventDefault();
    report(event.reason, { title: 'Unexpected error in a background task' });
  });

  return { report, hide, details };
})();

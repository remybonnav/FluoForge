/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Debug logger. Silent in normal use; prints only when the page is opened with ?debug=1
   or when localStorage.fluoforgeDebug is set (for example to "1"). Turn it on from the
   browser console with  localStorage.fluoforgeDebug = '1'  and reload; remove it to turn it off.
   The image metadata these logs show is also in the Image info dialog (Channels panel). */
const MFC_DEBUG = (() => {
  function enabled() {
    try { if (new URLSearchParams(location.search).get('debug') === '1') return true; } catch (e) { /* no location */ }
    try {
      const value = localStorage.getItem('fluoforgeDebug');
      return value !== null && value !== '' && value !== '0' && value !== 'false';
    } catch (e) { return false; } // storage blocked (private mode, sandbox): stay silent
  }
  return {
    get enabled() { return enabled(); },
    log(...args) { if (enabled()) console.log(...args); },
    warn(...args) { if (enabled()) console.warn(...args); }
  };
})();

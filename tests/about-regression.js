/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* About dialog: opened from the brand, shows the licence notices and links the running version's source. */
async function runAboutRegressions() {
  const checks=[];
  const assert=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};
  const version=MFC.getAppVersion();
  const brand=document.getElementById('brand-about');
  assert('The brand is a keyboard-focusable button',brand&&brand.tagName==='BUTTON');
  assert('The top bar shows the running version',document.getElementById('app-version').textContent==='v'+version);

  brand.click();
  const dialog=document.querySelector('.about-backdrop [role="dialog"]');
  assert('Clicking the brand opens the About dialog',!!dialog&&dialog.getAttribute('aria-modal')==='true');
  assert('The dialog shows the version',dialog.querySelector('#about-version').textContent==='v'+version);
  assert('The dialog shows the copyright line',/Copyright \(C\) 2026 Remy Bonnavion/.test(dialog.textContent));
  const licence=[...dialog.querySelectorAll('a')].find(a=>/GNU Affero General Public License v3\.0 only/.test(a.textContent));
  assert('The licence line links to the LICENSE',!!licence&&licence.getAttribute('href')==='LICENSE');
  const source=dialog.querySelector('#about-source');
  assert('The source link points to the tag of the running version',
    source.href==='https://github.com/remybonnav/FluoForge/tree/v'+version&&source.href.includes(version));
  const hrefs=[...dialog.querySelectorAll('a')].map(a=>a.getAttribute('href'));
  assert('The commercial licence and third-party notices are linked',hrefs.includes('COMMERCIAL-LICENSE.md')&&hrefs.includes('THIRD-PARTY-NOTICES.md'));
  assert('The Close button has focus when the dialog opens',document.activeElement===dialog.querySelector('#about-close'));

  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert('Tab from the last control wraps to the first link',document.activeElement===dialog.querySelector('a'));
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert('Escape closes the dialog',!document.querySelector('.about-backdrop'));
  assert('Focus returns to the brand after closing',document.activeElement===brand);

  brand.click();
  document.getElementById('about-close').click();
  assert('The Close button closes the dialog',!document.querySelector('.about-backdrop'));
  return checks;
}

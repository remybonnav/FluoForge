/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Offline and self-contained: every library is vendored, pinned by hash, and a strict CSP blocks third-party requests. */
async function runOfflineRegressions() {
  const checks=[];
  const assert=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};
  const POLICY="default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'";
  const sameOrigin=url=>new URL(url,location.href).origin===location.origin;

  const csp=document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  assert('The page declares the strict Content-Security-Policy',!!csp&&csp.getAttribute('content')===POLICY);
  const scripts=[...document.querySelectorAll('script[src]')].map(s=>s.getAttribute('src'));
  assert('Every script is loaded from this site',scripts.length>=12&&scripts.every(sameOrigin));
  assert('Every library script comes from assets/vendor',['fabric.min.js','UTIF.js','jspdf.umd.min.js','jszip.min.js','pako.min.js','svg2pdf.umd.min.js']
    .every(name=>scripts.includes('assets/vendor/'+name)));
  assert('Every stylesheet and icon is loaded from this site',[...document.querySelectorAll('link[href]')].every(l=>sameOrigin(l.getAttribute('href'))));
  assert('The vendored libraries are loaded',typeof fabric==='object'&&typeof fabric.Canvas==='function'&&typeof UTIF==='object'&&
    typeof jspdf==='object'&&typeof jspdf.jsPDF==='function'&&typeof JSZip==='function'&&typeof pako==='object'&&typeof svg2pdf==='object');
  const resources=performance.getEntriesByType('resource').map(r=>r.name);
  assert('No resource was requested from another origin',resources.length>0&&resources.every(url=>/^(blob|data):/.test(url)||sameOrigin(url)));

  // The policy is enforced, not just declared: a third-party image is refused before any request is made.
  const violation=await new Promise(resolve=>{
    const done=event=>{document.removeEventListener('securitypolicyviolation',done);resolve(event);};
    document.addEventListener('securitypolicyviolation',done);
    new Image().src='https://example.com/fluoforge-csp-probe.png';
    setTimeout(()=>done(null),2000);
  });
  assert('The browser blocks a third-party image under the policy',!!violation&&violation.effectiveDirective==='img-src');
  let blockedFetch=false;
  try{await fetch('https://example.com/fluoforge-csp-probe');}catch(e){blockedFetch=true;}
  assert('The browser blocks a third-party fetch under the policy',blockedFetch);

  // assets/vendor/VERSIONS.md pins every vendored file by SHA-256.
  const versions=await (await fetch('assets/vendor/VERSIONS.md',{cache:'no-store'})).text();
  const pins=[...versions.matchAll(/`(assets\/vendor\/[^`]+)`[^\n]*?`([0-9a-f]{64})`/g)].map(m=>({path:m[1],hash:m[2]}));
  assert('VERSIONS.md pins all eight vendored files (six libraries, pdf.js and its worker)',pins.length===8);
  assert('pdf.js is not loaded until a PDF is imported',!document.querySelector('script[src*="pdfjs"]'));
  for(const pin of pins){
    const bytes=await (await fetch(pin.path,{cache:'no-store'})).arrayBuffer();
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    assert('SHA-256 of '+pin.path+' matches VERSIONS.md',digest===pin.hash);
  }
  for(const name of ['fabric','utif','jspdf','jszip','pako','svg2pdf','pdfjs','matplotlib','mpl-colormaps']){
    const response=await fetch('assets/vendor/LICENSE-'+name+'.txt',{cache:'no-store'});
    assert('Licence file for '+name+' is bundled',response.ok&&(await response.text()).length>200);
  }
  return checks;
}

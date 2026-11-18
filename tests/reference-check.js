/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Reference exports: reopen tests/fixtures/reference.mfcproj.zip, export it again and compare with the
   stored reference.svg (structurally), reference.tif (pixels) and reference.pdf (pixels, rendered with
   pdf.js). Runs inside the app page; tests/run-headless.mjs loads it after pdf.js. */

const REFERENCE_TOLERANCE = {
  number: 0.02,          // absolute tolerance for numbers in SVG attributes (document pixels)
  channel: 24,           // per-channel difference (0-255) above which a pixel counts as different
  differentFraction: 0.002, // at most 0.2 % of pixels may differ by more than `channel`
  meanAbs: 0.6           // mean absolute channel difference over the whole image
};

const referenceBytes = async path => new Uint8Array(await (await fetch(path, { cache: 'no-store' })).arrayBuffer());
function referenceBase64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }

/** Open a project archive and export page 1 as SVG and TIFF, and every page as PDF. */
async function exportReferenceProject(archiveBytes) {
  await MFC_PROJECT.loadProject(new File([archiveBytes], 'reference.mfcproj.zip'));
  await document.fonts.ready;
  const svg = (await MFC_EXPORT.buildSVG()).svg;
  const tif = new Uint8Array(await (await MFC_EXPORT.buildTIFF()).blob.arrayBuffer());
  const pdf = new Uint8Array(await (await MFC_EXPORT.buildPDF()).blob.arrayBuffer());
  return { svg, tif, pdf };
}

/** Pixel statistics between two RGBA buffers of the same size. */
function comparePixels(a, b, width, height, what) {
  if (a.length !== b.length) throw new Error(what + ': size differs');
  let different = 0, sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    let worst = 0;
    for (let c = 0; c < 4; c++) { const d = Math.abs(a[i + c] - b[i + c]); sum += d; if (d > worst) worst = d; }
    if (worst > REFERENCE_TOLERANCE.channel) different++;
  }
  const pixels = width * height, stats = { differentFraction: different / pixels, meanAbs: sum / (pixels * 4) };
  if (stats.differentFraction > REFERENCE_TOLERANCE.differentFraction || stats.meanAbs > REFERENCE_TOLERANCE.meanAbs)
    throw new Error(`${what}: ${(stats.differentFraction * 100).toFixed(3)} % of pixels differ (limit ${REFERENCE_TOLERANCE.differentFraction * 100} %), mean difference ${stats.meanAbs.toFixed(3)} (limit ${REFERENCE_TOLERANCE.meanAbs})`);
  return stats;
}

async function decodeDataImage(href) {
  const image = new Image(); image.src = href; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

/** Structural SVG comparison: same element tree and attributes; numbers within tolerance;
    generated ids normalised by order of appearance; embedded images compared by pixels. */
async function compareSVG(actualText, expectedText) {
  const parse = text => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('SVG does not parse');
    const ids = new Map();
    doc.querySelectorAll('[id]').forEach((el, i) => ids.set(el.id, 'id' + i));
    return { root: doc.documentElement, ids };
  };
  const A = parse(actualText), E = parse(expectedText);
  const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
  const normalise = (value, ids) => value.replace(/#([\w.:-]+)/g, (m, id) => ids.has(id) ? '#' + ids.get(id) : m);
  const sameValue = (a, e) => {
    if (a === e) return true;
    const na = a.match(NUMBER) || [], ne = e.match(NUMBER) || [];
    if (a.replace(NUMBER, '#') !== e.replace(NUMBER, '#') || na.length !== ne.length) return false;
    return na.every((n, i) => { const x = parseFloat(n), y = parseFloat(ne[i]); return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) <= REFERENCE_TOLERANCE.number : n === ne[i]; });
  };
  let elements = 0, images = 0;
  const walk = async (a, e, where) => {
    elements++;
    if (a.tagName !== e.tagName) throw new Error(`SVG ${where}: <${a.tagName}> instead of <${e.tagName}>`);
    const names = el => [...el.attributes].map(x => x.name).sort().join(' ');
    if (names(a) !== names(e)) throw new Error(`SVG ${where} <${a.tagName}>: attributes [${names(a)}] instead of [${names(e)}]`);
    for (const attr of e.attributes) {
      const av = a.getAttribute(attr.name), ev = attr.value;
      if (attr.name === 'id') continue;
      if (/^data:image\//.test(ev)) {
        const [pa, pe] = await Promise.all([decodeDataImage(av), decodeDataImage(ev)]);
        if (pa.width !== pe.width || pa.height !== pe.height) throw new Error(`SVG ${where}: embedded image is ${pa.width}x${pa.height}, expected ${pe.width}x${pe.height}`);
        comparePixels(pa.data, pe.data, pa.width, pa.height, `SVG ${where} embedded image`); images++;
        continue;
      }
      if (!sameValue(normalise(av, A.ids), normalise(ev, E.ids))) throw new Error(`SVG ${where} <${a.tagName}> ${attr.name}="${av.slice(0, 120)}" expected "${ev.slice(0, 120)}"`);
    }
    const text = el => [...el.childNodes].filter(n => n.nodeType === 3 || n.nodeType === 4).map(n => n.nodeValue).join('').trim();
    if (!sameValue(text(a), text(e))) throw new Error(`SVG ${where} <${a.tagName}>: text "${text(a).slice(0, 80)}" expected "${text(e).slice(0, 80)}"`);
    const ac = [...a.children], ec = [...e.children];
    if (ac.length !== ec.length) throw new Error(`SVG ${where} <${a.tagName}>: ${ac.length} children, expected ${ec.length}`);
    for (let i = 0; i < ec.length; i++) await walk(ac[i], ec[i], where + '/' + ec[i].tagName + '[' + i + ']');
  };
  await walk(A.root, E.root, 'svg');
  return { elements, images };
}

function decodeTiffRGBA(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const ifd = UTIF.decode(buffer)[0]; UTIF.decodeImage(buffer, ifd);
  return { width: ifd.width, height: ifd.height, data: UTIF.toRGBA8(ifd) };
}

async function rasterisePDF(bytes) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n), viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas'); canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({ width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data });
  }
  await doc.destroy();
  return pages;
}

/** Used by `npm run make-reference`: build, save, reopen and export the reference figure. */
async function makeReferenceOutputs() {
  const archive = new Uint8Array(await (await buildReferenceFigure()).arrayBuffer());
  const out = await exportReferenceProject(archive);
  return { archive: referenceBase64(archive), svg: out.svg, tif: referenceBase64(out.tif), pdf: referenceBase64(out.pdf) };
}

async function runReferenceCheck() {
  const checks = [];
  const assert = (name, ok) => { if (!ok) throw new Error(name); checks.push(name); };
  const base = 'tests/fixtures/';
  const archive = await referenceBytes(base + 'reference.mfcproj.zip');
  const out = await exportReferenceProject(archive);
  const objects = MFC.getCanvas().getObjects().filter(o => !MFC.isHelper(o));
  assert('The reference project opens with all its objects', objects.length >= 14);
  const types = new Set(objects.map(o => o.mfcIsInset ? 'inset' : o.mfcType === 'scalebar' ? 'scalebar' : o.type === 'group' ? 'group' : o.mfcShapeKind || o.mfcType));
  assert('The reference project contains every object type', ['mfcImage', 'inset', 'insetContour', 'scalebar', 'text', 'rect', 'ellipse', 'path', 'group']
    .every(t => types.has(t)) && objects.some(o => o.clipPath));

  const svg = await compareSVG(out.svg, await (await fetch(base + 'reference.svg', { cache: 'no-store' })).text());
  assert(`SVG export matches reference.svg structurally (${svg.elements} elements, ${svg.images} embedded images)`, svg.elements > 20 && svg.images >= 4);

  const actualTif = decodeTiffRGBA(out.tif), expectedTif = decodeTiffRGBA(await referenceBytes(base + 'reference.tif'));
  assert('TIFF export has the reference size', actualTif.width === expectedTif.width && actualTif.height === expectedTif.height);
  const tif = comparePixels(actualTif.data, expectedTif.data, actualTif.width, actualTif.height, 'TIFF');
  assert(`TIFF export matches reference.tif (${(tif.differentFraction * 100).toFixed(3)} % pixels differ, mean ${tif.meanAbs.toFixed(3)})`, true);

  const actualPdf = await rasterisePDF(out.pdf), expectedPdf = await rasterisePDF(await referenceBytes(base + 'reference.pdf'));
  assert('PDF export has the reference page count', actualPdf.length === expectedPdf.length && actualPdf.length === 2);
  actualPdf.forEach((page, i) => {
    const e = expectedPdf[i];
    assert(`PDF page ${i + 1} has the reference size`, page.width === e.width && page.height === e.height);
    const s = comparePixels(page.data, e.data, page.width, page.height, `PDF page ${i + 1}`);
    assert(`PDF page ${i + 1} matches reference.pdf (${(s.differentFraction * 100).toFixed(3)} % pixels differ, mean ${s.meanAbs.toFixed(3)})`, true);
  });
  return checks;
}

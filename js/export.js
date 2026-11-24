/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Vector SVG/PDF exports share a source-resolution image compositor with flattened TIFF. */
const MFC_EXPORT = (() => {
  const FONTS = { 'Liberation Sans': 'LiberationSans', 'Liberation Serif': 'LiberationSerif', 'Liberation Mono': 'LiberationMono' };
  const STYLES = { normal: 'Regular', bold: 'Bold', italic: 'Italic', bolditalic: 'BoldItalic' };
  const fontBytes = new Map();
  let exporting = false;
  // The figure report (an ES module) embedded in SVG and PDF exports.
  const REPORT_URL = new URL('ui/figure-report.js', document.currentScript?.src || new URL('js/', document.baseURI)).href;
  const reportModule = () => import(REPORT_URL);
  // TIFF and PNG writers (an ES module): Deflate or LZW TIFF, PNG pHYs.
  const ENCODERS_URL = new URL('image/raster-encoders.js', document.currentScript?.src || new URL('js/', document.baseURI)).href;
  const encoders = () => import(ENCODERS_URL);
  // Pen path helpers (arrow ends of capped lines), loaded before an SVG is built.
  const PATH_URL = new URL('tools/path.js', document.currentScript?.src || new URL('js/', document.baseURI)).href;
  let pathTools = null;
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function base64(buffer) {
    const bytes = new Uint8Array(buffer); let str = '';
    for (let i=0; i<bytes.length; i+=16384) str += String.fromCharCode(...bytes.subarray(i,i+16384));
    return btoa(str);
  }
  async function fontData(family, style) {
    const path = 'assets/fonts/' + FONTS[family] + '-' + STYLES[style] + '.ttf';
    if (!fontBytes.has(path)) fontBytes.set(path, fetch(path).then(response => {
      if (!response.ok) throw new Error('Could not load export font: ' + family); return response.arrayBuffer();
    }).then(base64));
    return fontBytes.get(path);
  }
  function walk(objects, fn) { objects.forEach(obj => { if (obj.visible === false) return; fn(obj); if (obj.getObjects) walk(obj.getObjects(), fn); else if (obj.objects) walk(obj.objects, fn); }); }
  function fontUse(objects) {
    const used = new Map();
    walk(objects, obj => {
      if (!['text','textbox','i-text'].includes(obj.type)) return;
      obj.text.split('\n').forEach((line, lineIndex) => Array.from(line).forEach((char, index) => {
        const overrides = obj.styles?.[lineIndex]?.[index] || {};
        const family = overrides.fontFamily || obj.fontFamily;
        const weight = overrides.fontWeight || obj.fontWeight;
        const italic = overrides.fontStyle || obj.fontStyle;
        const style = (weight === 'bold' || Number(weight) >= 600 ? 'bold' : '') + (italic === 'italic' ? 'italic' : '') || 'normal';
        const key = family + ':' + style;
        if (!used.has(key)) used.set(key, { family, style, text: '' });
        used.get(key).text += char;
      }));
    });
    return [...used.values()];
  }
  function preflight(objects, pdf) {
    const unsupported = new Set();
    walk(objects, o => {
      if (o.shadow) unsupported.add('object shadows');
      if (o.globalCompositeOperation && o.globalCompositeOperation !== 'source-over') unsupported.add('blend mode ' + o.globalCompositeOperation);
      if (o.clipPath?.inverted) unsupported.add('inverted clipping masks');
      if (o.filters?.length) unsupported.add('Fabric image filters');
    });
    if (pdf) fontUse(objects).forEach(({family}) => { if (!FONTS[family]) unsupported.add('font "' + family + '" (choose a Liberation font in the editor)'); });
    if (unsupported.size) throw new Error('Export cannot preserve: ' + [...unsupported].join('; ') + '. No file was exported.');
  }
  // Fabric writes strokeUniform outlines as a scaled transform plus
  // vector-effect="non-scaling-stroke". Inkscape and svg2pdf scale the dash pattern
  // and stroke with that transform anyway (huge dashes that break on resize), so these
  // outlines are written as paths already in their parent's coordinates instead: no
  // transform, no vector-effect, dashes and stroke width in plain document units.
  function outlineCommands(obj) {
    // Pen paths with arrowheads: the line stops inside each arrowhead (pathStrokeCommands).
    if (obj.type === 'path') return ((pathTools && pathTools.pathStrokeCommands(obj)) || obj.path).map(([type, ...v]) => [type.toUpperCase(),
      ...v.map((n, i) => n - (i % 2 ? obj.pathOffset.y : obj.pathOffset.x))]);
    if (obj.type === 'rect' && !(obj.rx > 0) && !(obj.ry > 0)) {
      const w = obj.width / 2, h = obj.height / 2;
      return [['M',-w,-h],['L',w,-h],['L',w,h],['L',-w,h],['Z']];
    }
    if (obj.type === 'ellipse' || obj.type === 'circle') {
      const rx = obj.type === 'circle' ? obj.radius : obj.rx, ry = obj.type === 'circle' ? obj.radius : obj.ry, k = 0.5522847498;
      return [['M',rx,0],['C',rx,ry*k,rx*k,ry,0,ry],['C',-rx*k,ry,-rx,ry*k,-rx,0],
        ['C',-rx,-ry*k,-rx*k,-ry,0,-ry],['C',rx*k,-ry,rx,-ry*k,rx,0],['Z']];
    }
    return null;
  }
  function bakeUniformStroke(obj) {
    if (!obj.strokeUniform || !obj.stroke || !(obj.strokeWidth > 0) || obj.clipPath) return;
    const commands = outlineCommands(obj);
    if (!commands) return;
    const fixed = n => fabric.util.toFixed(n, fabric.Object.NUM_FRACTION_DIGITS);
    obj.toSVG = function () {
      const matrix = this.calcOwnMatrix();
      const at = (x, y) => { const p = fabric.util.transformPoint(new fabric.Point(x, y), matrix); return fixed(p.x) + ' ' + fixed(p.y); };
      const d = commands.map(([type, ...v]) => type + (v.length ? ' ' + v.reduce((out, n, i) => i % 2 ? out.concat(at(v[i-1], n)) : out, []).join(' ') : '')).join(' ');
      // The editor draws a uniform stroke in document pixels; inside a scaled group the
      // group's own transform still applies, so divide that scale back out.
      const groupScale = this.group ? Math.sqrt(Math.abs(fabric.util.qrDecompose(this.group.calcTransformMatrix()).scaleX *
        fabric.util.qrDecompose(this.group.calcTransformMatrix()).scaleY)) || 1 : 1;
      let style = this.getSvgStyles();
      style = style.replace(/stroke-width: [^;]+;/, 'stroke-width: ' + fixed(this.strokeWidth / groupScale) + ';');
      if (this.strokeDashArray && this.strokeDashArray.length)
        style = style.replace(/stroke-dasharray: [^;]+;/, 'stroke-dasharray: ' + this.strokeDashArray.map(n => fixed(n / groupScale)).join(' ') + ';');
      const markup = ['<path style="' + style + '" d="' + d + '" />\n'];
      // Pen paths: arrowheads are filled triangles in the same command coordinates.
      if (this.mfcShapeKind === 'path' && MFC.pathArrowGeometry) for (const atStart of [true, false]) {
        if ((atStart ? this.mfcArrowStart : this.mfcArrowEnd) !== 'arrow') continue;
        const tri = MFC.pathArrowGeometry(this, atStart);
        if (tri) markup.push('<polygon points="' + tri.map(p => at(p.x - this.pathOffset.x, p.y - this.pathOffset.y).replace(' ', ',')).join(' ') +
          '" fill="' + String(this.stroke).replace(/"/g, '') + '" stroke="none" opacity="' + this.opacity + '" />\n');
      }
      return markup.join('');
    };
  }
  /** Builds the SVG of one page (0-based). Only objects overlapping that page are included.
      scale > 1 composites the images with more pixels, for a raster export above the document DPI
      (still never beyond their source pixels); transparent leaves out the white page background.
      With `bounds` (document px) and `only` (top-level mfcIds), it draws just those objects, cropped to
      that box instead of a page: used to copy a selection to other software. */
  async function buildSVG({ pdf = false, page = 0, scale = 1, transparent = false, bounds: area = null, only = null } = {}) {
    if (!MFC.hasDocument) throw new Error('Create or open a figure before exporting.');
    pathTools ||= await import(PATH_URL);
    const state = MFC_PROJECT.captureState();
    if (only) state.objects = state.objects.filter(json => only.has(json.mfcId));
    const pageCount = MFC.pageCount(state.docProps);
    if (!area && !(page >= 0 && page < pageCount)) throw new Error('There is no page ' + (page + 1) + '.');
    const bounds = area || MFC.pageBounds(page, state.docProps);
    preflight(state.objects, pdf);
    const size = area ? { width: Math.max(1, Math.ceil(area.width)), height: Math.max(1, Math.ceil(area.height)) } : MFC.docPropsToPixels(state.docProps);
    if (size.width < 1 || size.height < 1 || !Number.isFinite(size.width + size.height)) throw new Error('Invalid document size.');
    const registry = {}, canvas = new fabric.StaticCanvas(null, { width: size.width, height: size.height, backgroundColor: transparent ? null : '#ffffff', renderOnAddRemove: false });
    const imageDetails = [];
    try {
      for (const json of state.objects) {
        if (json.mfcType === 'layoutGrid') continue; // a layout grid only guides editing: its panels and labels are exported
        const obj = await MFC_PROJECT.restoreObject(json, registry, true);
        const box = obj.getBoundingRect(true, true);
        if (box.left >= bounds.left + bounds.width || box.left + box.width <= bounds.left ||
            box.top >= bounds.top + bounds.height || box.top + box.height <= bounds.top) continue;
        // Pages sit one below the other in the editor; each exported page starts at 0,0.
        obj.set({ left: obj.left - bounds.left, top: obj.top - bounds.top });
        obj.setCoords();
        canvas.add(obj);
      }
      preflight(canvas.getObjects(), pdf);
      walk(canvas.getObjects(), bakeUniformStroke);
      await document.fonts.ready;
      const images = [];
      walk(canvas.getObjects(), image => { if (image.mfcType === 'mfcImage') images.push(image); });
      for (const image of images) {
        const entry = registry[image.mfcId], raw = entry.rawImage;
        const previewW = Math.round(raw.width * entry.workingScale), previewH = Math.round(raw.height * entry.workingScale);
        const rx = raw.width / previewW, ry = raw.height / previewH;
        const region = { x: image.cropX * rx, y: image.cropY * ry, width: image.width * rx, height: image.height * ry };
        const matrix = image.calcTransformMatrix();
        // Document pixels are the requested output DPI. Groups, rotations and scaling
        // are included; no panel is enlarged beyond its original source resolution.
        const outW = Math.max(1, Math.min(Math.ceil(region.width), Math.ceil(image.width * Math.hypot(matrix[0],matrix[1]) * scale)));
        const outH = Math.max(1, Math.min(Math.ceil(region.height), Math.ceil(image.height * Math.hypot(matrix[2],matrix[3]) * scale)));
        // Recomposited from the source planes at the output size: area-averaged when the panel
        // is printed smaller than its source region, never enlarged beyond it.
        const raster = await MFC_TIFF.composite(raw, 1, region, outW, outH);
        const href = raster.toDataURL('image/png');
        imageDetails.push({ id: image.mfcId, sourceId: entry.sourceId, sourceWidth: raw.width, sourceHeight: raw.height,
          previewWidth: previewW, width: outW, height: outH, region });
        // Bake only the image's crop into its own raster. Keep the Fabric geometry and
        // SVG wrapper intact, including nested transforms, object clip paths and opacity.
        image._toSVG = function () { return ['<image ', 'COMMON_PARTS', ' x="', -this.width/2,
          '" y="', -this.height/2, '" width="', this.width, '" height="', this.height,
          '" preserveAspectRatio="none" xlink:href="', href, '" />\n']; };
      }
      let svg = canvas.toSVG({ suppressPreamble: true, viewBox: { x:0,y:0,width:size.width,height:size.height } });
      // Embed the same licensed TTF used by the browser, making standalone SVG/TIFF
      // rendering independent of fonts installed on the recipient's machine.
      const fonts = fontUse(canvas.getObjects());
      const faces = [];
      for (const {family,style} of fonts.filter(f => FONTS[f.family])) {
        const data = await fontData(family,style);
        faces.push(`@font-face{font-family:'${family}';font-style:${style.includes('italic')?'italic':'normal'};font-weight:${style.includes('bold')?'700':'400'};src:url(data:font/ttf;base64,${data}) format('truetype');}`);
      }
      svg = svg.replace('<defs>', '<defs><style type="text/css"><![CDATA[' + faces.join('\n') + ']]></style>');
      // The figure report of this page (js/ui/figure-report.js), so the file carries its own provenance.
      // (Not for a selection copied to other software: the report describes whole pages.)
      const reports = await reportModule(), report = area ? null : reports.buildReport({ page });
      if (report) svg = svg.replace('<defs>', '<metadata id="fluoforge-report">' + reports.toEmbeddedJSON(report) + '</metadata>\n<defs>');
      return { svg, report, width: size.width, height: size.height, dpi: state.docProps.dpi, fonts, imageDetails, page, pageCount, transparent };
    } finally { canvas.dispose(); }
  }
  /** The SVG with its physical size on the root element (width="101.6mm" height="67.7333mm"), the viewBox
      staying in document pixels. Without units, Inkscape and Illustrator read the size as CSS pixels (96 per
      inch), so a 600 dpi page opened 6.25 times too large. The unit is the document's (cm or in), mm for
      documents in pixels; at most 4 decimals. Used for SVG files only: rasterising and the PDF keep pixels. */
  function svgWithPhysicalSize(svg, { width, height, dpi, unit = 'px' }) {
    const [name, perInch] = unit === 'in' ? ['in', 1] : unit === 'cm' ? ['cm', 2.54] : ['mm', 25.4];
    const size = px => String(Number((px / dpi * perInch).toFixed(4))) + name;
    const open = svg.match(/<svg\b[^>]*>/);
    if (!open || !/\swidth="[^"]*"/.test(open[0]) || !/\sheight="[^"]*"/.test(open[0]) || !/\sviewBox="/.test(open[0]))
      throw new Error('Could not set the SVG page size: the exported SVG has no width, height or viewBox.');
    const tag = open[0].replace(/(\swidth=")[^"]*"/, `$1${size(width)}"`).replace(/(\sheight=")[^"]*"/, `$1${size(height)}"`);
    return svg.slice(0, open.index) + tag + svg.slice(open.index + open[0].length);
  }
  /** One PDF page per figure page (or per page of `pages`, 0-based). */
  async function buildPDF({ pages = null } = {}) {
    let pdf = null, first = null;
    const registered = new Set(), pageCount = MFC.pageCount(MFC.getDocProps());
    const list = pages || Array.from({ length: pageCount }, (_, i) => i);
    for (const page of list) {
      const output = await buildSVG({ pdf: true, page });
      const widthPt = output.width / output.dpi * 72, heightPt = output.height / output.dpi * 72;
      const orientation = widthPt >= heightPt ? 'landscape' : 'portrait';
      if (!pdf) {
        pdf = new window.jspdf.jsPDF({ unit: 'pt', format: [widthPt,heightPt], orientation, compress: true, putOnlyUsedFonts: true });
        // Document properties: the figure report of every page as JSON in Subject (ASCII only).
        pdf.setDocumentProperties({ title: MFC.getDocProps().name || 'Figure', creator: 'FluoForge ' + MFC.getAppVersion(),
          subject: (await reportModule()).toEmbeddedJSON((await reportModule()).buildReport()), keywords: 'FluoForge figure report' });
      }
      else pdf.addPage([widthPt,heightPt], orientation);
      for (const {family,style,text} of output.fonts) {
        const filename = FONTS[family] + '-' + STYLES[style] + '.ttf';
        if (!registered.has(filename)) { pdf.addFileToVFS(filename, await fontData(family,style)); pdf.addFont(filename,family,style); registered.add(filename); }
        const metadata = pdf.getFont(family,style).metadata;
        const missing = [...new Set(Array.from(text).filter(char => !/\s/.test(char) && !metadata.characterToGlyph(char.codePointAt(0))))];
        if (missing.length) throw new Error('Font "' + family + '" has no PDF glyphs for: ' + missing.join(' ') + '. Change these labels before export.');
      }
      const svg = new DOMParser().parseFromString(output.svg, 'image/svg+xml').documentElement;
      if (svg.querySelector('parsererror')) throw new Error('Could not construct export SVG.');
      // svg2pdf handles these Fabric SVG paths/text/groups as PDF drawing/text operators.
      // There is deliberately no whole-page PNG fallback.
      await pdf.svg(svg, { x:0,y:0,width:widthPt,height:heightPt });
      if (!first) first = output;
    }
    return { blob: pdf.output('blob'), ...first, pageCount: list.length };
  }
  /** Rasterises an SVG export at scale × its document size; transparent keeps the background clear. */
  async function renderSVG(output, { scale = 1, transparent = false } = {}) {
    const url = URL.createObjectURL(new Blob([output.svg], { type:'image/svg+xml' }));
    try {
      const image = await new Promise((resolve,reject) => { const i = new Image(); i.onload=()=>resolve(i); i.onerror=()=>reject(new Error('SVG raster rendering failed')); i.src=url; });
      const canvas = document.createElement('canvas'); canvas.width=Math.round(output.width*scale); canvas.height=Math.round(output.height*scale);
      const ctx=canvas.getContext('2d');
      if (!transparent) { ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height); }
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      return canvas;
    } finally { URL.revokeObjectURL(url); }
  }
  /** Raster options: dpi (default: the document's), transparent background. */
  const rasterScale = dpi => { const docDpi = MFC.getDocProps().dpi; return dpi && dpi > 0 ? dpi / docDpi : 1; };
  /** TIFF of one page: Deflate-compressed by default (or 'lzw' / 'none'), with the resolution tags, in
      pixels per inch, or per centimetre with resolutionUnit 'cm'. */
  async function buildTIFF({ page = 0, dpi = null, transparent = false, compression = 'deflate', resolutionUnit = 'inch' } = {}) {
    const scale = rasterScale(dpi), output = await buildSVG({ page, scale, transparent }), canvas = await renderSVG(output, { scale, transparent });
    const { encodeTIFF } = await encoders();
    const bytes = encodeTIFF(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data, canvas.width, canvas.height,
      { dpi: output.dpi * scale, unit: resolutionUnit, compression, alpha: transparent, software: 'FluoForge ' + MFC.getAppVersion() });
    return { blob:new Blob([bytes],{type:'image/tiff'}), ...output, pixelWidth: canvas.width, pixelHeight: canvas.height, outputDpi: output.dpi * scale, compression };
  }
  /** PNG of one page, with its DPI in a pHYs chunk. */
  async function buildPNG({ page = 0, dpi = null, transparent = false, bounds = null, only = null } = {}) {
    const scale = rasterScale(dpi), output = await buildSVG({ page, scale, transparent, bounds, only }), canvas = await renderSVG(output, { scale, transparent });
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG encoding failed')), 'image/png'));
    const { pngWithPhys } = await encoders();
    const bytes = pngWithPhys(new Uint8Array(await blob.arrayBuffer()), { dpi: output.dpi * scale });
    return { blob: new Blob([bytes], { type: 'image/png' }), ...output, pixelWidth: canvas.width, pixelHeight: canvas.height, outputDpi: output.dpi * scale };
  }
  /** Pages from text such as "1-3, 5" (1-based) as sorted 0-based indices; throws on anything else. */
  function parsePageRange(text, pageCount) {
    const pages = new Set(), parts = String(text || '').split(',').map(p => p.trim()).filter(Boolean);
    if (!parts.length) throw new Error('Enter the pages to export, for example 1-3, 5.');
    for (const part of parts) {
      const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) throw new Error('"' + part + '" is not a page or a range of pages.');
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
      if (a < 1 || b < a || b > pageCount) throw new Error('Pages ' + part + ' are not in this figure (it has ' + pageCount + ' page' + (pageCount > 1 ? 's' : '') + ').');
      for (let p = a; p <= b; p++) pages.add(p - 1);
    }
    return [...pages].sort((x, y) => x - y);
  }
  /** Project name as a safe file name (invalid/control characters replaced), or a default. */
  function exportBaseName() {
    const name = String(MFC.getDocProps().name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '');
    return (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? '_' + name : name).slice(0, 150) || 'figure_export';
  }
  /** Exports with the export dialog's options: { format: 'tiff' | 'png' | 'svg' | 'pdf', pages (0-based,
      default all), dpi (raster formats, pixels per inch), resolutionUnit ('inch' or 'cm': the unit the TIFF's
      resolution tags are written in), transparent (TIFF, PNG, SVG), compression (TIFF), includeReport }.
      Returns the list of files written. */
  async function exportWith({ format, pages = null, dpi = null, resolutionUnit = 'inch', transparent = false, compression = 'deflate', includeReport = false } = {}) {
    if (exporting) return [];
    if (!['tiff', 'png', 'svg', 'pdf'].includes(format)) throw new Error('Unknown export format: ' + format);
    exporting = true; MFC_UI.showSavingDialog('Rendering ' + format.toUpperCase() + '…');
    const written = [];
    // Through MFC_EXPORT.download, which a test (or a host page) may replace.
    const save = (blob, name) => { MFC_EXPORT.download(blob, name); written.push(name); };
    try {
      const pageCount = MFC.pageCount(MFC.getDocProps()), list = pages || Array.from({ length: pageCount }, (_, i) => i);
      const base = exportBaseName();
      if (format === 'pdf') {
        const output = await buildPDF({ pages: list });
        save(output.blob, base + '.pdf');
      } else {
        // SVG, TIFF and PNG are single-page formats: one file per page.
        for (const page of list) {
          if (list.length > 1) MFC_UI.showSavingDialog('Rendering ' + format.toUpperCase() + ' page ' + (page + 1) + ' (' + (list.indexOf(page) + 1) + ' of ' + list.length + ')…');
          const output = format === 'tiff' ? await buildTIFF({ page, dpi, transparent, compression, resolutionUnit }) : format === 'png' ? await buildPNG({ page, dpi, transparent })
            : await buildSVG({ page, transparent });
          save(output.blob || new Blob([svgWithPhysicalSize(output.svg, { ...output, unit: MFC.getDocProps().unit })], { type: 'image/svg+xml' }), base + (pageCount > 1 ? '_page-' + (page + 1) : '') + '.' + format);
        }
      }
      if (includeReport) {
        const reports = await reportModule(), report = reports.buildReport();
        save(new Blob([reports.toMarkdown(report)], { type: 'text/markdown' }), base + '_report.md');
        save(new Blob([reports.toJSON(report)], { type: 'application/json' }), base + '_report.json');
      }
      const files = written.length;
      MFC_UI.toast(format.toUpperCase() + ' exported' + (files > 1 ? ': ' + files + ' files.' : '.'));
      return written;
    } catch (error) { console.error(error); MFC_UI.toast(error.message); MFC_PROJECT.status(error.message); return written; }
    finally { exporting = false; MFC_UI.hideSavingDialog(); }
  }
  /** One-click export from the menu: every page at the document DPI. */
  const exportFile = kind => exportWith({ format: kind });
  return { download, exportBaseName, buildSVG, svgWithPhysicalSize, buildPDF, buildTIFF, buildPNG, renderSVG, parsePageRange, exportWith,
    exportPDF:()=>exportFile('pdf'), exportSVG:()=>exportFile('svg'), exportTIFF:()=>exportFile('tiff'), exportPNG:()=>exportFile('png') };
})();

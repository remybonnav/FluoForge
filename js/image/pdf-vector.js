/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* A PDF page as SVG (P3-T10a), so a plot saved as PDF becomes a vector panel like an SVG one.
   pdf.js reads the page into its list of drawing operators; this walks that list and writes the
   same drawing as SVG: paths with their fill, stroke, dash and transparency, clipping, text, images,
   linear and radial gradients, form XObjects and transparency groups.
   - Paths are written in page coordinates (their points mapped by the transform), so line widths
     and dashes scale with it; under a transform that stretches one way more than the other, the
     path keeps its own coordinates and a transform instead, so its lines stretch as in the PDF.
   - Text in Arial/Helvetica, Times or Courier stays text: the embedded Liberation faces have the same
     character widths, and each word is placed where the PDF places it. Text in other fonts is drawn
     with the outlines of the PDF's own glyphs (pdf.js gives them), so it looks exactly as in the PDF.
     When a font is neither (not embedded, not standard), its text is set in Liberation and named in
     the import message, as for an SVG.
   - Images inside the page (heat maps, micrographs) are embedded as PNG.
   What it cannot reproduce faithfully (ISSUES in pdf-vector-model.js) is collected; the importer
   then offers the labelled rasterised fallback instead of a drawing that would differ silently. */

import * as P from './pdf-vector-model.js';

const TIMEOUT_MS = 20000;
const HAIRLINE = 0.25; // pt: PDF's "thinnest line" (width 0), about one pixel at 300 dpi

/** An object pdf.js sends alongside the operator list (fonts, images, shadings), when it arrives. */
function object(page, id) {
  const store = String(id).startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The PDF page did not deliver its object ${id}.`)), TIMEOUT_MS);
    store.get(id, data => { clearTimeout(timer); resolve(data); }, error => { clearTimeout(timer); reject(error); });
  });
}

/** A pdf.js image (pixels or an ImageBitmap) on a canvas. `mask`: a stencil painted in `color`. */
function imageCanvas(img, mask = null) {
  const { width, height } = img;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
  else {
    const out = ctx.createImageData(width, height), d = out.data, src = img.data;
    if (mask || img.kind === 1) { // 1 bit per pixel, rows padded to a byte; a stencil paints where the bit is 0
      const row = (width + 7) >> 3;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const bit = (src[y * row + (x >> 3)] >> (7 - (x & 7))) & 1, o = (y * width + x) * 4;
        if (mask) d[o + 3] = bit ? 0 : 255;
        else { d[o] = d[o + 1] = d[o + 2] = bit ? 255 : 0; d[o + 3] = 255; }
      }
    } else if (img.kind === 3) d.set(src.subarray(0, d.length));
    else if (img.kind === 2) for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { d[i] = src[j]; d[i + 1] = src[j + 1]; d[i + 2] = src[j + 2]; d[i + 3] = 255; }
    else throw new Error(`The PDF page has an image of an unknown kind (${img.kind}).`);
    ctx.putImageData(out, 0, 0);
  }
  if (mask) { ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = mask; ctx.fillRect(0, 0, width, height); }
  return canvas;
}

function freshState(ctm) {
  return { ctm, base: ctm, fill: '#000000', stroke: '#000000', fillAlpha: 1, strokeAlpha: 1, lineWidth: 1, cap: 0, join: 0, miter: 10,
    dash: [], dashPhase: 0, font: null, fontSize: 0, fontDirection: 1, fontMatrix: [0.001, 0, 0, 0.001, 0, 0], charSpacing: 0, wordSpacing: 0,
    hScale: 1, leading: 0, rise: 0, mode: 0, textMatrix: P.IDENTITY, x: 0, y: 0, lineX: 0, lineY: 0, open: 0 };
}

/**
 * Page `page` (a pdf.js PDFPageProxy of `doc`) as SVG text, its size in points. Resolves to
 * { svg, issues: [what it could not reproduce], width, height }. `lib` is the pdf.js module.
 */
export async function pageToSVG(lib, doc, page) {
  const viewport = page.getViewport({ scale: 1 });
  const width = viewport.width, height = viewport.height;
  const list = await page.getOperatorList({ annotationMode: lib.AnnotationMode.DISABLE });
  const config = await doc.getOptionalContentConfig();
  const NAMES = {}; for (const [k, v] of Object.entries(lib.OPS)) NAMES[v] = k;
  const out = [], defs = [], issues = new Set();
  let ids = 0;
  const id = kind => kind + (++ids);
  let gs = freshState([...viewport.transform]);
  const stack = [], visible = [];
  const shown = () => visible.every(Boolean);
  const fonts = new Map(); // pdf.js font id -> its object

  const save = () => { stack.push(gs); gs = { ...gs, open: 0 }; };
  const restore = () => { if (!stack.length) return; out.push('</g>'.repeat(gs.open)); gs = stack.pop(); };
  const openGroup = attrs => { out.push(`<g ${attrs}>`); gs.open++; };

  // ---- paint ----
  const paintRef = (paint, m) => {
    if (paint && typeof paint === 'object') {
      // A gradient: its coordinates are the pattern's, mapped to the page by base · matrix, then into the
      // element's own user space (m) when it keeps a transform.
      const gm = P.multiply(paint.space, paint.matrix || P.IDENTITY);
      const local = m ? P.multiply(P.invert(m) || P.IDENTITY, gm) : gm;
      const gid = id('g');
      defs.push(gradient(paint.ir, gid, local));
      return `url(#${gid})`;
    }
    return paint;
  };
  function gradient(ir, gid, m) {
    const [, type, , stops, p0, p1, r0, r1] = ir;
    const stopTags = stops.map(([offset, color]) => `<stop offset="${P.num(offset, 4)}" stop-color="${P.escapeXML(color)}"/>`).join('');
    const common = `id="${gid}" gradientUnits="userSpaceOnUse" gradientTransform="${P.matrixAttr(m)}"`;
    return type === 'radial'
      ? `<radialGradient ${common} fx="${P.num(p0[0])}" fy="${P.num(p0[1])}" fr="${P.num(r0)}" cx="${P.num(p1[0])}" cy="${P.num(p1[1])}" r="${P.num(r1)}">${stopTags}</radialGradient>`
      : `<linearGradient ${common} x1="${P.num(p0[0])}" y1="${P.num(p0[1])}" x2="${P.num(p1[0])}" y2="${P.num(p1[1])}">${stopTags}</linearGradient>`;
  }
  const fillAttrs = (evenOdd, m) => {
    if (gs.fill === 'none') return 'fill="none"';
    let a = `fill="${paintRef(gs.fill, m)}"`;
    if (evenOdd) a += ' fill-rule="evenodd"';
    if (gs.fillAlpha < 1) a += ` fill-opacity="${P.num(gs.fillAlpha, 4)}"`;
    return a;
  };
  // `scale`: user-space lengths to the element's; `m`: the element's own transform, if it keeps one.
  const strokeAttrs = (scale, m) => {
    if (gs.stroke === 'none') return 'stroke="none"';
    const w = gs.lineWidth > 0 ? gs.lineWidth * scale : HAIRLINE * (m ? 1 / (P.lengthScale(m).scale || 1) : scale / (P.lengthScale(gs.ctm).scale || 1));
    let a = `stroke="${paintRef(gs.stroke, m)}" stroke-width="${P.num(w, 4)}"`;
    if (gs.cap) a += ` stroke-linecap="${P.CAPS[gs.cap] || 'butt'}"`;
    if (gs.join) a += ` stroke-linejoin="${P.JOINS[gs.join] || 'miter'}"`;
    if (gs.join === 0 && gs.miter !== 4) a += ` stroke-miterlimit="${P.num(Math.max(1, gs.miter), 3)}"`;
    if (gs.dash.length && gs.dash.some(v => v > 0)) a += ` stroke-dasharray="${gs.dash.map(v => P.num(v * scale, 4)).join(' ')}"` + (gs.dashPhase ? ` stroke-dashoffset="${P.num(gs.dashPhase * scale, 4)}"` : '');
    if (gs.strokeAlpha < 1) a += ` stroke-opacity="${P.num(gs.strokeAlpha, 4)}"`;
    return a;
  };

  /** Fill and/or stroke a path in user space; `ops` is pdf.js path data. */
  function paintPath(ops, fill, evenOdd, stroke) {
    if (!shown() || (!fill && !stroke)) return;
    const { scale, uniform } = P.lengthScale(gs.ctm);
    if (uniform || !stroke) {
      const d = P.pathData(ops, gs.ctm);
      if (!d) return;
      out.push(`<path d="${d}" ${fill ? fillAttrs(evenOdd, null) : 'fill="none"'}${stroke ? ' ' + strokeAttrs(scale, null) : ''}/>`);
    } else {
      // Stretched one way more than the other: the line widths stretch too, as the PDF draws them.
      const d = P.pathData(ops, null);
      if (!d) return;
      out.push(`<path transform="${P.matrixAttr(gs.ctm)}" d="${d}" ${fill ? fillAttrs(evenOdd, gs.ctm) : 'fill="none"'} ${strokeAttrs(1, gs.ctm)}/>`);
    }
  }
  function clipTo(ops, evenOdd, m = gs.ctm) {
    const d = P.pathData(ops, m);
    const cid = id('c');
    defs.push(`<clipPath id="${cid}" clipPathUnits="userSpaceOnUse"><path d="${d || 'M0 0Z'}"${evenOdd ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
    openGroup(`clip-path="url(#${cid})"`);
  }
  const rectOps = (x0, y0, x1, y1) => [P.DRAW.moveTo, x0, y0, P.DRAW.lineTo, x1, y0, P.DRAW.lineTo, x1, y1, P.DRAW.lineTo, x0, y1, P.DRAW.closePath];

  function paintImage(canvas, m) {
    if (!shown()) return;
    // pdf.js draws an image in the unit square, its first row at the top (y = 1).
    const t = P.multiply(m, [1, 0, 0, -1, 0, 1]);
    const px = P.lengthScale(t).scale / Math.sqrt(canvas.width * canvas.height);
    out.push(`<image x="0" y="0" width="1" height="1" preserveAspectRatio="none" transform="${P.matrixAttr(t)}"` +
      (gs.fillAlpha < 1 ? ` opacity="${P.num(gs.fillAlpha, 4)}"` : '') + (px >= 1 ? ' style="image-rendering:pixelated"' : '') +
      ` href="${canvas.toDataURL('image/png')}"/>`);
  }

  // ---- text ----
  async function showText(glyphs) {
    const font = gs.font;
    if (!font || !gs.fontSize) return;
    const size = gs.fontSize, dir = gs.fontDirection, hs = gs.hScale * dir;
    if (font.vertical) issues.add(P.ISSUES.vertical);
    if (gs.mode >= 4) issues.add(P.ISSUES.textClip);
    const drawn = (gs.mode & 3) !== 3 && shown();
    const fillOn = gs.mode === 0 || gs.mode === 2 || gs.mode === 4 || gs.mode === 6;
    const strokeOn = gs.mode === 1 || gs.mode === 2 || gs.mode === 5 || gs.mode === 6;
    if (font.isType3Font) return type3(glyphs, drawn);
    const base = P.multiply(P.multiply(gs.ctm, gs.textMatrix), [1, 0, 0, 1, gs.x, gs.y + gs.rise]);
    const T = P.multiply(base, dir > 0 ? [hs, 0, 0, -1, 0, 0] : [hs, 0, 0, 1, 0, 0]);
    const info = P.pdfFont(font.name || font.loadedName, font);
    const m = size * (gs.fontMatrix[0] || 0.001);
    // Stroked text: the line width is in user space; a <text> element's space is the text space.
    const textScale = (P.lengthScale(gs.textMatrix).scale * Math.abs(hs)) || 1;
    let advance = 0, run = null;
    const flush = () => {
      if (!run) return;
      if (drawn && run.text) {
        let attrs = `font-family="${P.escapeXML(info.family)}"${info.bold ? ' font-weight="bold"' : ''}${info.italic ? ' font-style="italic"' : ''} font-size="${P.num(size, 4)}"`;
        attrs += fillOn ? ' ' + fillAttrs(false, null) : ' fill="none"';
        if (strokeOn) attrs += ' ' + strokeAttrs(1 / textScale, null); // a halo or outlined text: its joins and caps too
        out.push(`<text transform="${P.matrixAttr(P.multiply(T, [1, 0, 0, 1, run.x, 0]))}" ${attrs}>${P.escapeXML(run.text)}</text>`);
      }
      run = null;
    };
    for (const g of glyphs) {
      if (typeof g === 'number') { flush(); advance -= g * size / 1000; continue; }
      const spacing = (g.isSpace ? gs.wordSpacing : 0) + gs.charSpacing;
      const writable = P.writableText(g.unicode);
      if (g.isSpace || (writable && !g.unicode.trim())) flush(); // a space: the next word is placed by itself
      else if (info.compatible && writable) {
        if (!run || gs.charSpacing) { flush(); run = { x: advance, text: '' }; }
        run.text += g.unicode;
      } else {
        flush();
        const outline = await glyphPath(font, g.fontChar);
        if (outline && drawn) {
          const gm = P.multiply(T, [size, 0, 0, -size, advance, 0]);
          out.push(`<path d="${P.pathData(outline, gm)}" ${fillOn ? fillAttrs(false, null) : 'fill="none"'}${strokeOn ? ' ' + strokeAttrs(P.lengthScale(gs.ctm).scale, null) : ''}/>`);
          const accent = g.accent && await glyphPath(font, g.accent.fontChar);
          if (accent) out.push(`<path d="${P.pathData(accent, P.multiply(gm, [1, 0, 0, 1, g.accent.offset.x, g.accent.offset.y]))}" ${fillOn ? fillAttrs(false, null) : 'fill="none"'}/>`);
        } else if (!outline && writable) { run = { x: advance, text: g.unicode }; flush(); } // no outline: Liberation, character by character
      }
      advance += g.width * m + spacing * dir;
    }
    flush();
    gs.x += advance * hs;
  }
  const paths = new Map();
  async function glyphPath(font, ch) {
    const key = font.loadedName + '_path_' + ch;
    if (!paths.has(key)) paths.set(key, page.commonObjs.has(key) ? page.commonObjs.get(key)?.path || null : null);
    return paths.get(key);
  }
  async function type3(glyphs, drawn) {
    const size = gs.fontSize, dir = gs.fontDirection, hs = gs.hScale * dir, fm = gs.fontMatrix;
    const base = P.multiply(P.multiply(P.multiply(gs.ctm, gs.textMatrix), [1, 0, 0, 1, gs.x, gs.y + gs.rise]), [hs, 0, 0, dir, 0, 0]);
    let advance = 0;
    for (const g of glyphs) {
      if (typeof g === 'number') { advance += (gs.font.vertical ? 1 : -1) * g * size / 1000; continue; }
      const ops = gs.font.charProcOperatorList?.get(g.operatorListId);
      if (ops && drawn) {
        save();
        gs.ctm = P.multiply(P.multiply(base, [size, 0, 0, size, advance, 0]), fm);
        await walk(ops);
        restore();
      }
      advance += g.width * fm[0] * size + ((g.isSpace ? gs.wordSpacing : 0) + gs.charSpacing) * dir;
    }
    gs.x += advance * hs;
  }

  // ---- the operator list ----
  async function walk({ fnArray, argsArray }) {
    for (let i = 0; i < fnArray.length; i++) {
      const name = NAMES[fnArray[i]], a = argsArray[i] || [];
      switch (name) {
        case 'save': save(); break;
        case 'restore': restore(); break;
        case 'transform': gs.ctm = P.multiply(gs.ctm, a); break;
        case 'setLineWidth': gs.lineWidth = a[0]; break;
        case 'setLineCap': gs.cap = a[0]; break;
        case 'setLineJoin': gs.join = a[0]; break;
        case 'setMiterLimit': gs.miter = a[0]; break;
        case 'setDash': gs.dash = [...(a[0] || [])]; gs.dashPhase = a[1] || 0; break;
        case 'setGState':
          for (const [key, value] of a[0]) {
            if (key === 'LW') gs.lineWidth = value; else if (key === 'LC') gs.cap = value; else if (key === 'LJ') gs.join = value;
            else if (key === 'ML') gs.miter = value; else if (key === 'D') { gs.dash = [...(value[0] || [])]; gs.dashPhase = value[1] || 0; }
            else if (key === 'CA') gs.strokeAlpha = value; else if (key === 'ca') gs.fillAlpha = value;
            else if (key === 'Font') await setFont(value[0], value[1]);
            else if (key === 'BM') { if (value && value !== 'source-over') issues.add(P.ISSUES.blend); }
            else if (key === 'SMask') { if (value) issues.add(P.ISSUES.smask); }
            else if (key === 'TR') { if (value) issues.add(P.ISSUES.transfer); }
          }
          break;
        case 'setStrokeRGBColor': gs.stroke = a[0]; break;
        case 'setFillRGBColor': gs.fill = a[0]; break;
        case 'setStrokeTransparent': gs.stroke = 'none'; break;
        case 'setFillTransparent': gs.fill = 'none'; break;
        case 'setStrokeColorN': case 'setFillColorN': {
          const paint = await pattern(a);
          if (name === 'setFillColorN') gs.fill = paint; else gs.stroke = paint;
          break;
        }
        case 'constructPath': {
          const [op, data, minMax] = a;
          const ops = minMax ? data && data[0] : null;
          const paint = NAMES[op];
          const fill = /fill/i.test(paint), stroke = /stroke/i.test(paint), evenOdd = /eo/i.test(paint);
          if (ops) paintPath(ops, fill, evenOdd, stroke);
          if (gs.pendingClip) { clipTo(ops || [], gs.pendingClip === 'eo'); gs.pendingClip = null; }
          break;
        }
        case 'clip': gs.pendingClip = 'nz'; break;
        case 'eoClip': gs.pendingClip = 'eo'; break;
        case 'rawFillPath': issues.add(P.ISSUES.rawPath); break;
        case 'shadingFill': {
          const ir = await object(page, a[0]);
          if (ir[0] === 'RadialAxial' && shown()) {
            const gid = id('g');
            defs.push(gradient(ir, gid, gs.ctm));
            out.push(`<rect x="0" y="0" width="${P.num(width)}" height="${P.num(height)}" fill="url(#${gid})"${gs.fillAlpha < 1 ? ` fill-opacity="${P.num(gs.fillAlpha, 4)}"` : ''}/>`);
          } else if (ir[0] === 'Mesh') issues.add(P.ISSUES.mesh);
          break;
        }
        case 'paintFormXObjectBegin':
          save();
          if (a[0]) gs.ctm = P.multiply(gs.ctm, a[0]);
          gs.base = gs.ctm;
          if (a[1]) clipTo(rectOps(...a[1]), false);
          break;
        case 'paintFormXObjectEnd': restore(); break;
        case 'beginGroup': {
          const group = a[0] || {};
          save();
          if (group.smask || group.hasSoftMask) issues.add(P.ISSUES.smask);
          if (group.matrix) gs.ctm = P.multiply(gs.ctm, group.matrix);
          if (group.bbox) clipTo(rectOps(...group.bbox), false);
          if (gs.fillAlpha < 1) { openGroup(`opacity="${P.num(gs.fillAlpha, 4)}"`); gs.fillAlpha = gs.strokeAlpha = 1; }
          break;
        }
        case 'endGroup': restore(); break;
        case 'paintImageXObject': paintImage(imageCanvas(await object(page, a[0])), gs.ctm); break;
        case 'paintInlineImageXObject': paintImage(imageCanvas(a[0]), gs.ctm); break;
        case 'paintImageXObjectRepeat': {
          const canvas = imageCanvas(await object(page, a[0]));
          for (let k = 0; k < a[3].length; k += 2) paintImage(canvas, P.multiply(gs.ctm, [a[1], 0, 0, a[2], a[3][k], a[3][k + 1]]));
          break;
        }
        case 'paintImageMaskXObject': {
          const img = typeof a[0].data === 'string' ? await object(page, a[0].data) : a[0];
          if (typeof gs.fill === 'string' && gs.fill !== 'none') paintImage(imageCanvas(img, gs.fill), gs.ctm);
          break;
        }
        case 'paintImageMaskXObjectGroup':
          for (const img of a[0]) if (typeof gs.fill === 'string' && gs.fill !== 'none') {
            const pixels = typeof img.data === 'string' ? await object(page, img.data) : img;
            paintImage(imageCanvas(pixels, gs.fill), P.multiply(gs.ctm, img.transform || P.IDENTITY));
          }
          break;
        case 'paintImageMaskXObjectRepeat': {
          const img = typeof a[0].data === 'string' ? await object(page, a[0].data) : a[0];
          if (typeof gs.fill === 'string' && gs.fill !== 'none') { // [mask, scaleX, skewX, skewY, scaleY, positions]
            const canvas = imageCanvas(img, gs.fill);
            for (let k = 0; k < a[5].length; k += 2) paintImage(canvas, P.multiply(gs.ctm, [a[1], a[2], a[3], a[4], a[5][k], a[5][k + 1]]));
          }
          break;
        }
        case 'paintSolidColorImageMask': paintPath(rectOps(0, 0, 1, 1), true, false, false); break;
        case 'paintInlineImageXObjectGroup': issues.add(P.ISSUES.imageGroup); break;
        case 'beginText': gs.textMatrix = P.IDENTITY; gs.x = gs.y = gs.lineX = gs.lineY = 0; break;
        case 'endText': break;
        case 'setCharSpacing': gs.charSpacing = a[0]; break;
        case 'setWordSpacing': gs.wordSpacing = a[0]; break;
        case 'setHScale': gs.hScale = a[0] / 100; break;
        case 'setLeading': gs.leading = -a[0]; break;
        case 'setFont': await setFont(a[0], a[1]); break;
        case 'setTextRenderingMode': gs.mode = a[0]; break;
        case 'setTextRise': gs.rise = a[0]; break;
        case 'moveText': gs.x = gs.lineX += a[0]; gs.y = gs.lineY += a[1]; break;
        case 'setLeadingMoveText': gs.leading = a[1]; gs.x = gs.lineX += a[0]; gs.y = gs.lineY += a[1]; break;
        case 'setTextMatrix': gs.textMatrix = [...a[0]]; gs.x = gs.y = gs.lineX = gs.lineY = 0; break;
        case 'nextLine': gs.x = gs.lineX; gs.y = gs.lineY += gs.leading; break;
        case 'showText': case 'showSpacedText': await showText(a[0]); break;
        case 'nextLineShowText': gs.x = gs.lineX; gs.y = gs.lineY += gs.leading; await showText(a[0]); break;
        case 'nextLineSetSpacingShowText': gs.wordSpacing = a[0]; gs.charSpacing = a[1]; gs.x = gs.lineX; gs.y = gs.lineY += gs.leading; await showText(a[2]); break;
        case 'beginMarkedContent': visible.push(true); break;
        case 'beginMarkedContentProps': visible.push(a[0] === 'OC' ? config.isVisible(a[1]) : true); break;
        case 'endMarkedContent': visible.pop(); break;
        default: break; // dependency, markPoint, compatibility sections, rendering intent, flatness, Type 3 widths: nothing to draw
      }
    }
  }
  async function setFont(fontId, size) {
    if (!fonts.has(fontId)) fonts.set(fontId, await object(page, fontId));
    gs.font = fonts.get(fontId);
    gs.fontMatrix = gs.font.fontMatrix || [0.001, 0, 0, 0.001, 0, 0];
    gs.fontDirection = size < 0 ? -1 : 1;
    gs.fontSize = Math.abs(size);
  }
  async function pattern(args) {
    if (args[0] === 'TilingPattern') { issues.add(P.ISSUES.tiling); return 'none'; }
    const ir = typeof args[1] === 'string' ? await object(page, args[1]) : args[1];
    if (!ir || ir[0] === 'Dummy') return 'none';
    if (ir[0] === 'Mesh') { issues.add(P.ISSUES.mesh); return 'none'; }
    return { ir, matrix: args[2] || null, space: gs.base };
  }

  await walk(list);
  while (stack.length) restore();
  out.push('</g>'.repeat(gs.open));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${P.num(width)}pt" height="${P.num(height)}pt" viewBox="0 0 ${P.num(width)} ${P.num(height)}">` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') + out.join('') + '</svg>';
  return { svg, issues: [...issues], width, height };
}

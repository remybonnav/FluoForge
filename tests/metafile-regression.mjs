// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* P3-T10b: EMF and WMF files played into SVG (js/image/metafile.js), in Node, from files written by
   tests/metafile-writer.js: sizes and mapping modes, world transforms, pens and brushes, shapes, arcs,
   paths, clipping, text (placement, alignment, rotation, Symbol, underline, background), bitmaps,
   EMF+ (GDI+) records, WMF object slots and character sets, and what is reported as not reproduced.
   Run alone: node tests/metafile-regression.mjs */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runMetafileRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const M = await import(pathToFileURL(join(ROOT, 'js/image/metafile.js')).href);
  const { EMFWriter, WMFWriter, dib24, dib8, stretchDIBits, textW, emfPlus } = await import(pathToFileURL(join(ROOT, 'tests/metafile-writer.js')).href);
  const fails = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
  const images = [];
  const play = (bytes, name = 'test') => M.metafileToSVG(bytes, { name, image: (img, src) => { images.push({ img, src }); return 'data:image/png;base64,AAAA'; } });
  const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
  const brush = (w, ih, rgb, style = 0, hatch = 0) => w.rec(39, ['u32', ih], ['u32', style], ['u32', rgb], ['u32', hatch]).rec(37, ['u32', ih]);
  const pen = (w, ih, style, width, rgb, dashes = []) => w.rec(95, ['u32', ih], ['u32', 0], ['u32', 0], ['u32', 0], ['u32', 0], ['u32', style], ['u32', width], ['u32', 0], ['u32', rgb], ['u32', 0], ['u32', dashes.length], ...dashes.map(v => ['u32', v])).rec(37, ['u32', ih]);
  const nullPen = w => w.rec(37, ['u32', 0x80000008]);
  const poly16 = (type, pts) => [type, ['i32', 0], ['i32', 0], ['i32', 0], ['i32', 0], ['u32', pts.length], ...pts.flatMap(([x, y]) => [['i16', x], ['i16', y]])];
  const font = (w, ih, height, face, { weight = 400, italic = 0, underline = 0, escapement = 0, charset = 0 } = {}) =>
    w.rec(82, ['u32', ih], ['i32', height], ['i32', 0], ['i32', escapement], ['i32', escapement], ['i32', weight], ['u8', italic], ['u8', underline], ['u8', 0], ['u8', charset], ['u8', 0], ['u8', 0], ['u8', 0], ['u8', 0], ['utf16', face, 64]).rec(37, ['u32', ih]);

  // ---- recognising the formats ----
  const basic = new EMFWriter({ widthMM: 100, heightMM: 50, dpi: 96 });
  brush(basic, 1, 0x00b4771f); nullPen(basic); basic.rec(...poly16(86, [[0, 0], [100, 0], [100, 50]]));
  const emfBytes = basic.bytes();
  const wmf = new WMFWriter({ box: [0, 0, 1440, 720], inch: 1440 }).rec(0x02fc, ['u16', 0], ['u32', 0x0000ff], ['u16', 0]).rec(0x012d, ['u16', 0]).rec(0x041b, ['i16', 720], ['i16', 1440], ['i16', 0], ['i16', 0]).bytes();
  assert('EMF and WMF (with or without a placeable header) are recognised; other bytes are not', M.metafileKind(emfBytes) === 'emf' && M.metafileKind(wmf) === 'wmf' &&
    M.metafileKind(new WMFWriter({ placeable: false }).bytes()) === 'wmf' && M.metafileKind(new TextEncoder().encode('%PDF-1.4 not a metafile at all, no no no no')) === null);
  assert('…and so are their file names, .emz and .wmz too', ['a.emf', 'b.EMZ', 'c.wmf', 'd.wmz'].every(M.isMetafileName) && !M.isMetafileName('e.svg'));
  assert('Anything else is refused with a message', fails(() => play(new Uint8Array(64), 'x.emf'), /x\.emf is not a readable EMF or WMF file/));

  // ---- EMF: size, a fill ----
  let r = play(emfBytes);
  assert('An EMF has its frame\'s size on paper (100 × 50 mm) and a viewBox in its device pixels', r.kind === 'emf' && near(r.widthMM, 100) && near(r.heightMM, 50) &&
    /<svg [^>]*width="100mm" height="50mm" viewBox="0 0 377.953 188.976"/.test(r.svg), r.svg.slice(0, 160));
  assert('A polygon with a solid brush and the null pen: a filled path, no stroke', /<path d="M0 0L100 0L100 50Z" fill="#1f77b4" fill-rule="evenodd" stroke="none"\/>/.test(r.svg), r.svg);
  assert('An empty EMF draws nothing: refused with a message', fails(() => play(new EMFWriter().bytes(), 'empty.emf'), /empty\.emf draws nothing FluoForge can read/));

  // ---- pens ----
  let w = new EMFWriter();
  pen(w, 1, 0x10000 | 0x200 | 0x2000 | 1, 4, 0x000000ff); // geometric, flat caps, miter joins, dashed, red
  w.rec(...poly16(87, [[10, 10], [90, 10]]));
  pen(w, 2, 0, 0, 0x00ff0000); // cosmetic, blue
  w.rec(...poly16(87, [[10, 20], [90, 20]]));
  pen(w, 3, 0x10000 | 7, 2, 0x0000ff00, [6, 2]); // user-styled dashes
  w.rec(...poly16(87, [[10, 30], [90, 30]]));
  r = play(w.bytes());
  assert('A geometric pen: its width, flat caps, miter joins and dashes (3 widths on, 1 off)', /d="M10 10L90 10" fill="none" stroke="#ff0000" stroke-width="4" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="12 4"/.test(r.svg), r.svg);
  assert('A cosmetic pen is one device pixel, round', /d="M10 20L90 20" fill="none" stroke="#0000ff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/.test(r.svg));
  assert('A pen with its own dash lengths (logical units)', /d="M10 30L90 30"[^>]*stroke-dasharray="6 2"/.test(r.svg), r.svg.match(/M10 30[^>]*/)?.[0]);

  // ---- mapping and world transforms ----
  w = new EMFWriter();
  w.rec(17, ['u32', 8]).rec(9, ['i32', 1000], ['i32', 500]).rec(11, ['i32', 100], ['i32', 50]).rec(10, ['i32', 100], ['i32', 0]);
  brush(w, 1, 0); nullPen(w); w.rec(...poly16(86, [[100, 0], [600, 0], [600, 250]]));
  r = play(w.bytes());
  assert('MM_ANISOTROPIC: the window (origin, extent) maps onto the viewport', /d="M0 0L50 0L50 25Z"/.test(r.svg), r.svg.match(/<path d="[^"]*"/)?.[0]);
  w = new EMFWriter();
  w.rec(17, ['u32', 2]); // MM_LOMETRIC: 0.1 mm, y up
  brush(w, 1, 0); nullPen(w); w.rec(...poly16(86, [[0, 0], [254, 0], [254, -254]]));
  r = play(w.bytes());
  assert('MM_LOMETRIC: 0.1 mm units, y going up (25.4 mm is 96 pixels at 96 dpi)', /d="M0 0L96 0L96 96Z"/.test(r.svg), r.svg.match(/<path d="[^"]*"/)?.[0]);
  w = new EMFWriter();
  w.rec(36, ['f32', 0.0625], ['f32', 0], ['f32', 0], ['f32', 0.0625], ['f32', 0], ['f32', 0], ['u32', 2]); // Prism's 1/16
  w.rec(36, ['f32', 1], ['f32', 0], ['f32', 0], ['f32', 1], ['f32', 10], ['f32', 0], ['u32', 2]);
  brush(w, 1, 0); nullPen(w); w.rec(...poly16(86, [[0, 0], [160, 0], [160, 160]]));
  r = play(w.bytes());
  assert('World transforms multiply (Prism scales by 1/16, then a shift in those units)', /d="M0.625 0L10.625 0L10.625 10Z"/.test(r.svg), r.svg.match(/<path d="[^"]*"/)?.[0]);

  // ---- state, clipping ----
  w = new EMFWriter();
  brush(w, 1, 0); nullPen(w);
  w.rec(33).rec(30, ['i32', 10], ['i32', 10], ['i32', 50], ['i32', 40]);
  w.rec(...poly16(86, [[0, 0], [100, 0], [100, 50]])).rec(34, ['i32', -1]);
  w.rec(...poly16(86, [[0, 0], [5, 0], [5, 5]]));
  r = play(w.bytes());
  assert('A clip rectangle clips what follows, until RESTOREDC', /<clipPath id="c1" clipPathUnits="userSpaceOnUse"><path d="M10 10L50 10L50 40L10 40Z"\/><\/clipPath>/.test(r.svg) &&
    /<g clip-path="url\(#c1\)"><path d="M0 0L100 0L100 50Z"[^>]*\/><\/g><path d="M0 0L5 0L5 5Z"/.test(r.svg), r.svg);
  w = new EMFWriter();
  brush(w, 1, 0); nullPen(w);
  const rgn = [['u32', 32], ['u32', 1], ['u32', 2], ['u32', 32], ['i32', 0], ['i32', 0], ['i32', 40], ['i32', 40], ['i32', 0], ['i32', 0], ['i32', 20], ['i32', 20], ['i32', 30], ['i32', 30], ['i32', 40], ['i32', 40]];
  w.rec(75, ['u32', 64], ['u32', 5], ...rgn).rec(...poly16(86, [[0, 0], [40, 0], [40, 40]])).rec(75, ['u32', 0], ['u32', 5]).rec(...poly16(86, [[0, 0], [1, 0], [1, 1]]));
  r = play(w.bytes());
  assert('A clipping region of two rectangles, then the clip removed', /<path d="M0 0L20 0L20 20L0 20ZM30 30L40 30L40 40L30 40Z"\/>/.test(r.svg) && /<\/g><path d="M0 0L1 0L1 1Z"/.test(r.svg), r.svg);

  // ---- paths and shapes ----
  w = new EMFWriter();
  brush(w, 1, 0x00808080); nullPen(w);
  w.rec(59).rec(27, ['i32', 0], ['i32', 0]).rec(54, ['i32', 40], ['i32', 0]).rec(...poly16(88, [[40, 20], [20, 40], [0, 40]])).rec(61).rec(60).rec(62, ['i32', 0], ['i32', 0], ['i32', 0], ['i32', 0]);
  r = play(w.bytes());
  assert('A path (move, line, Béziers, close) filled once', /<path d="M0 0L40 0C40 20 20 40 0 40Z" fill="#808080"/.test(r.svg), r.svg);
  w = new EMFWriter();
  brush(w, 1, 0x00808080); pen(w, 2, 0x10000, 1, 0);
  w.rec(42, ['i32', 0], ['i32', 0], ['i32', 40], ['i32', 20]);
  w.rec(47, ['i32', 0], ['i32', 0], ['i32', 40], ['i32', 40], ['i32', 40], ['i32', 20], ['i32', 20], ['i32', 0]);
  w.rec(44, ['i32', 0], ['i32', 0], ['i32', 40], ['i32', 20], ['i32', 10], ['i32', 10]);
  r = play(w.bytes());
  const paths = [...r.svg.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
  assert('An ellipse: four Bézier quarters through its extremes', /^M40 10C40 15\.523 31\.046 20 20 20C/.test(paths[0]) && (paths[0].match(/C/g) || []).length === 4, paths[0]);
  assert('A pie from the right (0°) counter-clockwise to the top (90°): the arc, then the centre', /^M40 20C40 8\.954 31\.046 0 20 0L20 20Z$/.test(paths[1]), paths[1]);
  assert('A rounded rectangle: four corners and four sides', (paths[2].match(/C/g) || []).length === 4 && (paths[2].match(/L/g) || []).length === 3 && paths[2].endsWith('Z'), paths[2]);
  const arc = M.arcPoints(0, 0, 10, 5, 0, Math.PI);
  assert('Arc points: two quarters, ending on the ellipse', arc.length === 7 && near(arc[6][0], -10) && near(arc[6][1], 0, 1e-9) && near(arc[3][0], 0, 1e-9) && near(arc[3][1], 5));

  // ---- brushes ----
  w = new EMFWriter();
  brush(w, 1, 0x000000ff, 2, 3); nullPen(w); w.rec(18, ['u32', 1]);
  w.rec(...poly16(86, [[0, 0], [10, 0], [10, 10]]));
  r = play(w.bytes());
  assert('A hatched brush becomes a pattern of lines in its colour', /<pattern id="h\d+" patternUnits="userSpaceOnUse" width="8" height="8"><path d="M0 8L8 0" stroke="#ff0000"/.test(r.svg) && /fill="url\(#h\d+\)"/.test(r.svg), r.svg);

  // ---- text ----
  w = new EMFWriter();
  font(w, 1, -20, 'Arial', { weight: 700 });
  w.rec(22, ['u32', 24]).rec(24, ['u32', 0x000000ff]).rec(18, ['u32', 1]);
  textW(w, 100, 50, 'Dose (mg)', [11, 11, 11, 11, 6, 7, 17, 11, 7]);
  w.rec(22, ['u32', 6]); textW(w, 200, 100, 'Mid', [10, 10, 10]);
  w.rec(22, ['u32', 0]); textW(w, 300, 100, 'Top', [10, 10, 10]);
  font(w, 2, -20, 'Arial', { escapement: 900 }); w.rec(22, ['u32', 24]); textW(w, 50, 300, 'Up', [10, 10]);
  font(w, 3, -20, 'Symbol', { charset: 2 }); textW(w, 10, 10, 'ma', [10, 10]);
  font(w, 4, -20, 'Arial', { underline: 1 }); textW(w, 10, 400, 'Under', [10, 10, 10, 10, 10]);
  r = play(w.bytes());
  const texts = [...r.svg.matchAll(/<text transform="matrix\(([^)]*)\)"([^>]*)>([^<]*)<\/text>/g)].map(m => ({ m: m[1], attrs: m[2], text: m[3] }));
  assert('Text: each word where the file\'s advances put it, bold Arial in its colour', texts[0].text === 'Dose' && texts[0].m === '1 0 0 1 100 50' && texts[1].text === '(mg)' && texts[1].m === '1 0 0 1 150 50' &&
    /font-family="Arial" font-weight="bold" font-size="20" fill="#ff0000"/.test(texts[0].attrs), JSON.stringify(texts.slice(0, 2)));
  assert('…centred on its reference point (TA_CENTER), from the advances', texts[2].text === 'Mid' && texts[2].m === '1 0 0 1 185 118.1', texts[2].m);
  assert('…hanging from it (TA_TOP): the baseline an ascent lower', texts[3].text === 'Top' && texts[3].m === '1 0 0 1 300 118.1', texts[3].m);
  assert('…turned by its escapement (90°, counter-clockwise as seen)', texts[4].text === 'Up' && texts[4].m === '0 -1 1 0 50 300', texts[4].m);
  assert('…the Symbol font\'s letters as Greek, one by one', texts[5].text === 'μ' && texts[6].text === 'α' && texts[6].m === '1 0 0 1 20 10' && /font-family="Symbol"/.test(texts[5].attrs), JSON.stringify(texts.slice(5, 7)));
  assert('…and an underline as a line under the word', /<path transform="matrix\(1 0 0 1 10 400\)" d="M0 2H50" stroke="#ff0000" stroke-width="1.2"/.test(r.svg), r.svg.match(/<path transform[^>]*>/)?.[0]);
  w = new EMFWriter(); font(w, 1, -20, 'Arial'); textW(w, 0, 0, 'ab', [10, 10], { options: 0x10 });
  brush(w, 2, 0); nullPen(w); w.rec(...poly16(86, [[0, 0], [1, 0], [1, 1]]));
  r = play(w.bytes());
  assert('Text stored as glyph numbers is reported, not guessed', r.issues.includes(M.ISSUES.glyphIndex) && !/<text/.test(r.svg));
  w = new EMFWriter(); font(w, 1, -20, 'Arial'); w.rec(18, ['u32', 2]).rec(25, ['u32', 0x00ffffff]); textW(w, 0, 30, 'Box', [10, 10, 10]);
  r = play(w.bytes());
  assert('An opaque background behind text is drawn from its advances', /<path transform="matrix\(1 0 0 1 0 48\.1\)" d="M0 -18\.1L30 -18\.1L30 4\.24L0 4\.24Z" fill="#ffffff"\/>/.test(r.svg), r.svg);

  // ---- bitmaps ----
  w = new EMFWriter();
  stretchDIBits(w, dib24([[[255, 0, 0], [0, 0, 255]], [[0, 255, 0], [255, 255, 255]]]), 10, 20, 40, 40);
  images.length = 0; r = play(w.bytes());
  const px = (img, x, y) => [...img.rgba.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)].join();
  assert('A 24-bit DIB (bottom-up) is read top row first: red, blue / green, white', images.length === 1 && px(images[0].img, 0, 0) === '255,0,0,255' && px(images[0].img, 1, 0) === '0,0,255,255' &&
    px(images[0].img, 0, 1) === '0,255,0,255' && px(images[0].img, 1, 1) === '255,255,255,255');
  assert('…placed in its rectangle, its pixels kept sharp', /<image x="0" y="0" width="1" height="1" preserveAspectRatio="none" transform="matrix\(40 0 0 40 10 20\)" style="image-rendering:pixelated" href="data:image\/png;base64,AAAA"\/>/.test(r.svg), r.svg);
  w = new EMFWriter();
  stretchDIBits(w, dib8([[0, 0, 0], [200, 100, 50]], [[0, 1, 1], [1, 0, 0]]), 0, 0, 30, 20, [1, 0, 2, 1]);
  images.length = 0; r = play(w.bytes());
  assert('An 8-bit palette DIB (top-down) with a source rectangle', px(images[0].img, 1, 0) === '200,100,50,255' && px(images[0].img, 0, 1) === '200,100,50,255' && JSON.stringify(images[0].src) === '{"x":1,"y":0,"width":2,"height":1}', JSON.stringify(images[0].src));

  // ---- what cannot be reproduced ----
  w = new EMFWriter(); w.rec(20, ['u32', 7]); brush(w, 1, 0); nullPen(w); w.rec(...poly16(86, [[0, 0], [1, 0], [1, 1]]));
  r = play(w.bytes());
  assert('An exclusive-or drawing mode is reported', r.issues.includes(M.ISSUES.rop));
  w = new EMFWriter(); w.rec(78, ...Array(25).fill(['u32', 0])); brush(w, 1, 0); nullPen(w); w.rec(...poly16(86, [[0, 0], [1, 0], [1, 1]]));
  assert('A masked bitmap (MASKBLT) is reported', play(w.bytes()).issues.includes(M.ISSUES.rop));

  // ---- EMF+ ----
  const plusHeader = (dual) => [0x4001, dual ? 1 : 0, [['u32', 0xdbc01002], ['u32', 1], ['u32', 96], ['u32', 96]]];
  w = new EMFWriter();
  emfPlus(w, [plusHeader(false), [0x4030, 2, [['f32', 1]]],
    [0x4008, 0x0100 | 1, [['u32', 0xdbc01002], ['u32', 0], ['u32', 0x80ff0000]]], // brush 1: red, half transparent
    [0x400a, 1, [['u32', 1], ['u32', 1], ['f32', 10], ['f32', 10], ['f32', 20], ['f32', 10]]], // FillRects with brush 1
    [0x4008, 0x0200 | 2, [['u32', 0xdbc01002], ['u32', 0], ['u32', 0x22], ['u32', 0], ['f32', 3], ['i32', 2], ['i32', 1], ['u32', 0xdbc01002], ['u32', 0], ['u32', 0xff0000ff]]], // pen 2: 3 wide, round caps, dashes
    [0x402d, 0, [['f32', 5], ['f32', 0]]],
    [0x400d, 0x2000 | 2, [['u32', 2], ['f32', 0], ['f32', 40], ['f32', 50], ['f32', 40]]], // closed DrawLines with pen 2
    [0x4036, 0x8000 | 3, [['u32', 0xff000000], ['u32', 1], ['u32', 0], ['u32', 2], ['u16', 72], ['u16', 105], ['f32', 0], ['f32', 60], ['f32', 8], ['f32', 60]]]]);
  r = play(w.bytes());
  assert('EMF+ only (as R\'s devEMF writes): its records are drawn', /<path d="M10 10L30 10L30 20L10 20Z" fill="#ff0000" fill-opacity="0\.502"\/>/.test(r.svg), r.svg);
  assert('…its pens (width, round caps, dashes) and transforms', /<path d="M5 40L55 40Z" fill="none" stroke="#0000ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="9 3"\/>/.test(r.svg), r.svg);
  w = new EMFWriter();
  emfPlus(w, [plusHeader(true), [0x400a, 0x8000, [['u32', 0xffff0000], ['u32', 1], ['f32', 0], ['f32', 0], ['f32', 5], ['f32', 5]]]]);
  brush(w, 1, 0x0000ff00); nullPen(w); w.rec(...poly16(86, [[0, 0], [9, 0], [9, 9]]));
  r = play(w.bytes());
  assert('A dual EMF+ file: its plain EMF copy is drawn, not both', /fill="#00ff00"/.test(r.svg) && !/#ff0000/.test(r.svg), r.svg);
  w = new EMFWriter(); emfPlus(w, [plusHeader(false), [0x4019, 0, [['u32', 0]]]]);
  assert('An EMF+ file with nothing it can draw is refused with a message', fails(() => play(w.bytes(), 'office.emf'), /office\.emf draws nothing/));

  // ---- WMF ----
  r = play(wmf);
  assert('A placeable WMF: its box at its units per inch (1 × 0.5 in = 25.4 × 12.7 mm)', r.kind === 'wmf' && near(r.widthMM, 25.4) && near(r.heightMM, 12.7) && r.sized && /viewBox="0 0 1440 720"/.test(r.svg) &&
    /<path d="M0 0L1440 0L1440 720L0 720Z" fill="#ff0000"/.test(r.svg), r.svg);
  const ww = new WMFWriter({ box: [0, 0, 1000, 1000], inch: 1000 });
  ww.rec(0x0103, ['u16', 8]).rec(0x020b, ['i16', 0], ['i16', 0]).rec(0x020c, ['i16', 100], ['i16', 100]); // window 100 × 100 onto the box
  ww.rec(0x02fa, ['u16', 0], ['i16', 2], ['i16', 0], ['u32', 0x000000ff]); // slot 0: pen
  ww.rec(0x02fc, ['u16', 0], ['u32', 0x00ff0000], ['u16', 0]); // slot 1: blue brush
  ww.rec(0x01f0, ['u16', 0]); // free slot 0
  ww.rec(0x02fc, ['u16', 0], ['u32', 0x0000ff00], ['u16', 0]); // goes in slot 0: green brush
  ww.rec(0x012d, ['u16', 0]).rec(0x012d, ['u16', 0x00]);
  ww.rec(0x0418, ['i16', 50], ['i16', 50], ['i16', 0], ['i16', 0]); // ellipse
  ww.rec(0x02fb, ['i16', -10], ['i16', 0], ['i16', 0], ['i16', 0], ['i16', 400], ['u8', 0], ['u8', 0], ['u8', 0], ['u8', 0], ['u8', 0], ['u8', 0], ['u8', 0], ['u8', 0], ['ascii', 'Times New Roman', 32]); // slot 2
  ww.rec(0x012d, ['u16', 2]).rec(0x012e, ['u16', 24]);
  ww.rec(0x0a32, ['i16', 80], ['i16', 10], ['u16', 4], ['u16', 0], ['ascii', 'café', 4], ['i16', 5], ['i16', 5], ['i16', 5], ['i16', 5]);
  r = play(ww.bytes());
  assert('A WMF window mapped onto its box; a freed object slot is reused', /<path d="M500 250C500 388\.071 388\.071 500 250 500C/.test(r.svg) && /fill="#00ff00"/.test(r.svg) && !/#0000ff"/.test(r.svg.replace(/stroke="#0000ff"[^>]*/, '')), r.svg.slice(0, 400));
  assert('…its text in Windows-1252 (é), at its place, ten times larger', /<text transform="matrix\(10 0 0 10 100 800\)" font-family="Times New Roman" font-size="10" fill="#000000">café<\/text>/.test(r.svg), r.svg.match(/<text[^>]*>[^<]*<\/text>/)?.[0]);
  const bare = new WMFWriter({ placeable: false }).rec(0x020c, ['i16', 96], ['i16', 192]).rec(0x041b, ['i16', 96], ['i16', 192], ['i16', 0], ['i16', 0]).bytes();
  r = play(bare);
  assert('A WMF with no placeable header: its window at 96 units per inch, and it says so', !r.sized && near(r.widthMM, 50.8) && near(r.heightMM, 25.4));
  assert('Symbol letters as Unicode', M.symbolChar(0x6d) === 'μ' && M.symbolChar(0xf061) === 'α' && M.symbolChar(0x44) === 'Δ' && M.symbolChar(0xb1) === '±' && M.symbolChar(0x31) === '1');
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const checks = await runMetafileRegressions(); console.log(`PASS metafile-regression: ${checks.length} checks`); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

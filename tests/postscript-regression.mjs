// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* P3-T10c: EPS files run into SVG (js/image/postscript.js), in Node: the PostScript language
   (stack, arithmetic, control, dictionaries, strings, bind, stopped, //names), graphics (matrices,
   paths, arcs, line styles, clipping, colours), text (standard fonts with the Liberation widths,
   re-encoding, Symbol, xshow, stringwidth, Type 3, Type 42 and Type 1 fonts), images and filters,
   shadings, the DOS EPS header, and errors. Also the TrueType reader (js/image/truetype.js).
   Run alone: node tests/postscript-regression.mjs */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runPostscriptRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const PS = await import(pathToFileURL(join(ROOT, 'js/image/postscript.js')).href);
  const { parseTrueType } = await import(pathToFileURL(join(ROOT, 'js/image/truetype.js')).href);
  const fails = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
  const fontBytes = file => new Uint8Array(readFileSync(join(ROOT, 'assets/fonts', file)));
  const FILES = { 'Liberation Sans': 'LiberationSans', 'Liberation Serif': 'LiberationSerif', 'Liberation Mono': 'LiberationMono' };
  const STYLES = { normal: 'Regular', bold: 'Bold', italic: 'Italic', bolditalic: 'BoldItalic' };
  const tt = new Map();
  const face = (f, s) => { const k = f + s; if (!tt.has(k)) tt.set(k, parseTrueType(fontBytes(`${FILES[f]}-${STYLES[s]}.ttf`))); return tt.get(k); };
  const fonts = { width: (f, s, ch) => { const t = face(f, s), g = t.glyphIndex(ch.codePointAt(0)); return g ? t.advance(g) / t.unitsPerEm : null; },
    outline: (f, s, ch) => { const t = face(f, s), g = t.glyphIndex(ch.codePointAt(0)); return g ? { ops: t.outline(g), unitsPerEm: t.unitsPerEm } : null; } };
  const images = [];
  const bytes = text => Uint8Array.from(text, c => c.charCodeAt(0) & 0xff); // EPS is bytes: one per character
  const run = (body, { box = '0 0 100 100', name = 'test.eps' } = {}) => PS.epsToSVG(bytes(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: ${box}\n${body}\nshowpage\n`), { name, fonts, image: img => { images.push(img); return 'data:image/png;base64,AAAA'; } });
  const paths = svg => [...svg.matchAll(/<path d="([^"]+)"([^>]*)\/>/g)].map(m => ({ d: m[1], attrs: m[2] }));
  const texts = svg => [...svg.matchAll(/<text transform="matrix\(([^)]*)\)"([^>]*)>([^<]*)<\/text>/g)].map(m => ({ m: m[1].split(' ').map(Number), attrs: m[2], text: m[3] }));
  /** A probe: draws a 1-unit square at (value, 0) so a computed number can be read back from the SVG. */
  const probe = expr => { const r = run(`${expr} 0 moveto 1 0 rlineto 0 1 rlineto -1 0 rlineto closepath fill`, { box: '-1000 -1000 1000 1000' }); return Number(/<path d="M(-?[\d.]+) /.exec(r.svg)[1]) - 1000; };

  // ---- the TrueType reader ----
  const lib = parseTrueType(fontBytes('LiberationSans-Regular.ttf'));
  assert('TrueType: Liberation Sans has Helvetica\'s widths (A 667, m 833 per 1000)', Math.round(lib.advance(lib.glyphIndex(65)) / lib.unitsPerEm * 1000) === 667 && Math.round(lib.advance(lib.glyphIndex(109)) / lib.unitsPerEm * 1000) === 833);
  const outlineA = lib.outline(lib.glyphIndex(65));
  assert('…a glyph\'s outline (contours closed), and a composite one (é)', outlineA[0] === 0 && outlineA.at(-1) === 4 && lib.outline(lib.glyphIndex(0xe9)).filter(v => v === 4).length >= 2);
  assert('…and anything else is refused', fails(() => parseTrueType(new Uint8Array(64)), /Not a TrueType font/));

  // ---- the language ----
  assert('Arithmetic and the stack: add, mul, exch, roll, index, copy', probe('2 3 add 4 mul') === 20 && probe('1 2 exch sub') === 1 && probe('1 2 3 3 1 roll pop pop') === 3 && probe('5 6 1 index pop pop') === 5 && probe('7 8 2 copy add add add') === 30);
  assert('…idiv, mod, round, sqrt, atan, cvi, neg, abs', probe('17 5 idiv') === 3 && probe('17 5 mod') === 2 && probe('2.5 round') === 3 && probe('81 sqrt') === 9 && probe('1 1 atan') === 45 && probe('7.9 cvi') === 7 && probe('-4 abs') === 4);
  assert('Control: if, ifelse, for, repeat, loop and exit, forall', probe('1 2 gt { 10 } { 20 } ifelse') === 20 && probe('0 1 1 4 { add } for') === 10 && probe('0 3 { 2 add } repeat') === 6 &&
    probe('0 { 1 add dup 5 eq { exit } if } loop') === 5 && probe('0 [1 2 3] { add } forall') === 6);
  assert('Procedures, def, bind, load, where, known', probe('/sq { dup mul } bind def 9 sq') === 81 && probe('/a 5 def /a load') === 5 && probe('/a 3 def /a where { pop 1 } { 0 } ifelse') === 1 && probe('userdict /zz known { 1 } { 2 } ifelse') === 2);
  assert('Dictionaries: <<>>, begin/end, get, put, forall', probe('<< /x 4 /y 5 >> begin x y add end') === 9 && probe('/d 2 dict def d /k 7 put d /k get') === 7 && probe('0 << /a 1 /b 2 >> { exch pop add } forall') === 3);
  assert('Strings: length, get, cvs, search, string comparison, cvn', probe('(hello) length') === 5 && probe('(ABC) 1 get') === 66 && probe('42 10 string cvs length') === 2 &&
    probe('(a-b) (-) search { pop pop length } { 0 } ifelse') === 1 && probe('(abc) (abc) eq { 1 } { 0 } ifelse') === 1 && probe('/foo (foo) cvn eq { 1 } { 0 } ifelse') === 1);
  assert('Arrays: [ ], aload, astore, getinterval, array length', probe('[1 2 3] aload pop add add') === 6 && probe('1 2 2 array astore 1 get') === 2 && probe('[5 6 7 8] 1 2 getinterval 0 get') === 6 && probe('7 array length') === 7);
  assert('stopped catches an error; //names are resolved when read', probe('{ nosuchname } stopped { 11 } { 22 } ifelse') === 11 && probe('/k 13 def { //k } exec') === 13);
  assert('Hex, ASCII85 and escaped strings', probe('<414243> length') === 3 && probe('<~87cURD]i,"Ebo80~> length') === 12 && probe('(a\\(b\\)\\101) length') === 5);

  // ---- graphics ----
  let r = run('10 20 moveto 30 0 rlineto 0 30 rlineto closepath 0.5 setgray fill');
  assert('A path, filled in grey, y turned down (EPS: y up)', /<path d="M10 80L40 80L40 50Z" fill="#808080"\/>/.test(r.svg), r.svg);
  assert('The SVG has the bounding box\'s size on paper', /width="35\.2778mm" height="35\.2778mm" viewBox="0 0 100 100"/.test(r.svg) && Math.abs(r.widthMM - 35.2778) < 1e-3);
  r = run('gsave 50 50 translate 2 2 scale 1 0 0 setrgbcolor 3 setlinewidth 1 setlinecap 1 setlinejoin [2 1] 0 setdash 0 0 moveto 10 0 lineto stroke grestore 0 0 1 0 setcmykcolor 0 0 moveto 1 1 lineto stroke');
  assert('Matrices scale lines: width, caps, joins, dashes (twice as large)', /d="M50 50L70 50" fill="none" stroke="#ff0000" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 2"/.test(r.svg), r.svg);
  assert('…and grestore takes the state back; CMYK becomes RGB', /d="M0 100L1 99" fill="none" stroke="#ff0000" stroke-width="1" stroke-miterlimit="10"/.test(r.svg) === false && /stroke="#ffff00" stroke-width="1"/.test(r.svg), r.svg);
  r = run('50 50 20 0 90 arc stroke');
  assert('An arc: a Bézier quarter, counter-clockwise (y up)', /d="M70 50C70 38\.954 61\.046 30 50 30"/.test(r.svg), r.svg);
  r = run('gsave 0 0 50 50 rectclip 0 0 100 100 rectfill grestore 90 90 5 5 rectfill');
  assert('rectclip clips what follows until grestore', /<clipPath id="c1" clipPathUnits="userSpaceOnUse"><path d="M0 100L50 100L50 50L0 50Z"\/><\/clipPath>/.test(r.svg) &&
    /<g clip-path="url\(#c1\)"><path d="M0 100L100 100L100 0L0 0Z" fill="#000000"\/><\/g><path d="M90 10/.test(r.svg), r.svg);
  r = run('[/Indexed /DeviceRGB 1 <ff000000ff00>] setcolorspace 1 setcolor 0 0 10 10 rectfill [/Separation /Spot /DeviceCMYK { 0 0 0 }] setcolorspace 1 setcolor 20 0 10 10 rectfill');
  assert('Indexed and separation colours (the tint procedure runs)', /M0 100L10 100L10 90L0 90Z" fill="#00ff00"/.test(r.svg) && /M20 100[^"]*" fill="#00ffff"/.test(r.svg), r.svg);
  r = run('[ /CIEBasedABC << >> ] setcolorspace 0.2 0.4 0.6 setcolor 0 0 5 5 rectfill');
  assert('A CIE RGB colour space (as R writes) is RGB', /fill="#336699"/.test(r.svg), r.svg);
  r = run('<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >> shfill');
  assert('An axial shading becomes a linear gradient', /<linearGradient id="g\d+" gradientUnits="userSpaceOnUse"[^>]*x1="0" y1="0" x2="100" y2="0"><stop offset="0" stop-color="#ff0000"\/><stop offset="1" stop-color="#0000ff"\/>/.test(r.svg), r.svg);

  // ---- text ----
  r = run('/Helvetica findfont 10 scalefont setfont 10 10 moveto (Dose mg) show (!) show');
  let t = texts(r.svg);
  assert('Standard-font text: words where Helvetica\'s widths put them (Liberation has them)', t.length === 3 && t[0].text === 'Dose' && t[0].m.join() === '1,0,0,1,10,90' && /font-family="Helvetica" font-size="10" fill="#000000"/.test(t[0].attrs) &&
    t[1].text === 'mg' && Math.abs(t[1].m[4] - (10 + 10 * (0.722 + 0.556 + 0.5 + 0.556 + 0.278))) < 0.02 && t[2].text === '!' && Math.abs(t[2].m[4] - (10 + 10 * (2.612 + 0.833 + 0.556))) < 0.02, JSON.stringify(t));
  r = run('/Times-Bold findfont 20 scalefont setfont 50 50 moveto (Mid) dup stringwidth pop 2 div neg 0 rmoveto show');
  t = texts(r.svg);
  assert('stringwidth: centred text, as R places it; Times-Bold', t.length === 1 && Math.abs(t[0].m[4] - (50 - 20 * (0.944 + 0.278 + 0.556) / 2)) < 0.02 && /font-family="Times" font-weight="bold"/.test(t[0].attrs), JSON.stringify(t));
  r = run(`/Helvetica findfont dup length dict begin { 1 index /FID ne { def } { pop pop } ifelse } forall /Encoding ISOLatin1Encoding def currentdict end /F1 exch definefont pop
    /F1 findfont 12 scalefont setfont 0 0 moveto (\\351t\\351 -1) show /Symbol findfont 12 scalefont setfont (m) show`);
  t = texts(r.svg);
  assert('A re-encoded copy (ISO Latin 1, as R does): é, and its minus is a real minus', t.some(x => x.text === 'été') && t.some(x => x.text === '−1') && t.every(x => /Helvetica/.test(x.attrs) || /Symbol/.test(x.attrs)), JSON.stringify(t.map(x => x.text)));
  assert('…the Symbol font\'s m is μ', t.some(x => x.text === 'μ' && /font-family="Symbol"/.test(x.attrs)));
  r = run('/Arial-BoldMT findfont 91 scalefont setfont 0 0 moveto (10) [50 50.6] xshow 0 100 moveto (AB) [30 60] xshow');
  t = texts(r.svg);
  assert('xshow: positions as given; a word stays whole when they match the widths (Prism)', t[0].text === '10' && t[1].text === 'A' && t[2].text === 'B' && Math.abs(t[2].m[4] - 30) < 0.01, JSON.stringify(t.map(x => [x.text, x.m[4]])));
  // A Type 3 font: its glyph is a procedure that fills a square.
  r = run(`/T3 << /FontType 3 /FontMatrix [0.001 0 0 0.001 0 0] /FontBBox [0 0 1000 1000] /Encoding StandardEncoding
    /BuildGlyph { exch pop pop 600 0 0 0 500 500 setcachedevice 0 0 500 500 rectfill } >> definefont pop
    /T3 findfont 10 scalefont setfont 0 0 moveto (aa) show`);
  let p = paths(r.svg);
  assert('A Type 3 font draws its glyphs\' procedures, advancing by their widths', p.length === 2 && p[0].d === 'M0 100L5 100L5 95L0 95Z' && p[1].d === 'M6 100L11 100L11 95L6 95Z', JSON.stringify(p));
  // A Type 42 font: TrueType data in strings (here Liberation Sans itself).
  const ttf = fontBytes('LiberationSans-Regular.ttf');
  const hex = Array.from(ttf, b => b.toString(16).padStart(2, '0')).join('');
  r = run(`/F42 << /FontType 42 /FontMatrix [1 0 0 1 0 0] /FontBBox [0 0 1 1] /Encoding StandardEncoding /CharStrings << /.notdef 0 /A ${lib.glyphIndex(65)} >>
    /sfnts [<${hex}00>] /PaintType 0 >> definefont pop /F42 findfont 50 scalefont setfont 10 10 moveto (AA) show`);
  p = paths(r.svg);
  assert('A Type 42 font is drawn by its TrueType outlines, advancing by its widths', p.length === 2 && !/<text/.test(r.svg) && /^M\S+ \S+L/.test(p[0].d) &&
    Math.abs(Number(/^M(\S+)/.exec(p[1].d)[1]) - Number(/^M(\S+)/.exec(p[0].d)[1]) - 50 * 0.667) < 0.05, p.map(q => q.d.slice(0, 30)).join(' | '));
  // A Type 1 font: eexec-encrypted, its charstring a 500-unit square.
  const encrypt = (plain, key, prefix = [0, 0, 0, 0]) => { let rr = key; return Uint8Array.from([...prefix, ...plain], c => { const e = c ^ (rr >> 8); rr = ((e + rr) * 52845 + 22719) & 0xffff; return e; }); };
  const num = v => (v >= -107 && v <= 107 ? [v + 139] : v >= 108 && v <= 1131 ? [((v - 108) >> 8) + 247, (v - 108) & 0xff] : [((-v - 108) >> 8) + 251, (-v - 108) & 0xff]);
  const charstring = [...num(0), ...num(600), 13, ...num(100), ...num(0), 21, ...num(500), 6, ...num(500), 7, ...num(-500), 6, 9, 14];
  const cs = encrypt(charstring, 4330);
  const priv = `dup /Private 8 dict dup begin /RD {string currentfile exch readstring pop} executeonly def /ND {noaccess def} executeonly def /NP {noaccess put} executeonly def /lenIV 4 def
/Subrs 0 array ND
2 index /CharStrings 2 dict dup begin /.notdef 4 RD ${'\u0000'.repeat(0)}`;
  const enc = new TextEncoder();
  const body = new Uint8Array([...enc.encode(priv.replace(/ \/\.notdef 4 RD $/, '')), ...enc.encode(` /a ${cs.length} RD `), ...cs, ...enc.encode(' ND end end readonly put noaccess put dup /FontName get exch definefont pop mark currentfile closefile\n')]);
  const cipher = encrypt(body, 55665);
  const cipherHex = Array.from(cipher, b => b.toString(16).padStart(2, '0')).join('').replace(/(.{64})/g, '$1\n');
  r = run(`%!FontType1-1.0: Square
12 dict begin /FontType 1 def /FontName /Square def /FontMatrix [0.001 0 0 0.001 0 0] readonly def /PaintType 0 def /FontBBox {0 0 600 500} readonly def
/Encoding StandardEncoding def currentdict end
currentfile eexec
${cipherHex}
${'0'.repeat(64).repeat(8)}
cleartomark
/Square findfont 10 scalefont setfont 0 0 moveto (aa) show`);
  p = paths(r.svg);
  assert('A Type 1 font (eexec, charstrings) is drawn by its outlines', p.length === 2 && p[0].d === 'M1 100L6 100L6 95L1 95Z' && p[1].d === 'M7 100L12 100L12 95L7 95Z', JSON.stringify(p) + ' ' + JSON.stringify(r.issues));

  // ---- images and filters ----
  images.length = 0;
  r = run('gsave 10 10 translate 20 20 scale 2 1 8 [2 0 0 -1 0 1] { <ff40> } image grestore');
  assert('An image: grey samples from a procedure, placed by its matrix', images.length === 1 && Array.from(images[0].rgba).join() === '255,255,255,255,64,64,64,255' &&
    /<image [^>]*transform="matrix\(20 0 0 20 10 70\)" style="image-rendering:pixelated"/.test(r.svg), r.svg);
  images.length = 0;
  r = run('gsave 0 0 translate 10 10 scale << /ImageType 1 /Width 2 /Height 1 /BitsPerComponent 8 /Decode [0 1 0 1 0 1] /ImageMatrix [2 0 0 -1 0 1] /DataSource currentfile /ASCIIHexDecode filter >> /DeviceRGB setcolorspace image\nff000000ff00>\ngrestore 0 0 1 1 rectfill');
  assert('A level 2 image with its data after it, through a filter read when needed (as R writes)', images.length === 1 && Array.from(images[0].rgba).join() === '255,0,0,255,0,255,0,255' && /<path d="M0 100L1 100/.test(r.svg), JSON.stringify([images.length, r.issues]));
  images.length = 0;
  r = run('2 1 true [2 0 0 -1 0 1] { <80> } imagemask 4 2 8 [4 0 0 -2 0 2] currentfile /RunLengthDecode filter false 3 colorimage\n' + String.fromCharCode(0x81) + 'x' + String.fromCharCode(0x80) + '\n');
  assert('An image mask in the current colour; a colour image through RunLengthDecode', images.length === 2 && Array.from(images[0].rgba.slice(0, 8)).join() === '0,0,0,255,0,0,0,0' && images[1].rgba[0] === 120 && images[1].width === 4, JSON.stringify(r.issues));
  const lzw = run(`/s (\\200\\013\\140\\120\\042\\014\\014\\205\\001) /LZWDecode filter 20 string readstring pop def s length 0 moveto 1 0 rlineto 0 1 rlineto fill`, { box: '0 0 100 100' });
  assert('LZW data (the PDF reference\'s example) decodes', /<path d="M10 100/.test(lzw.svg), lzw.svg.slice(-120));

  // ---- the file ----
  const eps = new TextEncoder().encode('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n0 0 5 5 rectfill\n');
  const dos = new Uint8Array(30 + eps.length); dos.set([0xc5, 0xd0, 0xd3, 0xc6]); new DataView(dos.buffer).setUint32(4, 30, true); new DataView(dos.buffer).setUint32(8, eps.length, true); dos.set(eps, 30);
  assert('A DOS EPS (binary header, previews) is read from its PostScript part', /M0 10L5 10/.test(PS.epsToSVG(dos, { fonts }).svg));
  assert('A HiResBoundingBox is preferred; %%BoundingBox: (atend) is found at the end', /viewBox="0 0 10\.5 10"/.test(PS.epsToSVG(new TextEncoder().encode('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 11 10\n%%HiResBoundingBox: 0 0 10.5 10\n0 0 5 5 rectfill\n'), {}).svg) &&
    /viewBox="0 0 20 20"/.test(PS.epsToSVG(new TextEncoder().encode('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: (atend)\n0 0 5 5 rectfill\n%%Trailer\n%%BoundingBox: 0 0 20 20\n'), {}).svg));
  assert('Not PostScript, or no bounding box: refused with a message', fails(() => PS.epsToSVG(new TextEncoder().encode('GIF89a nothing here'), { name: 'x.eps' }), /x\.eps is not a readable EPS file/) &&
    fails(() => PS.epsToSVG(new TextEncoder().encode('%!PS\n0 0 5 5 rectfill\n'), { name: 'nb.eps' }), /nb\.eps has no bounding box/));
  r = run('0 0 5 5 rectfill nosuchoperator 10 10 5 5 rectfill');
  assert('An operator it does not know: what was drawn stays, and it is reported', paths(r.svg).length === 1 && r.issues.some(i => /PostScript it could not run \(undefined: nosuchoperator\)/.test(i)), JSON.stringify(r.issues));
  assert('A program that draws nothing, or never ends, is refused with a message', fails(() => run('1 2 add pop', { name: 'none.eps' }), /none\.eps draws nothing/) && fails(() => run('{ } loop', { name: 'loop.eps' }), /loop\.eps draws nothing FluoForge can read: PostScript it could not run \(limitcheck/));
  r = run('<< /PatternType 1 /PaintType 2 /TilingType 1 /BBox [0 0 4 4] /XStep 4 /YStep 4 /PaintProc { pop 0 0 2 2 rectfill } >> matrix makepattern /Pat exch def [/Pattern /DeviceRGB] setcolorspace 1 0 0 Pat setcolor 0 0 10 10 rectfill 0 0 1 Pat setpattern 20 0 10 10 rectfill');
  assert('A tiling pattern (uncoloured, as matplotlib\'s hatching) becomes an SVG pattern of its cell, in the colour given', /<pattern id="p\d+" patternUnits="userSpaceOnUse" x="0" y="0" width="4" height="4" patternTransform="matrix\(1 0 0 -1 0 100\)"><path d="M0 0L2 0L2 2L0 2Z" fill="#ff0000"\/><\/pattern>/.test(r.svg) &&
    /<path d="M0 100L10 100L10 90L0 90Z" fill="url\(#p\d+\)"\/>/.test(r.svg) && /fill="#0000ff"\/><\/pattern>/.test(r.svg) && !r.issues.length, r.svg);
  r = run('0 0 moveto 10 10 lineto strokepath fill 0 0 1 1 rectfill');
  assert('Outlines of strokes (strokepath) are reported', r.issues.includes(PS.ISSUES.strokePath));
  assert('status: the current file is open, a file name is not found', probe('currentfile status { 1 } { 0 } ifelse') === 1 && probe('(x.ps) status { 1 } { 0 } ifelse') === 0);
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const checks = await runPostscriptRegressions(); console.log(`PASS postscript-regression: ${checks.length} checks`); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

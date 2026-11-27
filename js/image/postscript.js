/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* EPS as SVG (P3-T10c). An EPS file is a PostScript program; this is a small PostScript interpreter
   (FluoForge's own code) that runs it and writes what it draws as SVG, so a plot saved as EPS by R,
   Prism, cairo, matplotlib, gnuplot and others becomes a vector panel.
   - The language: numbers, strings, names, arrays, procedures, dictionaries; the stack, dictionary,
     control, conversion, string, file and filter operators plotting tools use (bind, forall, stopped,
     currentfile and readhexstring, ASCIIHex/ASCII85/RunLength/LZW/Flate filters, eexec).
   - Graphics: the current matrix, paths (lines, curves, arcs), fill and stroke with line width, caps,
     joins and dashes, clipping, gsave and grestore, gray, RGB, CMYK, CIE, indexed and separation
     colours, images (with JPEG kept as it is), axial and radial shadings.
   - Text: standard fonts (Helvetica, Times, Courier and look-alikes) become text in the Liberation
     face with the same widths, each word where the program puts it; fonts the file embeds are drawn
     by their own outlines: Type 3 (their procedures), Type 42 (TrueType) and Type 1 (charstrings).
   What it cannot run or reproduce is collected (ISSUES) for the importer. Pure: no DOM; bitmaps go
   through `image`, Flate data through `inflate`, the Liberation faces through `fonts`. */

import * as P from './pdf-vector-model.js';
import { STANDARD, ISO_LATIN1, glyphText } from './postscript-data.js';
import { parseTrueType } from './truetype.js';
import { arcPoints, symbolChar } from './metafile.js';
import { faceFor, styleKey } from './vector-model.js';

export const ISSUES = Object.freeze({
  shading: 'smooth shadings other than linear and radial',
  composite: 'composite (CID) fonts',
  strokePath: 'outlines of strokes (strokepath) and reversed paths',
  initclip: 'clipping reset by initclip',
  image: 'images it cannot decode',
  encodedNumbers: 'text positions given as encoded number strings',
  cshow: 'text drawn character by character with cshow',
  filter: 'compressed data it cannot read',
  erase: 'pages erased while drawing',
  userPath: 'user paths'
});

// ---------------------------------------------------------------- objects
class PSError extends Error { constructor(kind, what = '') { super(`PostScript error ${kind}${what ? ': ' + what : ''}`); this.kind = kind; this.what = what; } }
const EXIT = { signal: 'exit' }, STOP = { signal: 'stop' }, QUIT = { signal: 'quit' };
const MARK = Object.freeze({ t: 'mark' }), NULL = Object.freeze({ t: 'null' });
const name = (n, lit = false) => ({ t: 'name', n, lit });
const str = (b, exec = false) => ({ t: 'string', b, exec });
const arr = (v, exec = false) => ({ t: 'array', v, exec });
const newDict = () => ({ t: 'dict', m: new Map() });
const latin1 = b => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const bytesOf = s => Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
const strOf = s => str(bytesOf(s));
const keyOf = k => (typeof k === 'number' ? 'n:' + k : typeof k === 'boolean' ? 'b:' + k : k.t === 'name' ? k.n : k.t === 'string' ? latin1(k.b) : k.t === 'internal' ? '\0' + k.id : 'o:' + (k.id ??= Math.random()));
const dget = (d, k) => d.m.get(keyOf(k))?.[1];
const dput = (d, k, v) => { const key = typeof k === 'object' && k.t === 'string' ? name(latin1(k.b), true) : k; d.m.set(keyOf(k), [key, v]); };
const isProc = o => o && o.t === 'array' && o.exec;
const num = o => { if (typeof o !== 'number') throw new PSError('typecheck', 'number expected'); return o; };

// ---------------------------------------------------------------- files and the scanner
/** A readable stream of bytes; `inner` (for eexec) is read through `decode`. */
const fileOf = (bytes) => ({ t: 'file', b: bytes, pos: 0, closed: false });
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/, RADIX = /^(\d+)#([0-9a-zA-Z]+)$/;

function decodeHex(text) {
  const digits = text.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(Math.ceil(digits.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt((digits.substr(i * 2, 2) + '0').slice(0, 2), 16);
  return out;
}
function decodeA85(text) {
  const out = [];
  let group = [];
  const flush = n => { let v = 0; for (let i = 0; i < 5; i++) v = v * 85 + (group[i] ?? 84); for (let i = 0; i < n - 1; i++) out.push((v >>> (24 - i * 8)) & 0xff); };
  for (const ch of text) {
    if (ch === 'z' && !group.length) { out.push(0, 0, 0, 0); continue; }
    const c = ch.charCodeAt(0);
    if (c < 33 || c > 117) continue;
    group.push(c - 33);
    if (group.length === 5) { flush(5); group = []; }
  }
  if (group.length) flush(group.length);
  return Uint8Array.from(out);
}

/** The next token of `file`, or undefined at its end. `vm` resolves //names. */
function skipSpace(file) {
  const b = file.b;
  for (;;) {
    while (file.pos < b.length && WS.has(b[file.pos])) file.pos++;
    if (file.pos < b.length && b[file.pos] === 37) { while (file.pos < b.length && b[file.pos] !== 10 && b[file.pos] !== 13) file.pos++; continue; }
    return;
  }
}
function scan(file, vm) {
  const b = file.b;
  skipSpace(file);
  if (file.pos >= b.length) return undefined;
  const c = b[file.pos];
  if (c === 40) { // (string)
    file.pos++;
    const out = [];
    for (let depth = 1; file.pos < b.length;) {
      let ch = b[file.pos++];
      if (ch === 92) {
        const e = b[file.pos++];
        if (e === 110) out.push(10); else if (e === 114) out.push(13); else if (e === 116) out.push(9); else if (e === 98) out.push(8); else if (e === 102) out.push(12);
        else if (e === 13) { if (b[file.pos] === 10) file.pos++; } else if (e === 10) { /* line continuation */ }
        else if (e >= 48 && e <= 55) { let v = e - 48; for (let k = 0; k < 2 && b[file.pos] >= 48 && b[file.pos] <= 55; k++) v = v * 8 + b[file.pos++] - 48; out.push(v & 0xff); }
        else out.push(e);
        continue;
      }
      if (ch === 40) depth++;
      else if (ch === 41 && --depth === 0) break;
      out.push(ch);
    }
    return str(Uint8Array.from(out));
  }
  if (c === 60) { // <hex>, <~ascii85~>, <<
    if (b[file.pos + 1] === 60) { file.pos += 2; return name('<<'); }
    if (b[file.pos + 1] === 126) {
      const end = indexOfSeq(b, [126, 62], file.pos + 2);
      const text = latin1(b.subarray(file.pos + 2, end < 0 ? b.length : end));
      file.pos = end < 0 ? b.length : end + 2;
      return str(decodeA85(text));
    }
    const end = b.indexOf(62, file.pos);
    const text = latin1(b.subarray(file.pos + 1, end < 0 ? b.length : end));
    file.pos = end < 0 ? b.length : end + 1;
    return str(decodeHex(text));
  }
  if (c === 62) { file.pos++; if (b[file.pos] === 62) { file.pos++; return name('>>'); } throw new PSError('syntaxerror', '>'); }
  if (c === 91 || c === 93) { file.pos++; return name(c === 91 ? '[' : ']'); }
  if (c === 123) { // {procedure}
    file.pos++;
    const items = [];
    for (;;) {
      skipSpace(file);
      if (file.pos >= b.length) break;
      if (b[file.pos] === 125) { file.pos++; break; }
      const t = scan(file, vm);
      if (t === undefined) break;
      items.push(t);
    }
    return arr(items, true);
  }
  if (c === 125) { file.pos++; throw new PSError('syntaxerror', '}'); }
  const literal = c === 47, immediate = literal && b[file.pos + 1] === 47;
  if (literal) file.pos += immediate ? 2 : 1;
  const start = file.pos;
  while (file.pos < b.length && !WS.has(b[file.pos]) && !DELIM.has(b[file.pos])) file.pos++;
  const text = latin1(b.subarray(start, file.pos));
  // The white-space character that ends a token is part of it (binary data read after "RD " starts after it).
  if (file.pos < b.length && WS.has(b[file.pos])) { file.pos += b[file.pos] === 13 && b[file.pos + 1] === 10 ? 2 : 1; }
  if (immediate) { const v = vm.lookup(text); if (v === undefined) throw new PSError('undefined', text); return v; }
  if (literal) return name(text, true);
  if (NUMBER.test(text)) return Number(text);
  const r = RADIX.exec(text);
  if (r) return parseInt(r[2], Number(r[1]));
  return name(text);
}
function indexOfSeq(b, seq, from) {
  outer: for (let i = from; i <= b.length - seq.length; i++) { for (let k = 0; k < seq.length; k++) if (b[i + k] !== seq[k]) continue outer; return i; }
  return -1;
}

// ---------------------------------------------------------------- Type 1 charstrings
function decrypt(bytes, key, skip) {
  let r = key;
  const out = new Uint8Array(Math.max(0, bytes.length - skip));
  for (let i = 0; i < bytes.length; i++) { const c = bytes[i], p = c ^ (r >> 8); r = ((c + r) * 52845 + 22719) & 0xffff; if (i >= skip) out[i - skip] = p; }
  return out;
}
/** A Type 1 glyph: { width, ops } in glyph space. `get(name)` gives a charstring's bytes, `subr(i)` a subroutine's. */
function type1Glyph(code, subr, lenIV, getGlyph, depth = 0) {
  const ops = [];
  let x = 0, y = 0, width = 0, sbx = 0, open = false, flex = null;
  const stack = [], ps = [];
  const moveTo = (nx, ny) => { if (flex) { flex.push([nx, ny]); x = nx; y = ny; return; } x = nx; y = ny; ops.push(P.DRAW.moveTo, x, y); open = true; };
  const lineTo = (nx, ny) => { x = nx; y = ny; ops.push(P.DRAW.lineTo, x, y); };
  const curve = (a, b2, c, d, e, f) => { ops.push(P.DRAW.curveTo, a, b2, c, d, e, f); x = e; y = f; };
  function run(cs, level) {
    if (level > 10) return true;
    const s = lenIV >= 0 ? decrypt(cs, 4330, lenIV) : cs;
    for (let i = 0; i < s.length;) {
      const v = s[i++];
      if (v >= 32) {
        if (v <= 246) stack.push(v - 139);
        else if (v <= 250) stack.push((v - 247) * 256 + s[i++] + 108);
        else if (v <= 254) stack.push(-(v - 251) * 256 - s[i++] - 108);
        else { stack.push((s[i] << 24 | s[i + 1] << 16 | s[i + 2] << 8 | s[i + 3]) | 0); i += 4; }
        continue;
      }
      switch (v) {
        case 13: sbx = stack[0]; width = stack[1]; x = sbx; y = 0; stack.length = 0; break; // hsbw
        case 9: ops.push(P.DRAW.closePath); open = false; stack.length = 0; break;
        case 21: moveTo(x + stack[0], y + stack[1]); stack.length = 0; break;
        case 22: moveTo(x + stack[0], y); stack.length = 0; break;
        case 4: moveTo(x, y + stack[0]); stack.length = 0; break;
        case 5: lineTo(x + stack[0], y + stack[1]); stack.length = 0; break;
        case 6: lineTo(x + stack[0], y); stack.length = 0; break;
        case 7: lineTo(x, y + stack[0]); stack.length = 0; break;
        case 8: { const [a, b2, c, d, e, f] = stack; const x1 = x + a, y1 = y + b2, x2 = x1 + c, y2 = y1 + d; curve(x1, y1, x2, y2, x2 + e, y2 + f); stack.length = 0; break; }
        case 30: { const [a, b2, c, d] = stack; const x1 = x, y1 = y + a, x2 = x1 + b2, y2 = y1 + c; curve(x1, y1, x2, y2, x2 + d, y2); stack.length = 0; break; }
        case 31: { const [a, b2, c, d] = stack; const x1 = x + a, y1 = y, x2 = x1 + b2, y2 = y1 + c; curve(x1, y1, x2, y2, x2, y2 + d); stack.length = 0; break; }
        case 1: case 3: stack.length = 0; break; // stems
        case 10: { const n = stack.pop(), sub = subr(n); if (sub && run(sub, level + 1)) return true; break; }
        case 11: return false; // return
        case 14: if (open) ops.push(P.DRAW.closePath); return true; // endchar
        case 12: {
          const e = s[i++];
          if (e === 7) { sbx = stack[0]; width = stack[2]; x = sbx; y = stack[1]; stack.length = 0; } // sbw
          else if (e === 12) { const b2 = stack.pop(), a = stack.pop(); stack.push(a / b2); } // div
          else if (e === 6) { // seac: an accented character from two standard ones
            const [asb, adx, ady, bchar, achar] = stack; stack.length = 0;
            const base = getGlyph(STANDARD[bchar], depth + 1), accent = getGlyph(STANDARD[achar], depth + 1);
            if (base) ops.push(...base.ops);
            if (accent) { const dx = adx - asb + sbx; for (let k = 0; k < accent.ops.length;) { const op = accent.ops[k++]; ops.push(op); const n = op === P.DRAW.closePath ? 0 : op === P.DRAW.curveTo ? 3 : 1; for (let q = 0; q < n; q++) { ops.push(accent.ops[k++] + dx, accent.ops[k++] + ady); } } }
            return true;
          } else if (e === 16) { // callothersubr
            const other = stack.pop(), n = stack.pop(), args = stack.splice(stack.length - n, n);
            if (other === 1) flex = [];
            else if (other === 2) { /* a flex point: added by the rmoveto before it */ }
            else if (other === 0 && flex) {
              const p = flex; flex = null;
              if (p.length >= 7) { curve(...p[1], ...p[2], ...p[3]); curve(...p[4], ...p[5], ...p[6]); }
              ps.push(args[2], args[1]);
              continue;
            }
            if (other === 3) { ps.push(3); continue; }
            for (let k = args.length - 1; k >= 0; k--) ps.push(args[k]);
          } else if (e === 17) stack.push(ps.pop() ?? 0); // pop
          else if (e === 33) { x = stack[0]; y = stack[1]; stack.length = 0; } // setcurrentpoint
          else stack.length = 0; // dotsection, hstem3, vstem3
          break;
        }
        default: stack.length = 0;
      }
    }
    return false;
  }
  run(code, 0);
  return { width, ops };
}

// ---------------------------------------------------------------- the interpreter
const MAX_OPS = 40e6;

/**
 * An EPS file's bytes as SVG: { svg, issues, widthMM, heightMM, drawn }. Options: `image(bitmap)` →
 * an image URL; `inflate(bytes)` → { data, used } for Flate data; `fonts` { width(face, style, char) →
 * advance in em, outline(face, style, char) → { ops, unitsPerEm } } for the Liberation faces.
 */
export function epsToSVG(bytes, { image = null, inflate = null, fonts = null, name: fileName = 'The file' } = {}) {
  // A DOS EPS: a binary header pointing at the PostScript (previews are ignored).
  if (bytes[0] === 0xc5 && bytes[1] === 0xd0 && bytes[2] === 0xd3 && bytes[3] === 0xc6) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    bytes = bytes.subarray(v.getUint32(4, true), v.getUint32(4, true) + v.getUint32(8, true));
  }
  const head = latin1(bytes.subarray(0, Math.min(bytes.length, 4096)));
  if (!/^%!PS/.test(head)) throw new Error(`${fileName} is not a readable EPS file.`);
  const text = latin1(bytes.length > 65536 ? bytes.subarray(0, 32768) : bytes) + (bytes.length > 65536 ? latin1(bytes.subarray(bytes.length - 32768)) : '');
  const box = (re => { const all = [...text.matchAll(re)].map(m => m.slice(1, 5).map(Number)); return all.find(a => a.every(Number.isFinite)); });
  const bbox = box(/%%HiResBoundingBox:\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g) || box(/%%BoundingBox:\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g);
  if (!bbox || bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) throw new Error(`${fileName} has no bounding box (%%BoundingBox), which an EPS file must have.`);
  const [llx, lly, urx, ury] = bbox, W = urx - llx, H = ury - lly;
  const BASE = [1, 0, 0, -1, -llx, ury];

  const issues = new Set();
  let out = [];
  const defs = [];
  let ids = 0, drawn = 0, ops = 0;
  const id = k => k + (++ids);

  // ---- state ----
  const ostack = [];
  const systemdict = newDict(), globaldict = newDict(), userdict = newDict(), statusdict = newDict(), errordict = newDict(), fontDirectory = newDict();
  const dstack = [systemdict, globaldict, userdict];
  const resources = new Map(); // category -> dict
  const files = [];
  const freshGS = () => ({ ctm: [...BASE], path: [], cp: null, space: { kind: 'gray', n: 1 }, comps: [0], pattern: null, lineWidth: 1, cap: 0, join: 0, miter: 10,
    dash: [], dashOffset: 0, font: null, open: 0, clipped: 0 });
  let gs = freshGS();
  const gstack = [];

  const push = v => ostack.push(v);
  const pop = () => { if (!ostack.length) throw new PSError('stackunderflow'); return ostack.pop(); };
  const popNum = () => num(pop());
  const popInt = () => Math.trunc(popNum());
  const popBool = () => { const v = pop(); if (typeof v !== 'boolean') throw new PSError('typecheck', 'boolean expected'); return v; };
  const popType = t => { const v = pop(); if (!v || v.t !== t) throw new PSError('typecheck', t + ' expected'); return t === 'file' ? ready(v) : v; };
  const popProc = () => { const v = pop(); if (!v || v.t !== 'array') throw new PSError('typecheck', 'procedure expected'); return v; };
  const popMatrix = () => { const m = popType('array'); return m.v.map(Number); };
  const lookup = n => { for (let i = dstack.length - 1; i >= 0; i--) { const e = dstack[i].m.get(n); if (e !== undefined) return e[1]; } return undefined; };
  const vm = { lookup };
  const def = (n, fn) => dput(systemdict, name(n), { t: 'op', n, fn });

  // ---- execution ----
  function execute(o) {
    if (++ops > MAX_OPS) throw new PSError('limitcheck', 'the program runs too long');
    if (typeof o !== 'object' || o === null) { push(o); return; }
    switch (o.t) {
      case 'op': o.fn(); return;
      case 'name': {
        if (o.lit) { push(o); return; }
        const v = lookup(o.n);
        if (v === undefined) throw new PSError('undefined', o.n);
        if (v && v.t === 'array' && v.exec) { runProc(v); return; }
        if (v && (v.t === 'op' || (v.t === 'name' && !v.lit) || (v.t === 'string' && v.exec) || (v.t === 'file' && v.exec))) { execute(v); return; }
        push(v); return;
      }
      case 'array': if (o.exec) { runProc(o); return; } push(o); return;
      case 'string': if (o.exec) { runFile(fileOf(o.b)); return; } push(o); return;
      case 'file': if (o.exec) { runFile(o); return; } push(o); return;
      default: push(o);
    }
  }
  function runProc(proc) {
    for (const el of proc.v) {
      if (typeof el === 'object' && el !== null && ((el.t === 'name' && !el.lit) || el.t === 'op')) execute(el);
      else push(el);
    }
  }
  function runFile(file) {
    files.push(file);
    try {
      for (;;) {
        if (file.closed) break;
        const tok = scan(file, vm);
        if (tok === undefined) break;
        if (typeof tok === 'object' && tok.t === 'name' && !tok.lit) execute(tok);
        else push(tok);
      }
    } finally { files.pop(); }
  }
  const currentFile = () => files[files.length - 1] || fileOf(new Uint8Array(0));

  // ---- colour ----
  const clamp = v => Math.max(0, Math.min(1, v));
  const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('');
  function spaceOf(o) {
    const nm = o.t === 'name' ? o.n : o.t === 'array' && o.v[0]?.t === 'name' ? o.v[0].n : '';
    switch (nm) {
      case 'DeviceGray': case 'CalGray': case 'CIEBasedA': return { kind: 'gray', n: 1 };
      case 'DeviceRGB': case 'CalRGB': case 'CIEBasedABC': case 'Lab': return { kind: 'rgb', n: 3 };
      case 'DeviceCMYK': case 'CIEBasedDEFG': return { kind: 'cmyk', n: 4 };
      case 'CIEBasedDEF': return { kind: 'rgb', n: 3 };
      case 'ICCBased': { const n = dget(o.v[1], name('N')) || 3; return { kind: n === 1 ? 'gray' : n === 4 ? 'cmyk' : 'rgb', n }; }
      case 'Indexed': { const base = spaceOf(o.v[1]), hival = o.v[2], lookupT = o.v[3]; return { kind: 'indexed', n: 1, base, hival, lookup: lookupT }; }
      case 'Separation': return { kind: 'tint', n: 1, alt: spaceOf(o.v[2]), proc: o.v[3] };
      case 'DeviceN': return { kind: 'tint', n: o.v[1].v.length, alt: spaceOf(o.v[2]), proc: o.v[3] };
      case 'Pattern': return { kind: 'pattern', n: 1, under: o.v && o.v[1] ? spaceOf(o.v[1]) : null };
      default: return { kind: 'rgb', n: 3 };
    }
  }
  const defaultComps = sp => (sp.kind === 'cmyk' ? [0, 0, 0, 1] : sp.kind === 'rgb' ? [0, 0, 0] : sp.kind === 'tint' ? new Array(sp.n).fill(1) : [0]);
  function toRGB(sp, c) {
    switch (sp.kind) {
      case 'gray': return [c[0], c[0], c[0]];
      case 'rgb': return [c[0], c[1], c[2]];
      case 'cmyk': return [1 - Math.min(1, c[0] + c[3]), 1 - Math.min(1, c[1] + c[3]), 1 - Math.min(1, c[2] + c[3])];
      case 'indexed': {
        const i = Math.max(0, Math.min(sp.hival, Math.round(c[0]))), n = sp.base.n;
        let comps;
        if (sp.lookup.t === 'string') comps = Array.from(sp.lookup.b.subarray(i * n, i * n + n), v => v / 255);
        else { push(i); execute(sp.lookup); comps = []; for (let k = 0; k < n; k++) comps.unshift(popNum()); }
        return toRGB(sp.base, comps);
      }
      case 'tint': { for (const v of c) push(v); execute(sp.proc); const comps = []; for (let k = 0; k < sp.alt.n; k++) comps.unshift(popNum()); return toRGB(sp.alt, comps); }
      default: return [0, 0, 0];
    }
  }
  const currentRGB = () => toRGB(gs.space, gs.comps);
  const paint = () => (gs.pattern ? patternPaint(gs.pattern) : hex(...currentRGB()));

  // ---- output ----
  const pt = ([x, y]) => P.num(x) + ' ' + P.num(y);
  function pathD(path, m = null) {
    let d = '';
    for (const s of path) {
      const q = m ? s.p.map(p => P.apply(m, ...p)) : s.p;
      d += s.op === 'Z' ? 'Z' : s.op + q.map(pt).join(' ');
    }
    return d;
  }
  function strokeAttrs(scale, m) {
    const w = gs.lineWidth > 0 ? gs.lineWidth * scale : 0.25 * (m ? 1 / (P.lengthScale(m).scale || 1) : 1);
    let a = `stroke="${paint()}" stroke-width="${P.num(w, 4)}"`;
    if (gs.cap) a += ` stroke-linecap="${P.CAPS[gs.cap] || 'butt'}"`;
    if (gs.join) a += ` stroke-linejoin="${P.JOINS[gs.join] || 'miter'}"`;
    if (gs.join === 0 && gs.miter !== 4) a += ` stroke-miterlimit="${P.num(Math.max(1, gs.miter), 3)}"`;
    if (gs.dash.length && gs.dash.some(v => v > 0)) a += ` stroke-dasharray="${gs.dash.map(v => P.num(v * scale, 4)).join(' ')}"` + (gs.dashOffset ? ` stroke-dashoffset="${P.num(gs.dashOffset * scale, 4)}"` : '');
    return a;
  }
  function fillPath(evenOdd) {
    if (!gs.path.length) return;
    const d = pathD(gs.path);
    if (d) { out.push(`<path d="${d}" fill="${paint()}"${evenOdd ? ' fill-rule="evenodd"' : ''}/>`); drawn++; }
  }
  function strokePath() {
    if (!gs.path.length) return;
    const { scale, uniform } = P.lengthScale(gs.ctm);
    if (uniform) out.push(`<path d="${pathD(gs.path)}" fill="none" ${strokeAttrs(scale, null)}/>`);
    else {
      const inv = P.invert(gs.ctm) || P.IDENTITY;
      out.push(`<path transform="${P.matrixAttr(gs.ctm)}" d="${pathD(gs.path, inv)}" fill="none" ${strokeAttrs(1, gs.ctm)}/>`);
    }
    drawn++;
  }
  function clipWith(evenOdd) {
    const cid = id('c');
    defs.push(`<clipPath id="${cid}" clipPathUnits="userSpaceOnUse"><path d="${pathD(gs.path) || 'M0 0Z'}"${evenOdd ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
    out.push(`<g clip-path="url(#${cid})">`); gs.open++; gs.clipped++;
  }
  const pageRect = () => [[llx, lly], [urx, lly], [urx, ury], [llx, ury]].map((q, i) => ({ op: i ? 'L' : 'M', p: [P.apply(BASE, ...q)] })).concat([{ op: 'Z', p: [] }]);
  const userPoint = () => { if (!gs.cp) throw new PSError('nocurrentpoint'); return P.apply(P.invert(gs.ctm) || P.IDENTITY, ...gs.cp); };
  const dev = (x, y) => P.apply(gs.ctm, x, y);
  const moveTo = (x, y) => { const p = dev(x, y); if (gs.path.length && gs.path[gs.path.length - 1].op === 'M') gs.path.pop(); gs.path.push({ op: 'M', p: [p] }); gs.cp = p; gs.start = p; };
  const lineTo = (x, y) => { if (!gs.cp) throw new PSError('nocurrentpoint'); const p = dev(x, y); gs.path.push({ op: 'L', p: [p] }); gs.cp = p; };
  const curveTo = (a, b, c, d, e, f) => { if (!gs.cp) throw new PSError('nocurrentpoint'); const p = [dev(a, b), dev(c, d), dev(e, f)]; gs.path.push({ op: 'C', p }); gs.cp = p[2]; };
  function arcTo(x, y, r, a1, a2, negative) {
    let s = a1 * Math.PI / 180, e = a2 * Math.PI / 180;
    if (negative) { while (e > s) e -= 2 * Math.PI; } else { while (e < s) e += 2 * Math.PI; }
    const pts = arcPoints(x, y, r, r, s, e);
    if (gs.cp) lineTo(...pts[0]); else moveTo(...pts[0]);
    for (let i = 1; i + 2 < pts.length + 0; i += 3) curveTo(...pts[i], ...pts[i + 1], ...pts[i + 2]);
  }
  function gsave() { gstack.push(gs); gs = { ...gs, path: gs.path.map(s => ({ op: s.op, p: s.p.slice() })), open: 0, clipped: 0, dash: gs.dash.slice(), comps: gs.comps.slice() }; }
  function grestore() { if (!gstack.length) return; out.push('</g>'.repeat(gs.open)); gs = gstack.pop(); }

  // ---- patterns and shadings ----
  function functionStops(fn) {
    const f = fn.t === 'array' ? fn.v[0] : fn;
    if (!f || f.t !== 'dict') return null;
    const type = dget(f, name('FunctionType'));
    if (type === 2) {
      const c0 = dget(f, name('C0'))?.v || [0], c1 = dget(f, name('C1'))?.v || [1], n = dget(f, name('N')) ?? 1;
      if (n === 1) return [[0, c0], [1, c1]];
      return Array.from({ length: 9 }, (_, i) => { const t = i / 8; return [t, c0.map((v, k) => v + (c1[k] - v) * Math.pow(t, n))]; });
    }
    if (type === 3) {
      const fns = dget(f, name('Functions')).v, bounds = dget(f, name('Bounds')).v, domain = dget(f, name('Domain')).v;
      const edges = [domain[0], ...bounds, domain[1]], stops = [];
      fns.forEach((g, i) => { const s = functionStops(g) || []; for (const [t, c] of s) stops.push([(edges[i] + t * (edges[i + 1] - edges[i]) - domain[0]) / (domain[1] - domain[0]), c]); });
      return stops;
    }
    return null; // sampled functions: not read
  }
  function shadingGradient(sh, m) {
    const type = dget(sh, name('ShadingType')), sp = spaceOf(dget(sh, name('ColorSpace')) || name('DeviceRGB'));
    if (type !== 2 && type !== 3) { issues.add(ISSUES.shading); return null; }
    const coords = dget(sh, name('Coords')).v, stops = functionStops(dget(sh, name('Function')));
    if (!stops) { issues.add(ISSUES.shading); return null; }
    const gid = id('g');
    const stopTags = stops.map(([o, c]) => `<stop offset="${P.num(clamp(o), 4)}" stop-color="${hex(...toRGB(sp, c))}"/>`).join('');
    const common = `id="${gid}" gradientUnits="userSpaceOnUse" gradientTransform="${P.matrixAttr(m)}"`;
    defs.push(type === 2 ? `<linearGradient ${common} x1="${P.num(coords[0])}" y1="${P.num(coords[1])}" x2="${P.num(coords[2])}" y2="${P.num(coords[3])}">${stopTags}</linearGradient>`
      : `<radialGradient ${common} fx="${P.num(coords[0])}" fy="${P.num(coords[1])}" fr="${P.num(coords[2])}" cx="${P.num(coords[3])}" cy="${P.num(coords[4])}" r="${P.num(coords[5])}">${stopTags}</radialGradient>`);
    return `url(#${gid})`;
  }
  const tiles = new Map(); // pattern dictionary -> colour -> url
  function patternPaint(pat) {
    if (pat.type === 2) return shadingGradient(pat.shading, pat.matrix) || '#808080';
    // A tiling pattern: its cell drawn once by its PaintProc, in pattern space, as an SVG <pattern>.
    const key = pat.rgb ? pat.rgb.join() : '';
    if (!tiles.has(pat.dict)) tiles.set(pat.dict, new Map());
    const known = tiles.get(pat.dict);
    if (known.has(key)) return known.get(key);
    const d = pat.dict, bbox = dget(d, name('BBox')).v.map(Number), xs = Math.abs(dget(d, name('XStep'))), ys = Math.abs(dget(d, name('YStep')));
    const keepOut = out, keepGs = gs, depth = gstack.length, drawnBefore = drawn;
    out = [];
    gs = { ...freshGS(), ctm: [...P.IDENTITY], font: keepGs.font };
    if (pat.rgb) { gs.space = { kind: 'rgb', n: 3 }; gs.comps = pat.rgb.slice(); }
    try { push(d); execute(dget(d, name('PaintProc'))); }
    finally { while (gstack.length > depth) grestore(); out.push('</g>'.repeat(gs.open)); }
    const cell = out.join('');
    out = keepOut; gs = keepGs; drawn = drawnBefore;
    const pid = id('p');
    defs.push(`<pattern id="${pid}" patternUnits="userSpaceOnUse" x="${P.num(bbox[0])}" y="${P.num(bbox[1])}" width="${P.num(xs || bbox[2] - bbox[0])}" height="${P.num(ys || bbox[3] - bbox[1])}" patternTransform="${P.matrixAttr(pat.matrix)}">${cell}</pattern>`);
    known.set(key, `url(#${pid})`);
    return known.get(key);
  }
  /** The colour components an uncoloured pattern takes (below it on the stack), as RGB. */
  function patternColour(pat) {
    if (!pat.pattern || pat.pattern.type !== 1 || dget(pat, name('PaintType')) !== 2) return null;
    const under = gs.space.kind === 'pattern' ? gs.space.under || { kind: 'rgb', n: 3 } : gs.space;
    const c = []; for (let k = 0; k < under.n; k++) c.unshift(popNum());
    return toRGB(under, c);
  }

  // ---- fonts and text ----
  const INTERNAL = name('\0font', true);
  const internal = font => dget(font, INTERNAL)?.v;
  function standardFont(fontName) {
    const d = newDict(), info = P.pdfFont(fontName);
    const symbol = /^symbol/i.test(fontName), mono = /courier|mono/i.test(fontName);
    const face = symbol ? 'Liberation Sans' : faceFor(info.family + (mono && !/mono|courier/i.test(info.family) ? ' Mono' : ''));
    dput(d, name('FontType'), 1); dput(d, name('FontName'), name(fontName, true)); dput(d, name('FontMatrix'), arr([0.001, 0, 0, 0.001, 0, 0]));
    dput(d, name('Encoding'), arr((symbol ? STANDARD : STANDARD).map(n => (n ? name(n, true) : name('.notdef', true)))));
    dput(d, name('FontBBox'), arr([-200, -250, 1200, 950]));
    dput(d, INTERNAL, { t: 'internal', id: 'std:' + fontName, v: { kind: 'standard', face, style: styleKey(info.bold ? 'bold' : 'normal', info.italic ? 'italic' : 'normal'), family: symbol ? 'Symbol' : info.family, bold: info.bold, italic: info.italic, symbol } });
    return d;
  }
  function findFont(key) {
    const k = key.t === 'name' ? key.n : latin1(key.b);
    let f = dget(fontDirectory, name(k));
    if (!f) { f = standardFont(k); dput(fontDirectory, name(k, true), f); }
    return f;
  }
  function defineFont(key, font) {
    if (!internal(font)) {
      const type = dget(font, name('FontType'));
      if (type === 42) {
        const parts = (dget(font, name('sfnts'))?.v || []).map(s => (s.b.length % 2 ? s.b.subarray(0, s.b.length - 1) : s.b));
        const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let at = 0; for (const p of parts) { all.set(p, at); at += p.length; }
        let tt = null; try { tt = parseTrueType(all); } catch { /* unreadable: drawn as standard text */ }
        dput(font, INTERNAL, { t: 'internal', id: 'f' + (++ids), v: tt ? { kind: 'type42', tt } : standardInfo(font) });
      } else if (type === 3) dput(font, INTERNAL, { t: 'internal', id: 'f' + (++ids), v: { kind: 'type3' } });
      else if (type === 1 && dget(font, name('CharStrings')) && dget(font, name('Private'))) {
        const priv = dget(font, name('Private')), lenIV = dget(priv, name('lenIV')) ?? 4, subrs = dget(priv, name('Subrs'));
        dput(font, INTERNAL, { t: 'internal', id: 'f' + (++ids), v: { kind: 'type1', lenIV, subrs: subrs ? subrs.v : [], cache: new Map() } });
      } else if (type === 0) { issues.add(ISSUES.composite); dput(font, INTERNAL, { t: 'internal', id: 'f' + (++ids), v: standardInfo(font) }); }
      else dput(font, INTERNAL, { t: 'internal', id: 'f' + (++ids), v: standardInfo(font) });
    }
    if (!dget(font, name('FID'))) dput(font, name('FID'), { t: 'fontid' });
    dput(fontDirectory, key, font);
    return font;
  }
  function standardInfo(font) { const n = dget(font, name('FontName')); return internal(standardFont(n ? (n.t === 'name' ? n.n : latin1(n.b)) : 'Helvetica')); }
  const fontMatrix = font => (dget(font, name('FontMatrix'))?.v || [0.001, 0, 0, 0.001, 0, 0]).map(Number);
  function glyphName(font, code) { const e = dget(font, name('Encoding')); const n = e && e.t === 'array' ? e.v[code] : null; return n ? (n.t === 'name' ? n.n : latin1(n.b)) : '.notdef'; }
  /** A glyph: { width (glyph space), text (Unicode), ops (outline, glyph space) | null, type3 }. */
  function glyph(font, code, gname = null) {
    const info = internal(font) || standardInfo(font), nm = gname || glyphName(font, code);
    if (info.kind === 'standard') {
      const ch = info.symbol ? symbolChar(code) : glyphText(nm) || (code >= 32 && code < 127 ? String.fromCharCode(code) : '');
      const em = fonts && ch ? fonts.width(info.face, info.style, ch) : null;
      return { width: (em ?? (info.face === 'Liberation Mono' ? 0.6 : 0.5)) * 1000, text: ch, ops: null, info };
    }
    if (info.kind === 'type42') {
      const cs = dget(font, name('CharStrings'));
      let gid = cs ? dget(cs, name(nm)) : undefined;
      if (gid === undefined) gid = info.tt.glyphIndex(glyphText(nm).codePointAt(0) || code);
      gid = typeof gid === 'number' ? gid : 0;
      const k = 1 / info.tt.unitsPerEm;
      const ops = info.tt.outline(gid).map((v, i, a) => v); // font units, scaled below
      return { width: info.tt.advance(gid) * k, text: glyphText(nm), ops: scaleOps(ops, k), info };
    }
    if (info.kind === 'type1') {
      if (!info.cache.has(nm)) {
        const cs = dget(font, name('CharStrings')), get = n => { const s = cs && dget(cs, name(n)); return s && s.t === 'string' ? s.b : null; };
        const subr = i => { const s = info.subrs[i]; return s && s.t === 'string' ? s.b : null; };
        const make = (n, depth) => { const code2 = get(n); return code2 && depth < 4 ? type1Glyph(code2, subr, info.lenIV, make, depth) : null; };
        info.cache.set(nm, make(nm, 0) || { width: 0, ops: [] });
      }
      const g = info.cache.get(nm);
      return { width: g.width, text: glyphText(nm), ops: g.ops, info };
    }
    return { width: 0, text: glyphText(nm), ops: null, info, type3: true, name: nm, code };
  }
  function scaleOps(ops, k) {
    const out = [];
    for (let i = 0; i < ops.length;) { const op = ops[i++]; out.push(op); const n = op === P.DRAW.closePath ? 0 : op === P.DRAW.curveTo ? 6 : op === P.DRAW.quadraticCurveTo ? 4 : 2; for (let q = 0; q < n; q++) out.push(ops[i++] * k); }
    return out;
  }
  /** Runs a Type 3 glyph's procedure at the current point; returns its width (glyph space). */
  function type3Glyph(font, g, draw) {
    let width = [0, 0];
    gsave();
    try {
      const [x, y] = gs.cp ? userPoint() : [0, 0];
      gs.ctm = P.multiply(P.multiply(gs.ctm, [1, 0, 0, 1, x, y]), fontMatrix(font));
      gs.path = []; gs.cp = null;
      const keepOut = out.length;
      const buildGlyph = dget(font, name('BuildGlyph')), buildChar = dget(font, name('BuildChar'));
      charWidth = w => { width = w; };
      push(font);
      if (buildGlyph) { push(name(g.name, true)); execute(buildGlyph); }
      else if (buildChar) { push(g.code); execute(buildChar); }
      else pop();
      if (!draw) out.length = keepOut;
    } finally { charWidth = null; grestore(); }
    return width;
  }
  let charWidth = null;
  /** Draws (or, with draw false, measures) the codes of `s` with the current font. Per glyph, `extra(i, glyph)` returns [dx, dy] to add. */
  function show(codes, { draw = true, extra = null, explicit = null, path = false } = {}) {
    const font = gs.font;
    if (!font) throw new PSError('invalidfont', 'no current font');
    const fm = fontMatrix(font), info = internal(font) || standardInfo(font);
    if (!gs.cp) throw new PSError('nocurrentpoint');
    let [x, y] = userPoint();
    const startX = x, startY = y;
    const words = []; let word = null, breakNext = false;
    const flush = () => { if (word && word.text.trim()) words.push(word); word = null; };
    const em = Math.hypot(fm[0], fm[1]) * 1000; // the font size in user units
    for (let i = 0; i < codes.length; i++) {
      const g = typeof codes[i] === 'string' ? glyph(font, 0, codes[i]) : glyph(font, codes[i]);
      let w;
      if (g.type3) { gs.cp = dev(x, y); w = type3Glyph(font, g, draw && !path); w = P.apply([fm[0], fm[1], fm[2], fm[3], 0, 0], w[0], w[1]); }
      else {
        w = P.apply([fm[0], fm[1], fm[2], fm[3], 0, 0], g.width, 0);
        if (g.ops && (draw || path)) {
          const m = P.multiply(P.multiply(gs.ctm, [1, 0, 0, 1, x, y]), fm), d = P.pathData(g.ops, m);
          if (path) gs.path.push(...pathSegments(g.ops, m));
          else if (d) { out.push(`<path d="${d}" fill="${paint()}"/>`); drawn++; }
        } else if (info.kind === 'standard' && (draw || path)) {
          if (path) { const o = fonts && fonts.outline ? fonts.outline(info.face, info.style, g.text) : null; if (o) gs.path.push(...pathSegments(scaleOps(o.ops, 1000 / o.unitsPerEm), P.multiply(P.multiply(gs.ctm, [1, 0, 0, 1, x, y]), fm))); }
          else if (/\s/.test(g.text) || !g.text) flush();
          else { if (!word || breakNext) { flush(); word = { x, y, text: '' }; } word.text += g.text; }
        }
      }
      let [dx, dy] = w;
      if (explicit) { [dx, dy] = explicit(i); }
      else if (extra) { const [ex, ey] = extra(i, codes[i]); dx += ex; dy += ey; }
      // The next character starts a word of its own unless it comes where the font's widths put it.
      breakNext = Math.hypot(dx - w[0], dy - w[1]) > 0.02 * em;
      x += dx; y += dy;
    }
    flush();
    if (draw && !path) for (const wd of words) emitText(font, info, wd, fm);
    gs.cp = dev(x, y);
    return [x - startX, y - startY];
  }
  function pathSegments(ops, m) {
    const segs = [];
    for (let i = 0; i < ops.length;) {
      const op = ops[i++];
      if (op === P.DRAW.moveTo) { segs.push({ op: 'M', p: [P.apply(m, ops[i], ops[i + 1])] }); i += 2; }
      else if (op === P.DRAW.lineTo) { segs.push({ op: 'L', p: [P.apply(m, ops[i], ops[i + 1])] }); i += 2; }
      else if (op === P.DRAW.curveTo) { segs.push({ op: 'C', p: [P.apply(m, ops[i], ops[i + 1]), P.apply(m, ops[i + 2], ops[i + 3]), P.apply(m, ops[i + 4], ops[i + 5])] }); i += 6; }
      else if (op === P.DRAW.quadraticCurveTo) { segs.push({ op: 'Q', p: [P.apply(m, ops[i], ops[i + 1]), P.apply(m, ops[i + 2], ops[i + 3])] }); i += 4; }
      else segs.push({ op: 'Z', p: [] });
    }
    return segs;
  }
  function emitText(font, info, word, fm) {
    // Em space (1 = 1 em, y down) to the page.
    const T = P.multiply(P.multiply(P.multiply(gs.ctm, [1, 0, 0, 1, word.x, word.y]), fm), [1000, 0, 0, -1000, 0, 0]);
    const size = Math.sqrt(Math.abs(T[0] * T[3] - T[1] * T[2])) || 1;
    const Tn = P.multiply(T, [1 / size, 0, 0, 1 / size, 0, 0]);
    out.push(`<text transform="${P.matrixAttr(Tn)}" font-family="${P.escapeXML(info.family)}"${info.bold ? ' font-weight="bold"' : ''}${info.italic ? ' font-style="italic"' : ''} font-size="${P.num(size, 4)}" fill="${paint()}">${P.escapeXML(word.text)}</text>`);
    drawn++;
  }
  const codesOf = s => Array.from(s.b);

  // ---- images ----
  function readSource(src, n) {
    const chunks = []; let have = 0;
    if (src.t === 'string') { while (have < n && src.b.length) { chunks.push(src.b); have += src.b.length; } }
    else if (src.t === 'file') { ready(src); const take = src.b.subarray(src.pos, src.pos + n); src.pos += take.length; chunks.push(take); have = take.length; }
    else if (isProc(src)) {
      for (let guard = 0; have < n && guard < 1e6; guard++) { execute(src); const s = pop(); if (!s || s.t !== 'string' || !s.b.length) break; chunks.push(s.b.slice()); have += s.b.length; }
    }
    const all = new Uint8Array(Math.max(have, 0)); let at = 0; for (const c of chunks) { all.set(c.subarray(0, Math.min(c.length, all.length - at)), at); at += c.length; if (at >= all.length) break; }
    return all.subarray(0, Math.min(all.length, n));
  }
  function drawImage({ width, height, bpc, matrix, sources, space, decode, mask = null, multi = false, interpolate = false }) {
    if (!width || !height || width * height > 64e6) { issues.add(ISSUES.image); return; }
    const ncomp = mask ? 1 : space.n;
    // A JPEG kept as it is.
    if (sources.length === 1 && sources[0].t === 'file' && ready(sources[0]).jpeg) {
      const bytes = sources[0].b.subarray(sources[0].pos); sources[0].pos = sources[0].b.length;
      placeImage({ width, height, mime: 'image/jpeg', bytes }, matrix, interpolate); return;
    }
    const rowBytes = Math.ceil(width * bpc * (multi ? 1 : ncomp) / 8);
    const planes = multi ? sources.map(s => readSource(s, rowBytes * height)) : [readSource(sources[0], rowBytes * height)];
    const rgba = new Uint8ClampedArray(width * height * 4), max = (1 << bpc) - 1;
    const sample = (plane, row, index) => {
      const bit = index * bpc, at = row * rowBytes + (bit >> 3);
      if (bpc === 8) return plane[at] ?? 0;
      if (bpc === 16) return ((plane[at] << 8) | plane[at + 1]) >>> 8;
      return ((plane[at] ?? 0) >> (8 - bpc - (bit & 7))) & max;
    };
    const dec = decode || (space.kind === 'indexed' ? [0, max] : Array.from({ length: ncomp }, () => [0, 1]).flat());
    const fullMax = bpc === 16 ? 255 : max;
    for (let row = 0; row < height; row++) for (let x = 0; x < width; x++) {
      const comps = [];
      for (let k = 0; k < ncomp; k++) {
        const raw = multi ? sample(planes[k], row, x) : sample(planes[0], row, x * ncomp + k);
        comps.push(dec[k * 2] + raw * (dec[k * 2 + 1] - dec[k * 2]) / fullMax);
      }
      const o = (row * width + x) * 4;
      if (mask) {
        const on = mask.polarity ? comps[0] >= 0.5 : comps[0] < 0.5;
        if (on) { rgba[o] = mask.rgb[0] * 255; rgba[o + 1] = mask.rgb[1] * 255; rgba[o + 2] = mask.rgb[2] * 255; rgba[o + 3] = 255; }
      } else { const [r, g, b] = toRGB(space, comps); rgba[o] = r * 255; rgba[o + 1] = g * 255; rgba[o + 2] = b * 255; rgba[o + 3] = 255; }
    }
    placeImage({ width, height, rgba }, matrix, interpolate);
  }
  function placeImage(img, matrix, interpolate) {
    const inv = P.invert(matrix);
    if (!inv) { issues.add(ISSUES.image); return; }
    const t = P.multiply(P.multiply(gs.ctm, inv), [img.width, 0, 0, img.height, 0, 0]);
    const href = image ? image(img, { x: 0, y: 0, width: img.width, height: img.height }) : 'data:,';
    if (!href) { issues.add(ISSUES.image); return; }
    const px = P.lengthScale(t).scale / Math.sqrt(img.width * img.height);
    out.push(`<image x="0" y="0" width="1" height="1" preserveAspectRatio="none" transform="${P.matrixAttr(t)}"${!interpolate && px >= 1 ? ' style="image-rendering:pixelated"' : ''} href="${href}"/>`);
    drawn++;
  }
  function imageOperands(kind) {
    // Level 2: one dictionary.
    if (ostack.length && ostack[ostack.length - 1]?.t === 'dict') {
      const d = pop();
      const g = k => dget(d, name(k));
      const decode = g('Decode') ? g('Decode').v.map(Number) : null;
      const src = g('DataSource');
      const base = { width: g('Width'), height: g('Height'), bpc: g('BitsPerComponent') ?? 1, matrix: g('ImageMatrix').v.map(Number), sources: src.t === 'array' && !src.exec ? src.v : [src], multi: !!g('MultipleDataSources'), decode, interpolate: !!g('Interpolate') };
      if (kind === 'mask') return { ...base, mask: { polarity: decode ? decode[0] === 0 : true, rgb: currentRGB() }, space: { kind: 'gray', n: 1 } };
      return { ...base, space: gs.space.kind === 'pattern' ? { kind: 'rgb', n: 3 } : gs.space };
    }
    if (kind === 'mask') { const src = pop(), matrix = popMatrix(), polarity = popBool(), height = popInt(), width = popInt(); return { width, height, bpc: 1, matrix, sources: [src], mask: { polarity, rgb: currentRGB() }, space: { kind: 'gray', n: 1 } }; }
    if (kind === 'color') {
      const ncomp = popInt(), multi = popBool(), sources = [];
      for (let k = 0; k < (multi ? ncomp : 1); k++) sources.unshift(pop());
      const matrix = popMatrix(), bpc = popInt(), height = popInt(), width = popInt();
      return { width, height, bpc, matrix, sources, multi, space: ncomp === 1 ? { kind: 'gray', n: 1 } : ncomp === 4 ? { kind: 'cmyk', n: 4 } : { kind: 'rgb', n: 3 } };
    }
    const src = pop(), matrix = popMatrix(), bpc = popInt(), height = popInt(), width = popInt();
    return { width, height, bpc, matrix, sources: [src], space: { kind: 'gray', n: 1 } };
  }

  // ---- filters ----
  /** A filter reads its source only when its data is first read (the data usually follows later operators). */
  function makeFilter(source, filterName, params) {
    return { t: 'file', b: null, pos: 0, lazy: () => decodeFilter(source, filterName, params) };
  }
  function ready(f) {
    if (f && f.t === 'file' && f.b === null && f.lazy) { const d = f.lazy(); f.b = d.b; f.jpeg = d.jpeg; f.pos = 0; f.lazy = null; }
    return f;
  }
  function decodeFilter(source, filterName, params) {
    const all = src => (src.t === 'file' ? ready(src) : src.t === 'string' ? fileOf(src.b) : { t: 'file', b: readSource(src, 1 << 26), pos: 0 });
    const f = all(source), b = f.b;
    const rest = () => b.subarray(f.pos);
    let data, jpeg = false;
    switch (filterName) {
      case 'ASCIIHexDecode': { const end = b.indexOf(62, f.pos); data = decodeHex(latin1(b.subarray(f.pos, end < 0 ? b.length : end))); f.pos = end < 0 ? b.length : end + 1; break; }
      case 'ASCII85Decode': { const end = indexOfSeq(b, [126, 62], f.pos); data = decodeA85(latin1(b.subarray(f.pos, end < 0 ? b.length : end))); f.pos = end < 0 ? b.length : end + 2; break; }
      case 'RunLengthDecode': {
        const o = []; let i = f.pos;
        while (i < b.length) { const n = b[i++]; if (n === 128) break; if (n < 128) { for (let k = 0; k <= n; k++) o.push(b[i++]); } else { const v = b[i++]; for (let k = 0; k < 257 - n; k++) o.push(v); } }
        f.pos = i; data = Uint8Array.from(o); break;
      }
      case 'LZWDecode': {
        const early = params && dget(params, name('EarlyChange')) === 0 ? 0 : 1;
        const o = [], dictT = []; let bitPos = f.pos * 8, width = 9, prev = null;
        const reset = () => { dictT.length = 0; for (let k = 0; k < 256; k++) dictT.push([k]); dictT.push(null, null); width = 9; prev = null; };
        reset();
        for (;;) {
          if ((bitPos + width) > b.length * 8) break;
          let code = 0; for (let k = 0; k < width; k++) { code = (code << 1) | ((b[(bitPos + k) >> 3] >> (7 - ((bitPos + k) & 7))) & 1); }
          bitPos += width;
          if (code === 256) { reset(); continue; }
          if (code === 257) break;
          let entry = code < dictT.length && dictT[code] ? dictT[code] : prev ? [...prev, prev[0]] : null;
          if (!entry) break;
          o.push(...entry);
          if (prev) dictT.push([...prev, entry[0]]);
          prev = entry;
          if (dictT.length + early >= (1 << width) && width < 12) width++;
        }
        f.pos = Math.ceil(bitPos / 8); data = Uint8Array.from(o); break;
      }
      case 'FlateDecode': {
        if (!inflate) { issues.add(ISSUES.filter); data = new Uint8Array(0); break; }
        try { const r = inflate(rest()); data = r.data; f.pos += r.used; } catch { issues.add(ISSUES.filter); data = new Uint8Array(0); }
        break;
      }
      case 'DCTDecode': { // kept as JPEG: up to its end marker
        let end = f.pos; for (let i = f.pos; i < b.length - 1; i++) if (b[i] === 0xff && b[i + 1] === 0xd9) { end = i + 2; break; }
        data = b.subarray(f.pos, end); f.pos = end; jpeg = true; break;
      }
      case 'SubFileDecode': {
        const eod = params && params.t === 'string' ? params.b : null, count = typeof params === 'number' ? params : 0;
        if (eod && eod.length) { let end = indexOfSeq(b, Array.from(eod), f.pos); if (count) { for (let k = 1; k < count && end >= 0; k++) end = indexOfSeq(b, Array.from(eod), end + eod.length); } end = end < 0 ? b.length : end; data = b.subarray(f.pos, end); f.pos = end + eod.length; }
        else { data = count ? b.subarray(f.pos, f.pos + count) : rest(); f.pos += data.length; }
        break;
      }
      case 'NullEncode': case 'ASCIIHexEncode': case 'ASCII85Encode': data = new Uint8Array(0); break;
      default: issues.add(ISSUES.filter); data = new Uint8Array(0);
    }
    return { b: data, jpeg };
  }

  // ================================================================ operators
  const ops2 = {
    // stack
    pop: () => { pop(); }, exch: () => { const b = pop(), a = pop(); push(b); push(a); }, dup: () => { const a = pop(); push(a); push(a); },
    copy: () => {
      const top = pop();
      if (typeof top === 'number') { const n = top; if (n > ostack.length) throw new PSError('rangecheck'); ostack.push(...ostack.slice(ostack.length - n)); return; }
      const src = pop();
      if (top.t === 'array') { top.v.splice(0, src.v.length, ...src.v); push(arr(top.v.slice(0, src.v.length), top.exec)); return; }
      if (top.t === 'string') { top.b.set(src.b.subarray(0, top.b.length)); push(str(top.b.subarray(0, src.b.length))); return; }
      if (top.t === 'dict') { for (const [k, [ko, v]] of src.m) top.m.set(k, [ko, v]); push(top); return; }
      if (top.t === 'gstate') { Object.assign(top.g, src.g); push(top); return; }
      throw new PSError('typecheck', 'copy');
    },
    index: () => { const n = popInt(); push(ostack[ostack.length - 1 - n]); },
    roll: () => { const j = popInt(), n = popInt(); if (!n) return; const part = ostack.splice(ostack.length - n, n), k = ((j % n) + n) % n; ostack.push(...part.slice(n - k), ...part.slice(0, n - k)); },
    clear: () => { ostack.length = 0; }, count: () => push(ostack.length), mark: () => push(MARK), cleartomark: () => { while (ostack.length && pop() !== MARK); },
    counttomark: () => { const i = ostack.lastIndexOf(MARK); if (i < 0) throw new PSError('unmatchedmark'); push(ostack.length - 1 - i); },
    // math
    add: () => { const b = popNum(); push(popNum() + b); }, sub: () => { const b = popNum(); push(popNum() - b); }, mul: () => { const b = popNum(); push(popNum() * b); },
    div: () => { const b = popNum(); push(popNum() / b); }, idiv: () => { const b = popInt(); push(Math.trunc(popInt() / b)); }, mod: () => { const b = popInt(); push(popInt() % b); },
    abs: () => push(Math.abs(popNum())), neg: () => push(-popNum()), ceiling: () => push(Math.ceil(popNum())), floor: () => push(Math.floor(popNum())),
    round: () => push(Math.floor(popNum() + 0.5)), truncate: () => push(Math.trunc(popNum())), sqrt: () => push(Math.sqrt(popNum())),
    atan: () => { const den = popNum(), n = popNum(); let a = Math.atan2(n, den) * 180 / Math.PI; if (a < 0) a += 360; push(a); },
    cos: () => push(Math.cos(popNum() * Math.PI / 180)), sin: () => push(Math.sin(popNum() * Math.PI / 180)),
    exp: () => { const e = popNum(); push(Math.pow(popNum(), e)); }, ln: () => push(Math.log(popNum())), log: () => push(Math.log10(popNum())),
    rand: () => push(Math.floor(Math.random() * 0x7fffffff)), srand: () => { pop(); }, rrand: () => push(0), cvi: () => { const v = pop(); push(typeof v === 'number' ? Math.trunc(v) : Math.trunc(Number(latin1(v.b)))); },
    cvr: () => { const v = pop(); push(typeof v === 'number' ? v : Number(latin1(v.b))); },
    // relational and logic
    eq: () => { const b = pop(), a = pop(); push(equal(a, b)); }, ne: () => { const b = pop(), a = pop(); push(!equal(a, b)); },
    gt: () => { const b = pop(), a = pop(); push(cmp(a, b) > 0); }, ge: () => { const b = pop(), a = pop(); push(cmp(a, b) >= 0); },
    lt: () => { const b = pop(), a = pop(); push(cmp(a, b) < 0); }, le: () => { const b = pop(), a = pop(); push(cmp(a, b) <= 0); },
    and: () => { const b = pop(), a = pop(); push(typeof a === 'boolean' ? a && b : a & b); }, or: () => { const b = pop(), a = pop(); push(typeof a === 'boolean' ? a || b : a | b); },
    xor: () => { const b = pop(), a = pop(); push(typeof a === 'boolean' ? a !== b : a ^ b); }, not: () => { const a = pop(); push(typeof a === 'boolean' ? !a : ~a); },
    bitshift: () => { const s = popInt(), v = popInt(); push(s >= 0 ? v << s : v >> -s); }, true: () => push(true), false: () => push(false),
    // control
    exec: () => execute(pop()),
    if: () => { const p = popProc(); if (popBool()) execute(p); },
    ifelse: () => { const b = popProc(), a = popProc(); execute(popBool() ? a : b); },
    for: () => {
      const p = popProc(), limit = popNum(), inc = popNum(), init = popNum();
      try { for (let v = init; inc > 0 ? v <= limit + 1e-9 : v >= limit - 1e-9; v += inc) { push(v); execute(p); if (inc === 0) break; } } catch (e) { if (e !== EXIT) throw e; }
    },
    repeat: () => { const p = popProc(), n = popInt(); try { for (let i = 0; i < n; i++) execute(p); } catch (e) { if (e !== EXIT) throw e; } },
    loop: () => { const p = popProc(); try { for (;;) execute(p); } catch (e) { if (e !== EXIT) throw e; } },
    exit: () => { throw EXIT; },
    forall: () => {
      const p = popProc(), o = pop();
      try {
        if (o.t === 'array') for (const v of o.v.slice()) { push(v); execute(p); }
        else if (o.t === 'string') for (const v of Array.from(o.b)) { push(v); execute(p); }
        else if (o.t === 'dict') for (const [, [k, v]] of [...o.m]) { push(k); push(v); execute(p); } // a font's internal data is copied with it
      } catch (e) { if (e !== EXIT) throw e; }
    },
    stop: () => { throw STOP; },
    stopped: () => {
      const p = pop(), depth = dstack.length, gdepth = gstack.length;
      try { execute(p); push(false); }
      catch (e) {
        if (e === STOP || e instanceof PSError) { dstack.length = Math.max(3, Math.min(dstack.length, depth)); while (gstack.length > gdepth) grestore(); push(true); }
        else throw e;
      }
    },
    quit: () => { throw QUIT; }, countexecstack: () => push(0), execstack: () => { pop(); push(arr([])); },
    // types and conversion
    type: () => { const o = pop(); push(name(typeof o === 'number' ? (Number.isInteger(o) ? 'integertype' : 'realtype') : typeof o === 'boolean' ? 'booleantype' : ({ name: 'nametype', string: 'stringtype', array: 'arraytype', dict: 'dicttype', op: 'operatortype', mark: 'marktype', null: 'nulltype', file: 'filetype', fontid: 'fonttype', save: 'savetype', gstate: 'gstatetype' })[o.t] || 'nulltype')); },
    cvlit: () => { const o = pop(); push(o && typeof o === 'object' && 'exec' in o ? { ...o, exec: false } : o && o.t === 'name' ? name(o.n, true) : o); },
    cvx: () => { const o = pop(); push(o && o.t === 'name' ? name(o.n, false) : o && typeof o === 'object' && (o.t === 'array' || o.t === 'string' || o.t === 'file') ? { ...o, exec: true } : o); },
    xcheck: () => { const o = pop(); push(!!(o && ((o.t === 'name' && !o.lit) || o.exec || o.t === 'op'))); },
    executeonly: () => {}, noaccess: () => {}, readonly: () => {}, rcheck: () => { pop(); push(true); }, wcheck: () => { pop(); push(true); },
    cvn: () => { const s = pop(); push(name(latin1(s.b), !s.exec)); },
    cvs: () => { const s = popType('string'), o = pop(); const t = bytesOf(textOf(o)); s.b.set(t.subarray(0, s.b.length)); push(str(s.b.subarray(0, Math.min(t.length, s.b.length)))); },
    cvrs: () => { const s = popType('string'), radix = popInt(), v = popNum(); const t = bytesOf((radix === 10 ? String(v) : (Math.trunc(v) >>> 0).toString(radix)).toUpperCase()); s.b.set(t.subarray(0, s.b.length)); push(str(s.b.subarray(0, t.length))); },
    // strings and arrays
    string: () => push(str(new Uint8Array(popInt()))),
    length: () => { const o = pop(); push(o.t === 'string' ? o.b.length : o.t === 'array' ? o.v.length : o.t === 'dict' ? o.m.size : o.t === 'name' ? o.n.length : 0); },
    get: () => {
      const k = pop(), o = pop();
      if (o.t === 'array') { const v = o.v[k]; if (v === undefined) throw new PSError('rangecheck', 'get'); push(v); }
      else if (o.t === 'string') { const v = o.b[k]; if (v === undefined) throw new PSError('rangecheck', 'get'); push(v); }
      else if (o.t === 'dict') { const v = dget(o, k); if (v === undefined) throw new PSError('undefined', k && k.n); push(v); }
      else throw new PSError('typecheck', 'get');
    },
    put: () => { const v = pop(), k = pop(), o = pop(); if (o.t === 'array') o.v[k] = v; else if (o.t === 'string') o.b[k] = v; else if (o.t === 'dict') dput(o, k, v); },
    getinterval: () => { const n = popInt(), i = popInt(), o = pop(); if (o.t === 'string') push(str(o.b.subarray(i, i + n), o.exec)); else push(arr(o.v.slice(i, i + n), o.exec)); },
    putinterval: () => { const src = pop(), i = popInt(), o = pop(); if (o.t === 'string') o.b.set(src.b.subarray(0, o.b.length - i), i); else o.v.splice(i, src.v.length, ...src.v); },
    array: () => push(arr(new Array(popInt()).fill(NULL))), packedarray: () => { const n = popInt(), v = ostack.splice(ostack.length - n, n); push(arr(v)); },
    currentpacking: () => push(false), setpacking: () => { pop(); },
    aload: () => { const a = pop(); for (const v of a.v) push(v); push(a); },
    astore: () => { const a = pop(); const v = ostack.splice(ostack.length - a.v.length, a.v.length); a.v.splice(0, v.length, ...v); push(a); },
    '[': () => push(MARK), ']': () => { const i = ostack.lastIndexOf(MARK); if (i < 0) throw new PSError('unmatchedmark'); const v = ostack.splice(i + 1); ostack.pop(); push(arr(v)); },
    '<<': () => push(MARK), '>>': () => { const i = ostack.lastIndexOf(MARK); if (i < 0) throw new PSError('unmatchedmark'); const v = ostack.splice(i + 1); ostack.pop(); const d = newDict(); for (let k = 0; k + 1 < v.length; k += 2) dput(d, v[k], v[k + 1]); push(d); },
    search: () => { const seek = pop(), s = pop(); const i = indexOfSeq(s.b, Array.from(seek.b), 0); if (i < 0) { push(s); push(false); return; } push(str(s.b.subarray(i + seek.b.length))); push(str(s.b.subarray(i, i + seek.b.length))); push(str(s.b.subarray(0, i))); push(true); },
    anchorsearch: () => { const seek = pop(), s = pop(); if (indexOfSeq(s.b, Array.from(seek.b), 0) === 0) { push(str(s.b.subarray(seek.b.length))); push(str(s.b.subarray(0, seek.b.length))); push(true); } else { push(s); push(false); } },
    token: () => {
      const o = pop();
      const f = o.t === 'file' ? ready(o) : fileOf(o.b);
      const t = scan(f, vm);
      if (t === undefined) { push(false); return; }
      if (o.t !== 'file') push(str(o.b.subarray(f.pos)));
      push(t); push(true);
    },
    // dictionaries
    dict: () => { pop(); push(newDict()); }, maxlength: () => { pop(); push(1000); },
    begin: () => dstack.push(popType('dict')), end: () => { if (dstack.length > 3) dstack.pop(); },
    def: () => { const v = pop(), k = pop(); dput(dstack[dstack.length - 1], k, v); },
    load: () => { const k = pop(); const v = lookup(k.t === 'name' ? k.n : latin1(k.b)); if (v === undefined) throw new PSError('undefined', k.n); push(v); },
    store: () => { const v = pop(), k = pop(); for (let i = dstack.length - 1; i >= 0; i--) if (dget(dstack[i], k) !== undefined) { dput(dstack[i], k, v); return; } dput(dstack[dstack.length - 1], k, v); },
    known: () => { const k = pop(), d = popType('dict'); push(dget(d, k) !== undefined); },
    where: () => { const k = pop(); for (let i = dstack.length - 1; i >= 0; i--) if (dget(dstack[i], k) !== undefined) { push(dstack[i]); push(true); return; } push(false); },
    undef: () => { const k = pop(), d = popType('dict'); d.m.delete(keyOf(k)); },
    currentdict: () => push(dstack[dstack.length - 1]), countdictstack: () => push(dstack.length), cleardictstack: () => { dstack.length = 3; },
    dictstack: () => { const a = pop(); a.v.splice(0, dstack.length, ...dstack); push(arr(a.v.slice(0, dstack.length))); },
    userdict: () => push(userdict), systemdict: () => push(systemdict), globaldict: () => push(globaldict), statusdict: () => push(statusdict), errordict: () => push(errordict),
    $error: () => push(errordict), FontDirectory: () => push(fontDirectory), GlobalFontDirectory: () => push(fontDirectory), SharedFontDirectory: () => push(fontDirectory),
    bind: () => { const p = pop(); bindProc(p, 0); push(p); },
    null: () => push(NULL), version: () => push(strOf('3010')), languagelevel: () => push(3), product: () => push(strOf('FluoForge')), revision: () => push(1),
    serialnumber: () => push(0), realtime: () => push(0), usertime: () => push(0), vmstatus: () => { push(0); push(0); push(1e8); }, setglobal: () => { pop(); }, currentglobal: () => push(false),
    gcheck: () => { pop(); push(false); }, '=': () => { pop(); }, '==': () => { pop(); }, print: () => { pop(); }, pstack: () => {}, stack: () => {}, flush: () => {},
    StandardEncoding: () => push(arr(STANDARD.map(n => name(n || '.notdef', true)))), ISOLatin1Encoding: () => push(arr(ISO_LATIN1.map(n => name(n || '.notdef', true)))),
    findencoding: () => { const k = pop().n; push(arr((k === 'ISOLatin1Encoding' ? ISO_LATIN1 : STANDARD).map(n => name(n || '.notdef', true)))); },
    save: () => { const s = { t: 'save', depth: gstack.length }; gsave(); push(s); }, restore: () => { const s = pop(); while (gstack.length > (s.depth ?? 0)) grestore(); },
    // resources
    findresource: () => {
      const cat = pop(), key = pop(), c = cat.n;
      if (c === 'Font') { push(findFont(key)); return; }
      if (c === 'Encoding') { push(arr((key.n === 'ISOLatin1Encoding' ? ISO_LATIN1 : STANDARD).map(n => name(n || '.notdef', true)))); return; }
      if (c === 'ProcSet' && key.n === 'CIDInit') { push(cidInit); return; }
      const d = resources.get(c), v = d && dget(d, key);
      if (v === undefined) throw new PSError('undefinedresource', key.n);
      push(v);
    },
    defineresource: () => {
      const cat = pop(), inst = pop(), key = pop();
      if (cat.n === 'Font') { push(defineFont(key, inst)); return; }
      if (!resources.has(cat.n)) resources.set(cat.n, newDict());
      dput(resources.get(cat.n), key, inst); push(inst);
    },
    resourcestatus: () => { const cat = pop(), key = pop(); const d = resources.get(cat.n); if (d && dget(d, key) !== undefined) { push(0); push(0); push(true); } else push(false); },
    undefineresource: () => { pop(); pop(); },
    resourceforall: () => { pop(); pop(); pop(); pop(); },
    // files
    currentfile: () => push(currentFile()),
    readhexstring: () => {
      const s = popType('string'), f = popType('file');
      let n = 0, hi = -1;
      while (n < s.b.length && f.pos < f.b.length) {
        const c = f.b[f.pos++], v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
        if (v < 0) continue;
        if (hi < 0) hi = v; else { s.b[n++] = hi * 16 + v; hi = -1; }
      }
      push(str(s.b.subarray(0, n))); push(n === s.b.length);
    },
    readstring: () => { const s = popType('string'), f = popType('file'); const take = f.b.subarray(f.pos, f.pos + s.b.length); s.b.set(take); f.pos += take.length; push(str(s.b.subarray(0, take.length))); push(take.length === s.b.length); },
    readline: () => {
      const s = popType('string'), f = popType('file'); let n = 0, found = false;
      while (f.pos < f.b.length) { const c = f.b[f.pos++]; if (c === 10 || c === 13) { if (c === 13 && f.b[f.pos] === 10) f.pos++; found = true; break; } if (n < s.b.length) s.b[n++] = c; }
      push(str(s.b.subarray(0, n))); push(found || n > 0);
    },
    read: () => { const f = popType('file'); if (f.pos < f.b.length) { push(f.b[f.pos++]); push(true); } else push(false); },
    bytesavailable: () => { const f = popType('file'); push(f.b.length - f.pos); },
    closefile: () => { const f = popType('file'); f.closed = true; f.pos = f.b.length; },
    flushfile: () => { pop(); },
    status: () => { const o = pop(); if (o && o.t === 'file') push(!o.closed); else push(false); }, // a file: open? a file name: not found file: () => { pop(); pop(); push(fileOf(new Uint8Array(0))); }, deletefile: () => { pop(); },
    fileposition: () => { const f = popType('file'); push(f.pos); }, setfileposition: () => { const p = popInt(), f = popType('file'); f.pos = p; },
    filter: () => {
      const fname = pop().n;
      let params = null;
      if (fname === 'SubFileDecode') { const eod = pop(), count = pop(); params = eod.t === 'string' && eod.b.length ? eod : count; }
      else if (ostack.length && ostack[ostack.length - 1]?.t === 'dict' && ostack.length > 1) params = pop();
      const src = pop();
      push(makeFilter(src, fname, params));
    },
    eexec: () => {
      const src = pop(), f = src.t === 'file' ? src : fileOf(src.b);
      const b = f.b; let start = f.pos;
      while (start < b.length && WS.has(b[start])) start++;
      const isHex = Array.from(b.subarray(start, start + 4)).every(c => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102));
      // The encrypted part ends where the 512 zeros that follow it start.
      let end = indexOfSeq(b, Array(64).fill(0x30), start);
      if (end < 0) end = b.length;
      const cipher = isHex ? decodeHex(latin1(b.subarray(start, end))) : b.subarray(start, end);
      const inner = fileOf(decrypt(cipher, 55665, 4));
      dstack.push(systemdict);
      try { runFile(inner); } finally { if (dstack[dstack.length - 1] === systemdict && dstack.length > 3) dstack.pop(); }
      f.pos = end;
    },
    // graphics state
    gsave: () => gsave(), grestore: () => grestore(), grestoreall: () => { while (gstack.length) grestore(); },
    initgraphics: () => { const keep = gs.open; gs = { ...freshGS(), open: keep, font: gs.font }; },
    gstate: () => push({ t: 'gstate', g: { ...gs, path: gs.path.slice(), open: 0 } }), currentgstate: () => { const g = pop(); g.g = { ...gs, path: gs.path.slice(), open: 0 }; push(g); },
    setgstate: () => { const g = pop(); const open = gs.open; gs = { ...g.g, path: g.g.path.slice(), open }; },
    setlinewidth: () => { gs.lineWidth = popNum(); }, currentlinewidth: () => push(gs.lineWidth), setlinecap: () => { gs.cap = popInt(); }, currentlinecap: () => push(gs.cap),
    setlinejoin: () => { gs.join = popInt(); }, currentlinejoin: () => push(gs.join), setmiterlimit: () => { gs.miter = popNum(); }, currentmiterlimit: () => push(gs.miter),
    setdash: () => { gs.dashOffset = popNum(); gs.dash = popType('array').v.map(Number); }, currentdash: () => { push(arr(gs.dash.slice())); push(gs.dashOffset); },
    setflat: () => { pop(); }, currentflat: () => push(1), setstrokeadjust: () => { pop(); }, currentstrokeadjust: () => push(false), setoverprint: () => { pop(); }, currentoverprint: () => push(false),
    setsmoothness: () => { pop(); }, sethalftone: () => { pop(); }, setscreen: () => { pop(); pop(); pop(); }, setcolorscreen: () => { for (let i = 0; i < 12; i++) pop(); },
    settransfer: () => { pop(); }, setcolortransfer: () => { pop(); pop(); pop(); pop(); }, setblackgeneration: () => { pop(); }, setundercolorremoval: () => { pop(); },
    setcolorrendering: () => { pop(); }, setrenderingintent: () => { pop(); }, setpagedevice: () => { pop(); }, setuserparams: () => { pop(); }, setsystemparams: () => { pop(); },
    setdevparams: () => { pop(); pop(); }, setvmthreshold: () => { pop(); }, vmreclaim: () => { pop(); }, setcachelimit: () => { pop(); }, setcacheparams: () => { ostack.length = Math.max(0, ostack.lastIndexOf(MARK)); },
    currentpagedevice: () => push(newDict()), currenthalftone: () => push(newDict()), currenttransfer: () => push(arr([], true)), currentscreen: () => { push(60); push(45); push(arr([], true)); },
    setgray: () => { gs.space = { kind: 'gray', n: 1 }; gs.comps = [popNum()]; gs.pattern = null; }, currentgray: () => { const [r, g, b] = currentRGB(); push(0.3 * r + 0.59 * g + 0.11 * b); },
    setrgbcolor: () => { const b = popNum(), g = popNum(), r = popNum(); gs.space = { kind: 'rgb', n: 3 }; gs.comps = [r, g, b]; gs.pattern = null; },
    currentrgbcolor: () => { for (const v of currentRGB()) push(v); },
    sethsbcolor: () => { const v = popNum(), s = popNum(), h = popNum(); const f = (n, k = (n + h * 6) % 6) => v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); gs.space = { kind: 'rgb', n: 3 }; gs.comps = [f(5), f(3), f(1)]; gs.pattern = null; },
    currenthsbcolor: () => { push(0); push(0); push(currentRGB()[0]); },
    setcmykcolor: () => { const k = popNum(), y = popNum(), m = popNum(), c = popNum(); gs.space = { kind: 'cmyk', n: 4 }; gs.comps = [c, m, y, k]; gs.pattern = null; },
    currentcmykcolor: () => { const [r, g, b] = currentRGB(); push(1 - r); push(1 - g); push(1 - b); push(0); },
    setcolorspace: () => { gs.space = spaceOf(pop()); gs.comps = defaultComps(gs.space); gs.pattern = null; }, currentcolorspace: () => push(arr([name(gs.space.kind === 'cmyk' ? 'DeviceCMYK' : gs.space.kind === 'rgb' ? 'DeviceRGB' : 'DeviceGray', true)])),
    setcolor: () => {
      if (gs.space.kind === 'pattern') { const pat = pop(); const rgb = patternColour(pat); gs.pattern = pat.pattern ? { ...pat.pattern, rgb } : null; return; }
      const c = []; for (let k = 0; k < gs.space.n; k++) c.unshift(popNum()); gs.comps = c; gs.pattern = null;
    },
    currentcolor: () => { for (const v of gs.comps) push(v); },
    setpattern: () => {
      const pat = pop(), under = gs.space.kind === 'pattern' ? gs.space.under : gs.space, rgb = patternColour(pat);
      gs.space = { kind: 'pattern', n: 1, under }; gs.pattern = pat.pattern ? { ...pat.pattern, rgb } : null;
    },
    makepattern: () => {
      const m = popMatrix(), d = popType('dict'), type = dget(d, name('PatternType')), copy = newDict();
      for (const [k, v] of d.m) copy.m.set(k, v);
      copy.pattern = type === 2 ? { type: 2, shading: dget(d, name('Shading')), matrix: P.multiply(gs.ctm, m) } : { type: 1, dict: copy, matrix: P.multiply(gs.ctm, m) };
      push(copy);
    },
    // matrices
    matrix: () => push(arr([1, 0, 0, 1, 0, 0])), identmatrix: () => { const a = pop(); a.v.splice(0, 6, 1, 0, 0, 1, 0, 0); push(a); },
    currentmatrix: () => { const a = pop(); a.v.splice(0, 6, ...gs.ctm); push(a); }, setmatrix: () => { gs.ctm = popMatrix(); },
    defaultmatrix: () => { const a = pop(); a.v.splice(0, 6, ...BASE); push(a); }, initmatrix: () => { gs.ctm = [...BASE]; },
    translate: () => matrixOp((tx, ty) => [1, 0, 0, 1, tx, ty], 2), scale: () => matrixOp((sx, sy) => [sx, 0, 0, sy, 0, 0], 2),
    rotate: () => matrixOp(a => { const r = a * Math.PI / 180; return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]; }, 1),
    concat: () => { gs.ctm = P.multiply(gs.ctm, popMatrix()); },
    concatmatrix: () => { const m3 = pop(), m2 = popMatrix(), m1 = popMatrix(); m3.v.splice(0, 6, ...P.multiply(m2, m1)); push(m3); },
    invertmatrix: () => { const m2 = pop(), m1 = popMatrix(); m2.v.splice(0, 6, ...(P.invert(m1) || P.IDENTITY)); push(m2); },
    transform: () => pointOp((m, x, y) => P.apply(m, x, y), false), itransform: () => pointOp((m, x, y) => P.apply(P.invert(m) || P.IDENTITY, x, y), false),
    dtransform: () => pointOp((m, x, y) => P.apply([m[0], m[1], m[2], m[3], 0, 0], x, y), false), idtransform: () => pointOp((m, x, y) => { const i = P.invert(m) || P.IDENTITY; return P.apply([i[0], i[1], i[2], i[3], 0, 0], x, y); }, false),
    // paths
    newpath: () => { gs.path = []; gs.cp = null; },
    moveto: () => { const y = popNum(), x = popNum(); moveTo(x, y); },
    rmoveto: () => { const dy = popNum(), dx = popNum(); const [x, y] = userPoint(); moveTo(x + dx, y + dy); },
    lineto: () => { const y = popNum(), x = popNum(); lineTo(x, y); },
    rlineto: () => { const dy = popNum(), dx = popNum(); const [x, y] = userPoint(); lineTo(x + dx, y + dy); },
    curveto: () => { const f = popNum(), e = popNum(), d = popNum(), c = popNum(), b = popNum(), a = popNum(); curveTo(a, b, c, d, e, f); },
    rcurveto: () => { const f = popNum(), e = popNum(), d = popNum(), c = popNum(), b = popNum(), a = popNum(); const [x, y] = userPoint(); curveTo(x + a, y + b, x + c, y + d, x + e, y + f); },
    closepath: () => { if (gs.path.length && gs.path[gs.path.length - 1].op !== 'Z') { gs.path.push({ op: 'Z', p: [] }); gs.cp = gs.start; } },
    arc: () => { const a2 = popNum(), a1 = popNum(), r = popNum(), y = popNum(), x = popNum(); arcTo(x, y, r, a1, a2, false); },
    arcn: () => { const a2 = popNum(), a1 = popNum(), r = popNum(), y = popNum(), x = popNum(); arcTo(x, y, r, a1, a2, true); },
    arct: () => tangentArc(false), arcto: () => tangentArc(true),
    currentpoint: () => { const [x, y] = userPoint(); push(x); push(y); },
    flattenpath: () => {}, reversepath: () => { issues.add(ISSUES.strokePath); }, strokepath: () => { issues.add(ISSUES.strokePath); },
    clippath: () => { gs.path = pageRect(); gs.cp = gs.path[0].p[0]; },
    pathbbox: () => {
      const inv = P.invert(gs.ctm) || P.IDENTITY, pts = gs.path.flatMap(s => s.p).map(p => P.apply(inv, ...p));
      if (!pts.length) throw new PSError('nocurrentpoint');
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      push(Math.min(...xs)); push(Math.min(...ys)); push(Math.max(...xs)); push(Math.max(...ys));
    },
    pathforall: () => {
      const close = popProc(), curve = popProc(), line = popProc(), move = popProc(), inv = P.invert(gs.ctm) || P.IDENTITY;
      try {
        for (const s of gs.path.slice()) {
          const q = s.p.map(p => P.apply(inv, ...p));
          for (const p of q) { push(p[0]); push(p[1]); }
          execute(s.op === 'M' ? move : s.op === 'L' ? line : s.op === 'Z' ? close : curve);
        }
      } catch (e) { if (e !== EXIT) throw e; }
    },
    initclip: () => { if (gstack.some(g => g.clipped)) issues.add(ISSUES.initclip); out.push('</g>'.repeat(gs.open)); gs.open = 0; gs.clipped = 0; },
    clip: () => clipWith(false), eoclip: () => clipWith(true),
    rectclip: () => { rects(); clipWith(false); gs.path = []; gs.cp = null; },
    rectfill: () => { const keep = gs.path; rects(); fillPath(false); gs.path = keep; },
    rectstroke: () => { const keep = gs.path, m = ostack.length && ostack[ostack.length - 1]?.t === 'array' && ostack.length >= 2 && ostack[ostack.length - 2]?.t === 'array' ? popMatrix() : null; rects(); if (m) gs.path = gs.path; strokePath(); gs.path = keep; },
    // painting
    fill: () => { fillPath(false); gs.path = []; gs.cp = null; }, eofill: () => { fillPath(true); gs.path = []; gs.cp = null; },
    stroke: () => { strokePath(); gs.path = []; gs.cp = null; },
    shfill: () => {
      const sh = popType('dict'), url = shadingGradient(sh, gs.ctm);
      if (url) { out.push(`<path d="${pathD(pageRect())}" fill="${url}"/>`); drawn++; }
    },
    image: () => drawImage(imageOperands('gray')), colorimage: () => drawImage(imageOperands('color')),
    imagemask: () => drawImage(imageOperands('mask')),
    showpage: () => {}, copypage: () => {}, erasepage: () => { if (drawn) issues.add(ISSUES.erase); }, nulldevice: () => {},
    ufill: () => { pop(); issues.add(ISSUES.userPath); }, ueofill: () => { pop(); issues.add(ISSUES.userPath); }, ustroke: () => { pop(); issues.add(ISSUES.userPath); }, uappend: () => { pop(); issues.add(ISSUES.userPath); },
    setbbox: () => { pop(); pop(); pop(); pop(); }, ucache: () => {},
    execform: () => { const d = popType('dict'), m = dget(d, name('Matrix')); gsave(); if (m) gs.ctm = P.multiply(gs.ctm, m.v.map(Number)); push(d); execute(dget(d, name('PaintProc'))); grestore(); },
    // fonts and text
    findfont: () => push(findFont(pop())), definefont: () => { const f = popType('dict'), k = pop(); push(defineFont(k, f)); }, undefinefont: () => { pop(); },
    scalefont: () => { const s = popNum(), f = popType('dict'); push(transformFont(f, [s, 0, 0, s, 0, 0])); },
    makefont: () => { const m = popMatrix(), f = popType('dict'); push(transformFont(f, m)); },
    setfont: () => { gs.font = popType('dict'); }, currentfont: () => push(gs.font || findFont(name('Helvetica'))), rootfont: () => push(gs.font || findFont(name('Helvetica'))),
    selectfont: () => { const s = pop(), k = pop(); const f = k.t === 'dict' ? k : findFont(k); gs.font = transformFont(f, typeof s === 'number' ? [s, 0, 0, s, 0, 0] : s.v.map(Number)); },
    composefont: () => { const fonts2 = pop(); pop(); const k = pop(); issues.add(ISSUES.composite); const first = fonts2.v[0]; push(defineFont(k, first && first.t === 'dict' ? first : findFont(name('Helvetica')))); },
    show: () => { show(codesOf(popType('string'))); },
    ashow: () => { const s = popType('string'), ay = popNum(), ax = popNum(); show(codesOf(s), { extra: () => [ax, ay] }); },
    widthshow: () => { const s = popType('string'), ch = popInt(), cy = popNum(), cx = popNum(); show(codesOf(s), { extra: (i, c) => (c === ch ? [cx, cy] : [0, 0]) }); },
    awidthshow: () => { const s = popType('string'), ay = popNum(), ax = popNum(), ch = popInt(), cy = popNum(), cx = popNum(); show(codesOf(s), { extra: (i, c) => (c === ch ? [cx + ax, cy + ay] : [ax, ay]) }); },
    xshow: () => explicitShow('x'), yshow: () => explicitShow('y'), xyshow: () => explicitShow('xy'),
    kshow: () => { const s = popType('string'), p = popProc(); const codes = codesOf(s); for (let i = 0; i < codes.length; i++) { show([codes[i]]); if (i + 1 < codes.length) { push(codes[i]); push(codes[i + 1]); execute(p); } } },
    cshow: () => { pop(); pop(); issues.add(ISSUES.cshow); },
    glyphshow: () => { const n = pop(); show([n.t === 'name' ? n.n : latin1(n.b)]); },
    stringwidth: () => { const s = popType('string'); const keep = gs.cp; if (!gs.cp) gs.cp = dev(0, 0); const [wx, wy] = show(codesOf(s), { draw: false }); gs.cp = keep; push(wx); push(wy); },
    charpath: () => { popBool(); const s = popType('string'); show(codesOf(s), { path: true }); },
    setcachedevice: () => { for (let i = 0; i < 4; i++) pop(); const wy = popNum(), wx = popNum(); if (charWidth) charWidth([wx, wy]); },
    setcachedevice2: () => { for (let i = 0; i < 8; i++) pop(); const wy = popNum(), wx = popNum(); if (charWidth) charWidth([wx, wy]); },
    setcharwidth: () => { const wy = popNum(), wx = popNum(); if (charWidth) charWidth([wx, wy]); }
  };
  function textOf(o) {
    if (typeof o === 'number') return Number.isInteger(o) ? String(o) : String(Number(o.toPrecision(6)));
    if (typeof o === 'boolean') return String(o);
    if (o.t === 'string') return latin1(o.b);
    if (o.t === 'name') return o.n;
    if (o.t === 'op') return o.n;
    return '--nostringval--';
  }
  function equal(a, b) {
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return a === b;
    const sa = a.t === 'string' || a.t === 'name' ? textOf(a) : null, sb = b.t === 'string' || b.t === 'name' ? textOf(b) : null;
    if (sa !== null && sb !== null) return sa === sb;
    return a === b || (a.t === 'null' && b.t === 'null') || (a.t === 'mark' && b.t === 'mark');
  }
  const cmp = (a, b) => (typeof a === 'number' ? a - b : textOf(a) < textOf(b) ? -1 : textOf(a) > textOf(b) ? 1 : 0);
  function bindProc(p, depth) {
    if (depth > 64) return;
    for (let i = 0; i < p.v.length; i++) {
      const el = p.v[i];
      if (el && el.t === 'name' && !el.lit) { const v = lookup(el.n); if (v && v.t === 'op') p.v[i] = v; }
      else if (isProc(el)) bindProc(el, depth + 1);
    }
  }
  function matrixOp(make, n) {
    const top = ostack[ostack.length - 1];
    if (top && top.t === 'array' && !top.exec) { const a = pop(); const args = []; for (let k = 0; k < n; k++) args.unshift(popNum()); a.v.splice(0, 6, ...make(...args)); push(a); return; }
    const args = []; for (let k = 0; k < n; k++) args.unshift(popNum());
    gs.ctm = P.multiply(gs.ctm, make(...args));
  }
  function pointOp(fn) {
    let m = gs.ctm;
    if (ostack[ostack.length - 1]?.t === 'array') m = popMatrix();
    const y = popNum(), x = popNum(), [u, v] = fn(m, x, y);
    push(u); push(v);
  }
  function rects() {
    gs.path = []; gs.cp = null;
    const top = pop();
    const list = typeof top === 'number' ? (() => { const h = top, w = popNum(), y = popNum(), x = popNum(); return [[x, y, w, h]]; })() : top.t === 'array' ? chunk4(top.v.map(Number)) : [];
    for (const [x, y, w, h] of list) { moveTo(x, y); lineTo(x + w, y); lineTo(x + w, y + h); lineTo(x, y + h); gs.path.push({ op: 'Z', p: [] }); }
  }
  const chunk4 = v => Array.from({ length: Math.floor(v.length / 4) }, (_, i) => v.slice(i * 4, i * 4 + 4));
  function tangentArc(push4) {
    const r = popNum(), y2 = popNum(), x2 = popNum(), y1 = popNum(), x1 = popNum();
    const [x0, y0] = userPoint();
    const ax = x0 - x1, ay = y0 - y1, bx = x2 - x1, by = y2 - y1, la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const angle = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb || 1))));
    if (!la || !lb || !Number.isFinite(angle) || Math.abs(Math.sin(angle)) < 1e-9) { lineTo(x1, y1); if (push4) { push(x1); push(y1); push(x1); push(y1); } return; }
    const d = r / Math.tan(angle / 2), t1 = [x1 + ax / la * d, y1 + ay / la * d], t2 = [x1 + bx / lb * d, y1 + by / lb * d];
    const k = 4 / 3 * Math.tan((Math.PI - angle) / 4) * r;
    lineTo(...t1);
    curveTo(t1[0] - ax / la * k, t1[1] - ay / la * k, t2[0] - bx / lb * k, t2[1] - by / lb * k, ...t2);
    if (push4) { push(t1[0]); push(t1[1]); push(t2[0]); push(t2[1]); }
  }
  function transformFont(f, m) {
    const d = newDict();
    for (const [k, v] of f.m) d.m.set(k, v);
    dput(d, name('FontMatrix'), arr(P.multiply(m, fontMatrix(f))));
    return d;
  }
  function explicitShow(kind) {
    const nums = pop(), s = popType('string');
    let values;
    if (nums.t === 'array') values = nums.v.map(Number);
    else { issues.add(ISSUES.encodedNumbers); show(codesOf(s)); return; }
    show(codesOf(s), { explicit: i => (kind === 'x' ? [values[i] ?? 0, 0] : kind === 'y' ? [0, values[i] ?? 0] : [values[i * 2] ?? 0, values[i * 2 + 1] ?? 0]) });
  }

  // The CIDInit procedure set: what defines CMaps (Prism writes one); they draw nothing.
  const cidInit = newDict();
  for (const op of ['begincmap', 'endcmap', 'usecmap', 'usefont']) dput(cidInit, name(op), { t: 'op', n: op, fn: op === 'usecmap' || op === 'usefont' ? () => { pop(); } : () => {} });
  for (const what of ['codespacerange', 'bfchar', 'bfrange', 'cidchar', 'cidrange', 'notdefchar', 'notdefrange', 'rearrangedfont']) {
    dput(cidInit, name('begin' + what), { t: 'op', n: 'begin' + what, fn: () => { pop(); push(MARK); } });
    dput(cidInit, name('end' + what), { t: 'op', n: 'end' + what, fn: () => { while (ostack.length && pop() !== MARK); } });
  }
  dput(cidInit, name('StartData'), { t: 'op', n: 'StartData', fn: () => { pop(); pop(); } });
  dput(statusdict, name('product'), strOf('FluoForge'));

  for (const [k, fn] of Object.entries(ops2)) def(k, fn);
  // Names a program may define or test, which systemdict has.
  dput(systemdict, name('FontDirectory'), fontDirectory);

  // ---- run ----
  let failed = null;
  try { runFile(fileOf(bytes)); }
  catch (e) {
    if (e === QUIT || e === STOP) { /* the program ended */ }
    else if (e instanceof PSError) failed = e;
    else if (e === EXIT) { /* exit outside a loop */ }
    else throw e;
  }
  while (gstack.length) grestore();
  out.push('</g>'.repeat(gs.open));
  const notRun = failed ? `PostScript it could not run (${failed.kind}${failed.what ? ': ' + failed.what : ''})` : null;
  if (!drawn) throw new Error(`${fileName} draws nothing FluoForge can read${notRun ? `: ${notRun}` : ''}.`);
  if (notRun) issues.add(notRun);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${P.num(W * 25.4 / 72, 4)}mm" height="${P.num(H * 25.4 / 72, 4)}mm" viewBox="0 0 ${P.num(W)} ${P.num(H)}">` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') + out.join('') + '</svg>';
  return { svg, issues: [...issues], widthMM: W * 25.4 / 72, heightMM: H * 25.4 / 72, drawn };
}

/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Tables for the EPS reader (P3-T10c): PostScript's StandardEncoding and ISOLatin1Encoding (glyph names
   by character code) and the Unicode character of each glyph name they and common fonts use (a subset
   of the Adobe Glyph List; names "uniXXXX" and "uXXXX" are read directly). */

const ASCII = ['space', 'exclam', 'quotedbl', 'numbersign', 'dollar', 'percent', 'ampersand', 'quoteright', 'parenleft', 'parenright', 'asterisk', 'plus', 'comma', 'hyphen', 'period', 'slash',
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'colon', 'semicolon', 'less', 'equal', 'greater', 'question', 'at',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'bracketleft', 'backslash', 'bracketright', 'asciicircum', 'underscore', 'quoteleft',
  ...'abcdefghijklmnopqrstuvwxyz', 'braceleft', 'bar', 'braceright', 'asciitilde'];

/** StandardEncoding: glyph name by code (null: none). */
export const STANDARD = (() => {
  const e = new Array(256).fill(null);
  ASCII.forEach((n, i) => { e[32 + i] = n; });
  const high = { 161: 'exclamdown', 162: 'cent', 163: 'sterling', 164: 'fraction', 165: 'yen', 166: 'florin', 167: 'section', 168: 'currency', 169: 'quotesingle', 170: 'quotedblleft',
    171: 'guillemotleft', 172: 'guilsinglleft', 173: 'guilsinglright', 174: 'fi', 175: 'fl', 177: 'endash', 178: 'dagger', 179: 'daggerdbl', 180: 'periodcentered', 182: 'paragraph',
    183: 'bullet', 184: 'quotesinglbase', 185: 'quotedblbase', 186: 'quotedblright', 187: 'guillemotright', 188: 'ellipsis', 189: 'perthousand', 191: 'questiondown', 193: 'grave',
    194: 'acute', 195: 'circumflex', 196: 'tilde', 197: 'macron', 198: 'breve', 199: 'dotaccent', 200: 'dieresis', 202: 'ring', 203: 'cedilla', 205: 'hungarumlaut', 206: 'ogonek',
    207: 'caron', 208: 'emdash', 225: 'AE', 227: 'ordfeminine', 232: 'Lslash', 233: 'Oslash', 234: 'OE', 235: 'ordmasculine', 241: 'ae', 245: 'dotlessi', 248: 'lslash', 249: 'oslash',
    250: 'oe', 251: 'germandbls' };
  for (const [k, n] of Object.entries(high)) e[k] = n;
  return e;
})();

const LATIN1 = ['space', 'exclamdown', 'cent', 'sterling', 'currency', 'yen', 'brokenbar', 'section', 'dieresis', 'copyright', 'ordfeminine', 'guillemotleft', 'logicalnot', 'hyphen',
  'registered', 'macron', 'degree', 'plusminus', 'twosuperior', 'threesuperior', 'acute', 'mu', 'paragraph', 'periodcentered', 'cedilla', 'onesuperior', 'ordmasculine', 'guillemotright',
  'onequarter', 'onehalf', 'threequarters', 'questiondown', 'Agrave', 'Aacute', 'Acircumflex', 'Atilde', 'Adieresis', 'Aring', 'AE', 'Ccedilla', 'Egrave', 'Eacute', 'Ecircumflex',
  'Edieresis', 'Igrave', 'Iacute', 'Icircumflex', 'Idieresis', 'Eth', 'Ntilde', 'Ograve', 'Oacute', 'Ocircumflex', 'Otilde', 'Odieresis', 'multiply', 'Oslash', 'Ugrave', 'Uacute',
  'Ucircumflex', 'Udieresis', 'Yacute', 'Thorn', 'germandbls', 'agrave', 'aacute', 'acircumflex', 'atilde', 'adieresis', 'aring', 'ae', 'ccedilla', 'egrave', 'eacute', 'ecircumflex',
  'edieresis', 'igrave', 'iacute', 'icircumflex', 'idieresis', 'eth', 'ntilde', 'ograve', 'oacute', 'ocircumflex', 'otilde', 'odieresis', 'divide', 'oslash', 'ugrave', 'uacute',
  'ucircumflex', 'udieresis', 'yacute', 'thorn', 'ydieresis'];

/** ISOLatin1Encoding: glyph name by code. */
export const ISO_LATIN1 = (() => {
  const e = new Array(256).fill(null);
  ASCII.forEach((n, i) => { e[32 + i] = n; });
  e[45] = 'minus';
  const accents = { 144: 'dotlessi', 145: 'grave', 146: 'acute', 147: 'circumflex', 148: 'tilde', 149: 'macron', 150: 'breve', 151: 'dotaccent', 152: 'dieresis', 154: 'ring',
    155: 'cedilla', 157: 'hungarumlaut', 158: 'ogonek', 159: 'caron' };
  for (const [k, n] of Object.entries(accents)) e[k] = n;
  LATIN1.forEach((n, i) => { e[160 + i] = n; });
  return e;
})();

const NAMES = {
  space: 0x20, quoteright: 0x2019, quoteleft: 0x2018, quotesingle: 0x27, grave: 0x60, hyphen: 0x2d, minus: 0x2212, exclamdown: 0xa1, cent: 0xa2, sterling: 0xa3, fraction: 0x2044, yen: 0xa5,
  florin: 0x192, section: 0xa7, currency: 0xa4, quotedblleft: 0x201c, guillemotleft: 0xab, guilsinglleft: 0x2039, guilsinglright: 0x203a, fi: 0xfb01, fl: 0xfb02, endash: 0x2013,
  dagger: 0x2020, daggerdbl: 0x2021, periodcentered: 0xb7, paragraph: 0xb6, bullet: 0x2022, quotesinglbase: 0x201a, quotedblbase: 0x201e, quotedblright: 0x201d,
  guillemotright: 0xbb, ellipsis: 0x2026, perthousand: 0x2030, questiondown: 0xbf, acute: 0xb4, circumflex: 0x2c6, tilde: 0x2dc, macron: 0xaf, breve: 0x2d8, dotaccent: 0x2d9,
  dieresis: 0xa8, ring: 0x2da, cedilla: 0xb8, hungarumlaut: 0x2dd, ogonek: 0x2db, caron: 0x2c7, emdash: 0x2014, Lslash: 0x141, OE: 0x152, lslash: 0x142, oe: 0x153, dotlessi: 0x131,
  brokenbar: 0xa6, copyright: 0xa9, logicalnot: 0xac, registered: 0xae, degree: 0xb0, plusminus: 0xb1, twosuperior: 0xb2, threesuperior: 0xb3, mu: 0xb5, onesuperior: 0xb9,
  onequarter: 0xbc, onehalf: 0xbd, threequarters: 0xbe, multiply: 0xd7, divide: 0xf7, Eth: 0xd0, eth: 0xf0, Thorn: 0xde, thorn: 0xfe, germandbls: 0xdf, Euro: 0x20ac, trademark: 0x2122,
  // Greek (the Symbol font and others)
  Alpha: 0x391, Beta: 0x392, Gamma: 0x393, Delta: 0x394, Epsilon: 0x395, Zeta: 0x396, Eta: 0x397, Theta: 0x398, Iota: 0x399, Kappa: 0x39a, Lambda: 0x39b, Mu: 0x39c, Nu: 0x39d,
  Xi: 0x39e, Omicron: 0x39f, Pi: 0x3a0, Rho: 0x3a1, Sigma: 0x3a3, Tau: 0x3a4, Upsilon: 0x3a5, Phi: 0x3a6, Chi: 0x3a7, Psi: 0x3a8, Omega: 0x3a9,
  alpha: 0x3b1, beta: 0x3b2, gamma: 0x3b3, delta: 0x3b4, epsilon: 0x3b5, zeta: 0x3b6, eta: 0x3b7, theta: 0x3b8, iota: 0x3b9, kappa: 0x3ba, lambda: 0x3bb, nu: 0x3bd,
  xi: 0x3be, omicron: 0x3bf, pi: 0x3c0, rho: 0x3c1, sigma: 0x3c3, sigma1: 0x3c2, tau: 0x3c4, upsilon: 0x3c5, phi: 0x3c6, chi: 0x3c7, psi: 0x3c8, omega: 0x3c9, theta1: 0x3d1, phi1: 0x3d5,
  omega1: 0x3d6, Upsilon1: 0x3d2, mu1: 0xb5,
  // mathematics
  infinity: 0x221e, partialdiff: 0x2202, summation: 0x2211, product: 0x220f, radical: 0x221a, integral: 0x222b, approxequal: 0x2248, notequal: 0x2260, lessequal: 0x2264,
  greaterequal: 0x2265, equivalence: 0x2261, proportional: 0x221d, element: 0x2208, angle: 0x2220, gradient: 0x2207, arrowleft: 0x2190, arrowup: 0x2191, arrowright: 0x2192,
  arrowdown: 0x2193, arrowboth: 0x2194, dotmath: 0x22c5, minute: 0x2032, second: 0x2033, therefore: 0x2234, perpendicular: 0x22a5, universal: 0x2200, existential: 0x2203,
  asteriskmath: 0x2217, emptyset: 0x2205, intersection: 0x2229, union: 0x222a, similar: 0x223c, congruent: 0x2245, circleplus: 0x2295, circlemultiply: 0x2297, lozenge: 0x25ca
};

/** The Unicode text of glyph name `name` (or '' when unknown). */
export function glyphText(name) {
  if (!name) return '';
  const base = String(name).split('.')[0];
  if (/^[A-Za-z]$/.test(base)) return base;
  if (NAMES[base] != null) return String.fromCodePoint(NAMES[base]);
  const i = ASCII.indexOf(base);
  if (i >= 0) return String.fromCharCode(32 + i === 39 ? 0x2019 : 32 + i === 96 ? 0x2018 : 32 + i);
  const l = LATIN1.indexOf(base);
  if (l >= 0) return String.fromCharCode(160 + l);
  let m = /^uni([0-9A-Fa-f]{4})+$/.exec(base);
  if (m) return base.slice(3).match(/.{4}/g).map(h => String.fromCharCode(parseInt(h, 16))).join('');
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(base);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  return '';
}

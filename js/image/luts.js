/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The LUT library: every colour table a channel can use, as 256 x 3 Uint8Arrays (entry i is R, G, B
   at display index i, interleaved). Generated in code; no image assets.
   - The 8 single colours: a straight ramp from black to the colour (index x weight, rounded as
     canvas pixels are).
   - viridis, magma, inferno (CC0, Nathaniel Smith and Stefan van der Walt) and cividis (Nunez,
     Anderton and Renslow; matplotlib licence): matplotlib 3.9.2's tables, each value x 255 rounded.
     See THIRD-PARTY-NOTICES.md and assets/vendor/LICENSE-mpl-colormaps.txt, LICENSE-matplotlib.txt.
   - Fire: ImageJ's 32 control points, interpolated as ImageJ's LutLoader does (ImageJ is public domain).
   - Inverted grey: 255 - i.
   - "From file": a LUT read from an ImageJ TIFF that matches none of these, kept as it is. */

/** Weights of the 8 single colours (the presets FluoForge always had). */
export const PRESETS = {
  grey:    [1, 1, 1],
  red:     [1, 0, 0],
  green:   [0, 1, 0],
  blue:    [0, 0, 1],
  cyan:    [0, 1, 1],
  magenta: [1, 0, 1],
  yellow:  [1, 1, 0],
  orange:  [1, 0.5, 0]
};

// matplotlib 3.9.2 lib/matplotlib/_cm_listed.py, each value x 255 rounded, as hex R G B triples.
const MATPLOTLIB = {
  viridis:
    '44015444025645045745055946075a46085c460a5d460b5e470d60470e6147106347116447136548146748166848176948186a481a6c481b6d481c6e481d6f481f70482071482173482374482475482576482677482878482979472a7a472c7a' +
    '472d7b472e7c472f7d46307e46327e46337f463480453581453781453882443983443a83443b84433d84433e85423f854240864241864142874144874045884046883f47883f48893e49893e4a893e4c8a3d4d8a3d4e8a3c4f8a3c508b3b518b' +
    '3b528b3a538b3a548c39558c39568c38588c38598c375a8c375b8d365c8d365d8d355e8d355f8d34608d34618d33628d33638d32648e32658e31668e31678e31688e30698e306a8e2f6b8e2f6c8e2e6d8e2e6e8e2e6f8e2d708e2d718e2c718e' +
    '2c728e2c738e2b748e2b758e2a768e2a778e2a788e29798e297a8e297b8e287c8e287d8e277e8e277f8e27808e26818e26828e26828e25838e25848e25858e24868e24878e23888e23898e238a8d228b8d228c8d228d8d218e8d218f8d21908d' +
    '21918c20928c20928c20938c1f948c1f958b1f968b1f978b1f988b1f998a1f9a8a1e9b8a1e9c891e9d891f9e891f9f881fa0881fa1881fa1871fa28720a38620a48621a58521a68522a78522a88423a98324aa8325ab8225ac8226ad8127ad81' +
    '28ae8029af7f2ab07f2cb17e2db27d2eb37c2fb47c31b57b32b67a34b67935b77937b87838b9773aba763bbb753dbc743fbc7340bd7242be7144bf7046c06f48c16e4ac16d4cc26c4ec36b50c46a52c56954c56856c66758c7655ac8645cc863' +
    '5ec96260ca6063cb5f65cb5e67cc5c69cd5b6ccd5a6ece5870cf5773d05675d05477d1537ad1517cd2507fd34e81d34d84d44b86d54989d5488bd6468ed64590d74393d74195d84098d83e9bd93c9dd93ba0da39a2da37a5db36a8db34aadc32' +
    'addc30b0dd2fb2dd2db5de2bb8de29bade28bddf26c0df25c2df23c5e021c8e020cae11fcde11dd0e11cd2e21bd5e21ad8e219dae319dde318dfe318e2e418e5e419e7e419eae51aece51befe51cf1e51df4e61ef6e620f8e621fbe723fde725',
  magma:
    '00000401000501010601010802010902020b02020d03030f03031204041405041606051806051a07061c08071e0907200a08220b09240c09260d0a290e0b2b100b2d110c2f120d31130d34140e36150e38160f3b180f3d19103f1a10421c1044' +
    '1d11471e114920114b21114e22115024125325125527125829115a2a115c2c115f2d11612f116331116533106734106936106b38106c390f6e3b0f703d0f713f0f72400f74420f75440f764510774710784910784a10794c117a4e117b4f127b' +
    '51127c52137c54137d56147d57157e59157e5a167e5c167f5d177f5f187f601880621980641a80651a80671b80681c816a1c816b1d816d1d816e1e81701f81721f817320817521817621817822817922827b23827c23827e2482802582812581' +
    '8326818426818627818827818928818b29818c29818e2a81902a81912b81932b80942c80962c80982d80992d809b2e7f9c2e7f9e2f7fa02f7fa1307ea3307ea5317ea6317da8327daa337dab337cad347cae347bb0357bb2357bb3367ab5367a' +
    'b73779b83779ba3878bc3978bd3977bf3a77c03a76c23b75c43c75c53c74c73d73c83e73ca3e72cc3f71cd4071cf4070d0416fd2426fd3436ed5446dd6456cd8456cd9466bdb476adc4869de4968df4a68e04c67e24d66e34e65e44f64e55064' +
    'e75263e85362e95462ea5661eb5760ec5860ed5a5fee5b5eef5d5ef05f5ef1605df2625df2645cf3655cf4675cf4695cf56b5cf66c5cf66e5cf7705cf7725cf8745cf8765cf9785df9795df97b5dfa7d5efa7f5efa815ffb835ffb8560fb8761' +
    'fc8961fc8a62fc8c63fc8e64fc9065fd9266fd9467fd9668fd9869fd9a6afd9b6bfe9d6cfe9f6dfea16efea36ffea571fea772fea973feaa74feac76feae77feb078feb27afeb47bfeb67cfeb77efeb97ffebb81febd82febf84fec185fec287' +
    'fec488fec68afec88cfeca8dfecc8ffecd90fecf92fed194fed395fed597fed799fed89afdda9cfddc9efddea0fde0a1fde2a3fde3a5fde5a7fde7a9fde9aafdebacfcecaefceeb0fcf0b2fcf2b4fcf4b6fcf6b8fcf7b9fcf9bbfcfbbdfcfdbf',
  inferno:
    '00000401000501010601010802010a02020c02020e03021004031204031405041706041907051b08051d09061f0a07220b07240c08260d08290e092b10092d110a30120a32140b34150b37160b39180c3c190c3e1b0c411c0c431e0c451f0c48' +
    '210c4a230c4c240c4f260c51280b53290b552b0b572d0b592f0a5b310a5c320a5e340a5f3609613809623909633b09643d09653e0966400a67420a68440a68450a69470b6a490b6a4a0c6b4c0c6b4d0d6c4f0d6c510e6c520e6d540f6d550f6d' +
    '57106e59106e5a116e5c126e5d126e5f136e61136e62146e64156e65156e67166e69166e6a176e6c186e6d186e6f196e71196e721a6e741a6e751b6e771c6d781c6d7a1d6d7c1d6d7d1e6d7f1e6c801f6c82206c84206b85216b87216b88226a' +
    '8a226a8c23698d23698f24699025689225689326679526679727669827669a28659b29649d29649f2a63a02a63a22b62a32c61a52c60a62d60a82e5fa92e5eab2f5ead305dae305cb0315bb1325ab3325ab43359b63458b73557b93556ba3655' +
    'bc3754bd3853bf3952c03a51c13a50c33b4fc43c4ec63d4dc73e4cc83f4bca404acb4149cc4248ce4347cf4446d04545d24644d34743d44842d54a41d74b3fd84c3ed94d3dda4e3cdb503bdd513ade5238df5337e05536e15635e25734e35933' +
    'e45a31e55c30e65d2fe75e2ee8602de9612bea632aeb6429eb6628ec6726ed6925ee6a24ef6c23ef6e21f06f20f1711ff1731df2741cf3761bf37819f47918f57b17f57d15f67e14f68013f78212f78410f8850ff8870ef8890cf98b0bf98c0a' +
    'f98e09fa9008fa9207fa9407fb9606fb9706fb9906fb9b06fb9d07fc9f07fca108fca309fca50afca60cfca80dfcaa0ffcac11fcae12fcb014fcb216fcb418fbb61afbb81dfbba1ffbbc21fbbe23fac026fac228fac42afac62df9c72ff9c932' +
    'f9cb35f8cd37f8cf3af7d13df7d340f6d543f6d746f5d949f5db4cf4dd4ff4df53f4e156f3e35af3e55df2e661f2e865f2ea69f1ec6df1ed71f1ef75f1f179f2f27df2f482f3f586f3f68af4f88ef5f992f6fa96f8fb9af9fc9dfafda1fcffa4',
  cividis:
    '00224e00234f00245100255300255400265600275800285900285b00295d002a5f002a61002b62002c64002c66002d68002e6a002e6c002f6d00306f0030700031700031710132710533710833700c34700f357012357014367016377018376f' +
    '1a386f1c396f1e3a6f203a6f213b6e233c6e243c6e263d6e273e6e293f6e2a3f6d2b406d2d416d2e416d2f426d31436d32436d33446d34456c35456c36466c38476c39486c3a486c3b496c3c4a6c3d4a6c3e4b6c3f4c6c404c6c414d6c424e6c' +
    '434e6c444f6c45506c46516c47516c48526c49536c4a536c4b546c4c556c4d556c4e566c4f576c50576c51586d52596d535a6d545a6d555b6d555c6d565c6d575d6d585e6d595e6e5a5f6e5b606e5c616e5d616e5e626e5e636f5f636f60646f' +
    '61656f62656f636670646770656870656870666970676a71686a71696b716a6c716b6d726c6d726c6e726d6f726e6f736f70737071737172747272747273747374757474757575757676767777767777777878777979777a7a787b7a787c7b78' +
    '7d7c787e7c787e7d787f7e78807f78817f788280798381798482798582798683798784788885788985788a86788b87788c88788d88788e89788f8a78908b78918b78928c78928d78938e78948e77958f779690779791779892779992779a9376' +
    '9b94769c95769d95769e96769f9775a09875a19975a29975a39a74a49b74a59c74a69c74a79d73a89e73a99f73aaa073aba072aca172ada272aea371afa471b0a571b1a570b3a670b4a76fb5a86fb6a96fb7a96eb8aa6eb9ab6dbaac6dbbad6d' +
    'bcae6cbdae6cbeaf6bbfb06bc0b16ac1b26ac2b369c3b369c4b468c5b568c6b667c7b767c8b866c9b965cbb965ccba64cdbb63cebc63cfbd62d0be62d1bf61d2c060d3c05fd4c15fd5c25ed6c35dd7c45cd9c55cdac65bdbc75adcc859ddc858' +
    'dec958dfca57e0cb56e1cc55e2cd54e4ce53e5cf52e6d051e7d150e8d24fe9d34eead34cebd44bedd54aeed649efd748f0d846f1d945f2da44f3db42f5dc41f6dd3ff7de3ef8df3cf9e03afbe138fce236fde334fee434fee535fee636fee838',
};

// ImageJ ij/plugin/LutLoader.java, fire(): 32 control points per colour.
const FIRE = {
  r: [0, 0, 1, 25, 49, 73, 98, 122, 146, 162, 173, 184, 195, 207, 217, 229, 240, 252, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255],
  g: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 14, 35, 57, 79, 101, 117, 133, 147, 161, 175, 190, 205, 219, 234, 248, 255, 255, 255, 255],
  b: [0, 61, 96, 130, 165, 192, 220, 227, 210, 181, 151, 122, 93, 64, 35, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 35, 98, 160, 223, 255]
};

/** The picker's groups, in order. */
export const LUT_GROUPS = [
  { name: 'Colour-blind safe', luts: ['viridis', 'cividis', 'magma', 'inferno'] },
  { name: 'Classic', luts: ['grey', 'red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'orange'] },
  { name: 'Intensity', luts: ['fire', 'grey-inverted'] }
];
export const LUT_NAMES = LUT_GROUPS.flatMap(g => g.luts);
export const FILE_LUT = 'file';
export const LUT_LABELS = {
  viridis: 'Viridis', cividis: 'Cividis', magma: 'Magma', inferno: 'Inferno',
  grey: 'Grey', red: 'Red', green: 'Green', blue: 'Blue', cyan: 'Cyan', magenta: 'Magenta', yellow: 'Yellow', orange: 'Orange',
  fire: 'Fire', 'grey-inverted': 'Inverted grey', file: 'From file'
};

function generate(name) {
  const lut = new Uint8Array(768);
  if (PRESETS[name]) {
    const w = PRESETS[name], round = new Uint8ClampedArray(3);
    for (let i = 0; i < 256; i++) {
      round[0] = i * w[0]; round[1] = i * w[1]; round[2] = i * w[2]; // Uint8ClampedArray rounds half to even
      lut[i * 3] = round[0]; lut[i * 3 + 1] = round[1]; lut[i * 3 + 2] = round[2];
    }
  } else if (MATPLOTLIB[name]) {
    const hex = MATPLOTLIB[name];
    for (let k = 0; k < 768; k++) lut[k] = parseInt(hex.substr(k * 2, 2), 16);
  } else if (name === 'fire') {
    const n = 32, scale = n / 256;
    for (let i = 0; i < 256; i++) {
      const i1 = Math.floor(i * scale), i2 = Math.min(i1 + 1, n - 1), f = i * scale - i1;
      lut[i * 3] = Math.floor((1 - f) * FIRE.r[i1] + f * FIRE.r[i2]); // ImageJ casts to byte: truncation
      lut[i * 3 + 1] = Math.floor((1 - f) * FIRE.g[i1] + f * FIRE.g[i2]);
      lut[i * 3 + 2] = Math.floor((1 - f) * FIRE.b[i1] + f * FIRE.b[i2]);
    }
  } else if (name === 'grey-inverted') {
    for (let i = 0; i < 256; i++) lut[i * 3] = lut[i * 3 + 1] = lut[i * 3 + 2] = 255 - i;
  } else return null;
  return lut;
}

const cache = new Map();
/** The 256 x 3 LUT of a named colour table (null for an unknown name). */
export function namedLUT(name) {
  if (!cache.has(name)) cache.set(name, generate(name));
  return cache.get(name);
}

const fileCache = new Map();
/** A channel's LUT: its named table, or its own bytes ("From file", base64 in `lut`). Unknown: grey. */
export function channelLUT(color, fileLut = null) {
  if (color === FILE_LUT && typeof fileLut === 'string') {
    if (!fileCache.has(fileLut)) {
      const bytes = base64ToBytes(fileLut);
      fileCache.set(fileLut, bytes.length === 768 ? bytes : null);
      if (fileCache.size > 64) fileCache.delete(fileCache.keys().next().value);
    }
    const lut = fileCache.get(fileLut);
    if (lut) return lut;
  }
  return namedLUT(color) || namedLUT('grey');
}

/** ImageJ stores a LUT as 256 reds, then 256 greens, then 256 blues; FluoForge interleaves them. */
export function fromImageJ(planar) {
  const lut = new Uint8Array(768);
  for (let i = 0; i < 256; i++) { lut[i * 3] = planar[i]; lut[i * 3 + 1] = planar[256 + i]; lut[i * 3 + 2] = planar[512 + i]; }
  return lut;
}

/**
 * The library name of a LUT read from a file, or null when none matches. A table matches when every
 * entry is within 3 of the library's (files written by other programs may round differently).
 * A straight ramp to a colour within 10 of one of the 8 single colours also matches that colour,
 * as before.
 */
export function matchLUT(lut) {
  if (!lut || lut.length !== 768) return null;
  for (const name of LUT_NAMES) {
    const ref = namedLUT(name);
    let close = true;
    for (let k = 0; k < 768 && close; k++) if (Math.abs(lut[k] - ref[k]) > 3) close = false;
    if (close) return name;
  }
  const end = [lut[765], lut[766], lut[767]];
  let ramp = true;
  for (let i = 0; i < 256 && ramp; i++) for (let c = 0; c < 3; c++) if (Math.abs(lut[i * 3 + c] - end[c] * i / 255) > 3) ramp = false;
  if (ramp) for (const [name, w] of Object.entries(PRESETS)) if (w.every((v, c) => Math.abs(end[c] - v * 255) < 10)) return name;
  return null;
}

/** A CSS linear-gradient of a LUT, left (index 0) to right, for swatches. */
export function lutGradient(lut, direction = 'to right') {
  const stops = [];
  for (let k = 0; k <= 16; k++) { const i = Math.min(255, Math.round(k * 255 / 16)); stops.push(`rgb(${lut[i * 3]},${lut[i * 3 + 1]},${lut[i * 3 + 2]}) ${(k / 16 * 100).toFixed(2)}%`); }
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

export function bytesToBase64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
export function base64ToBytes(text) { try { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); } catch (e) { return new Uint8Array(0); } }

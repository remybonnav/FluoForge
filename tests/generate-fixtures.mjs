// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* Create the deterministic test images (pure Node, no Python):
   - tests/fixtures/large-multichannel.tif: 3 channels of 16-bit, 3072 x 1536, deflate, larger than the editor preview
   - tests/fixtures/second.png: 8-bit grey, 192 x 128
   The pixel formulas are those of the former tests/generate_fixture.py. */
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Multipage little-endian TIFF, 16-bit greyscale, one deflate strip per page. */
function tiff16(pages, width, height) {
  const strips = pages.map(page => deflateSync(Buffer.from(page.buffer, page.byteOffset, page.byteLength)));
  const TAGS = 10, ifdSize = 2 + TAGS * 12 + 4;
  let offset = 8;
  const layout = strips.map(strip => { const ifd = offset; offset += ifdSize; const data = offset; offset += strip.length + (strip.length & 1); return { ifd, data }; });
  const buf = Buffer.alloc(offset);
  buf.write('II', 0, 'latin1'); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(layout[0].ifd, 4);
  strips.forEach((strip, i) => {
    let p = layout[i].ifd;
    buf.writeUInt16LE(TAGS, p); p += 2;
    const tag = (id, type, value) => { buf.writeUInt16LE(id, p); buf.writeUInt16LE(type, p + 2); buf.writeUInt32LE(1, p + 4);
      if (type === 3) buf.writeUInt16LE(value, p + 8); else buf.writeUInt32LE(value, p + 8); p += 12; };
    tag(256, 4, width); tag(257, 4, height); tag(258, 3, 16); tag(259, 3, 8); tag(262, 3, 1);
    tag(273, 4, layout[i].data); tag(277, 3, 1); tag(278, 4, height); tag(279, 4, strip.length); tag(339, 3, 1);
    buf.writeUInt32LE(i + 1 < strips.length ? layout[i + 1].ifd : 0, p);
    strip.copy(buf, layout[i].data);
  });
  return buf;
}

/** 8-bit greyscale PNG. */
function png8(pixels, width, height) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width + 1)] = 0; pixels.subarray(y * width, (y + 1) * width).forEach((v, x) => { raw[y * (width + 1) + 1 + x] = v; }); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function generateFixtures({ force = false } = {}) {
  mkdirSync(OUT, { recursive: true });
  const tifPath = join(OUT, 'large-multichannel.tif'), pngPath = join(OUT, 'second.png');
  if (force || !existsSync(tifPath)) {
    const W = 3072, H = 1536, channels = [0, 1, 2].map(() => new Uint16Array(W * H));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x;
      channels[0][k] = (x % 2) * 40000 + (y % 19) * 900;
      channels[1][k] = ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) * 50000 + (x % 256) * 40;
      channels[2][k] = ((x - 1536) ** 2 + (y - 768) ** 2) % 65535;
    }
    writeFileSync(tifPath, tiff16(channels, W, H));
  }
  if (force || !existsSync(pngPath)) {
    const W = 192, H = 128, pixels = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pixels[y * W + x] = (x + y) % 256;
    writeFileSync(pngPath, png8(pixels, W, H));
  }
  return { tifPath, pngPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { tifPath, pngPath } = generateFixtures({ force: true });
  console.log(tifPath + '\n' + pngPath);
}

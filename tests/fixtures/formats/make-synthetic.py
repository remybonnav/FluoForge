#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Remy Bonnavion
"""Writes the synthetic TIFF fixtures that ImageJ cannot save (standard library only):
signed16.tif (SampleFormat 2), packed12.tif (BitsPerSample 12, packed) and
rgb16-planar.tif (16-bit RGB, PlanarConfiguration 2). Run from this folder:
    python3 make-synthetic.py
The pixel values are formulas the regression test checks (tests/file-formats-regression.js)."""
import struct

W, H = 24, 16

def tiff(path, bits, spp, sample_format, planar, data, description):
    """One-page little-endian TIFF with one strip; `data` is the pixel bytes."""
    desc = description.encode('ascii') + b'\0'
    entries = []  # (tag, type, count, value-or-bytes)
    bps = struct.pack('<%dH' % spp, *([bits] * spp))
    entries.append((256, 3, 1, W))
    entries.append((257, 3, 1, H))
    entries.append((258, 3, spp, bps if spp > 2 else bits))
    entries.append((259, 3, 1, 1))
    entries.append((262, 3, 1, 2 if spp == 3 else 1))
    entries.append((270, 2, len(desc), desc))
    strips = spp if planar == 2 else 1  # planar: one strip per sample plane
    strip_len = len(data) // strips
    entries.append((273, 4, strips, b'\0' * 4 * strips))  # strip offsets, patched below
    entries.append((277, 3, 1, spp))
    entries.append((278, 3, 1, H))
    entries.append((279, 4, strips, struct.pack('<%dI' % strips, *([strip_len] * strips))))
    entries.append((282, 5, 1, struct.pack('<II', 10000, 1)))  # 10000 px/cm = 1 µm/px
    entries.append((283, 5, 1, struct.pack('<II', 10000, 1)))
    entries.append((284, 3, 1, planar))
    entries.append((296, 3, 1, 3))  # centimetre
    entries.append((339, 3, spp, struct.pack('<%dH' % spp, *([sample_format] * spp)) if spp > 2 else sample_format))
    ifd_offset = 8
    ifd_size = 2 + 12 * len(entries) + 4
    extra = bytearray()
    extra_base = ifd_offset + ifd_size
    data_offset = None
    packed = []
    strip_slot = None
    for tag, typ, count, value in entries:
        if tag == 273: value = None
        if value is None:
            strip_slot = len(packed)
            packed.append((tag, typ, count, None))
        elif isinstance(value, bytes) and len(value) > 4:
            off = extra_base + len(extra)
            extra += value
            if len(extra) % 2: extra += b'\0'
            packed.append((tag, typ, count, struct.pack('<I', off)))
        elif isinstance(value, bytes):
            packed.append((tag, typ, count, value.ljust(4, b'\0')))
        elif typ == 3:
            packed.append((tag, typ, count, struct.pack('<HH', value, 0)))
        else:
            packed.append((tag, typ, count, struct.pack('<I', value)))
    # Strip offsets: inline for one strip, otherwise an array after the other values.
    offsets_at = extra_base + len(extra)
    if strips > 1: extra += b'\0' * 4 * strips
    data_offset = extra_base + len(extra)
    offsets = struct.pack('<%dI' % strips, *[data_offset + k * strip_len for k in range(strips)])
    if strips > 1:
        extra[offsets_at - extra_base:offsets_at - extra_base + 4 * strips] = offsets
        packed[strip_slot] = (273, 4, strips, struct.pack('<I', offsets_at))
    else:
        packed[strip_slot] = (273, 4, 1, offsets)
    out = bytearray(b'II*\0' + struct.pack('<I', ifd_offset))
    out += struct.pack('<H', len(packed))
    for tag, typ, count, value in packed:
        out += struct.pack('<HHI', tag, typ, count) + value
    out += struct.pack('<I', 0)
    out += extra
    out += data
    open(path, 'wb').write(out)

# Signed 16-bit: v = (x - 12) * 1000 + y, from -12000 to 11015.
signed = b''.join(struct.pack('<h', (x - 12) * 1000 + y) for y in range(H) for x in range(W))
tiff('signed16.tif', 16, 1, 2, 1, signed, 'FluoForge fixture: signed 16-bit')

# Packed 12-bit (TIFF bit order: most significant bit first): v = x * 150 + y.
values = [x * 150 + y for y in range(H) for x in range(W)]
packed = bytearray()
for i in range(0, len(values), 2):
    a, b = values[i], values[i + 1]
    packed += bytes([a >> 4, ((a & 15) << 4) | (b >> 8), b & 255])
tiff('packed12.tif', 12, 1, 1, 1, bytes(packed), 'FluoForge fixture: packed 12-bit')

# 16-bit RGB, planar: red plane, then green, then blue. R = x * 1000, G = y * 1000, B = 30000.
planes = [[x * 1000 for y in range(H) for x in range(W)], [y * 1000 for y in range(H) for x in range(W)], [30000] * (W * H)]
tiff('rgb16-planar.tif', 16, 3, 1, 2, b''.join(struct.pack('<%dH' % len(p), *p) for p in planes), 'FluoForge fixture: 16-bit planar RGB')

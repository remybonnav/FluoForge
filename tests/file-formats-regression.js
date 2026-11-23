/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P2-T5: file formats.
   - Fixtures in tests/fixtures/formats: 8-bit RGB, 16-bit, 32-bit float and an ImageJ hyperstack
     saved by ImageJ 1.54p; an OME-TIFF written by Bio-Formats 8.5 (DimensionOrder XYZCT, pixel size
     in nm, channel names and colours, SignificantBits 12); the hyperstack converted by
     tools/Export_for_FluoForge.ijm (big-endian OME-TIFF); signed 16-bit, packed 12-bit and 16-bit
     planar RGB written by make-synthetic.py. Each must import with the right dimensions, pixel size,
     channel names, bit depth and pixel values (the formulas are in the scripts that wrote them).
   (The synthetic files' pixel size uses the TIFF ResolutionUnit, which the reader does not use yet:
   see image-info-regression; it is not checked here.)
   - The OME-XML parser: the six dimension orders, TiffData, length units, Color, fallbacks.
   - Old projects keep decoder 1 (schema 5, display.decoder); new images record decoder 2.
   - Float planes in the compositor; the import errors for CZI, LIF and ND2, BigTIFF and unsupported
     samples (16-bit float) link to the Fiji macro. */
async function runFileFormatsRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const core = await import(new URL('js/image/composite-core.js', document.baseURI).href);
  const info = await import(new URL('js/ui/image-info.js', document.baseURI).href);
  const luts = await import(new URL('js/image/luts.js', document.baseURI).href);
  const fixture = async name => {
    const bytes = await (await fetch('tests/fixtures/formats/' + name, { cache: 'no-store' })).arrayBuffer();
    return new File([bytes], name, { type: 'image/tiff' });
  };
  const decode = async name => MFC_TIFF.decodeFile(await fixture(name));
  const rows = raw => Object.fromEntries(info.imageInfoRows(raw));
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
  const at = (plane, w, x, y) => plane[y * w + x];

  // ---- 8-bit RGB (ImageJ): R = 4x, G = 5y, B = 2(x + y); 0.5 µm/px ----
  let raw = await decode('rgb8.tif');
  assert('8-bit RGB: 64 × 48 px, three channels Red, Green and Blue in their colours',
    raw.width === 64 && raw.height === 48 && raw.channels.length === 3 && raw.channels.map(c => c.name).join() === 'Red,Green,Blue' &&
    raw.channels.map(c => c.color).join() === 'red,green,blue', raw.channels.map(c => c.name + ':' + c.color).join());
  assert('8-bit RGB: every sample, not only the first (pixel 13, 2 is 52, 10, 30)',
    raw.channels.every(c => c.data instanceof Uint8Array && c.bitDepth === 8) &&
    raw.channels.map(c => at(c.data, 64, 13, 2)).join() === '52,10,30' && at(raw.channels[2].data, 64, 63, 47) === 220);
  assert('8-bit RGB: full 0-255 range and 0.5 µm/px', raw.channels.every(c => c.min === 0 && c.max === 255) && near(raw.voxelSizeUm, 0.5));
  let shown = (await MFC_TIFF.composite(raw, 1)).getContext('2d').getImageData(13, 2, 1, 1).data;
  assert('8-bit RGB: the composite shows the RGB picture as it is', [...shown].slice(0, 3).join() === '52,10,30', [...shown].join());

  // ---- 16-bit (ImageJ): v = 50x + 13y, label GFP, display range 0-4000, 0.1625 µm/px ----
  raw = await decode('gray16.tif');
  assert('16-bit: one channel named GFP, 16-bit, values exact',
    raw.channels.length === 1 && raw.channels[0].name === 'GFP' && raw.channels[0].data instanceof Uint16Array &&
    raw.channels[0].bitDepth === 16 && at(raw.channels[0].data, 64, 13, 2) === 676 && at(raw.channels[0].data, 64, 63, 47) === 3761);
  assert('16-bit: range from the file and pixel size', raw.channels[0].min === 0 && raw.channels[0].max === 4000 && near(raw.voxelSizeUm, 0.1625));
  assert('16-bit: 12-bit data in a 16-bit file still reports 16-bit (the file does not say 12)', rows(raw)['Bit depth'] === '16-bit');

  // ---- 32-bit float (ImageJ): v = 0.25 (x - 32) + 0.01 y, label Ratio, range -8..8, 2 µm/px ----
  raw = await decode('float32.tif');
  const f = raw.channels[0];
  assert('32-bit float: decoded as floating point with negative and fractional values',
    f.data instanceof Float32Array && f.bitDepth === 32 && near(at(f.data, 64, 13, 2), -4.73, 1e-6) && near(at(f.data, 64, 0, 0), -8) &&
    near(at(f.data, 64, 63, 47), 8.22, 1e-6), at(f.data, 64, 13, 2));
  assert('32-bit float: name, display range and pixel size from the file',
    f.name === 'Ratio' && f.min === -8 && f.max === 8 && near(raw.voxelSizeUm, 2) && rows(raw)['Bit depth'] === '32-bit float');
  shown = (await MFC_TIFF.composite(raw, 1)).getContext('2d').getImageData(13, 2, 1, 1).data;
  // (-4.73 + 8) / 16 * 255 = 52.1
  assert('32-bit float: the compositor maps float values through min and max', shown[0] === 52 && shown[1] === 52 && shown[2] === 52, [...shown].join());
  const fHist = await MFC_TIFF.histogram(f.data);
  assert('32-bit float: the histogram covers the float data range', fHist && !fHist.integer && near(fHist.min, -8) && near(fHist.max, 8.22, 1e-6));

  // ---- ImageJ hyperstack: 2 C × 3 Z × 2 T, v = 1000c + 100z + 10t + x (1-based c, z, t) ----
  const hyperValue = (c, z, t, x) => 1000 * (c + 1) + 100 * (z + 1) + 10 * (t + 1) + x;
  const checkStack = (raw, label) => {
    const s = raw.stack;
    assert(label + ': 32 × 24 px, 2 channels × 3 slices × 2 frames', raw.width === 32 && raw.height === 24 && s && s.sizeC === 2 && s.sizeZ === 3 && s.sizeT === 2);
    let ok = true;
    for (let c = 0; c < 2; c++) for (let z = 0; z < 3; z++) for (let t = 0; t < 2; t++) {
      const plane = s.planes[c][t][z];
      if (at(plane, 32, 5, 7) !== hyperValue(c, z, t, 5) || at(plane, 32, 31, 0) !== hyperValue(c, z, t, 31)) ok = false;
    }
    assert(label + ': every plane in its channel, slice and frame', ok);
    assert(label + ': 0.25 µm/px and a Z step of 1.5 µm', near(raw.voxelSizeUm, 0.25) && near(s.zStepUm, 1.5));
  };
  raw = await decode('hyperstack.tif');
  checkStack(raw, 'ImageJ hyperstack');
  assert('ImageJ hyperstack: channel names (the labels every plane of a channel shares) and LUT colours',
    raw.channels.map(c => c.name).join() === 'DAPI,GFP' && raw.channels.map(c => c.color).join() === 'blue,green', raw.channels.map(c => c.name + ':' + c.color).join());
  assert('ImageJ hyperstack: dimensions from the ImageJ header', rows(raw)['Dimensions from'] === 'ImageJ header' && rows(raw).Format === 'TIFF');

  // ---- OME-TIFF (Bio-Formats): 3 C × 2 Z, XYZCT, 650 nm, v = 1000c + 100z + x + y ----
  raw = await decode('ome-tiff.ome.tif');
  let s = raw.stack;
  assert('OME-TIFF: 40 × 32 px, SizeC 3 and SizeZ 2 from the OME-XML', raw.width === 40 && raw.height === 32 && s && s.sizeC === 3 && s.sizeZ === 2 && s.sizeT === 1);
  let ok = true;
  for (let c = 0; c < 3; c++) for (let z = 0; z < 2; z++) if (at(s.planes[c][0][z], 40, 7, 3) !== 1000 * c + 100 * z + 10) ok = false;
  assert('OME-TIFF: pages follow DimensionOrder XYZCT (Z fastest), not the ImageJ order', ok);
  assert('OME-TIFF: PhysicalSizeX 650 nm is 0.65 µm/px, PhysicalSizeZ 2 µm', near(raw.voxelSizeUm, 0.65) && near(s.zStepUm, 2) &&
    /OME-XML PhysicalSizeX \(650(\.0)? nm\)/.test(rows(raw)['Pixel size source']), rows(raw)['Pixel size source']);
  assert('OME-TIFF: channel names from the OME-XML', raw.channels.map(c => c.name).join() === 'DAPI,GFP,Pink dye');
  const pink = raw.channels[2].color === luts.FILE_LUT ? luts.channelLUT(luts.FILE_LUT, raw.channels[2].lut) : null;
  assert('OME-TIFF: channel colours: blue and green presets, and a pink ramp kept "From file"',
    raw.channels[0].color === 'blue' && raw.channels[1].color === 'green' && pink && pink[765] === 255 && pink[766] === 0 && pink[767] === 128,
    raw.channels.map(c => c.color).join());
  assert('OME-TIFF: SignificantBits 12 reports 12-bit', raw.channels.every(c => c.bitDepth === 12) && rows(raw)['Bit depth'] === '12-bit');
  assert('OME-TIFF: Image info says OME-TIFF and that the dimensions come from the OME-XML',
    rows(raw).Format === 'OME-TIFF' && rows(raw)['Dimensions from'] === 'OME-XML');

  // ---- The hyperstack after tools/Export_for_FluoForge.ijm (Bio-Formats Exporter, big-endian) ----
  raw = await decode('macro-output.ome.tif');
  checkStack(raw, 'Fiji macro output (big-endian OME-TIFF)');
  assert('Fiji macro output: dimensions from the OME-XML', rows(raw)['Dimensions from'] === 'OME-XML');

  // ---- Synthetic: signed 16-bit, packed 12-bit, 16-bit planar RGB ----
  raw = await decode('signed16.tif');
  const sg = raw.channels[0];
  assert('Signed 16-bit: negative values kept exactly ((x - 12) × 1000 + y)',
    sg.data instanceof Float32Array && sg.signed === true && at(sg.data, 24, 0, 0) === -12000 && at(sg.data, 24, 13, 2) === 1002 && at(sg.data, 24, 23, 15) === 11015);
  assert('Signed 16-bit: auto range over the signed values, reported as 16-bit signed',
    sg.min === -12000 && sg.max === 11015 && rows(raw)['Bit depth'] === '16-bit signed', [sg.min, sg.max, rows(raw)['Bit depth']].join());
  raw = await decode('packed12.tif');
  const pk = raw.channels[0];
  assert('Packed 12-bit: unpacked (150x + y) and reported as 12-bit',
    pk.data instanceof Uint16Array && pk.bitDepth === 12 && at(pk.data, 24, 13, 2) === 1952 && at(pk.data, 24, 23, 15) === 3465 &&
    at(pk.data, 24, 1, 0) === 150 && rows(raw)['Bit depth'] === '12-bit');
  raw = await decode('rgb16-planar.tif');
  assert('16-bit planar RGB: three 16-bit channels from the three planes',
    raw.channels.length === 3 && raw.channels.every(c => c.data instanceof Uint16Array) &&
    raw.channels.map(c => at(c.data, 24, 13, 2)).join() === '13000,2000,30000' && raw.channels.map(c => c.name).join() === 'Red,Green,Blue',
    raw.channels.map(c => c.name + ':' + c.data.constructor.name + ':' + at(c.data, 24, 13, 2)).join());

  // ---- The OME-XML parser ----
  const xml = ({ order = 'XYCZT', c = 2, z = 3, t = 2, size = '', channels = '', tiffData = '', images = 1 }) =>
    '<?xml version="1.0" encoding="UTF-8"?><OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">' +
    Array.from({ length: images }, (_, i) => `<Image ID="Image:${i}"><Pixels ID="Pixels:${i}" DimensionOrder="${order}" Type="uint16" SizeX="4" SizeY="4" ` +
      `SizeC="${c}" SizeZ="${z}" SizeT="${t}" ${size}>${channels}${tiffData}</Pixels></Image>`).join('') + '</OME>';
  const plain = { raw: '', channels: null, slices: null, frames: null };
  ok = true;
  const sizes = { C: 2, Z: 3, T: 2 };
  for (const order of ['XYCZT', 'XYCTZ', 'XYZCT', 'XYZTC', 'XYTCZ', 'XYTZC']) {
    const ome = MFC_TIFF.parseOmeXml(xml({ order }));
    const layout = MFC_TIFF.pageLayout(12, 1, plain, ome);
    for (let c = 0; c < 2; c++) for (let z = 0; z < 3; z++) for (let t = 0; t < 2; t++) {
      const at = { C: c, Z: z, T: t };
      const [a, b, d] = order.slice(2).split('');
      const expected = at[a] + sizes[a] * (at[b] + sizes[b] * at[d]);
      if (layout.pageOf(c, z, t) !== expected) ok = false;
    }
    if (layout.source !== 'OME-XML' || layout.sizeC !== 2 || layout.sizeZ !== 3 || layout.sizeT !== 2) ok = false;
  }
  assert('OME parser: all six DimensionOrders map (c, z, t) to the right page', ok);
  const units = [['PhysicalSizeX="650" PhysicalSizeXUnit="nm"', 0.65], ['PhysicalSizeX="0.0002" PhysicalSizeXUnit="mm"', 0.2],
    ['PhysicalSizeX="1500" PhysicalSizeXUnit="Å"', 0.15], ['PhysicalSizeX="0.33"', 0.33], ['PhysicalSizeX="0.33" PhysicalSizeXUnit="µm"', 0.33]];
  assert('OME parser: PhysicalSizeX in nm, mm, Å and µm (the default unit)',
    units.every(([attr, um]) => near(MFC_TIFF.parseOmeXml(xml({ size: attr })).pixelSizeUm, um)));
  assert('OME parser: no PhysicalSizeX means no pixel size', MFC_TIFF.parseOmeXml(xml({})).pixelSizeUm === null);
  const colours = MFC_TIFF.parseOmeXml(xml({ c: 2, channels: '<Channel ID="Channel:0:0" Name="A" Color="-16744193"/><Channel ID="Channel:0:1" Fluor="mCherry"/>' })).channels;
  assert('OME parser: Color as signed RGBA, Name, Fluor when there is no Name',
    colours[0].rgb.join() === '255,0,128' && colours[0].name === 'A' && colours[1].rgb === null && colours[1].name === 'mCherry');
  const td = MFC_TIFF.parseOmeXml(xml({ order: 'XYCZT', c: 2, z: 1, t: 1, tiffData: '<TiffData FirstC="1" IFD="0" PlaneCount="1"/><TiffData FirstC="0" IFD="1" PlaneCount="1"/>' }));
  const tdLayout = MFC_TIFF.pageLayout(2, 1, plain, td);
  assert('OME parser: TiffData puts each plane on its IFD', tdLayout.pageOf(0, 0, 0) === 1 && tdLayout.pageOf(1, 0, 0) === 0);
  const missing = MFC_TIFF.pageLayout(3, 1, plain, MFC_TIFF.parseOmeXml(xml({ c: 2, z: 2, t: 1 })));
  assert('OME parser: planes missing from the file fall back to one channel per page, with a note',
    missing.source === null && missing.sizeC === 3 && /not all in this file/.test(missing.note));
  const series = MFC_TIFF.pageLayout(12, 1, plain, MFC_TIFF.parseOmeXml(xml({ images: 2 })));
  assert('OME parser: several images use the first one, with a note', series.source === 'OME-XML' && /2 images/.test(series.note));
  const rgbOme = MFC_TIFF.pageLayout(1, 3, plain, MFC_TIFF.parseOmeXml(xml({ c: 3, z: 1, t: 1 })));
  assert('OME parser: an RGB page counts as three samples of one page channel', rgbOme.sizeC === 1 && rgbOme.pageOf(0, 0, 0) === 0);
  assert('OME parser: text that is not OME-XML is ignored', MFC_TIFF.parseOmeXml('ImageJ=1.54p\nchannels=2\n') === null &&
    MFC_TIFF.parseOmeXml('<OME><broken') === null);

  // ---- Float planes in the compositor ----
  const fp = Float32Array.from([-1, 0, 0.5, 1, NaN, 2]);
  assert('Compositor: float levels clamp to min and max, NaN counts as below min',
    [...core.floatLevels(fp, { min: 0, max: 1 })].join() === '0,0,128,255,0,255');
  const ref = core.levelTable({ min: 0, max: 100, gamma: 0.5, invert: true }, 16);
  const asFloat = core.floatLevels(Float32Array.from([0, 25, 50, 100]), { min: 0, max: 100, gamma: 0.5, invert: true });
  assert('Compositor: float levels use the same gamma, invert and rounding as integer levels',
    [ref[0], ref[25], ref[50], ref[100]].join() === [...asFloat].join(), [...asFloat].join());
  const half = core.resamplePlane(Float32Array.from([0.25, 0.5, 0.25, 0.5]), 2, 2, { x: 0, y: 0, width: 2, height: 2 }, 1, 1);
  assert('Compositor: averaging a float plane is not rounded', near(half.data[0], 0.375));
  assert('Compositor: the mean projection of float planes is not rounded',
    near(core.projectPlanes([Float32Array.from([0.25]), Float32Array.from([0.5])], 'mean')[0], 0.375));

  // ---- Through the app: a float and an RGB file import; CZI, LIF and ND2 point to the Fiji macro ----
  const before = MFC.getCanvas().getObjects().length;
  await MFC.importFiles([await fixture('float32.tif'), await fixture('rgb8.tif'), await fixture('ome-tiff.ome.tif')]);
  await MFC_TIFF.whenIdle();
  const box = document.getElementById('error-toast');
  assert('Float, RGB and OME-TIFF files import into the figure without an error',
    MFC.getCanvas().getObjects().length === before + 3 && (!box || box.classList.contains('hidden')));
  for (const name of ['embryo.czi', 'slide.lif', 'cells.nd2']) {
    await MFC.importFiles([new File([new Uint8Array([1, 2, 3, 4])], name)]);
    const err = document.getElementById('error-toast');
    const link = err && err.querySelector('.error-link');
    assert(name + ': a clear error that names the Fiji macro and links to it',
      err && !err.classList.contains('hidden') && /cannot be decoded in a browser/.test(err.querySelector('.error-message').textContent) &&
      /Export_for_FluoForge/.test(err.querySelector('.error-message').textContent) && link && !link.classList.contains('hidden') &&
      /\/tools\/Export_for_FluoForge\.ijm$/.test(link.href) && link.getAttribute('download') === 'Export_for_FluoForge.ijm' && link.title.length > 20,
      err && err.querySelector('.error-message').textContent);
    MFC_ERRORS.hide();
  }
  assert('Nothing is added for a CZI, LIF or ND2 file', MFC.getCanvas().getObjects().length === before + 3);
  // A BigTIFF written by Bio-Formats: UTIF cannot read it, so it is refused with the macro link, not called damaged.
  await MFC.importFiles([await fixture('bigtiff.ome.tif')]);
  let err = document.getElementById('error-toast');
  assert('BigTIFF: refused as not supported (not as damaged), with the macro link',
    !err.classList.contains('hidden') && /uses BigTIFF/.test(err.querySelector('.error-message').textContent) &&
    !/damaged/.test(err.querySelector('.error-message').textContent) && !err.querySelector('.error-link').classList.contains('hidden') &&
    MFC.getCanvas().getObjects().length === before + 3, err.querySelector('.error-message').textContent);
  MFC_ERRORS.hide();
  // Samples FluoForge does not read (here 16-bit floating point) get the same kind of message.
  const halfFloat = await (await fixture('signed16.tif')).arrayBuffer();
  let dv = new DataView(halfFloat);
  for (let k = 0, n = dv.getUint16(8, true); k < n; k++) if (dv.getUint16(10 + k * 12, true) === 339) dv.setUint16(10 + k * 12 + 8, 3, true);
  await MFC.importFiles([new File([halfFloat], 'half-float.tif')]);
  err = document.getElementById('error-toast');
  assert('16-bit float samples: refused as not supported, with the macro link',
    /uses 16-bit floating-point samples/.test(err.querySelector('.error-message').textContent) && !err.querySelector('.error-link').classList.contains('hidden'),
    err.querySelector('.error-message').textContent);
  MFC_ERRORS.hide();
  // 4-bit samples (packed12.tif relabelled: its bytes read as 4-bit values) are unpacked.
  const fourBit = await (await fixture('packed12.tif')).arrayBuffer();
  dv = new DataView(fourBit);
  for (let k = 0, n = dv.getUint16(8, true); k < n; k++) if (dv.getUint16(10 + k * 12, true) === 258) dv.setUint16(10 + k * 12 + 8, 4, true);
  raw = await MFC_TIFF.decodeFile(new File([fourBit], 'four-bit.tif'));
  const bytes = new Uint8Array(fourBit), dataAt = dv.getUint32(10 + 6 * 12 + 8, true);
  assert('4-bit samples are unpacked, high nibble first',
    raw.channels[0].data instanceof Uint8Array && raw.channels[0].bitDepth === 4 &&
    raw.channels[0].data[0] === bytes[dataAt] >> 4 && raw.channels[0].data[1] === (bytes[dataAt] & 15) && raw.channels[0].data[3] === (bytes[dataAt + 1] & 15));
  const macro = await fetch(document.querySelector('#error-toast .error-link').href, { cache: 'no-store' });
  const macroText = macro.ok ? await macro.text() : '';
  assert('The linked macro is served with the app and uses the Bio-Formats Importer and Exporter',
    /Bio-Formats Importer/.test(macroText) && /Bio-Formats Exporter/.test(macroText) && /\.ome\.tif/.test(macroText));
  // ---- Old projects keep the decoder they were saved with (schema 5: display.decoder) ----
  let old = await MFC_TIFF.decodeFile(await fixture('rgb8.tif'), { decoder: 1 });
  assert('Decoder 1 reads an RGB TIFF as 0.1.9 did: one channel, the first sample', old.decoder === 1 && old.channels.length === 1 &&
    at(old.channels[0].data, 64, 13, 2) === 52 && (await decode('rgb8.tif')).decoder === 2);
  old = await MFC_TIFF.decodeFile(await fixture('ome-tiff.ome.tif'), { decoder: 1 });
  assert('Decoder 1 ignores the OME-XML: one channel per page, as before', old.channels.length === 6 && !old.stack && old.channels[1].name === 'Ch 2');
  old = await MFC_TIFF.decodeFile(await fixture('signed16.tif'), { decoder: 1 });
  assert('Decoder 1 reads signed 16-bit as unsigned, as before', old.channels[0].data instanceof Uint16Array && at(old.channels[0].data, 24, 0, 0) === 65536 - 12000);
  const state = MFC_PROJECT.captureState();
  const imageOf = (st, name) => st.objects.find(o => o.mfcFileName === name);
  assert('Saved images record decoder 2; the state is schema 5 or later (decoders since 5)', state.schema >= 5 &&
    ['float32.tif', 'rgb8.tif', 'ome-tiff.ome.tif'].every(n => imageOf(state, n).display.decoder === 2) && imageOf(state, 'rgb8.tif').display.channels.length === 3);
  const channelsOf = name => MFC.getRegistry()[MFC.getCanvas().getObjects().find(o => o.mfcFileName === name).mfcId].rawImage.channels;
  const older = JSON.parse(JSON.stringify(state));
  older.schema = 4;
  older.objects.forEach(o => { if (o.display) delete o.display.decoder; });
  imageOf(older, 'rgb8.tif').display.channels = [{ enabled: true, color: 'grey', min: 10, max: 200, name: 'Ch 1', gamma: 1, invert: false }];
  imageOf(older, 'ome-tiff.ome.tif').display.channels = Array.from({ length: 6 }, (_, i) => ({ enabled: true, color: 'grey', min: 0, max: 3000, name: 'Page ' + (i + 1), gamma: 1, invert: false }));
  await MFC_PROJECT.restoreState((await MFC_PROJECT.migrateState(older)).state);
  await MFC_TIFF.whenIdle();
  assert('A schema-4 project opens with decoder 1: the RGB image keeps its one channel, the OME-TIFF its six pages',
    channelsOf('rgb8.tif').length === 1 && channelsOf('rgb8.tif')[0].min === 10 && at(channelsOf('rgb8.tif')[0].data, 64, 13, 2) === 52 &&
    channelsOf('ome-tiff.ome.tif').length === 6 && channelsOf('ome-tiff.ome.tif')[5].name === 'Page 6' &&
    MFC_PROJECT.captureState().objects.every(o => !o.display || o.display.decoder === 1 || o.mfcFileName === undefined));
  await MFC_PROJECT.restoreState((await MFC_PROJECT.migrateState(state)).state);
  await MFC_TIFF.whenIdle();
  assert('…and a schema-5 project opens with decoder 2', channelsOf('rgb8.tif').length === 3 && channelsOf('ome-tiff.ome.tif').length === 3 &&
    channelsOf('float32.tif')[0].data instanceof Float32Array);

  MFC_ERRORS.report(new Error('Something else'), { title: 'Other' });
  assert('Other errors show no link', document.querySelector('#error-toast .error-link').classList.contains('hidden'));
  MFC_ERRORS.hide();
  return { checks };
}

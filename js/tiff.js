/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/*
 * tiff.js
 * -----------------------------------------------------------------------
 * Wraps UTIF.js to:
 *   1. Decode multi-page (multi-channel) TIFFs into raw per-channel
 *      16-bit (or 8-bit) sample arrays.
 *   2. Parse the ImageJ-style ImageDescription text block (tag 270) for
 *      global info: Channels, unit, spacing, global min/max.
 *   3. Parse the ImageJ IJMetadata binary block (tags 50838/50839) for
 *      PER-CHANNEL display ranges, LUTs (colors) and channel/slice labels
 *      — this is where ImageJ actually stores "Display ranges", not in
 *      the plain-text ImageDescription.
 *   4. Composite N raw channels into an 8-bit RGBA canvas using
 *      per-channel color + contrast (min/max) settings, additively.
 *
 * Fallback behaviour (documented, not hidden):
 *  - If explicit per-channel display ranges cannot be located in the
 *    IJMetadata block, we fall back to the global min=/max= from the
 *    ImageDescription, and if that's also absent, we auto-compute
 *    [min,max] from the actual pixel data of that channel ("auto contrast").
 *  - Voxel size defaults to 1 px = 1 px (calibration disabled, scale bar
 *    panel will warn) if no resolution info is found.
 * -----------------------------------------------------------------------
 */

const MFC_TIFF = (function () {

  const COLOR_PRESETS = {
    grey:    [1, 1, 1],
    red:     [1, 0, 0],
    green:   [0, 1, 0],
    blue:    [0, 0, 1],
    cyan:    [0, 1, 1],
    magenta: [1, 0, 1],
    yellow:  [1, 1, 0],
    orange:  [1, 0.5, 0]
  };

  // Longest-edge cap for the *live editing* composite canvas.
  // Raw per-channel arrays are always kept at full resolution for export.
  const MAX_WORKING_DIM = 2048;

  function findTag(ifd, tagId) {
    return ifd[tagId] !== undefined ? ifd[tagId] : undefined;
  }

  // ---------------------------------------------------------------------
  // ImageDescription (tag 270) — plain text GLOBAL header
  // ---------------------------------------------------------------------

  function parseImageDescription(desc) {

    MFC_DEBUG.log("=================================================");
    MFC_DEBUG.log("=== FULL TIFF IMAGE DESCRIPTION ===");
    MFC_DEBUG.log("=================================================");

    MFC_DEBUG.log("Type:", typeof desc);
    MFC_DEBUG.log("Length:", desc ? desc.length : 0);

    MFC_DEBUG.log("FULL DESCRIPTION:");
    MFC_DEBUG.log(desc);

    MFC_DEBUG.log("DESCRIPTION WITH ESCAPED CHARACTERS:");
    MFC_DEBUG.log(JSON.stringify(desc));

    if (desc) {
      const lines = desc.split(/\r?\n/);

      MFC_DEBUG.log("=================================================");
      MFC_DEBUG.log("=== DESCRIPTION LINE BY LINE ===");
      MFC_DEBUG.log("Total lines:", lines.length);
      MFC_DEBUG.log("=================================================");

      lines.forEach((line, index) => {
        MFC_DEBUG.log(`Line ${index}:`, JSON.stringify(line));
      });
    }

    MFC_DEBUG.log("=================================================");
    MFC_DEBUG.log("=== END FULL DESCRIPTION ===");
    MFC_DEBUG.log("=================================================");

    const meta = {
      raw: desc || '',
      channels: null,
      slices: null,           // ImageJ hyperstack Z size (slices=)
      frames: null,           // ImageJ hyperstack T size (frames=)
      images: null,           // ImageJ total plane count (images=)
      unit: null,
      spacing: null,
      globalMin: null,
      globalMax: null,
      perChannelRanges: null, // filled in later from IJMetadata, if present
      channelLabels: null,    // filled in later from IJMetadata, if present
      info: null              // filled in later from IJMetadata, if present
    };

    if (!desc) {
      MFC_DEBUG.warn("[DEBUG] No ImageDescription found!");
      return meta;
    }

    const chMatch = desc.match(/channels=(\d+)/i);
    if (chMatch) meta.channels = parseInt(chMatch[1], 10);
    const slMatch = desc.match(/(?:^|\n)slices=(\d+)/i);
    if (slMatch) meta.slices = parseInt(slMatch[1], 10);
    const frMatch = desc.match(/(?:^|\n)frames=(\d+)/i);
    if (frMatch) meta.frames = parseInt(frMatch[1], 10);
    const imMatch = desc.match(/(?:^|\n)images=(\d+)/i);
    if (imMatch) meta.images = parseInt(imMatch[1], 10);

    const unitMatch = desc.match(/unit=([^\s\r\n]+)/i);
    if (unitMatch) meta.unit = unitMatch[1];

    const spacingMatch = desc.match(/spacing=([\d.eE+-]+)/i);
    if (spacingMatch) meta.spacing = parseFloat(spacingMatch[1]);

    const minMatch = desc.match(/min=([\d.eE+-]+)/i);
    const maxMatch = desc.match(/max=([\d.eE+-]+)/i);
    if (minMatch) meta.globalMin = parseFloat(minMatch[1]);
    if (maxMatch) meta.globalMax = parseFloat(maxMatch[1]);

    // NOTE: "Display ranges" is NOT stored as text in ImageDescription by
    // ImageJ — it lives in the binary IJMetadata block (tags 50838/50839).
    // See parseIJMetadata() below. We still check for it here in case some
    // other tool/version wrote it as plain text, but expect this to miss.
    const displayRangesIndex = desc.toLowerCase().indexOf("display ranges");
    MFC_DEBUG.log("[DEBUG] Display ranges index (in plain-text description):", displayRangesIndex);
    if (displayRangesIndex !== -1) {
      MFC_DEBUG.log("[DEBUG] Display ranges FOUND as plain text!");
      MFC_DEBUG.log(desc.substring(displayRangesIndex));
    } else {
      MFC_DEBUG.warn("[DEBUG] Display ranges NOT found as plain text — will look in IJMetadata (tag 50839) instead.");
    }

    MFC_DEBUG.log("=================================================");
    MFC_DEBUG.log("=== PARSED IMAGEDESCRIPTION METADATA ===");
    MFC_DEBUG.log("=================================================");
    MFC_DEBUG.log(meta);

    return meta;
  }

  // ---------------------------------------------------------------------
  // ImageJ "IJMetadata" (tag 50839) + "IJMetadataByteCounts" (tag 50838)
  // ---------------------------------------------------------------------
  // Per-channel display ranges, LUTs (colors) and slice/channel labels are
  // written by ImageJ into a *separate* pair of private TIFF tags, present
  // once on the first IFD:
  //   50838 IJMetadataByteCounts : int32[]  (size of each chunk, incl. header)
  //   50839 IJMetadata           : raw bytes (all chunks concatenated)
  //
  // Binary layout of tag 50839:
  //   bytes[0..3]   = magic "IJIJ"
  //   then N * (4-byte block-type code + 4-byte big/little-endian count)
  //     block types include: "info", "labl", "rang", "luts", "roi ", "over"
  //   then the raw payload bytes for each block in the same order, whose
  //   individual lengths are given by IJMetadataByteCounts[1..] (index 0
  //   in that array is the length of the header itself).
  // ---------------------------------------------------------------------

  /** Normalize a UTIF tag value (number | number[] | TypedArray | string) to a Uint8Array. */
  function tagToUint8Array(val) {
    if (val == null) return null;
    if (val instanceof Uint8Array) return val;
    if (ArrayBuffer.isView(val)) return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
    if (typeof val === 'string') return Uint8Array.from(Array.from(val).map(c => c.charCodeAt(0) & 0xFF));
    if (Array.isArray(val)) return Uint8Array.from(val);
    return Uint8Array.from([val]);
  }

  /** Normalize a UTIF tag value to a plain number[] (for LONG-type tags like byte counts). */
  function tagToNumberArray(val) {
    if (val == null) return null;
    if (Array.isArray(val)) return val;
    if (ArrayBuffer.isView(val)) return Array.from(val);
    return [val];
  }

  /** true if the TIFF's own byte order (from its 2-byte header "II"/"MM") is little-endian. */
  function tiffIsLittleEndian(buf) {
    const b = new Uint8Array(buf, 0, 2);
    return b[0] === 0x49 && b[1] === 0x49; // 'I','I' => little-endian ("II")
  }

  /**
   * Decode the ImageJ IJMetadata blob (tag 50839) using the chunk sizes from
   * IJMetadataByteCounts (tag 50838).
   *
   * Returns: {
   *   info: string|null,
   *   labels: string[],
   *   ranges: {min:number,max:number}[],   // one entry per channel, in order
   *   luts: Uint8Array[]                    // one 768-byte (R,G,B x256) table per channel
   * }
   */
  function parseIJMetadata(rawBytes, byteCounts, littleEndian) {
    const result = { info: null, labels: [], ranges: [], luts: [] };
    if (!rawBytes || !byteCounts || !byteCounts.length) return result;

    const magic = String.fromCharCode(rawBytes[0], rawBytes[1], rawBytes[2], rawBytes[3]);
    if (magic !== 'IJIJ') {
      MFC_DEBUG.warn('[IJMetadata] Unexpected magic "' + magic + '" (expected "IJIJ") — skipping.');
      return result;
    }

    const dv = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const headerSize = byteCounts[0];
    const ntypes = (headerSize - 4) / 8;

    const entries = [];
    let p = 4;
    for (let i = 0; i < ntypes; i++) {
      const type = String.fromCharCode(rawBytes[p], rawBytes[p + 1], rawBytes[p + 2], rawBytes[p + 3]);
      const count = dv.getInt32(p + 4, littleEndian);
      entries.push({ type, count });
      p += 8;
    }

    const decodeUtf16String = (bytes) => {
      const n = bytes.length >> 1;
      const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint16(i * 2, littleEndian));
      return s.replace(/\0+$/, '');
    };
    const decodeDoubles = (bytes) => {
      const n = bytes.length / 8;
      const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = d.getFloat64(i * 8, littleEndian);
      return out;
    };

    let pos = headerSize; // chunk data starts right after the header block
    let bcIndex = 1;       // byteCounts[0] was the header size itself

    entries.forEach(({ type, count }) => {
      for (let i = 0; i < count; i++) {
        const len = byteCounts[bcIndex++];
        const chunk = rawBytes.subarray(pos, pos + len);
        pos += len;

        switch (type) {
          case 'info':
            result.info = decodeUtf16String(chunk);
            break;
          case 'labl':
            result.labels.push(decodeUtf16String(chunk));
            break;
          case 'rang': {
            const doubles = decodeDoubles(chunk);
            for (let k = 0; k < doubles.length; k += 2) {
              result.ranges.push({ min: doubles[k], max: doubles[k + 1] });
            }
            break;
          }
          case 'luts':
            result.luts.push(new Uint8Array(chunk)); // 768 bytes: 256 R, 256 G, 256 B
            break;
          default:
            // 'roi ', 'over', etc. — not needed for this app yet, skip silently
            break;
        }
      }
    });

    MFC_DEBUG.log('[IJMetadata] Block types found:', entries.map(e => `${e.type}(${e.count})`).join(', '));
    MFC_DEBUG.log('[IJMetadata] Decoded ranges:', result.ranges);
    MFC_DEBUG.log('[IJMetadata] Decoded labels:', result.labels);
    MFC_DEBUG.log('[IJMetadata] Decoded LUT count:', result.luts.length);
    MFC_DEBUG.log('[IJMetadata] Decoded info block:', result.info);

    return result;
  }

  /** Extract voxel size (µm/px, XY) from standard TIFF resolution tags + description unit. */
  /** Pixel size in µm and where it came from: { um, source } (um is null if the file has none). */
  function getVoxelSizeXY(ifd, descMeta) {
    // Tag 282 = XResolution, 283 = YResolution, 296 = ResolutionUnit (1=none,2=inch,3=cm)
    const xres = findTag(ifd, 't282');
    const resUnit = findTag(ifd, 't296');
    let umPerPx = null, source = xres ? 'XResolution tag without a usable unit' : 'Not in the file';

    if (xres) {
      let resPerUnit = Array.isArray(xres) ? xres[0] : xres;
      let unitMicrons;
      if (resUnit === 3) unitMicrons = 10000;      // cm -> µm
      else if (resUnit === 2) unitMicrons = 25400; // inch -> µm
      else unitMicrons = null;
      if (unitMicrons && resPerUnit) {
        umPerPx = unitMicrons / resPerUnit;
        source = 'TIFF XResolution tag, in pixels per ' + (resUnit === 3 ? 'centimetre' : 'inch');
      }
    }
    // ImageJ convention fallback: pixel size directly as 1/XResolution when
    // ResolutionUnit tag is absent/none and the description unit is "um".
    if (!umPerPx && xres && descMeta && descMeta.unit) {
      let resPerUnit = Array.isArray(xres) ? xres[0] : xres;
      if (resPerUnit && /^(um|micron|micrometer)/i.test(descMeta.unit)) {
        umPerPx = 1 / resPerUnit;
        source = 'TIFF XResolution tag, with unit=' + descMeta.unit + ' from the ImageJ header';
      }
    }
    return { um: umPerPx, source };
  }

  /**
   * Decode a File (TIFF) into a normalized in-memory structure:
   * { width, height, channels: [{data:Uint16Array|Uint8Array, bitDepth, min, max, color, enabled, name}],
   *   voxelSizeUm, meta, fileName }
   */
  // ---------------------------------------------------------------------
  // Damaged files and memory: clear messages instead of decoder internals
  // ---------------------------------------------------------------------

  /** An error that says, in plain words, that the file is damaged (the decoder's own message is kept in brackets). */
  function damaged(name, what, cause) {
    const error = new Error(`${name} is damaged or incomplete: ${what}.` + (cause ? ` (${cause.message || cause})` : ''));
    error.name = 'DamagedFileError';
    return error;
  }
  /** Every TIFF starts with "II" or "MM" followed by 42 (or 43 for BigTIFF). */
  function checkTiffHeader(buf, name) {
    const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    const little = b[0] === 0x49 && b[1] === 0x49, big = b[0] === 0x4d && b[1] === 0x4d;
    const magic = b.length === 4 ? (little ? b[2] | (b[3] << 8) : (b[2] << 8) | b[3]) : 0;
    if (!(little || big) || (magic !== 42 && magic !== 43)) {
      const error = new Error(buf.byteLength ? `${name} is not a TIFF file: it does not start with a TIFF header.` : `${name} is empty.`);
      error.name = 'NotTiffError';
      throw error;
    }
    return magic;
  }
  const first = v => Array.isArray(v) ? v[0] : v;
  const formatBytes = n => n >= 2 ** 30 ? (n / 2 ** 30).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 2 ** 20)) + ' MB';
  /** Memory a tab can probably still use. Chrome reports it; elsewhere assume about 2 GB. */
  function memoryBudgetBytes() {
    const memory = typeof performance !== 'undefined' && performance.memory;
    if (memory && memory.jsHeapSizeLimit) return Math.max(0, memory.jsHeapSizeLimit - memory.usedJSHeapSize);
    if (navigator.deviceMemory) return navigator.deviceMemory * 2 ** 30 / 2;
    return 2 * 2 ** 30;
  }
  /** Asks before an import that would need more memory than seems available; throws ImportCancelled if declined. */
  function confirmMemory(name, needed, description) {
    const budget = api.memoryBudgetBytes();
    if (needed <= budget) return;
    const ok = window.confirm(`${name} needs about ${formatBytes(needed)} of memory to open (${description}), ` +
      `but only about ${formatBytes(budget)} seems to be available. Opening it may make this browser tab crash.\n\nOpen it anyway?`);
    if (!ok) { const error = new Error(`Import of ${name} cancelled.`); error.name = 'ImportCancelled'; throw error; }
  }

  // ---------------------------------------------------------------------
  // OME-XML (the ImageDescription of an OME-TIFF)
  // ---------------------------------------------------------------------

  /** Micrometres per unit of the OME length units (UnitsLength) a pixel size may use. */
  const LENGTH_UM = { 'Å': 1e-4, 'pm': 1e-6, 'nm': 1e-3, 'µm': 1, 'μm': 1, 'um': 1, 'mm': 1e3, 'cm': 1e4, 'dm': 1e5, 'm': 1e6,
    'in': 25400, 'ft': 304800, 'mil': 25.4 };

  /** A tag string that UTIF read one byte per character, decoded as UTF-8 (OME-XML is UTF-8). */
  function utf8(text) {
    if (typeof text !== 'string' || !/[\u0080-ÿ]/.test(text) || /[^\u0000-ÿ]/.test(text)) return text;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(text, ch => ch.charCodeAt(0))); } catch (e) { return text; }
  }

  // Only complete OME-XML is parsed (Firefox prints a console error for every malformed document).
  const isOmeXml = text => typeof text === 'string' && /<([\w.-]+:)?OME[\s>]/.test(text) && /<\/([\w.-]+:)?OME>\s*\0*$/.test(text);

  /**
   * The parts of an OME-XML block FluoForge uses, for the first Image in it:
   * { sizeC, sizeZ, sizeT, order ('XYCZT', ...), pixelSizeUm, pixelSizeText, zStepUm, significantBits,
   *   type, channels: [{ name, rgb: [r, g, b] | null, samples }], tiffData: [...], imageCount }.
   * null when the text is not OME-XML or has no Pixels element.
   */
  function parseOmeXml(text) {
    if (!isOmeXml(text)) return null;
    let doc;
    try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch (e) { return null; }
    if (!doc || doc.getElementsByTagName('parsererror').length) return null;
    const all = (el, name) => [...el.getElementsByTagNameNS('*', name)];
    const images = all(doc, 'Image');
    const pixels = images.length ? all(images[0], 'Pixels')[0] : null;
    if (!pixels) return null;
    const count = (el, name, fallback) => { const v = Number(el.getAttribute(name)); return Number.isInteger(v) && v > 0 ? v : fallback; };
    const index = (el, name) => { const v = Number(el.getAttribute(name)); return el.hasAttribute(name) && Number.isInteger(v) && v >= 0 ? v : null; };
    let order = String(pixels.getAttribute('DimensionOrder') || 'XYCZT').toUpperCase();
    if (!/^XY/.test(order) || [...order.slice(2)].sort().join('') !== 'CTZ') order = 'XYCZT';
    const length = (value, unit) => {
      const v = Number(value), factor = LENGTH_UM[unit || 'µm'];
      return value != null && Number.isFinite(v) && v > 0 && factor ? v * factor : null;
    };
    const sizeXUnit = pixels.getAttribute('PhysicalSizeXUnit') || 'µm';
    const pixelSizeUm = length(pixels.getAttribute('PhysicalSizeX'), sizeXUnit);
    return {
      sizeC: count(pixels, 'SizeC', 1), sizeZ: count(pixels, 'SizeZ', 1), sizeT: count(pixels, 'SizeT', 1), order,
      pixelSizeUm, pixelSizeText: pixelSizeUm ? `${pixels.getAttribute('PhysicalSizeX')} ${sizeXUnit}` : null,
      zStepUm: length(pixels.getAttribute('PhysicalSizeZ'), pixels.getAttribute('PhysicalSizeZUnit')),
      significantBits: count(pixels, 'SignificantBits', null), type: pixels.getAttribute('Type') || null,
      channels: all(pixels, 'Channel').map(ch => {
        const colour = Number(ch.getAttribute('Color'));
        // Color is a signed 32-bit RGBA integer: red in the top byte.
        const rgb = ch.hasAttribute('Color') && Number.isInteger(colour) ? [(colour >>> 24) & 255, (colour >>> 16) & 255, (colour >>> 8) & 255] : null;
        return { name: ch.getAttribute('Name') || ch.getAttribute('Fluor') || null, rgb, samples: count(ch, 'SamplesPerPixel', 1) };
      }),
      tiffData: all(pixels, 'TiffData').map(td => {
        const uuid = all(td, 'UUID')[0];
        return { ifd: index(td, 'IFD'), firstC: index(td, 'FirstC') || 0, firstZ: index(td, 'FirstZ') || 0, firstT: index(td, 'FirstT') || 0,
          planeCount: index(td, 'PlaneCount'), fileName: uuid ? uuid.getAttribute('FileName') : null };
      }),
      imageCount: images.length
    };
  }

  /** Position of plane (c, z, t) in the order DimensionOrder gives (after X and Y). */
  function omePlaneIndex(order, sizes, c, z, t) {
    const at = { C: c, Z: z, T: t };
    let position = 0, stride = 1;
    for (const d of order.slice(2)) { position += at[d] * stride; stride *= sizes[d]; }
    return position;
  }

  /**
   * How the pages of a TIFF map to channels, Z slices and time frames:
   * { sizeC, sizeZ, sizeT, pageOf(c, z, t), source, note }. sizeC counts pages per (z, t): a page of
   * an RGB file gives three channels. OME-XML is used when present and complete, then the ImageJ
   * header (XYCZT order), otherwise every page is a channel.
   */
  function pageLayout(pageCount, samples, descMeta, ome) {
    let note = null;
    if (ome) {
      const sizeC = samples > 1 && ome.sizeC % samples === 0 ? ome.sizeC / samples : ome.sizeC;
      const sizes = { C: sizeC, Z: ome.sizeZ, T: ome.sizeT }, total = sizeC * ome.sizeZ * ome.sizeT;
      const map = new Array(total).fill(-1);
      // TiffData naming other files (a multi-file OME-TIFF set): those planes are not in this file.
      const files = new Set(ome.tiffData.map(td => td.fileName).filter(Boolean));
      if (ome.tiffData.length) {
        for (const td of ome.tiffData) {
          if (files.size > 1 && td.fileName && td.fileName !== [...files][0]) continue;
          const start = omePlaneIndex(ome.order, sizes, td.firstC, td.firstZ, td.firstT);
          const planes = td.planeCount != null ? td.planeCount : td.ifd == null ? total : 1;
          for (let k = 0; k < planes && start + k < total; k++) map[start + k] = (td.ifd || 0) + k;
        }
      } else for (let i = 0; i < total; i++) map[i] = i;
      if (map.every(page => page >= 0 && page < pageCount)) {
        return { sizeC, sizeZ: ome.sizeZ, sizeT: ome.sizeT, pageOf: (c, z, t) => map[omePlaneIndex(ome.order, sizes, c, z, t)],
          source: 'OME-XML', note: ome.imageCount > 1 ? `The file holds ${ome.imageCount} images (series); FluoForge shows the first.` : null };
      }
      note = `The OME-XML describes ${total} planes that are not all in this file (${pageCount} pages), so every page is treated as a channel.`;
    }
    const dims = stackDimensions(descMeta, pageCount);
    const imagej = /ImageJ=/.test(descMeta.raw || '');
    if (dims.sizeZ * dims.sizeT > 1) {
      return { ...dims, pageOf: (c, z, t) => t * dims.sizeC * dims.sizeZ + z * dims.sizeC + c, source: 'ImageJ header', note };
    }
    const headerPlanes = (descMeta.channels || 1) * (descMeta.slices || 1) * (descMeta.frames || 1);
    if (!note && imagej && (descMeta.slices || 1) * (descMeta.frames || 1) > 1 && headerPlanes !== pageCount) {
      note = `The ImageJ header describes ${headerPlanes} planes but the file has ${pageCount} pages, so every page is treated as a channel.`;
    }
    return { sizeC: pageCount, sizeZ: 1, sizeT: 1, pageOf: c => c, source: imagej ? 'ImageJ header' : null, note };
  }

  // ---------------------------------------------------------------------
  // Pixel samples of one page
  // ---------------------------------------------------------------------

  const SAMPLE_FORMATS = { 1: 'unsigned integer', 2: 'signed integer', 3: 'floating-point' };
  /** An error for samples FluoForge cannot read (with the Fiji conversion macro as the way out). */
  function unsupported(name, what) {
    const error = new Error(`${name} uses ${what}, which FluoForge cannot read. Convert it to OME-TIFF in Fiji ` +
      '(the Export_for_FluoForge macro does this for a whole folder).');
    error.name = 'UnsupportedFormatError';
    return error;
  }

  /** Samples per pixel, bits, sample format and how many of the samples are image channels. */
  function sampleInfo(ifd) {
    const spp = first(ifd.t277) || 1, bits = first(ifd.t258) || 8, format = first(ifd.t339) || 1;
    // Extra samples (tag 338: alpha and the like) are not channels: RGB keeps 3, grey keeps 1.
    const kept = ifd.t338 != null && spp > 1 ? (first(ifd.t262) === 2 ? Math.min(3, spp) : 1) : spp;
    return { spp, bits, format, kept, rgb: first(ifd.t262) === 2 && kept === 3 };
  }
  /** Bytes per sample of the array a page decodes to. */
  const decodedBytes = ({ bits, format }) => (format === 1 && bits <= 8 ? 1 : format === 1 && bits <= 16 ? 2 : 4);

  /**
   * The channel planes of one decoded page (UTIF leaves the pixel bytes as stored): one typed
   * array per kept sample. Unsigned 8-bit and 16-bit stay Uint8Array and Uint16Array; packed samples
   * are unpacked (1- to 7-bit to Uint8Array, 9- to 15-bit, such as 12-bit cameras, to Uint16Array); floating-point, signed and 32-bit
   * integer samples become Float32Array (exact for 8- and 16-bit signed values).
   */
  function pageSamples(ifd, name, page) {
    const { spp, bits, format, kept } = sampleInfo(ifd);
    const width = ifd.width, height = ifd.height, n = width * height;
    const planar = spp > 1 && first(ifd.t284) === 2;
    const raw = ifd.data || new Uint8Array(0);
    const rowSamples = planar ? width : width * spp, rows = planar ? height * spp : height;
    const rowBytes = Math.ceil(rowSamples * bits / 8), expected = rowBytes * rows;
    if (raw.length < expected) throw damaged(name, `${page} has ${raw.length} of its ${expected} bytes of pixel data (the file is probably cut short)`);
    const kind = `${bits}-bit ${SAMPLE_FORMATS[format] || 'sample format ' + format} samples`;
    // UTIF sets isLE, and already swaps 16-bit samples of big-endian files to little-endian;
    // 32- and 64-bit samples (ImageJ writes big-endian float files) keep the file's byte order.
    const total = n * spp, little = bits === 16 || !!ifd.isLE;
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let values;
    if (bits === 8 && format !== 3) values = format === 2 ? new Int8Array(raw.buffer, raw.byteOffset, total) : raw.subarray(0, total);
    else if (bits === 16 && format !== 3) {
      values = format === 2 ? new Float32Array(total) : new Uint16Array(total);
      if (format === 2) for (let i = 0; i < total; i++) values[i] = dv.getInt16(i * 2, little);
      else for (let i = 0; i < total; i++) values[i] = dv.getUint16(i * 2, little);
    } else if (bits === 32) {
      values = new Float32Array(total);
      if (format === 3) for (let i = 0; i < total; i++) values[i] = dv.getFloat32(i * 4, little);
      else if (format === 2) for (let i = 0; i < total; i++) values[i] = dv.getInt32(i * 4, little);
      else for (let i = 0; i < total; i++) values[i] = dv.getUint32(i * 4, little);
    } else if (bits === 64 && format === 3) {
      values = new Float32Array(total);
      for (let i = 0; i < total; i++) values[i] = dv.getFloat64(i * 8, little);
    } else if (bits < 16 && bits !== 8 && format === 1) {
      // Packed (1-, 2-, 4-bit masks; 10-, 12-, 14-bit cameras): most significant bit first, each row
      // starting on a whole byte.
      values = bits < 8 ? new Uint8Array(total) : new Uint16Array(total);
      for (let r = 0, o = 0; r < rows; r++) {
        let bit = r * rowBytes * 8;
        for (let k = 0; k < rowSamples; k++, o++, bit += bits) {
          let v = 0;
          for (let b = 0; b < bits; b++) { const at = bit + b; v = (v << 1) | ((raw[at >> 3] >> (7 - (at & 7))) & 1); }
          values[o] = v;
        }
      }
    } else throw unsupported(name, kind);
    const Out = format === 1 && bits <= 8 ? Uint8Array : format === 1 && bits <= 16 ? Uint16Array : Float32Array;
    const planes = [];
    for (let s = 0; s < kept; s++) {
      let plane;
      if (spp === 1) plane = values instanceof Out && values !== raw ? values : Out.from(values.subarray(0, n));
      else if (planar) plane = Out.from(values.subarray(s * n, (s + 1) * n));
      else { plane = new Out(n); for (let i = 0; i < n; i++) plane[i] = values[i * spp + s]; }
      planes.push(plane);
    }
    return planes;
  }

  /**
   * UTIF.decodeImage, plus planar files (PlanarConfiguration 2: all reds, then all greens, ...),
   * which UTIF lays out as if the samples were interleaved: each sample plane is decoded as a
   * one-sample image of its own strips (or tiles) and the planes are put one after the other.
   */
  function decodePage(buf, ifd, ifds) {
    const spp = first(ifd.t277) || 1;
    if (!(spp > 1 && first(ifd.t284) === 2)) { UTIF.decodeImage(buf, ifd, ifds); return; }
    const tiled = ifd.t322 != null, offsets = tiled ? ifd.t324 : ifd.t273, counts = tiled ? ifd.t325 : ifd.t279;
    const per = Math.floor(offsets.length / spp), parts = [];
    for (let s = 0; s < spp; s++) {
      const one = { ...ifd, t277: [1], t284: [1], t262: [1], t258: [first(ifd.t258)], t339: ifd.t339 && [first(ifd.t339)] };
      one[tiled ? 't324' : 't273'] = offsets.slice(s * per, (s + 1) * per);
      one[tiled ? 't325' : 't279'] = counts.slice(s * per, (s + 1) * per);
      UTIF.decodeImage(buf, one, ifds);
      parts.push(one.data);
    }
    const data = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    parts.reduce((at, p) => { data.set(p, at); return at + p.length; }, 0);
    Object.assign(ifd, { data, width: first(ifd.t256), height: first(ifd.t257), isLE: new Uint8Array(buf, 0, 1)[0] === 0x49 });
  }

  /** Default colour for a channel from an OME Color: a preset LUT, or a "From file" ramp of that colour. */
  function omeColour(rgb, luts) {
    const ramp = new Uint8Array(768), round = new Uint8ClampedArray(1);
    for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) { round[0] = i * rgb[c] / 255; ramp[i * 3 + c] = round[0]; }
    const match = luts.matchLUT(ramp);
    return match ? { color: match } : { color: luts.FILE_LUT, lut: luts.bytesToBase64(ramp) };
  }

  /**
   * Version of the TIFF decoder. Projects record it per image (display.decoder), so a figure saved
   * before 0.1.10 decodes its sources exactly as it did then (decoder 1: no OME-XML, the first sample
   * of RGB pages, 16-bit read as unsigned, other bit depths read as 8- or 16-bit). See
   * docs/PROJECT-FORMAT.md.
   */
  const DECODER = 2;

  /** Decoder 1: one page's first sample, read exactly as FluoForge 0.1.9 and earlier did. */
  function legacyPlane(ifd, name, page) {
    const width = ifd.width, height = ifd.height, n = width * height;
    const bitsPerSample = first(ifd.t258) || 8, samplesPerPixel = ifd.t277 || 1;
    if (bitsPerSample >= 8) {
      const expected = width * height * (bitsPerSample > 8 ? 2 : 1) * first(samplesPerPixel);
      const got = ifd.data ? ifd.data.length : 0;
      if (got < expected) throw damaged(name, `${page} has ${got} of its ${expected} bytes of pixel data (the file is probably cut short)`);
    }
    let arr;
    if (bitsPerSample > 8) {
      const raw = ifd.data, dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      arr = new Uint16Array(n);
      for (let i = 0; i < n; i++) arr[i] = dv.getUint16(i * 2, true);
    } else arr = new Uint8Array(ifd.data.slice(0, n));
    if (samplesPerPixel > 1) {
      const mono = new (arr.constructor)(n);
      for (let i = 0; i < n; i++) mono[i] = arr[i * samplesPerPixel];
      arr = mono;
    }
    return [arr];
  }

  /** Decodes a TIFF. `decoder: 1` reproduces the decoding of FluoForge 0.1.9 and earlier (old projects). */
  async function decodeFile(file, { decoder = DECODER } = {}) {
    const legacy = decoder < 2;
    const buf = await file.arrayBuffer();
    if (checkTiffHeader(buf, file.name) === 43) {
      // UTIF does not read BigTIFF (it finds no pixel data); see docs/GEOTIFF-EVALUATION.md.
      throw unsupported(file.name, 'BigTIFF (the TIFF variant for files over 4 GB)');
    }
    let ifds;
    try { ifds = UTIF.decode(buf); } catch (error) { throw damaged(file.name, 'its table of images cannot be read', error); }
    if (!ifds || !ifds.length) throw damaged(file.name, 'it contains no image');

    // ---- ImageDescription (tag 270): OME-XML, or the ImageJ text header ----
    let descRaw = null;
    for (const ifd of ifds) {
      const d = findTag(ifd, 't270');
      if (d) { descRaw = Array.isArray(d) ? d[0] : d; break; }
    }
    const ome = !legacy && isOmeXml(descRaw) ? parseOmeXml(utf8(descRaw)) : null;
    const descMeta = parseImageDescription(ome ? utf8(descRaw) : descRaw);
    // The ImageJ text patterns mean nothing inside XML (PhysicalSizeXUnit="nm" is not unit=...).
    if (ome) Object.assign(descMeta, { channels: null, slices: null, frames: null, images: null, unit: null, spacing: null, globalMin: null, globalMax: null, ome });

    // ---- Which pages hold which planes (decided from the tags, before any pixel is decoded) ----
    const firstIfd = ifds[0], samples = legacy ? { ...sampleInfo(firstIfd), kept: 1, rgb: false, format: 1 } : sampleInfo(firstIfd);
    const layout = pageLayout(ifds.length, samples.kept, descMeta, ome);
    const stacked = layout.sizeZ * layout.sizeT > 1;
    const used = [...new Set(Array.from({ length: layout.sizeC * layout.sizeZ * layout.sizeT }, (_, i) =>
      layout.pageOf(i % layout.sizeC, Math.floor(i / layout.sizeC) % layout.sizeZ, Math.floor(i / (layout.sizeC * layout.sizeZ)))))].sort((a, b) => a - b);

    // width × height × planes × bytes per decoded sample, plus one full-resolution RGBA composite,
    // plus the copy of the planes shown that the first composite sends to the compositing workers.
    let needed = 0, maxPixels = 0, planeBytes = 0;
    for (const page of used) {
      const ifd = ifds[page], info = legacy ? { ...sampleInfo(ifd), kept: first(ifd.t277) || 1, format: 1 } : sampleInfo(ifd);
      const w = first(ifd.t256) || 0, h = first(ifd.t257) || 0, bytes = w * h * decodedBytes(info) * info.kept;
      needed += bytes; maxPixels = Math.max(maxPixels, w * h); planeBytes = Math.max(planeBytes, bytes);
    }
    needed += maxPixels * 4 + planeBytes * (stacked ? layout.sizeC : used.length);
    confirmMemory(file.name, needed, `${first(firstIfd.t256)} × ${first(firstIfd.t257)} px, ${used.length} plane${used.length > 1 ? 's' : ''}, ` +
      `${samples.bits}-bit${samples.rgb ? ' RGB' : ''}`);

    // ---- IJMetadata (tags 50839 + 50838) — per-channel ranges/LUTs/labels ----
    let ijMeta = { info: null, labels: [], ranges: [], luts: [] };
    for (const ifd of ifds) {
      const metaBytesRaw = findTag(ifd, 't50839');
      const byteCountsRaw = findTag(ifd, 't50838');
      if (metaBytesRaw && byteCountsRaw) {
        const metaBytes = tagToUint8Array(metaBytesRaw);
        const byteCounts = tagToNumberArray(byteCountsRaw);
        const littleEndian = tiffIsLittleEndian(buf);
        MFC_DEBUG.log('[IJMetadata] Tags 50839/50838 found on this IFD — decoding…', { byteCounts, littleEndian });
        ijMeta = parseIJMetadata(metaBytes, byteCounts, littleEndian);
        break; // ImageJ only writes this once, on the first IFD
      }
    }
    if (!ijMeta.ranges.length) {
      MFC_DEBUG.warn('[IJMetadata] No 50838/50839 tags (or no "rang" block within them) found — ' +
                    'falling back to global min=/max= from ImageDescription, or auto-contrast per channel.');
    }
    descMeta.perChannelRanges = ijMeta.ranges.length ? ijMeta.ranges.map(r => [r.min, r.max]) : null;
    descMeta.channelLabels = ijMeta.labels.length ? ijMeta.labels : null;
    descMeta.info = ijMeta.info;

    MFC_DEBUG.log("=================================================");
    MFC_DEBUG.log("=== FINAL COMBINED METADATA (ImageDescription + IJMetadata) ===");
    MFC_DEBUG.log("=================================================");
    MFC_DEBUG.log(JSON.stringify(descMeta, null, 2));

    // ---- Decode the pixel data of the pages used (one plane per kept sample) ----
    const pagePlanes = new Map();
    let width = 0, height = 0;
    for (const pageIndex of used) {
      const ifd = ifds[pageIndex];
      const page = `page ${pageIndex + 1} of ${ifds.length}`;
      try { if (legacy) UTIF.decodeImage(buf, ifd, ifds); else decodePage(buf, ifd, ifds); } catch (error) { throw damaged(file.name, page + ' cannot be decoded', error); }
      if (!(ifd.width > 0 && ifd.height > 0)) throw damaged(file.name, page + ' has no width or height');
      if (!legacy && pagePlanes.size && (ifd.width !== width || ifd.height !== height)) {
        throw unsupported(file.name, `pages of different sizes (${width} × ${height} and ${ifd.width} × ${ifd.height} px)`);
      }
      width = ifd.width; height = ifd.height;
      pagePlanes.set(pageIndex, legacy ? legacyPlane(ifd, file.name, page) : pageSamples(ifd, file.name, page));
      ifd.data = null; // the decoded planes replace UTIF's copy of the bytes
    }

    // Bit depth as the file states it: BitsPerSample, or OME SignificantBits for 16-bit containers.
    const significant = ome && ome.significantBits && samples.format === 1 && samples.bits === 16 && ome.significantBits < 16 ? ome.significantBits : null;
    const bitDepth = significant || samples.bits;
    const kept = samples.kept;

    // ---- Channels (page channel × sample), each with its Z × T planes ----
    let stack = null;
    const channelsRaw = [];
    const channelCount = layout.sizeC * kept;
    if (stacked) {
      const planes = [];
      for (let k = 0; k < channelCount; k++) {
        const c = Math.floor(k / kept), s = k % kept;
        planes.push([]);
        for (let t = 0; t < layout.sizeT; t++) {
          const zs = [];
          for (let z = 0; z < layout.sizeZ; z++) zs.push(pagePlanes.get(layout.pageOf(c, z, t))[s]);
          planes[k].push(zs);
        }
        channelsRaw.push({ data: null, bitDepth });
      }
      stack = { sizeC: channelCount, sizeZ: layout.sizeZ, sizeT: layout.sizeT, planes,
        zStepUm: (ome && ome.zStepUm) || descMeta.spacing || null, cache: new Map() };
    } else {
      for (let k = 0; k < channelCount; k++) channelsRaw.push({ data: pagePlanes.get(layout.pageOf(Math.floor(k / kept), 0, 0))[k % kept], bitDepth });
    }
    channelsRaw.forEach(ch => { if (samples.format === 2) ch.signed = true; });
    const planeSelection = stack ? { stack, zMode: stack.sizeZ > 1 ? 'max' : 'slice',
      zIndex: Math.floor((stack.sizeZ - 1) / 2), tIndex: 0, channels: channelsRaw } : null;
    if (planeSelection) await selectPlane(planeSelection);

    // ---- Assign display ranges: explicit per-channel (IJMetadata "rang") >
    //      global min/max (ImageDescription) > full range of 8-bit RGB > auto-computed ----
    const channelInfo = channelsRaw.map(() => ({ rangeSource: null, colorSource: 'Default colour order' }));
    channelsRaw.forEach((ch, idx) => {
      let mn, mx;
      if (descMeta.perChannelRanges && descMeta.perChannelRanges[idx]) {
        [mn, mx] = descMeta.perChannelRanges[idx];
        MFC_DEBUG.log(`[Channel ${idx}] Using IJMetadata display range: min=${mn}, max=${mx}`);
        channelInfo[idx].rangeSource = 'ImageJ display range (IJMetadata)';
      } else if (descMeta.globalMin != null && descMeta.globalMax != null) {
        mn = descMeta.globalMin; mx = descMeta.globalMax;
        MFC_DEBUG.log(`[Channel ${idx}] Using global min/max from ImageDescription: min=${mn}, max=${mx}`);
        channelInfo[idx].rangeSource = 'min= and max= of the ImageJ header';
      } else if (samples.rgb && samples.bits === 8 && samples.format === 1) {
        mn = 0; mx = 255; // an RGB picture is meant to be seen as it is
        channelInfo[idx].rangeSource = 'Full 8-bit range (RGB)';
      } else {
        // auto-contrast fallback: compute actual min/max of this channel (NaN and infinities left out)
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < ch.data.length; i++) {
          const v = ch.data[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
        mn = lo; mx = hi === lo ? lo + 1 : hi;
        MFC_DEBUG.log(`[Channel ${idx}] No metadata range found — auto-contrast computed: min=${mn}, max=${mx}`);
        channelInfo[idx].rangeSource = 'Auto-contrast (no range in the file)';
      }
      ch.min = mn; ch.max = mx;
      ch.fileMin = mn; ch.fileMax = mx; // for "Reset to file"; not saved (a project decodes its source again)
    });

    const tiffPixelSize = getVoxelSizeXY(ifds[0], descMeta);
    const pixelSize = ome && ome.pixelSizeUm ? { um: ome.pixelSizeUm, source: `OME-XML PhysicalSizeX (${ome.pixelSizeText})` } : tiffPixelSize;
    const voxelSizeUm = pixelSize.um;

    // ---- Colours and names: OME-XML channels > ImageJ LUTs and labels > RGB > default order ----
    const defaultOrder = ['grey', 'red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'orange'];
    const omeChannels = ome && ome.channels.length === channelsRaw.length ? ome.channels : null;
    const luts = ijMeta.luts.length || (omeChannels && omeChannels.some(c => c.rgb)) ? await loadLuts() : null;
    // ImageJ labels belong to pages; a channel of a hyperstack takes one only when all its planes share it.
    const labelOf = idx => {
      const labels = descMeta.channelLabels;
      if (!labels || kept > 1 || (legacy && stack)) return null;
      if (!stack) return labels[layout.pageOf(idx, 0, 0)] || null;
      const label = labels[layout.pageOf(idx, 0, 0)];
      for (let t = 0; t < layout.sizeT; t++) for (let z = 0; z < layout.sizeZ; z++) if (labels[layout.pageOf(idx, z, t)] !== label) return null;
      return label || null;
    };
    const RGB_NAMES = ['Red', 'Green', 'Blue'];
    channelsRaw.forEach((ch, idx) => {
      const omeChannel = omeChannels ? omeChannels[idx] : null;
      // An ImageJ LUT is matched against the whole library; one that matches nothing is kept as it
      // is ("From file") rather than replaced by a default colour.
      const fileLut = ijMeta.luts[idx] && ijMeta.luts[idx].length >= 768 ? luts.fromImageJ(ijMeta.luts[idx]) : null;
      const lutMatch = fileLut ? luts.matchLUT(fileLut) || luts.FILE_LUT : null;
      const rgbSample = samples.rgb ? idx % kept : -1;
      if (omeChannel && omeChannel.rgb) {
        Object.assign(ch, omeColour(omeChannel.rgb, luts));
        channelInfo[idx].colorSource = 'OME-XML channel colour' + (ch.color === luts.FILE_LUT ? ' (no matching LUT; kept as "From file")' : '');
      } else if (lutMatch) {
        ch.color = lutMatch;
        if (lutMatch === luts.FILE_LUT) ch.lut = luts.bytesToBase64(fileLut);
        MFC_DEBUG.log(`[Channel ${idx}] Color auto-detected from ImageJ LUT: ${lutMatch}`);
        channelInfo[idx].colorSource = lutMatch === luts.FILE_LUT ? 'ImageJ LUT (matches no LUT in FluoForge; kept as "From file")' : 'ImageJ LUT';
      } else if (rgbSample >= 0) {
        ch.color = ['red', 'green', 'blue'][rgbSample];
        channelInfo[idx].colorSource = 'RGB channel';
      } else ch.color = channelsRaw.length === 1 ? 'grey' : defaultOrder[idx % defaultOrder.length];
      ch.enabled = true;
      const pageNote = rgbSample >= 0 && layout.sizeC > 1 ? ' ' + (Math.floor(idx / kept) + 1) : '';
      ch.name = (omeChannel && omeChannel.name) || labelOf(idx) || (rgbSample >= 0 ? RGB_NAMES[rgbSample] + pageNote : null) || ('Ch ' + (idx + 1));
    });

    // What the import found, for the Image info dialog (not saved in projects).
    descMeta.decodeInfo = { pages: ifds.length, pixelSizeUm: voxelSizeUm || null, pixelSizeSource: pixelSize.source,
      channels: channelInfo, layoutNote: layout.note, metadata: layout.source || (ome ? 'OME-XML' : null),
      sampleType: `${samples.bits}-bit ${SAMPLE_FORMATS[samples.format] || ''}${samples.rgb ? ' RGB' : ''}`.trim() };

    const result = {
      fileName: file.name,
      width, height,
      channels: channelsRaw,
      voxelSizeUm: voxelSizeUm || null,
      meta: descMeta,
      sourceFormat: 'tiff',
      decoder: legacy ? 1 : DECODER
    };
    if (planeSelection) Object.assign(result, { stack, zMode: planeSelection.zMode, zIndex: planeSelection.zIndex, tIndex: 0 });
    return result;
  }

  /** Channels / Z slices / time frames of a TIFF, from the ImageJ header when it matches the page count. */
  function stackDimensions(meta, pageCount) {
    const plain = { sizeC: pageCount, sizeZ: 1, sizeT: 1 };
    if (!meta || !/ImageJ=/.test(meta.raw || '')) return plain;
    const sizeC = meta.channels || 1, sizeZ = meta.slices || 1, sizeT = meta.frames || 1;
    if (sizeZ * sizeT === 1) return plain;
    if (sizeC * sizeZ * sizeT !== pageCount) {
      MFC_DEBUG.warn(`[TIFF] ImageJ header says ${sizeC} channels x ${sizeZ} slices x ${sizeT} frames ` +
        `but the file has ${pageCount} pages; treating every page as a channel.`);
      return plain;
    }
    return { sizeC, sizeZ, sizeT };
  }

  const Z_MODES = { max: 'Maximum intensity projection', mean: 'Mean intensity projection', slice: 'Single slice' };

  /** 2D plane of channel c shown for the given Z mode, slice and frame. Projections are computed
   *  off the main thread (composite worker) and cached on the stack. */
  function planeFor(stack, c, zMode, zIndex, tIndex) {
    const t = Math.min(Math.max(0, tIndex | 0), stack.sizeT - 1);
    const zs = stack.planes[c][t];
    if (zMode !== 'max' && zMode !== 'mean' || zs.length === 1) {
      return zs[Math.min(Math.max(0, zIndex | 0), zs.length - 1)];
    }
    const key = c + '|' + t + '|' + zMode;
    if (stack.cache.has(key)) return stack.cache.get(key);
    if (!stack.projecting) stack.projecting = new Map();
    if (!stack.projecting.has(key)) {
      stack.projecting.set(key, track(project(zs, zMode).then(out => { stack.cache.set(key, out); return out; })
        .finally(() => stack.projecting.delete(key))));
    }
    return stack.projecting.get(key);
  }

  const planeTickets = new WeakMap();
  /**
   * Point each channel's `data` at the plane chosen by raw.zMode / zIndex / tIndex.
   * Every other part of the app (compositing, crop, export) only reads channel.data.
   * Asynchronous: a projection may have to be computed. When it is called again for the same
   * image before an earlier call finished, only the latest call changes the channels.
   */
  async function selectPlane(raw) {
    const stack = raw && raw.stack;
    if (!stack) return raw;
    if (!Z_MODES[raw.zMode]) raw.zMode = stack.sizeZ > 1 ? 'max' : 'slice';
    raw.zIndex = Math.min(Math.max(0, raw.zIndex | 0), stack.sizeZ - 1);
    raw.tIndex = Math.min(Math.max(0, raw.tIndex | 0), stack.sizeT - 1);
    const ticket = (planeTickets.get(raw) || 0) + 1;
    planeTickets.set(raw, ticket);
    const planes = await Promise.all(raw.channels.map((ch, c) => c < stack.sizeC ? planeFor(stack, c, raw.zMode, raw.zIndex, raw.tIndex) : ch.data));
    if (planeTickets.get(raw) === ticket) raw.channels.forEach((ch, c) => { ch.data = planes[c]; });
    return raw;
  }

  /** Downscale factor to keep the live composite under MAX_WORKING_DIM. */
  function workingScale(width, height) {
    const longest = Math.max(width, height);
    return longest > MAX_WORKING_DIM ? MAX_WORKING_DIM / longest : 1;
  }

  // ---- Compositing (js/image/composite-core.js), in a worker when one can be started ----
  // Pixel planes are copied into the worker, which keeps the resampled preview planes; a later
  // change of display settings then sends no pixels. Results come back as transferred buffers.
  const SCRIPT_URL = document.currentScript?.src || new URL('js/tiff.js', document.baseURI).href;
  const CORE_URL = new URL('image/composite-core.js', SCRIPT_URL).href;
  const WORKER_URL = new URL('image/composite-worker.js', SCRIPT_URL).href;
  let corePromise = null, workerBroken = false, nextMessage = 1;
  const pool = []; // composite workers; large composites are split into one band of rows per worker
  const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const replies = new Map();
  const loadCore = () => (corePromise ||= import(CORE_URL));
  let lutsPromise = null;
  const loadLuts = () => (lutsPromise ||= import(new URL('image/luts.js', SCRIPT_URL).href));
  const planeKeys = new WeakMap();
  let nextPlaneKey = 1;
  const keyOf = data => { let key = planeKeys.get(data); if (!key) { key = 'p' + nextPlaneKey++; planeKeys.set(data, key); } return key; };
  const inWorker = new Set(); // "<plane key>|<geometry>|<band>" the worker for that band should still have cached

  /** The worker pool, started on first use; empty when workers are off or could not start. */
  function getPool() {
    if (api.useWorker === false || workerBroken || typeof Worker === 'undefined') return [];
    if (pool.length) return pool;
    try {
      for (let i = 0; i < POOL_SIZE; i++) {
        const worker = new Worker(WORKER_URL, { type: 'module' });
        worker.onmessage = ({ data }) => { const reply = replies.get(data.id); if (reply) { replies.delete(data.id); reply(data); } };
        worker.onerror = event => {
          // A worker could not start (or died): finish everything on the main thread from now on.
          if (event && event.preventDefault) event.preventDefault();
          MFC_DEBUG.warn('[composite] worker unavailable, compositing on the main thread', event && event.message);
          workerBroken = true; pool.forEach(w => w.terminate()); pool.length = 0; inWorker.clear();
          const pending = [...replies.values()]; replies.clear(); pending.forEach(reply => reply({ broken: true }));
        };
        pool.push(worker);
      }
    } catch (error) { workerBroken = true; pool.forEach(w => w.terminate()); pool.length = 0; }
    return pool;
  }
  const ask = (worker, message, transfer = []) => new Promise(resolve => { const id = nextMessage++; replies.set(id, resolve); worker.postMessage({ ...message, id }, transfer); });
  const stats = { planesSent: 0, workerComposites: 0, mainThreadComposites: 0, workerHistograms: 0 };

  // Everything in flight, so tests (and anything that must read the result) can wait for it.
  let busy = 0, idleWaiters = [];
  function track(promise) {
    busy++;
    const done = () => { if (--busy === 0) { const waiters = idleWaiters; idleWaiters = []; waiters.forEach(w => w()); } };
    promise.then(done, done);
    return promise;
  }
  /** Resolves when no composite, projection or scheduled recomposite is pending. */
  function whenIdle() { return busy === 0 ? Promise.resolve() : new Promise(resolve => idleWaiters.push(resolve)); }

  async function project(zs, mode) {
    const workers = getPool();
    if (workers.length) {
      const reply = await ask(workers[0], { type: 'project', zs, mode });
      if (reply.error) throw new Error(reply.error);
      if (!reply.broken) return reply.plane;
    }
    return (await loadCore()).projectPlanes(zs, mode);
  }

  /**
   * Histogram of a displayed plane (composite-core planeHistogram), computed in a worker and kept
   * for as long as the plane exists, so redrawing the channel panel costs nothing.
   * `background: true` (the channel panel's drawing) waits until no composite is pending, so it
   * never competes with the image being shown; any other call (Auto, tests) starts it at once.
   */
  const histograms = new WeakMap();
  async function computeHistogram(data) {
    const workers = getPool();
    if (workers.length) {
      // A copy goes to the worker: the plane itself stays shared by the channel and its stack.
      const plane = data.slice();
      const reply = await ask(workers[0], { type: 'histogram', plane }, [plane.buffer]);
      if (reply.error) throw new Error(reply.error);
      if (!reply.broken) { stats.workerHistograms++; return reply.histogram; }
    }
    return (await loadCore()).planeHistogram(data);
  }
  function histogram(data, { background = false } = {}) {
    if (!data || typeof data !== 'object') return Promise.resolve(null);
    let entry = histograms.get(data);
    if (!entry) {
      let begin;
      const started = new Promise(resolve => { begin = resolve; });
      entry = { begin, promise: started.then(() => track(computeHistogram(data))) };
      entry.promise.catch(() => histograms.delete(data));
      histograms.set(data, entry);
      // Not tracked while it waits, so whenIdle() does not wait for it.
      whenIdle().then(() => setTimeout(entry.begin, 0));
    }
    if (!background) entry.begin();
    return entry.promise;
  }

  /** Output size of a composite: `scale` of the region, or an explicit target size. */
  function compositeSize(imgData, scale, region = null, targetWidth = null, targetHeight = null) {
    const area = region || { x: 0, y: 0, width: imgData.width, height: imgData.height };
    return { area, width: targetWidth || Math.max(1, Math.round(area.width * scale)), height: targetHeight || Math.max(1, Math.round(area.height * scale)) };
  }

  /**
   * Composite channels -> an HTMLCanvasElement (8-bit RGBA). `scale` < 1 gives the live-editing
   * preview; pass 1 (or a region and a target size) for export. `cache: true` keeps the
   * resampled planes in the worker (previews), so the next display change is fast.
   */
  async function composite(imgData, scale, region = null, targetWidth = null, targetHeight = null, { cache = false } = {}) {
    const { area, width, height } = compositeSize(imgData, scale, region, targetWidth, targetHeight);
    const geometry = `${imgData.width}x${imgData.height}|${area.x},${area.y},${area.width},${area.height}|${width}x${height}`;
    const planeOf = data => ({ key: keyOf(data), data });
    const job = { srcW: imgData.width, srcH: imgData.height, region: area, dstW: width, dstH: height, cache,
      brightness: imgData.brightness || 0, contrast: imgData.contrast || 0,
      channels: imgData.channels.map(ch => ({ ...planeOf(ch.data), enabled: !!ch.enabled, color: ch.color, lut: ch.color === 'file' ? ch.lut || null : null, min: ch.min, max: ch.max,
        gamma: Number.isFinite(ch.gamma) && ch.gamma > 0 ? ch.gamma : 1, invert: !!ch.invert,
        bitDepth: ch.bitDepth || (ch.data && ch.data.BYTES_PER_ELEMENT > 1 ? 16 : 8) })),
      alpha: imgData.hasAlpha && imgData.alphaEnabled !== false && imgData.alphaData ? planeOf(imgData.alphaData) : null };
    const bands = await track(runComposite(job, geometry));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    for (const band of bands) ctx.putImageData(new ImageData(band.rgba, width, band.rows[1] - band.rows[0]), 0, band.rows[0]);
    return canvas;
  }

  /** Composites `job` and returns its bands: [{ rows: [y0, y1), rgba }]. */
  async function runComposite(job, geometry) {
    const workers = getPool();
    if (workers.length) {
      const core = await loadCore();
      // One band per worker for large outputs; each worker gets (and caches) only its band's rows.
      const count = job.dstW * job.dstH >= 512 * 512 ? Math.min(workers.length, job.dstH) : 1;
      const bands = Array.from({ length: count }, (_, b) => [Math.floor(job.dstH * b / count), Math.floor(job.dstH * (b + 1) / count)]);
      stats.lastWorkerMs = 0;
      const results = await Promise.all(bands.map((rows, b) => compositeBand(workers[b], core, job, geometry, rows, b)));
      if (results.every(Boolean)) {
        stats.workerComposites++;
        return results.map((rgba, b) => ({ rows: bands[b], rgba }));
      }
    }
    stats.mainThreadComposites++;
    return [{ rows: [0, job.dstH], rgba: (await loadCore()).compositeImage(job) }];
  }

  /** One band in one worker. Sends pixels (that band's source rows) only for planes it does not have yet. */
  async function compositeBand(worker, core, job, geometry, rows, band) {
    const [r0, r1] = core.sourceRows(job.region, job.dstH, job.srcH, rows[0], rows[1]);
    const cacheKey = p => p.key + '|' + geometry + '|' + band;
    const planes = [...job.channels.filter(c => c.enabled), ...(job.alpha ? [job.alpha] : [])];
    const send = keep => {
      // A compact copy of the band's source rows, whose buffer is then transferred: one copy, and
      // the image's own arrays (shared with insets and the Z cache) are never detached.
      const transfer = [];
      const strip = p => {
        if (!(keep(p) && p.data)) return { ...p, data: null };
        const copy = p.data.slice(r0 * job.srcW, r1 * job.srcW);
        transfer.push(copy.buffer);
        return { ...p, data: copy };
      };
      const sent = { ...job, rows, dataRow0: r0, channels: job.channels.map(c => (c.enabled ? strip(c) : { ...c, data: null })), alpha: job.alpha && strip(job.alpha) };
      stats.planesSent += transfer.length;
      return ask(worker, { type: 'composite', job: sent }, transfer);
    };
    let reply = await send(p => !(job.cache && inWorker.has(cacheKey(p))));
    if (reply.miss) {
      const missed = reply.miss;
      planes.forEach(p => { if (missed.includes(p.key)) inWorker.delete(cacheKey(p)); });
      reply = await send(p => missed.includes(p.key) || !inWorker.has(cacheKey(p)));
    }
    if (reply.error) throw new Error(reply.error);
    if (reply.broken || reply.miss) return null;
    if (job.cache) planes.forEach(p => inWorker.add(cacheKey(p)));
    stats.lastWorkerMs = Math.max(stats.lastWorkerMs || 0, reply.ms || 0);
    return reply.rgba;
  }

  /**
   * Decode a standard raster image (JPEG/PNG/BMP) into the SAME normalized shape
   * decodeFile() produces for TIFFs — three 8-bit channels (Red/Green/Blue), so it gets
   * the whole existing per-channel toggle/color/min-max UI and the compositor for
   * free. Unlike TIFF (raw sensor data, often needing contrast stretch), these formats
   * are already meant to be viewed as-is, so channel ranges default to the full 0-255
   * (no auto-contrast). PNG alpha (if any real translucency is present) is kept as a
   * separate mask applied by the compositor, not as a 4th toggle channel — see
   * `hasAlpha`/`alphaData`/`alphaEnabled`.
   */
  async function decodeRasterImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not decode image: ' + file.name));
        el.src = url;
      });
      const width = img.naturalWidth, height = img.naturalHeight;
      // RGBA canvas + red, green, blue (+ alpha) planes, and their copy for the compositing workers
      confirmMemory(file.name, width * height * 12, `${width} × ${height} px, 8-bit RGB`);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const src = ctx.getImageData(0, 0, width, height).data; // Uint8ClampedArray RGBA

      const n = width * height;
      const rData = new Uint8Array(n), gData = new Uint8Array(n), bData = new Uint8Array(n);
      let hasAlpha = false;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        rData[i] = src[o]; gData[i] = src[o + 1]; bData[i] = src[o + 2];
        if (src[o + 3] < 255) hasAlpha = true; // only flag real translucency, not incidentally-opaque PNGs
      }
      let alphaData = null;
      if (hasAlpha) {
        alphaData = new Uint8Array(n);
        for (let i = 0; i < n; i++) alphaData[i] = src[i * 4 + 3];
      }

      return {
        fileName: file.name,
        width, height,
        channels: [
          { data: rData, bitDepth: 8, min: 0, max: 255, fileMin: 0, fileMax: 255, color: 'red', enabled: true, name: 'Red' },
          { data: gData, bitDepth: 8, min: 0, max: 255, fileMin: 0, fileMax: 255, color: 'green', enabled: true, name: 'Green' },
          { data: bData, bitDepth: 8, min: 0, max: 255, fileMin: 0, fileMax: 255, color: 'blue', enabled: true, name: 'Blue' }
        ],
        voxelSizeUm: null, // JPEG/PNG/BMP never carry physical pixel size — settable manually in the channel panel
        meta: { decodeInfo: { pages: 1, pixelSizeUm: null, pixelSizeSource: 'Not in the file (PNG, JPEG and BMP have no physical pixel size)',
          channels: [0, 1, 2].map(() => ({ rangeSource: 'Full 8-bit range', colorSource: 'RGB channel' })), layoutNote: null } },
        sourceFormat: 'raster',
        hasAlpha, alphaData, alphaEnabled: true,
        brightness: 0, contrast: 0
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const api = {
    decodeFile,
    decodeRasterImage,
    memoryBudgetBytes, // replaceable, so the memory warning can be tested
    composite,
    compositeSize,
    histogram,
    whenIdle,
    track,
    useWorker: true, // set to false to composite on the main thread (tests, debugging)
    get workerActive() { return getPool().length > 0; },
    get workerCount() { return getPool().length; },
    stats, // counters for the tests: planes copied to the worker, composites by where they ran
    workingScale,
    selectPlane,
    stackDimensions,
    Z_MODES,
    COLOR_PRESETS,
    MAX_WORKING_DIM,
    parseImageDescription,
    parseOmeXml,
    DECODER,
    pageLayout,
    parseIJMetadata // exposed for debugging in the console if needed
  };
  return api;
})();
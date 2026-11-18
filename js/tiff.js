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

  /** Best-effort match of a raw 768-byte (R,G,B x256) LUT to one of our flat COLOR_PRESETS. */
  function matchLutToPreset(lut) {
    if (!lut || lut.length < 768) return null;
    const r = lut[255], g = lut[511], b = lut[767]; // value at full intensity (index 255 of each channel)
    for (const name of Object.keys(COLOR_PRESETS)) {
      const [pr, pg, pb] = COLOR_PRESETS[name];
      if (Math.abs(r - pr * 255) < 10 && Math.abs(g - pg * 255) < 10 && Math.abs(b - pb * 255) < 10) {
        return name;
      }
    }
    return null; // arbitrary/gradient LUT (e.g. "Fire") — caller falls back to 'grey'
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
  async function decodeFile(file) {
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    if (!ifds || !ifds.length) throw new Error('Could not decode TIFF: ' + file.name);

    // ---- ImageDescription (tag 270) — global text header ----
    let descRaw = null;
    for (const ifd of ifds) {
      const d = findTag(ifd, 't270');
      if (d) { descRaw = Array.isArray(d) ? d[0] : d; break; }
    }
    const descMeta = parseImageDescription(descRaw);

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

    // ---- Decode pixel data for every page/IFD (one 2D plane per page) ----
    const pagesRaw = [];
    let width = 0, height = 0;
    for (const ifd of ifds) {
      UTIF.decodeImage(buf, ifd, ifds);
      width = ifd.width; height = ifd.height;
      const bitsPerSample = Array.isArray(ifd.t258) ? ifd.t258[0] : (ifd.t258 || 8);
      const samplesPerPixel = ifd.t277 || 1;

      let arr;
      if (bitsPerSample > 8) {
        // ifd.data is Uint8Array of raw bytes; reinterpret as Uint16
        const raw = ifd.data;
        const n = width * height;
        arr = new Uint16Array(n);
        const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        const little = !ifd.isBE; // UTIF sets isBE when big-endian byte order detected
        for (let i = 0; i < n; i++) {
          arr[i] = dv.getUint16(i * 2, little);
        }
      } else {
        // 8-bit grayscale (samplesPerPixel assumed 1 for microscopy channel pages)
        arr = new Uint8Array(ifd.data.slice(0, width * height));
      }

      // channel-only pages (samplesPerPixel==1) are what we expect; if an RGB page
      // sneaks in, just take the first sample per pixel as a best-effort fallback.
      if (samplesPerPixel > 1) {
        const n = width * height;
        const mono = new (arr.constructor)(n);
        for (let i = 0; i < n; i++) mono[i] = arr[i * samplesPerPixel];
        arr = mono;
      }

      pagesRaw.push({ data: arr, bitDepth: bitsPerSample });
    }

    // ---- Split pages into channels x Z slices x T frames ----
    // ImageJ writes hyperstacks in XYCZT order: page = t*(C*Z) + z*C + c.
    // Without ImageJ dimensions every page stays a channel (plain multipage TIFF).
    const dims = stackDimensions(descMeta, pagesRaw.length);
    const headerPlanes = (descMeta.channels || 1) * (descMeta.slices || 1) * (descMeta.frames || 1);
    const layoutNote = /ImageJ=/.test(descMeta.raw || '') && (descMeta.slices || 1) * (descMeta.frames || 1) > 1 && headerPlanes !== pagesRaw.length
      ? `The ImageJ header describes ${headerPlanes} planes but the file has ${pagesRaw.length} pages, so every page is treated as a channel.` : null;
    let stack = null;
    const channelsRaw = [];
    if (dims.sizeZ * dims.sizeT > 1) {
      const planes = [];
      for (let c = 0; c < dims.sizeC; c++) {
        planes.push([]);
        for (let t = 0; t < dims.sizeT; t++) {
          const zs = [];
          for (let z = 0; z < dims.sizeZ; z++) zs.push(pagesRaw[t * dims.sizeC * dims.sizeZ + z * dims.sizeC + c].data);
          planes[c].push(zs);
        }
        channelsRaw.push({ data: null, bitDepth: pagesRaw[c].bitDepth });
      }
      stack = { sizeC: dims.sizeC, sizeZ: dims.sizeZ, sizeT: dims.sizeT, planes,
        zStepUm: descMeta.spacing || null, cache: new Map() };
    } else {
      pagesRaw.forEach(page => channelsRaw.push(page));
    }
    const planeSelection = stack ? { stack, zMode: stack.sizeZ > 1 ? 'max' : 'slice',
      zIndex: Math.floor((stack.sizeZ - 1) / 2), tIndex: 0, channels: channelsRaw } : null;
    if (planeSelection) selectPlane(planeSelection);

    // ---- Assign display ranges: explicit per-channel (IJMetadata "rang") >
    //      global min/max (ImageDescription) > auto-computed ("auto contrast") ----
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
      } else {
        // auto-contrast fallback: compute actual min/max of this channel
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < ch.data.length; i++) {
          const v = ch.data[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        mn = lo; mx = hi === lo ? lo + 1 : hi;
        MFC_DEBUG.log(`[Channel ${idx}] No metadata range found — auto-contrast computed: min=${mn}, max=${mx}`);
        channelInfo[idx].rangeSource = 'Auto-contrast (no range in the file)';
      }
      ch.min = mn; ch.max = mx;
    });

    const pixelSize = getVoxelSizeXY(ifds[0], descMeta);
    const voxelSizeUm = pixelSize.um;

    // ---- Default color/name assignment — informed by IJMetadata LUTs/labels
    //      when present, falling back to the cycling preset order otherwise ----
    const defaultOrder = ['grey', 'red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'orange'];
    channelsRaw.forEach((ch, idx) => {
      const lutMatch = ijMeta.luts[idx] ? matchLutToPreset(ijMeta.luts[idx]) : null;
      ch.color = lutMatch || (channelsRaw.length === 1 ? 'grey' : defaultOrder[idx % defaultOrder.length]);
      ch.enabled = true;
      // Hyperstack labels belong to individual planes, not channels.
      const labels = stack ? null : descMeta.channelLabels;
      ch.name = (labels && labels[idx]) || ('Ch ' + (idx + 1));

      if (lutMatch) {
        MFC_DEBUG.log(`[Channel ${idx}] Color auto-detected from ImageJ LUT: ${lutMatch}`);
        channelInfo[idx].colorSource = 'ImageJ LUT';
      }
    });

    // What the import found, for the Image info dialog (not saved in projects).
    descMeta.decodeInfo = { pages: pagesRaw.length, pixelSizeUm: voxelSizeUm || null, pixelSizeSource: pixelSize.source,
      channels: channelInfo, layoutNote };

    const result = {
      fileName: file.name,
      width, height,
      channels: channelsRaw,
      voxelSizeUm: voxelSizeUm || null,
      meta: descMeta,
      sourceFormat: 'tiff'
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

  /** 2D plane of channel c shown for the given Z mode, slice and frame (projections are cached). */
  function planeFor(stack, c, zMode, zIndex, tIndex) {
    const t = Math.min(Math.max(0, tIndex | 0), stack.sizeT - 1);
    const zs = stack.planes[c][t];
    if (zMode !== 'max' && zMode !== 'mean' || zs.length === 1) {
      return zs[Math.min(Math.max(0, zIndex | 0), zs.length - 1)];
    }
    const key = c + '|' + t + '|' + zMode;
    if (stack.cache.has(key)) return stack.cache.get(key);
    const n = zs[0].length, out = new (zs[0].constructor)(n);
    if (zMode === 'max') {
      out.set(zs[0]);
      for (let z = 1; z < zs.length; z++) { const p = zs[z]; for (let i = 0; i < n; i++) if (p[i] > out[i]) out[i] = p[i]; }
    } else {
      const sum = new Float64Array(n);
      for (const p of zs) for (let i = 0; i < n; i++) sum[i] += p[i];
      for (let i = 0; i < n; i++) out[i] = Math.round(sum[i] / zs.length);
    }
    stack.cache.set(key, out);
    return out;
  }

  /**
   * Point each channel's `data` at the plane chosen by raw.zMode / zIndex / tIndex.
   * Every other part of the app (compositing, crop, export) only reads channel.data.
   */
  function selectPlane(raw) {
    const stack = raw && raw.stack;
    if (!stack) return raw;
    if (!Z_MODES[raw.zMode]) raw.zMode = stack.sizeZ > 1 ? 'max' : 'slice';
    raw.zIndex = Math.min(Math.max(0, raw.zIndex | 0), stack.sizeZ - 1);
    raw.tIndex = Math.min(Math.max(0, raw.tIndex | 0), stack.sizeT - 1);
    raw.channels.forEach((ch, c) => { if (c < stack.sizeC) ch.data = planeFor(stack, c, raw.zMode, raw.zIndex, raw.tIndex); });
    return raw;
  }

  /** Downscale factor to keep the live composite under MAX_WORKING_DIM. */
  function workingScale(width, height) {
    const longest = Math.max(width, height);
    return longest > MAX_WORKING_DIM ? MAX_WORKING_DIM / longest : 1;
  }

  /**
   * Composite channels -> an HTMLCanvasElement (8-bit RGBA), additive blend.
   * `scale` < 1 downsamples for the live-editing canvas; pass 1 for full-res export.
   */
  function compositeChannels(imgData, scale, region = null, targetWidth = null, targetHeight = null) {
    const srcW = imgData.width, srcH = imgData.height;
    const area = region || { x: 0, y: 0, width: srcW, height: srcH };
    const dstW = targetWidth || Math.max(1, Math.round(area.width * scale));
    const dstH = targetHeight || Math.max(1, Math.round(area.height * scale));
    const sourceX = x => Math.floor(area.x + x * area.width / dstW);
    const sourceY = y => Math.floor(area.y + y * area.height / dstH);

    const canvas = document.createElement('canvas');
    canvas.width = dstW; canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(dstW, dstH);
    const outData = out.data;

    // init alpha to 255, rgb to 0
    for (let i = 0; i < outData.length; i += 4) outData[i + 3] = 255;

    const activeChannels = imgData.channels.filter(c => c.enabled);
    for (const ch of activeChannels) {
      const [wr, wg, wb] = COLOR_PRESETS[ch.color] || COLOR_PRESETS.grey;
      const range = (ch.max - ch.min) || 1;
      const data = ch.data;

      for (let y = 0; y < dstH; y++) {
        const sy = sourceY(y);
        for (let x = 0; x < dstW; x++) {
          const sx = sourceX(x);
          if (sx < 0 || sy < 0 || sx >= srcW || sy >= srcH) { outData[(y * dstW + x) * 4 + 3] = 0; continue; }
          const v = data[sy * srcW + sx];
          let norm = (v - ch.min) / range;
          if (norm < 0) norm = 0; else if (norm > 1) norm = 1;
          const o = (y * dstW + x) * 4;
          if (wr) outData[o]     = Math.min(255, outData[o]     + norm * 255 * wr);
          if (wg) outData[o + 1] = Math.min(255, outData[o + 1] + norm * 255 * wg);
          if (wb) outData[o + 2] = Math.min(255, outData[o + 2] + norm * 255 * wb);
        }
      }
    }

    // Whole-image brightness/contrast tone curve — applied after channel compositing to
    // the already-blended RGB, so the same control works identically for TIFF composites
    // and RGB imports. contrast/brightness default to 0 (no-op) when unset, so existing
    // images/projects that predate this feature render exactly as before.
    const brightness = imgData.brightness || 0, contrast = imgData.contrast || 0;
    if (brightness !== 0 || contrast !== 0) {
      const contrastFactor = (100 + contrast) / 100; // 0 -> 1x (no change), 100 -> 2x, -100 -> 0x (flat grey)
      const brightnessOffset = brightness * 2.55;    // -100..100 -> roughly -255..255
      for (let i = 0; i < outData.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          let v = (outData[i + c] - 128) * contrastFactor + 128 + brightnessOffset;
          outData[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }

    // Preserve real source transparency (e.g. PNG alpha) when present and enabled;
    // otherwise stays fully opaque (255, set above) same as every other image type.
    if (imgData.hasAlpha && imgData.alphaEnabled !== false && imgData.alphaData) {
      const alphaData = imgData.alphaData;
      for (let y = 0; y < dstH; y++) {
        const sy = sourceY(y);
        for (let x = 0; x < dstW; x++) {
          const sx = sourceX(x);
          if (sx < 0 || sy < 0 || sx >= srcW || sy >= srcH) { outData[(y * dstW + x) * 4 + 3] = 0; continue; }
          outData[(y * dstW + x) * 4 + 3] = alphaData[sy * srcW + sx];
        }
      }
    }

    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  /**
   * Decode a standard raster image (JPEG/PNG/BMP) into the SAME normalized shape
   * decodeFile() produces for TIFFs — three 8-bit channels (Red/Green/Blue), so it gets
   * the whole existing per-channel toggle/color/min-max UI and compositeChannels() for
   * free. Unlike TIFF (raw sensor data, often needing contrast stretch), these formats
   * are already meant to be viewed as-is, so channel ranges default to the full 0-255
   * (no auto-contrast). PNG alpha (if any real translucency is present) is kept as a
   * separate mask applied in compositeChannels, not as a 4th toggle channel — see
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
          { data: rData, bitDepth: 8, min: 0, max: 255, color: 'red', enabled: true, name: 'Red' },
          { data: gData, bitDepth: 8, min: 0, max: 255, color: 'green', enabled: true, name: 'Green' },
          { data: bData, bitDepth: 8, min: 0, max: 255, color: 'blue', enabled: true, name: 'Blue' }
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

  return {
    decodeFile,
    decodeRasterImage,
    compositeChannels,
    workingScale,
    selectPlane,
    stackDimensions,
    Z_MODES,
    COLOR_PRESETS,
    MAX_WORKING_DIM,
    parseImageDescription,
    parseIJMetadata // exposed for debugging in the console if needed
  };
})();
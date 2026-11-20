# Evaluation: geotiff.js instead of UTIF for reading TIFF

Roadmap task P2-T5 asked for an evaluation of [geotiff.js](https://github.com/geotiffjs/geotiff.js) as the TIFF reader (tiled files, BigTIFF, lazy plane access), with its bundle size and risks reported before any switch. This is that report. **Decision for now: keep UTIF.js 3.1.0 for reading and writing. geotiff.js is not added.**

Measured on 2026-11-20 with geotiff 3.0.5 (npm, MIT licence, last published 2026-03-30), outside the repository.

## Size

| | Minified | Gzipped (`gzip -9`) |
|---|---|---|
| UTIF.js 3.1.0 (vendored now) | 58 KB | 19 KB |
| geotiff.js 3.0.5, `dist-browser/geotiff.js` (UMD, all decoders inlined) | 551 KB | 199 KB |

The npm package unpacks to 3.8 MB, and installing it pulls in 8 runtime dependencies (8.1 MB of `node_modules`): `lerc`, `pako`, `zstddec`, `quick-lru`, `xml-utils`, `web-worker`, `parse-headers` and `@petamoriken/float16`. Vendoring it would mean one file of about ten times UTIF's size, plus a licence file for each bundled dependency.

## What it reads that UTIF does not

The same fixtures were read with both libraries (pixel 13, 2 of the first plane, or 7, 3 for the OME files).

| File | UTIF (with the P2-T5 decoder around it) | geotiff.js 3.0.5 |
|---|---|---|
| The 9 TIFFs in `tests/fixtures/formats/` (RGB, 16-bit, float, hyperstack, OME-TIFF, big-endian OME-TIFF, signed 16-bit, packed 12-bit, planar RGB) | All correct. Planar RGB needs FluoForge's `decodePage` (UTIF lays planar strips out as interleaved), and 32-bit samples need FluoForge's byte-order handling | All correct, as typed arrays of the right type (`Int16Array` for signed 16-bit, `Float32Array`, ...) |
| Tiled OME-TIFF (16 × 16 tiles, Bio-Formats 8.5) | Correct | Correct |
| BigTIFF OME-TIFF (Bio-Formats 8.5) | **Fails**: finds 2 pages instead of 6 and no pixel data. FluoForge now refuses BigTIFF with a clear message | Correct |
| Tiled BigTIFF | **Fails** (as above) | Correct |

geotiff.js also has lazy access: `fromBlob(file)` reads only the header, and `getImage(i).readRasters()` then reads only that page's strips or tiles, so a 4 GB stack would not have to be loaded into memory to show one plane. UTIF needs the whole file as one `ArrayBuffer`. It also decodes compressions UTIF lacks (ZSTD, LERC, float16).

## What it does not do

It reads tags, not microscopy metadata: the OME-XML and ImageJ parsing, the dimension order, channel names, LUTs and display ranges stay FluoForge's own code either way. It does not write TIFF, so UTIF stays for the TIFF export.

## Risks of switching

1. **Content-Security-Policy.** Its decoder pool starts workers from `blob:` URLs (`URL.createObjectURL`), which FluoForge's policy (`default-src 'self'`) blocks. It would have to run without its pool (on the main thread or inside FluoForge's own compositing workers), or the policy would need `worker-src blob:`.
2. **Network code in the bundle.** The browser build contains the remote sources (`fetch`, `XMLHttpRequest`) for `fromUrl`. FluoForge would never call them and the policy would block them, but the vendored file would contain request code that `offline-regression` and reviewers then have to account for.
3. **Size.** 199 KB gzipped on every first load, about ten times UTIF, for a static app that is often opened from a shared folder.
4. **Asynchronous API.** Every page read returns a promise. `decodeFile` already is asynchronous, so this is a moderate rewrite of `js/tiff.js` rather than a drop-in change.
5. **Major version churn.** 3.0 is a recent major version; the `dist-browser` build and the package's exports changed between 2.x and 3.x.
6. **Behaviour parity.** Every existing project decodes its stored source TIFF again on opening. A different decoder must give byte-identical planes for every file an older version could open (the `compat-regression` fixtures, the reference project), or old projects would look different.

## Recommendation

Do not switch for P2-T5: UTIF with the new decoder reads every fixture the acceptance criteria name, and the only missing format, BigTIFF, now fails with a message that points to the Fiji macro. Reconsider geotiff.js when files over 4 GB or lazy plane loading become a goal, as its own task: vendor the UMD build without its worker pool, check the CSP and the offline suite, and prove parity on all compatibility fixtures before UTIF is removed from the import path.

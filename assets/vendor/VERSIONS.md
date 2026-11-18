# Vendored libraries

FluoForge loads no code from a CDN. Every third-party library is committed here with its licence file and pinned to the exact bytes listed below. `tests/offline-regression.js` checks each file against its SHA-256.

| Library | Version | File | SHA-256 | Licence file | Source URL | Local patch |
|---|---|---|---|---|---|---|
| Fabric.js | 5.1.0 (served by cdnjs under the 5.3.0 path; see below) | `assets/vendor/fabric.min.js` | `f3a3763020189d69b8d2b64197172682b6d90f8f90fcac52d799b0cf64a9870a` | `LICENSE-fabric.txt` | https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js | None |
| UTIF.js | 3.1.0 | `assets/vendor/UTIF.js` | `e3e76115f49571e39624c3316a76b3c4c5b2c5ca518dfec4b66a9f7af8c6d059` | `LICENSE-utif.txt` | https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js | None |
| jsPDF | 2.5.1 | `assets/vendor/jspdf.umd.min.js` | `98ccf17aa10c20bb1301762618fcc9b6ab3a4e7f26b6071d64d0b41154df3875` | `LICENSE-jspdf.txt` | https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js | None |
| JSZip | 3.10.1 | `assets/vendor/jszip.min.js` | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` | `LICENSE-jszip.txt` | https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js | None |
| pako | 2.1.0 | `assets/vendor/pako.min.js` | `ede2693a4a6a5126b9d35669062b358ecab6ae7b9b86a1cf302feb45a8514907` | `LICENSE-pako.txt` | https://unpkg.com/pako@2.1.0/dist/pako.min.js | None |
| svg2pdf.js | 2.5.0 | `assets/vendor/svg2pdf.umd.min.js` | `4ff121e7ed129a168ceaf15cc41a6071db0341d482826acc32f054e15e5154c4` | `LICENSE-svg2pdf.txt` | https://unpkg.com/svg2pdf.js@2.5.0/dist/svg2pdf.umd.min.js | Yes: the data-URL pattern `((?:.\|\s)*)` became `([\s\S]*)`, which stops a call-stack overflow on very large embedded images. A comment on the first line marks the change. |

## Notes

- **Fabric.js.** The file cdnjs serves at `fabric.js/5.3.0/fabric.min.js` is byte-identical to the npm package `fabric@5.1.0` (`dist/fabric.min.js`), and it reports `fabric.version === "5.1.0"`. This is the build FluoForge has always run, so it was vendored unchanged.
- **Licence files.** The licence files come from the npm packages at the same versions (`LICENSE`, or `LICENSE.markdown` for JSZip).
- **Updating a library.**
  1. Replace the file.
  2. Update its row here, including the SHA-256.
  3. Update `THIRD-PARTY-NOTICES.md`.
  4. Run every suite in `tests/browser-regression.html`.

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* Builds a fixture for tests/compat/ (`npm run compat-fixture -- …`). Every release adds its own
   fixture before it ships (docs/PROJECT-FORMAT.md).

   node tests/make-compat-fixture.mjs --ref=<git ref> [--name=<dir>]
       Checks out <ref> into a temporary folder, runs that version of the app in headless Chromium,
       builds the reference figure (tests/reference-figure.js), saves it with that version, and writes
       tests/compat/<name>/ with:
         project.mfcproj.zip or project.fluoforge   the file that version saved
         expected.json                              compatSummary() of the saved state, run in that version
         export.svg                                 that version's SVG export of page 1
       <name> defaults to v<app version>.
   node tests/make-compat-fixture.mjs --ref=<git ref> --open=<project file> --name=<dir>
       Same, but opens an existing project file instead of building the figure.
   --ref=worktree runs the working tree instead of a git ref (for legacy files that no
   released version of this repository saved).

   Only tests/reference-figure.js and tests/compat-summary.js come from the working tree; the app is
   entirely the checked-out version. Versions before 0.1.1 loaded four libraries from CDNs; their
   script tags are pointed at the vendored copies, which are byte-identical (assets/vendor/VERSIONS.md). */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
if (!args.ref) { console.error('Usage: node tests/make-compat-fixture.mjs --ref=<git ref>|worktree [--open=<project file>] [--name=<dir>]'); process.exit(1); }

const CDN = {
  'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js': 'fabric.min.js',
  'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js': 'UTIF.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js': 'jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js': 'jszip.min.js'
};
const FROM_WORKTREE = new Set(['/tests/reference-figure.js', '/tests/compat-summary.js']);
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

let appRoot = ROOT, temp = null, commit = 'working tree';
if (args.ref !== 'worktree') {
  temp = await mkdtemp(join(tmpdir(), 'fluoforge-fixture-'));
  commit = execFileSync('git', ['rev-parse', args.ref + '^{commit}'], { cwd: ROOT, encoding: 'utf8' }).trim();
  execFileSync('sh', ['-c', `git archive "${commit}" | tar -x -C "${temp}"`], { cwd: ROOT });
  let html = await readFile(join(temp, 'index.html'), 'utf8');
  for (const [url, file] of Object.entries(CDN)) if (html.includes(url)) {
    await mkdir(join(temp, 'assets/vendor'), { recursive: true });
    await copyFile(join(ROOT, 'assets/vendor', file), join(temp, 'assets/vendor', file));
    html = html.replaceAll(url, 'assets/vendor/' + file);
  }
  await writeFile(join(temp, 'index.html'), html);
  appRoot = temp;
}

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const body = await readFile(join(FROM_WORKTREE.has(path) ? ROOT : appRoot, path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  const external = [], errors = [];
  await context.route('**/*', route => { const u = route.request().url(); if (u.startsWith(origin) || /^(data|blob):/.test(u)) return route.continue(); external.push(u); return route.abort(); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/?fixture=' + Date.now());
  await page.waitForFunction(() => document.getElementById('app-version')?.textContent);
  for (const src of ['tests/reference-figure.js', 'tests/compat-summary.js'])
    await page.evaluate(src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.append(s); }), src);

  const input = args.open ? (await readFile(resolve(args.open))).toString('base64') : null;
  const out = await page.evaluate(async ({ input, name }) => {
    const toBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
    let archive;
    if (input) {
      archive = Uint8Array.from(atob(input), c => c.charCodeAt(0));
      await MFC_PROJECT.loadProject(new File([archive], name));
      document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
    } else archive = new Uint8Array(await (await buildReferenceFigure()).arrayBuffer());
    await document.fonts.ready;
    // The state the version wrote: from the file it saved, or (for --open) the state it opened.
    let state = MFC_PROJECT.captureState();
    if (!input) {
      const zip = await JSZip.loadAsync(archive), manifest = JSON.parse(await zip.file('manifest.json').async('string'));
      const version = manifest.versions.find(v => v.id === manifest.currentVersionId);
      state = JSON.parse(await zip.file(version.statePath).async('string'));
    }
    const svg = (await MFC_EXPORT.buildSVG()).svg;
    return { archive: toBase64(archive), summary: compatSummary(state), svg, version: MFC.getAppVersion() };
  }, { input, name: args.open ? basename(args.open) : '' });

  if (external.length || errors.length) throw new Error(`The app made ${external.length} outside requests and ${errors.length} page errors: ${[...external, ...errors].slice(0, 3).join('; ')}`);
  const name = args.name || 'v' + out.version;
  const dir = join(ROOT, 'tests/compat', name);
  await mkdir(dir, { recursive: true });
  const projectFile = args.open ? 'project' + (basename(args.open).match(/(\.mfcproj\.zip|\.mfcproj\.json\.gz|\.mfcproj\.json|\.json\.gz|\.json|\.fluoforge|\.zip)$/) || ['.bin'])[0]
    : 'project' + ((await readFile(join(appRoot, 'js/project.js'), 'utf8')).includes("PROJECT_EXTENSION = '.fluoforge'") ? '.fluoforge' : '.mfcproj.zip');
  if (!args.open || resolve(args.open) !== join(dir, projectFile)) await writeFile(join(dir, projectFile), Buffer.from(out.archive, 'base64'));
  await writeFile(join(dir, 'export.svg'), out.svg);
  const expected = {
    fixture: name,
    project: projectFile,
    recordedBy: { appVersion: out.version, commit, how: args.open ? 'opened ' + basename(args.open) : 'built tests/reference-figure.js and saved it' },
    summary: out.summary
  };
  await writeFile(join(dir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
  console.log(`Wrote tests/compat/${name}/ (${projectFile}, expected.json, export.svg) with FluoForge ${out.version} at ${commit}`);
} finally {
  await browser.close(); server.close();
  if (temp) await rm(temp, { recursive: true, force: true });
}

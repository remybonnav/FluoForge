// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* Headless test runner (`npm test`).
   1. Checks that the version is the same everywhere and tests the release script and the docs'
      links (tests/release-regression.mjs, in Node).
   2. Generates the test images (tests/generate-fixtures.mjs).
   3. Serves the repository on a local port.
   4. Runs every suite of tests/browser-regression.html in Chromium and Firefox, with every
      request to another origin blocked and reported.
   5. In Chromium, reopens tests/fixtures/reference.mfcproj.zip and compares its SVG, TIFF and
      PDF exports with the stored references (tests/reference-check.js).
   Exits non-zero on any failure.

   Options: --browser=chromium|firefox   --suite=<name>   --skip-reference   --reference-only
            --make-reference   rewrite tests/fixtures/reference.* (only for an intended export change) */
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { chromium, firefox } from 'playwright';
import { generateFixtures } from './generate-fixtures.mjs';
import { runReleaseRegressions } from './release-regression.mjs';
import { check as checkVersion, describeMismatch } from '../scripts/release.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const SUITE_TIMEOUT = 240_000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.tif': 'image/tiff', '.zip': 'application/zip', '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(ROOT, path));
      if (!file.startsWith(ROOT + sep) || file.includes(sep + '.git' + sep)) { res.writeHead(403).end(); return; }
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
    } catch { res.writeHead(404).end('Not found'); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function openPage(browser, origin, url, log) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();
  await context.route('**/*', route => {
    const target = route.request().url();
    if (target.startsWith(origin) || /^(data|blob):/.test(target)) return route.continue();
    log.external.push(target); return route.abort('internetdisconnected');
  });
  page.on('pageerror', error => log.errors.push('page error: ' + error.message));
  page.on('console', message => { if (message.type() === 'error') log.errors.push('console error: ' + message.text().slice(0, 300)); });
  await page.goto(origin + url);
  return { context, page };
}

/** Load tests/<file> into the app iframe or page, the way browser-regression.html does. */
async function injectScripts(page, files) {
  for (const src of files) await page.evaluate(src => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src + '?run=' + Date.now(); s.onload = resolve; s.onerror = () => reject(new Error('Cannot load ' + src));
    document.head.append(s);
  }), src);
}

async function runSuites(browserType, origin, results) {
  const browser = await browserType.launch();
  const log = { external: [], errors: [] };
  try {
    const { page } = await openPage(browser, origin, '/tests/browser-regression.html', log);
    const suites = await page.$$eval('[data-suite]', buttons => buttons.map(b => b.dataset.suite));
    for (const suite of suites.filter(s => !args.suite || s === args.suite)) {
      const started = Date.now();
      await page.click(`[data-suite="${suite}"]`);
      await page.waitForFunction(() => /^(PASS|FAIL)/.test(document.getElementById('result').textContent), null, { timeout: SUITE_TIMEOUT })
        .catch(() => {});
      const text = await page.textContent('#result');
      const pass = text.startsWith('PASS');
      results.push({ browser: browserType.name(), suite, pass, checks: pass ? Number(text.match(/(\d+) checks/)[1]) : 0,
        detail: pass ? '' : (text.startsWith('FAIL') ? text : 'timed out: ' + text).slice(0, 1200), seconds: (Date.now() - started) / 1000 });
      const r = results.at(-1);
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.browser.padEnd(8)} ${suite.padEnd(28)} ${r.pass ? r.checks + ' checks' : ''} (${r.seconds.toFixed(1)} s)${r.pass ? '' : '\n      ' + r.detail.replace(/\n/g, '\n      ')}`);
    }
  } finally { await browser.close(); }
  return log;
}

async function referenceStep(origin, results) {
  const browser = await chromium.launch();
  const log = { external: [], errors: [] };
  try {
    const { page } = await openPage(browser, origin, '/?test=reference-' + Date.now(), log);
    await page.waitForFunction(() => document.getElementById('app-version')?.textContent);
    await injectScripts(page, ['node_modules/pdfjs-dist/build/pdf.min.js', 'tests/reference-figure.js', 'tests/reference-check.js']);
    await page.evaluate(() => { pdfjsLib.GlobalWorkerOptions.workerSrc = 'node_modules/pdfjs-dist/build/pdf.worker.min.js'; });
    if (args['make-reference']) {
      const out = await page.evaluate(() => makeReferenceOutputs());
      const dir = join(ROOT, 'tests', 'fixtures');
      await writeFile(join(dir, 'reference.mfcproj.zip'), Buffer.from(out.archive, 'base64'));
      await writeFile(join(dir, 'reference.svg'), out.svg);
      await writeFile(join(dir, 'reference.tif'), Buffer.from(out.tif, 'base64'));
      await writeFile(join(dir, 'reference.pdf'), Buffer.from(out.pdf, 'base64'));
      console.log('Wrote tests/fixtures/reference.mfcproj.zip, reference.svg, reference.tif and reference.pdf');
      return log;
    }
    const started = Date.now();
    try {
      const checks = await page.evaluate(() => runReferenceCheck());
      results.push({ browser: 'chromium', suite: 'reference-exports', pass: true, checks: checks.length, seconds: (Date.now() - started) / 1000 });
      console.log(`PASS  chromium reference-exports             ${checks.length} checks\n      ${checks.join('\n      ')}`);
    } catch (error) {
      results.push({ browser: 'chromium', suite: 'reference-exports', pass: false, checks: 0, detail: error.message, seconds: (Date.now() - started) / 1000 });
      console.log(`FAIL  chromium reference-exports\n      ${error.message}`);
    }
  } finally { await browser.close(); }
  return log;
}

/** Node step: one version everywhere (`npm run release -- --check`), the release script's tests and the docs' links. */
function releaseStep(results) {
  const started = Date.now();
  try {
    const version = checkVersion(ROOT);
    if (version.wrong.length) throw new Error(describeMismatch(version));
    const checks = runReleaseRegressions();
    results.push({ browser: 'node', suite: 'release-regression', pass: true, checks: checks.length, seconds: (Date.now() - started) / 1000 });
    console.log(`PASS  node     ${'release-regression'.padEnd(28)} ${checks.length} checks (version ${version.version})`);
  } catch (error) {
    results.push({ browser: 'node', suite: 'release-regression', pass: false, checks: 0, detail: error.message, seconds: (Date.now() - started) / 1000 });
    console.log(`FAIL  node     release-regression\n      ${error.message.replace(/\n/g, '\n      ')}`);
  }
}

const server = await startServer();
const origin = 'http://127.0.0.1:' + server.address().port;
let exitCode = 0;
try {
  generateFixtures();
  const results = [], logs = [];
  if (!args['make-reference'] && !args.suite && !args['reference-only']) releaseStep(results);
  if (args['make-reference']) logs.push(await referenceStep(origin, results));
  else {
    const browsers = [chromium, firefox].filter(b => !args.browser || b.name() === args.browser);
    if (!args['reference-only']) for (const browserType of browsers) logs.push(await runSuites(browserType, origin, results));
    if (!args['skip-reference'] && !args.suite && (!args.browser || args.browser === 'chromium')) logs.push(await referenceStep(origin, results));
  }
  const external = [...new Set(logs.flatMap(l => l.external))];
  const errors = [...new Set(logs.flatMap(l => l.errors))];
  const failed = results.filter(r => !r.pass);
  if (!args['make-reference']) {
    console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} suite runs passed, ${results.reduce((n, r) => n + r.checks, 0)} checks` +
      ` (${[...new Set(results.map(r => r.browser))].join(', ')})`);
    console.log(`Requests to other origins: ${external.length}` + external.map(u => '\n  ' + u).join(''));
    if (errors.length) console.log(`Console errors (${errors.length}):` + errors.slice(0, 20).map(e => '\n  ' + e).join(''));
  }
  if (failed.length || external.length) exitCode = 1;
} catch (error) {
  console.error(error); exitCode = 1;
} finally { server.close(); }
process.exit(exitCode);

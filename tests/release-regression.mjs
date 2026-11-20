// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* Node checks run by `npm test` before the browser suites (and alone with `node tests/release-regression.mjs`):
   - scripts/release.mjs on a throwaway copy of the files it edits: bump, idempotence, CHANGELOG
     dating, refusals that change nothing, and --check on a mismatch;
   - the real repository has one version everywhere;
   - every relative link in README, CONTRIBUTING, CHANGELOG, the manual and PROJECT-FORMAT leads to an existing file
     and heading, the README stays short, and CONTRIBUTING lists every browser suite. */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readVersion, findCopies, check, release } from '../scripts/release.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDITED = ['js/core/state.js', 'index.html', 'package.json', 'package-lock.json', 'CHANGELOG.md'];

export function runReleaseRegressions() {
  const checks = [];
  const assert = (name, ok, detail = '') => { if (!ok) throw new Error(name + (detail ? ': ' + detail : '')); checks.push(name); };
  const throwsMessage = fn => { try { fn(); return ''; } catch (e) { return e.message; } };

  // --- The real repository -------------------------------------------------------------------
  const real = check(ROOT);
  assert('The repository has one version everywhere', real.wrong.length === 0, real.wrong.map(c => `${c.file}:${c.line} ${c.value}`).join(', '));
  const realCopies = findCopies(ROOT);
  assert('Every ?v= in index.html, package.json and both package-lock.json fields are tracked',
    realCopies.filter(c => c.file === 'index.html').length === (readFileSync(join(ROOT, 'index.html'), 'utf8').match(/\?v=/g) || []).length &&
    realCopies.filter(c => c.file === 'package-lock.json').length === 2 && realCopies.some(c => c.file === 'package.json'));
  assert('The vendored libraries are not cache-busted', !realCopies.some(c => c.what.startsWith('assets/vendor/')));
  assert('The version constant is the only hand-written copy', readVersion(ROOT) === JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);

  // --- The script on a copy ------------------------------------------------------------------
  const dir = mkdtempSync(join(tmpdir(), 'fluoforge-release-'));
  try {
    for (const file of EDITED) { mkdirSync(dirname(join(dir, file)), { recursive: true }); copyFileSync(join(ROOT, file), join(dir, file)); }
    const snapshot = () => Object.fromEntries(EDITED.map(f => [f, readFileSync(join(dir, f), 'utf8')]));
    const changedLines = (a, b) => { const x = a.split('\n'), y = b.split('\n'); return x.length === y.length ? x.filter((l, i) => l !== y[i]).length : -1; };
    const cli = (...args) => spawnSync(process.execPath, [join(ROOT, 'scripts/release.mjs'), '--root=' + dir, ...args], { encoding: 'utf8' });

    // Give the copy release notes to date.
    const log0 = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8').replace(/\n## Unreleased\n[\s\S]*?(?=\n## v)/, '\n## Unreleased\n\n- A test note.\n');
    writeFileSync(join(dir, 'CHANGELOG.md'), log0);
    const before = snapshot();

    let message = throwsMessage(() => release(dir, '1.2'));
    assert('A malformed version is refused', /not a version/.test(message), message);
    assert('…and changes nothing', JSON.stringify(snapshot()) === JSON.stringify(before));

    const result = release(dir, '9.8.7', { today: '2030-01-02' });
    const after = snapshot();
    assert('A bump writes the new constant', readVersion(dir) === '9.8.7');
    assert('A bump updates every copy', check(dir).wrong.length === 0 && findCopies(dir).every(c => c.value === '9.8.7'));
    assert('A bump reports the five files it changed', result.changed.length === 5, result.changed.join(', '));
    assert('index.html: only the versioned lines change', changedLines(before['index.html'], after['index.html']) === findCopies(dir).filter(c => c.file === 'index.html').length);
    assert('index.html: the vendored script tags are untouched',
      (before['index.html'].match(/src="assets\/vendor\/[^"]+"/g) || []).join() === (after['index.html'].match(/src="assets\/vendor\/[^"]+"/g) || []).join());
    assert('package.json: only the version line changes', changedLines(before['package.json'], after['package.json']) === 1);
    assert('package-lock.json: only its two version lines change', changedLines(before['package-lock.json'], after['package-lock.json']) === 2);
    assert('package-lock.json stays valid JSON with the new version', (() => { const l = JSON.parse(after['package-lock.json']); return l.version === '9.8.7' && l.packages[''].version === '9.8.7'; })());
    assert('js/core/state.js: only the constant changes', changedLines(before['js/core/state.js'], after['js/core/state.js']) === 1);
    assert('CHANGELOG: the Unreleased notes become the dated release',
      /\n## Unreleased\n\n## v9\.8\.7 \(2030-01-02\)\n\n- A test note\.\n\n## v/.test(after['CHANGELOG.md']));
    assert('CHANGELOG: the older releases are unchanged',
      after['CHANGELOG.md'].slice(after['CHANGELOG.md'].indexOf('\n## v', after['CHANGELOG.md'].indexOf('9.8.7') + 5)) ===
      before['CHANGELOG.md'].slice(before['CHANGELOG.md'].indexOf('\n## v')));

    assert('Running it again changes nothing', release(dir).changed.length === 0 && JSON.stringify(snapshot()) === JSON.stringify(after));
    message = throwsMessage(() => release(dir, '9.9.0'));
    assert('An empty Unreleased section is refused, and nothing changes', /Unreleased" is empty/.test(message) && JSON.stringify(snapshot()) === JSON.stringify(after), message);
    writeFileSync(join(dir, 'CHANGELOG.md'), after['CHANGELOG.md'].replace('## Unreleased\n', '## Unreleased\n\n- Note.\n'));
    writeFileSync(join(dir, 'js/core/state.js'), after['js/core/state.js'].replace("'9.8.7'", "'9.8.6'"));
    message = throwsMessage(() => release(dir, '9.8.7'));
    assert('A version already in the CHANGELOG is refused', /already has a v9\.8\.7/.test(message), message);
    writeFileSync(join(dir, 'CHANGELOG.md'), after['CHANGELOG.md']);
    writeFileSync(join(dir, 'js/core/state.js'), after['js/core/state.js']);

    // A hand edit is caught, by the function and by the command line.
    writeFileSync(join(dir, 'index.html'), after['index.html'].replace('js/tiff.js?v=9.8.7', 'js/tiff.js?v=0.0.1'));
    const wrong = check(dir).wrong;
    const tiffLine = after['index.html'].split('\n').findIndex(l => l.includes('js/tiff.js?v=')) + 1;
    assert('--check names the file and line of a copy that differs', wrong.length === 1 && wrong[0].file === 'index.html' && wrong[0].line === tiffLine && wrong[0].value === '0.0.1');
    let run = cli('--check');
    assert('npm run release -- --check exits 1 on a mismatch', run.status === 1 && run.stderr.includes(`index.html:${tiffLine}`) && run.stderr.includes('npm run release'), run.stderr);
    assert('--check changes nothing', readFileSync(join(dir, 'index.html'), 'utf8').includes('js/tiff.js?v=0.0.1'));
    run = cli();
    assert('npm run release repairs it', run.status === 0 && check(dir).wrong.length === 0 && readFileSync(join(dir, 'index.html'), 'utf8') === after['index.html'], run.stderr);
    run = cli('--check');
    assert('npm run release -- --check exits 0 when everything matches', run.status === 0 && /all \d+ copies match/.test(run.stdout), run.stdout + run.stderr);

    writeFileSync(join(dir, 'index.html'), after['index.html'].replace('</body>', '<script defer src="js/new-feature.js"></script>\n</body>'));
    assert('A new local script without ?v= is reported', check(dir).wrong.some(c => c.what.startsWith('js/new-feature.js') && c.value === '(none)'));
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // --- Documentation -------------------------------------------------------------------------
  const slug = heading => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
  const anchors = file => new Set(readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').split('\n').filter(l => /^#{1,6} /.test(l)).map(l => slug(l.replace(/^#+ /, ''))));
  const docs = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'docs/MANUAL.md', 'docs/PROJECT-FORMAT.md'];
  let links = 0;
  for (const doc of docs) {
    const text = readFileSync(join(ROOT, doc), 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    const targets = [...text.matchAll(/\]\(([^)\s]+)\)/g), ...text.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(t => !/^(https?:|mailto:)/.test(t));
    for (const target of targets) {
      const [path, hash] = target.split('#');
      const file = path ? resolve(dirname(join(ROOT, doc)), path) : join(ROOT, doc);
      if (!existsSync(file)) throw new Error(`${doc}: link "${target}" leads to no file`);
      if (hash && !anchors(file).has(hash)) throw new Error(`${doc}: link "${target}" leads to no heading`);
      links++;
    }
  }
  checks.push(`Every relative link leads to an existing file and heading (${links} links in ${docs.length} documents)`);

  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const sections = readme.split('\n').filter(l => /^##+ /.test(l)).map(l => l.replace(/^#+ /, ''));
  assert('The README keeps only the quick start, contributing and licence sections', sections.join('|') === 'Quick start|Run it locally|Contributing|Licence', sections.join(', '));
  assert('The README has the live link, a screenshot and the manual link',
    readme.includes('https://remybonnav.github.io/FluoForge/') && /!\[[^\]]+\]\(docs\/images\/[^)]+\)/.test(readme) && readme.includes('(docs/MANUAL.md)'));
  assert('The README is short', readme.split('\n').length <= 60, readme.split('\n').length + ' lines');

  const contributing = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8');
  const suites = [...readFileSync(join(ROOT, 'tests/browser-regression.html'), 'utf8').matchAll(/data-suite="([^"]+)"/g)].map(m => m[1]);
  const missing = suites.filter(s => !contributing.includes('| `' + s + '` |'));
  assert('CONTRIBUTING lists every browser suite', missing.length === 0, missing.join(', '));
  assert('CONTRIBUTING has the test and release instructions',
    ['npm ci', 'npx playwright install chromium firefox', 'npm test', 'npm run make-reference', 'npm run release -- --check', 'npm run release -- 0.1.5'].every(s => contributing.includes(s)));

  // The site publishes only the paths the Pages workflow copies: every file the app links to must be among them.
  const pages = readFileSync(join(ROOT, '.github/workflows/pages.yml'), 'utf8');
  const published = ((pages.match(/cp -r ([^\n]+) _site\//) || [])[1] || '').split(/\s+/);
  const linked = [...readFileSync(join(ROOT, 'js/image/import.js'), 'utf8').matchAll(/CONVERSION_MACRO = '([^']+)'/g)].map(m => m[1]);
  const unpublished = linked.filter(path => !published.includes(path.split('/')[0]) || !existsSync(join(ROOT, path)));
  assert('The Pages workflow publishes the files the app links to (the Fiji macro)', linked.length === 1 && unpublished.length === 0,
    unpublished.join(', ') || 'no CONVERSION_MACRO found');

  const manual = readFileSync(join(ROOT, 'docs/MANUAL.md'), 'utf8');
  assert('The feature details moved from the README are in the manual',
    ['`manifest.json`', 'pure ImageJ channel colours', 'not allowed in file names', 'read from its label', 'Which panels are collapsed is remembered',
      'Inset outline, Text and Scale bar panels edit every selected object', 'do not become project versions'].every(s => manual.includes(s)));
  return checks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const checks = runReleaseRegressions(); console.log(`PASS ${checks.length} checks\n  ` + checks.join('\n  ')); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

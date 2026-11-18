// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* Version bookkeeping (`npm run release`).

   The version is written in one place: `MFC_VERSION` in js/core/state.js. Everything else is copied
   from it by this script and never edited by hand:
     - the `?v=` cache-busting query strings in index.html,
     - "version" in package.json and package-lock.json.

   npm run release                   copy the current MFC_VERSION everywhere
   npm run release -- 0.1.5          set MFC_VERSION to 0.1.5, copy it everywhere, and turn the
                                     CHANGELOG's "## Unreleased" notes into "## v0.1.5 (<today>)"
   npm run release -- --check        change nothing; exit 1 and list every copy that differs
                                     (npm test runs this first)

   Options: --root=<dir> works on another copy of the repository (used by the tests). */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const VERSION_FILE = 'js/core/state.js';
const VERSION_RE = /(export const MFC_VERSION = ')([^']*)(';)/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/* Stylesheet and script references in index.html that carry a `?v=` query. The vendored libraries
   in assets/vendor/ have none: their file names are pinned in VERSIONS.md and never change. */
const ASSET_RE = /((?:href|src)="[^"?#]+\.(?:css|js|mjs))\?v=([^"#]*)(")/g;
const UNVERSIONED_RE = /<(?:script|link)\b[^>]*?(?:href|src)="(?!https?:|\/\/|data:|assets\/vendor\/)([^"?#]+\.(?:css|js|mjs))"/g;

const read = (root, file) => readFileSync(join(root, file), 'utf8');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

export function readVersion(root) {
  const match = read(root, VERSION_FILE).match(VERSION_RE);
  if (!match) throw new Error(`${VERSION_FILE}: no "export const MFC_VERSION = '…';" line`);
  return match[2];
}

/** Every place that must carry the version, with what it carries now. */
export function findCopies(root) {
  const copies = [];
  const html = read(root, 'index.html');
  for (const m of html.matchAll(ASSET_RE)) copies.push({ file: 'index.html', line: lineOf(html, m.index), what: m[1].replace(/^(href|src)="/, ''), value: m[2] });
  // A new local script or stylesheet must get a `?v=` too, or browsers keep serving the old copy.
  for (const m of html.matchAll(UNVERSIONED_RE)) copies.push({ file: 'index.html', line: lineOf(html, m.index), what: m[1] + ' (add ?v=)', value: '(none)' });
  const pkgText = read(root, 'package.json');
  copies.push({ file: 'package.json', line: lineOf(pkgText, pkgText.indexOf('"version"')), what: 'version', value: JSON.parse(pkgText).version });
  const lockText = read(root, 'package-lock.json'), lock = JSON.parse(lockText);
  const [top, inner] = lockVersionLines(lockText.split('\n'));
  copies.push({ file: 'package-lock.json', line: top + 1, what: 'version', value: lock.version });
  copies.push({ file: 'package-lock.json', line: inner + 1, what: 'packages[""].version', value: lock.packages?.['']?.version });
  return copies;
}

export function check(root) {
  const version = readVersion(root);
  const wrong = findCopies(root).filter(c => c.value !== version);
  return { version, wrong };
}

/** Writes `version` (or the current one) everywhere. Returns the list of files changed.
    Every new text is computed first, so an error (bad version, CHANGELOG not ready) changes nothing. */
export function release(root, newVersion = null, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (newVersion !== null && !SEMVER_RE.test(newVersion)) throw new Error(`"${newVersion}" is not a version like 1.2.3`);
  const current = readVersion(root);
  const version = newVersion ?? current;
  const texts = {};

  texts[VERSION_FILE] = read(root, VERSION_FILE).replace(VERSION_RE, `$1${version}$3`);
  texts['index.html'] = read(root, 'index.html').replace(ASSET_RE, (all, ref, old, quote) => `${ref}?v=${version}${quote}`);
  // Only the "version" fields change; the rest of each file keeps its formatting.
  texts['package.json'] = read(root, 'package.json').replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
  const lockLines = read(root, 'package-lock.json').split('\n');
  for (const i of lockVersionLines(lockLines)) lockLines[i] = lockLines[i].replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
  texts['package-lock.json'] = lockLines.join('\n');

  if (newVersion !== null && newVersion !== current) {
    const log = read(root, 'CHANGELOG.md');
    if (log.includes(`\n## v${version} `)) throw new Error(`CHANGELOG.md already has a v${version} section`);
    const unreleased = log.match(/\n## Unreleased\n([\s\S]*?)(?=\n## )/);
    if (!unreleased) throw new Error('CHANGELOG.md has no "## Unreleased" section');
    if (!unreleased[1].trim()) throw new Error('CHANGELOG.md: "## Unreleased" is empty; describe the release there first');
    texts['CHANGELOG.md'] = log.replace(unreleased[0], `\n## Unreleased\n\n## v${version} (${today})\n\n${unreleased[1].trim()}\n`);
  }

  const changed = Object.keys(texts).filter(file => read(root, file) !== texts[file]);
  for (const file of changed) writeFileSync(join(root, file), texts[file]);
  const after = check(root);
  if (after.wrong.length) throw new Error(describeMismatch(after).replace(/\nRun .*$/, '\nThese need a hand edit first.'));
  return { version, changed };
}

/** Line indexes of the lock file's own "version" (top level) and of packages[""].version. */
function lockVersionLines(lines) {
  const top = lines.findIndex(l => /^ {2}"version":/.test(l));
  const rootPackage = lines.findIndex(l => /^\s*"":\s*\{/.test(l));
  const inner = rootPackage < 0 ? -1 : lines.findIndex((l, i) => i > rootPackage && /"version":/.test(l));
  return [top, inner].filter(i => i >= 0);
}

export function describeMismatch({ version, wrong }) {
  return `Version mismatch: ${VERSION_FILE} says ${version}, but\n` +
    wrong.map(c => `  ${c.file}:${c.line}  ${c.what}  has ${c.value}`).join('\n') +
    '\nRun `npm run release` to copy the version everywhere.';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootArg = args.find(a => a.startsWith('--root='));
  const root = rootArg ? resolve(rootArg.slice(7)) : join(dirname(fileURLToPath(import.meta.url)), '..');
  const positional = args.filter(a => !a.startsWith('--'));
  try {
    if (args.includes('--check')) {
      const result = check(root);
      if (result.wrong.length) { console.error(describeMismatch(result)); process.exit(1); }
      console.log(`Version ${result.version}: all ${findCopies(root).length} copies match.`);
    } else {
      const { version, changed } = release(root, positional[0] ?? null);
      console.log(changed.length ? `Version ${version}: updated ${changed.join(', ')}.` : `Version ${version}: everything already matches.`);
    }
  } catch (error) { console.error(error.message); process.exit(1); }
}

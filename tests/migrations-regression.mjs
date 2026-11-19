// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* Node checks run by `npm test` before the browser suites (alone: `node tests/migrations-regression.mjs`):
   - every migration in js/migrations/ alone, as the pure JSON function it must be;
   - the chain: one migration per schema step from 0 to CURRENT_SCHEMA, each file registered, none
     missing (so deleting any migration fails), and the same schema in js/project.js;
   - the fixture library: every release in CHANGELOG.md, and the current version, has a fixture in
     tests/compat/ with its project, expected.json and export.svg, and the index lists every folder;
   - the format lock: serializeObject, restoreObject and captureState are unchanged since
     tests/compat/format-lock.json was recorded.
   `node tests/migrations-regression.mjs --update-lock` records the lock again; do it only when the
   saved format did not change, and say why in the pull request. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = join(ROOT, 'tests/compat/format-lock.json');
const LOCKED_FUNCTIONS = ['serializeObject', 'restoreObject', 'captureState'];

/** Source text of `function name(` … matching `}` in js/project.js (strings and comments skipped). */
export function functionSource(text, name) {
  const start = text.search(new RegExp(`(async\\s+)?function ${name}\\(`));
  if (start < 0) throw new Error(`js/project.js has no function ${name}`);
  let depth = 0, i = text.indexOf('{', text.indexOf(')', start)), quote = null;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`Cannot find the end of ${name}`);
}

export function currentLock() {
  const project = readFileSync(join(ROOT, 'js/project.js'), 'utf8');
  const schema = Number((project.match(/const SCHEMA = (\d+);/) || [])[1]);
  const functions = Object.fromEntries(LOCKED_FUNCTIONS.map(name => [name, createHash('sha256').update(functionSource(project, name)).digest('hex')]));
  return { schema, functions };
}

export async function runMigrationRegressions() {
  const checks = [];
  const assert = (name, ok, detail = '') => { if (!ok) throw new Error(name + (detail ? ': ' + detail : '')); checks.push(name); };
  const throwsMessage = fn => { try { fn(); return ''; } catch (e) { return e.message; } };
  const deepFrozen = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(deepFrozen); } return value; };

  const chain = await import(pathToFileURL(join(ROOT, 'js/migrations/index.js')).href);
  const { CURRENT_SCHEMA, MIGRATIONS, migrateState, migrateWith } = chain;

  // --- The chain ---------------------------------------------------------------------------
  const project = readFileSync(join(ROOT, 'js/project.js'), 'utf8');
  assert('js/project.js writes the current schema', Number((project.match(/const SCHEMA = (\d+);/) || [])[1]) === CURRENT_SCHEMA);
  for (let schema = 0; schema < CURRENT_SCHEMA; schema++) {
    const steps = MIGRATIONS.filter(m => m.from === schema);
    assert(`Exactly one migration from schema ${schema} to ${schema + 1}`, steps.length === 1 && steps[0].to === schema + 1 && steps[0].file === `schema-${schema}-to-${schema + 1}.js`);
  }
  const files = readdirSync(join(ROOT, 'js/migrations')).filter(f => /^schema-\d+-to-\d+\.js$/.test(f));
  assert('Every migration file is registered, and every registered migration has its file',
    files.sort().join() === MIGRATIONS.map(m => m.file).sort().join(), `files: ${files.join(', ')}`);
  assert('Every registered migration is the function its file exports', await (async () => {
    for (const m of MIGRATIONS) if ((await import(pathToFileURL(join(ROOT, 'js/migrations', m.file)).href)).migrate !== m.migrate) return false;
    return true;
  })());
  for (const m of MIGRATIONS) {
    const removed = MIGRATIONS.filter(x => x !== m);
    const message = throwsMessage(() => migrateWith({ schema: m.from, objects: [] }, removed, CURRENT_SCHEMA));
    assert(`Without ${m.file}, a schema-${m.from} project cannot be opened`, message.includes(`No migration from project format ${m.from}`), message);
  }
  const current = deepFrozen({ schema: CURRENT_SCHEMA, docProps: { name: 'x' }, objects: [{ type: 'rect' }] });
  const same = migrateState(current);
  assert('A current state is returned as it is', same.state === current && same.applied.length === 0 && !same.newer);
  const newer = deepFrozen({ schema: CURRENT_SCHEMA + 3, objects: [{ type: 'hologram' }], futureField: 1 });
  const newerResult = migrateState(newer);
  assert('A newer state is returned unchanged and flagged', newerResult.state === newer && newerResult.newer && newerResult.from === CURRENT_SCHEMA + 3);
  assert('A state without a schema field is schema 1', migrateState(deepFrozen({ objects: [] })).from === 1);
  const bad = [{ from: 0, to: 1, file: 'bad.js', migrate: s => ({ ...s }) }];
  assert('A migration that does not set the new schema is refused', /did not produce format 1/.test(throwsMessage(() => migrateWith({ schema: 0, objects: [] }, bad, 1))));

  // --- schema-0-to-1.js alone ---------------------------------------------------------------
  const { migrate: m01 } = await import(pathToFileURL(join(ROOT, 'js/migrations/schema-0-to-1.js')).href);
  const legacy = deepFrozen({
    schema: 0, docProps: { name: 'Legacy', width: 800, height: 600, unit: 'px', dpi: 300 }, nextId: 9,
    objects: [
      { type: 'image', mfcType: 'mfcImage', mfcId: 'img', width: 400, height: 300, cropX: 10, cropY: 20, sourceId: 'src-x' },
      { type: 'group', mfcType: 'scalebar', mfcId: 'bar', objects: [{ type: 'rect' }, { type: 'text', text: '20 µm' }] },
      { type: 'group', mfcType: 'scalebar', mfcId: 'barComma', objects: [{ type: 'text', text: '12,5 µm' }] },
      { type: 'group', mfcType: 'scalebar', mfcId: 'barKnown', mfcLengthUm: 7, objects: [{ type: 'text', text: '99 µm' }] },
      { type: 'group', mfcType: 'scalebar', mfcId: 'barNoLabel', objects: [{ type: 'rect' }] },
      { type: 'group', mfcType: 'group', mfcId: 'grp', objects: [{ type: 'group', mfcType: 'scalebar', mfcId: 'nestedBar', objects: [{ type: 'text', text: '5 µm' }] }] },
      { type: 'rect', mfcType: 'insetContour', mfcId: 'outline', mfcInsetSourceId: 'img', mfcRelX: 0.25, mfcRelY: 0.5, mfcRelW: 0.1, mfcRelH: 0.2 },
      { type: 'rect', mfcType: 'insetContour', mfcId: 'outlinePx', mfcInsetSourceId: 'img', mfcCropX: 1, mfcCropY: 2, mfcCropW: 3, mfcCropH: 4, mfcRelX: 0.9 },
      { type: 'rect', mfcType: 'insetContour', mfcId: 'orphan', mfcInsetSourceId: 'gone', mfcRelX: 0.5 }
    ]
  });
  const migrated = m01(legacy);
  const byId = id => { let found; const walk = list => list.forEach(o => { if (o.mfcId === id) found = o; if (o.objects) walk(o.objects); }); walk(migrated.objects); return found; };
  assert('0→1: the result is schema 1, and the input is not modified', migrated.schema === 1 && legacy.schema === 0 && migrated !== legacy);
  assert('0→1: a scale bar without a length gets it from its label', byId('bar').mfcLengthUm === 20);
  assert('0→1: a decimal comma in the label is read', byId('barComma').mfcLengthUm === 12.5);
  assert('0→1: a known length is kept, a bar without a label is left alone', byId('barKnown').mfcLengthUm === 7 && !('mfcLengthUm' in byId('barNoLabel')));
  assert('0→1: a scale bar inside a group is migrated too', byId('nestedBar').mfcLengthUm === 5);
  const outline = byId('outline');
  assert('0→1: an inset outline in fractions gets its region in source pixels (crop offset included)',
    outline.mfcCropX === 10 + 0.25 * 400 && outline.mfcCropY === 20 + 0.5 * 300 && Math.abs(outline.mfcCropW - 40) < 1e-9 && Math.abs(outline.mfcCropH - 60) < 1e-9);
  assert('0→1: an outline already in pixels, and one whose image is gone, are left alone',
    byId('outlinePx').mfcCropX === 1 && byId('outlinePx').mfcCropW === 3 && !('mfcCropX' in byId('orphan')));
  assert('0→1: everything else is copied unchanged', JSON.stringify({ ...migrated, schema: 0, objects: null }) === JSON.stringify({ ...legacy, objects: null }) &&
    JSON.stringify(migrated.objects[0]) === JSON.stringify(legacy.objects[0]));
  assert('0→1: running the chain from schema 0 applies it first', migrateState(legacy).applied[0] === 'schema-0-to-1.js' && migrateState(legacy).state.schema === CURRENT_SCHEMA);
  // --- schema-1-to-2.js alone ---------------------------------------------------------------
  const { migrate: m12 } = await import(pathToFileURL(join(ROOT, 'js/migrations/schema-1-to-2.js')).href);
  const image = (id, channels) => ({ type: 'image', mfcType: 'mfcImage', mfcId: id, sourceId: 'src-x', display: { channels, brightness: 0, contrast: 0 } });
  const v1 = deepFrozen({ schema: 1, docProps: { name: 'One' }, nextId: 4, objects: [
    image('a', [{ enabled: true, color: 'grey', min: 0, max: 255, name: 'Ch 1' }, { enabled: false, color: 'red', min: 5, max: 90, name: 'Ch 2' }]),
    { type: 'group', mfcType: 'group', mfcId: 'g', objects: [image('b', [{ enabled: true, color: 'green', min: 1, max: 2, name: 'G' }])] },
    { ...image('c', [{ enabled: true, color: 'blue', min: 0, max: 9, name: 'B', gamma: 2.5, invert: true }]), clipPath: { type: 'ellipse' } },
    { type: 'textbox', mfcType: 'text', mfcId: 't', text: 'x' }
  ] });
  const v2 = m12(v1);
  const channelsOf = id => { let found; walkAll(v2.objects, o => { if (o.mfcId === id) found = o.display.channels; }); return found; };
  function walkAll(list, visit) { list.forEach(o => { visit(o); if (o.objects) walkAll(o.objects, visit); }); }
  assert('1→2: the result is schema 2, and the input is not modified', v2.schema === 2 && v1.schema === 1 && !('gamma' in v1.objects[0].display.channels[0]));
  assert('1→2: every image channel gets gamma 1 and invert false', channelsOf('a').every(c => c.gamma === 1 && c.invert === false));
  assert('1→2: images inside groups are migrated too', channelsOf('b')[0].gamma === 1 && channelsOf('b')[0].invert === false);
  assert('1→2: values already set are kept', channelsOf('c')[0].gamma === 2.5 && channelsOf('c')[0].invert === true);
  assert('1→2: the other channel settings and objects are unchanged',
    JSON.stringify(channelsOf('a').map(({ gamma, invert, ...rest }) => rest)) === JSON.stringify(v1.objects[0].display.channels) &&
    JSON.stringify(v2.objects[3]) === JSON.stringify(v1.objects[3]) && JSON.stringify(v2.docProps) === JSON.stringify(v1.docProps));
  assert('0→2: a legacy state runs both migrations', migrateState(legacy).applied.join() === 'schema-0-to-1.js,schema-1-to-2.js' && migrateState(legacy).state.schema === 2);

  assert('Migrations use no browser objects', !/\b(window|document|fabric|MFC\w*)\b/.test(files.map(f => readFileSync(join(ROOT, 'js/migrations', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n')));

  // --- The fixture library ------------------------------------------------------------------
  const index = JSON.parse(readFileSync(join(ROOT, 'tests/compat/index.json'), 'utf8'));
  const folders = readdirSync(join(ROOT, 'tests/compat'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  assert('The fixture index lists exactly the folders in tests/compat', folders.sort().join() === index.fixtures.map(f => f.name).sort().join(),
    `folders: ${folders.join(', ')}`);
  for (const fixture of index.fixtures) {
    const dir = join(ROOT, 'tests/compat', fixture.name);
    const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
    if (!(existsSync(join(dir, expected.project)) && existsSync(join(dir, 'export.svg')) && expected.summary?.objectCount >= 1))
      throw new Error(`tests/compat/${fixture.name} needs its project, a non-empty expected.json and export.svg`);
    if (fixture.kind === 'release' && expected.recordedBy?.appVersion !== fixture.name.slice(1))
      throw new Error(`tests/compat/${fixture.name} was recorded by FluoForge ${expected.recordedBy?.appVersion}, not by ${fixture.name}`);
  }
  checks.push(`Every fixture has its project, expected.json and export.svg (${index.fixtures.length})`);
  const releases = [...readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').matchAll(/^## v(\d+\.\d+\.\d+)/gm)].map(m => m[1]);
  const version = (readFileSync(join(ROOT, 'js/core/state.js'), 'utf8').match(/MFC_VERSION = '([^']+)'/) || [])[1];
  const missing = [...new Set([...releases, version])].filter(v => !index.fixtures.some(f => f.kind === 'release' && f.name === 'v' + v));
  assert(`Every release in CHANGELOG.md and the current version (${version}) has a fixture saved by that version`, missing.length === 0,
    `missing: ${missing.join(', ')}. Run npm run compat-fixture -- --ref=worktree before releasing.`);

  // --- The format lock ----------------------------------------------------------------------
  const lock = JSON.parse(readFileSync(LOCK, 'utf8')), now = currentLock();
  assert('The format lock is recorded for the current schema', lock.schema === CURRENT_SCHEMA,
    `the lock says schema ${lock.schema}; after a migration, record it again with node tests/migrations-regression.mjs --update-lock`);
  const changed = LOCKED_FUNCTIONS.filter(name => lock.functions[name] !== now.functions[name]);
  assert('serializeObject, restoreObject and captureState are unchanged since the format lock', changed.length === 0,
    `${changed.join(', ')} changed. If the saved format changed, bump the schema and add a migration in js/migrations/. ` +
    `If it did not, run node tests/migrations-regression.mjs --update-lock and explain in the pull request why no migration is needed`);
  return checks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--update-lock')) {
    const lock = { about: 'Hashes of the functions that define the saved format (tests/migrations-regression.mjs). Changing one needs a migration, or an explanation in the pull request and node tests/migrations-regression.mjs --update-lock.', ...currentLock() };
    writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
    console.log('Recorded tests/compat/format-lock.json for schema ' + lock.schema);
  } else {
    try { const checks = await runMigrationRegressions(); console.log(`PASS ${checks.length} checks\n  ` + checks.join('\n  ')); }
    catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
  }
}

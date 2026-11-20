/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Project format migrations. `state.schema` is the format version of a saved figure state
   (docs/PROJECT-FORMAT.md). Every format change bumps CURRENT_SCHEMA and adds exactly one
   migration here, from the previous schema to the new one; loading runs the chain from the
   file's schema up to CURRENT_SCHEMA. Migrations are pure functions on plain JSON, so they can be
   tested alone (tests/migrations-regression.mjs). Never delete or edit a released migration. */
import { migrate as schema0to1 } from './schema-0-to-1.js';
import { migrate as schema1to2 } from './schema-1-to-2.js';
import { migrate as schema2to3 } from './schema-2-to-3.js';
import { migrate as schema3to4 } from './schema-3-to-4.js';
import { migrate as schema4to5 } from './schema-4-to-5.js';

export const CURRENT_SCHEMA = 5;

export const MIGRATIONS = [
  { from: 0, to: 1, file: 'schema-0-to-1.js', migrate: schema0to1 },
  { from: 1, to: 2, file: 'schema-1-to-2.js', migrate: schema1to2 },
  { from: 2, to: 3, file: 'schema-2-to-3.js', migrate: schema2to3 },
  { from: 3, to: 4, file: 'schema-3-to-4.js', migrate: schema3to4 },
  { from: 4, to: 5, file: 'schema-4-to-5.js', migrate: schema4to5 }
];

/** States written before the schema field was checked always said 1; a missing schema means 1. */
export const schemaOf = state => (Number.isInteger(state?.schema) ? state.schema : 1);

/**
 * Brings `state` up to CURRENT_SCHEMA. Returns { state, from, to, applied, newer }.
 * The input is never modified. A state from a newer format (schema > CURRENT_SCHEMA) is returned
 * unchanged with `newer: true`: this version loads what it understands and keeps the rest.
 */
export const migrateState = state => migrateWith(state, MIGRATIONS, CURRENT_SCHEMA);

/** The chain itself, with the list of migrations as a parameter so a gap can be tested. */
export function migrateWith(state, migrations, current) {
  const from = schemaOf(state);
  if (from > current) return { state, from, to: from, applied: [], newer: true };
  let result = state, schema = from;
  const applied = [];
  while (schema < current) {
    const step = migrations.find(m => m.from === schema);
    if (!step) throw new Error(`No migration from project format ${schema} to ${schema + 1}. This project cannot be opened.`);
    result = step.migrate(result);
    if (schemaOf(result) !== step.to) throw new Error(`Migration ${step.file} did not produce format ${step.to}.`);
    applied.push(step.file);
    schema = step.to;
  }
  return { state: result, from, to: schema, applied, newer: false };
}

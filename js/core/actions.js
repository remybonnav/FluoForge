/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* The action registry (PI-T9): one list of the editor's actions, so the right-click menu, and later
   the command palette and the shortcut sheet (P4-T2), are built from the same entries.

   An action: {
     id:        stable name, kept in the preferences (never rename one);
     label:     text, or ctx => text;
     title:     tooltip, or ctx => text;
     group:     items of one group sit together; a separator goes between groups;
     option:    the name shown in Preferences ▸ Context menu;
     menu:      'default' (in the menu until removed), 'optional' (added by the user) or false (never in it);
     applies:   ctx => whether it is shown for this selection;
     enabled:   ctx => whether it can run now (default: true);
     run:       ctx => does it;
     entries:   ctx => [{ label, title, enabled, run }] instead of label/run, for an action shown as several items.
   }
   ctx is what the menu was opened on: { active, objects, images, point, copy } (see contextOf). */

const actions = [];
const byId = new Map();

/** Adds an action (or replaces the one with the same id). Its place in the list is its place in the menu. */
export function registerAction(action) {
  if (!action || !action.id) throw new Error('An action needs an id');
  const at = actions.findIndex(a => a.id === action.id);
  if (at >= 0) actions[at] = action; else actions.push(action);
  byId.set(action.id, action);
  return action;
}

export const allActions = () => actions.slice();
export const actionById = id => byId.get(id) || null;
/** The ids of the actions the menu shows until the user changes it. */
export const defaultMenuIds = () => actions.filter(a => a.menu === 'default').map(a => a.id);
/** Every action the user can put in the menu, in menu order. */
export const menuOptions = () => actions.filter(a => a.menu === 'default' || a.menu === 'optional');

const value = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);
/** The items an action gives for ctx: [{ id, group, label, title, enabled, run }] (empty when it does not apply). */
export function itemsOf(action, ctx) {
  try {
    if (action.applies && !action.applies(ctx)) return [];
    if (action.entries) return action.entries(ctx).map(e => ({ id: action.id, group: action.group, ...e }));
    return [{ id: action.id, group: action.group, label: value(action.label, ctx), title: value(action.title, ctx),
      enabled: action.enabled ? !!action.enabled(ctx) : true, run: () => action.run(ctx) }];
  } catch (error) {
    console.error(error); // one broken action must not take the whole menu with it
    return [];
  }
}

/** The menu's items for ctx, in registry order, for the chosen action ids. */
export function menuItems(ctx, ids) {
  const chosen = new Set(ids);
  return actions.filter(a => (a.menu === 'default' || a.menu === 'optional') && chosen.has(a.id)).flatMap(a => itemsOf(a, ctx));
}

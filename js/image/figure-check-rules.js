/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Figure check rules. Each rule is a small pure function from a check context (plain data, built
   from the figure by js/ui/figure-check.js) to a list of findings; no DOM, no Fabric. To add a
   rule, write a function and add it to RULES.

   Context:
     { dpi, preset: { name, minFontPt, maxFontPt, minDpi },
       images: [{ id, name, page, box: {left, top, width, height}, inset, insetContour,
                  pixelSizeUm, brightness, contrast, compareGroup, effectivePpi, enlarged,
                  channels: [{ index, name, enabled, color, lut, min, max, gamma, saturated, black }] }],
       scaleBars: [{ id, attachedTo, page, box }],
       texts: [{ id, text, page, box, minPt, maxPt }],
       pasteboard: [{ id, label }] }
   insetContour: null (not an inset), or { found, visible }. saturated and black are the fractions
   (0 to 1) of the panel's pixels at or above max and at or below min. page is -1 on the pasteboard.

   Finding: { rule, severity: 'error' | 'warning' | 'info', objects: [ids], message, detail? }.
   Its key (findingKey) is stable across sessions, so a finding can be dismissed per project. */

export const SEVERITIES = ['error', 'warning', 'info'];
export const DEFAULT_PRESET = { name: 'Default (5–8 pt, 300 dpi)', minFontPt: 5, maxFontPt: 8, minDpi: 300 };
export const CLIPPING_LIMIT = 0.01;

const finding = (rule, severity, objects, message, detail) => ({ rule, severity, objects, message, ...(detail != null ? { detail: String(detail) } : {}) });
const label = image => image.name || 'Image';
const onPage = o => o.page >= 0;
const pct = f => (Math.round(f * 1000) / 10) + ' %';
const fmt = n => String(Math.round(n * 10) / 10);

function overlap(a0, a1, b0, b1) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }
/** Same row: same page and their vertical extents overlap by half the smaller height. */
export function sameRow(a, b) {
  return a.page === b.page && overlap(a.box.top, a.box.top + a.box.height, b.box.top, b.box.top + b.box.height) >= 0.5 * Math.min(a.box.height, b.box.height);
}
/** Same column: same page and their horizontal extents overlap by half the smaller width. */
export function sameColumn(a, b) {
  return a.page === b.page && overlap(a.box.left, a.box.left + a.box.width, b.box.left, b.box.left + b.box.width) >= 0.5 * Math.min(a.box.width, b.box.width);
}
const centre = box => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
const inside = (p, box) => p.x >= box.left && p.x <= box.left + box.width && p.y >= box.top && p.y <= box.top + box.height;
/** Gap between two boxes (0 when they touch or overlap). */
export function boxGap(a, b) {
  const dx = Math.max(0, a.left - (b.left + b.width), b.left - (a.left + a.width));
  const dy = Math.max(0, a.top - (b.top + b.height), b.top - (a.top + a.height));
  return Math.hypot(dx, dy);
}

/** Image has a pixel size but no scale bar on it or on another panel of its row. */
export function scaleBarRule(ctx) {
  const images = ctx.images.filter(onPage);
  const hasBar = image => ctx.scaleBars.some(bar => bar.page === image.page && (bar.attachedTo === image.id || inside(centre(bar.box), image.box)));
  return images.filter(image => image.pixelSizeUm != null && !hasBar(image) && !images.some(other => other !== image && sameRow(image, other) && hasBar(other)))
    .map(image => finding('scale-bar', 'warning', [image.id], `${label(image)} has a pixel size but no scale bar, on it or on another panel of its row.`));
}

/** Image has no pixel size. */
export function pixelSizeRule(ctx) {
  return ctx.images.filter(onPage).filter(image => image.pixelSizeUm == null)
    .map(image => finding('pixel-size', 'info', [image.id], `${label(image)} has no pixel size, so it cannot carry a scale bar. Set it in the Channels panel if it is known.`));
}

const isRed = c => c.color === 'red', isGreen = c => c.color === 'green';
/** Red and green both enabled in one merged panel. */
export function redGreenRule(ctx) {
  return ctx.images.filter(onPage).filter(image => {
    const on = image.channels.filter(c => c.enabled);
    return on.length >= 2 && on.some(isRed) && on.some(isGreen);
  }).map(image => finding('red-green', 'warning', [image.id],
    `${label(image)} merges red and green, which readers with red-green colour blindness cannot tell apart. Use magenta and green instead.`));
}

/** Channels enabled but no text label near the panel, at the start of its row or above its column. */
export function channelLabelRule(ctx) {
  const images = ctx.images.filter(onPage), texts = ctx.texts.filter(t => onPage(t) && t.text.trim());
  return images.filter(image => image.channels.some(c => c.enabled)).filter(image => {
    const near = Math.max(12, 0.15 * Math.min(image.box.width, image.box.height));
    if (texts.some(t => t.page === image.page && boxGap(t.box, image.box) <= near)) return false;
    const row = images.filter(o => sameRow(o, image)), column = images.filter(o => sameColumn(o, image));
    const rowLeft = Math.min(...row.map(o => o.box.left)), columnTop = Math.min(...column.map(o => o.box.top));
    const rowHeader = texts.some(t => t.page === image.page && t.box.left + t.box.width <= rowLeft + near &&
      overlap(t.box.top, t.box.top + t.box.height, image.box.top, image.box.top + image.box.height) > 0);
    const columnHeader = texts.some(t => t.page === image.page && t.box.top + t.box.height <= columnTop + near &&
      overlap(t.box.left, t.box.left + t.box.width, image.box.left, image.box.left + image.box.width) > 0);
    return !rowHeader && !columnHeader;
  }).map(image => finding('channel-label', 'warning', [image.id],
    `${label(image)} has no text label near it, at the start of its row or above its column, to name what it shows (${image.channels.filter(c => c.enabled).map(c => c.name).join(', ')}).`));
}

const LINKED = ['min', 'max', 'color', 'lut', 'gamma'];
const gammaOf = c => (Number.isFinite(c.gamma) && c.gamma > 0 ? c.gamma : 1);
/** Panels in a comparison group have different range, LUT or gamma. */
export function comparisonRule(ctx) {
  const groups = new Map();
  for (const image of ctx.images) if (Number.isInteger(image.compareGroup)) {
    if (!groups.has(image.compareGroup)) groups.set(image.compareGroup, []);
    groups.get(image.compareGroup).push(image);
  }
  const out = [];
  for (const [id, members] of groups) {
    if (members.length < 2) continue;
    const first = members[0], channels = Math.min(...members.map(m => m.channels.length)), differing = new Set();
    for (let c = 0; c < channels; c++) for (const m of members.slice(1)) for (const field of LINKED) {
      const a = field === 'gamma' ? gammaOf(first.channels[c]) : first.channels[c][field] ?? null;
      const b = field === 'gamma' ? gammaOf(m.channels[c]) : m.channels[c][field] ?? null;
      if (a !== b) differing.add(`channel ${c + 1} ${field === 'color' || field === 'lut' ? 'LUT' : field === 'gamma' ? 'gamma' : 'range'}`);
    }
    if (differing.size) out.push(finding('comparison-group', 'error', members.map(m => m.id),
      `Comparison group ${id} (${members.map(label).join(', ')}) no longer shows its panels the same way: ${[...differing].join(', ')} differ. Match the group in the Layers panel.`, id));
  }
  return out;
}

/** More than 1 % of a channel's pixels saturated or clipped to black. */
export function clippingRule(ctx) {
  const out = [];
  for (const image of ctx.images.filter(onPage)) for (const c of image.channels) {
    if (!c.enabled) continue;
    const parts = [];
    if (c.saturated > CLIPPING_LIMIT) parts.push(`${pct(c.saturated)} saturated (at or above ${c.max})`);
    if (c.black > CLIPPING_LIMIT) parts.push(`${pct(c.black)} clipped to black (at or below ${c.min})`);
    if (parts.length) out.push(finding('clipping', 'warning', [image.id], `${label(image)}, ${c.name}: ${parts.join(' and ')}. Widen the display range unless this is intended.`, c.index));
  }
  return out;
}

/** Gamma not 1, or brightness and contrast not 0: must be reported. */
export function adjustmentRule(ctx) {
  return ctx.images.filter(onPage).filter(image => image.brightness || image.contrast || image.channels.some(c => c.enabled && gammaOf(c) !== 1)).map(image => {
    const parts = image.channels.filter(c => c.enabled && gammaOf(c) !== 1).map(c => `${c.name} gamma ${gammaOf(c)}`);
    if (image.brightness) parts.push(`brightness ${image.brightness}`);
    if (image.contrast) parts.push(`contrast ${image.contrast}`);
    return finding('adjustment', 'info', [image.id], `${label(image)}: ${parts.join(', ')}. Non-linear and tone adjustments must be stated in the figure legend or Methods (the figure report lists them).`);
  });
}

/** Panel enlarged beyond its source resolution, or below the preset's DPI at print size. */
export function resolutionRule(ctx) {
  const minDpi = (ctx.preset || DEFAULT_PRESET).minDpi;
  return ctx.images.filter(onPage).filter(image => image.enlarged || image.effectivePpi < minDpi - 0.05).map(image => finding('resolution', 'warning', [image.id],
    `${label(image)} prints at ${fmt(image.effectivePpi)} ppi` + (image.enlarged ? `, enlarged beyond its source pixels (the document is ${ctx.dpi} dpi)` : '') +
    (image.effectivePpi < minDpi - 0.05 ? `, below ${minDpi} dpi` : '') + '. Print it smaller or use a higher-resolution source.'));
}

/** Text smaller or larger than the preset's limits at print size. */
export function textSizeRule(ctx) {
  const p = ctx.preset || DEFAULT_PRESET;
  return ctx.texts.filter(t => onPage(t) && t.text.trim()).filter(t => t.minPt < p.minFontPt - 0.05 || t.maxPt > p.maxFontPt + 0.05).map(t => {
    const size = Math.abs(t.minPt - t.maxPt) < 0.05 ? `${fmt(t.minPt)} pt` : `${fmt(t.minPt)}–${fmt(t.maxPt)} pt`;
    const snippet = t.text.trim().replace(/\s+/g, ' ');
    return finding('text-size', 'warning', [t.id], `Text "${snippet.length > 30 ? snippet.slice(0, 29) + '…' : snippet}" is ${size} at print size; ${p.name} allows ${p.minFontPt}–${p.maxFontPt} pt.`);
  });
}

/** Inset exists but its outline on the source panel is hidden or deleted. */
export function insetOutlineRule(ctx) {
  return ctx.images.filter(image => onPage(image) && image.insetContour && !(image.insetContour.found && image.insetContour.visible)).map(image =>
    finding('inset-outline', 'warning', [image.id], `${label(image)} is an inset, but its outline on the source panel is ${image.insetContour.found ? 'hidden' : 'deleted'}, so readers cannot see where it comes from.`));
}

/** Objects on the pasteboard, which are not exported. */
export function pasteboardRule(ctx) {
  return ctx.pasteboard.map(o => finding('pasteboard', 'info', [o.id], `${o.label} is on the pasteboard, outside every page, and will not be exported.`));
}

export const RULES = [comparisonRule, scaleBarRule, redGreenRule, channelLabelRule, clippingRule, resolutionRule, textSizeRule,
  insetOutlineRule, pixelSizeRule, adjustmentRule, pasteboardRule];

export const findingKey = f => f.rule + ':' + f.objects.join(',') + (f.detail != null ? ':' + f.detail : '');

/** Every finding of the context, errors first, then warnings, then info (rule order within each). */
export function runChecks(ctx, rules = RULES) {
  const all = rules.flatMap(rule => rule(ctx));
  return all.map((f, i) => ({ f, i })).sort((a, b) => SEVERITIES.indexOf(a.f.severity) - SEVERITIES.indexOf(b.f.severity) || a.i - b.i)
    .map(({ f }) => ({ ...f, key: findingKey(f) }));
}

/** Counts per severity, leaving out dismissed findings. */
export function summarize(findings, dismissed = []) {
  const keys = new Set(dismissed.map(d => d.key)), open = findings.filter(f => !keys.has(f.key));
  return { error: open.filter(f => f.severity === 'error').length, warning: open.filter(f => f.severity === 'warning').length,
    info: open.filter(f => f.severity === 'info').length, dismissed: findings.length - open.length };
}

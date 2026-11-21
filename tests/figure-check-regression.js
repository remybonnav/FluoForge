/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P2-T7: figure check before export.
   - Every rule of js/image/figure-check-rules.js on small synthetic contexts: it fires, and it stays
     quiet when the figure is right.
   - Through the app: the reference project's findings; clipping measured on real pixels; text in
     points at print size; inset outlines; the pasteboard; a comparison group that diverged.
   - Clicking a finding selects its object; a dismissal keeps its note through undo, saving and
     reopening, and goes into the figure report; Restore brings the finding back.
   - The non-blocking summary in the Export menu; the panel's titles, keyboard path and themes. */

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
async function runFigureCheckRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const R = await import(new URL('js/image/figure-check-rules.js', document.baseURI).href);
  const C = await import(new URL('js/ui/figure-check.js', document.baseURI).href);
  const report = await import(new URL('js/ui/figure-report.js', document.baseURI).href);

  // ---- Pure rules ----
  const ch = (over = {}) => ({ index: 0, name: 'DAPI', enabled: true, color: 'blue', lut: null, min: 0, max: 255, gamma: 1, invert: false, saturated: 0, black: 0, ...over });
  const img = (id, over = {}) => ({ id, name: id + '.tif', page: 0, box: { left: 100, top: 100, width: 200, height: 200 }, inset: false, insetContour: null,
    pixelSizeUm: 0.5, brightness: 0, contrast: 0, compareGroup: null, effectivePpi: 300, enlarged: false, channels: [ch()], ...over });
  const text = (id, over = {}) => ({ id, text: 'DAPI', page: 0, box: { left: 100, top: 80, width: 60, height: 15 }, minPt: 7, maxPt: 7, ...over });
  const ctx = (over = {}) => ({ dpi: 300, preset: R.DEFAULT_PRESET, images: [], scaleBars: [], texts: [], pasteboard: [], ...over });
  const rules = (list, c) => list(c).map(f => f.rule + ':' + f.severity + ':' + f.objects.join('+'));

  const a = img('a'), b = img('b', { box: { left: 320, top: 100, width: 200, height: 200 } }), below = img('c', { box: { left: 100, top: 400, width: 200, height: 200 } });
  assert('Scale bar: a calibrated image with no scale bar on it or on its row is a warning',
    rules(R.scaleBarRule, ctx({ images: [a] })).join() === 'scale-bar:warning:a');
  assert('Scale bar: none when a bar is attached to the image, lies on it, or is on another panel of its row (not of another row)',
    !R.scaleBarRule(ctx({ images: [a], scaleBars: [{ id: 's', attachedTo: 'a', page: 0, box: { left: 0, top: 0, width: 5, height: 5 } }] })).length &&
    !R.scaleBarRule(ctx({ images: [a], scaleBars: [{ id: 's', attachedTo: null, page: 0, box: { left: 250, top: 270, width: 40, height: 10 } }] })).length &&
    !R.scaleBarRule(ctx({ images: [a, b], scaleBars: [{ id: 's', attachedTo: 'b', page: 0, box: b.box }] })).filter(f => f.objects[0] === 'a').length &&
    rules(R.scaleBarRule, ctx({ images: [a, below], scaleBars: [{ id: 's', attachedTo: 'c', page: 0, box: below.box }] })).join() === 'scale-bar:warning:a');
  assert('Pixel size: an image without one is info; one with a pixel size, or on the pasteboard, is not reported',
    rules(R.pixelSizeRule, ctx({ images: [img('n', { pixelSizeUm: null }), a, img('p', { pixelSizeUm: null, page: -1 })] })).join() === 'pixel-size:info:n');
  const merged = img('m', { channels: [ch({ color: 'red', name: 'A' }), ch({ index: 1, color: 'green', name: 'B' })] });
  const mg = R.redGreenRule(ctx({ images: [merged] }));
  assert('Red and green in one merged panel is a warning that suggests magenta and green',
    mg.length === 1 && mg[0].severity === 'warning' && /magenta and green/.test(mg[0].message));
  assert('Red and green: not when one of them is off, or the panel shows a single channel, or uses magenta',
    !R.redGreenRule(ctx({ images: [img('x', { channels: [ch({ color: 'red' }), ch({ index: 1, color: 'green', enabled: false })] }), img('y', { channels: [ch({ color: 'red' })] }),
      img('z', { channels: [ch({ color: 'magenta' }), ch({ index: 1, color: 'green' })] })] })).length);
  const far = text('t', { box: { left: 900, top: 900, width: 40, height: 15 } });
  assert('Channel label: a panel with no text near it, at its row start or above its column, is a warning naming its channels',
    rules(R.channelLabelRule, ctx({ images: [a], texts: [far] })).join() === 'channel-label:warning:a' && /DAPI/.test(R.channelLabelRule(ctx({ images: [a], texts: [] }))[0].message));
  assert('Channel label: a label next to the panel, a row header left of the row, or a column header above the column is enough',
    !R.channelLabelRule(ctx({ images: [a], texts: [text('t')] })).length &&
    !R.channelLabelRule(ctx({ images: [a, b], texts: [text('row', { box: { left: 0, top: 180, width: 60, height: 15 } })] })).length &&
    !R.channelLabelRule(ctx({ images: [a, below], texts: [text('col', { box: { left: 150, top: 20, width: 60, height: 15 } })] })).filter(f => f.objects[0] === 'c').length &&
    !R.channelLabelRule(ctx({ images: [a], texts: [text('blank', { text: '  ' })] })).length === false);
  const g1 = img('g1', { compareGroup: 1 }), g2 = img('g2', { compareGroup: 1 });
  assert('Comparison group: equal settings give nothing',
    !R.comparisonRule(ctx({ images: [g1, g2] })).length);
  const diverged = R.comparisonRule(ctx({ images: [g1, img('g2', { compareGroup: 1, channels: [ch({ max: 200, gamma: 0.8, color: 'cyan' })] })] }));
  assert('Comparison group: a different range, LUT or gamma is one error naming every member and what differs',
    diverged.length === 1 && diverged[0].severity === 'error' && diverged[0].objects.join() === 'g1,g2' &&
    /channel 1 range/.test(diverged[0].message) && /channel 1 LUT/.test(diverged[0].message) && /channel 1 gamma/.test(diverged[0].message), diverged[0] && diverged[0].message);
  assert('Comparison group: gamma missing and gamma 1 are the same',
    !R.comparisonRule(ctx({ images: [g1, img('g2', { compareGroup: 1, channels: [ch({ gamma: undefined })] })] })).length);
  const clip = R.clippingRule(ctx({ images: [img('k', { channels: [ch({ saturated: 0.02 }), ch({ index: 1, name: 'GFP', black: 0.05 }), ch({ index: 2, name: 'Off', enabled: false, saturated: 0.5 }), ch({ index: 3, name: 'Fine', saturated: 0.01 })] })] }));
  assert('Clipping: more than 1 % saturated or clipped to black in a shown channel is a warning per channel (exactly 1 % and hidden channels are not)',
    clip.length === 2 && clip.every(f => f.severity === 'warning') && /2 % saturated/.test(clip[0].message) && /5 % clipped to black/.test(clip[1].message) && clip[1].detail === '1');
  const adj = R.adjustmentRule(ctx({ images: [img('j', { brightness: 10, contrast: -5, channels: [ch({ gamma: 0.5 })] }), a] }));
  assert('Adjustments: gamma not 1, brightness or contrast not 0 is info that says they must be reported',
    adj.length === 1 && adj[0].severity === 'info' && /gamma 0.5/.test(adj[0].message) && /brightness 10/.test(adj[0].message) && /contrast -5/.test(adj[0].message) && /must be stated/.test(adj[0].message));
  const res = R.resolutionRule(ctx({ images: [img('e', { effectivePpi: 150, enlarged: true }), img('l', { effectivePpi: 250, enlarged: false }), a] }));
  assert('Resolution: a panel enlarged beyond its source, or below 300 dpi, is a warning',
    res.map(f => f.objects[0]).join() === 'e,l' && /enlarged/.test(res[0].message) && /below 300 dpi/.test(res[1].message) && !/enlarged/.test(res[1].message));
  const sizes = R.textSizeRule(ctx({ texts: [text('small', { minPt: 4, maxPt: 4 }), text('big', { minPt: 7, maxPt: 12 }), text('ok', { minPt: 5, maxPt: 8 }), text('off', { minPt: 2, maxPt: 2, page: -1 })] }));
  assert('Text size: smaller than 5 pt or larger than 8 pt at print size is a warning (limits from the preset)',
    sizes.map(f => f.objects[0]).join() === 'small,big' && /4 pt/.test(sizes[0].message) && /7–12 pt/.test(sizes[1].message) && /5–8 pt/.test(sizes[0].message));
  assert('Text size: a stricter preset moves the limits',
    R.textSizeRule(ctx({ preset: { name: 'Strict', minFontPt: 6, maxFontPt: 7, minDpi: 300 }, texts: [text('t', { minPt: 5.5, maxPt: 5.5 })] })).length === 1);
  const insets = R.insetOutlineRule(ctx({ images: [img('i1', { inset: true, insetContour: { found: false, visible: false } }), img('i2', { inset: true, insetContour: { found: true, visible: false } }),
    img('i3', { inset: true, insetContour: { found: true, visible: true } }), a] }));
  assert('Inset: an inset whose outline is deleted or hidden is a warning', insets.map(f => f.objects[0]).join() === 'i1,i2' &&
    /deleted/.test(insets[0].message) && /hidden/.test(insets[1].message));
  assert('Pasteboard: each object off the pages is info', rules(R.pasteboardRule, ctx({ pasteboard: [{ id: 'p', label: 'A rect' }] })).join() === 'pasteboard:info:p');
  const all = R.runChecks(ctx({ images: [img('n', { pixelSizeUm: null }), g1, img('g2', { compareGroup: 1, channels: [ch({ max: 9 })] })], texts: [] }));
  assert('runChecks: errors first, then warnings, then info; each finding has a stable key',
    all[0].severity === 'error' && all.map(f => f.severity).join().replace(/(error,)+/, '').indexOf('error') < 0 && all.at(-1).severity === 'info' &&
    all.every(f => f.key === R.findingKey(f)) && all[0].key === 'comparison-group:g1,g2:1');
  assert('Every rule is a function of the context only: the same context gives the same findings',
    JSON.stringify(R.runChecks(ctx({ images: [a, merged] }))) === JSON.stringify(R.runChecks(ctx({ images: [a, merged] }))) && R.RULES.length === 11);

  // ---- The reference project ----
  const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
  await MFC_TIFF.whenIdle();
  const context = C.buildCheckContext();
  assert('The context of the reference project: 4 images on page 1 with their pixel size, effective resolution and clipping, texts in points',
    context.images.length === 4 && context.images.every(i => i.page === 0) && context.images[0].pixelSizeUm === 0.5 && Math.abs(context.images[0].effectivePpi - 200) < 0.01 &&
    context.images[0].enlarged && context.texts.length >= 4 && context.texts.every(t => t.minPt > 0) && context.scaleBars.length === 1,
    JSON.stringify(context.images.map(i => [i.name, i.page, i.effectivePpi])));
  const found = C.checkFigure(), byRule = rule => found.filter(f => f.rule === rule);
  assert('Reference project: the raster image has no pixel size (info); the three panels printed larger than their source are below 300 dpi (warning), the panel at 1:1 is not',
    byRule('pixel-size').length === 1 && byRule('pixel-size')[0].objects[0] === context.images[1].id && byRule('resolution').map(f => f.objects[0]).join() === context.images.slice(0, 3).map(i => i.id).join(), JSON.stringify(found.map(f => f.rule + ':' + f.objects.join('+'))));
  assert('Reference project: red and green merged in the RGB and three-channel panels (warning)', byRule('red-green').length === 4);
  assert('Reference project: no comparison group, inset outline or adjustment problems', !byRule('comparison-group').length && !byRule('inset-outline').length && !byRule('adjustment').length);
  const pt = context.texts.map(t => t.minPt);
  assert('Reference project: text is measured in points at 300 dpi (font size × scale / 300 × 72)',
    byRule('text-size').length === context.texts.filter(t => t.page >= 0 && t.text.trim() && (t.minPt < 4.95 || t.maxPt > 8.05)).length && pt.every(Number.isFinite), pt.map(n => n.toFixed(1)).join());

  // Clipping on real pixels: narrow one channel's range.
  const cells = MFC.getCanvas().getObjects().find(o => o.mfcId === context.images[0].id), raw = MFC.getRegistry()[cells.mfcId].rawImage;
  const savedRange = [raw.channels[0].min, raw.channels[0].max];
  const values = Array.from(raw.channels[0].data).sort((x, y) => x - y), p90 = values[Math.floor(values.length * 0.9)];
  raw.channels[0].max = p90; raw.channels[0].min = values[Math.floor(values.length * 0.05)];
  const clipped = C.buildCheckContext().images[0].channels[0];
  assert('Clipping is counted on the panel\'s source pixels: a range from the 5th to the 90th percentile clips at least 10 % and 5 % (more with ties at the limits)',
    clipped.saturated >= 0.1 && clipped.saturated < 0.13 && clipped.black >= 0.05 && clipped.black < 0.1 && C.checkFigure().some(f => f.rule === 'clipping' && f.objects[0] === cells.mfcId),
    JSON.stringify(clipped));
  [raw.channels[0].min, raw.channels[0].max] = savedRange;
  assert('Clipping fractions are cached per plane, range and crop', C.clippedFractions(raw.channels[0].data, raw.width, { x: 0, y: 0, width: raw.width, height: raw.height }, 0, 60000) ===
    C.clippedFractions(raw.channels[0].data, raw.width, { x: 0, y: 0, width: raw.width, height: raw.height }, 0, 60000));

  // Inset outline hidden, then deleted; an object on the pasteboard; a diverged comparison group.
  const contour = MFC.getCanvas().getObjects().find(o => o.mfcType === 'insetContour');
  contour.visible = false;
  assert('Hiding an inset\'s outline gives a warning on the inset', C.checkFigure().some(f => f.rule === 'inset-outline' && /hidden/.test(f.message)));
  contour.visible = true;
  MFC.getCanvas().remove(contour);
  assert('Deleting the outline says deleted', C.checkFigure().some(f => f.rule === 'inset-outline' && /deleted/.test(f.message)));
  MFC.getCanvas().add(contour);
  const stray = new fabric.Rect({ left: 1500, top: 50, width: 40, height: 40, fill: '#888' }); stray.mfcId = 'stray-test'; stray.mfcType = 'shape';
  MFC.getCanvas().add(stray);
  const strayFinding = C.checkFigure().find(f => f.rule === 'pasteboard');
  assert('An object on the pasteboard is info: it will not be exported', strayFinding && strayFinding.objects[0] === 'stray-test' && strayFinding.severity === 'info');
  MFC.getCanvas().remove(stray);
  const imgs = MFC.getCanvas().getObjects().filter(o => o.mfcType === 'mfcImage' && !o.mfcIsInset && o.mfcFileName === 'reference-cells.tif');
  imgs.forEach(o => { o.mfcCompareGroup = 7; });
  const other = MFC.getRegistry()[imgs[1].mfcId].rawImage; const savedMax = other.channels[1].max; other.channels[1].max = 12345;
  const groupError = C.checkFigure().find(f => f.rule === 'comparison-group');
  assert('Two panels of one comparison group with different ranges give an error on both', groupError && groupError.severity === 'error' && groupError.objects.length === 2 && /channel 2 range/.test(groupError.message));

  // ---- Panel: select, dismiss with a note, undo, save and reopen, report, restore ----
  document.getElementById('check-run').click();
  const firstButton = document.querySelector('#check-list .check-finding');
  assert('The Check figure panel lists the findings, errors first, with a summary', firstButton && firstButton.querySelector('.check-severity').textContent === 'Error' &&
    /1 error/.test(document.getElementById('check-summary').textContent), document.getElementById('check-summary').textContent);
  MFC.getCanvas().discardActiveObject(); firstButton.click();
  const active = MFC.getCanvas().getActiveObjects();
  assert('Clicking a finding selects its objects', active.length === 2 && active.every(o => imgs.includes(o)));
  MFC.getCanvas().discardActiveObject();
  const resolutionItem = [...document.querySelectorAll('#check-list .check-item')].find(li => /prints at/.test(li.textContent));
  resolutionItem.querySelector('.check-dismiss').click(); await nextFrame();
  const note = document.activeElement;
  assert('Dismiss… asks for a note, with focus in the note field', note && note.tagName === 'INPUT' && note.getAttribute('aria-label') === 'Note for the figure report');
  note.value = 'Source is 320 px wide; printed at the journal\'s column width';
  note.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const stored = MFC.getDocProps().checkDismissals;
  assert('The dismissal is stored in the project with its note, rule, severity and message, and the finding leaves the list',
    stored && stored.length === 1 && stored[0].note.startsWith('Source is 320 px') && stored[0].rule === 'resolution' && stored[0].severity === 'warning' &&
    ![...document.querySelectorAll('#check-list .check-finding')].some(b => b.dataset.key === stored[0].key) &&
    document.getElementById('check-dismissed-count').textContent === '1' && !document.getElementById('check-dismissed-box').hidden);
  const r1 = report.buildReport();
  assert('The figure report lists the dismissed finding with its note (JSON and Markdown)', r1.checkDismissals && r1.checkDismissals[0].note === stored[0].note &&
    report.toMarkdown(r1).includes('## Dismissed figure checks') && report.toMarkdown(r1).includes('journal\'s column width'));
  await MFC.undo(); await MFC_TIFF.whenIdle();
  assert('Undo takes the dismissal back', !(MFC.getDocProps().checkDismissals || []).length);
  await MFC.redo(); await MFC_TIFF.whenIdle();
  assert('Redo dismisses it again', (MFC.getDocProps().checkDismissals || []).length === 1);
  const next = MFC_PROJECT.prepareSave(true, 'check'), archive = await MFC_PROJECT.buildArchive(next); await MFC_PROJECT.commitSave(next);
  await MFC_PROJECT.loadProject(new File([archive], 'check.fluoforge'));
  await MFC_TIFF.whenIdle();
  assert('Saving and reopening keeps the dismissal and its note', (MFC.getDocProps().checkDismissals || [])[0]?.note === stored[0].note);
  document.getElementById('doc-apply').click();
  assert('Applying document properties keeps the dismissals', (MFC.getDocProps().checkDismissals || []).length === 1);
  C.refreshCheckPanel();
  document.querySelector('#check-dismissed .check-restore').click();
  assert('Restore brings the finding back and takes it out of the report', !MFC.getDocProps().checkDismissals && !report.buildReport().checkDismissals &&
    [...document.querySelectorAll('#check-list .check-finding')].some(b => b.dataset.key === stored[0].key));

  // ---- Export menu summary ----
  document.getElementById('btn-export').click();
  const summary = document.getElementById('export-check-summary');
  assert('The Export menu shows the check summary above the formats, with a Review button; exporting is not blocked',
    !document.getElementById('export-menu').classList.contains('hidden') && /^Figure check: /.test(summary.querySelector('.export-check-text').textContent) &&
    summary.nextElementSibling.dataset.export === 'dialog' && !summary.querySelector('#export-check-review').disabled &&
    [...document.querySelectorAll('#export-menu [data-export]')].every(b => !b.disabled), summary.textContent);
  document.getElementById('export-check-review').click(); await nextFrame();
  assert('Review closes the menu, opens the Check figure panel and focuses the first finding',
    document.getElementById('export-menu').classList.contains('hidden') && document.activeElement.classList.contains('check-finding') &&
    document.querySelector('#panel-check .panel-toggle').getAttribute('aria-expanded') !== 'false');
  const svg = await MFC_EXPORT.buildSVG();
  assert('Export still works with findings open', /<svg/.test(svg.svg));

  // ---- Titles, keyboard and themes ----
  const controls = [...document.querySelectorAll('#panel-check button, #panel-check summary, #export-check-summary button')];
  assert('Every control of the panel and the menu summary has a title', controls.length >= 4 && controls.every(c => (c.title || '').length > 5),
    controls.filter(c => !(c.title || '').length).map(c => c.className || c.id).join());
  const item = document.querySelector('#check-list .check-item');
  item.querySelector('.check-dismiss').click(); await nextFrame();
  const field = document.activeElement;
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert('Escape in the note cancels and returns focus to Dismiss…', !item.querySelector('.check-dismiss-form') && document.activeElement === item.querySelector('.check-dismiss'));
  const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (x, y) => { const [h, l] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (h + 0.05) / (l + 0.05); };
  const bg = el => { let e = el; while (e) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; e = e.parentElement; } return 'rgb(255, 255, 255)'; };
  const saved = document.documentElement.dataset.theme, ratios = [];
  // Badges for each severity, made on the fly if the figure has none of one kind.
  const probes = ['error', 'warning', 'info'].map(s => { const span = document.createElement('span'); span.className = 'check-severity check-' + s; span.textContent = s; item.append(span); return span; });
  for (const theme of ['light', 'sage', 'dark', 'slate']) {
    document.documentElement.dataset.theme = theme;
    for (const elm of [item.querySelector('.check-message'), ...probes]) { const s = getComputedStyle(elm); ratios.push(contrast(s.color, bg(elm))); }
  }
  probes.forEach(p => p.remove());
  if (saved) document.documentElement.dataset.theme = saved; else delete document.documentElement.dataset.theme;
  assert('Findings and the error, warning and info badges are readable in all four themes (contrast ≥ 4.5)', ratios.every(r => r >= 4.5), ratios.map(r => r.toFixed(1)).join());
  const focusRule = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } }).some(r => /\.check-finding:focus-visible/.test(r.selectorText || '') && /outline/.test(r.cssText));
  assert('Findings and buttons have a visible focus outline', focusRule);
  other.channels[1].max = savedMax;
  return checks;
}

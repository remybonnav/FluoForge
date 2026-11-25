// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Remy Bonnavion
/* P3-T6: the pure part of templates (js/layout/template-model.js), in Node. An image becomes an empty
   frame of the same place, size and links, without pixels, source, crop or file name; a figure's
   template holds no image data; template files are checked; the five built-in templates are valid
   (frames in grids, groups filling from one file, channel, Z and time indices, an inset outline);
   channel settings match by name; series frames spread over a stack.
   Run alone: node tests/templates-model-regression.mjs */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runTemplatesModelRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const T = await import(pathToFileURL(join(ROOT, 'js/layout/template-model.js')).href);
  const G = await import(pathToFileURL(join(ROOT, 'js/layout/grid-model.js')).href);

  // ---- an image becomes a frame ----
  const image = { type: 'image', originX: 'left', originY: 'top', left: 100, top: 50, width: 400, height: 300, scaleX: 0.5, scaleY: 0.5, angle: 0,
    cropX: 20, cropY: 10, sourceId: 'src-abc', workingScale: 1, src: '', mfcId: 'img7', mfcType: 'mfcImage', mfcFileName: 'mouse-12.tif', mfcRawWidth: 1024, mfcRawHeight: 768,
    mfcGridId: 'grid3', mfcLetter: { skip: false }, mfcCompareGroup: 2,
    display: { channels: [{ name: 'DAPI', enabled: true, color: 'blue', min: 10, max: 900, gamma: 1.2, invert: false }, { name: 'GFP', enabled: false, color: 'file', lut: 'Fire', min: 0, max: 4095 }],
      brightness: 0.1, contrast: 0, voxelSizeUm: 0.3, decoder: 2, zMode: 'max', zIndex: 0, tIndex: 0 } };
  const f = T.imageToFrame(image);
  assert('A frame has the image\'s place and displayed size (200 × 150 at 100, 50), and its id', f.type === 'rect' && f.left === 100 && f.top === 50 && f.width === 200 && f.height === 150 &&
    f.scaleX === 1 && f.mfcId === 'img7' && f.mfcType === 'imageFrame', JSON.stringify(f));
  assert('It keeps the links: grid cell, panel letter, comparison group', f.mfcGridId === 'grid3' && f.mfcLetter.skip === false && f.mfcCompareGroup === 2);
  assert('It keeps no pixels, source, crop, file name or raw size', ['sourceId', 'workingScale', 'cropX', 'cropY', 'display', 'src', 'mfcFileName', 'mfcRawWidth', 'mfcRawHeight'].every(k => !(k in f)));
  assert('It remembers the channel settings, without calibration or plane', JSON.stringify(f.mfcFrameDisplay) === JSON.stringify({ channels: [
    { name: 'DAPI', enabled: true, color: 'blue', min: 10, max: 900, gamma: 1.2, invert: false }, { name: 'GFP', enabled: false, color: 'file', min: 0, max: 4095, gamma: 1, invert: false, lut: 'Fire' }],
    brightness: 0.1, contrast: 0 }), JSON.stringify(f.mfcFrameDisplay));
  const inset = T.imageToFrame({ ...image, mfcId: 'img9', mfcIsInset: true, mfcInsetContourId: 'c4', mfcInsetSourceId: 'img7' });
  assert('An inset becomes an inset frame of its outline (the inset links themselves are not kept)', inset.mfcFrameInsetContour === 'c4' && !('mfcIsInset' in inset) && !('mfcInsetContourId' in inset) && !('mfcInsetSourceId' in inset));
  const panel = T.imageToFrame({ ...image, mfcMontageGroup: 'mtg5', mfcMontageChannel: 1, mfcMontageGrey: true });
  assert('A quick-figure panel fills again with its channel, in grey, from one file of its row', panel.mfcFrameGroup === 'mtg5' && panel.mfcFrameChannel === 1 && panel.mfcFrameGrey === true && panel.mfcMontageGroup === 'mtg5');

  // ---- a figure's template ----
  const state = { schema: 9, documentOpen: true, nextId: 12, docProps: { name: 'Fig 2', width: 17.4, height: 10, unit: 'cm', dpi: 300, checkDismissals: [{ key: 'x' }], letterStyle: { case: 'lower' } },
    objects: [image, { type: 'textbox', text: 'Control', mfcId: 'txt1', mfcType: 'text' }, { type: 'group', mfcId: 'grp2', objects: [{ ...image, mfcId: 'img8' }] },
      { type: 'rect', mfcId: 'shp3', mfcType: 'shape', clipPath: null }] };
  const t = T.templateFromState(state, 'Western blot layout', '0.1.33');
  assert('A template has the format, version, name and page; the figure\'s dismissed findings go', t.format === 'fluoforge-template' && t.version === 1 && t.name === 'Western blot layout' &&
    t.docProps.width === 17.4 && t.docProps.letterStyle.case === 'lower' && !('checkDismissals' in t.docProps) && t.appVersion === '0.1.33');
  assert('Its images, also in groups, are frames; text and shapes stay', t.objects[0].mfcType === 'imageFrame' && t.objects[1].text === 'Control' && t.objects[2].objects[0].mfcType === 'imageFrame' && t.objects[3].mfcType === 'shape');
  assert('It holds no image data (no source, display, pixels or file name anywhere)', !T.holdsImageData(t.objects) && !/src-abc|mouse-12|"display"|sourceId/.test(JSON.stringify(t)), JSON.stringify(t).slice(0, 200));
  assert('The figure itself is unchanged', state.objects[0].sourceId === 'src-abc' && state.docProps.checkDismissals.length === 1);
  assert('Opening a template gives a figure state with its frames', JSON.stringify(T.stateFromTemplate(t).objects) === JSON.stringify(t.objects) && T.stateFromTemplate(t).documentOpen === true);

  // ---- template files ----
  assert('A template is valid', T.templateProblems(t).length === 0, T.templateProblems(t).join());
  assert('Not a template, one from a newer version, one without a page, one with image data: refused', T.templateProblems({ format: 'x' }).length === 1 &&
    /newer FluoForge/.test(T.templateProblems({ ...t, version: 2 }).join()) && /page size/.test(T.templateProblems({ ...t, docProps: { name: 'x' } }).join()) &&
    /holds image data/.test(T.templateProblems({ ...t, objects: [image] }).join()) && /holds image data/.test(T.templateProblems({ ...t, objects: [{ type: 'group', objects: [image] }] }).join()));

  // ---- built-in templates ----
  assert('Five built-in templates', T.BUILT_IN.map(b => b.id).join() === 'single-inset,split-channels,comparison-2x3,time-series,z-series' && T.BUILT_IN.every(b => b.name && b.description));
  const built = Object.fromEntries(T.BUILT_IN.map(b => [b.id, T.builtInTemplate(b.id, 300)]));
  assert('Each is a valid template without image data', Object.values(built).every(b => T.templateProblems(b).length === 0), Object.values(built).map(b => T.templateProblems(b).join()).join('|'));
  const framesOf = b => b.objects.filter(o => o.mfcType === 'imageFrame');
  assert('Frames: 2 (image and inset), 4, 6, 5 and 5', Object.values(built).map(b => framesOf(b).length).join() === '2,4,6,5,5');
  const ids = Object.values(built).map(b => b.objects.map(o => o.mfcId));
  assert('Ids are unique in each template and below its next id', ids.every(list => new Set(list).size === list.length) &&
    Object.values(built).every(b => b.objects.every(o => Number(String(o.mfcId).replace(/\D/g, '')) < b.nextId)));
  const one = built['single-inset'], contour = one.objects.find(o => o.mfcType === 'insetContour'), [main, insetFrame] = framesOf(one);
  assert('Single image with inset: an outline on the main frame, linked to the inset frame; both lettered', contour.mfcInsetSourceId === main.mfcId && contour.mfcInsetTargetId === insetFrame.mfcId &&
    insetFrame.mfcFrameInsetContour === contour.mfcId && main.mfcLetter && insetFrame.mfcLetter &&
    contour.left > main.left && contour.left + contour.width < main.left + main.width && contour.top + contour.height < main.top + main.height);
  const split = framesOf(built['split-channels']);
  assert('Split channels: one group, channels 1 to 3 in grey and the merge', new Set(split.map(x => x.mfcFrameGroup)).size === 1 && split.map(x => x.mfcFrameChannel).join() === '0,1,2,-1' &&
    split.slice(0, 3).every(x => x.mfcFrameGrey) && !split[3].mfcFrameGrey);
  const gridOf = b => b.objects.find(o => o.mfcType === 'layoutGrid');
  assert('Their frames are the grid\'s cells, in place, and the grid has its column labels', ['split-channels', 'comparison-2x3', 'time-series', 'z-series'].every(id => {
    const b = built[id], g = gridOf(b).mfcGrid, grid = gridOf(b);
    return framesOf(b).every(fr => { const a = G.areaOf(g, fr.mfcId), box = a && G.areaBox(g, a); return box && fr.mfcGridId === grid.mfcId && Math.abs(fr.left - grid.left - G.mmToPx(box.left, 300)) < 1e-6 && Math.abs(fr.width - G.mmToPx(box.width, 300)) < 1e-6; }) &&
      b.objects.filter(o => o.mfcGridLabel === 'col').length === g.cols;
  }));
  assert('The labels: channels and merge; conditions', built['split-channels'].objects.filter(o => o.mfcGridLabel).map(o => o.text).join() === 'Channel 1,Channel 2,Channel 3,Merge' &&
    built['comparison-2x3'].objects.filter(o => o.mfcGridLabel).map(o => o.text).join() === 'Condition 1,Condition 2,Condition 3');
  const comparison = framesOf(built['comparison-2x3']);
  assert('2 × 3 comparison: two rows of three in comparison group 1, each frame filled on its own', gridOf(built['comparison-2x3']).mfcGrid.rows === 2 && gridOf(built['comparison-2x3']).mfcGrid.cols === 3 &&
    comparison.every(x => x.mfcCompareGroup === 1 && !x.mfcFrameGroup));
  const time = framesOf(built['time-series']), z = framesOf(built['z-series']);
  assert('Series strips: five time points or Z slices of one file, labels that follow them', time.map(x => x.mfcFrameT).join() === '0,1,2,3,4' && z.map(x => x.mfcFrameZ).join() === '0,1,2,3,4' &&
    new Set(time.map(x => x.mfcFrameGroup)).size === 1 && built['time-series'].objects.filter(o => o.mfcFrameSeriesLabel).map(o => o.text).join() === 'Frame 1,Frame 2,Frame 3,Frame 4,Frame 5' &&
    built['z-series'].objects.filter(o => o.mfcFrameSeriesLabel).every((o, i) => o.mfcFrameSeriesLabel.frame === z[i].mfcId && o.mfcFrameSeriesLabel.word === 'Slice'));
  assert('The page fits the content at 300 dpi (18.4 cm wide)', Object.values(built).every(b => b.docProps.width === 18.4 && b.docProps.unit === 'cm' &&
    framesOf(b).every(fr => fr.left + fr.width <= G.mmToPx(184, 300) + 1e-6 && fr.top + fr.height <= G.mmToPx(120, 300) + 1e-6)));
  let threw = false; try { T.builtInTemplate('nope'); } catch (_) { threw = true; }
  assert('An unknown built-in is refused', threw);

  // ---- filling ----
  const m = T.matchChannels([{ name: 'gfp' }, { name: 'Cy5' }, { name: '' }], { channels: [{ name: 'GFP', color: 'green' }, { name: 'DAPI' }, { name: '' }] });
  assert('Channel settings match by name (case and spaces aside), not by number; unnamed channels do not match', m[0] && m[0].color === 'green' && m[1] === null && m[2] === null);
  assert('Five series frames over 9 time points show 0, 2, 4, 6, 8; over 3 they show 0, 1, 2, 2, 2; a single plane is 0',
    [0, 1, 2, 3, 4].map(i => T.seriesIndex(i, 5, 9)).join() === '0,2,4,6,8' && [0, 1, 2, 3, 4].map(i => T.seriesIndex(i, 5, 3)).join() === '0,1,2,2,2' && T.seriesIndex(3, 5, 1) === 0);
  return checks;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const checks = await runTemplatesModelRegressions(); console.log(`PASS templates-model-regression: ${checks.length} checks`); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}

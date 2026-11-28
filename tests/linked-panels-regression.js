/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* PI-T10: seeing which images are linked. On the reference figure (a quick figure, and img1 with its
   inset img3), plus a comparison group of three images (the raster image and two pasted copies):
   - selecting any panel of a group highlights exactly its group: an amber dashed outline drawn over the
     canvas around the other members, and a chain badge on every member whose tooltip names the group;
   - the Layers panel names each group; an unlinked object highlights nothing;
   - Link and Unlink say what they will do in their tooltips; unlinking one panel removes only it;
   - the badge passes the mouse on to the canvas, follows the four themes, and nothing is added to the
     figure or its export. */
async function runLinkedPanelsRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = () => MFC.getCanvas();
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const LP = await import(new URL('js/ui/linked-panels.js', document.baseURI).href);
  const LY = await import(new URL('js/ui/layers.js', document.baseURI).href);
  const byId = id => canvas().getObjects().find(o => o.mfcId === id);
  const images = () => canvas().getObjects().filter(o => o.mfcType === 'mfcImage');
  const select = async (...objs) => {
    canvas().discardActiveObject();
    if (objs.length === 1) canvas().setActiveObject(objs[0]);
    else if (objs.length) canvas().setActiveObject(new fabric.ActiveSelection(objs, { canvas: canvas() }));
    canvas().fire('selection:created', { selected: objs }); canvas().renderAll(); await frame();
  };
  const ids = set => [...set].map(o => o.mfcId).sort().join();
  const badges = () => [...document.querySelectorAll('.link-badges .link-badge')];
  const theme = async name => { $('theme-select').value = name; $('theme-select').dispatchEvent(new Event('change')); await frame(); };
  const lum = c => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const savedTheme = $('theme-select').value;

  try {
    const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
    await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
    document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
    await MFC_TIFF.whenIdle();
    MFC.setTool('select');
    // A quick figure of img1 (which keeps its inset img3).
    const M = await import(new URL('js/image/montage.js', document.baseURI).href);
    await select(byId('img1')); M.quickFigure([byId('img1')]); await MFC_TIFF.whenIdle(); await frame();

    // ---- a comparison group of three ----
    const raster = images().find(o => /raster/.test(o.mfcFileName || '') && !o.mfcMontageGroup && !o.mfcIsInset);
    assert('Setting up: the reference figure has a raster image', !!raster);
    await select(raster); MFC.copySelection(); await MFC.pasteSelection(); const c1 = canvas().getActiveObject();
    await select(raster); MFC.copySelection(); await MFC.pasteSelection(); const c2 = canvas().getActiveObject();
    c1.set({ left: raster.left + 30, top: raster.top + 260 }); c2.set({ left: raster.left + 330, top: raster.top + 260 }); c1.setCoords(); c2.setCoords();
    await select(raster, c1, c2); MFC.refreshSelectionBar();
    assert('Before linking, Link says which images it will link and whose settings they take', /^Link reference-raster\.png, reference-raster\.png, reference-raster\.png as Comparison group \d+: they take the range, LUT and gamma of reference-raster\.png/.test($('obj-link-compare').title), $('obj-link-compare').title);
    const objectsBefore = canvas().getObjects().length;
    $('obj-link-compare').click(); await frame();
    const group = raster.mfcCompareGroup;
    assert('Setting up: Link makes them a comparison group', Number.isInteger(group) && c1.mfcCompareGroup === group && c2.mfcCompareGroup === group);

    // ---- selecting a member highlights exactly its group ----
    await select(c1);
    let h = LP.linkedHighlight();
    assert('Selecting one member of a comparison group highlights exactly its three images', ids(h.members) === ids(new Set([raster, c1, c2])) && h.groups.length === 1 && h.groups[0].name === 'Comparison group ' + group, ids(h.members));
    assert('…each with a chain badge whose tooltip names the group', badges().length === 3 && badges().every(b => b.title.includes(`Comparison group ${group} (3 images)`) && b.getAttribute('role') === 'img' && b.getAttribute('aria-label') === b.title), badges().map(b => b.title).join(' | '));
    const inside = (b, o) => { const r = b.getBoundingClientRect(), u = canvas().upperCanvasEl.getBoundingClientRect(), k = u.width / canvas().getWidth(), v = canvas().viewportTransform, x = o.getBoundingRect(true, true);
      const L = u.left + (x.left * v[0] + v[4]) * k, T = u.top + (x.top * v[3] + v[5]) * k, R = L + x.width * v[0] * k, B = T + x.height * v[3] * k; return r.left >= L - 1 && r.right <= R + 1 && r.top >= T - 1 && r.bottom <= B + 1; };
    assert('…placed in its top-right corner', badges().every(b => inside(b, byId(b.dataset.id))) && badges().every(b => { const o = byId(b.dataset.id), r = b.getBoundingClientRect(), u = canvas().upperCanvasEl.getBoundingClientRect(); return r.left > u.left + (o.getBoundingRect().left + o.getBoundingRect().width / 2); }));
    // The outline: amber pixels just outside c2's top edge on the canvas (it is not selected).
    const ctx = canvas().getContext(), v = canvas().viewportTransform, bb = c2.getBoundingRect(true, true), ratio = canvas().lowerCanvasEl.width / canvas().getWidth();
    // An amber hue (red high, blue well below it) on the line just above the edge; it is anti-aliased, so a few rows are read.
    const amber = [...Array(20).keys()].some(i => [-1, 0, 1].some(dy => { const x = (bb.left + bb.width * (i + 0.5) / 20) * v[0] + v[4], y = (bb.top - 3 / v[0]) * v[3] + v[5] + dy;
      const p = ctx.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data; return p[0] > 220 && p[0] - p[2] > 90 && p[1] < 215; }));

    const probe = (() => { const x = (bb.left + bb.width / 2) * v[0] + v[4], y = (bb.top - 3 / v[0]) * v[3] + v[5]; return { x, y, w: canvas().getWidth(), h: canvas().getHeight(), ratio, vpt: v.slice(), bb, px: [...ctx.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data] }; })();
    assert('…and the other members get an amber dashed outline on the canvas', amber, JSON.stringify(probe));

    // ---- a quick figure and insets ----
    // The quick figure (a series montage is linked the same way: views of one image).
    const montage = images().find(o => o.mfcMontageGroup);
    assert('Setting up: a quick figure of img1', !!montage);
    const row = images().filter(o => o.mfcMontageGroup === montage.mfcMontageGroup);
    const kindName = row.some(o => o.mfcSeries && typeof o.mfcSeries === 'object') ? 'Series montage of ' : 'Quick figure of ';
    await select(row[row.length - 1]);
    h = LP.linkedHighlight();
    assert('Selecting a montage panel highlights exactly its row', row.length >= 2 && ids(h.members) === ids(new Set(row)) && h.groups.some(g => g.name.startsWith(kindName)), `${ids(h.members)} / ${h.groups.map(g => g.name)}`);
    assert('…its badges name the montage', badges().length === row.length && badges().every(b => b.title.includes(kindName)), badges().map(b => b.title).join(' | '));
    const inset = byId('img3'), source = byId('img1'), contour = byId(inset.mfcInsetContourId);
    await select(inset);
    h = LP.linkedHighlight();
    assert('Selecting an inset highlights exactly its source image and itself', ids(h.members) === ids(new Set([source, inset])) && h.groups.length === 1 && h.groups[0].name === 'Insets of ' + MFC.getRegistry().img1.rawImage.fileName, `${ids(h.members)} ${h.groups.map(g => g.name)}`);
    await select(contour);
    assert('…and so does its outline on the source image', ids(LP.linkedHighlight().members) === ids(new Set([source, inset])));
    await select(source);
    assert('Selecting the source image highlights its insets too', LP.linkedHighlight().members.has(inset) && LP.linkedHighlight().groups.some(g => g.kind === 'insets'));
    const text = canvas().getObjects().find(o => o.type === 'textbox' && !o.mfcMontageGroup);
    await select(text);
    assert('An unlinked object highlights nothing and shows no badge', LP.linkedHighlight().members.size === 0 && badges().length === 0);
    canvas().discardActiveObject(); canvas().renderAll(); await frame();
    assert('Nothing selected: no badge', badges().length === 0);

    // ---- Layers names the groups ----
    MFC.refreshLayersPanel(); await frame();
    const rowOf = o => [...document.querySelectorAll('#layers-list .layer-row')].find(r => r.querySelector('.layer-name').textContent === LY.layerLabel(o) && r.dataset.id === o.mfcId) ||
      [...document.querySelectorAll('#layers-list .layer-row')].find(r => r.querySelector('.layer-name').textContent === LY.layerLabel(o));
    const chainTitles = o => [...(rowOf(o)?.querySelectorAll('.layer-chain') || [])].map(c => c.title).join(' | ');
    assert('The Layers panel names the comparison group, the montage and the insets', /Comparison group \d+ \(3 images\)/.test(chainTitles(c2)) && chainTitles(row[1]).includes(kindName) && /Insets of .+ \(2 images\)/.test(chainTitles(inset)),
      [chainTitles(c2), chainTitles(row[1]), chainTitles(inset)].join(' // '));

    // ---- Unlink says what it will do, and removes only that panel ----
    await select(c1); MFC.refreshSelectionBar();
    assert('Unlink says which image leaves which group, and which stay linked', $('obj-unlink-compare').title === `Unlink: take reference-raster.png out of Comparison group ${group} (reference-raster.png, reference-raster.png stay linked).`, $('obj-unlink-compare').title);
    await select(row[0]); MFC.refreshSelectionBar();
    assert('On a montage panel it says those links stay', /none of the selected images is in a comparison group\. Quick-figure and series panels stay linked/.test($('obj-unlink-compare').title), $('obj-unlink-compare').title);
    await select(c1); MFC.refreshSelectionBar();
    $('obj-unlink-compare').click(); await frame();
    await select(raster);
    assert('After unlinking one panel, its former group highlights only the two left', ids(LP.linkedHighlight().members) === ids(new Set([raster, c2])) && badges().length === 2, ids(LP.linkedHighlight().members));
    await select(c1);
    assert('…and the unlinked panel highlights nothing', LP.linkedHighlight().members.size === 0 && badges().length === 0);
    await select(c2); MFC.refreshSelectionBar();
    assert('Unlinking the last pair says the group ends', /\(the group ends\)/.test($('obj-unlink-compare').title), $('obj-unlink-compare').title);

    // ---- the badge passes the mouse on to the canvas ----
    await select(raster);
    let downs = 0; const count = () => downs++; canvas().on('mouse:down', count);
    const badge = badges().find(b => b.dataset.id === c2.mfcId), r = badge.getBoundingClientRect();
    badge.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: r.left + 10, clientY: r.top + 10 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: r.left + 10, clientY: r.top + 10 })); await frame();
    canvas().off('mouse:down', count);
    assert('A click on a badge reaches the canvas (it selects the image under it)', downs === 1 && canvas().getActiveObject() === c2, `${downs} ${canvas().getActiveObject() && canvas().getActiveObject().mfcId}`);

    // ---- four themes ----
    for (const name of ['light', 'sage', 'dark', 'slate']) {
      await theme(name); await select(raster);
      const cs = getComputedStyle(badges()[0]);
      assert(`Theme ${name}: the badge is drawn in the theme's colours, readable`, cs.display !== 'none' && contrast(cs.color, cs.backgroundColor) >= 4.5 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)', `${cs.color} on ${cs.backgroundColor}`);
    }

    // ---- not part of the figure ----
    assert('Nothing is added to the figure: the same objects, none saved with a badge or outline', canvas().getObjects().length === objectsBefore && !MFC_PROJECT.captureState().objects.some(o => /link-badge|linked/i.test(o.type || '')));
    const svg = (await MFC_EXPORT.buildSVG()).svg;
    assert('…nor to the SVG export', !/f0a020/i.test(svg) && !/link-badge/.test(svg));
  } finally {
    await theme(savedTheme);
    canvas().discardActiveObject(); canvas().requestRenderAll();
  }
  return checks;
}

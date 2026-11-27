/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* PI-T1: the Inspector follows the selection. Clicking straight from one object to another (image A,
   image B, a vector panel, a text box, image A again), with mouse events on the canvas as a user
   would, shows each one's own name at once: the Inspector title, the Channels section's name and the
   selection bar. Deselecting clears the title. */
async function runInspectorRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas();
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const $ = id => document.getElementById(id);
  const client = (x, y) => {
    const el = canvas.upperCanvasEl, rect = el.getBoundingClientRect(), vpt = canvas.viewportTransform, k = rect.width / canvas.getWidth();
    return { clientX: rect.left + (x * vpt[0] + vpt[4]) * k, clientY: rect.top + (y * vpt[3] + vpt[5]) * k };
  };
  const mouse = (type, at, target = canvas.upperCanvasEl) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...at }));
  const click = async (x, y) => { mouse('mousedown', client(x, y)); mouse('mouseup', client(x, y), document); await frame(); };
  const clickOn = o => { const c = o.getCenterPoint(); return click(c.x, c.y); };
  const png = (color, w, h) => new Promise(r => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); c.toBlob(b => r(new File([b], color === '#c33' ? 'alpha.png' : 'beta.png', { type: 'image/png' })), 'image/png'); });
  const state = () => ({ title: $('inspector-context').textContent, channels: $('channel-image-name').textContent, bar: $('sel-label').textContent, active: canvas.getActiveObject() });

  await MFC_PROJECT.createProject({ name: 'Inspector', width: 1200, height: 800, unit: 'px', dpi: 300 });
  await frame();
  await MFC.importFiles([await png('#c33', 200, 150)]);
  await MFC.importFiles([await png('#33c', 120, 220)]);
  await MFC.importFiles([new File(['<svg xmlns="http://www.w3.org/2000/svg" width="144pt" height="72pt" viewBox="0 0 144 72"><rect width="144" height="72" fill="#3a3"/></svg>'], 'plot.svg', { type: 'image/svg+xml' })]);
  await MFC_TIFF.whenIdle();
  const [alpha, beta, plot] = ['alpha.png', 'beta.png', 'plot.svg'].map(n => canvas.getObjects().find(o => o.mfcFileName === n));
  [[alpha, 50, 50], [beta, 350, 50], [plot, 600, 50]].forEach(([o, left, top]) => { o.set({ left, top, scaleX: 0.5, scaleY: 0.5 }); o.setCoords(); });
  const text = new fabric.Textbox('Hello', { left: 50, top: 450, width: 200, fontSize: 40 });
  canvas.add(text); MFC.attachTextListeners(text);
  canvas.discardActiveObject(); canvas.requestRenderAll(); MFC.pushHistory();
  await frame();
  assert('The four objects are on the page', alpha && beta && plot && canvas.getObjects().includes(text));

  await clickOn(alpha);
  let s = state();
  assert('Clicking image A shows its name in the Inspector title, the Channels section and the selection bar',
    s.active === alpha && s.title === 'Channels — alpha.png' && s.channels === '— alpha.png' && s.bar === 'alpha.png', JSON.stringify({ ...s, active: undefined }));
  await clickOn(beta);
  s = state();
  assert('Clicking image B straight after A shows B at once (the title no longer keeps A)',
    s.active === beta && s.title === 'Channels — beta.png' && s.channels === '— beta.png' && s.bar === 'beta.png', JSON.stringify({ ...s, active: undefined }));
  await clickOn(plot);
  s = state();
  assert('Clicking a vector panel straight after B names the panel', s.active === plot && s.title === 'plot.svg (vector)' && s.bar === 'plot.svg (vector)', JSON.stringify({ ...s, active: undefined }));
  await clickOn(text);
  s = state();
  assert('Clicking a text box straight after the panel names the text box', s.active === text && /Text/.test(s.title) && !/plot\.svg|beta\.png/.test(s.title), JSON.stringify({ ...s, active: undefined }));
  await clickOn(alpha);
  s = state();
  assert('Clicking image A again shows A again', s.active === alpha && s.title === 'Channels — alpha.png' && s.channels === '— alpha.png', JSON.stringify({ ...s, active: undefined }));
  await click(1150, 750);
  s = state();
  assert('Clicking the empty page clears the selection and the title', !s.active && s.title === 'Select an object or tool' && s.bar === 'Nothing selected', JSON.stringify({ ...s, active: undefined }));
  return checks;
}

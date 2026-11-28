/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* PI-T13: templates that explain themselves (the preview's pure part: tests/templates-model-regression.mjs).
   - Acceptance: a new user can make and reuse a template from the dialog text alone. Both dialogs say
     what a template is and keeps (layout, styles, labels; no image data) and give the three steps;
     the test then does only what the steps say, finding each control by the name the text gives it
     (Save as template, Save, From template, Open a template file…, Create, Fill frame…), and ends
     with a filled frame;
   - New from template shows a preview of each template: the five built-ins and a template file,
     which becomes a choice of its own before it is opened; previews match the templates;
   - a template file's text stays text (names, labels and colours never become markup or links);
     bad files are refused with a message; the Save dialog's name, errors, keyboard, titles, themes. */
async function runTemplatesHelpRegressions() {
  const checks = [];
  const assert = (name, ok, detail) => { if (!ok) throw new Error(name + (detail != null ? ': ' + detail : '')); checks.push(name); };
  const canvas = MFC.getCanvas();
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const until = async (test, what) => { for (let i = 0; i < 400; i++) { if (test()) { await MFC_TIFF.whenIdle(); await frame(); return; } await new Promise(r => setTimeout(r, 10)); } throw new Error('Timed out waiting: ' + what); };
  const TU = await import(new URL('js/ui/templates.js', document.baseURI).href);
  const TM = await import(new URL('js/layout/template-model.js', document.baseURI).href);
  assert('The template dialogs have previews (PI-T13)', typeof TU.previewElement === 'function' && typeof TU.showSaveTemplateDialog === 'function' && typeof TM.templatePreview === 'function');
  const bytes = await (await fetch('tests/fixtures/reference.mfcproj.zip', { cache: 'no-store' })).arrayBuffer();
  await MFC_PROJECT.loadProject(new File([bytes], 'reference.mfcproj.zip'));
  document.querySelectorAll('.recovery-modal').forEach(m => m.remove());
  await MFC_TIFF.whenIdle();
  const images = canvas.getObjects().filter(o => o.mfcType === 'mfcImage' || o.mfcType === 'mfcVector').length;

  /** A visible button whose text is `name`, in `root`. */
  const buttonNamed = (name, root = document) => [...root.querySelectorAll('button')].filter(b => b.textContent.trim() === name && b.offsetParent !== null && !b.classList.contains('hidden'));
  /** Gives a file input a file, as the file picker does. */
  const choose = (input, file) => { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change')); };
  const tiff = (name, w = 100, h = 80) => {
    const desc = new TextEncoder().encode('ImageJ=1.54p\nimages=1\n\0'), tags = 10, planeBytes = w * h * 2, ifd = 8 + desc.length, data = ifd + 2 + tags * 12 + 4;
    const buf = new ArrayBuffer(data + planeBytes), dv = new DataView(buf), u8 = new Uint8Array(buf);
    u8.set([0x4d, 0x4d]); dv.setUint16(2, 42); dv.setUint32(4, ifd); u8.set(desc, 8);
    let q = ifd; dv.setUint16(q, tags); q += 2;
    const tag = (id, type, count, value) => { dv.setUint16(q, id); dv.setUint16(q + 2, type); dv.setUint32(q + 4, count); if (type === 3 && count === 1) dv.setUint16(q + 8, value); else dv.setUint32(q + 8, value); q += 12; };
    tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 16); tag(259, 3, 1, 1); tag(262, 3, 1, 1); tag(270, 2, desc.length, 8);
    tag(273, 4, 1, data); tag(277, 3, 1, 1); tag(278, 4, 1, h); tag(279, 4, 1, planeBytes);
    for (let k = 0; k < w * h; k++) dv.setUint16(data + k * 2, (k * 7) & 0x0fff);
    return new File([buf], name, { type: 'image/tiff' });
  };
  const toasts = [], toast = MFC_UI.toast, download = MFC_EXPORT.download;
  const templateInput = document.getElementById('template-input'), replaceInput = document.getElementById('replace-input');
  const pickerClicks = { template: 0, replace: 0 };
  let saved = null;
  MFC_UI.toast = message => { toasts.push(String(message)); };
  MFC_EXPORT.download = async (blob, name) => { saved = { name, text: await blob.text() }; };
  templateInput.click = () => { pickerClicks.template++; }; // the picker itself is the browser's: the test gives the file
  replaceInput.click = () => { pickerClicks.replace++; };
  try {
    // ================= The From template dialog explains, and shows previews =================
    document.getElementById('btn-new-from-template').click(); await frame();
    let dialog = document.querySelector('.template-modal');
    const text = dialog.textContent;
    assert('From template says what a template is and keeps: layout, styles and labels, empty frames, no image data',
      /A template is a figure without its images/.test(text) && /layout, styles and labels/.test(text) && /empty frame/.test(text) && /no image data/.test(text));
    const steps = [...dialog.querySelectorAll('.template-steps li')].map(li => li.textContent);
    assert('…and the three steps to make, save and reuse one, shown open', steps.length === 3 && /^Make:/.test(steps[0]) && /^Save:/.test(steps[1]) && /^Reuse:/.test(steps[2]) &&
      dialog.querySelector('details.template-help').open, steps.join(' | '));
    const names = [...dialog.querySelectorAll('.template-steps .template-control')].map(s => s.textContent);
    assert('The steps name the controls to use, in order', names.join() === 'Save as template,Save,From template,Open a template file…,Create,Fill frame…', names.join());
    const choices = [...dialog.querySelectorAll('.template-choice')];
    assert('Each of the five built-in templates has a preview, described for screen readers', choices.length === 5 && choices.every(c => c.querySelector('svg.template-preview[role="img"]')) &&
      choices.every(c => /^Preview of .+: \d+ empty frames/.test(c.querySelector('svg').getAttribute('aria-label'))));
    let previewOk = true, previewDetail = '';
    TM.BUILT_IN.forEach((b, i) => {
      const t = TM.builtInTemplate(b.id, 300), svg = choices[i].querySelector('svg'), p = TM.templatePreview(t);
      const frames = [...svg.querySelectorAll('rect[fill="#d5dae3"]')], texts = [...svg.querySelectorAll('text')].map(x => x.textContent);
      const frameCount = t.objects.filter(o => o.mfcType === 'imageFrame').length;
      const labels = t.objects.filter(o => o.type === 'textbox').map(o => o.text);
      const pf = p.items.filter(it => it.kind === 'frame');
      const placed = frames.every((r, k) => Math.abs(Number(r.getAttribute('x')) - pf[k].x) < 0.01 && Math.abs(Number(r.getAttribute('width')) - pf[k].w) < 0.01);
      if (frames.length !== frameCount || texts.join() !== labels.join() || !placed || svg.getAttribute('viewBox') !== `0 0 ${p.width} ${p.height}`) { previewOk = false; previewDetail += `${b.id}: ${frames.length}/${frameCount} ${texts.join()} `; }
    });
    assert('Each preview draws its template: the page, every empty frame in its place and every label', previewOk, previewDetail);
    assert('The single image with inset preview shows its inset outline in yellow', !!choices[0].querySelector('rect[stroke="#ffff00"]'));
    const controls = [...dialog.querySelectorAll('input, button, summary')];
    assert('Every control has a title (its own or its label\'s)', controls.every(c => (c.title || c.closest('[title]')?.title || '').length > 5));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert('Esc closes it', !document.querySelector('.template-backdrop'));

    // ================= Acceptance: making and reusing a template from the dialog text alone =================
    // The new user has built a figure (the reference figure) and reads the steps; they use only the names they read.
    const [saveAsName, saveName, fromName, openFileName, createName, fillName] = names;
    let found = buttonNamed(saveAsName);
    assert(`Step 2: "${saveAsName}" is a button in the top bar`, found.length === 1 && found[0].id === 'btn-save-template' && !!found[0].closest('.tool-group'));
    found[0].focus(); found[0].click(); await frame();
    dialog = document.querySelector('.template-save-modal');
    assert('It opens the Save as template dialog, which also says what a template keeps and the three steps', dialog && /A template is a figure without its images/.test(dialog.textContent) &&
      /no image data/.test(dialog.textContent) && dialog.querySelectorAll('.template-steps li').length === 3 && /same names/.test(dialog.textContent));
    const savePreview = dialog.querySelector('svg.template-preview');
    assert(`…with a preview of this figure as a template: its ${images} images as empty frames`, savePreview && savePreview.querySelectorAll('rect[fill="#d5dae3"]').length > 0 &&
      new RegExp(`: ${images} empty frames`).test(savePreview.getAttribute('aria-label')) && new RegExp(`${images} empty frames, \\d+ texts; 2 pages, the first one shown`).test(dialog.querySelector('.template-save-preview').textContent),
      savePreview && savePreview.getAttribute('aria-label'));
    const nameField = dialog.querySelector('#template-name');
    assert('…and the name field, focused, holding the figure\'s name', nameField && document.activeElement === nameField && nameField.value === MFC.getDocProps().name && nameField.closest('label').textContent.startsWith('Name'));
    nameField.value = '   ';
    buttonNamed(saveName, dialog)[0].click(); await frame();
    assert('An empty name: an error, nothing saved, the dialog stays open', !saved && document.querySelector('.template-save-modal') && /Give the template a name/.test(dialog.querySelector('.export-error').textContent));
    nameField.value = 'My panels';
    const last = buttonNamed(saveName, dialog)[0]; last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert('Tab from Save wraps to the name field', document.activeElement === nameField);
    found = buttonNamed(saveName, dialog);
    assert(`"${saveName}" is the dialog's button`, found.length === 1 && found[0].id === 'template-save-ok');
    found[0].click();
    await until(() => saved, 'the template file');
    const template = JSON.parse(saved.text);
    assert('Save writes the template file under the name given, with no image data', saved.name === 'My panels.fftemplate.json' && template.name === 'My panels' &&
      !TM.holdsImageData(template.objects) && template.objects.filter(o => o.mfcType === 'imageFrame').length === images, saved.name);
    assert('The dialog closes and the focus goes back to Save as template', !document.querySelector('.template-backdrop') && document.activeElement === document.getElementById('btn-save-template'));

    found = buttonNamed(fromName);
    assert(`Step 3: "${fromName}" is a button in the top bar`, found.length === 1 && found[0].id === 'btn-new-from-template');
    found[0].click(); await frame();
    dialog = document.querySelector('.template-modal');
    found = buttonNamed(openFileName, dialog);
    assert(`"${openFileName}" is a button of that dialog`, found.length === 1);
    found[0].click();
    assert('It opens the file picker for template files', pickerClicks.template === 1 && /fftemplate\.json/.test(templateInput.accept));
    choose(templateInput, new File([saved.text], saved.name, { type: 'application/json' }));
    await until(() => dialog.querySelector('#template-file-choice'), 'the file\'s choice');
    const fileChoice = dialog.querySelector('#template-file-choice'), fileLabel = fileChoice.closest('label');
    assert('The file is shown as a choice of its own, chosen and focused, before anything is opened', fileChoice.checked && document.activeElement === fileChoice &&
      fileLabel.querySelector('strong').textContent === 'My panels' && new RegExp(`From the file My panels\\.fftemplate\\.json: ${images} empty frames`).test(fileLabel.textContent) &&
      MFC.getDocProps().name !== 'My panels');
    const fileSvg = fileLabel.querySelector('svg.template-preview'), fp = TM.templatePreview(template);
    assert('…with its preview: every frame and text of the template\'s first page', fileSvg && fileSvg.querySelectorAll('rect[fill="#d5dae3"]').length === fp.items.filter(i => i.kind === 'frame').length &&
      fileSvg.querySelectorAll('text').length === fp.items.filter(i => i.kind === 'text').length && fp.items.filter(i => i.kind === 'frame').length > 0);
    found = buttonNamed(createName, dialog);
    assert(`"${createName}" is that dialog's button`, found.length === 1 && found[0].id === 'template-ok');
    found[0].click();
    await until(() => !document.querySelector('.template-backdrop'), 'the template to open');
    const frames = () => canvas.getObjects().filter(o => o.mfcType === 'imageFrame');
    assert('Create opens the template as a new figure: its name, an empty frame for each image', MFC.getDocProps().name === 'My panels' && frames().length === images && !canvas.getObjects().some(o => o.mfcType === 'mfcImage'));
    const target = frames().find(f => !f.mfcFrameInsetContour && !f.mfcFrameGroup);
    canvas.setActiveObject(target); canvas.fire('selection:created', { selected: [target] }); await frame();
    found = buttonNamed(fillName);
    assert(`With a frame selected, "${fillName}" is in the selection bar`, found.length === 1 && found[0].id === 'obj-replace-image');
    found[0].click();
    assert('It opens the file picker', pickerClicks.replace === 1);
    const id = target.mfcId;
    choose(replaceInput, tiff('mine.tif'));
    const byId = () => canvas.getObjects().find(o => o.mfcId === id);
    await until(() => byId() && byId().mfcType === 'mfcImage' || document.querySelector('.replace-backdrop'), 'filling the frame');
    if (document.querySelector('.replace-backdrop')) { document.querySelector('#replace-fresh').click(); await until(() => byId() && byId().mfcType === 'mfcImage', 'filling the frame'); }
    assert('The frame is filled with the chosen image: the template is reused', byId().mfcType === 'mfcImage' && byId().mfcFileName === 'mine.tif');

    // ================= A template file's text stays text; bad files =================
    document.getElementById('btn-new-from-template').click(); await frame();
    dialog = document.querySelector('.template-modal');
    const hostile = TM.builtInTemplate('comparison-2x3', 300);
    hostile.name = '<img src=x id=hostile-name>Evil';
    hostile.objects.find(o => o.type === 'textbox').text = '<b id="hostile-label">bold</b>';
    hostile.objects.find(o => o.type === 'textbox').fill = 'url(https://example.com/paint#p)';
    buttonNamed(openFileName, dialog)[0].click();
    choose(templateInput, new File([JSON.stringify(hostile)], '<i>x</i>.fftemplate.json', { type: 'application/json' }));
    await until(() => dialog.querySelector('#template-file-choice'), 'the hostile file\'s choice');
    const hLabel = dialog.querySelector('#template-file-choice').closest('label');
    assert('Names and labels from a file are shown as text, never as markup', !document.getElementById('hostile-name') && !document.getElementById('hostile-label') &&
      hLabel.querySelector('strong').textContent === '<img src=x id=hostile-name>Evil' && [...hLabel.querySelectorAll('text')].some(t => t.textContent === '<b id="hostile-label">bold</b>') &&
      /From the file <i>x<\/i>\.fftemplate\.json/.test(hLabel.textContent));
    assert('A colour that is not a colour (a link) is drawn in black instead', ![...dialog.querySelectorAll('svg *')].some(n => [...n.attributes].some(a => /url\(/i.test(a.value))) &&
      [...hLabel.querySelectorAll('text')].find(t => t.textContent === '<b id="hostile-label">bold</b>').getAttribute('fill') === '#000000');
    buttonNamed(openFileName, dialog)[0].click();
    choose(templateInput, new File([JSON.stringify(TM.builtInTemplate('time-series', 300))], 'strip.fftemplate.json', { type: 'application/json' }));
    await until(() => /strip\.fftemplate/.test(dialog.querySelector('#template-file-choice').closest('label').textContent), 'the second file');
    assert('Choosing another file replaces the file\'s choice (one at a time)', dialog.querySelectorAll('#template-file-choice').length === 1 && dialog.querySelectorAll('.template-choice').length === 6);
    buttonNamed(openFileName, dialog)[0].click();
    choose(templateInput, new File(['not json'], 'notes.txt'));
    await until(() => dialog.querySelector('.export-error').textContent, 'the error');
    assert('A file that is not JSON is refused with a message; the choices stay', /notes\.txt is not a template file/.test(dialog.querySelector('.export-error').textContent) && dialog.querySelectorAll('.template-choice').length === 6);
    buttonNamed(openFileName, dialog)[0].click();
    choose(templateInput, new File([JSON.stringify({ ...template, objects: [{ type: 'image', mfcType: 'mfcImage', sourceId: 'x', mfcId: 'img1' }] })], 'images.fftemplate.json'));
    await until(() => /image data/.test(dialog.querySelector('.export-error').textContent), 'the error');
    assert('A template holding image data is refused before it is shown', /images\.fftemplate\.json: .*image data/.test(dialog.querySelector('.export-error').textContent) &&
      /strip\.fftemplate/.test(dialog.querySelector('#template-file-choice').closest('label').textContent));

    // ================= Themes =================
    const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const contrast = (x, y) => { const [hi, lo] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (hi + 0.05) / (lo + 0.05); };
    const savedTheme = document.documentElement.dataset.theme, ratios = [];
    for (const theme of ['light', 'sage', 'dark', 'slate']) {
      document.documentElement.dataset.theme = theme;
      const bg = getComputedStyle(dialog).backgroundColor;
      for (const sel of ['.template-steps li', '.template-control', '.template-help summary', '.template-choice strong', '.template-choice .hint']) ratios.push(contrast(getComputedStyle(dialog.querySelector(sel)).color, bg));
    }
    if (savedTheme) document.documentElement.dataset.theme = savedTheme; else delete document.documentElement.dataset.theme;
    assert('The explanations are readable in all four themes (contrast ≥ 4.5); previews are white pages in every theme', ratios.every(r => r >= 4.5) &&
      getComputedStyle(dialog.querySelector('.template-preview')).backgroundColor === 'rgb(255, 255, 255)', ratios.map(r => r.toFixed(1)).join());
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  } finally {
    MFC_UI.toast = toast; MFC_EXPORT.download = download;
    delete templateInput.click; delete replaceInput.click;
    document.querySelectorAll('.template-backdrop, .replace-backdrop').forEach(b => b.remove());
  }
  return checks;
}

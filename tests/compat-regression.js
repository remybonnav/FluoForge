/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P1-T5: projects are saved as .fluoforge, and older projects keep opening. A legacy project
   (tests/compat/main-v0.22-project.mfcproj.zip, saved before the 0.1.0 reset) and a project saved by
   v0.1.0 (tests/compat/v0.1.0-project.mfcproj.zip) each open, save as .fluoforge and reopen identically. */
async function runCompatRegressions() {
  const checks=[];
  const assert=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};

  // Fabric numbers clip paths from one counter per session; renumber them before comparing exports.
  const renumber=svg=>{const ids=new Map();return svg.replace(/\b(?:CLIPPATH|SVGID)_\d+\b/g,id=>{if(!ids.has(id))ids.set(id,'FABRICID_'+ids.size);return ids.get(id);});};
  const snapshot=async()=>{
    const state=MFC_PROJECT.captureState();
    return {state,fingerprint:MFC_PROJECT.fingerprint(state),objects:state.objects.length,
      images:Object.keys(MFC.getRegistry()).length,svg:renumber((await MFC_EXPORT.buildSVG()).svg)};
  };
  const memoryHandle=name=>({name,blob:null,async isSameEntry(other){return this===other;},
    async createWritable(){const self=this;return{async write(blob){self.pending=blob;},async close(){self.blob=self.pending;},async abort(){self.pending=null;}};},
    async getFile(){return new File([this.blob],this.name);}});

  // ---- what the open dialogs accept ----
  const input=document.getElementById('project-input').accept.split(',');
  assert('The project file input accepts .fluoforge and every older name',
    ['.fluoforge','.mfcproj.zip','.zip','.json','.mfcproj.json','.gz','.mfcproj.json.gz'].every(ext=>input.includes(ext)));

  const fixtures=[
    {file:'main-v0.22-project.mfcproj.zip',what:'legacy project (before the 0.1.0 reset)'},
    {file:'v0.1.0-project.mfcproj.zip',what:'project saved by v0.1.0'}
  ];
  const savedPicker=window.showSaveFilePicker,savedOpen=window.showOpenFilePicker,savedDownload=MFC_EXPORT.download;
  try{
    for(const fixture of fixtures){
      const response=await fetch('tests/compat/'+fixture.file,{cache:'no-store'});
      assert(`The ${fixture.what} fixture is present`,response.ok);
      await MFC_PROJECT.loadProject(new File([await response.blob()],fixture.file));
      const opened=await snapshot();
      assert(`The ${fixture.what} opens (${opened.objects} objects, ${opened.images} images)`,MFC.hasDocument&&opened.objects>0&&opened.images>0);
      if(fixture.file.startsWith('v0.1.0')){
        const manifest=JSON.parse(await (await JSZip.loadAsync(await (await fetch('tests/compat/'+fixture.file,{cache:'no-store'})).blob())).file('manifest.json').async('string'));
        assert('The v0.1.0 fixture really was saved by FluoForge 0.1.0',manifest.appVersion==='0.1.0'&&manifest.format==='FluoForge');
      }

      // Save through the download fallback first (Firefox, Safari: no file picker, so no file handle)…
      const docName=(MFC.getDocProps().name||'figure').replace(/[\\/:*?"<>|]/g,'_');
      let downloaded=null;delete window.showSaveFilePicker;
      if(window.showSaveFilePicker)window.showSaveFilePicker=undefined;
      MFC_EXPORT.download=(blob,name)=>{downloaded={blob,name};};
      await MFC_PROJECT.saveProject(false);
      assert('Without a file picker, the project downloads as "'+docName+'.fluoforge"',downloaded&&downloaded.name===docName+'.fluoforge');
      MFC_EXPORT.download=savedDownload;

      // …then through the file picker (Chromium, Edge).
      let options=null;const handle=memoryHandle('picked.fluoforge');
      window.showSaveFilePicker=async opts=>{options=opts;return handle;};
      await MFC_PROJECT.saveProject(false);
      assert(`Save suggests "${docName}.fluoforge" and offers only .fluoforge`,options&&options.suggestedName===docName+'.fluoforge'&&
        JSON.stringify(options.types.map(t=>Object.values(t.accept).flat()))===JSON.stringify([['.fluoforge']]));
      const bytes=new Uint8Array(await handle.blob.arrayBuffer());
      const manifest=JSON.parse(await (await JSZip.loadAsync(handle.blob)).file('manifest.json').async('string'));
      assert('The .fluoforge file is the same zip format, with manifest.format "FluoForge"',bytes[0]===0x50&&bytes[1]===0x4b&&manifest.format==='FluoForge');

      // Reopen both saved files: the figure must be identical to what was opened.
      for(const [how,blob] of [['picker',handle.blob],['download',downloaded.blob]]){
        await MFC.closeDocument();
        await MFC_PROJECT.loadProject(new File([blob],docName+'.fluoforge'));
        const reopened=await snapshot();
        assert(`${fixture.what}: the .fluoforge from the ${how} reopens with the same state`,reopened.fingerprint===opened.fingerprint&&
          reopened.objects===opened.objects&&reopened.images===opened.images);
        assert(`${fixture.what}: the .fluoforge from the ${how} exports a byte-identical SVG`,reopened.svg===opened.svg);
      }

      // The open picker offers .fluoforge and the older names, and opens a .fluoforge file.
      let openOptions=null;const saved=memoryHandle(docName+'.fluoforge');saved.blob=handle.blob;
      window.showOpenFilePicker=async opts=>{openOptions=opts;return [saved];};
      await MFC_PROJECT.pickAndLoadProject();
      const offered=openOptions?openOptions.types.flatMap(t=>Object.values(t.accept).flat()):[];
      assert('The open picker offers .fluoforge, .mfcproj.zip, .zip, .json and .gz',['.fluoforge','.mfcproj.zip','.zip','.json','.gz'].every(ext=>offered.includes(ext)));
      assert(`${fixture.what}: opening the .fluoforge through the picker gives the same state`,MFC_PROJECT.fingerprint(MFC_PROJECT.captureState())===opened.fingerprint);
    }
  }finally{
    if(savedPicker)window.showSaveFilePicker=savedPicker;else delete window.showSaveFilePicker;
    if(savedOpen)window.showOpenFilePicker=savedOpen;else delete window.showOpenFilePicker;
    MFC_EXPORT.download=savedDownload;
  }
  return {checks};
}

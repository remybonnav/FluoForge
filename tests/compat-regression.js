/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P1-T8: old projects open in every new version (docs/PROJECT-FORMAT.md).
   For every fixture in tests/compat/index.json: it opens without error, matches its expected.json,
   exports an SVG matching its export.svg, keeps its source images byte for byte, and a migrated
   project's first save keeps the untouched original as a version. Then: saving as .fluoforge through
   the file picker and the download fallback (P1-T5), a damaged source, and a project from a newer
   version, which loads what it understands, keeps the rest when saving and says so. */
async function runCompatRegressions() {
  const checks=[];
  const assert=(name,ok,detail)=>{if(!ok)throw new Error(name+(detail?': '+detail:''));checks.push(name);};
  const load=src=>new Promise((ok,no)=>{const s=document.createElement('script');s.src=src+'?run='+Date.now();s.onload=ok;s.onerror=()=>no(new Error('Cannot load '+src));document.head.append(s);});
  await load('tests/compat-summary.js');await load('tests/reference-check.js');
  const fetchOk=async path=>{const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw new Error('Missing '+path);return r;};
  const sha256=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
  const sameBytes=async(a,b)=>{const x=new Uint8Array(await a.arrayBuffer()),y=new Uint8Array(await b.arrayBuffer());return x.length===y.length&&x.every((v,i)=>v===y[i]);};
  const dismissRecovery=()=>document.querySelectorAll('.recovery-modal').forEach(m=>m.remove());
  const open=async(blob,name)=>{await MFC_PROJECT.loadProject(new File([blob],name));dismissRecovery();};
  const saveToBlob=async()=>{const next=MFC_PROJECT.prepareSave(false,'');const blob=await MFC_PROJECT.buildArchive(next);await MFC_PROJECT.commitSave(next);return blob;};
  const readZip=async blob=>{const zip=await JSZip.loadAsync(blob);const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
    const states={};for(const v of manifest.versions)states[v.id]=JSON.parse(await zip.file(v.statePath).async('string'));return {zip,manifest,states};};
  // The original image bytes a legacy file embeds, by file name.
  const legacyImages=async(blob,name)=>{
    const bytes=new Uint8Array(await blob.arrayBuffer()),images={};
    if(bytes[0]===0x50&&bytes[1]===0x4b){const zip=await JSZip.loadAsync(blob),m=JSON.parse(await zip.file('manifest.json').async('string'));
      if(m.version>=3){for(const s of m.sources)images[s.name]=await zip.file(s.path).async('blob');return images;}
      for(const o of m.objects)if(o.imageArchivePath)images[o.fileName]=await zip.file(o.imageArchivePath).async('blob');return images;}
    const text=bytes[0]===0x1f&&bytes[1]===0x8b?await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text():await blob.text();
    // The page's CSP does not let fetch() read data: URLs, so decode the base64 here.
    for(const o of JSON.parse(text).objects)if(o.fileBase64)images[o.fileName]=new Blob([Uint8Array.from(atob(o.fileBase64.split(',')[1]),c=>c.charCodeAt(0))]);
    return images;
  };

  const index=await (await fetchOk('tests/compat/index.json')).json();
  assert('The fixture index lists legacy formats and every release from v0.1.0',index.fixtures.some(f=>f.kind==='legacy')&&index.fixtures.some(f=>f.name==='v0.1.0'));
  for(const fixture of index.fixtures){
    const dir='tests/compat/'+fixture.name+'/';
    const expected=await (await fetchOk(dir+'expected.json')).json();
    const file=await (await fetchOk(dir+expected.project)).blob();
    const exportSvg=await (await fetchOk(dir+'export.svg')).text();
    const label=`${fixture.name} (${fixture.what})`;

    // 1. Opens without error and matches expected.json.
    await MFC.closeDocument();
    await open(file,expected.project);
    const opened=MFC_PROJECT.captureState();
    const differences=compatDifferences(compatWithoutMeasuredText(compatSummary(opened)),compatWithoutMeasuredText(expected.summary));
    assert(`${label}: opens and matches expected.json (${expected.summary.objectCount} objects)`,MFC.hasDocument&&differences.length===0,differences.slice(0,5).join('; '));
    assert(`${fixture.name}: opening shows no newer-version notice`,!/some content may not display/.test(document.getElementById('project-status').textContent));

    // 2. Exports the same SVG.
    await document.fonts.ready;
    const svg=(await MFC_EXPORT.buildSVG()).svg;
    // export.svg is a Chromium render, like tests/fixtures/reference.svg. Other browsers measure text a
    // fraction of a pixel differently, so they get a 0.5 px tolerance on numbers; the element tree,
    // every attribute and the embedded images' pixels must still match.
    const chromium=/Chrome\//.test(navigator.userAgent),strict=REFERENCE_TOLERANCE.number;
    if(!chromium)REFERENCE_TOLERANCE.number=0.5;
    let svgError='',svgStats=null;try{svgStats=await compareSVG(svg,exportSvg);}catch(e){svgError=e.message;}finally{REFERENCE_TOLERANCE.number=strict;}
    assert(`${fixture.name}: the SVG export matches export.svg within ${chromium?strict:0.5} px${svgStats?` (${svgStats.elements} elements, ${svgStats.images} images)`:''}`,!svgError,svgError);

    // 3. Saving copies every source image byte for byte, under the SHA-256 that names it.
    const migrated=!!MFC_PROJECT.context.originalVersionId;
    const originalState=migrated?JSON.parse(JSON.stringify(MFC_PROJECT.context.states[MFC_PROJECT.context.originalVersionId])):null;
    const versionsBefore=MFC_PROJECT.context.versions.length;
    const saved=await saveToBlob();
    const {zip,manifest,states}=await readZip(saved);
    const embedded=await legacyImages(file);
    let sourcesOk=manifest.sources.length===Object.keys(embedded).length;
    for(const source of manifest.sources){
      const bytes=await zip.file(source.path).async('blob');
      sourcesOk=sourcesOk&&source.id==='src-'+await sha256(bytes)&&embedded[source.name]&&await sameBytes(bytes,embedded[source.name]);
    }
    assert(`${fixture.name}: the saved sources are the original image bytes, and their SHA-256 matches their id (${manifest.sources.length})`,sourcesOk);

    // 4. A migrated project keeps its untouched original as a version; a current one is saved in place.
    if(migrated){
      const original=manifest.versions.find(v=>v.id===manifest.versions[0].id);
      assert(`${fixture.name}: the first save keeps the original state untouched as a version, and adds the migrated figure`,
        manifest.versions.length===versionsBefore+1&&JSON.stringify(states[original.id])===JSON.stringify(originalState)&&
        states[manifest.currentVersionId].schema===MFC_PROJECT.SCHEMA&&manifest.versions.at(-1).parentVersionId===original.id);
    } else assert(`${fixture.name}: a current-format project is saved in place`,manifest.versions.length===versionsBefore);

    // 5. The saved file reopens identically.
    await MFC.closeDocument();
    await open(saved,'saved.fluoforge');
    assert(`${fixture.name}: the saved file reopens with the same figure`,MFC_PROJECT.fingerprint(MFC_PROJECT.captureState())===MFC_PROJECT.fingerprint(opened)&&
      compatDifferences(compatWithoutMeasuredText(compatSummary(MFC_PROJECT.captureState())),compatWithoutMeasuredText(expected.summary)).length===0);
    if(migrated){
      const original=manifest.versions[0];
      await MFC_PROJECT.restoreVersion(original.id);
      assert(`${fixture.name}: the kept original version restores to the same figure`,compatDifferences(compatWithoutMeasuredText(compatSummary(MFC_PROJECT.captureState())),compatWithoutMeasuredText(expected.summary)).length===0);
    }
  }

  // ---- Save as .fluoforge, through the file picker and the download fallback (P1-T5) ----
  const memoryHandle=name=>({name,blob:null,async isSameEntry(other){return this===other;},
    async createWritable(){const self=this;return{async write(blob){self.pending=blob;},async close(){self.blob=self.pending;},async abort(){self.pending=null;}};},
    async getFile(){return new File([this.blob],this.name);}});
  const input=document.getElementById('project-input').accept.split(',');
  assert('The project file input accepts .fluoforge and every older name',
    ['.fluoforge','.mfcproj.zip','.zip','.json','.mfcproj.json','.gz','.mfcproj.json.gz'].every(ext=>input.includes(ext)));
  const savedPicker=window.showSaveFilePicker,savedOpen=window.showOpenFilePicker,savedDownload=MFC_EXPORT.download;
  try{
    for(const name of ['legacy-v0.22','v0.1.0']){
      const expected=await (await fetchOk(`tests/compat/${name}/expected.json`)).json();
      await MFC.closeDocument();
      await open(await (await fetchOk(`tests/compat/${name}/${expected.project}`)).blob(),expected.project);
      const before=MFC_PROJECT.fingerprint(MFC_PROJECT.captureState());
      const docName=(MFC.getDocProps().name||'figure').replace(/[\\/:*?"<>|]/g,'_');
      let downloaded=null;delete window.showSaveFilePicker;if(window.showSaveFilePicker)window.showSaveFilePicker=undefined;
      MFC_EXPORT.download=(blob,file)=>{downloaded={blob,name:file};};
      await MFC_PROJECT.saveProject(false);
      assert(`${name}: without a file picker, the project downloads as "${docName}.fluoforge"`,downloaded&&downloaded.name===docName+'.fluoforge');
      MFC_EXPORT.download=savedDownload;
      let options=null;const handle=memoryHandle('picked.fluoforge');
      window.showSaveFilePicker=async opts=>{options=opts;return handle;};
      await MFC_PROJECT.saveProject(false);
      assert(`${name}: Save suggests "${docName}.fluoforge" and offers only .fluoforge`,options&&options.suggestedName===docName+'.fluoforge'&&
        JSON.stringify(options.types.map(t=>Object.values(t.accept).flat()))===JSON.stringify([['.fluoforge']]));
      const bytes=new Uint8Array(await handle.blob.arrayBuffer());
      assert(`${name}: the .fluoforge file is a zip with manifest.format "FluoForge"`,bytes[0]===0x50&&bytes[1]===0x4b&&(await readZip(handle.blob)).manifest.format==='FluoForge');
      for(const [how,blob] of [['picker',handle.blob],['download',downloaded.blob]]){
        await MFC.closeDocument();await open(blob,docName+'.fluoforge');
        assert(`${name}: the .fluoforge from the ${how} reopens with the same state`,MFC_PROJECT.fingerprint(MFC_PROJECT.captureState())===before);
      }
      let openOptions=null;const savedHandle=memoryHandle(docName+'.fluoforge');savedHandle.blob=handle.blob;
      window.showOpenFilePicker=async opts=>{openOptions=opts;return [savedHandle];};
      await MFC_PROJECT.pickAndLoadProject();dismissRecovery();
      const offered=openOptions?openOptions.types.flatMap(t=>Object.values(t.accept).flat()):[];
      assert(`${name}: the open picker offers .fluoforge, .mfcproj.zip, .zip, .json and .gz, and opens the file`,
        ['.fluoforge','.mfcproj.zip','.zip','.json','.gz'].every(ext=>offered.includes(ext))&&MFC_PROJECT.fingerprint(MFC_PROJECT.captureState())===before);
    }
  }finally{
    if(savedPicker)window.showSaveFilePicker=savedPicker;else delete window.showSaveFilePicker;
    if(savedOpen)window.showOpenFilePicker=savedOpen;else delete window.showOpenFilePicker;
    MFC_EXPORT.download=savedDownload;
  }

  // ---- A damaged source image is refused, and the open figure is left alone ----
  const current=index.fixtures.filter(f=>f.kind==='release').at(-1).name;
  const currentExpected=await (await fetchOk(`tests/compat/${current}/expected.json`)).json();
  const currentFile=await (await fetchOk(`tests/compat/${current}/${currentExpected.project}`)).blob();
  {
    await MFC.closeDocument();await open(currentFile,currentExpected.project);
    const before=MFC_PROJECT.fingerprint(MFC_PROJECT.captureState());
    const {zip,manifest}=await readZip(currentFile);
    const source=manifest.sources[0],bytes=new Uint8Array(await zip.file(source.path).async('arraybuffer'));
    bytes[bytes.length>>1]^=0xff;zip.file(source.path,bytes);
    let message='';try{await MFC_PROJECT.loadProject(new File([await zip.generateAsync({type:'blob'})],'damaged.fluoforge'));}catch(e){message=e.message;}
    assert('A source whose bytes do not match its SHA-256 is refused with a clear message',message.includes(source.name)&&/damaged/.test(message),message);
    assert('…and the open figure is unchanged',MFC_PROJECT.fingerprint(MFC_PROJECT.captureState())===before);
  }

  // ---- A project saved by a newer version ----
  {
    const {zip,manifest,states}=await readZip(currentFile);
    const state=states[manifest.currentVersionId];
    Object.assign(manifest,{version:MFC_PROJECT.FORMAT+1,appVersion:'9.1.0',futureManifestField:{kept:true}});
    state.schema=MFC_PROJECT.SCHEMA+1;state.futureStateField=[1,2,3];state.docProps.futureDocField='kept';
    const rect=state.objects.find(o=>o.mfcShapeKind==='rect');rect.futureStyle={glow:4};
    const hologram={type:'hologram',mfcType:'hologram',mfcId:'futureHologram',left:20,top:20,width:50,height:50,futureData:'x'};
    state.objects.splice(2,0,hologram);
    zip.file('manifest.json',JSON.stringify(manifest));zip.file(manifest.versions.find(v=>v.id===manifest.currentVersionId).statePath,JSON.stringify(state));
    const future=await zip.generateAsync({type:'blob'});
    await MFC.closeDocument();
    let error=null;try{await open(future,'future.fluoforge');}catch(e){error=e;}
    assert('A project from a newer version opens without error',!error&&MFC.hasDocument,error&&error.message);
    assert('…and says "Saved by FluoForge v9.1.0; some content may not display"',
      document.getElementById('project-status').textContent==='Saved by FluoForge v9.1.0; some content may not display.'&&
      document.getElementById('toast').textContent==='Saved by FluoForge v9.1.0; some content may not display.');
    const live=MFC.getCanvas().getObjects().filter(o=>o.mfcId&&!o.mfcIsPageBounds);
    assert('…loads every object it understands, and leaves out the one it cannot draw',live.length===state.objects.length-1&&!live.some(o=>o.mfcId==='futureHologram'));
    let exportError='';try{await MFC_EXPORT.buildSVG();}catch(e){exportError=e.message;}
    assert('…export refuses with a clear message rather than leave the object out',/"hologram" object from a newer FluoForge/.test(exportError),exportError);
    // Edit something, undo it, and save: the unknown content must come back unchanged.
    const liveRect=live.find(o=>o.mfcId===rect.mfcId);liveRect.set({left:liveRect.left+10});MFC.pushHistory();await MFC.undo();
    const blob=await saveToBlob();
    const out=await readZip(blob),outState=out.states[out.manifest.currentVersionId];
    assert('Saving keeps the unknown manifest field and the newer format number',
      JSON.stringify(out.manifest.futureManifestField)==='{"kept":true}'&&out.manifest.version===MFC_PROJECT.FORMAT+1);
    assert('Saving keeps the unknown state field, the newer schema and the unknown document field',
      JSON.stringify(outState.futureStateField)==='[1,2,3]'&&outState.schema===MFC_PROJECT.SCHEMA+1&&outState.docProps.futureDocField==='kept');
    assert('Saving keeps the object it could not draw, unchanged and in its place',JSON.stringify(outState.objects[2])===JSON.stringify(hologram));
    assert('Saving keeps an unknown field on an object it understands',JSON.stringify(outState.objects.find(o=>o.mfcId===rect.mfcId).futureStyle)==='{"glow":4}');
    assert('The saved project still opens',await open(blob,'future-saved.fluoforge').then(()=>true,()=>false)&&MFC.getCanvas().getObjects().filter(o=>o.mfcId&&!o.mfcIsPageBounds).length===state.objects.length-1);
    await MFC.closeDocument();
    await open(currentFile,currentExpected.project);
    assert('Opening a current project afterwards shows no notice and keeps nothing from the newer one',
      !/some content may not display/.test(document.getElementById('project-status').textContent)&&!('futureStateField' in MFC_PROJECT.captureState()));
  }
  return {checks};
}

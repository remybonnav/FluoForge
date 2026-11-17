async function runProjectExportRegressions() {
  const checks=[], assert=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};
  const canvas=MFC.getCanvas();
  MFC.applyDocProps({name:'Publication verification',width:3800,height:2400,unit:'px',dpi:300});
  await document.fonts.load('72px "Liberation Sans"');
  const imported=async path=>{const response=await fetch(path);if(!response.ok)throw new Error('Generate tests/fixtures first');return new File([await response.blob()],path.split('/').pop());};
  await MFC.importFiles([await imported('/tests/fixtures/large-multichannel.tif')]);
  const image=canvas.getActiveObject(), reg=MFC.getRegistry();
  assert('large TIFF has three original channels',reg[image.mfcId].rawImage.channels.length===3);
  assert('large source exceeds editing preview',reg[image.mfcId].rawImage.width>image.width);
  image.set({left:100,top:240,scaleX:1.32,scaleY:1.32});image.setCoords();
  reg[image.mfcId].rawImage.voxelSizeUm=0.25;
  const text=new fabric.Textbox('FluoForge verification',{left:130,top:120,width:1600,fontFamily:'Liberation Sans',fontSize:72,angle:-3,fill:'#172031'});
  text.mfcId='verificationTitle';text.mfcType='text';text.mfcBorderWidth=2;text.mfcBorderColor='#172031';MFC.attachTextListeners(text);canvas.add(text);
  const contour=new fabric.Rect({left:450,top:500,width:340,height:280,fill:'transparent',stroke:'#ffff00',strokeWidth:5,strokeDashArray:[18,10]});
  contour.mfcId='verificationContour';contour.mfcType='insetContour';contour.mfcInsetSourceId=image.mfcId;canvas.add(contour);
  MFC.createInsetFromContour(contour);const inset1=canvas.getActiveObject();inset1.set({left:2940,top:240,scaleX:1.65,scaleY:1.65});inset1.setCoords();
  MFC.copySelection();await MFC.pasteSelection();canvas.discardActiveObject();const inset2=canvas.getObjects().filter(o=>o.mfcIsInset).at(-1);
  inset2.set({left:2940,top:830});inset2.setCoords();
  reg[inset1.mfcId].rawImage.channels.forEach((c,i)=>c.enabled=i===0);
  reg[inset2.mfcId].rawImage.channels.forEach((c,i)=>c.enabled=i===1);
  MFC.recomposite(inset1);MFC.recomposite(inset2);
  canvas.setActiveObject(image);MFC.refreshScaleBarRefList();document.getElementById('sb-length').value=100;document.getElementById('sb-color').value='#000000';MFC.placeScaleBarAtCorner('bottom-right',5);
  const curve=new fabric.Path('M 150 1850 Q 750 1520 1600 1870',{stroke:'#b31860',strokeWidth:9,fill:'transparent',opacity:0.8});
  curve.mfcId='verificationCurve';curve.mfcType='shape';curve.mfcShapeKind='curve';MFC.installCurveControls(curve);canvas.add(curve);
  const groupedText=new fabric.Text('Native vectors + selectable text',{left:160,top:1930,fontFamily:'Liberation Sans',fontSize:44,fill:'#111111'});
  groupedText.mfcId='verificationGroupText';
  canvas.add(groupedText);canvas.setActiveObject(new fabric.ActiveSelection([curve,groupedText],{canvas}));MFC.groupSelection();canvas.discardActiveObject();
  // A clipped, rotated translucent duplicate tests image geometry and SVG clip handling.
  canvas.setActiveObject(image);MFC.copySelection();await MFC.pasteSelection();const clipped=canvas.getActiveObject();
  clipped.set({left:2280,top:1630,width:400,height:270,cropX:120,cropY:140,scaleX:1,scaleY:1,angle:12,opacity:0.65});
  clipped.clipPath=new fabric.Circle({radius:110,originX:'center',originY:'center'});clipped.setCoords();
  const clipLabel=new fabric.Text('Clipped + rotated image',{left:2250,top:2070,fontFamily:'Liberation Sans',fontSize:36,fill:'#222222'});
  clipLabel.mfcId='clipLabel';canvas.add(clipLabel);
  canvas.setActiveObject(new fabric.ActiveSelection([clipped,clipLabel],{canvas}));MFC.groupSelection();
  canvas.discardActiveObject();MFC.pushHistory();
  const flatten=objects=>objects.flatMap(o=>[o,...flatten(o.objects||[])]);
  const memoryHandle=name=>({name,blob:null,async isSameEntry(other){return this===other;},async createWritable(){const self=this;return{async write(blob){self.pending=blob;},async close(){self.blob=self.pending;},async abort(){self.pending=null;}};}});
  const h1=memoryHandle('version1.mfcproj.zip'),h2=memoryHandle('version2.mfcproj.zip'),h3=memoryHandle('version3.mfcproj.zip');
  const picker=window.showSaveFilePicker;window.showSaveFilePicker=async()=>h1;
  document.getElementById('version-name').value='Version 1';await MFC_PROJECT.saveProject(false);
  assert('Save Project creates version 1',!!h1.blob && MFC_PROJECT.context.versions.length===1);
  const firstSize=h1.blob.size,firstBlob=h1.blob;
  await MFC.importFiles([await imported('/tests/fixtures/second.png')]);const second=canvas.getActiveObject();second.set({left:1800,top:1900});second.setCoords();
  window.showSaveFilePicker=async()=>h2;document.getElementById('version-name').value='Version 2';await MFC_PROJECT.saveProject(true);
  assert('Save As retains earlier versions',MFC_PROJECT.context.versions.length===2);
  assert('Save As leaves previous file untouched',h1.blob===firstBlob && h1.blob.size===firstSize);
  canvas.remove(second);canvas.discardActiveObject();MFC.pushHistory();
  window.showSaveFilePicker=async()=>h3;document.getElementById('version-name').value='Version 3';await MFC_PROJECT.saveProject(true);
  assert('three versions saved',MFC_PROJECT.context.versions.length===3);
  const zip=await JSZip.loadAsync(h3.blob),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  assert('one source file per distinct import across versions',Object.values(zip.files).filter(f=>!f.dir&&f.name.startsWith('sources/')).length===2);
  assert('ZIP contains three separate state JSON files',Object.values(zip.files).filter(f=>!f.dir&&f.name.startsWith('versions/')).length===3);
  assert('version parents form saved chain',manifest.versions[1].parentVersionId===manifest.versions[0].id&&manifest.versions[2].parentVersionId===manifest.versions[1].id);
  const stateStrings=await Promise.all(manifest.versions.map(v=>zip.file(v.statePath).async('string')));
  assert('states contain no source bytes or preview PNGs',stateStrings.every(s=>!s.includes('base64')&&!s.includes('data:image')));
  for (const [i,version] of manifest.versions.entries()) {
    await MFC_PROJECT.restoreVersion(version.id);
    const state=MFC_PROJECT.captureState();
    assert('version '+(i+1)+' restores correct image count',flatten(state.objects).filter(o=>o.mfcType==='mfcImage').length===(i===1?5:4));
    assert('version '+(i+1)+' preserves editable group',canvas.getObjects().some(o=>o.type==='group'&&o.getObjects().some(c=>c.mfcShapeKind==='path'&&c.mfcPathNodes)));
    const views=canvas.getObjects().filter(o=>o.mfcIsInset);
    assert('version '+(i+1)+' preserves independent inset channels',MFC.getRegistry()[views[0].mfcId].rawImage.channels[0].enabled&&!MFC.getRegistry()[views[1].mfcId].rawImage.channels[0].enabled);
  }
  await MFC_PROJECT.loadProject(new File([h3.blob],'three-versions.mfcproj.zip'));
  assert('reopened archive retains all versions',MFC_PROJECT.context.versions.length===3);
  for (const button of document.querySelectorAll('.recovery-modal button')) if (button.textContent==='Discard') await button.onclick();
  // Test refusal to overwrite the previous file with Save As.
  window.showSaveFilePicker=async()=>h3;
  await MFC_PROJECT.saveProject(false);const vcount=MFC_PROJECT.context.versions.length;
  await MFC_PROJECT.saveProject(true);assert('same-file Save As rejected',MFC_PROJECT.context.versions.length===vcount);
  window.showSaveFilePicker=picker;
  // Legacy ZIP, embedded JSON and gzip JSON migrate to one editable version.
  const secondFile=await imported('/tests/fixtures/second.png');
  const raw=await MFC_TIFF.decodeRasterImage(secondFile);
  const legacy={version:2,docProps:{name:'Legacy',width:800,height:600,unit:'px',dpi:300},nextId:3,objects:[{
    mfcId:'legacyImg',mfcType:'mfcImage',fileName:'second.png',sourceFormat:'raster',imageArchivePath:'images/img0.tiff',
    left:30,top:40,scaleX:2,scaleY:2,angle:10,width:100,height:90,cropX:20,cropY:10,
    channels:raw.channels.map(({data,...c})=>c),voxelSizeUm:0.5
  }]};
  const legacyZip=new JSZip();legacyZip.file('manifest.json',JSON.stringify(legacy));legacyZip.file('images/img0.tiff',secondFile);
  await MFC_PROJECT.loadProject(new File([await legacyZip.generateAsync({type:'blob'})],'old.mfcproj.zip'));
  assert('legacy ZIP migrates to version 1',MFC_PROJECT.context.versions.length===1&&canvas.getObjects().find(o=>o.mfcId==='legacyImg').cropX===20);
  legacy.objects[0].fileBase64=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(secondFile);});
  delete legacy.objects[0].imageArchivePath;
  for (const gzip of [false,true]) {
    let bytes=new Blob([JSON.stringify(legacy)]);
    if(gzip) bytes=await new Response(bytes.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    await MFC_PROJECT.loadProject(new File([bytes],gzip?'old.json.gz':'old.json'));
    assert('legacy '+(gzip?'gzip':'JSON')+' migrates',MFC_PROJECT.context.versions.length===1&&MFC.getRegistry().legacyImg.rawImage.voxelSizeUm===0.5);
  }
  await MFC_PROJECT.loadProject(new File([h3.blob],'three-versions.mfcproj.zip'));
  for (const button of document.querySelectorAll('.recovery-modal button')) if (button.textContent==='Discard') await button.onclick();
  const pdf=await MFC_EXPORT.buildPDF(),svg=await MFC_EXPORT.buildSVG(),tiff=await MFC_EXPORT.buildTIFF();
  assert('PDF source panels exceed preview resolution',pdf.imageDetails.some(i=>i.width>i.previewWidth));
  assert('SVG contains vector paths and selectable text',svg.svg.includes('<path')&&svg.svg.includes('<text'));
  assert('SVG retains image clipping and opacity',svg.svg.includes('clipPath')&&svg.svg.includes('opacity: 0.65'));
  window.__verification={pdf:pdf.blob,svg:new Blob([svg.svg],{type:'image/svg+xml'}),tiff:tiff.blob,zip:h3.blob,imageDetails:pdf.imageDetails};
  // Font/glyph failures must be explicit and must never produce a flattened PDF.
  const fontText=canvas.getObjects().find(o=>o.mfcId==='verificationTitle');
  fontText.set('fontFamily','Verdana');let rejected=false;
  try {await MFC_EXPORT.buildPDF();}catch(error){rejected=error.message.includes('Verdana');}
  assert('unsupported PDF font identified',rejected);fontText.set('fontFamily','Liberation Sans');
  const originalText=fontText.text;fontText.set('text','Missing glyph 😀');rejected=false;
  try {await MFC_EXPORT.buildPDF();}catch(error){rejected=error.message.includes('glyph');}
  assert('unsupported PDF glyph identified',rejected);fontText.set('text',originalText);
  window.showSaveFilePicker=async()=>h3;await MFC_PROJECT.saveProject(false);window.showSaveFilePicker=picker;
  const before=await MFC_AUTOSAVE.candidates(MFC_PROJECT.context.projectId);assert('manual save has no newer draft',before.length===0);
  const title=canvas.getObjects().find(o=>o.mfcId==='verificationTitle');title.set({text:'Recovered after manual save'});MFC.pushHistory();
  await new Promise(r=>setTimeout(r,5));await MFC_AUTOSAVE.checkpoint();
  const drafts=await MFC_AUTOSAVE.candidates(MFC_PROJECT.context.projectId);
  assert('changed state creates newer recovery',drafts.length===1);
  await MFC_AUTOSAVE.checkpoint();
  const db=await MFC_AUTOSAVE.openDB();
  const getAll=store=>new Promise(resolve=>{const req=db.transaction(store).objectStore(store).getAll();req.onsuccess=()=>resolve(req.result);});
  const sourceRecords=await getAll('sources');assert('autosave stores each source once',new Set(sourceRecords.map(s=>s.id)).size===sourceRecords.length);
  assert('unchanged autosave skipped',(await getAll('checkpoints')).filter(c=>c.projectId===MFC_PROJECT.context.projectId).length===1);
  for (let i=0;i<10;i++) { title.set('text','Recovery checkpoint '+i); await new Promise(r=>setTimeout(r,2)); await MFC_AUTOSAVE.checkpoint(); }
  assert('recovery retains at most eight checkpoints',(await getAll('checkpoints')).filter(c=>c.projectId===MFC_PROJECT.context.projectId).length===8);
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args){if(this.name==='checkpoints')throw new DOMException('Test quota exhausted','QuotaExceededError');return put.apply(this,args);};
  title.set('text','Storage failure test');await MFC_AUTOSAVE.checkpoint();IDBObjectStore.prototype.put=put;
  assert('storage failure is shown to user',document.getElementById('autosave-status').textContent.includes('Test quota exhausted'));
  title.set('text','Recovered after manual save');await new Promise(r=>setTimeout(r,2));await MFC_AUTOSAVE.checkpoint();
  window.__verification.checks=checks;
  return {checks,imageDetails:pdf.imageDetails,projectId:MFC_PROJECT.context.projectId};
}

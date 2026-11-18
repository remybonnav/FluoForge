/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P1-T6: errors and storage. Unexpected errors show a message with "Copy details" and leave the figure
   usable; a damaged TIFF and a full IndexedDB each give a clear message and no broken state; imports that
   need more memory than available ask first; storage usage is shown and persistence requested. */
async function runErrorsStorageRegressions() {
  const checks=[];
  const assert=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};
  window.focus();
  const canvas=MFC.getCanvas();
  const tick=(ms=0)=>new Promise(r=>setTimeout(r,ms));
  const spyConsole=()=>{const calls=[],saved={};for(const k of ['log','warn','info','debug','error']){saved[k]=console[k];console[k]=(...a)=>calls.push(k+': '+a.map(String).join(' '));}
    return {calls,restore:()=>Object.assign(console,saved)};};
  const toastBox=()=>document.getElementById('error-toast');
  const toastShown=()=>!!toastBox()&&!toastBox().classList.contains('hidden');
  const toastText=()=>toastBox()?toastBox().querySelector('.error-title').textContent+' | '+toastBox().querySelector('.error-message').textContent:'';
  const savedPersist=navigator.storage&&navigator.storage.persist;let persistCalls=0;
  if(navigator.storage)navigator.storage.persist=async()=>{persistCalls++;return false;};

  await MFC_PROJECT.createProject({name:'errors and storage',width:900,height:600,unit:'px',dpi:300});
  const good=new Uint8Array(await (await fetch('tests/fixtures/large-multichannel.tif',{cache:'no-store'})).arrayBuffer());
  await MFC.importFiles([new File([good],'good.tif')]);
  const state=()=>({objects:canvas.getObjects().filter(o=>!MFC.isHelper(o)).length,history:MFC.getHistory().labels.length,
    images:Object.keys(MFC.getRegistry()).length,sources:MFC_PROJECT.sources.size,modals:document.querySelectorAll('.modal-backdrop').length});
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

  // ---- global handlers: a message with Copy details, nothing broken ----
  const thrown=new Error('Deliberate test error');
  const notCancelled=window.dispatchEvent(new ErrorEvent('error',{error:thrown,message:thrown.message,filename:'http://x/js/test.js',lineno:3,colno:4,cancelable:true}));
  assert('window error: a message appears, titled "Unexpected error", with the error text',toastShown()&&toastText()==='Unexpected error | Deliberate test error');
  assert('window error: the handler takes over the browser default (nothing printed)',notCancelled===false);
  assert('The message is an alert with Copy details and Dismiss buttons that have titles',toastBox().getAttribute('role')==='alert'&&
    !!toastBox().querySelector('.error-copy').title&&!!toastBox().querySelector('.error-dismiss').title);

  let copied=null;const clipboard=navigator.clipboard,savedWrite=clipboard&&clipboard.writeText;
  if(clipboard)clipboard.writeText=async text=>{copied=text;};
  toastBox().querySelector('.error-copy').click();await tick();
  assert('Copy details copies a report: message, place, version, browser and stack',!!copied&&copied.includes('Message: Deliberate test error')&&
    copied.includes('Where: http://x/js/test.js:3:4')&&copied.includes('Version: '+MFC.getAppVersion())&&copied.includes('Browser: ')&&copied.includes('Stack:'));
  assert('The button confirms the copy',toastBox().querySelector('.error-copy').textContent==='Copied');
  // clipboard refused: the report is shown to be copied by hand
  if(clipboard)clipboard.writeText=async()=>{throw new DOMException('Denied','NotAllowedError');};
  const savedExec=document.execCommand;document.execCommand=()=>false;
  window.dispatchEvent(new ErrorEvent('error',{error:thrown,message:thrown.message,cancelable:true}));
  assert('The same error again is counted, not stacked',toastText()==='Unexpected error | Deliberate test error (×2)');
  toastBox().querySelector('.error-copy').click();await tick();
  const fallback=toastBox().querySelector('.error-details');
  assert('If the clipboard is refused, the report is shown selected for copying by hand',!fallback.classList.contains('hidden')&&
    fallback.value.includes('Deliberate test error')&&document.activeElement===fallback);
  document.execCommand=savedExec;if(clipboard)clipboard.writeText=savedWrite;
  toastBox().querySelector('.error-dismiss').click();
  assert('Dismiss closes the message',!toastShown());

  const reason=new Error('Deliberate async failure'),rejected=Promise.reject(reason);rejected.catch(()=>{});
  const asyncNotCancelled=window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:rejected,reason,cancelable:true}));
  assert('Unhandled promise rejection: a message appears too',toastShown()&&toastText()==='Unexpected error in a background task | Deliberate async failure'&&asyncNotCancelled===false);
  const plain=Promise.reject('plain string reason');plain.catch(()=>{});
  window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection',{promise:plain,reason:'plain string reason',cancelable:true}));
  assert('A rejection with a non-Error reason is shown as text',toastText()==='Unexpected error in a background task | plain string reason');
  toastBox().querySelector('.error-dismiss').focus();
  toastBox().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert('Escape closes the message',!toastShown());

  MFC_UI.showSavingDialog('Saving test…');
  window.dispatchEvent(new ErrorEvent('error',{error:new Error('Failure during a save'),message:'Failure during a save',cancelable:true}));
  assert('An error closes a stuck "Saving…" overlay, so the figure stays usable',!document.querySelector('.saving-msg')&&toastShown());
  toastBox().querySelector('.error-dismiss').click();

  const beforeEdit=state();
  const box=new fabric.Rect({left:10,top:10,width:40,height:30,fill:'#76609e'});box.mfcId='errBox';box.mfcType='shape';box.mfcShapeKind='rect';
  canvas.add(box);MFC.pushHistory();
  assert('After the errors, editing still works',state().objects===beforeEdit.objects+1&&state().history===beforeEdit.history+1);
  await MFC.undo();
  assert('…and so does undo',state().objects===beforeEdit.objects);

  // ---- damaged TIFFs: clear message, nothing changed ----
  const cases=[
    ['random-bytes.tif',new Uint8Array(5000).map((_,i)=>(i*37+11)&255),/^random-bytes\.tif is not a TIFF file: it does not start with a TIFF header\.$/],
    ['empty.tif',new Uint8Array(0),/^empty\.tif is empty\.$/],
    ['header-only.tif',good.slice(0,8),/^header-only\.tif is damaged or incomplete: /],
    ['cut-in-half.tif',good.slice(0,good.length>>1),/^cut-in-half\.tif is damaged or incomplete: page \d of 3 /],
    ['really-a-png.tif',new Uint8Array([0x89,0x50,0x4e,0x47,13,10,26,10,0,0,0,13]),/^really-a-png\.tif is not a TIFF file/]
  ];
  for(const [name,bytes,expected] of cases){
    const before=state(),quiet=spyConsole();
    try{await MFC.importFiles([new File([bytes],name)]);}finally{quiet.restore();}
    const message=toastShown()?toastBox().querySelector('.error-message').textContent:'';
    assert(`${name}: a clear message ("${message.slice(0,90)}")`,toastBox().querySelector('.error-title').textContent==='Could not import '+name&&expected.test(message));
    assert(`${name}: no object, history step, image or source was added, and nothing printed`,same(state(),before)&&quiet.calls.length===0);
    toastBox().querySelector('.error-dismiss').click();
  }
  const beforeGood=state();
  await MFC.importFiles([new File([good],'good-again.tif')]);
  assert('After the damaged files, a good TIFF still imports',state().objects===beforeGood.objects+1&&state().images===beforeGood.images+1&&!toastShown());

  // ---- memory warning before a large import ----
  const savedBudget=MFC_TIFF.memoryBudgetBytes,savedConfirm=window.confirm;let asked=[];
  try{
    MFC_TIFF.memoryBudgetBytes=()=>1e6;
    window.confirm=message=>{asked.push(message);return false;};
    const before=state();
    await MFC.importFiles([new File([good],'too-big.tif')]);
    assert('A TIFF needing more than the available memory asks first, with its size',asked.length===1&&
      /too-big\.tif needs about \d+ MB of memory to open \(3072 × 1536 px, 3 planes, 16-bit\), but only about 1 MB/.test(asked[0]));
    assert('Declining imports nothing and says so',same(state(),before)&&document.getElementById('toast').textContent==='Import of too-big.tif cancelled.'&&!toastShown());
    asked=[];window.confirm=message=>{asked.push(message);return true;};
    await MFC.importFiles([new File([good],'too-big.tif')]);
    assert('Accepting imports it',asked.length===1&&state().objects===before.objects+1);
    asked=[];window.confirm=message=>{asked.push(message);return false;};
    MFC_TIFF.memoryBudgetBytes=()=>1e5; // the 192 × 128 PNG needs about 0.2 MB
    const png=await (await fetch('tests/fixtures/second.png',{cache:'no-store'})).blob();
    const beforePng=state();
    await MFC.importFiles([new File([png],'big.png',{type:'image/png'})]);
    assert('PNG and JPEG imports are checked the same way',asked.length===1&&/big\.png needs about .* \(192 × 128 px, 8-bit RGB\)/.test(asked[0])&&same(state(),beforePng));
    MFC_TIFF.memoryBudgetBytes=savedBudget;asked=[];
    await MFC.importFiles([new File([good],'normal.tif')]);
    assert('With the real budget, a normal TIFF imports without asking',asked.length===0);
  }finally{MFC_TIFF.memoryBudgetBytes=savedBudget;window.confirm=savedConfirm;}

  // ---- full IndexedDB ----
  const status=document.getElementById('autosave-status');
  const put=IDBObjectStore.prototype.put;
  const title=new fabric.Textbox('Quota test',{left:200,top:200,width:200,fontFamily:'Liberation Sans',fontSize:20});title.mfcId='quotaTitle';title.mfcType='text';
  canvas.add(title);MFC.pushHistory();
  try{
    IDBObjectStore.prototype.put=function(){throw new DOMException('The quota has been exceeded.','QuotaExceededError');};
    document.getElementById('toast').textContent='';
    const before=state();
    await MFC_AUTOSAVE.checkpoint();
    assert('Full IndexedDB: the recovery status says storage is full and how to keep the work ('+status.textContent.slice(0,60)+'…)',
      /^Browser storage is full, so recovery drafts cannot be kept \(The quota has been exceeded\.\)\. Your figure is not affected: save it to a file/.test(status.textContent)&&
      status.classList.contains('storage-error'));
    assert('Full IndexedDB: a one-time notice appears',document.getElementById('toast').textContent==='Browser storage is full: recovery drafts are paused. Save your project to a file.');
    assert('Full IndexedDB: the figure is unchanged and no dialog is left open',same(state(),before));
    title.set('text','Still editable');canvas.fire('object:modified',{target:title});
    assert('Full IndexedDB: editing continues',title.text==='Still editable'&&MFC.getHistory().labels.length===before.history+1);
    const handle={name:'quota.fluoforge',blob:null,async isSameEntry(o){return this===o;},
      async createWritable(){const self=this;return{async write(b){self.pending=b;},async close(){self.blob=self.pending;},async abort(){}};}};
    const savedPicker=window.showSaveFilePicker;window.showSaveFilePicker=async()=>handle;
    try{await MFC_PROJECT.saveProject(true);}finally{if(savedPicker)window.showSaveFilePicker=savedPicker;else delete window.showSaveFilePicker;}
    assert('Full IndexedDB: saving the project to a file still works',!!handle.blob&&handle.blob.size>1000&&
      /^Saved /.test(document.getElementById('project-status').textContent));
  }finally{IDBObjectStore.prototype.put=put;}
  title.set('text','Space is back');canvas.fire('object:modified',{target:title});await tick(5);
  const record=await MFC_AUTOSAVE.checkpoint();
  assert('When space is back, recovery drafts resume and the warning clears',!!record&&/^Recovery saved /.test(status.textContent)&&!status.classList.contains('storage-error'));
  await tick(10);
  assert('Persistent storage is requested once a draft exists',persistCalls===1);

  // ---- storage usage next to the recovery status ----
  await MFC_AUTOSAVE.refreshStorageStatus();
  const usage=document.getElementById('storage-status');
  assert('Storage usage is shown next to the recovery status ('+usage.textContent+')',/^Browser storage: [\d.]+ (kB|MB|GB) used of /.test(usage.textContent)&&
    usage.previousElementSibling===status&&usage.getAttribute('role')==='status');
  if(navigator.storage)navigator.storage.persist=savedPersist;
  return {checks};
}

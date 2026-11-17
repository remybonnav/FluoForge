/* UI/UX fixes of 2026-10-12 (items A1–G2), driven through native DOM mouse events where it matters. */
async function runUiFixesRegressions() {
  const checks=[];
  const assert=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};
  const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
  await MFC_PROJECT.createProject({name:'UI fixes: a/b?',width:1200,height:900,unit:'px',dpi:300});
  const canvas=MFC.getCanvas();
  MFC.setZoom(1);
  const upper=canvas.upperCanvasEl;
  const client=(x,y)=>{canvas.calcOffset();const r=upper.getBoundingClientRect(),v=canvas.viewportTransform;return {clientX:r.left+x*v[0]+v[4],clientY:r.top+y*v[3]+v[5]};};
  const drag=(from,to,extra={})=>{
    const a=client(from.x,from.y),b=client(to.x,to.y);
    upper.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,...a,buttons:1,...extra}));
    for(let i=1;i<=6;i++)document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:a.clientX+(b.clientX-a.clientX)*i/6,clientY:a.clientY+(b.clientY-a.clientY)*i/6,buttons:1,...extra}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,...b,...extra}));
  };
  const click=(x,y,extra={})=>drag({x,y},{x,y},extra);
  const controlPoint=(obj,key)=>{canvas.renderAll();obj.setCoords();const c=obj.oCoords[key],v=canvas.viewportTransform;return {x:(c.x-v[4])/v[0],y:(c.y-v[5])/v[3]};};

  // Synthetic images.
  const src=document.createElement('canvas');src.width=src.height=200;
  const g=src.getContext('2d');g.fillStyle='#204080';g.fillRect(0,0,200,200);g.fillStyle='#e0e040';g.fillRect(50,50,100,100);
  const blob=await new Promise(resolve=>src.toBlob(resolve,'image/png'));
  await MFC.importFiles([new File([blob],'ui-a.png',{type:'image/png'}),new File([blob],'ui-b.png',{type:'image/png'})]);
  const [imgA,imgB]=canvas.getObjects().filter(o=>o.mfcType==='mfcImage');
  imgA.set({left:100,top:100});imgA.setCoords();imgB.set({left:500,top:100});imgB.setCoords();
  canvas.discardActiveObject();canvas.renderAll();

  // ---- A4: selection never moves, resizes, opens or closes inspector panels ----
  const panelRects=()=>Object.fromEntries([...document.querySelectorAll('#side-panel > .panel:not(.hidden)')].map(p=>[p.id,JSON.stringify([Math.round(p.getBoundingClientRect().top),Math.round(p.getBoundingClientRect().height),p.querySelector('.panel-body').hidden])]));
  const layersPanel=document.getElementById('panel-layers');
  if(layersPanel.querySelector('.panel-body').hidden)layersPanel.querySelector('.panel-toggle').click();
  const channels=document.getElementById('panel-channels');
  if(!channels.querySelector('.panel-body').hidden)channels.querySelector('.panel-toggle').click();
  const mainTop=document.getElementById('main').getBoundingClientRect().top;
  const before=panelRects();
  click(150,150);await tick();
  assert('Clicking an image selects it',canvas.getActiveObject()===imgA);
  const afterSelect=panelRects();
  assert('Selecting an image does not move the layers panel',before['panel-layers']===afterSelect['panel-layers']);
  assert('Selecting an image does not reopen a collapsed panel',channels.querySelector('.panel-body').hidden);
  assert('Selecting never reorders panels',[...document.querySelectorAll('#side-panel > .panel')].every(p=>!p.style.order));
  const layerName=layersPanel.querySelector('.layer-name');
  layerName.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));layerName.click();await tick();
  assert('Clicking inside the layers panel does not move it',panelRects()['panel-layers']===afterSelect['panel-layers']);
  assert('The selection bar keeps the canvas in place',document.getElementById('main').getBoundingClientRect().top===mainTop);
  canvas.discardActiveObject();canvas.renderAll();
  assert('Deselecting keeps the canvas in place',document.getElementById('main').getBoundingClientRect().top===mainTop);
  channels.querySelector('.panel-toggle').click();
  assert('An explicit toggle reopens a panel',!channels.querySelector('.panel-body').hidden);

  // ---- B1: transform controls live in the selection bar, not the inspector ----
  assert('No size panel remains in the inspector',!document.getElementById('panel-object')&&!document.querySelector('#side-panel #obj-width'));
  canvas.setActiveObject(imgA);canvas.renderAll();MFC.refreshSelectionBar();
  assert('Selection bar shows the transform fields',!document.getElementById('sel-transform').classList.contains('hidden')&&
    document.getElementById('obj-x').value==='100'&&document.getElementById('obj-width').value==='200');
  const setField=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};
  setField('obj-x','120');setField('obj-y','130');
  assert('X/Y fields move the object',Math.round(imgA.left)===120&&Math.round(imgA.top)===130);
  setField('obj-width','300');
  assert('W field scales with locked ratio',Math.round(imgA.getScaledWidth())===300&&Math.round(imgA.getScaledHeight())===300);
  setField('obj-width','200');

  // ---- A1 / C1 / C2: text sizes and box ----
  const text=new fabric.Textbox('Label',{left:700,top:450,width:200,fontSize:20,fontFamily:'Liberation Sans',fill:'#000000'});
  text.mfcId='uiText';text.mfcType='text';MFC.attachTextListeners(text);canvas.add(text);MFC.applyLockState(text);
  canvas.setActiveObject(text);canvas.renderAll();
  const corner=controlPoint(text,'br');
  drag(corner,{x:corner.x+100,y:corner.y+30});await tick();
  const sizeField=document.getElementById('text-size');
  assert('Corner scaling folds the scale into fontSize',text.scaleX===1&&text.scaleY===1&&text.fontSize>20);
  assert('Font-size field shows the real size after handle scaling',+sizeField.value===Math.round(text.fontSize));
  sizeField.value='36';sizeField.dispatchEvent(new Event('change',{bubbles:true}));
  assert('Typing a font size applies it and the field keeps it',text.fontSize===36&&+sizeField.value===36);
  text.set({scaleX:1.5,scaleY:1.5});MFC.refreshTextPanel();
  assert('A not-yet-normalized scale is shown as the effective size',+sizeField.value===54);
  canvas.fire('object:modified',{target:text});
  assert('Normalizing keeps the effective size',text.fontSize===54&&text.scaleY===1);
  MFC.applyTextStyle('fontSize',24);
  // Box size independent from the font size, via the selection bar fields.
  setField('obj-width','260');setField('obj-height','120');
  assert('Text box W/H change only the box',Math.round(text.width)===260&&Math.round(text.height)===120&&text.fontSize===24&&text.scaleY===1);
  assert('Selection bar reports the text box size',document.getElementById('obj-height').value==='120');
  const textHeight=text._mfcTextHeight;
  document.getElementById('text-center-both').click();
  assert('Center both sets horizontal and vertical centering',text.textAlign==='center'&&text.mfcVAlign==='middle');
  assert('Vertical centering offsets the text block inside the box',Math.abs(text._getTopOffset()-(-60+(120-textHeight)/2))<0.01);
  document.getElementById('text-valign-bottom').click();
  assert('Bottom alignment moves the text to the bottom',Math.abs(text._getTopOffset()-(60-textHeight))<0.01);
  document.getElementById('text-valign-middle').click();
  // Bottom handle drags the box height without touching the font size.
  const bottom=controlPoint(text,'mb');
  drag(bottom,{x:bottom.x,y:bottom.y+40});await tick();
  assert('Top/bottom handles resize the box, not the text',Math.abs(text.height-160)<1.5&&text.fontSize===24&&text.scaleY===1);
  const right=controlPoint(text,'mr');
  drag(right,{x:right.x+40,y:right.y});await tick();
  assert('Side handles resize the box width, not the text',Math.abs(text.width-300)<1.5&&text.fontSize===24);
  assert('SVG/PDF export uses the same vertical offset as the screen',text._getSVGLeftTopOffsets().textTop===text._getTopOffset()&&text._getTopOffset()>-text.height/2);
  text.set('backgroundColor','#ffee88');
  const bgHeights=[...text.toSVG().matchAll(/<rect[^>]*height="([\d.]+)"/g)].map(m=>+m[1]);
  assert('SVG background still covers the whole box',bgHeights.some(h=>Math.abs(h-text.height)<0.01));
  // Box properties survive serialization.
  const textJson=MFC_PROJECT.serializeObject(text,true);
  const restoredText=await MFC_PROJECT.restoreObject(textJson);
  assert('Box height and vertical alignment survive save/load',Math.abs(restoredText.height-text.height)<0.01&&restoredText.mfcVAlign==='middle');

  // ---- D2: Shift snaps rotation to 45° ----
  canvas.setActiveObject(imgB);canvas.renderAll();
  const centerB=imgB.getCenterPoint(),rot=controlPoint(imgB,'mtr');
  const angleTo=deg=>{const r=Math.hypot(rot.x-centerB.x,rot.y-centerB.y),a=(deg-90)*Math.PI/180;return {x:centerB.x+Math.cos(a)*r,y:centerB.y+Math.sin(a)*r};};
  drag(rot,angleTo(52),{shiftKey:true});await tick();
  assert('Shift-rotation snaps to 45°',imgB.angle===45);
  const c2=imgB.getCenterPoint();
  assert('Snapped rotation pivots on the center',Math.hypot(c2.x-centerB.x,c2.y-centerB.y)<0.5);
  const rot2=controlPoint(imgB,'mtr');
  drag(rot2,angleTo(70));await tick();
  assert('Rotation without Shift is free',Math.abs(imgB.angle-70)<2&&imgB.angle!==90);
  MFC.setObjectAngle(0);

  // ---- D1: zoom keeps the selected object centered ----
  const wrap=document.getElementById('canvas-wrap');
  const screenCenterOf=obj=>{const b=obj.getBoundingRect();const r=upper.getBoundingClientRect(),w=wrap.getBoundingClientRect();return {x:r.left-w.left+b.left+b.width/2,y:r.top-w.top+b.top+b.height/2};};
  canvas.setActiveObject(imgB);canvas.renderAll();
  MFC.zoomIn();await tick();canvas.renderAll();
  let sc=screenCenterOf(imgB);
  const viewMid={x:wrap.clientWidth/2,y:wrap.clientHeight/2};
  assert('Zooming with a selection centers on it',Math.abs(sc.x-viewMid.x)<3&&Math.abs(sc.y-viewMid.y)<3);
  MFC.zoomIn();await tick();canvas.renderAll();sc=screenCenterOf(imgB);
  assert('Repeated zoom stays on the selection',Math.abs(sc.x-viewMid.x)<3&&Math.abs(sc.y-viewMid.y)<3);
  canvas.discardActiveObject();
  const anchorDoc=canvas.getPointer({clientX:wrap.getBoundingClientRect().left+200,clientY:wrap.getBoundingClientRect().top+150});
  upper.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-200,clientX:wrap.getBoundingClientRect().left+200,clientY:wrap.getBoundingClientRect().top+150}));
  await tick();
  const anchorAfter=canvas.getPointer({clientX:wrap.getBoundingClientRect().left+200,clientY:wrap.getBoundingClientRect().top+150});
  assert('Ctrl+wheel without selection zooms around the cursor',Math.hypot(anchorAfter.x-anchorDoc.x,anchorAfter.y-anchorDoc.y)<2);
  canvas.setActiveObject(imgA);MFC.zoomToSelection();await tick();
  const fitted=imgA.getBoundingRect();
  assert('Zoom to selection fits the object in view',fitted.width<=wrap.clientWidth&&fitted.height<=wrap.clientHeight&&(fitted.width>wrap.clientWidth*0.5||fitted.height>wrap.clientHeight*0.5));
  MFC.setZoom(1);canvas.discardActiveObject();

  // ---- F1: position/size lock ----
  canvas.setActiveObject(imgA);canvas.renderAll();
  document.getElementById('obj-position-lock').click();
  assert('Position lock is set and shown in the bar',imgA.mfcPositionLocked&&document.getElementById('obj-position-lock').classList.contains('active'));
  assert('Position lock is shown in the layers panel',[...document.querySelectorAll('.layer-row')].some(r=>r.querySelector('.layer-name').textContent==='ui-a.png'&&r.querySelector('.layer-position-lock').dataset.state==='locked'));
  const posBefore={left:imgA.left,top:imgA.top};
  drag({x:posBefore.left+50,y:posBefore.top+50},{x:posBefore.left+150,y:posBefore.top+120});await tick();
  assert('Position-locked image cannot be dragged',imgA.left===posBefore.left&&imgA.top===posBefore.top);
  assert('Position-locked image stays selectable',canvas.getActiveObject()===imgA);
  canvas.setActiveObject(imgA);MFC.nudgeSelection(10,0,false);
  assert('Position-locked image ignores arrow nudges',imgA.left===posBefore.left);
  assert('Position-locked image has no resize/rotate handles',!imgA.hasControls&&imgA.lockScalingX&&imgA.lockRotation);
  assert('Position-locked image disables the bar fields',document.getElementById('obj-x').disabled&&document.getElementById('obj-width').disabled);
  MFC.rotateSelected(90);assert('Position-locked image refuses rotation',!imgA.angle);
  const entryA=MFC.getRegistry()[imgA.mfcId];
  MFC.applyBrightnessContrast(20,10);
  assert('Position lock still allows brightness/contrast',entryA.rawImage.brightness===20);
  const colorSelect=document.querySelector('#channel-list .ch-color');
  if(colorSelect){colorSelect.value='magenta';colorSelect.dispatchEvent(new Event('change',{bubbles:true}));}
  assert('Position lock still allows channel colors',!colorSelect||entryA.rawImage.channels[0].color==='magenta');
  canvas.setActiveObject(new fabric.ActiveSelection([imgA,imgB],{canvas}));canvas.renderAll();
  const multi=canvas.getActiveObject();
  assert('A multi-selection containing a locked object is locked',multi.lockMovementX&&!multi.hasControls);
  const bLeft=imgB.left;
  imgB.set({top:imgB.top+40});imgB.setCoords();
  const bTopBefore=imgB.getBoundingRect(true,true).top;
  MFC.align('top');
  assert('Align still moves the unlocked object',imgB.getBoundingRect(true,true).top!==bTopBefore);
  canvas.discardActiveObject();
  assert('Locked image was not moved by align',imgA.left===posBefore.left&&imgA.top===posBefore.top);
  imgB.set({left:bLeft});imgB.setCoords();
  const stateJson=MFC_PROJECT.captureState();
  assert('Position lock is saved with the project',stateJson.objects.find(o=>o.mfcId===imgA.mfcId).mfcPositionLocked===true);

  // ---- A2: layer lock blocks every path ----
  const shape=new fabric.Rect({left:820,top:120,width:120,height:80,fill:'#00ff00'});shape.mfcId='uiShape';shape.mfcType='shape';canvas.add(shape);MFC.applyLockState(shape);
  MFC.toggleLayerLock(shape);
  const shapePos={left:shape.left,top:shape.top};
  click(860,150);await tick();
  assert('Layer-locked object cannot be clicked',canvas.getActiveObject()!==shape);
  drag({x:860,y:150},{x:900,y:220});await tick();
  assert('Layer-locked object cannot be dragged',shape.left===shapePos.left&&shape.top===shapePos.top);
  drag({x:780,y:90},{x:980,y:240});await tick();
  assert('Marquee selection skips layer-locked objects',!canvas.getActiveObjects().includes(shape));
  canvas.discardActiveObject();
  for(const tool of ['shape','select','scalebar','select'])MFC.setTool(tool);
  assert('Switching tools does not unlock a locked layer',!shape.selectable&&!shape.evented&&shape.lockMovementX);
  MFC.pushHistory();await MFC.undo();await MFC.redo();
  const shapeAfterUndo=canvas.getObjects().find(o=>o.mfcId==='uiShape');
  assert('Undo/redo keeps the layer lock',shapeAfterUndo.mfcLocked&&!shapeAfterUndo.selectable&&!shapeAfterUndo.evented);
  const restoredState=MFC_PROJECT.captureState();await MFC_PROJECT.restoreState(restoredState);
  const shapeLoaded=canvas.getObjects().find(o=>o.mfcId==='uiShape'),imgALoaded=canvas.getObjects().find(o=>o.mfcType==='mfcImage'&&o.mfcPositionLocked);
  assert('Loading keeps the layer lock',shapeLoaded.mfcLocked&&!shapeLoaded.selectable&&!shapeLoaded.evented&&shapeLoaded.lockMovementX);
  assert('Loading keeps the position lock',imgALoaded&&imgALoaded.lockMovementX&&!imgALoaded.hasControls&&imgALoaded.selectable);
  const lockedText=canvas.getObjects().find(o=>o.mfcId==='uiText');
  MFC.toggleLayerLock(lockedText);
  assert('Layer-locked text is not editable',lockedText.editable===false);
  MFC.toggleLayerLock(lockedText);
  MFC.arrangeGrid({rows:1,cols:2,cellW:200,cellH:200,gap:10,headerRow:false,headerCol:false});
  assert('Grid layout leaves locked images in place',imgALoaded.left===posBefore.left&&imgALoaded.top===posBefore.top);
  canvas.getObjects().filter(o=>o.type==='textbox'&&o.text==='Label').forEach(o=>canvas.remove(o));

  // ---- A3: eye icon reflects visibility everywhere ----
  const eyeFor=id=>{const row=[...document.querySelectorAll('.layer-row')].find(r=>r.querySelector('.layer-name').textContent===id);return row&&row.querySelector('.layer-eye');};
  MFC.setAllLayersVisible(false);
  assert('Hide all hides every layer',canvas.getObjects().filter(o=>o.mfcId).every(o=>o.visible===false));
  assert('Hide all switches every eye icon',[...document.querySelectorAll('.layer-eye')].every(b=>b.dataset.state==='hidden'&&b.closest('.layer-row').classList.contains('layer-hidden')));
  await MFC.undo();
  assert('Undo restores the visible eye icons',[...document.querySelectorAll('.layer-eye')].every(b=>b.dataset.state==='visible'));
  document.getElementById('layers-hide-all').click();document.getElementById('layers-show-all').click();
  assert('Show all restores every layer and icon',canvas.getObjects().filter(o=>o.mfcId).every(o=>o.visible!==false)&&[...document.querySelectorAll('.layer-eye')].every(b=>b.dataset.state==='visible'));
  eyeFor('Shape').click();
  assert('Single hide switches only that icon',eyeFor('Shape').dataset.state==='hidden'&&eyeFor('ui-b.png').dataset.state==='visible');
  await MFC_PROJECT.restoreState(MFC_PROJECT.captureState());
  assert('Loading keeps the hidden icon',eyeFor('Shape').dataset.state==='hidden');
  eyeFor('Shape').click();

  // ---- E1: exact-size insets ----
  const sourceImg=canvas.getObjects().find(o=>o.mfcType==='mfcImage'&&!o.mfcPositionLocked);
  sourceImg.set({left:100,top:450,scaleX:1,scaleY:1,angle:0});sourceImg.setCoords();
  document.getElementById('inset-fixed-size').checked=true;
  document.getElementById('inset-fixed-w').value='40';document.getElementById('inset-fixed-h').value='30';
  document.getElementById('inset-magnification').value='2';
  MFC.setTool('inset');canvas.renderAll();
  click(200,550);await tick();
  const contour=canvas.getActiveObject();
  assert('Exact-size outline is placed by a click',contour&&contour.mfcType==='insetContour'&&contour.width===40&&contour.height===30&&contour.scaleX===1);
  assert('Exact-size outline is centered on the click',Math.abs(contour.left-180)<0.01&&Math.abs(contour.top-535)<0.01);
  assert('Outline source region matches the exact size',Math.abs(contour.mfcCropW-40)<0.01&&Math.abs(contour.mfcCropH-30)<0.01);
  MFC.createInsetFromContour(contour);
  const inset=canvas.getActiveObject();
  assert('Inset uses outline size × magnification',Math.abs(inset.getScaledWidth()-80)<0.01&&Math.abs(inset.getScaledHeight()-60)<0.01);
  MFC.setTool('inset');click(150,600);await tick();
  const contour2=canvas.getActiveObject();
  assert('Repeated exact-size outlines have identical size',contour2.width===40&&contour2.height===30);
  document.getElementById('inset-fixed-w').value='50';document.getElementById('inset-fixed-h').value='50';
  document.getElementById('inset-apply-size').click();
  assert('Apply exact size resizes the selected outline',contour2.width===50&&contour2.height===50&&Math.abs(contour2.mfcCropW-50)<0.01);
  document.getElementById('inset-fixed-size').checked=false;
  MFC.setTool('inset');drag({x:250,y:500},{x:290,y:540});await tick();
  assert('A drawn outline is remembered as the last inset size',document.getElementById('inset-fixed-w').value==='40'&&document.getElementById('inset-fixed-h').value==='40');
  document.getElementById('inset-magnification').value='1';MFC.saveInsetSizePreferences();
  // Dragging the outline still updates the linked inset (existing behavior).
  const cropBefore=inset.cropX;
  canvas.setActiveObject(contour);canvas.renderAll();
  drag({x:contour.left+20,y:contour.top+15},{x:contour.left+30,y:contour.top+15},{altKey:true});await tick();
  assert('Moving an outline still updates its inset',Math.abs(inset.cropX-cropBefore-10)<0.6);
  MFC.setTool('select');

  // ---- G1 / G2 ----
  assert('Export file name follows the project name',MFC_EXPORT.exportBaseName()==='UI fixes_ a_b_');
  MFC.setDocName('   ');assert('Export file name falls back to a default',/^(Untitled Figure|figure_export)$/.test(MFC_EXPORT.exportBaseName()));
  MFC.setDocName('UI fixes: a/b?');
  for(const [name,hex] of [['red','#ff0000'],['green','#00ff00'],['blue','#0000ff'],['magenta','#ff00ff'],['cyan','#00ffff'],['yellow','#ffff00']]){
    const swatch=document.querySelector('#text-color').closest('label').nextElementSibling.querySelector('button[data-imagej="'+name+'"]');
    assert('ImageJ '+name+' swatch exists',!!swatch);
    if(name==='cyan'){canvas.setActiveObject(canvas.getObjects().find(o=>o.mfcId==='uiText'));swatch.click();}
  }
  assert('ImageJ swatch applies the pure color',canvas.getObjects().find(o=>o.mfcId==='uiText').fill==='#00ffff');
  // ---- Projects saved by v0.22 (main branch before these changes) still open ----
  const fixture=await fetch('tests/compat/main-v0.22-project.mfcproj.zip');
  if(fixture.ok){
    await MFC_PROJECT.loadProject(new File([await fixture.blob()],'main-v0.22-project.mfcproj.zip'));
    const objs=canvas.getObjects().filter(o=>o.mfcId),find=id=>objs.find(o=>o.mfcId===id);
    assert('v0.22 project opens with all objects',MFC.getDocProps().name==='Compat fixture v0.22'&&objs.length===8);
    assert('v0.22 locked layer stays locked',find('txtLocked').mfcLocked&&!find('txtLocked').selectable&&!find('txtLocked').evented);
    assert('v0.22 hidden layer stays hidden with a closed eye',find('shpHidden').visible===false&&
      [...document.querySelectorAll('.layer-row')].some(r=>r.querySelector('.layer-name').textContent==='Shape'&&r.querySelector('.layer-eye').dataset.state==='hidden'));
    assert('v0.22 text keeps its geometry',find('txtOld').fontSize===80&&Math.round(find('txtOld').width)===260&&!find('txtOld').mfcBoxHeight);
    const inset=objs.find(o=>o.mfcIsInset),contour=find('insOld');
    assert('v0.22 inset stays linked to its outline',inset&&inset.mfcInsetContourId==='insOld'&&Math.abs(inset.cropX-contour.mfcCropX)<0.01);
    assert('v0.22 scale bar and group restore',objs.some(o=>o.mfcType==='scalebar')&&objs.some(o=>o.type==='group'));
    assert('v0.22 objects have no position lock by default',objs.every(o=>!o.mfcPositionLocked));
  } else checks.push('(compat fixture not served — skipped)');

  return checks;
}

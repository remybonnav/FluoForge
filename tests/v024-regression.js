/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* v0.24 requests: legacy project loading, inset size readout, scale bar preview and
   metadata, PDF/SVG export fixes, crop to shape, multi-object edits, pages, close warning. */
async function runV024Regressions() {
  const checks=[];
  const assert=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};
  const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
  const canvas=MFC.getCanvas();
  const fire=(id,type,value)=>{const el=document.getElementById(id);if(value!==undefined){if(el.type==='checkbox')el.checked=value;else el.value=value;}el.dispatchEvent(new Event(type,{bubbles:true}));};
  const pngFile=async(name,color='#204080')=>{
    const src=document.createElement('canvas');src.width=src.height=200;
    const g=src.getContext('2d');g.fillStyle=color;g.fillRect(0,0,200,200);g.fillStyle='#e0e040';g.fillRect(50,50,100,100);
    return new File([await new Promise(resolve=>src.toBlob(resolve,'image/png'))],name,{type:'image/png'});
  };

  // ---- Projects saved by v0.18/v0.19 (format 2): group children keep their own types ----
  {
    const zip=new JSZip();zip.file('images/img_0.png',await pngFile('legacy.png'));
    zip.file('manifest.json',JSON.stringify({version:2,appVersion:'0.18',docProps:{name:'Legacy',width:800,height:600,unit:'px',dpi:300},nextId:5,objects:[
      {mfcId:'img1',mfcType:'mfcImage',left:50,top:60,scaleX:1,scaleY:1,angle:0,width:200,height:200,cropX:0,cropY:0,fileName:'legacy.png',
        imageArchivePath:'images/img_0.png',sourceFormat:'raster',voxelSizeUm:0.5,brightness:0,contrast:0,alphaEnabled:true},
      {mfcId:'sb2',mfcType:'scalebar',left:150,top:200,fabricJSON:{type:'group',left:150,top:200,originX:'left',originY:'top',width:40,height:26,
        mfcId:'sb2',mfcType:'scalebar',mfcAttachedTo:'img1',mfcCorner:'bottom-right',mfcMarginPct:5,objects:[
          {type:'rect',left:-20,top:7,width:40,height:6,fill:'#ffffff',originX:'left',originY:'top'},
          {type:'text',left:-20,top:-13,text:'20 µm',fontSize:16,fill:'#ffffff',fontFamily:'Liberation Sans',originX:'left',originY:'top'}]}},
      {mfcId:'grp3',mfcType:'group',left:400,top:50,fabricJSON:{type:'group',left:400,top:50,width:120,height:80,mfcId:'grp3',mfcType:'group',objects:[
        {type:'textbox',left:-60,top:-40,width:100,text:'Old label',fontSize:20,fill:'#ff0000',mfcId:'txt4',mfcType:'text'},
        {type:'rect',left:-60,top:0,width:120,height:40,fill:'transparent',stroke:'#00ff00',strokeWidth:2,mfcId:'shp5',mfcType:'shape'}]}}]}));
    const blob=await zip.generateAsync({type:'blob'});
    await MFC_PROJECT.loadProject(new File([blob],'legacy.mfcproj.zip'));
    document.querySelectorAll('.recovery-modal').forEach(m=>m.remove());
    const objs=canvas.getObjects().filter(o=>!MFC.isHelper(o));
    const bar=objs.find(o=>o.mfcType==='scalebar'),group=objs.find(o=>o.mfcType==='group');
    assert('A v0.18 project opens with its image, scale bar and group',objs.length===3&&objs[0].mfcType==='mfcImage');
    assert('Legacy scale bar children keep their rect and text types',bar.getObjects().map(o=>o.type).join()==='rect,text');
    assert('Legacy grouped text and shape keep their types',group.getObjects().map(o=>o.type).join()==='textbox,rect');
    assert('A legacy scale bar length is recovered from its label',bar.mfcLengthUm===20);
    assert('A freshly opened legacy project has no unsaved changes',!MFC_PROJECT.hasUnsavedChanges());
  }

  await MFC_PROJECT.createProject({name:'v0.24',width:1200,height:900,unit:'px',dpi:300});
  MFC.setZoom(1);
  assert('A new empty figure has no unsaved changes',!MFC_PROJECT.hasUnsavedChanges());
  await MFC.importFiles([await pngFile('a.png'),await pngFile('b.png','#803020')]);
  let [imgA,imgB]=canvas.getObjects().filter(o=>o.mfcType==='mfcImage');
  imgA.set({left:100,top:100});imgA.setCoords();imgB.set({left:500,top:100});imgB.setCoords();
  assert('Content added to a never-saved figure counts as unsaved',MFC_PROJECT.hasUnsavedChanges());

  // ---- Inset outline size shown live while drawing ----
  {
    const upper=canvas.upperCanvasEl;
    const client=(x,y)=>{canvas.calcOffset();const r=upper.getBoundingClientRect(),v=canvas.viewportTransform;return {clientX:r.left+x*v[0]+v[4],clientY:r.top+y*v[3]+v[5]};};
    document.getElementById('inset-fixed-size').checked=false;
    MFC.setInsetAspectMode('rect');MFC.setTool('inset');
    upper.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,...client(120,120),buttons:1}));
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,...client(180,150),buttons:1}));
    const readout=document.getElementById('inset-size-readout').textContent;
    assert('The inset panel shows the outline size while dragging',/Outline 60 × 30 px on the page/.test(readout)&&/px of the source image/.test(readout));
    assert('The exact-size fields follow the drawing live',document.getElementById('inset-fixed-w').value==='60'&&document.getElementById('inset-fixed-h').value==='30');
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,...client(200,190),buttons:1}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,...client(200,190)}));await tick();
    const contour=canvas.getActiveObject();
    assert('Releasing creates the outline and keeps its size in the panel',contour.mfcType==='insetContour'&&/Outline 80 × 70 px/.test(document.getElementById('inset-size-readout').textContent));
    canvas.remove(contour);MFC.setTool('select');
  }

  // ---- Scale bar: preview before inserting ----
  canvas.setActiveObject(imgA);MFC.applyPixelSize('0.5');
  MFC.setTool('scalebar');
  fire('sb-length','input','40');fire('sb-corner','change','bottom-left');
  const previews=()=>canvas.getObjects().filter(o=>o.mfcIsPreview&&o.type==='group');
  assert('The scale bar tool previews the bar on the selected image',previews().length===1&&previews()[0].getObjects()[0].width===80);
  assert('The preview is not a layer and is not saved',!document.querySelector('#layers-list').textContent.includes('Scale bar')&&
    MFC_PROJECT.captureState().objects.every(o=>o.mfcType!=='scalebar'));
  assert('The preview reports its length on the page',/40 µm = 80 px on the page/.test(document.getElementById('sb-preview-status').textContent));
  fire('sb-length','input','20');
  assert('Changing the length updates the preview',previews()[0].getObjects()[0].width===40);
  const imgBox=imgA.getBoundingRect(true,true),pv=previews()[0].getBoundingRect(true,true);
  assert('The preview sits in the chosen corner',Math.abs(pv.left-(imgBox.left+10))<1&&Math.abs(pv.top+pv.height-(imgBox.top+imgBox.height-10))<1);
  canvas.setActiveObject(new fabric.ActiveSelection([imgA,imgB],{canvas}));MFC.getRegistry()[imgB.mfcId].rawImage.voxelSizeUm=0.25;
  canvas.fire('selection:created');
  assert('With several images selected, each one shows a preview',previews().length===2);
  canvas.setActiveObject(imgA);canvas.fire('selection:updated');
  document.getElementById('sb-place-corner').click();await tick();
  const bar=canvas.getActiveObject();
  assert('Placing removes the preview and selects the new bar',bar.mfcType==='scalebar'&&previews().length===0);

  // ---- Scale bar: metadata shown and editable ----
  MFC.setTool('select');canvas.setActiveObject(bar);canvas.fire('selection:created');
  const info=document.getElementById('sb-selected-info');
  assert('Selecting a scale bar shows its panel in the Select tool',!document.getElementById('panel-scalebar').classList.contains('hidden')&&!info.classList.contains('hidden'));
  assert('The panel shows the bar length, image and pixel size',/20 µm/.test(info.textContent)&&/a\.png/.test(info.textContent)&&/0\.5 µm\/px/.test(info.textContent)&&/40 image px/.test(info.textContent));
  assert('The selection bar and layer name show the length',/Scale bar · 20 µm/.test(document.getElementById('sel-label').textContent));
  fire('sb-length','change','10');
  const edited=canvas.getActiveObject();
  assert('Changing the length rebuilds the selected bar',edited.mfcLengthUm===10&&edited.getObjects()[0].width===20&&edited.getObjects()[1].text==='10 µm'&&edited.mfcId===bar.mfcId);
  fire('sb-thickness','change','9');
  assert('Thickness edits apply to the selected bar',canvas.getActiveObject().getObjects()[0].height===9&&canvas.getActiveObject().mfcLengthUm===10);
  await MFC.undo();await MFC.undo();
  assert('Undo restores the earlier length',canvas.getObjects().find(o=>o.mfcType==='scalebar').mfcLengthUm===20);
  [imgA,imgB]=canvas.getObjects().filter(o=>o.mfcType==='mfcImage'); // undo rebuilds the canvas objects

  // ---- Multi-object edits ----
  canvas.discardActiveObject();
  canvas.setActiveObject(new fabric.ActiveSelection([imgA,imgB],{canvas}));canvas.fire('selection:created');
  const rawA=MFC.getRegistry()[imgA.mfcId].rawImage,rawB=MFC.getRegistry()[imgB.mfcId].rawImage;
  assert('The channel panel names all selected images',/2 images/.test(document.getElementById('channel-image-name').textContent));
  const row=document.querySelector('#channel-list .channel-row');
  row.querySelector('.ch-toggle').checked=false;row.querySelector('.ch-toggle').dispatchEvent(new Event('change'));
  assert('Turning a channel off applies to every selected image',!rawA.channels[0].enabled&&!rawB.channels[0].enabled);
  rawB.contrast=30;
  fire('ch-brightness','input','25');
  assert('Brightness applies to all images without overwriting their contrast',rawA.brightness===25&&rawB.brightness===25&&rawB.contrast===30);
  // The colour is chosen in the LUT popover (P2-T2).
  document.querySelector('#channel-list .channel-row .ch-lut').click();
  const pick=[...document.querySelectorAll('.lut-popover .lut-option')].find(o=>o.dataset.lut!==rawA.channels[0].color);
  const picked=pick.dataset.lut;pick.click();
  assert('Channel color applies to every selected image',rawA.channels[0].color===picked&&rawB.channels[0].color===picked);
  const shape=(left,stroke,fill)=>{const r=new fabric.Rect({left,top:600,width:80,height:60,stroke,strokeWidth:3,fill,strokeUniform:true});r.mfcId='shp'+left;r.mfcType='shape';canvas.add(r);return r;};
  const s1=shape(100,'#ff0000','#111111'),s2=shape(300,'#00ff00','#222222');
  canvas.setActiveObject(new fabric.ActiveSelection([s1,s2],{canvas}));canvas.fire('selection:created');
  assert('The shape panel opens for several selected shapes',!document.getElementById('panel-shape').classList.contains('hidden'));
  fire('shape-stroke-color','change','#0000ff');
  assert('A stroke color edit applies to every selected shape only',s1.stroke==='#0000ff'&&s2.stroke==='#0000ff'&&s1.fill==='#111111'&&s2.fill==='#222222');
  fire('shape-dash','change','dashed');
  assert('A dash edit applies to every selected shape',String(s1.strokeDashArray)==='12,8'&&String(s2.strokeDashArray)==='12,8');
  canvas.discardActiveObject();

  // ---- SVG export of dashed outlines: no transform-scaled dashes ----
  s1.set({scaleX:3,scaleY:2});s1.setCoords();
  {
    const out=await MFC_EXPORT.buildSVG();
    const dashed=out.svg.split('\n').filter(line=>line.includes('stroke-dasharray: 12 8'));
    assert('Dashed outlines are exported without vector-effect',dashed.length===2&&dashed.every(line=>!line.includes('vector-effect')&&!line.includes('transform')));
    assert('A scaled dashed box is written at its page size',dashed.some(line=>/d="M 101\.5 601\.5 L 341\.5 601\.5 L 341\.5 721\.5 L 101\.5 721\.5 Z"/.test(line)));
  }
  canvas.remove(s1,s2);MFC.pushHistory();

  // ---- Crop to shape ----
  {
    MFC.setShapeKind('ellipse');
    const ellipse=new fabric.Ellipse({left:540,top:140,rx:60,ry:40,fill:'transparent',stroke:'#ffcc00',strokeWidth:2,strokeUniform:true});
    ellipse.mfcId='shp900';ellipse.mfcType='shape';ellipse.mfcShapeKind='ellipse';canvas.add(ellipse);MFC.pushHistory();
    const shapeBox=ellipse.getBoundingRect(true,true);
    canvas.setActiveObject(new fabric.ActiveSelection([imgB,ellipse],{canvas}));canvas.fire('selection:created');
    assert('Crop to shape is offered for an image and a closed shape',!document.getElementById('btn-crop-shape').classList.contains('hidden'));
    await MFC.cropToShape();
    assert('The shape becomes the image clip and leaves the canvas',imgB.clipPath&&imgB.clipPath.type==='ellipse'&&!canvas.getObjects().includes(ellipse));
    const frame=imgB.getBoundingRect(true,true);
    assert('Cropping to a shape also crops the image frame to the shape',Math.abs(frame.left-shapeBox.left)<=2&&Math.abs(frame.top-shapeBox.top)<=2&&
      Math.abs(frame.width-shapeBox.width)<=3&&Math.abs(frame.height-shapeBox.height)<=3&&imgB.width<200);
    const clipCenter=()=>fabric.util.transformPoint(imgB.clipPath.getCenterPoint(),imgB.calcTransformMatrix());
    assert('The clip stays where the shape was',Math.abs(clipCenter().x-(shapeBox.left+shapeBox.width/2))<1&&Math.abs(clipCenter().y-(shapeBox.top+shapeBox.height/2))<1);
    imgB.set({left:imgB.left+50});imgB.setCoords();
    assert('The clip moves with the image',Math.abs(clipCenter().x-(shapeBox.left+shapeBox.width/2+50))<1);
    imgB.set({left:imgB.left-50});imgB.setCoords();canvas.renderAll();
    assert('The layer name says the image is cropped to a shape',/cropped to shape/.test(document.getElementById('layers-list').textContent)||(MFC.refreshLayersPanel(),/cropped to shape/.test(document.getElementById('layers-list').textContent)));
    const saved=MFC_PROJECT.captureState();
    assert('The clip is saved with the image',saved.objects.find(o=>o.mfcId===imgB.mfcId).clipPath.type==='ellipse');
    const svg=(await MFC_EXPORT.buildSVG()).svg;
    assert('SVG export keeps the shape crop as a clipping path',/<clipPath[^>]*>\s*<ellipse/.test(svg));
    canvas.setActiveObject(imgB);canvas.fire('selection:created');
    assert('Remove shape crop is offered for a cropped image',!document.getElementById('obj-release-clip').classList.contains('hidden'));
    await MFC.releaseShapeCrop(imgB);
    const back=canvas.getActiveObject(),backBox=back.getBoundingRect(true,true);
    assert('Removing the crop gives the shape back in place',!imgB.clipPath&&back.type==='ellipse'&&Math.abs(backBox.left-shapeBox.left)<1&&Math.abs(backBox.width-shapeBox.width)<1);
    assert('Removing the crop restores the full image frame in place',imgB.width===200&&imgB.cropX===0&&Math.abs(imgB.left-500)<0.01&&Math.abs(imgB.top-100)<0.01);
    canvas.remove(back);canvas.discardActiveObject();
  }

  // ---- Pages ----
  {
    const heightBefore=canvas.getHeight();
    MFC.addPage();
    assert('Add page creates a second page below the first',MFC.pageCount()===2&&canvas.getHeight()>heightBefore&&MFC.pageBounds(1).top===900+120);
    assert('The page navigator appears for several pages',!document.getElementById('page-nav').hidden&&document.getElementById('page-nav').options.length===2);
    const t=new fabric.Textbox('On page 2',{left:100,top:MFC.pageBounds(1).top+100,width:200,fontSize:30,fontFamily:'Liberation Sans'});
    t.mfcId='txt990';t.mfcType='text';MFC.attachTextListeners(t);canvas.add(t);MFC.pushHistory();
    const page1=await MFC_EXPORT.buildSVG({page:0}),page2=await MFC_EXPORT.buildSVG({page:1});
    assert('Each page exports only its own objects',!page1.svg.includes('On page 2')&&page2.svg.includes('On page 2')&&!page2.svg.includes('<image'));
    const textAt=page2.svg.match(/matrix\(1 0 0 1 ([\d.]+) ([\d.]+)\)/);
    assert('A page exports from its own top-left corner',textAt&&Math.abs(textAt[2]-117.45)<1&&page2.width===1200&&page2.height===900);
    const pdf=await MFC_EXPORT.buildPDF();
    const pdfText=await pdf.blob.text();
    assert('PDF export writes one PDF page per figure page',pdf.pageCount===2&&/\/Count 2/.test(pdfText));
    const state=MFC_PROJECT.captureState();
    assert('The page count is saved with the figure',state.docProps.pages===2);
    await MFC_PROJECT.restoreState(state,{resetHistory:false});
    assert('Restoring a saved state restores its pages',MFC.pageCount()===2&&canvas.getObjects().filter(o=>o.mfcIsPageBounds&&o.type==='rect').length===2);
    const removedConfirm=window.confirm;window.confirm=()=>false;
    assert('Removing a page with objects on it can be cancelled',MFC.removeLastPage()===false&&MFC.pageCount()===2);
    window.confirm=removedConfirm;
    await MFC.undo();
    assert('Undo removes the page text first, then the page',canvas.getObjects().every(o=>o.mfcId!=='txt990'));
    await MFC.undo();
    assert('Undo removes the added page',MFC.pageCount()===1);
  }

  // ---- History panel ----
  {
    const h=MFC.getHistory();
    const rows=[...document.querySelectorAll('#history-list .history-row')];
    assert('The History panel lists every step',rows.length===h.labels.length&&rows.length>5);
    assert('History steps have readable labels',h.labels[0]==='Opened figure'&&h.labels.includes('Added a.png')&&h.labels.includes('Restyled 2 objects')&&h.labels.some(l=>/^Cropped b\.png to shape$/.test(l))&&h.labels.includes('Added page 2'));
    assert('The current step is highlighted',rows[h.index].classList.contains('current'));
    const last=h.index;
    rows[2].click();await new Promise(r=>setTimeout(r,300));
    assert('Clicking a step goes back to it',MFC.getHistory().index===2&&document.querySelectorAll('#history-list .history-row.undone').length===h.labels.length-3);
    await MFC.jumpToHistory(last);
    assert('Later steps can be redone from the panel',MFC.getHistory().index===last);
  }

  // ---- Close warning ----
  {
    const event=new Event('beforeunload',{cancelable:true});
    window.dispatchEvent(event);
    assert('Closing with unsaved work asks for confirmation',event.defaultPrevented);
  }
  return checks;
}

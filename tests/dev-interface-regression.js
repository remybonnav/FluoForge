/* Real DOM mouse events must traverse Fabric's pointer-to-document conversion. */
async function runDevInterfaceRegressions() {
  const checks=[];
  const assert=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};
  assert('Startup has no document or white page',!MFC.hasDocument&&!MFC.getCanvas().getObjects().some(obj=>obj.mfcIsPageBounds));
  assert('Startup has no forced document dialog',!document.querySelector('.document-start-modal'));
  assert('Create and Open are available before a document exists',!document.getElementById('empty-create-document').disabled&&!document.getElementById('empty-open-project').disabled);
  assert('Drawing and saving stay disabled until a document is open',document.getElementById('tool-path').disabled&&document.getElementById('btn-save-project').disabled);
  assert('Shape and Path drawing defaults are yellow',document.getElementById('shape-stroke-color').value==='#ffcc00'&&document.getElementById('path-stroke-color').value==='#ffcc00');
  document.getElementById('empty-create-document').click();
  document.getElementById('m-cancel').click();
  assert('Cancel creation keeps the workspace empty',!MFC.hasDocument&&!document.querySelector('.document-start-modal'));
  document.getElementById('empty-create-document').click();
  document.getElementById('m-width').value='0';document.getElementById('m-ok').click();
  assert('Invalid document dimensions leave the workspace empty',!MFC.hasDocument&&document.getElementById('m-error').textContent.length>0);
  document.getElementById('m-width').value='21';document.getElementById('m-ok').click();
  while(!MFC.hasDocument||document.querySelector('.document-start-modal'))await new Promise(resolve=>setTimeout(resolve,10));
  assert('Explicit creation shows a page and enables the tools',MFC.hasDocument&&MFC.getCanvas().getObjects().some(obj=>obj.mfcIsPageBounds)&&!document.getElementById('tool-path').disabled);
  const initialTheme=document.documentElement.dataset.theme;
  for(const theme of ['light','sage','dark','slate']){
    const select=document.getElementById('theme-select');select.value=theme;select.dispatchEvent(new Event('change',{bubbles:true}));
    assert('Theme '+theme+' applies and is remembered',document.documentElement.dataset.theme===theme&&localStorage.getItem('fluoforge-theme')===theme);
  }
  MFC_UI.applyTheme(initialTheme);
  MFC.setTool('shape');
  const shapePanel=document.getElementById('panel-shape'),toggle=shapePanel.querySelector('.panel-toggle');
  assert('Active tool highlights its inspector without reordering it',shapePanel.classList.contains('panel-focused')&&shapePanel.style.order==='');
  if(shapePanel.querySelector('.panel-body').hidden)toggle.click();
  toggle.click();assert('Inspector sections collapse',shapePanel.querySelector('.panel-body').hidden&&toggle.getAttribute('aria-expanded')==='false');
  MFC.setTool('select');MFC.setTool('shape');
  assert('Tool switching never reopens a collapsed section',shapePanel.querySelector('.panel-body').hidden);
  toggle.click();assert('Inspector sections reopen',!shapePanel.querySelector('.panel-body').hidden);
  MFC.setTool('path');
  assert('Switching tools prioritizes the new inspector',document.getElementById('panel-path').classList.contains('panel-focused')&&!shapePanel.classList.contains('panel-focused'));
  assert('Pen palette includes pastels and dark grays',document.getElementById('path-stroke-color').closest('label').nextElementSibling.querySelector('button[title="#242424"]'));
  MFC.setTool('select');
  MFC.applyDocProps({name:'Node drag regression',width:1000,height:700,unit:'px',dpi:300});
  const canvas=MFC.getCanvas();
  MFC.setZoom(.75);
  const makePath=()=>{
    const nodes=[{x:80,y:80,type:'corner'},
      {x:220,y:100,type:'smooth',handleIn:{x:180,y:60},handleOut:{x:260,y:140}},
      {x:360,y:160,type:'corner'}];
    const path=new fabric.Path('M 80 80 C 80 80 180 60 220 100 C 260 140 360 160 360 160',
      {left:80,top:80,stroke:'#e6ad12',strokeWidth:3,fill:'transparent'});
    path.mfcId='native-drag-path';path.mfcType='shape';path.mfcShapeKind='path';path.mfcPathNodes=nodes;
    MFC.installPathControls(path);canvas.add(path);canvas.setActiveObject(path);MFC.enterPathEdit(path);return path;
  };
  const world=(path,p)=>fabric.util.transformPoint(new fabric.Point(p.x-path.pathOffset.x,p.y-path.pathOffset.y),path.calcTransformMatrix());
  const near=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<.2;
  const dispatch=(path,key,dx,dy)=>{
    canvas.renderAll();canvas.calcOffset();path.setCoords();
    const control=path.oCoords[key],rect=canvas.upperCanvasEl.getBoundingClientRect();
    const clientX=rect.left+control.x,clientY=rect.top+control.y;
    canvas.upperCanvasEl.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX,clientY,buttons:1}));
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:clientX+dx,clientY:clientY+dy,buttons:1}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:clientX+dx,clientY:clientY+dy}));
  };
  const path=makePath(),before=path.mfcPathNodes.map(node=>world(path,node));
  dispatch(path,'a1',9,6);
  const after=path.mfcPathNodes.map(node=>world(path,node));
  assert('Native anchor drag follows the mouse without a page-offset jump',near(after[1],{x:before[1].x+12,y:before[1].y+8}));
  assert('Native anchor drag leaves the other anchors fixed',near(after[0],before[0])&&near(after[2],before[2]));
  const nodeBefore=world(path,path.mfcPathNodes[1]),handleBefore=world(path,path.mfcPathNodes[1].handleOut);
  dispatch(path,'o1',6,9);
  assert('Native handle drag follows the mouse without a jump',near(world(path,path.mfcPathNodes[1].handleOut),{x:handleBefore.x+8,y:handleBefore.y+12}));
  assert('Dragging a handle keeps its anchor fixed',near(world(path,path.mfcPathNodes[1]),nodeBefore));
  for (const zoom of [.5,1,1.5]) {
    MFC.setZoom(zoom);
    path.set({angle:27,scaleX:1.25,scaleY:.8,skewX:12,flipX:true});path.setCoords();
    for (const [key,index,handle] of [['a0',0,null],['a2',2,null],['i1',1,'handleIn']]) {
      const pointsBefore=path.mfcPathNodes.map(node=>world(path,node));
      const draggedBefore=world(path,handle?path.mfcPathNodes[index][handle]:path.mfcPathNodes[index]);
      dispatch(path,key,0,0);
      assert(`Click ${key} at zoom ${zoom} does not move geometry`,path.mfcPathNodes.every((node,i)=>near(world(path,node),pointsBefore[i])));
      dispatch(path,key,12,9);
      const draggedAfter=world(path,handle?path.mfcPathNodes[index][handle]:path.mfcPathNodes[index]);
      assert(`Native ${key} drag stays under the pointer at zoom ${zoom}`,near(draggedAfter,{x:draggedBefore.x+12/zoom,y:draggedBefore.y+9/zoom}));
      assert(`Native ${key} drag preserves other anchors and transforms at zoom ${zoom}`,
        path.mfcPathNodes.every((node,i)=>i===index&&!handle||near(world(path,node),pointsBefore[i]))&&path.scaleX===1.25&&path.scaleY===.8&&path.angle===27);
    }
  }
  const archive=await MFC_PROJECT.buildArchive(MFC_PROJECT.prepareSave(false));
  MFC.closeDocument();canvas.clear();
  await MFC_PROJECT.loadProject(new File([archive],'node-drag.mfcproj.zip'));
  assert('Open project restores the page from an empty workspace',MFC.hasDocument&&canvas.getObjects().some(obj=>obj.mfcIsPageBounds)&&document.getElementById('workspace-empty').hidden);
  const restored=canvas.getObjects().find(obj=>obj.mfcId==='native-drag-path');
  MFC.enterPathEdit(restored);const restoredBefore=world(restored,restored.mfcPathNodes[1]);dispatch(restored,'a1',9,6);
  assert('Reopened path remains directly editable without jumping',near(world(restored,restored.mfcPathNodes[1]),{x:restoredBefore.x+9/MFC.getZoomLevel(),y:restoredBefore.y+6/MFC.getZoomLevel()}));
  await MFC.undo();await MFC.redo();
  assert('Undo and redo keep a real document and path geometry',MFC.hasDocument&&canvas.getObjects().some(obj=>obj.mfcId==='native-drag-path'));
  // Switching to Inset with an image still selected used to leave Fabric's active
  // transform in place, moving that image while the outline was being created.
  MFC.setZoom(.75);
  const source=document.createElement('canvas');source.width=source.height=128;
  source.getContext('2d').fillRect(0,0,128,128);
  const blob=await new Promise(resolve=>source.toBlob(resolve,'image/png'));
  await MFC.importFiles([new File([blob],'inset-drag.png',{type:'image/png'})]);
  const image=canvas.getActiveObject();image.set({left:100,top:180,scaleX:2,scaleY:2});image.setCoords();
  MFC.getRegistry()[image.mfcId].rawImage.voxelSizeUm=.5;
  const imageBefore={left:image.left,top:image.top,scaleX:image.scaleX,scaleY:image.scaleY,width:image.width,height:image.height};
  MFC.setTool('inset');
  const screenStart=fabric.util.transformPoint(new fabric.Point(140,220),canvas.viewportTransform);
  const screenEnd=fabric.util.transformPoint(new fabric.Point(200,280),canvas.viewportTransform);
  const rect=canvas.upperCanvasEl.getBoundingClientRect();
  canvas.upperCanvasEl.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:rect.left+screenStart.x,clientY:rect.top+screenStart.y,buttons:1}));
  document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:rect.left+screenEnd.x,clientY:rect.top+screenEnd.y,buttons:1}));
  document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:rect.left+screenEnd.x,clientY:rect.top+screenEnd.y}));
  const outline=canvas.getObjects().find(obj=>obj.mfcType==='insetContour'&&obj.mfcInsetSourceId===image.mfcId);
  assert('Drawing an inset on a selected image keeps its position and size fixed',Object.entries(imageBefore).every(([key,value])=>image[key]===value));
  assert('The inset drag creates an outline linked to the source image',outline&&outline.width>50&&outline.height>50);
  MFC.createInsetFromContour(outline);
  const inset=canvas.getActiveObject();
  assert('The drawn outline creates a calibrated editable linked inset',inset?.mfcIsInset&&inset.mfcInsetSourceId===image.mfcId&&MFC.getRegistry()[inset.mfcId].sourceId===MFC.getRegistry()[image.mfcId].sourceId&&MFC.getRegistry()[inset.mfcId].rawImage.voxelSizeUm===.5);

  // Shapes and labels start on top of an image (circling a cell, labelling a panel).
  const dragOnCanvas=(from,to)=>{
    const a=fabric.util.transformPoint(new fabric.Point(...from),canvas.viewportTransform);
    const b=fabric.util.transformPoint(new fabric.Point(...to),canvas.viewportTransform);
    const box=canvas.upperCanvasEl.getBoundingClientRect();
    canvas.upperCanvasEl.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:box.left+a.x,clientY:box.top+a.y,buttons:1}));
    document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:box.left+b.x,clientY:box.top+b.y,buttons:1}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:box.left+b.x,clientY:box.top+b.y}));
  };
  const ellipsesBefore=canvas.getObjects().filter(obj=>obj.mfcType==='shape'&&obj.type==='ellipse').length;
  MFC.setTool('shape');MFC.setShapeKind('ellipse');
  const imageAt={left:image.left,top:image.top};
  dragOnCanvas([150,230],[230,300]);
  const ellipse=canvas.getObjects().filter(obj=>obj.mfcType==='shape'&&obj.type==='ellipse');
  assert('An ellipse can be drawn starting on an image',ellipse.length===ellipsesBefore+1&&ellipse[ellipse.length-1].getScaledWidth()>60);
  assert('Drawing a shape over an image leaves the image in place',image.left===imageAt.left&&image.top===imageAt.top);
  MFC.setShapeKind('rect');
  const textsBefore=canvas.getObjects().filter(obj=>obj.type==='textbox').length;
  MFC.setTool('text');
  dragOnCanvas([160,240],[160,240]);
  const label=canvas.getObjects().filter(obj=>obj.type==='textbox');
  assert('The Text tool places a label on top of an image',label.length===textsBefore+1&&Math.abs(label[label.length-1].left-160)<2);
  if(label[label.length-1].isEditing)label[label.length-1].exitEditing();
  canvas.discardActiveObject();document.activeElement?.blur?.();MFC.setTool('select');
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'i',bubbles:true}));
  assert('The I key selects the Inset tool, as its tooltip says',MFC.currentTool==='inset');
  MFC.setTool('select');
  return checks;
}

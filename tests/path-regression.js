/* Run in the locally served editor with: await runPathRegressions() */
async function runPathRegressions() {
  const checks=[];
  const assert=(name,value)=>{if(!value)throw new Error('Path regression failed: '+name);checks.push(name);};
  MFC.applyDocProps({name:'Path regression',width:1000,height:700,unit:'px',dpi:300});
  const canvas=MFC.getCanvas();
  canvas.getObjects().filter(object=>!object.mfcIsPageBounds).forEach(object=>canvas.remove(object));
  const eventAt=(x,y,options={})=>{
    const screen=fabric.util.transformPoint(new fabric.Point(x,y),canvas.viewportTransform);
    const rect=canvas.upperCanvasEl.getBoundingClientRect();
    return new MouseEvent(options.type||'mousemove',{clientX:rect.left+screen.x,clientY:rect.top+screen.y,
      buttons:options.buttons??0,detail:options.detail??1,shiftKey:!!options.shiftKey,ctrlKey:!!options.ctrlKey,altKey:!!options.altKey});
  };
  const down=(x,y,options={})=>canvas.fire('mouse:down',{e:eventAt(x,y,{...options,type:'mousedown',buttons:1}),target:null});
  const move=(x,y,options={})=>canvas.fire('mouse:move',{e:eventAt(x,y,{...options,type:'mousemove',buttons:1}),target:null});
  const up=(x,y,options={})=>canvas.fire('mouse:up',{e:eventAt(x,y,{...options,type:'mouseup',buttons:0}),target:null});
  const click=(x,y,options={})=>{down(x,y,options);up(x,y,options);};
  const worldNode=(path,node)=>fabric.util.transformPoint(new fabric.Point(node.x-path.pathOffset.x,node.y-path.pathOffset.y),path.calcTransformMatrix());
  const distanceForTest=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

  MFC.setTool('path');
  click(200,200);
  click(315,235,{shiftKey:true});
  down(410,300);move(450,255);up(450,255);
  click(540,350);
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  const path=canvas.getActiveObject();
  assert('progressive clicks create one editable path',path?.mfcShapeKind==='path');
  assert('arbitrary node count is preserved',path.mfcPathNodes.length===4);
  assert('Shift constrains a segment to a standard angle',Math.abs(path.mfcPathNodes[1].y-path.mfcPathNodes[0].y)<.01);
  assert('click and drag creates Bézier handles',!!path.mfcPathNodes[2].handleIn&&!!path.mfcPathNodes[2].handleOut);
  assert('one path mixes straight and cubic commands',path.path.some(command=>command[0]==='L')&&path.path.some(command=>command[0]==='C'));
  assert('new path defaults to round cap and join',path.strokeLineCap==='round'&&path.strokeLineJoin==='round');
  assert('drawing helpers are removed on finish',!canvas.getObjects().some(object=>object.mfcIsPathHelper||object.mfcIsPathDraft));

  const snapTarget=worldNode(path,path.mfcPathNodes[0]);MFC.setTool('path');click(700,200);click(snapTarget.x+5,snapTarget.y+3,{ctrlKey:true});
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  const snappedPath=canvas.getActiveObject();
  assert('Ctrl snaps a new node to a nearby path node',distanceForTest(snappedPath.mfcPathNodes[1],snapTarget)<.01);
  canvas.remove(snappedPath);canvas.setActiveObject(path);

  MFC.enterPathEdit(path);path.__mfcSelectedNode=2;MFC.setSelectedIncomingSegment(false);
  assert('curve converts to a straight segment',path.path[2][0]==='L');
  MFC.setSelectedIncomingSegment(true);
  assert('straight segment converts to a cubic curve',path.path[2][0]==='C');
  MFC.setSelectedNodeType('smooth');
  assert('node converts to smooth with two handles',path.mfcPathNodes[2].type==='smooth'&&path.mfcPathNodes[2].handleIn&&path.mfcPathNodes[2].handleOut);
  MFC.setSelectedNodeType('corner');
  assert('node converts to corner without losing its handles',path.mfcPathNodes[2].type==='corner'&&path.mfcPathNodes[2].handleIn&&path.mfcPathNodes[2].handleOut);

  const beforeInsert=path.mfcPathNodes.length,a=worldNode(path,path.mfcPathNodes[0]),b=worldNode(path,path.mfcPathNodes[1]);
  canvas.fire('mouse:dblclick',{target:path,e:eventAt((a.x+b.x)/2,(a.y+b.y)/2,{detail:2,type:'dblclick'})});
  assert('double-clicking a segment inserts an editable node',path.mfcPathNodes.length===beforeInsert+1);
  MFC.deleteSelectedPathNode();
  assert('Delete removes the selected node only',path.mfcPathNodes.length===beforeInsert&&canvas.getObjects().includes(path));

  path.__mfcSelectedNode=2;MFC.setSelectedNodeType('smooth');MFC.enterPathEdit(path);
  let node=path.mfcPathNodes[2],desired={x:node.handleOut.x+30,y:node.handleOut.y+35};
  let local=new fabric.Point(desired.x-path.pathOffset.x,desired.y-path.pathOffset.y);
  let screen=fabric.util.transformPoint(local,path.calcTransformMatrix());
  path.controls.o2.actionHandler({altKey:false,ctrlKey:false},{target:path},screen.x,screen.y);
  node=path.mfcPathNodes[2];
  const incoming={x:node.handleIn.x-node.x,y:node.handleIn.y-node.y},outgoing={x:node.handleOut.x-node.x,y:node.handleOut.y-node.y};
  assert('smooth handle drag keeps handles collinear',Math.abs(incoming.x*outgoing.y-incoming.y*outgoing.x)<.01&&incoming.x*outgoing.x+incoming.y*outgoing.y<0);
  const oldOpposite={...node.handleIn};desired={x:node.handleOut.x+45,y:node.handleOut.y+20};
  local=new fabric.Point(desired.x-path.pathOffset.x,desired.y-path.pathOffset.y);
  screen=fabric.util.transformPoint(local,path.calcTransformMatrix());
  path.controls.o2.actionHandler({altKey:true,ctrlKey:false},{target:path},screen.x,screen.y);
  assert('Alt breaks smooth handle coupling',path.mfcPathNodes[2].type==='corner'&&
    path.mfcPathNodes[2].handleIn.x===oldOpposite.x&&path.mfcPathNodes[2].handleIn.y===oldOpposite.y);

  MFC.togglePathClosed();
  assert('path can be closed after creation',path.mfcPathClosed&&path.path.at(-1)[0]==='Z');
  MFC.togglePathClosed();
  assert('closed path can be reopened',!path.mfcPathClosed&&path.path.at(-1)[0]!=='Z');

  document.getElementById('path-stroke-color').value='#b31860';document.getElementById('path-arrow-start').value='arrow';document.getElementById('path-arrow-end').value='arrow';
  document.getElementById('path-dash').value='dashed';document.getElementById('path-opacity').value='65';MFC.applyPathStyle();
  const svg=path.toSVG();
  assert('arrowheads export as vector polygons',svg.includes('<polygon')&&(svg.match(/<polygon/g)||[]).length===2);
  assert('path styling keeps dash and opacity',path.strokeDashArray?.length===2&&Math.abs(path.opacity-.65)<.001);

  MFC.exitPathEdit(path);canvas.setActiveObject(path);MFC.copySelection();await MFC.pasteSelection();
  const pasted=canvas.getActiveObject();
  assert('copy and paste preserves node geometry',JSON.stringify(pasted.mfcPathNodes)===JSON.stringify(path.mfcPathNodes));
  assert('copy and paste preserves arrow settings',pasted.mfcArrowStart==='arrow'&&pasted.mfcArrowEnd==='arrow');
  const state=MFC_PROJECT.captureState();await MFC_PROJECT.restoreState(state);
  const restored=canvas.getObjects().find(object=>object.mfcShapeKind==='path');
  assert('project state restores editable nodes',restored?.mfcPathNodes.length===path.mfcPathNodes.length);
  MFC.enterPathEdit(restored);
  assert('restored path re-enters node editing',restored.__mfcNodeEdit&&Object.keys(restored.controls).some(key=>key.startsWith('a')));
  assert('SVG keeps the annotation as a real path',restored.toSVG().includes('<path'));
  MFC.exitPathEdit(restored);
  const exportedSVG=await MFC_EXPORT.buildSVG(),exportedPDF=await MFC_EXPORT.buildPDF();
  assert('full SVG export keeps path and arrowhead vectors',exportedSVG.svg.includes('<path')&&exportedSVG.svg.includes('<polygon'));
  assert('PDF export accepts the editable vector path',exportedPDF.blob.type==='application/pdf'&&exportedPDF.blob.size>1000);
  window.__pathVerification={pdf:exportedPDF.blob,svg:new Blob([exportedSVG.svg],{type:'image/svg+xml'})};

  const legacy=new fabric.Path('M 20 20 Q 80 -30 140 20',{stroke:'#fff',fill:'transparent'});
  legacy.mfcId='legacyCurve';legacy.mfcType='shape';legacy.mfcShapeKind='curve';MFC.installPathControls(legacy);
  assert('legacy curved lines migrate to path nodes',legacy.mfcShapeKind==='path'&&legacy.mfcPathNodes.length===2&&legacy.mfcPathNodes[0].handleOut);
  return checks;
}

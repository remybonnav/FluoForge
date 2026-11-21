/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Pen / Path tool: straight and Bezier nodes, node editing, arrowheads and the Path panel. */

import { pushHistory } from '../core/history.js';
import { DASH_PRESETS, canvas, currentTool, isHelper, takeId } from '../core/state.js';
import { zoomLevel } from '../core/zoom.js';
import { toHexColor } from './text.js';
import { setTool } from './tool-switch.js';
import { applyLockState, refuseLocked } from '../ui/locks.js';
import { selectedObjects } from '../ui/selection-bar.js';

// ---- unified Pen / Path tool ----
// Nodes live in the same command-coordinate space as Fabric's path array. This keeps
// the editable source geometry independent of the object's move/rotate/scale transform.
export let pathDefaultMode = 'straight';
export let pathDraft = null;
export let pathPointer = null;
export let pathHelpers = [];

export const point = (x, y) => ({ x, y });
export const copyPoint = p => p ? point(p.x, p.y) : null;
export const copyNodes = nodes => nodes.map(n => ({ x:n.x, y:n.y, type:n.type || 'corner',
  handleIn:copyPoint(n.handleIn), handleOut:copyPoint(n.handleOut) }));
export const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
export const mixPoint = (a,b,t) => point(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);

export function pathCommands(nodes, closed = false, preview = null) {
  if (!nodes.length) return [];
  const commands = [['M', nodes[0].x, nodes[0].y]];
  const addSegment = (from, to) => {
    if (from.handleOut || to.handleIn) commands.push(['C',
      (from.handleOut || from).x, (from.handleOut || from).y,
      (to.handleIn || to).x, (to.handleIn || to).y, to.x, to.y]);
    else commands.push(['L', to.x, to.y]);
  };
  for (let i=1;i<nodes.length;i++) addSegment(nodes[i-1],nodes[i]);
  if (preview) addSegment(nodes[nodes.length-1],preview);
  else if (closed && nodes.length > 2) { addSegment(nodes[nodes.length-1],nodes[0]); commands.push(['Z']); }
  return commands;
}

export function pathStyleFromPanel() {
  return {
    stroke: document.getElementById('path-stroke-color').value,
    strokeWidth: Math.max(0.1, parseFloat(document.getElementById('path-stroke-width').value) || 3),
    strokeDashArray: DASH_PRESETS[document.getElementById('path-dash').value] || null,
    strokeLineCap: document.getElementById('path-line-cap').value,
    strokeLineJoin: document.getElementById('path-line-join').value,
    opacity: Math.max(0,Math.min(1,(parseFloat(document.getElementById('path-opacity').value) || 0)/100)),
    fill: 'transparent', strokeUniform: true, perPixelTargetFind: false,
    cornerStyle: 'circle', transparentCorners: false, cornerColor: '#5b8cff', borderColor: '#5b8cff'
  };
}

export function setPathStatus(text, active = false) {
  const el = document.getElementById('path-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('path-status-active', active);
}

export function setPathDefaultMode(mode) {
  pathDefaultMode = mode;
  document.getElementById('path-mode-straight').classList.toggle('active',mode === 'straight');
  document.getElementById('path-mode-bezier').classList.toggle('active',mode === 'bezier');
  setPathStatus(mode === 'bezier'
    ? 'Bézier default: click and drag to set tangent handles; plain clicks remain editable.'
    : 'Straight default: click to add corners; drag any new node to make that section curved.');
}

export function constrainedPoint(p, origin, shift) {
  if (!shift || !origin) return point(p.x,p.y);
  const dx=p.x-origin.x,dy=p.y-origin.y,r=Math.hypot(dx,dy);
  if (!r) return point(p.x,p.y);
  const angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*(Math.PI/4);
  return point(origin.x+Math.cos(angle)*r,origin.y+Math.sin(angle)*r);
}

export function pathNodeWorld(path, node) {
  return fabric.util.transformPoint(new fabric.Point(node.x-path.pathOffset.x,node.y-path.pathOffset.y),path.calcTransformMatrix());
}

export function snapPathPoint(p, enabled, excludePath = null) {
  if (!enabled) return { point:point(p.x,p.y), snapped:false };
  const candidates=[];
  canvas.getObjects().forEach(obj => {
    if (obj === excludePath || isHelper(obj)) return;
    if (obj.mfcShapeKind === 'path' && obj.mfcPathNodes)
      obj.mfcPathNodes.forEach(node => candidates.push({ ...pathNodeWorld(obj,node), label:'node' }));
    const box=obj.getBoundingRect(true,true);
    const xs=[box.left,box.left+box.width/2,box.left+box.width];
    const ys=[box.top,box.top+box.height/2,box.top+box.height];
    xs.forEach(x=>ys.forEach(y=>candidates.push({x,y,label:'edge/center'})));
  });
  let best=null,bestDistance=12/zoomLevel;
  candidates.forEach(candidate=>{const d=distance(p,candidate);if(d<bestDistance){best=candidate;bestDistance=d;}});
  if (!best) return { point:point(p.x,p.y), snapped:false };
  setPathStatus('Snapped to nearby '+best.label+'.',true);
  return { point:point(best.x,best.y), snapped:true };
}

export function helperObject(obj) {
  obj.set({ selectable:false,evented:false,excludeFromExport:true,objectCaching:false });
  obj.mfcIsPathHelper=true;
  pathHelpers.push(obj); canvas.add(obj); return obj;
}

export function clearPathHelpers() {
  pathHelpers.forEach(obj=>canvas.remove(obj));
  pathHelpers=[];
}

export function renderPathDraft() {
  clearPathHelpers();
  if (!pathDraft || !pathDraft.nodes.length) { canvas.requestRenderAll(); return; }
  const hover = pathPointer ? null : pathDraft.hover;
  const commands=pathCommands(pathDraft.nodes,false,hover);
  if (commands.length>1) {
    const preview=new fabric.Path(commands,{...pathDraft.style,opacity:Math.max(.3,pathDraft.style.opacity)});
    preview.mfcIsPathDraft=true; helperObject(preview);
  }
  const radius=5/zoomLevel,handleRadius=4/zoomLevel;
  pathDraft.nodes.forEach((node,index)=>{
    for (const handle of [node.handleIn,node.handleOut]) if (handle) {
      helperObject(new fabric.Line([node.x,node.y,handle.x,handle.y],{stroke:'#8fb0ff',strokeWidth:1/zoomLevel}));
      helperObject(new fabric.Circle({left:handle.x,top:handle.y,originX:'center',originY:'center',radius:handleRadius,
        fill:'#1b1e24',stroke:'#8fb0ff',strokeWidth:1/zoomLevel}));
    }
    helperObject(new fabric.Circle({left:node.x,top:node.y,originX:'center',originY:'center',radius,
      fill:index===pathDraft.nodes.length-1?'#5b8cff':'#ffffff',stroke:'#172031',strokeWidth:1/zoomLevel}));
  });
  if (pathDraft.snap && hover) helperObject(new fabric.Circle({left:hover.x,top:hover.y,originX:'center',originY:'center',
    radius:8/zoomLevel,fill:'transparent',stroke:'#5b8cff',strokeWidth:2/zoomLevel}));
  canvas.requestRenderAll();
}

export function beginPathPointer(raw, evt) {
  if (evt.detail >= 2 && pathDraft) { finishPathDrawing(false); return; }
  if (!pathDraft) pathDraft={nodes:[],style:pathStyleFromPanel(),hover:null,snap:false};
  const previous=pathDraft.nodes.at(-1);
  let p=constrainedPoint(raw,previous,evt.shiftKey);
  const snapped=snapPathPoint(p,evt.ctrlKey);p=snapped.point;pathDraft.snap=snapped.snapped;
  const first=pathDraft.nodes[0];
  if (first && pathDraft.nodes.length>2 && distance(p,first)<=12/zoomLevel) { finishPathDrawing(true); return; }
  const node={x:p.x,y:p.y,type:'corner',handleIn:null,handleOut:null};
  pathDraft.nodes.push(node);
  pathPointer={index:pathDraft.nodes.length-1,start:point(p.x,p.y),moved:false};
  pathDraft.hover=null;
  renderPathDraft();
}

export function movePathPointer(raw, evt) {
  if (!pathDraft || !pathDraft.nodes.length) return;
  if (pathPointer) {
    const node=pathDraft.nodes[pathPointer.index];
    const handlePoint=constrainedPoint(raw,pathPointer.start,evt.shiftKey);
    const dx=handlePoint.x-pathPointer.start.x,dy=handlePoint.y-pathPointer.start.y;
    pathPointer.moved=pathPointer.moved||Math.hypot(dx,dy)>3/zoomLevel;
    if (pathPointer.moved) {
      node.handleIn=point(node.x-dx,node.y-dy);node.handleOut=point(node.x+dx,node.y+dy);
      node.type=evt.altKey?'corner':'smooth';
      setPathStatus(evt.altKey?'Corner node: handles are independent.':'Smooth Bézier node.',true);
    }
  } else {
    const previous=pathDraft.nodes.at(-1);
    let p=constrainedPoint(raw,previous,evt.shiftKey);
    const snapped=snapPathPoint(p,evt.ctrlKey);pathDraft.hover=snapped.point;pathDraft.snap=snapped.snapped;
    if (evt.shiftKey) setPathStatus('Shift constraint: 45° angle.',true);
  }
  renderPathDraft();
}

export function endPathPointer(_raw, _evt) {
  if (!pathPointer || !pathDraft) return;
  const index=pathPointer.index,node=pathDraft.nodes[index];
  if (!pathPointer.moved && pathDefaultMode==='bezier' && index>0) {
    const previous=pathDraft.nodes[index-1],dx=(node.x-previous.x)/3,dy=(node.y-previous.y)/3;
    if (!previous.handleOut) previous.handleOut=point(previous.x+dx,previous.y+dy);
    node.handleIn=point(node.x-dx,node.y-dy);node.handleOut=point(node.x+dx,node.y+dy);node.type='smooth';
  }
  pathPointer=null;
  setPathStatus(pathDraft.nodes.length===1?'Add another node to create a segment.':'Continue clicking, or double-click / press Enter to finish.',true);
  renderPathDraft();
}

export function makeEditablePath(nodes,style,closed=false) {
  const path=new fabric.Path(pathCommands(nodes,closed),style);
  path.mfcId='pth'+takeId();path.mfcType='shape';path.mfcShapeKind='path';
  path.mfcPathNodes=copyNodes(nodes);path.mfcPathClosed=!!closed;
  path.mfcArrowStart=document.getElementById('path-arrow-start').value;
  path.mfcArrowEnd=document.getElementById('path-arrow-end').value;
  installPathControls(path);
  return path;
}

export function finishPathDrawing(closed=false) {
  if (!pathDraft) return false;
  const draft=pathDraft;pathDraft=null;pathPointer=null;clearPathHelpers();
  if (draft.nodes.length<2) { setPathStatus('Path cancelled: add at least two nodes.');canvas.requestRenderAll();return false; }
  const path=makeEditablePath(draft.nodes,draft.style,closed);
  canvas.add(path);canvas.setActiveObject(path);canvas.requestRenderAll();pushHistory();
  setTool('select');refreshPathPanel();
  setPathStatus(closed?'Closed path created.':'Open path created. Select Edit nodes for direct geometry editing.');
  return true;
}

/** Leaving the Path tool cancels a path still being drawn. */
export function stopPathDrawing() { if (pathDraft) cancelPathDrawing(); }

export function cancelPathDrawing() {
  if (!pathDraft) return false;
  pathDraft=null;pathPointer=null;clearPathHelpers();canvas.requestRenderAll();
  setPathStatus('Unfinished path cancelled.');return true;
}

/** How the path is scaled on the page, for sizes that must not follow it. A path with strokeUniform
    keeps its line width in page pixels when it is resized, so its arrowheads must too (otherwise a
    smaller path gets an arrowhead thinner than its line, which then pokes out of the tip). Paths
    whose stroke scales with them keep arrowheads in their own units, as before. */
function arrowScale(path) {
  if (!path.strokeUniform) return { x: 1, y: 1 };
  const s = path.group ? path.getObjectScaling() : { scaleX: path.scaleX, scaleY: path.scaleY };
  return { x: Math.abs(s.scaleX) || 1, y: Math.abs(s.scaleY) || 1 };
}

/** The tip node and the direction towards it, in page-scaled units: { tip, vx, vy, sx, sy }. */
function arrowFrame(path,atStart) {
  const nodes=path.mfcPathNodes||[];if(nodes.length<2)return null;
  const tip=atStart?nodes[0]:nodes[nodes.length-1];
  let reference;
  if(atStart){const next=nodes[1];reference=tip.handleOut||next.handleIn||next;}
  else{const previous=nodes[nodes.length-2];reference=tip.handleIn||previous.handleOut||previous;}
  const {x:sx,y:sy}=arrowScale(path);
  let vx=(tip.x-reference.x)*sx,vy=(tip.y-reference.y)*sy;
  const length=Math.hypot(vx,vy);if(length<.001)return null;
  return {tip,vx:vx/length,vy:vy/length,sx,sy};
}

/** Arrowhead triangle [tip, corner, corner] in the path's own coordinates. Its length is
    max(10, 4 × line width) and its half-width 0.45 × that, measured on the page for paths whose line
    width does not scale (and in the path's units otherwise). */
export function pathArrowGeometry(path,atStart) {
  const f=arrowFrame(path,atStart);if(!f)return null;
  const {tip,vx,vy,sx,sy}=f;
  const size=Math.max(10,(path.strokeWidth||1)*4),half=size*.45;
  const local=(a,b)=>point(tip.x+a/sx,tip.y+b/sy);
  return [tip,local(-vx*size-vy*half,-vy*size+vx*half),local(-vx*size+vy*half,-vy*size-vx*half)];
}

/** The path's commands with each arrow end pulled back by half the line width when the line has
    round or square caps, which would otherwise stick out past the tip. null when nothing changes. */
export function pathStrokeCommands(path) {
  const cap=path.strokeLineCap;
  if(cap!=='round'&&cap!=='square')return null;
  const ends=[['mfcArrowStart',true],['mfcArrowEnd',false]].filter(([key])=>path[key]==='arrow');
  if(!ends.length||path.mfcPathClosed||!Array.isArray(path.path)||path.path.length<2)return null;
  const commands=path.path.map(c=>c.slice()),t=(path.strokeWidth||1)/2;
  for(const [,atStart] of ends){
    const f=arrowFrame(path,atStart);if(!f)continue;
    const dx=-f.vx*t/f.sx,dy=-f.vy*t/f.sy; // towards the line, in path units
    if(atStart){
      const first=commands[0];first[first.length-2]+=dx;first[first.length-1]+=dy;
      const next=commands[1];if(next&&next[0].toUpperCase()==='C'){next[1]+=dx;next[2]+=dy;}
    }else{
      const last=commands[commands.length-1],n=last.length;last[n-2]+=dx;last[n-1]+=dy;
      if(last[0].toUpperCase()==='C'){last[3]+=dx;last[4]+=dy;}
    }
  }
  return commands;
}

export function installPathRendering(path) {
  if(path.__mfcPathRendering)return;path.__mfcPathRendering=true;path.objectCaching=false;
  const baseRender=path._render;
  path._render=function(ctx){
    const trimmed=pathStrokeCommands(this),original=this.path;
    if(trimmed)this.path=trimmed;
    try{baseRender.call(this,ctx);}finally{this.path=original;}
    ctx.save();ctx.fillStyle=this.stroke||'#000';
    const draw=geometry=>{if(!geometry)return;ctx.beginPath();ctx.moveTo(geometry[0].x-this.pathOffset.x,geometry[0].y-this.pathOffset.y);
      ctx.lineTo(geometry[1].x-this.pathOffset.x,geometry[1].y-this.pathOffset.y);ctx.lineTo(geometry[2].x-this.pathOffset.x,geometry[2].y-this.pathOffset.y);ctx.closePath();ctx.fill();};
    if(this.mfcArrowStart==='arrow')draw(pathArrowGeometry(this,true));
    if(this.mfcArrowEnd==='arrow')draw(pathArrowGeometry(this,false));ctx.restore();
  };
  const baseSVG=path._toSVG;
  path._toSVG=function(){
    const trimmed=pathStrokeCommands(this),original=this.path;
    if(trimmed)this.path=trimmed;
    let parts;try{parts=baseSVG.call(this);}finally{this.path=original;}
    const color=String(this.stroke||'#000').replace(/"/g,'');
    const polygon=geometry=>geometry?`<polygon points="${geometry.map(p=>`${p.x},${p.y}`).join(' ')}" transform="translate(${-this.pathOffset.x} ${-this.pathOffset.y})" fill="${color}" stroke="none" opacity="${this.opacity}" />\n`:'';
    if(this.mfcArrowStart==='arrow')parts.push(polygon(pathArrowGeometry(this,true)));
    if(this.mfcArrowEnd==='arrow')parts.push(polygon(pathArrowGeometry(this,false)));
    return parts;
  };
}

export function nodesFromFabricPath(path) {
  const nodes=[];let closed=false;
  for(const command of path.path||[]){
    const type=command[0].toUpperCase();
    if(type==='M')nodes.push({x:command[1],y:command[2],type:'corner',handleIn:null,handleOut:null});
    else if(type==='L')nodes.push({x:command[1],y:command[2],type:'corner',handleIn:null,handleOut:null});
    else if(type==='Q'&&nodes.length){
      const previous=nodes.at(-1),control=point(command[1],command[2]),end=point(command[3],command[4]);
      previous.handleOut=mixPoint(previous,control,2/3);
      nodes.push({x:end.x,y:end.y,type:'smooth',handleIn:mixPoint(end,control,2/3),handleOut:null});
    }else if(type==='C'&&nodes.length){
      nodes.at(-1).handleOut=point(command[1],command[2]);
      nodes.push({x:command[5],y:command[6],type:'smooth',handleIn:point(command[3],command[4]),handleOut:null});
    }else if(type==='Z')closed=true;
  }
  return {nodes,closed};
}

export function commandPointFromControl(path,x,y) {
  // Fabric's actionHandler receives document coordinates (getPointer already undoes
  // the viewport). Removing zoom/pasteboard a second time made nodes jump on dragging.
  const local=fabric.util.transformPoint(new fabric.Point(x,y),fabric.util.invertTransform(path.calcTransformMatrix()));
  return point(local.x+path.pathOffset.x,local.y+path.pathOffset.y);
}

export function rebuildEditablePath(path,referenceIndex=0) {
  const nodes=path.mfcPathNodes;if(!nodes.length)return;
  const safe=Math.max(0,Math.min(referenceIndex,nodes.length-1));
  const before=pathNodeWorld(path,nodes[safe]);
  path._setPath(pathCommands(nodes,path.mfcPathClosed));
  const after=pathNodeWorld(path,nodes[safe]);
  // Position lives in the parent's coordinate space when a path is grouped.
  const inverseParent = path.group ? fabric.util.invertTransform(path.group.calcTransformMatrix()) : fabric.iMatrix;
  const delta = fabric.util.transformPoint(new fabric.Point(before.x-after.x,before.y-after.y),inverseParent,true);
  path.set({left:path.left+delta.x,top:path.top+delta.y});
  if(path.__mfcNodeEdit)path.controls=buildNodeControls(path);
  path.setCoords();path.dirty=true;installPathRendering(path);
}

export function renderPathControl(ctx,left,top,styleOverride,fabricObject) {
  ctx.save();ctx.beginPath();ctx.arc(left,top,5,0,Math.PI*2);
  ctx.fillStyle=styleOverride.fill;ctx.strokeStyle=styleOverride.stroke;ctx.lineWidth=1.5;ctx.fill();ctx.stroke();ctx.restore();
}

export function makeNodeControl(path,index,handleName=null) {
  return new fabric.Control({cursorStyle:handleName?'crosshair':'move',cornerSize:12,actionName:'modifyPath',
    positionHandler:(_dim,_matrix,obj)=>{
      const node=obj.mfcPathNodes[index],value=(handleName?node[handleName]:node)||node;
      const local=new fabric.Point(value.x-obj.pathOffset.x,value.y-obj.pathOffset.y);
      return fabric.util.transformPoint(local,fabric.util.multiplyTransformMatrices((obj.canvas?obj.canvas.viewportTransform:fabric.iMatrix),obj.calcTransformMatrix()));
    },
    mouseDownHandler:(_evt,transform,x,y)=>{
      const obj=transform.target,node=obj.mfcPathNodes[index],value=handleName?node[handleName]:node;
      const pointer=commandPointFromControl(obj,x,y);
      transform.mfcGrabOffset=point(value.x-pointer.x,value.y-pointer.y);
      obj.__mfcSelectedNode=index;refreshPathPanel();return true;
    },
    actionHandler:(evt,transform,x,y)=>{
      const obj=transform.target,nodes=obj.mfcPathNodes,node=nodes[index];obj.__mfcSelectedNode=index;
      let value=commandPointFromControl(obj,x,y);
      if(transform.mfcGrabOffset){value.x+=transform.mfcGrabOffset.x;value.y+=transform.mfcGrabOffset.y;}
      if(evt.ctrlKey){const raw=canvas.getPointer(evt),snapped=snapPathPoint(raw,true,obj);if(snapped.snapped){
        const inv=fabric.util.invertTransform(obj.calcTransformMatrix()),local=fabric.util.transformPoint(new fabric.Point(snapped.point.x,snapped.point.y),inv);
        value=point(local.x+obj.pathOffset.x,local.y+obj.pathOffset.y);
      }}
      const reference=index===0?Math.min(1,nodes.length-1):0;
      if(!handleName){const dx=value.x-node.x,dy=value.y-node.y;node.x=value.x;node.y=value.y;
        if(node.handleIn){node.handleIn.x+=dx;node.handleIn.y+=dy;}if(node.handleOut){node.handleOut.x+=dx;node.handleOut.y+=dy;}
      }else{
        node[handleName]=value;
        if(node.type==='smooth'&&!evt.altKey){const other=handleName==='handleIn'?'handleOut':'handleIn';
          const vx=value.x-node.x,vy=value.y-node.y,length=Math.hypot(vx,vy)||1;
          const old=node[other],otherLength=old?distance(node,old):length;
          node[other]=point(node.x-vx/length*otherLength,node.y-vy/length*otherLength);
        }else if(evt.altKey)node.type='corner';
      }
      rebuildEditablePath(obj,reference);refreshPathPanel();canvas.requestRenderAll();return true;
    },
    render:(ctx,left,top,_style,obj)=>{
      if(handleName){const anchor=obj.mfcPathNodes[index],anchorScreen=fabric.util.transformPoint(
        new fabric.Point(anchor.x-obj.pathOffset.x,anchor.y-obj.pathOffset.y),
        fabric.util.multiplyTransformMatrices((obj.canvas?obj.canvas.viewportTransform:fabric.iMatrix),obj.calcTransformMatrix()));
        ctx.save();ctx.beginPath();ctx.moveTo(anchorScreen.x,anchorScreen.y);ctx.lineTo(left,top);ctx.strokeStyle='#8fb0ff';ctx.lineWidth=1;ctx.stroke();ctx.restore();
      }
      renderPathControl(ctx,left,top,{fill:handleName?'#1b1e24':(obj.__mfcSelectedNode===index?'#5b8cff':'#fff'),stroke:'#5b8cff'},obj);
    }
  });
}

export function buildNodeControls(path) {
  const controls={};path.mfcPathNodes.forEach((node,index)=>{
    controls['a'+index]=makeNodeControl(path,index);
    if(node.handleIn)controls['i'+index]=makeNodeControl(path,index,'handleIn');
    if(node.handleOut)controls['o'+index]=makeNodeControl(path,index,'handleOut');
  });return controls;
}

export function installPathControls(path) {
  if(!path.mfcPathNodes&&(path.mfcShapeKind==='curve'||path.mfcShapeKind==='polyline')){
    const legacy=nodesFromFabricPath(path);path.mfcPathNodes=legacy.nodes;path.mfcPathClosed=legacy.closed;path.mfcShapeKind='path';
  }
  if(path.mfcShapeKind!=='path'||!path.mfcPathNodes)return;
  path.mfcPathNodes=copyNodes(path.mfcPathNodes);path.mfcArrowStart=path.mfcArrowStart||'none';path.mfcArrowEnd=path.mfcArrowEnd||'none';
  path.__mfcStandardControls=fabric.Object.prototype.controls;path.controls=path.__mfcStandardControls;path.__mfcNodeEdit=false;
  path.__mfcSelectedNode=0;path.hasBorders=true;installPathRendering(path);
}

export function enterPathEdit(path=canvas.getActiveObject()) {
  if(!path||path.mfcShapeKind!=='path')return false;
  if(refuseLocked(path,'reshaped'))return false;
  path.__mfcNodeEdit=true;path.__mfcSelectedNode=Math.min(path.__mfcSelectedNode||0,path.mfcPathNodes.length-1);
  path.controls=buildNodeControls(path);path.hasBorders=false;path.lockMovementX=true;path.lockMovementY=true;
  canvas.setActiveObject(path);canvas.requestRenderAll();refreshPathPanel();MFC_UI.focusPanel('panel-path');setPathStatus('Node editing active. Double-click a segment to insert a node.',true);return true;
}

export function exitPathEdit(path=canvas.getActiveObject()) {
  if(!path||path.mfcShapeKind!=='path')return false;
  path.__mfcNodeEdit=false;path.controls=path.__mfcStandardControls||fabric.Object.prototype.controls;path.hasBorders=true;
  applyLockState(path);path.setCoords();canvas.requestRenderAll();refreshPathPanel();return true;
}

export function updatePathControls(path) { if(path&&path.__mfcNodeEdit)path.controls=buildNodeControls(path); }

export function deleteSelectedPathNode() {
  const path=canvas.getActiveObject();if(!path||!path.__mfcNodeEdit)return false;
  const minimum=path.mfcPathClosed?3:2;
  if(path.mfcPathNodes.length<=minimum){MFC_UI.toast('This path needs at least '+minimum+' nodes.');return true;}
  const index=path.__mfcSelectedNode||0,reference=index===0?1:0;path.mfcPathNodes.splice(index,1);
  path.__mfcSelectedNode=Math.min(index,path.mfcPathNodes.length-1);rebuildEditablePath(path,reference>path.__mfcSelectedNode?0:reference);
  updatePathControls(path);canvas.requestRenderAll();pushHistory();refreshPathPanel();return true;
}

export function setSelectedNodeType(type) {
  const path=canvas.getActiveObject();if(!path||!path.__mfcNodeEdit)return;
  const nodes=path.mfcPathNodes,index=path.__mfcSelectedNode||0,node=nodes[index];node.type=type;
  if(type==='smooth'){
    const previous=nodes[index-1]||(path.mfcPathClosed?nodes.at(-1):null),next=nodes[index+1]||(path.mfcPathClosed?nodes[0]:null);
    const a=previous||point(node.x-60,node.y),b=next||point(node.x+60,node.y),dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
    const inLength=node.handleIn?distance(node,node.handleIn):(previous?distance(node,previous)/3:30);
    const outLength=node.handleOut?distance(node,node.handleOut):(next?distance(node,next)/3:30);
    node.handleIn=point(node.x-dx/length*inLength,node.y-dy/length*inLength);
    node.handleOut=point(node.x+dx/length*outLength,node.y+dy/length*outLength);
  }
  rebuildEditablePath(path,index===0?Math.min(1,nodes.length-1):0);updatePathControls(path);canvas.requestRenderAll();pushHistory();refreshPathPanel();
}

export function setSelectedIncomingSegment(curve) {
  const path=canvas.getActiveObject();if(!path||!path.__mfcNodeEdit)return;
  const nodes=path.mfcPathNodes,index=path.__mfcSelectedNode||0;
  if(index===0&&!path.mfcPathClosed){MFC_UI.toast('Select a node after the first one to edit its incoming segment.');return;}
  const previousIndex=index===0?nodes.length-1:index-1,previous=nodes[previousIndex],node=nodes[index];
  if(curve){const dx=(node.x-previous.x)/3,dy=(node.y-previous.y)/3;
    previous.handleOut=point(previous.x+dx,previous.y+dy);node.handleIn=point(node.x-dx,node.y-dy);
  }else{previous.handleOut=null;node.handleIn=null;}
  rebuildEditablePath(path,index===0?Math.min(1,nodes.length-1):0);updatePathControls(path);canvas.requestRenderAll();pushHistory();refreshPathPanel();
}

export const PATH_FIELD_PROPS={'path-stroke-color':'stroke','path-stroke-width':'strokeWidth','path-opacity':'opacity','path-dash':'strokeDashArray',
  'path-line-cap':'strokeLineCap','path-line-join':'strokeLineJoin','path-arrow-start':'mfcArrowStart','path-arrow-end':'mfcArrowEnd'};
export function applyPathStyle(field) {
  const paths=selectedObjects(o=>o.mfcShapeKind==='path');if(!paths.length)return;
  const style={...pathStyleFromPanel(),mfcArrowStart:document.getElementById('path-arrow-start').value,mfcArrowEnd:document.getElementById('path-arrow-end').value};
  const keys=PATH_FIELD_PROPS[field]?[PATH_FIELD_PROPS[field]]:Object.keys(style);
  paths.forEach(path=>{keys.forEach(key=>{if(key.startsWith('mfc'))path[key]=style[key];else path.set(key,style[key]);});path.dirty=true;});
  canvas.requestRenderAll();canvas.fire('object:modified',{target:canvas.getActiveObject()});
}

export function togglePathClosed() {
  const path=canvas.getActiveObject();if(!path||path.mfcShapeKind!=='path')return;
  if(!path.mfcPathClosed&&path.mfcPathNodes.length<3){MFC_UI.toast('A closed path needs at least three nodes.');return;}
  path.mfcPathClosed=!path.mfcPathClosed;rebuildEditablePath(path,0);updatePathControls(path);canvas.requestRenderAll();pushHistory();refreshPathPanel();
}

export function refreshPathPanel() {
  const panel=document.getElementById('panel-path');if(!panel)return;
  const active=canvas?selectedObjects(o=>o.mfcShapeKind==='path')[0]:null,isPath=!!active;
  panel.classList.toggle('hidden',!(isPath||currentTool==='path'));
  if(!isPath){document.getElementById('path-node-actions').classList.add('hidden');return;}
  // Node editing and closing work on one path at a time.
  const single=active===canvas.getActiveObject();
  document.getElementById('path-edit-nodes').disabled=!single;document.getElementById('path-close-toggle').disabled=!single;
  document.getElementById('path-stroke-color').value=toHexColor(active.stroke)||'#ffffff';
  document.getElementById('path-stroke-width').value=active.strokeWidth||3;document.getElementById('path-opacity').value=Math.round((active.opacity??1)*100);
  document.getElementById('path-line-cap').value=active.strokeLineCap||'round';document.getElementById('path-line-join').value=active.strokeLineJoin||'round';
  document.getElementById('path-arrow-start').value=active.mfcArrowStart||'none';document.getElementById('path-arrow-end').value=active.mfcArrowEnd||'none';
  let dashKey='solid';for(const [key,value] of Object.entries(DASH_PRESETS))if(value&&active.strokeDashArray&&value.length===active.strokeDashArray.length&&value.every((n,i)=>n===active.strokeDashArray[i]))dashKey=key;
  document.getElementById('path-dash').value=dashKey;document.getElementById('path-edit-nodes').textContent=active.__mfcNodeEdit?'Editing nodes':'Edit nodes';
  document.getElementById('path-close-toggle').textContent=active.mfcPathClosed?'Open path':'Close path';
  document.getElementById('path-node-actions').classList.toggle('hidden',!active.__mfcNodeEdit);
  if(active.__mfcNodeEdit){const node=active.mfcPathNodes[active.__mfcSelectedNode||0];setPathStatus(`Node ${(active.__mfcSelectedNode||0)+1} of ${active.mfcPathNodes.length}: ${node.type}.`,true);}
}

export function localCommandPoint(path,world) {
  const local=fabric.util.transformPoint(new fabric.Point(world.x,world.y),fabric.util.invertTransform(path.calcTransformMatrix()));
  return point(local.x+path.pathOffset.x,local.y+path.pathOffset.y);
}

export function segmentPoint(a,b,t) {
  if(!(a.handleOut||b.handleIn))return mixPoint(a,b,t);
  const p1=a.handleOut||a,p2=b.handleIn||b,u=1-t;
  return point(u*u*u*a.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t*t*t*b.x,
    u*u*u*a.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t*t*t*b.y);
}

export function insertPathNode(path,world) {
  const nodes=path.mfcPathNodes,p=localCommandPoint(path,world),count=path.mfcPathClosed?nodes.length:nodes.length-1;
  let best={distance:Infinity,index:0,t:.5};
  for(let i=0;i<count;i++){const a=nodes[i],b=nodes[(i+1)%nodes.length];
    for(let step=1;step<40;step++){const t=step/40,d=distance(p,segmentPoint(a,b,t));if(d<best.distance)best={distance:d,index:i,t};}
  }
  const a=nodes[best.index],b=nodes[(best.index+1)%nodes.length],t=best.t,newNode={type:'corner',handleIn:null,handleOut:null};
  if(a.handleOut||b.handleIn){const p0=point(a.x,a.y),p1=a.handleOut||p0,p2=b.handleIn||b,p3=point(b.x,b.y);
    const ab=mixPoint(p0,p1,t),bc=mixPoint(p1,p2,t),cd=mixPoint(p2,p3,t),abc=mixPoint(ab,bc,t),bcd=mixPoint(bc,cd,t),split=mixPoint(abc,bcd,t);
    a.handleOut=ab;b.handleIn=cd;Object.assign(newNode,{x:split.x,y:split.y,type:'smooth',handleIn:abc,handleOut:bcd});
  }else{const split=mixPoint(a,b,t);Object.assign(newNode,{x:split.x,y:split.y});}
  const insertIndex=best.index+1;nodes.splice(insertIndex,0,newNode);path.__mfcSelectedNode=insertIndex;
  rebuildEditablePath(path,best.index);updatePathControls(path);canvas.requestRenderAll();pushHistory();refreshPathPanel();setPathStatus('Inserted node '+(insertIndex+1)+'.',true);
}

export function handlePathKey(event) {
  if((event.key==='Enter')&&pathDraft){event.preventDefault();finishPathDrawing(false);return true;}
  if(event.key==='Escape'){
    if(pathDraft){event.preventDefault();cancelPathDrawing();return true;}
    const active=canvas.getActiveObject();if(active&&active.__mfcNodeEdit){event.preventDefault();exitPathEdit(active);return true;}
  }
  if((event.key==='Delete'||event.key==='Backspace')&&canvas.getActiveObject()?.__mfcNodeEdit){event.preventDefault();return deleteSelectedPathNode();}
  return false;
}

// ---- tool interface (used by tools/tool-switch.js) ----
/** Choosing the Path tool changes nothing by itself (tools/tool-switch.js sets the crosshair cursor). */
function activatePathTool() {}
export { activatePathTool as activate, stopPathDrawing as deactivate, refreshPathPanel as refreshPanel };

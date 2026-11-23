/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Arrowheads of Pen paths: the head triangle at each tip, and the line's commands pulled back inside it.
   Pure geometry on a path object (its commands, nodes, line width and scale); path.js re-exports both. */

import { distance, mixPoint, point } from './path.js';

/** How the path is scaled on the page, for sizes that must not follow it. A path with strokeUniform
    keeps its line width in page pixels when it is resized, so its arrowheads must too (otherwise a
    smaller path gets an arrowhead thinner than its line, which then pokes out of the tip). Paths
    whose stroke scales with them keep arrowheads in their own units, as before. */
function arrowScale(path) {
  if (!path.strokeUniform) return { x: 1, y: 1 };
  const s = path.group ? path.getObjectScaling() : { scaleX: path.scaleX, scaleY: path.scaleY };
  return { x: Math.abs(s.scaleX) || 1, y: Math.abs(s.scaleY) || 1 };
}

/** Arrowhead length: 4 × the line width, at least 10 (page px for strokeUniform paths). */
const arrowSize=path=>Math.max(10,(path.strokeWidth||1)*4);

/** The tip node and the direction towards it, in page-scaled units: { tip, vx, vy, sx, sy }. The head is
    aimed along the line as drawn under it: from the point of the path one head length (straight distance)
    before the tip, which becomes the middle of the head's base, to the tip. On a curve this follows the
    bend under the head instead of the tangent at the very tip, which made heads on small or tightly bent
    arrows point away from their line. A path shorter than its head aims from its other end. */
function arrowFrame(path,atStart) {
  const nodes=path.mfcPathNodes||[];if(nodes.length<2)return null;
  const tip=atStart?nodes[0]:nodes[nodes.length-1];
  const {x:sx,y:sy}=arrowScale(path);
  const walk=walkFromTip(path,atStart,arrowSize(path));
  if(walk){const vx=walk.tip.x-walk.point.x,vy=walk.tip.y-walk.point.y,length=Math.hypot(vx,vy);
    if(length>=.001)return {tip,vx:vx/length,vy:vy/length,sx,sy};}
  // Unreadable commands, or a path that comes back onto its tip: the tangent at the tip.
  let reference;
  if(atStart){const next=nodes[1];reference=tip.handleOut||next.handleIn||next;}
  else{const previous=nodes[nodes.length-2];reference=tip.handleIn||previous.handleOut||previous;}
  const vx=(tip.x-reference.x)*sx,vy=(tip.y-reference.y)*sy;
  const length=Math.hypot(vx,vy);if(length<.001)return null;
  return {tip,vx:vx/length,vy:vy/length,sx,sy};
}

/** Walks along the drawn path from an arrow tip, in page-scaled units, until a point lies `dist` away from
    the tip in a straight line: { tip, point, arc } (arc = path length walked). When the whole path is
    closer, point is its other end. null when the commands cannot be read. */
function walkFromTip(path,atStart,dist) {
  const segs=Array.isArray(path.path)&&!path.mfcPathClosed?commandSegments(path.path):null;if(!segs||!segs.length)return null;
  const {x:sx,y:sy}=arrowScale(path),scaled=q=>point(q.x*sx,q.y*sy);
  const list=atStart?segs:segs.slice().reverse().map(reverseSegment); // each list[i].p0 is nearer the tip
  const tip=scaled(list[0].p0);let prev=tip,prevDistance=0,arc=0;
  for(const seg of list){const steps=seg.curve?64:1;
    for(let i=1;i<=steps;i++){
      const q=scaled(segmentAt(seg,i/steps)),d=distance(q,tip),step=distance(q,prev);
      if(d>=dist){const f=d>prevDistance?(dist-prevDistance)/(d-prevDistance):1;return {tip,point:mixPoint(prev,q,f),arc:arc+step*f};}
      arc+=step;prev=q;prevDistance=d;
    }}
  return {tip,point:prev,arc};
}

/** Arrowhead triangle [tip, corner, corner] in the path's own coordinates. Its length is
    max(10, 4 × line width) and its half-width 0.45 × that, measured on the page for paths whose line
    width does not scale (and in the path's units otherwise). */
export function pathArrowGeometry(path,atStart) {
  const f=arrowFrame(path,atStart);if(!f)return null;
  const {tip,vx,vy,sx,sy}=f;
  const size=arrowSize(path),half=size*.45;
  const local=(a,b)=>point(tip.x+a/sx,tip.y+b/sy);
  return [tip,local(-vx*size-vy*half,-vy*size+vx*half),local(-vx*size+vy*half,-vy*size-vx*half)];
}

/* Path commands as segments {p0, c1, c2, p3, curve, cmd}; lines keep c1 = p0 and c2 = p3. Quadratic
   commands are raised to cubics for measuring; cmd keeps the original command, written back unchanged for
   segments that are not cut. null for a command these helpers do not know. */
function commandSegments(commands) {
  const segs=[];let at=null;
  for(const c of commands){
    const type=String(c[0]).toUpperCase(),v=c.slice(1);
    if(type==='M'){at=point(v[0],v[1]);continue;}
    if(!at)return null;
    if(type==='L'){const p3=point(v[0],v[1]);segs.push({p0:at,c1:at,c2:p3,p3,curve:false,cmd:c});at=p3;}
    else if(type==='C'){const p3=point(v[4],v[5]);segs.push({p0:at,c1:point(v[0],v[1]),c2:point(v[2],v[3]),p3,curve:true,cmd:c});at=p3;}
    else if(type==='Q'){const q=point(v[0],v[1]),p3=point(v[2],v[3]);
      segs.push({p0:at,c1:mixPoint(at,q,2/3),c2:mixPoint(p3,q,2/3),p3,curve:true,cmd:c});at=p3;}
    else return null;
  }
  return segs;
}
function segmentAt(s,t) {
  if(!s.curve)return mixPoint(s.p0,s.p3,t);
  const ab=mixPoint(s.p0,s.c1,t),bc=mixPoint(s.c1,s.c2,t),cd=mixPoint(s.c2,s.p3,t);
  return mixPoint(mixPoint(ab,bc,t),mixPoint(bc,cd,t),t);
}
/** Cumulative lengths of a segment on the page (path units × sx, sy), sampled at 48 steps. */
function segmentLengths(s,sx,sy) {
  const steps=s.curve?48:1,out=[0];let prev=s.p0;
  for(let i=1;i<=steps;i++){const q=segmentAt(s,i/steps);out.push(out[i-1]+Math.hypot((q.x-prev.x)*sx,(q.y-prev.y)*sy));prev=q;}
  return out;
}
/** The part of a segment from its start to parameter t. */
function segmentHead(s,t) {
  if(!s.curve){const p3=mixPoint(s.p0,s.p3,t);return {p0:s.p0,c1:s.p0,c2:p3,p3,curve:false};}
  const ab=mixPoint(s.p0,s.c1,t),bc=mixPoint(s.c1,s.c2,t),cd=mixPoint(s.c2,s.p3,t),abc=mixPoint(ab,bc,t);
  return {p0:s.p0,c1:ab,c2:abc,p3:mixPoint(abc,mixPoint(bc,cd,t),t),curve:true};
}
const reverseSegment=s=>({p0:s.p3,c1:s.c2,c2:s.c1,p3:s.p0,curve:s.curve,cmd:s.cmd});
/** Removes the last `back` page pixels of the segment list, measured along the path. */
function trimSegmentsEnd(segs,back,sx,sy) {
  let remaining=back;
  while(segs.length&&remaining>1e-9){
    const s=segs[segs.length-1],lengths=segmentLengths(s,sx,sy),length=lengths.at(-1);
    if(length<=remaining&&segs.length>1){segs.pop();remaining-=length;continue;}
    const keep=Math.max(0,length-remaining);let i=1;while(i<lengths.length-1&&lengths[i]<keep)i++;
    const span=lengths[i]-lengths[i-1],t=((i-1)+(span>0?(keep-lengths[i-1])/span:0))/(lengths.length-1);
    segs[segs.length-1]=segmentHead(s,Math.max(0,Math.min(1,t)));break;
  }
}

/** The path's commands with each arrow end pulled back inside its arrowhead, so the line stops near the
    head's base instead of running to the tip (where the head is narrower than the line, and a round or
    square cap would stick out). The line is cut where it comes within 3/4 of the head length of the tip
    (straight distance, so on a bend the cut stays under the head), at most half the path's length from
    each end: short end segments (a node right next to the tip) are dropped or split.
    null when the path has no arrowhead. */
export function pathStrokeCommands(path) {
  const ends=[['mfcArrowStart',true],['mfcArrowEnd',false]].filter(([key])=>path[key]==='arrow');
  if(!ends.length||path.mfcPathClosed||!Array.isArray(path.path)||path.path.length<2)return null;
  let segs=commandSegments(path.path);if(!segs||!segs.length)return null;
  const {x:sx,y:sy}=arrowScale(path),size=arrowSize(path);
  const total=segs.reduce((sum,s)=>sum+segmentLengths(s,sx,sy).at(-1),0);
  for(const [,atStart] of ends){
    if(!arrowFrame(path,atStart))continue; // no direction, so no arrowhead is drawn there
    const walk=walkFromTip(path,atStart,size*.75),back=Math.min(walk?walk.arc:size*.75,total/2);
    if(atStart){segs=segs.reverse().map(reverseSegment);trimSegmentsEnd(segs,back,sx,sy);segs=segs.reverse().map(reverseSegment);}
    else trimSegmentsEnd(segs,back,sx,sy);
  }
  const commands=[['M',segs[0].p0.x,segs[0].p0.y]];
  for(const s of segs)commands.push(s.cmd?s.cmd.slice():s.curve?['C',s.c1.x,s.c1.y,s.c2.x,s.c2.y,s.p3.x,s.p3.y]:['L',s.p3.x,s.p3.y]);
  return commands;
}


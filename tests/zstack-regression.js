/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* Z stacks and time series: ImageJ hyperstacks are split into channels x slices x frames,
   shown as a projection or one slice, and the choice survives undo, save and reopen. */
async function runZStackRegressions() {
  const checks=[];
  const assert=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};
  const canvas=MFC.getCanvas();

  // Minimal uncompressed 16-bit little-endian TIFF, one IFD per page, optional ImageJ header.
  const makeTiff=(name,pages,w,h,description)=>{
    const tagCount=description?10:9, ifdSize=2+tagCount*12+4, planeBytes=w*h*2;
    const desc=description?new TextEncoder().encode(description+'\0'):null;
    let size=8+(desc?desc.length:0);
    const layout=pages.map(()=>{const ifd=size;size+=ifdSize;const data=size;size+=planeBytes;return{ifd,data};});
    const buf=new ArrayBuffer(size),dv=new DataView(buf),u8=new Uint8Array(buf);
    u8.set([0x49,0x49]);dv.setUint16(2,42,true);dv.setUint32(4,layout[0].ifd,true);
    if(desc)u8.set(desc,8);
    pages.forEach((page,i)=>{
      const {ifd,data}=layout[i];let p=ifd;dv.setUint16(p,tagCount,true);p+=2;
      const tag=(id,type,count,value)=>{dv.setUint16(p,id,true);dv.setUint16(p+2,type,true);dv.setUint32(p+4,count,true);
        if(type===3&&count===1)dv.setUint16(p+8,value,true);else dv.setUint32(p+8,value,true);p+=12;};
      tag(256,4,1,w);tag(257,4,1,h);tag(258,3,1,16);tag(259,3,1,1);tag(262,3,1,1);
      if(desc)tag(270,2,desc.length,8);
      tag(273,4,1,data);tag(277,3,1,1);tag(278,4,1,h);tag(279,4,1,planeBytes);
      dv.setUint32(p,i+1<pages.length?layout[i+1].ifd:0,true);
      for(let k=0;k<w*h;k++)dv.setUint16(data+k*2,page[k],true);
    });
    return new File([buf],name,{type:'image/tiff'});
  };
  // Page value encodes channel/slice/frame: 1000*c + 100*z + 10*t (+ pixel index for variety).
  const W=4,H=4,C=2,Z=3,T=2;
  const value=(c,z,t,k)=>1000*c+100*z+10*t+k;
  const pages=[];
  for(let t=0;t<T;t++)for(let z=0;z<Z;z++)for(let c=0;c<C;c++)pages.push(Array.from({length:W*H},(_,k)=>value(c,z,t,k)));
  const header=`ImageJ=1.54p\nimages=${C*Z*T}\nchannels=${C}\nslices=${Z}\nframes=${T}\nhyperstack=true\nmode=composite\nspacing=0.5\nunit=micron\nmin=0.0\nmax=3000.0\n`;
  const hyper=makeTiff('hyper.tif',pages,W,H,header);

  // ---- decoding ----
  const raw=await MFC_TIFF.decodeFile(hyper);
  assert('A hyperstack has one entry per channel, not per page',raw.channels.length===C);
  assert('Stack dimensions come from the ImageJ header',raw.stack&&raw.stack.sizeC===C&&raw.stack.sizeZ===Z&&raw.stack.sizeT===T);
  assert('The Z step is read from spacing=',raw.stack.zStepUm===0.5);
  assert('A Z stack opens as a maximum intensity projection',raw.zMode==='max'&&raw.tIndex===0);
  assert('Max projection takes the brightest slice of each channel',raw.channels[1].data[5]===value(1,Z-1,0,5)&&raw.channels[0].data[0]===value(0,Z-1,0,0));
  raw.zMode='mean';await MFC_TIFF.selectPlane(raw);
  assert('Mean projection averages the slices',raw.channels[1].data[5]===value(1,1,0,5));
  raw.zMode='slice';raw.zIndex=0;raw.tIndex=1;await MFC_TIFF.selectPlane(raw);
  assert('A single slice and frame are picked in XYCZT order',raw.channels[0].data[3]===value(0,0,1,3)&&raw.channels[1].data[3]===value(1,0,1,3));
  raw.zIndex=99;raw.tIndex=-4;await MFC_TIFF.selectPlane(raw);
  assert('Out of range slice and frame are clamped',raw.zIndex===Z-1&&raw.tIndex===0);

  const zOnly=await MFC_TIFF.decodeFile(makeTiff('z.tif',pages.slice(0,3),W,H,'ImageJ=1.54p\nimages=3\nslices=3\nunit=micron\n'));
  assert('A one-channel Z stack is one channel with three slices',zOnly.channels.length===1&&zOnly.stack.sizeZ===3);
  const bad=await MFC_TIFF.decodeFile(makeTiff('bad.tif',pages.slice(0,5),W,H,'ImageJ=1.54p\nimages=6\nchannels=2\nslices=3\n'));
  assert('A header that does not match the page count falls back to one channel per page',bad.channels.length===5&&!bad.stack);
  const plain=await MFC_TIFF.decodeFile(makeTiff('plain.tif',pages.slice(0,3),W,H,null));
  assert('A plain multipage TIFF still has one channel per page',plain.channels.length===3&&!plain.stack);

  // ---- editor ----
  await MFC_PROJECT.createProject({name:'zstack',width:600,height:400,unit:'px',dpi:300});
  await MFC.importFiles([hyper]);
  let img=canvas.getActiveObject();
  const entry=()=>MFC.getRegistry()[img.mfcId].rawImage;
  assert('The imported stack shows its channels',entry().channels.length===C&&document.querySelectorAll('#channel-list .channel-row').length===C);
  assert('Z / time controls are shown for a stack',!document.getElementById('channel-stack').classList.contains('hidden'));
  assert('The stack summary lists channels, slices and frames',/2 channels × 3 Z slices × 2 time frames/.test(document.getElementById('ch-stack-info').textContent));
  assert('The slice slider is hidden while a projection is shown',document.getElementById('ch-zslice-row').classList.contains('hidden'));
  assert('The frame slider is shown for a time series',!document.getElementById('ch-tframe-row').classList.contains('hidden'));

  const zmode=document.getElementById('ch-zmode');
  // Planes are chosen asynchronously (projections are computed off the main thread).
  zmode.value='slice';zmode.dispatchEvent(new Event('change',{bubbles:true}));await MFC_TIFF.whenIdle();
  assert('Choosing Single slice shows the slice slider',!document.getElementById('ch-zslice-row').classList.contains('hidden'));
  assert('The default slice is the middle one',entry().zIndex===1&&entry().channels[0].data[2]===value(0,1,0,2));
  const slider=document.getElementById('ch-zslice');
  slider.value='3';slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));await MFC_TIFF.whenIdle();
  assert('Moving the slice slider shows that slice',entry().zIndex===2&&entry().channels[1].data[0]===value(1,2,0,0));
  assert('A slice change is labelled in the history',MFC.getHistory().labels.slice(-1)[0]==='Changed Z plane of hyper.tif');
  const frame=document.getElementById('ch-tframe-val');
  frame.value='2';frame.dispatchEvent(new Event('change',{bubbles:true}));await MFC_TIFF.whenIdle();
  assert('Typing a frame number shows that frame',entry().tIndex===1&&entry().channels[0].data[0]===value(0,2,1,0));
  assert('A frame change is labelled in the history',MFC.getHistory().labels.slice(-1)[0]==='Changed time frame of hyper.tif');

  await MFC.undo();
  img=canvas.getObjects().find(o=>o.mfcType==='mfcImage');
  assert('Undo restores the previous frame',entry().tIndex===0&&entry().zIndex===2&&entry().channels[0].data[0]===value(0,2,0,0));
  await MFC.redo();
  img=canvas.getObjects().find(o=>o.mfcType==='mfcImage');
  assert('Redo restores the chosen frame',entry().tIndex===1&&entry().channels[0].data[0]===value(0,2,1,0));

  // Saved state -> reopened object keeps the Z display, slice and frame.
  const state=MFC_PROJECT.captureState();
  const saved=state.objects.find(o=>o.mfcType==='mfcImage');
  assert('The project stores the Z display, slice and frame',saved.display.zMode==='slice'&&saved.display.zIndex===2&&saved.display.tIndex===1);
  await MFC_PROJECT.restoreState(state,{resetHistory:false});
  img=canvas.getObjects().find(o=>o.mfcType==='mfcImage');
  assert('A reopened project shows the saved slice and frame',entry().channels[1].data[7]===value(1,2,1,7));

  // Two stacks selected: the Z display applies to both.
  canvas.setActiveObject(img);
  await MFC.applyStackPlane({zMode:'max'},true);
  assert('Switching back to a projection uses the brightest slice of that frame',entry().zMode==='max'&&entry().channels[0].data[0]===value(0,Z-1,1,0));
  return checks;
}

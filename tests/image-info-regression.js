/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* P1-T4: importing prints nothing in normal mode (the TIFF reader logs only through MFC_DEBUG,
   on with ?debug=1 or localStorage.fluoforgeDebug), and the Image info dialog shows what those
   logs used to print: dimensions, bit depth, channels, Z and T, pixel size and its source, raw header. */
async function runImageInfoRegressions() {
  const checks=[];
  const assert=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};
  window.focus(); // keyboard checks need the frame to hold focus (Firefox)
  const canvas=MFC.getCanvas();

  // Uncompressed 16-bit TIFF; optional ImageJ header and XResolution (+ ResolutionUnit) tags.
  const makeTiff=(name,pages,w,h,{description=null,xres=null,resUnit=null}={})=>{
    const desc=description?new TextEncoder().encode(description+'\0'):null;
    const tagCount=9+(desc?1:0)+(xres?1:0)+(resUnit?1:0), ifdSize=2+tagCount*12+4, planeBytes=w*h*2;
    let size=8+(desc?desc.length:0);
    const rational=xres?size:0; if(xres)size+=8;
    const layout=pages.map(()=>{const ifd=size;size+=ifdSize;const data=size;size+=planeBytes;return{ifd,data};});
    const buf=new ArrayBuffer(size),dv=new DataView(buf),u8=new Uint8Array(buf);
    u8.set([0x49,0x49]);dv.setUint16(2,42,true);dv.setUint32(4,layout[0].ifd,true);
    if(desc)u8.set(desc,8);
    if(xres){dv.setUint32(rational,xres[0],true);dv.setUint32(rational+4,xres[1],true);}
    pages.forEach((page,i)=>{
      const {ifd,data}=layout[i];let p=ifd;dv.setUint16(p,tagCount,true);p+=2;
      const tag=(id,type,count,value)=>{dv.setUint16(p,id,true);dv.setUint16(p+2,type,true);dv.setUint32(p+4,count,true);
        if(type===3&&count===1)dv.setUint16(p+8,value,true);else dv.setUint32(p+8,value,true);p+=12;};
      tag(256,4,1,w);tag(257,4,1,h);tag(258,3,1,16);tag(259,3,1,1);tag(262,3,1,1);
      if(desc)tag(270,2,desc.length,8);
      tag(273,4,1,data);tag(277,3,1,1);tag(278,4,1,h);tag(279,4,1,planeBytes);
      if(xres)tag(282,5,1,rational);
      if(resUnit)tag(296,3,1,resUnit);
      dv.setUint32(p,i+1<pages.length?layout[i+1].ifd:0,true);
      for(let k=0;k<w*h;k++)dv.setUint16(data+k*2,page[k],true);
    });
    return new File([buf],name,{type:'image/tiff'});
  };
  const plane=(w,h,base)=>Array.from({length:w*h},(_,k)=>base+k*7);
  // ImageJ hyperstack: 2 channels x 3 slices x 2 frames; 2 px per micron (XResolution 2/1, unit=micron).
  const header='ImageJ=1.54p\nimages=12\nchannels=2\nslices=3\nframes=2\nhyperstack=true\nmode=composite\nspacing=0.75\nunit=micron\nmin=0.0\nmax=4000.0\n';
  const hyper=makeTiff('cells-hyperstack.tif',Array.from({length:12},(_,i)=>plane(8,6,100*i)),8,6,{description:header,xres:[2,1]});
  // Plain multipage TIFF: 10000 px per cm = 1 µm/px, no ImageJ header.
  const plain=makeTiff('plain-two-pages.tif',[plane(10,4,0),plane(10,4,500)],10,4,{xres:[10000,1],resUnit:3});
  // Header that does not match the page count: 5 slices announced, 2 pages present.
  const mismatched=makeTiff('mismatch.tif',[plane(4,4,0),plane(4,4,50)],4,4,{description:'ImageJ=1.54p\nimages=5\nslices=5\nunit=micron\n'});
  // PNG whose name looks like markup: it must be shown as text.
  const pngCanvas=document.createElement('canvas');pngCanvas.width=6;pngCanvas.height=5;
  pngCanvas.getContext('2d').fillRect(0,0,3,3);
  const trickyName='<img src=x onerror="window.__mfcInjected=1"><b>bold</b>.png';
  const png=new File([await new Promise(r=>pngCanvas.toBlob(r,'image/png'))],trickyName,{type:'image/png'});

  // ---- the logger ----
  assert('MFC_DEBUG is off in normal use',typeof MFC_DEBUG==='object'&&MFC_DEBUG.enabled===false);
  const spy=()=>{
    const calls=[],saved={};
    for(const k of ['log','warn','info','debug','error']){saved[k]=console[k];console[k]=(...a)=>calls.push(k+': '+a.map(String).join(' ').slice(0,120));}
    return {calls,restore:()=>Object.assign(console,saved)};
  };

  // ---- importing prints nothing in normal mode ----
  await MFC_PROJECT.createProject({name:'image info',width:900,height:600,unit:'px',dpi:300});
  const quiet=spy();
  try{await MFC.importFiles([hyper,plain,mismatched,png]);}finally{quiet.restore();}
  assert('Importing a hyperstack, a plain TIFF, a mismatched TIFF and a PNG prints nothing to the console'+
    (quiet.calls.length?' (printed: '+quiet.calls.slice(0,3).join(' | ')+')':''),quiet.calls.length===0);
  const images=canvas.getObjects().filter(o=>o.mfcType==='mfcImage');
  assert('All four images were imported',images.length===4);

  // ---- with debug on, the same reader logs again ----
  let loud;
  try{
    localStorage.setItem('fluoforgeDebug','1');
    assert('localStorage.fluoforgeDebug turns the logger on',MFC_DEBUG.enabled===true);
    loud=spy();
    try{await MFC_TIFF.decodeFile(hyper);}finally{loud.restore();}
  }finally{localStorage.removeItem('fluoforgeDebug');}
  assert('With debug on, decoding prints the TIFF metadata ('+loud.calls.length+' lines)',
    loud.calls.length>10&&loud.calls.some(line=>/FULL TIFF IMAGE DESCRIPTION/.test(line)));
  assert('Removing localStorage.fluoforgeDebug turns it off again',MFC_DEBUG.enabled===false);

  // ---- the Image info dialog ----
  const button=document.getElementById('btn-image-info');
  const calibration=document.getElementById('channel-calibration');
  canvas.discardActiveObject();canvas.fire('selection:cleared');
  assert('The Image info button is hidden while no image is selected',calibration.classList.contains('hidden'));
  assert('The Image info button has a title and announces a dialog',!!button.title&&button.getAttribute('aria-haspopup')==='dialog');

  const open=image=>{
    canvas.setActiveObject(image);canvas.fire('selection:created',{selected:[image]});
    assert('The Image info button is shown for a selected image ('+image.mfcFileName.slice(0,20)+')',!calibration.classList.contains('hidden'));
    button.focus();button.click();
    const dialog=document.querySelector('.image-info-backdrop [role="dialog"]');
    const rows={};
    dialog.querySelectorAll('dt').forEach(dt=>{rows[dt.textContent]=dt.nextElementSibling.textContent;});
    return {dialog,rows,channels:[...dialog.querySelectorAll('tbody tr')].map(tr=>[...tr.cells].map(c=>c.textContent)),
      header:dialog.querySelector('#image-info-header').textContent};
  };
  const close=()=>{document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));};

  const byName=name=>images.find(o=>o.mfcFileName===name);
  let info=open(byName('cells-hyperstack.tif'));
  assert('The dialog is a labelled modal dialog with focus on Close',info.dialog.getAttribute('aria-modal')==='true'&&
    document.getElementById(info.dialog.getAttribute('aria-labelledby')).textContent==='Image info'&&document.activeElement.id==='image-info-close');
  assert('Hyperstack: file, format and dimensions',info.rows.File==='cells-hyperstack.tif'&&info.rows.Format==='TIFF'&&info.rows.Dimensions==='8 × 6 px');
  assert('Hyperstack: bit depth and channel count',info.rows['Bit depth']==='16-bit'&&info.rows.Channels==='2');
  assert('Hyperstack: Z slices, time frames, Z step and page count',info.rows['Z slices']==='3'&&info.rows['Time frames']==='2'&&
    info.rows['Z step']==='0.75 µm'&&info.rows['Pages in the file']==='12');
  assert('Hyperstack: pixel size and its source (XResolution with the ImageJ unit)',info.rows['Pixel size']==='0.5 µm/px'&&
    /XResolution tag, with unit=micron from the ImageJ header/.test(info.rows['Pixel size source']));
  assert('Hyperstack: one row per channel, with the display range taken from the header',info.channels.length===2&&
    info.channels.every(row=>row[2]==='0 – 4000'&&row[3]==='min= and max= of the ImageJ header'));
  assert('Hyperstack: the raw ImageJ header is shown as stored',info.header.replace(/\0/g,'').trim()===header.trim());
  // keyboard: Tab stays inside, Escape closes and gives focus back
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert('Tab from Close wraps to the scrollable header inside the dialog',document.activeElement.id==='image-info-header');
  close();
  assert('Escape closes the dialog and returns focus to the Image info button',!document.querySelector('.image-info-backdrop')&&document.activeElement===button);

  // a pixel size typed by hand is reported as such
  MFC.applyPixelSize('0.25');
  info=open(byName('cells-hyperstack.tif'));
  assert('A pixel size typed in the Channels panel is reported as entered by hand, with the file value',
    info.rows['Pixel size']==='0.25 µm/px'&&info.rows['Pixel size source']==='Entered in the Channels panel (the file says 0.5 µm/px)');
  info.dialog.querySelector('#image-info-close').click();
  assert('Close closes the dialog',!document.querySelector('.image-info-backdrop'));

  info=open(byName('plain-two-pages.tif'));
  assert('Plain TIFF: every page is a channel, no Z or T',info.rows.Channels==='2'&&info.rows['Z slices']==='1'&&info.rows['Time frames']==='1');
  // Today the reader ignores a TIFF's own ResolutionUnit (UTIF gives it as an array, compared with ===):
  // only the ImageJ unit=micron fallback yields a pixel size. Image info reports exactly that.
  assert('Plain TIFF without an ImageJ unit: no pixel size, and the dialog says the XResolution unit was not used',
    info.rows['Pixel size']==='Not set'&&info.rows['Pixel size source']==='XResolution tag without a usable unit');
  assert('Plain TIFF: auto-contrast range source and no header',info.channels.every(row=>row[3]==='Auto-contrast (no range in the file)')&&
    /has no ImageJ header/.test(info.header));
  close();

  info=open(byName('mismatch.tif'));
  assert('A header that does not match the pages is explained in the dialog',/describes 5 planes but the file has 2 pages/.test(info.rows.Note||''));
  close();

  info=open(byName(trickyName));
  assert('PNG: raster format, 8-bit, three channels, no pixel size in the file',/^Raster image/.test(info.rows.Format)&&info.rows['Bit depth']==='8-bit'&&
    info.rows.Channels==='3'&&info.rows['Pixel size']==='Not set'&&/^Not in the file/.test(info.rows['Pixel size source']));
  assert('A file name that looks like HTML is shown as text, never parsed',info.rows.File===trickyName&&
    !info.dialog.querySelector('img,b')&&!window.__mfcInjected);
  close();

  const opened=spy();
  try{info=open(byName('cells-hyperstack.tif'));close();}finally{opened.restore();}
  assert('Opening Image info prints nothing to the console',opened.calls.length===0);
  return {checks};
}

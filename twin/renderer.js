/* Mounted atlas renderer. Firmware port is deliberately deferred to the next work order. */
'use strict';
const PANEL=240, RETICLE_ARM=7, ZONE_BOUNDS=[0.25,0.65], ZONE_HYST=0.01;
const DEPTH_STEP=0.02, HEADING_STEP=5, MAX_METRES=3040;
const clamp01=x=>Math.max(0,Math.min(1,x));
const scale=(v,s)=>v.map(x=>x*s);
let config, geometry, FACES, SUBJECTS, faceConfig, sceneConfig;
const RING=180;
const state={depth:0,frame:false,yaw:0,zone:'surface',collected:[],scannedSubjects:[],started:false,muted:false,
  seconds:0,paused:false,unfold:false,edgeDebug:false,labels:true,grid:true,
  // Dive-assist visuals. highlight is the permanent toggle; highlightUntil is the ten seconds
  // a scan grants. sweepStart and collectFlash are animation start stamps in performance.now().
  highlight:false,highlightUntil:0,sweepStart:-1e9,collectFlash:-1e9,collectFace:-1,collectXY:[120,120]};
const SCAN_SWEEP_MS=1400, HIGHLIGHT_MS=10000, COLLECT_FLASH_MS=700;
const panels=[], labels=[];
let edgePairs=[];
let scene,camera,renderer,cubeGroup,mountedGroup,aimMarker;
let dragging=false,lastX=0,lastY=0;
let orbit={theta:-1.3,phi:1.32,dist:4.4};
let previousTime=0,lastFrame=0,lastRenderKey='';

function updateZone(depth) {
  const [a,b]=ZONE_BOUNDS,h=ZONE_HYST,previous=state.zone;
  let z=state.zone;
  for(let i=0;i<3;i++) {
    const before=z;
    if(z==='surface'&&depth>a+h) z='mid';
    else if(z==='mid'&&depth<a-h) z='surface';
    else if(z==='mid'&&depth>b+h) z='deep';
    else if(z==='deep'&&depth<b-h) z='mid';
    if(z===before) break;
  }
  if(z!==previous) {state.zone=z;playAmbient(z,previous);}
}

function reticleHit(yaw) {
  const p=geometry.aim(yaw,state.depth);
  return {...p,u:p.local[0],v:p.local[1],onPanel:p.visible};
}

// Scan reads the same winning subject index that supplied the last displayed pixel.
// This includes time interpolation and pixel-center quantization, before the reticle overlay.
// What counts as the reticle being on a creature. The sprite masks are 8x8 blocks with gaps, so
// a reticle resting on a fish can land in a hole inside it and read open water. Search outwards
// from the reticle pixel to the edge of the drawn reticle box and take the nearest creature.
function subjectNear(face,u,v,radius) {
  const centre=subjectAt(face,u,v);
  if(centre>=0) return centre;
  const r=FACES[face].rect;
  const x0=Math.min(PANEL-1,Math.floor((u-r.left)/(r.right-r.left)*PANEL));
  const y0=Math.min(PANEL-1,Math.floor((v-r.top)/(r.bottom-r.top)*PANEL));
  for(let ring=1;ring<=radius;ring++) {
    for(let dy=-ring;dy<=ring;dy++) for(let dx=-ring;dx<=ring;dx++) {
      if(Math.max(Math.abs(dx),Math.abs(dy))!==ring) continue;
      const x=x0+dx,y=y0+dy;
      if(x<0||y<0||x>=PANEL||y>=PANEL) continue;
      const s=panels[face].subjects[y*PANEL+x];
      if(s>=0) return s;
    }
  }
  return -1;
}

function subjectAt(face,u,v) {
  const r=FACES[face].rect;
  const x=Math.min(PANEL-1,Math.floor((u-r.left)/(r.right-r.left)*PANEL));
  const y=Math.min(PANEL-1,Math.floor((v-r.top)/(r.bottom-r.top)*PANEL));
  return x<0||y<0||x>=PANEL||y>=PANEL?-1:panels[face].subjects[y*PANEL+x];
}

function backgroundColor(stripX,stripY) {
  // Base light follows measured depth; atlas motion only moves the surface band and texture.
  return TwinOcean.backgroundColor(stripX,stripY,state.depth,state.grid,config.depth_darkening,geometry.stripLengthMm);
}

// Sea colour, fast path. The cube is a body hanging in the water: every pixel has its own depth, so as the
// cube sinks the LOWER pixels reach darker water first and the darkness climbs from the bottom up; the surface
// (bright band) is above the top pixels at 0 m and rises out of view within the first ~170 m.
const SEA_K=0.005, SEA_TOP_MM=45, SEA_TEX_DRIFT_MM=70;
let SEA_LUT=null;
function buildSeaLut() {
  const look=config.depth_darkening;SEA_LUT=new Float32Array(1024*3);
  for(let i=0;i<1024;i++) {const c=TwinOcean.colorAtDepth(i/1023,look);SEA_LUT[i*3]=c[0];SEA_LUT[i*3+1]=c[1];SEA_LUT[i*3+2]=c[2];}
}
function makeSeaPre(stripX,stripY,n) {
  const L=geometry.stripLengthMm,gs=L/18,look=config.depth_darkening;
  const uPhase=new Float32Array(n),vert=new Float32Array(n),lon=new Float32Array(n),mer=new Float32Array(n);
  for(let i=0;i<n;i++) {
    const u=((stripX[i]/L)%1+1)%1,gx=Math.abs(stripX[i]/gs-Math.round(stripX[i]/gs));
    uPhase[i]=u*Math.PI*10;vert[i]=1+(stripY[i]/L)*look.vertical_gradient_gain;
    lon[i]=clamp01((0.022-gx)/0.022);
    const m=Math.min(u,1-u);mer[i]=m<0.008?(1-m/0.008)*look.meridian_gain:0;
  }
  return {uPhase,vert,lon,mer};
}
function paintSea(out,stripX,stripY,pre,n,skip,w,stride) {
  if(!SEA_LUT) buildSeaLut();
  const look=config.depth_darkening,d=clamp01(state.depth),gs=geometry.stripLengthMm/18;
  const amp=look.texture_amplitude_rgb,band=look.surface_band.rgb,lens=look.snell_window.rgb,gridGain=look.grid_gain;
  const texShift=d*SEA_TEX_DRIFT_MM,lensFade=clamp01(1-d/look.snell_window.depth_fade_norm),lensStrength=look.snell_window.strength;
  const bandFade=clamp01(1-d/look.surface_band.fade_depth_norm),grid=state.grid;
  for(let yy=0;yy<w;yy+=stride) for(let xx=0;xx<w;xx+=stride) {
    const i=yy*w+xx;
    if(skip&&skip[i]) continue;
    const sy=stripY[i],raw=d+(SEA_TOP_MM-sy)*SEA_K,dp=raw<0?0:raw>1?1:raw,li=((dp*1023)|0)*3,yt=sy-texShift;
    const variation=Math.sin(pre.uPhase[i]+Math.sin(yt/9)),vl=pre.vert[i];
    let r=(SEA_LUT[li]+variation*amp[0])*vl,g=(SEA_LUT[li+1]+variation*amp[1])*vl,b=(SEA_LUT[li+2]+variation*amp[2])*vl;
    if(raw<0) {const k=clamp01(-raw/0.012)*bandFade;r+=(band[0]-r)*k;g+=(band[1]-g)*k;b+=(band[2]-b)*k;}
    if(lensFade>0) {const w=lensFade*clamp01((sy-10)/30)*lensStrength;r+=(lens[0]-r)*w;g+=(lens[1]-g)*w;b+=(lens[2]-b)*w;}
    if(grid) {
      const gl=Math.abs(yt/gs-Math.round(yt/gs)),la=clamp01((0.022-gl)/0.022),a=Math.max(pre.lon[i],la)*0.58,m=1+a*gridGain;
      r*=m;g*=m;b*=m;
    }
    const mm=pre.mer[i];
    if(mm>0) {r*=1-mm*0.2;g*=1+mm;b*=1+mm*0.4;}
    for(let dy=0;dy<stride&&yy+dy<w;dy++) for(let dx=0;dx<stride&&xx+dx<w;dx++) {
      const o=((yy+dy)*w+xx+dx)*4;out[o]=r;out[o+1]=g;out[o+2]=b;out[o+3]=255;
    }
  }
}

// Which creature (if any) owns each pixel. Same maths as geometry.subjectAt, but one tight loop with the
// per-creature numbers worked out once per frame (the old per-pixel function calls were the main cost).
function seaBounds(stripX,stripY,n,skip) {
  const L=geometry.stripLengthMm,ref=stripX[skip?skip.indexOf(0):0];
  let a=1e9,b=-1e9,y0=1e9,y1=-1e9;
  for(let i=0;i<n;i++) {
    if(skip&&skip[i]) continue;
    let d=stripX[i]-ref;d-=L*Math.round(d/L);
    if(d<a)a=d;if(d>b)b=d;if(stripY[i]<y0)y0=stripY[i];if(stripY[i]>y1)y1=stripY[i];
  }
  return {xc:ref+(a+b)/2,hx:(b-a)/2,y0,y1};
}
function fillSubjects(stripX,stripY,n,skip,shown,out,bounds) {
  const L=geometry.stripLengthMm,aimY=geometry.aimHeightMm,scroll=geometry.stripScrollMm(state.depth),m=shown.length;
  const sx=new Float64Array(m),sy=new Float64Array(m),hw=new Float64Array(m),hh=new Float64Array(m),masks=[];
  for(let k=0;k<m;k++) {
    const sub=config.subjects[k];sx[k]=shown[k][0];sy[k]=2*aimY-shown[k][1]+scroll;hw[k]=sub.w_mm/2;hh[k]=sub.h_mm/2;masks.push(config.sprite_masks[sub.kind]);
  }
  // Only creatures whose box touches this panel are worth testing against its pixels.
  const active=[];
  for(let k=0;k<m;k++) {
    let dxs=sx[k]-bounds.xc;dxs-=L*Math.round(dxs/L);
    if(Math.abs(dxs)>bounds.hx+hw[k]||sy[k]+hh[k]<bounds.y0||sy[k]-hh[k]>bounds.y1) continue;
    active.push(k);
  }
  if(!active.length) {out.fill(-1);return;}
  for(let i=0;i<n;i++) {
    if(skip&&skip[i]) {out[i]=-1;continue;}
    const x=stripX[i],y=stripY[i];let found=-1;
    for(let a=0;a<active.length;a++) {
      const k=active[a];
      let dx=x-sx[k];dx-=L*Math.round(dx/L);
      if(dx>hw[k]||dx<-hw[k]) continue;
      const dy=y-sy[k];
      if(dy>hh[k]||dy<-hh[k]) continue;
      const col=Math.floor((dx/hw[k]*0.5+0.5)*8),row=Math.floor((dy/hh[k]*0.5+0.5)*8);
      if(col>=0&&col<8&&row>=0&&row<8&&(masks[k][row]&(1<<(7-col)))) {found=k;break;}
    }
    out[i]=found;
  }
}

// ---------------------------------------------------------------- living sea
// Decoration drawn over the painted sea: light shafts, bubbles, marine snow, glowing plankton, small drifting
// life and the sea floor. None of it can be scanned; the creatures in config.subjects are untouched.
// Everything is placed in strip millimetres and pushed through each face's affine strip->canvas map, so a
// particle crosses the cube edges exactly the way the creatures do. Diving streams it all upwards.
const LIFE={built:false,travel:300,bursts:[],lastBurst:0,aimX:0};
function lifeRand(seed){let s=seed>>>0;return()=>((s=(s*1664525+1013904223)>>>0)/4294967296);}
function buildLife() {
  const L=geometry.stripLengthMm,r=lifeRand(7),H=120,make=(n,f)=>Array.from({length:n},(_,i)=>f(i));
  LIFE.shafts=make(6,i=>({x:(i+r()*0.5)*L/6,w:3+r()*5,ph:r()*6.28}));
  LIFE.bubbles=make(120,()=>({x:r()*L,y:r()*H,v:5+r()*9,ph:r()*6.28,rad:0.14+r()*0.3}));
  LIFE.snow=make(260,()=>({x:r()*L,y:r()*H,v:0.5+r()*1.2,ph:r()*6.28,s:0.1+r()*0.14,a:0.25+r()*0.4}));
  LIFE.plankton=make(230,()=>({x:r()*L,y:r()*H,ph:r()*6.28,sp:0.3+r()*0.9,hue:Math.floor(r()*3),k:r()}));
  LIFE.schools=make(5,i=>({x:r()*L,y:-30+i*14,v:(i%2?-1:1)*(4+r()*3),fish:make(11,()=>({dx:(r()-0.5)*14,dy:(r()-0.5)*6,ph:r()*6.28}))}));
  LIFE.jellies=make(14,()=>({x:r()*L,y:r()*H,v:0.6+r()*0.8,ph:r()*6.28,size:1.1+r()*0.9,pink:r()<0.5}));
  LIFE.chain={x:r()*L,y:-6};
  LIFE.vents=[0.21,0.68].map(u=>({x:u*L,smoke:make(12,()=>({ph:r(),dx:(r()-0.5)*2})),worms:make(7,()=>({dx:(r()-0.5)*11,h:1.6+r()*1.6,ph:r()*6.28}))}));
  LIFE.travel=geometry.depthTravelMm;LIFE.built=true;
}
function lifeMap(faceId,width,ring) {
  const r=FACES.find(f=>f.id===faceId).rect,cx=config.azimuth_order.indexOf(faceId)*geometry.stripStepMm;
  const at=(x,y)=> {const uv=geometry.stripLocal(faceId,x,y);return ring?[uv[0]*width,uv[1]*width]:[(uv[0]-r.left)/(r.right-r.left)*width,(uv[1]-r.top)/(r.bottom-r.top)*width];};
  const o=at(cx,0),px=at(cx+1,0),py=at(cx,1);
  return {cx,w:width,a:px[0]-o[0],b:px[1]-o[1],c:py[0]-o[0],d:py[1]-o[1],e:o[0],f:o[1],scale:Math.hypot(px[0]-o[0],px[1]-o[1])};
}
function seaFloor(x,base) {
  const u=x/geometry.stripLengthMm*Math.PI*2;
  return base+3.4*Math.sin(u*3)+1.8*Math.sin(u*7+1.3)+0.9*Math.sin(u*17+0.4);
}
function drawLife(ctx,m) {
  if(!LIFE.built) buildLife();
  const d=clamp01(state.depth),t=state.seconds,W=m.w,S=m.scale,step=geometry.stripStepMm,reach=step+18;
  const wrapY=v=>((v+60)%120+120)%120-60;
  const band=(a,b,c,e)=>d<=a||d>=e?0:d<b?(d-a)/(b-a):d<=c?1:(e-d)/(e-c);
  let PX=0,PY=0;
  const put=(x,y)=> {const dx=geometry.wrapDistance(x,m.cx);PX=m.a*dx+m.c*y+m.e;PY=m.b*dx+m.d*y+m.f;return PX>-8&&PY>-8&&PX<W+8&&PY<W+8;};
  const inStrip=()=>ctx.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);
  ctx.save();

  // Sunlight: slanted shafts that sway, gone by ~700 m.
  const sun=band(-1,-0.5,0.02,0.24);
  if(sun>0) {
    inStrip();ctx.globalCompositeOperation='lighter';
    for(const s of LIFE.shafts) {
      const dx=geometry.wrapDistance(s.x+Math.sin(t*0.13+s.ph)*5,m.cx);
      if(Math.abs(dx)>reach+14) continue;
      const a=sun*(0.085+0.05*Math.sin(t*0.4+s.ph)),g=ctx.createLinearGradient(0,58,0,-45);
      g.addColorStop(0,'rgba(190,240,255,'+a.toFixed(3)+')');g.addColorStop(1,'rgba(190,240,255,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(dx,58);ctx.lineTo(dx+s.w,58);ctx.lineTo(dx+s.w*0.5-13,-45);ctx.lineTo(dx-13-s.w*0.2,-45);ctx.closePath();ctx.fill();
    }
    ctx.globalCompositeOperation='source-over';
  }

  // A whale passing far off while its call is heard.
  const whale=(performance.now()-(state.whaleAt||-1e9))/(state.whaleFor||1);
  if(whale>=0&&whale<=1&&d<0.7) {
    const dx=geometry.wrapDistance((state.whaleX||0)+whale*95,m.cx),y=16+Math.sin(whale*5)*3;
    if(Math.abs(dx)<reach+40) {
      inStrip();ctx.fillStyle='rgba(3,14,28,'+(Math.sin(whale*Math.PI)*0.3).toFixed(3)+')';
      ctx.beginPath();ctx.ellipse(dx,y,23,5,0,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.moveTo(dx-20,y);ctx.lineTo(dx-33,y+5.5);ctx.lineTo(dx-30,y);ctx.lineTo(dx-33,y-5.5);ctx.closePath();ctx.fill();
      ctx.beginPath();ctx.moveTo(dx+6,y-3);ctx.lineTo(dx-1,y-11);ctx.lineTo(dx-5,y-3);ctx.closePath();ctx.fill();
    }
  }

  // Small fish in loose schools near the surface.
  const shallow=band(-1,-0.5,0.2,0.32);
  if(shallow>0) {
    inStrip();ctx.fillStyle='rgba(205,236,246,'+(0.6*shallow).toFixed(3)+')';
    for(const sc of LIFE.schools) {
      const dx0=geometry.wrapDistance(sc.x+t*sc.v,m.cx),y0=sc.y+(d-0.1)*150,dir=sc.v>0?1:-1;
      if(Math.abs(dx0)>reach+10||y0>70) continue;
      for(const f of sc.fish) {
        const x=dx0+f.dx+Math.sin(t*0.8+f.ph)*1.2,y=y0+f.dy+Math.cos(t*0.6+f.ph)*0.6;
        ctx.beginPath();ctx.ellipse(x,y,0.75,0.24,0,0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.moveTo(x-dir*0.6,y);ctx.lineTo(x-dir*1.25,y+0.36);ctx.lineTo(x-dir*1.25,y-0.36);ctx.closePath();ctx.fill();
      }
    }
  }

  // Marine snow from the twilight zone down.
  const snow=band(0.16,0.4,2,3);
  if(snow>0) {
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='rgb(200,225,240)';
    const n=Math.floor(LIFE.snow.length*snow);
    for(let i=0;i<n;i++) {
      const s=LIFE.snow[i];
      if(!put(s.x+Math.sin(t*0.3+s.ph)*1.5,wrapY(s.y-t*s.v+d*LIFE.travel))) continue;
      const z=Math.max(1,s.s*S);ctx.globalAlpha=s.a*(0.5+0.5*snow);ctx.fillRect(PX-z/2,PY-z/2,z,z);
    }
    ctx.globalAlpha=1;
  }

  // Little jellies pulsing upwards through the middle water.
  const mid=band(0.2,0.32,0.62,0.74);
  if(mid>0) {
    inStrip();ctx.lineWidth=0.09;
    for(const j of LIFE.jellies) {
      const dx=geometry.wrapDistance(j.x+Math.sin(t*0.1+j.ph)*6,m.cx),y=wrapY(j.y+t*j.v+d*200);
      if(Math.abs(dx)>reach) continue;
      const p=0.5+0.5*Math.sin(t*1.6+j.ph),rx=j.size*(0.8+0.2*p),ry=j.size*(0.75-0.2*p),tint=j.pink?'255,175,225':'190,175,255';
      ctx.fillStyle='rgba('+tint+','+(0.42*mid).toFixed(3)+')';ctx.strokeStyle='rgba('+tint+','+(0.5*mid).toFixed(3)+')';
      ctx.beginPath();ctx.ellipse(dx,y,rx,ry,0,0,Math.PI);ctx.closePath();ctx.fill();
      ctx.beginPath();
      for(let k=-1;k<=1;k++) {ctx.moveTo(dx+k*rx*0.5,y);ctx.quadraticCurveTo(dx+k*rx*0.5+Math.sin(t*1.6+j.ph+k)*0.5,y-j.size*0.8,dx+k*rx*0.4,y-j.size*(1.3+0.3*p));}
      ctx.stroke();
    }
  }

  // Bioluminescent plankton in the dark: it twinkles by itself, flares when the water is stirred (turning,
  // diving, scanning) and breathes faintly with the beat of the music.
  const dark=band(0.45,0.66,2,3);
  if(dark>0) {
    ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='lighter';
    const n=Math.floor(LIFE.plankton.length*dark),stir=state.stir||0,pulse=state.beatPulse||0,tints=['80,255,230','110,170,255','150,255,170'];
    for(let i=0;i<n;i++) {
      const p=LIFE.plankton[i];
      if(!put(p.x+Math.cos(t*0.15*p.sp+p.ph)*4,wrapY(p.y+d*LIFE.travel*0.8+Math.sin(t*0.2+p.ph)*3))) continue;
      const twinkle=Math.pow(0.5+0.5*Math.sin(t*p.sp*1.7+p.ph),6);
      const b=Math.min(1,0.2+0.6*twinkle+stir*(0.35+0.65*p.k)+pulse*0.16)*dark,core=Math.max(1.5,0.2*S);
      ctx.fillStyle='rgba('+tints[p.hue]+','+(b*0.3).toFixed(3)+')';
      ctx.beginPath();ctx.arc(PX,PY,0.6*S*(0.7+b*0.7),0,Math.PI*2);ctx.fill();
      ctx.fillStyle='rgba('+tints[p.hue]+','+b.toFixed(3)+')';ctx.fillRect(PX-core/2,PY-core/2,core,core);
    }
    // A siphonophore: one long chain of lights with a pulse running down it.
    const chain=band(0.55,0.7,2,3);
    for(let i=0;i<18;i++) {
      const x=LIFE.chain.x+t*1.6-i*1.25,y=LIFE.chain.y+Math.sin(x*0.12+t*0.5)*5+(d-0.8)*60;
      if(!put(x,y)) continue;
      const b=(0.25+0.75*Math.max(0,Math.sin(t*2-i*0.5)))*chain;
      ctx.fillStyle='rgba(120,200,255,'+(b*0.25).toFixed(3)+')';ctx.beginPath();ctx.arc(PX,PY,0.5*S,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='rgba(190,235,255,'+b.toFixed(3)+')';ctx.beginPath();ctx.arc(PX,PY,Math.max(0.8,0.14*S),0,Math.PI*2);ctx.fill();
    }
    ctx.globalCompositeOperation='source-over';
  }

  // The sea floor comes up out of the dark near maximum depth, with two smoking vents and tube worms.
  const rise=clamp01((d-0.8)/0.2);
  if(rise>0) {
    inStrip();
    const base=-66+rise*36,g=ctx.createLinearGradient(0,base+6,0,base-26);
    g.addColorStop(0,'#1a2c30');g.addColorStop(1,'#04080a');
    ctx.beginPath();ctx.moveTo(-reach,-90);
    for(let dx=-reach;dx<=reach;dx+=2) ctx.lineTo(dx,seaFloor(m.cx+dx,base));
    ctx.lineTo(reach,-90);ctx.closePath();ctx.fillStyle=g;ctx.fill();
    ctx.beginPath();
    for(let dx=-reach;dx<=reach;dx+=2) {const y=seaFloor(m.cx+dx,base);if(dx===-reach)ctx.moveTo(dx,y);else ctx.lineTo(dx,y);}
    ctx.strokeStyle='rgba(95,150,150,0.55)';ctx.lineWidth=0.22;ctx.stroke();
    for(const v of LIFE.vents) {
      const dx=geometry.wrapDistance(v.x,m.cx);
      if(Math.abs(dx)>reach+8) continue;
      const foot=seaFloor(v.x,base),tip=foot+7;
      ctx.fillStyle='#0c1719';ctx.beginPath();ctx.moveTo(dx-2.4,foot-1);ctx.lineTo(dx-0.8,tip);ctx.lineTo(dx+0.8,tip);ctx.lineTo(dx+2.4,foot-1);ctx.closePath();ctx.fill();ctx.stroke();
      for(const w of v.worms) {
        const wx=dx+w.dx,wy=seaFloor(v.x+w.dx,base),sway=Math.sin(t*0.9+w.ph)*0.35;
        ctx.strokeStyle='rgba(235,235,225,0.8)';ctx.lineWidth=0.2;ctx.beginPath();ctx.moveTo(wx,wy-0.3);ctx.lineTo(wx+sway,wy+w.h);ctx.stroke();
        ctx.fillStyle='rgba(255,80,70,0.9)';ctx.beginPath();ctx.arc(wx+sway,wy+w.h,0.3,0,Math.PI*2);ctx.fill();
      }
      ctx.strokeStyle='rgba(95,150,150,0.55)';ctx.lineWidth=0.22;
      ctx.globalCompositeOperation='lighter';
      for(const s of v.smoke) {
        const age=(t*0.16+s.ph)%1;
        ctx.fillStyle='rgba(255,160,80,'+((1-age)*(1-age)*0.34).toFixed(3)+')';
        ctx.beginPath();ctx.arc(dx+s.dx*age*4+Math.sin(t*0.7+s.ph*9)*age*2,tip+age*26,0.7+age*2.6,0,Math.PI*2);ctx.fill();
      }
      ctx.globalCompositeOperation='source-over';
    }
  }

  // Bubbles: a few always rising, more near the surface, and a burst from the hull with every bubble sound.
  ctx.setTransform(1,0,0,1,0,0);ctx.lineWidth=1;
  const count=Math.floor(LIFE.bubbles.length*clamp01(0.7-0.5*d+(state.diving?0.25:0)));
  ctx.strokeStyle='rgba(225,247,255,'+(0.62-0.3*d).toFixed(3)+')';ctx.fillStyle='rgba(255,255,255,'+(0.5-0.25*d).toFixed(3)+')';
  for(let i=0;i<count;i++) {
    const b=LIFE.bubbles[i];
    if(!put(b.x+Math.sin(t*1.3+b.ph)*1.2,wrapY(b.y+t*b.v+d*LIFE.travel*1.3))) continue;
    const rad=Math.max(1,b.rad*S);ctx.beginPath();ctx.arc(PX,PY,rad,0,Math.PI*2);ctx.stroke();
    if(rad>1.6) ctx.fillRect(PX-rad*0.45,PY-rad*0.45,1,1);
  }
  for(const b of LIFE.bursts) {
    const age=t-b.born;
    if(age<0||age>b.life||!put(b.x+Math.sin(age*5+b.ph)*0.9,b.y+age*b.v)) continue;
    const rad=Math.max(1,b.rad*S);ctx.globalAlpha=1-age/b.life;ctx.beginPath();ctx.arc(PX,PY,rad,0,Math.PI*2);ctx.stroke();
  }
  ctx.restore();
}
// Once per frame: bubbles leave the hull in front of the viewer whenever a bubble sound has just played.
function stepLife(hit) {
  const t=state.seconds;
  if(state.bubbleBurstAt&&state.bubbleBurstAt!==LIFE.lastBurst) {
    LIFE.lastBurst=state.bubbleBurstAt;
    for(let i=0;i<9;i++) LIFE.bursts.push({x:hit.strip_mm[0]+(Math.random()-0.5)*18,y:geometry.aimHeightMm-26+Math.random()*16,v:16+Math.random()*16,
      rad:0.16+Math.random()*0.3,ph:Math.random()*6.28,born:t+Math.random()*0.35,life:2.2+Math.random()});
  }
  if(LIFE.bursts.length) LIFE.bursts=LIFE.bursts.filter(b=>t-b.born<b.life);
}

function makePanel(f) {
  const canvas=document.createElement('canvas');canvas.width=PANEL;canvas.height=PANEL;
  const ctx=canvas.getContext('2d'), tex=new THREE.CanvasTexture(canvas);
  tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.LinearFilter;tex.generateMipmaps=false;
  const stripX=new Float64Array(PANEL*PANEL),stripY=new Float64Array(PANEL*PANEL);
  for(let y=0;y<PANEL;y++) for(let x=0;x<PANEL;x++) {
    const i=y*PANEL+x,p=geometry.pixel(f.id,x,y,0.5);
    stripX[i]=p.strip_mm[0];stripY[i]=p.strip_mm[1];
  }
  return {canvas,ctx,tex,stripX,stripY,subjects:new Int8Array(PANEL*PANEL),
    frame:new ImageData(PANEL,PANEL),background:new Uint8ClampedArray(PANEL*PANEL*4),cacheKey:null};
}

// Seamless look: the 10 mm frame is painted with the same sea (the strip map extended over the whole 50 mm face)
// so the picture runs across the cube edges. The Frame button brings the physical, opaque bezel back.
function makeRing(f) {
  const canvas=document.createElement('canvas');canvas.width=RING;canvas.height=RING;
  const ctx=canvas.getContext('2d'),tex=new THREE.CanvasTexture(canvas);
  tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearFilter;tex.generateMipmaps=false;
  const stripX=new Float64Array(RING*RING),stripY=new Float64Array(RING*RING),skip=new Uint8Array(RING*RING),r=f.rect;
  for(let y=0;y<RING;y++) for(let x=0;x<RING;x++) {
    const i=y*RING+x,u=(x+0.5)/RING,v=(y+0.5)/RING,p=geometry.stripPoint(f.id,u,v);
    stripX[i]=p[0];stripY[i]=p[1];skip[i]=(u>=r.left&&u<=r.right&&v>=r.top&&v<=r.bottom)?1:0;
  }
  return {canvas,ctx,tex,stripX,stripY,skip,frame:new ImageData(RING,RING),background:new Uint8ClampedArray(RING*RING*4),cacheKey:null,plane:null};
}

function drawRing(ring,face,hit,shown) {
  ring.plane.visible=!state.frame;
  if(state.frame) return;
  // The ring only moves with time and depth (the sea is fixed to the cube), so redraw it at ~8 fps;
  // a reticle resting on the frame redraws this face every frame.
  const nowR=performance.now(),onFrame=hit.face===face&&!hit.onPanel;
  if(!onFrame&&ring.lastAt&&nowR-ring.lastAt<120&&ring.lastDepth===state.depth&&ring.lastGrid===state.grid) return;
  ring.lastAt=nowR;ring.lastDepth=state.depth;ring.lastGrid=state.grid;
  const key=state.depth+'|'+state.grid;
  if(ring.cacheKey!==key) {
    if(!ring.pre) ring.pre=makeSeaPre(ring.stripX,ring.stripY,RING*RING);
    paintSea(ring.background,ring.stripX,ring.stripY,ring.pre,RING*RING,ring.skip,RING,(performance.now()-(state.seaChangedAt||0)<220)?3:1);
    ring.cacheKey=key;
  }
  const d=ring.frame.data;d.set(ring.background);
  if(!ring.subjects) ring.subjects=new Int8Array(RING*RING);
  fillSubjects(ring.stripX,ring.stripY,RING*RING,ring.skip,shown,ring.subjects,ring.bounds||(ring.bounds=seaBounds(ring.stripX,ring.stripY,RING*RING,ring.skip)));
  for(let i=0;i<RING*RING;i++) {
    const s=ring.subjects[i];
    if(s>=0) d.set(SUBJECTS[s].rgb,i*4);
  }
  ring.ctx.putImageData(ring.frame,0,0);
  drawLife(ring.ctx,ring.lifeMap||(ring.lifeMap=lifeMap(FACES[face].id,RING,true)));
  // Reticle resting on the frame area: a thin green line is the only cue (no spoken warning).
  if(hit.face===face&&!hit.onPanel&&hit.local) {
    const x=hit.local[0]*RING,y=hit.local[1]*RING;
    ring.ctx.strokeStyle='#00ffcc';ring.ctx.lineWidth=1.5;ring.ctx.beginPath();
    ring.ctx.moveTo(x-14,y);ring.ctx.lineTo(x+14,y);ring.ctx.moveTo(x,y-14);ring.ctx.lineTo(x,y+14);ring.ctx.stroke();
  }
  ring.tex.needsUpdate=true;
}

function initThree() {
  const host=document.getElementById('canvas-container');
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,0.1,100);
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);
  renderer.setClearColor(0x000508,1);host.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight(0x708aa0,1.2));
  const light=new THREE.DirectionalLight(0xb5e5ff,1.3);light.position.set(3,-4,5);scene.add(light);
  cubeGroup=new THREE.Group();mountedGroup=new THREE.Group();scene.add(cubeGroup);cubeGroup.add(mountedGroup);
  const m=geometry.mount;
  mountedGroup.setRotationFromMatrix(new THREE.Matrix4().set(
    ...m[0],0,...m[1],0,...m[2],0,0,0,0,1));
  mountedGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x253746,roughness:0.7,metalness:0.15})));
  mountedGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002,1.002,1.002)),new THREE.LineBasicMaterial({color:0x60dcc7})));
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.035,0.36,24),new THREE.MeshStandardMaterial({color:0x75959a}));
  pole.rotation.x=Math.PI/2;pole.position.z=-Math.sqrt(3)/2-0.18;scene.add(pole);
  const base=new THREE.Mesh(new THREE.CylinderGeometry(0.48,0.53,0.1,64),new THREE.MeshStandardMaterial({color:0x172d3b,metalness:0.5,roughness:0.4}));
  base.rotation.x=Math.PI/2;base.position.z=-Math.sqrt(3)/2-0.39;scene.add(base);
  const axis=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,-1.25),new THREE.Vector3(0,0,1.05)]);
  const axisLine=new THREE.Line(axis,new THREE.LineDashedMaterial({color:0x487668,dashSize:0.03,gapSize:0.025}));
  axisLine.computeLineDistances();scene.add(axisLine);
  aimMarker=new THREE.Mesh(new THREE.SphereGeometry(0.013,12,12),new THREE.MeshBasicMaterial({color:0xffbc64}));scene.add(aimMarker);
  FACES.forEach(f=> {
    const p=makePanel(f);panels.push(p);
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(f.rect.right-f.rect.left,f.rect.bottom-f.rect.top),new THREE.MeshBasicMaterial({map:p.tex,toneMapped:false}));
    plane.setRotationFromMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.r),new THREE.Vector3(...f.d).negate(),new THREE.Vector3(...f.n)));
    plane.position.fromArray(scale(f.n,0.503));mountedGroup.add(plane);
    p.ring=makeRing(f);
    const ringPlane=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:p.ring.tex,toneMapped:false}));
    ringPlane.setRotationFromMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.r),new THREE.Vector3(...f.d).negate(),new THREE.Vector3(...f.n)));
    ringPlane.position.fromArray(scale(f.n,0.5015));mountedGroup.add(ringPlane);p.ring.plane=ringPlane;
    const tagCanvas=document.createElement('canvas');tagCanvas.width=160;tagCanvas.height=64;
    const tc=tagCanvas.getContext('2d');tc.fillStyle='#d8fff8';tc.font='bold 35px monospace';tc.textAlign='center';tc.fillText(f.id.toUpperCase(),80,44);
    const tag=new THREE.Mesh(new THREE.PlaneGeometry(0.30,0.12),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(tagCanvas),transparent:true}));
    tag.quaternion.copy(plane.quaternion);tag.position.fromArray(f.n.map((n,i)=>n*0.507-f.d[i]*0.40));mountedGroup.add(tag);labels.push(tag);
    const cell=document.createElement('div');cell.className='panel-cell';cell.dataset.face=f.id;cell.appendChild(p.canvas);
    const label=document.createElement('div');label.className='panel-tag';label.textContent=f.id+' / '+(geometry.point(f.id,0.5,0.5)[2]>0?'UPPER':'LOWER');cell.appendChild(label);
    document.getElementById('panel-strip').appendChild(cell);
  });
  window.addEventListener('resize',onResize);fitOrbit();
}

function onResize() {camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);fitOrbit();}
// A phone held upright has a narrow view: stand further back so the whole cube stays in frame.
function fitOrbit() {orbit.dist=Math.max(orbit.dist,Math.min(7,4.4*Math.max(1,0.72/(innerWidth/innerHeight))));}
function placeCamera() {
  camera.up.set(0,0,1);
  camera.position.set(orbit.dist*Math.sin(orbit.phi)*Math.cos(orbit.theta),orbit.dist*Math.sin(orbit.phi)*Math.sin(orbit.theta),orbit.dist*Math.cos(orbit.phi));
  camera.lookAt(0,0,-0.15);
}
function drawReticle(p,hit) {
  const x=Math.min(PANEL-1,Math.floor(hit.pixel_uv[0]*PANEL)),y=Math.min(PANEL-1,Math.floor(hit.pixel_uv[1]*PANEL));
  p.ctx.strokeStyle='#00ffcc';p.ctx.lineWidth=1;p.ctx.beginPath();
  for(const sign of [-1,1]) {p.ctx.moveTo(x+sign*4,y+0.5);p.ctx.lineTo(x+sign*14,y+0.5);p.ctx.moveTo(x+0.5,y+sign*4);p.ctx.lineTo(x+0.5,y+sign*14);}
  p.ctx.stroke();p.ctx.strokeRect(x-11.5,y-11.5,23,23);
}

function updateAimMarker(hit) {
  aimMarker.visible=hit.onPanel;
  const bp=hit.point_mm.map(x=>x/faceConfig.physical_face_dimensions_mm.face_edge),a=(state.yaw+geometry.aimPhaseDeg)*Math.PI/180;
  aimMarker.position.set(bp[0]*Math.cos(a)+bp[1]*Math.sin(a),-bp[0]*Math.sin(a)+bp[1]*Math.cos(a),bp[2]);
}

function renderPanels() {
  const hit=reticleHit(state.yaw),shown=geometry.poses(state.seconds);
  stepLife(hit);
  panels.forEach((p,face)=> {
    if(state.seaDepth!==state.depth) {state.seaDepth=state.depth;state.seaChangedAt=performance.now();}
    const moving=performance.now()-(state.seaChangedAt||0)<220;
    const key=state.depth+'|'+state.grid+'|'+(moving?'c':'f');
    if(p.cacheKey!==key) {
      if(!p.pre) p.pre=makeSeaPre(p.stripX,p.stripY,PANEL*PANEL);
      paintSea(p.background,p.stripX,p.stripY,p.pre,PANEL*PANEL,null,PANEL,moving?3:1);
      p.cacheKey=key;
    }
    p.frame.data.set(p.background);
    fillSubjects(p.stripX,p.stripY,PANEL*PANEL,null,shown,p.subjects,p.bounds||(p.bounds=seaBounds(p.stripX,p.stripY,PANEL*PANEL,null)));
    for(let i=0;i<PANEL*PANEL;i++) {
      const s=p.subjects[i];
      if(s>=0) p.frame.data.set(SUBJECTS[s].rgb,i*4);
    }
    const now=performance.now();
    // Outline every creature the panel is showing: a pixel that belongs to a subject and touches
    // a pixel that does not is an edge pixel. Costs one pass over the panel and needs no shapes.
    if(state.highlight||now<state.highlightUntil) {
      const d=p.frame.data;
      for(let y=0;y<PANEL;y++) for(let x=0;x<PANEL;x++) {
        const i=y*PANEL+x,s=p.subjects[i];
        if(s<0) continue;
        if(x===0||x===PANEL-1||y===0||y===PANEL-1||
           p.subjects[i-1]!==s||p.subjects[i+1]!==s||p.subjects[i-PANEL]!==s||p.subjects[i+PANEL]!==s)
          d.set([0,255,140,255],i*4);
      }
    }
    // Scan sweep: one green band at a fixed world height, travelling from the top vertex to the
    // bottom one. Because it is driven by the strip height it crosses all six panels as one band.
    const sweep=(now-state.sweepStart)/SCAN_SWEEP_MS;
    if(sweep>=0&&sweep<=1) {
      const top=geometry.stripStepMm*1.5, band=top-sweep*2*top, d=p.frame.data;
      for(let i=0;i<PANEL*PANEL;i++) {
        const away=Math.abs(p.stripY[i]-band);
        if(away>=3) continue;
        const w=1-away/3;
        d[i*4]=d[i*4]*(1-w)+40*w; d[i*4+1]=d[i*4+1]*(1-w)+255*w; d[i*4+2]=d[i*4+2]*(1-w)+150*w;
      }
    }
    p.ctx.putImageData(p.frame,0,0);
    drawLife(p.ctx,p.lifeMap||(p.lifeMap=lifeMap(FACES[face].id,PANEL,false)));
    // Collect: a ring opening out of the reticle on the panel the sample came from.
    const flash=(now-state.collectFlash)/COLLECT_FLASH_MS;
    if(flash>=0&&flash<=1&&state.collectFace===face) {
      p.ctx.strokeStyle='rgba(0,255,150,'+(1-flash).toFixed(2)+')';
      p.ctx.lineWidth=5;
      p.ctx.beginPath();p.ctx.arc(state.collectXY[0],state.collectXY[1],14+flash*95,0,Math.PI*2);p.ctx.stroke();
    }
    if(hit.face===face&&hit.onPanel) drawReticle(p,hit);
    p.tex.needsUpdate=true;
    drawRing(p.ring,face,hit,shown);
  });
  return hit;
}

// True while any assist animation needs fresh frames, so the render key keeps changing.
function effectsRunning() {
  const now=performance.now();
  return state.highlight||now<state.highlightUntil||
    now-state.sweepStart<SCAN_SWEEP_MS||now-state.collectFlash<COLLECT_FLASH_MS;
}

// Side projections of successive facets, joined along their true shared edges.
// This is a rhombic azimuth development (foreshortened), not a cutting template.
function unfoldPoint(index,u,v) {
  const p=geometry.strip(config.azimuth_order[index],u,v);
  return [p[0]/faceConfig.physical_face_dimensions_mm.face_edge,-p[1]/faceConfig.physical_face_dimensions_mm.face_edge];
}
function drawUnfold() {
  const canvas=document.getElementById('unfold-canvas'),w=canvas.clientWidth,h=canvas.clientHeight;
  if(canvas.width!==w||canvas.height!==h) {canvas.width=w;canvas.height=h;}
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);
  const unit=Math.min((w-80)/(7/Math.sqrt(2)),(h-80)/Math.sqrt(3));
  const sx=(w-5/Math.sqrt(2)*unit)/2,sy=h/2;
  const screen=p=>[sx+p[0]*unit,sy+p[1]*unit];
  config.azimuth_order.forEach((id,k)=> {
    const index=FACES.findIndex(f=>f.id===id),f=FACES[index],r=f.rect;
    const corners=[[0,0],[1,0],[1,1],[0,1]].map(uv=>screen(unfoldPoint(k,...uv)));
    ctx.beginPath();corners.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();
    ctx.fillStyle=k%2?'#192e3a':'#263e4b';ctx.fill();ctx.strokeStyle='#628d95';ctx.lineWidth=1.5;ctx.stroke();
    const a=screen(unfoldPoint(k,r.left,r.top)),b=screen(unfoldPoint(k,r.right,r.top)),c=screen(unfoldPoint(k,r.left,r.bottom));
    ctx.save();ctx.setTransform((b[0]-a[0])/PANEL,(b[1]-a[1])/PANEL,(c[0]-a[0])/PANEL,(c[1]-a[1])/PANEL,...a);
    ctx.drawImage(panels[index].canvas,0,0);ctx.restore();
    if(state.labels) {
      const center=screen(unfoldPoint(k,0.5,0.5));
      ctx.fillStyle='#d6fff6';ctx.font='12px monospace';ctx.textAlign='center';
      ctx.fillText(id.toUpperCase()+' '+k*60+' deg',center[0],center[1]+(k%2?1:-1)*unit*0.56);
    }
  });
  ctx.textAlign='center';ctx.fillStyle='#8eaeb7';ctx.font='12px monospace';
  ctx.fillText('50 mm face / 30 mm opening / 10 mm frame. End edges join: NY to PX.',w/2,h-12);
}

function edgePoint(pair,side,u,v) {
  const f=FACES.find(face=>face.id===pair[side]),p=f.n.map((n,i)=>n*0.5+f.r[i]*(u-0.5)+f.d[i]*(v-0.5));
  const meta=pair[2],mid=meta.mid,inward=meta.inwards[side],along=p[meta.free]-mid[meta.free];
  const normalDistance=p.reduce((sum,value,i)=>sum+(value-mid[i])*inward[i],0);
  return [along,side===0?normalDistance:-normalDistance];
}
function drawEdgeDebug() {
  const canvas=$('edge-canvas'),w=canvas.clientWidth,h=canvas.clientHeight;
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);ctx.fillStyle='#06151f';ctx.fillRect(0,0,w,h);
  const pair=edgePairs[Number($('edge-select').value)||0];if(!pair)return;
  const raw=[];for(let side=0;side<2;side++)for(const uv of [[0,0],[1,0],[1,1],[0,1]])raw.push(edgePoint(pair,side,...uv));
  const minX=Math.min(...raw.map(p=>p[0])),maxX=Math.max(...raw.map(p=>p[0])),minY=Math.min(...raw.map(p=>p[1])),maxY=Math.max(...raw.map(p=>p[1]));
  const unit=Math.min((w-90)/(maxX-minX||1),(h-90)/(maxY-minY||1)),screen=p=>[45+(p[0]-minX)*unit,h-45-(p[1]-minY)*unit];
  for(let side=0;side<2;side++){
    const id=pair[side],f=FACES.find(face=>face.id===id),corners=[[0,0],[1,0],[1,1],[0,1]].map(uv=>screen(edgePoint(pair,side,...uv)));
    ctx.beginPath();corners.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fillStyle=side?'#192e3a':'#263e4b';ctx.fill();ctx.strokeStyle='#628d95';ctx.lineWidth=1.5;ctx.stroke();
    const r=f.rect,a=screen(edgePoint(pair,side,r.left,r.top)),b=screen(edgePoint(pair,side,r.right,r.top)),c=screen(edgePoint(pair,side,r.left,r.bottom));
    ctx.save();ctx.setTransform((b[0]-a[0])/PANEL,(b[1]-a[1])/PANEL,(c[0]-a[0])/PANEL,(c[1]-a[1])/PANEL,a[0],a[1]);ctx.drawImage(panels[FACES.findIndex(face=>face.id===id)].canvas,0,0);ctx.restore();
    ctx.fillStyle='#d6fff6';ctx.font='12px monospace';ctx.textAlign='center';const center=screen(edgePoint(pair,side,.5,.5));ctx.fillText(id.toUpperCase(),center[0],center[1]+(side?24:-14));
  }
  ctx.fillStyle='#8eaeb7';ctx.font='12px monospace';ctx.textAlign='center';ctx.fillText('Selected physical edge: '+pair[0].toUpperCase()+' / '+pair[1].toUpperCase()+' · 50 mm faces · 30 mm opening · 10 mm frame',w/2,h-12);
}

function animate(now) {
  requestAnimationFrame(animate);
  if(now-lastFrame<50) return;
  const dt=previousTime?Math.min((now-previousTime)/1000,0.15):0;previousTime=now;lastFrame=now;
  if(state.liveMode&&state.liveConnected){let delta=state.liveTargetYaw-state.yaw;while(delta>180)delta-=360;while(delta<-180)delta+=360;setYaw((state.yaw+delta*Math.min(1,dt*12)+360)%360);}
  if(state.started&&!state.paused) state.seconds+=dt;
  state.stir=(state.stir||0)*Math.exp(-dt/1.4);state.diving=Boolean(audio.descending);
  if(audio.context&&audio.clock0!=null) state.beatPulse=Math.exp(-(((audio.context.currentTime-audio.clock0)/(BEAT.eighth*3))%1)*4);
  const renderKey=[state.seconds,state.depth,state.yaw,state.grid,state.labels,state.frame,state.unfold,orbit.dist,innerWidth,innerHeight,
    effectsRunning()?Math.round(now/60):0].join('|');
  if(renderKey===lastRenderKey) return;
  lastRenderKey=renderKey;
  const hit=renderPanels();updateAudioFocus(hit);cubeGroup.rotation.z=-(state.yaw+geometry.aimPhaseDeg)*Math.PI/180;
  labels.forEach(t=>t.visible=state.labels);
  updateAimMarker(hit);
  placeCamera();
  if(state.unfold) drawUnfold();else renderer.render(scene,camera);
  updateHUD(hit);
}

function initViewControls() {
  $('btn-unfold').onclick=()=> {state.unfold=!state.unfold;state.edgeDebug=false;$('edge-debug').classList.remove('show');$('unfold-view').hidden=!state.unfold;$('canvas-container').hidden=state.unfold;$('btn-unfold').textContent=state.unfold?'3D view':'Unfold';};
  $('btn-edge-debug').onclick=()=> {state.unfold=true;state.edgeDebug=!state.edgeDebug;$('unfold-view').hidden=false;$('canvas-container').hidden=true;$('edge-debug').classList.toggle('show',state.edgeDebug);if(state.edgeDebug)drawEdgeDebug();};
  $('btn-labels').onclick=()=> {state.labels=!state.labels;document.body.classList.toggle('hide-labels',!state.labels);$('btn-labels').setAttribute('aria-pressed',state.labels);};
  $('btn-grid').onclick=()=> {state.grid=!state.grid;$('btn-grid').setAttribute('aria-pressed',state.grid);};
  $('btn-frame').onclick=()=> {state.frame=!state.frame;$('btn-frame').setAttribute('aria-pressed',state.frame);};
  $('btn-pause').onclick=()=> {state.paused=!state.paused;$('btn-pause').textContent=state.paused?'Resume':'Pause';};
  $('heading-input').oninput=e=> {setYaw(Number(e.target.value)||0);};
  $('depth-input').oninput=e=> {setDepth(Number(e.target.value));};
  $('btn-highlight').onclick=()=>toggleHighlight();
  $('btn-seam').onclick=()=> {state.seconds=0;state.depth=0.1;setYaw(0);state.paused=true;updateZone(state.depth);$('btn-pause').textContent='Resume';$('depth-input').value=state.depth;say('Seam fixture: shoal fish spans PX to PY at the upper-face edge. The 10 mm frame hides its middle. Resume to watch it cross.');};
  $('edge-select').onchange=()=> {if(state.edgeDebug)drawEdgeDebug();};
}

async function init() {
  const read=async path=> {const r=await fetch(path+'?v='+Date.now(),{cache:'no-store'});if(!r.ok) throw new Error(path+': '+r.status);return r.json();};
  [config,faceConfig,sceneConfig]=await Promise.all(['../config/twin.json','../config/faces.json','../config/scene.json'].map(read));
  geometry=TwinGeometry.create(config,faceConfig,sceneConfig);SUBJECTS=config.subjects;
  FACES=faceConfig.faces.map(f=>({id:f.id,n:f.normal,r:f.right,d:f.down,rect:f.physical_face_uv,on:config.enabled_faces.includes(f.id)}));
  for(let i=0;i<FACES.length;i++) for(let j=i+1;j<FACES.length;j++) {
    const a=FACES[i],b=FACES[j],normalDot=a.n.reduce((sum,v,k)=>sum+v*b.n[k],0);
    if(Math.abs(normalDot)>1e-12)continue;
    const free=[0,1,2].find(k=>a.n[k]===0&&b.n[k]===0),mid=a.n.map((v,k)=>(v+b.n[k])/2),centerA=a.n.map(v=>v*.5),centerB=b.n.map(v=>v*.5),rawA=centerA.map((v,k)=>v-mid[k]),rawB=centerB.map((v,k)=>v-mid[k]),lenA=Math.hypot(...rawA),lenB=Math.hypot(...rawB),inwardA=rawA.map(v=>v/lenA),inwardB=rawB.map(v=>v/lenB);
    edgePairs.push([a.id,b.id,{free,mid,inwards:[inwardA,inwardB]}]);
  }
  edgePairs.forEach((pair,i)=>{const option=document.createElement('option');option.value=i;option.textContent=pair[0].toUpperCase()+' / '+pair[1].toUpperCase();$('edge-select').appendChild(option);});
  initThree();await initAudio().catch(error=>{console.error(error);audioLog('sound_manifest','silent',error.message);});initInput();initViewControls();placeCamera();
  $('btn-start').disabled=false;$('btn-start').textContent='BEGIN EXPLORATION';
  $('btn-start').addEventListener('click',start);requestAnimationFrame(animate);
  if(new URLSearchParams(location.search).get('acceptance')==='1') {
    const script=document.createElement('script');script.src='../tests/twin_browser_checks.js';document.body.appendChild(script);
  }
}

/* Pure strip-map geometry for the mounted digital twin. */
'use strict';

const TwinGeometry={
  create(config,faceConfig,scene){
    const edge=faceConfig.physical_face_dimensions_mm.face_edge;
    const stripConfig=config.strip_map||{},step=stripConfig.face_step_mm||edge/Math.sqrt(2),stripLengthMm=stripConfig.length_mm||step*6,faces=faceConfig.faces;
    const faceById=id=>faces.find(f=>f.id===id),faceIndex=id=>config.azimuth_order.indexOf(id);
    const rects=Object.fromEntries(faces.map(f=>[f.id,f.physical_face_uv]));
    const mount=config.mount_orientation.matrix, inverse=transpose(mount);
    const aimY=stripConfig.aim_y_mm||step/2,aimCenterX=0;
    const clamp01=x=>Math.max(0,Math.min(1,x)),wrap=x=>((x%stripLengthMm)+stripLengthMm)%stripLengthMm;
    const wrapDistance=(x,center)=>{let d=x-center;while(d>stripLengthMm/2)d-=stripLengthMm;while(d<-stripLengthMm/2)d+=stripLengthMm;return d;};
    const stripScrollMm=depth=>(clamp01(depth)-0.1)*step*2;
    const depthLook=config.depth_darkening||{},backgroundLook=depthLook.background_scroll||{};
    const surfaceFadeDepth=backgroundLook.surface_fade_depth_norm||0.1;
    const surfaceScrollMm=backgroundLook.surface_scroll_mm??55;
    const deepTravelMm=backgroundLook.deep_travel_mm??35;
    const backgroundScrollMm=depth=>{
      const d=clamp01(depth);
      if(d<=surfaceFadeDepth)return surfaceScrollMm*(1-d/surfaceFadeDepth);
      return -deepTravelMm*(d-surfaceFadeDepth)/(1-surfaceFadeDepth);
    };
    const point=(id,u,v)=>mul(mount,pointOnFace(faceById(id),u,v)).map(x=>x*edge);
    const rotateUv=(u,v,r)=>r===0?[u,v]:r===1?[v,1-u]:r===2?[1-u,1-v]:[1-v,u];
    const unrotateUv=(u,v,r)=>r===0?[u,v]:r===1?[1-v,u]:r===2?[1-u,1-v]:[v,1-u];
    const heightScale=Math.sqrt(1.5),faceFrames=Object.fromEntries(faces.map(face=>{
      const centerY=point(face.id,.5,.5)[2]*heightScale;let best=null;
      for(let rotation=0;rotation<4;rotation++){
        let error=0;for(const uv of [[0,0],[1,0],[0,1],[1,1]]){const [u,v]=rotateUv(...uv,rotation),expected=centerY+step*(u-v),actual=point(face.id,...uv)[2]*heightScale;error=Math.max(error,Math.abs(actual-expected));}
        if(!best||error<best.error)best={rotation,centerY,error};
      } return [face.id,best];
    }));
    const stripPoint=(id,u,v)=>{const k=faceIndex(id),frame=faceFrames[id],[U,V]=rotateUv(u,v,frame.rotation),cx=k*step;return [cx+step*(U-.5)+step*(V-.5),frame.centerY+step*(U-.5)-step*(V-.5)];};
    const stripLocal=(id,x,y)=>{const k=faceIndex(id),frame=faceFrames[id],cx=k*step,dx=wrapDistance(x,cx),dy=y-frame.centerY,U=.5+(dx+dy)/(2*step),V=.5+(dx-dy)/(2*step);return unrotateUv(U,V,frame.rotation);};
    const faceForStrip=(x,y)=>{const wx=wrap(x),snap=v=>Math.abs(v)<1e-9?0:Math.abs(v-1)<1e-9?1:v,candidates=[];for(let k=0;k<6;k++){const id=config.azimuth_order[k],local=stripLocal(id,wx,y).map(snap),outside=Math.max(0,.2-local[0],local[0]-.8,.2-local[1],local[1]-.8),faceOutside=Math.max(0,-local[0],local[0]-1,-local[1],local[1]-1);candidates.push({k,id,local,outside,faceOutside});}candidates.sort((a,b)=>a.faceOutside-b.faceOutside||a.outside-b.outside||a.k-b.k);return candidates[0];};
    const strip= (id,u,v)=>stripPoint(id,u,v);
    const pixel=(id,x,y,depth)=>{const r=rects[id],u=r.left+(x+.5)/faceConfig.display_size[0]*(r.right-r.left),v=r.top+(y+.5)/faceConfig.display_size[1]*(r.bottom-r.top),stripMm=stripPoint(id,u,v);return {local:[u,v],point_mm:point(id,u,v),strip_mm:stripMm,atlas_uv:stripMm};};
    const aim=(yaw,depth)=>{const x=wrap(aimCenterX+(yaw/360)*stripLengthMm),hit=faceForStrip(x,aimY),r=rects[hit.id],rawPixelUv=[(hit.local[0]-r.left)/(r.right-r.left),(hit.local[1]-r.top)/(r.bottom-r.top)],pixel_uv=rawPixelUv.map(clamp01),pointMm=point(hit.id,hit.local[0],hit.local[1]),panelMargin=0.125;return {face:faces.findIndex(f=>f.id===hit.id),face_id:hit.id,point_mm:pointMm,local:hit.local,pixel_uv,strip_mm:[x,aimY],atlas_uv:[x,aimY],surface_available:config.enabled_faces.includes(hit.id),visible:config.enabled_faces.includes(hit.id)&&rawPixelUv.every(v=>v>=-panelMargin&&v<=1+panelMargin)};};
    const poses=seconds=>config.subjects.map(s=>[wrap(s.x_mm+s.speed_mm_s*seconds),s.y_mm]);
    const subjectAt=(x,y,depth,shown)=>{if(Array.isArray(depth)){shown=depth;depth=.1;}const scroll=stripScrollMm(depth);for(let i=0;i<shown.length;i++){const s=config.subjects[i],dx=wrapDistance(x,shown[i][0]),dy=y-(2*aimY-shown[i][1]+scroll),halfW=s.w_mm/2,halfH=s.h_mm/2;if(Math.abs(dx)>halfW||Math.abs(dy)>halfH)continue;const col=Math.floor((dx/halfW*.5+.5)*8),row=Math.floor((dy/halfH*.5+.5)*8);if(col>=0&&col<8&&row>=0&&row<8&&(config.sprite_masks[s.kind][row]&(1<<(7-col))))return i;}return -1;};
    const atlas=(id,u,v,depth)=>stripPoint(id,u,v);
    const atlasFace=(x,y,depth)=>{const hit=faceForStrip(x,y);return {face:hit.k,face_id:hit.id,local:hit.local,valid:hit.faceOutside<=1e-9};};
    const horizontalPerimeterMm=()=>stripLengthMm;
    return {config,faces,faceConfig,scene,mount,inverse,edge,point,strip,pixel,atlas,atlasFace,aim,poses,subjectAt,stripPoint,stripLocal,stripLengthMm,stripStepMm:step,stripScrollMm,backgroundScrollMm,aimHeightMm:aimY,aimPhaseDeg:90,referencePerimeterMm:stripLengthMm,wrapDistance,faceForStrip,stripFrames:faceFrames};
  }
};

function dot(a,b){return a.reduce((s,x,i)=>s+x*b[i],0);}
function mul(m,v){return m.map(row=>dot(row,v));}
function transpose(m){return m[0].map((_,i)=>m.map(row=>row[i]));}
function pointOnFace(face,u,v){return face.normal.map((n,i)=>n*.5+face.right[i]*(u-.5)+face.down[i]*(v-.5));}
if(typeof module!=='undefined')module.exports=TwinGeometry;

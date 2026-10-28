'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const TwinGeometry=require('../twin/geometry.js');
const root=path.resolve(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'config/twin.json'),'utf8'));
const faces=JSON.parse(fs.readFileSync(path.join(root,'config/faces.json'),'utf8'));
const scene=JSON.parse(fs.readFileSync(path.join(root,'config/scene.json'),'utf8'));
const rendererSource=fs.readFileSync(path.join(root,'twin/renderer.js'),'utf8');
const twinSource=fs.readFileSync(path.join(root,'twin/twin.js'),'utf8');
function make(n=6,offset=0){return TwinGeometry.create({...config,ring:{...config.ring,panels:n,reticle_azimuth_deg:offset}},faces,scene);}
function angle(x,y){return (Math.atan2(y,x)+Math.PI*2)%(Math.PI*2);}
function angularDelta(a,b){return ((a-b+Math.PI*3)%(Math.PI*2))-Math.PI;}
function coverage(g){let hits=0,total=36000;for(let i=0;i<total;i++)if(g.ringAim(i/100).onPanel)hits++;return hits/total*100;}

const six=make(6,17),four=make(4,23);
let seamGapMm;
for(const g of [six,four]) {
  let geometryGapMm;
  assert(Math.abs(g.ringLengthMm-2*Math.PI*g.ringRadius)<1e-10,'ring horizontal scale must be its physical circumference');
  assert.notEqual(g.ringLengthMm,g.stripLengthMm,'ring must not reuse the cube strip circumference');
  assert.equal(g.ringPanelWidth,config.ring.panel_active_mm,'ring panel vertical span must use the physical display width');
  const expectedGapAngle=2*Math.PI/g.ringPanels-g.ringOpeningAngle;
  for(let i=0;i<g.ringPanels;i++) {
    const right=g.ringPanel(i,1,.5),left=g.ringPanel((i+1)%g.ringPanels,0,.5);
    const actualGap=angularDelta(angle(...left.point_mm),angle(...right.point_mm));
    assert(actualGap>0,'adjacent panel edges must leave an open bezel interval');
    assert(Math.abs(actualGap-expectedGapAngle)<1e-10,'edge-to-edge bezel gap must follow the panel angles');
    const gapMm=actualGap*g.ringRadius;
    if(geometryGapMm==null)geometryGapMm=gapMm;
    assert(Math.abs(gapMm-geometryGapMm)<1e-9,'bezel arc gap must be uniform around the ring');
    if(g===six)seamGapMm=gapMm;
    const xRight=right.strip_mm[0],xLeft=left.strip_mm[0];
    const rightRoundTrip=g.ringPointAt(i,xRight,0),leftRoundTrip=g.ringPointAt((i+1)%g.ringPanels,xLeft,0);
    assert(Math.abs(rightRoundTrip.u-1)<1e-9,'ringPointAt must recover the right edge');
    assert(Math.abs(leftRoundTrip.u)<1e-9,'ringPointAt must recover the next left edge');
    for(const u of [0,.25,.5,.75,1]) {
      const p=g.ringPanel(i,u,.5),above=g.ringPanel(i,u,.25);
      assert(Number.isFinite(p.strip_mm[0])&&Number.isFinite(p.strip_mm[1]));
      assert(Math.abs(angularDelta(angle(...p.point_mm),angle(...above.point_mm)))<1e-10,'vertical motion must not change azimuth');
      assert(above.strip_mm[1]>p.strip_mm[1],'screen top must map to greater world height');
      assert(Math.abs(g.ringCanvasX(i,p.strip_mm[0],240)-u*240)<1e-9,'animal art projection must use the same atan map as the panel pixels');
    }
  }
  const offsetDegrees=angle(...g.ringPanel(0,.5,.5).point_mm.slice(0,2))*180/Math.PI;
  for(const yaw of [0,17,137.25,359.99]) {
    const hit=g.ringAim(yaw),expected=((yaw+offsetDegrees)%360+360)%360;
    assert.equal(hit.strip_mm[1],g.ringAimY,'reticle must remain on the equator');
    assert(Math.abs(hit.strip_mm[0]-expected/360*g.ringLengthMm)<1e-9,'reticle longitude must use ring circumference');
    assert.equal(hit.face,Math.floor((((yaw%360)+360)%360)/360*g.ringPanels+0.5)%g.ringPanels,'reticle highlight must match ringAim panel selection');
    const roundTrip=g.ringPointAt(hit.face,hit.strip_mm[0],g.ringAimY);
    assert(Math.abs(roundTrip.u-hit.u)<1e-9,'ringPointAt must round-trip the reticle position');
  }
}
for(const yaw of [0,90,200]) {
  const marker=six.ringMarkerPoint(yaw);
  assert.deepEqual(marker,six.ringMarkerPoint(0),'ring aim marker must stay fixed at the front as yaw changes');
}
for(const mode of [
  {name:'cube',length:six.stripLengthMm,offset:0},
  {name:'ring',length:six.ringLengthMm,offset:config.ring.reticle_azimuth_deg||0},
  {name:'sphere',length:six.ringLengthMm,offset:config.ring.reticle_azimuth_deg||0}
]) {
  for(const gate of config.gates) {
    const center=gate.u*mode.length;
    const openingFactor=mode.name==='cube'?1:0.8;
    assert.equal(six.floorSolidAt(gate,center,center,mode.length,openingFactor),0,`${mode.name} floor must be open at the gate center`);
    assert.equal(six.floorSolidAt(gate,center+gate.half_mm*2.5,center,mode.length,openingFactor),1,`${mode.name} floor must be solid beyond the opening`);
    for(let step=0;step<36000;step++) {
      const yaw=step/100,reticle=((yaw+mode.offset)/360*mode.length)%mode.length;
      const passable=six.gateOpen(gate,yaw,mode.length,mode.offset);
      if(passable)assert.equal(six.floorSolidAt(gate,reticle,center,mode.length,openingFactor),0,`${mode.name} passable gate must not be solid at yaw ${yaw}`);
    }
  }
}
const sixCoverage=coverage(six),fourCoverage=coverage(four);
assert(sixCoverage>75&&sixCoverage<90,'six-screen reticle coverage outside expected range');
assert(fourCoverage>75&&fourCoverage<95,'four-screen reticle coverage outside expected range');

const seconds=8.25,depth=.1,ringPoses=six.ringPoses(seconds),scroll=six.stripScrollMm(depth);
for(let i=0;i<config.subjects.length;i++) {
  const sub=config.subjects[i],pos=ringPoses[i],subjectY=-pos[1]+scroll;
  let found=false;
  for(let row=0;row<8&&!found;row++)for(let col=0;col<8&&!found;col++) {
    if(!(config.sprite_masks[sub.kind][row]&(1<<(7-col))))continue;
    const x=pos[0]+((col+.5)/8-.5)*sub.w_mm,y=subjectY+((row+.5)/8-.5)*sub.h_mm;
    if(six.ringSubjectAt(x,y,depth,ringPoses)===i)found=true;
  }
  assert(found,`ring subject mask must occupy the same configured subject position (${sub.name})`);
}

assert.match(twinSource,/\(!DEV_MODE\s*\?\s*'sphere'\s*:\s*'ring'\)/,'player mode must start in sphere mode');
assert.doesNotMatch(twinSource,/localStorage\.(getItem|setItem)\([^)]*shape/i,'shape must not persist between visits');
assert.match(twinSource,/\['sphere',\s*'ring',\s*'cube'\]\.includes\(asked\)/,'explicit sphere, ring, and cube query shapes must remain available');
assert.match(twinSource,/case 'KeyB':\s*setShape\(state\.shape === 'sphere' \? 'ring' : 'sphere'\)/,'B must toggle sphere and ring');
assert.match(twinSource,/label\.textContent = String\(text\)\.replace\(\/\\bthe box\\b\/gi, 'the sphere'\)/,'player hint pills must use sphere wording');
assert.match(rendererSource,/a:scale,b:0,c:0,d:-scale/,'ring sprite map must keep creatures upright without rotation');
assert.match(rendererSource,/state\.ring\|\|state\.sphere\)\?geometry\.ringPoses/,'sphere and ring must render the same ring-coordinate subject positions');
assert.match(rendererSource,/ringSubjectAt\(hit\.strip_mm\[0\],geometry\.ringAimY,state\.depth,geometry\.ringPoses/,'sphere reticle targeting must use the shared ring subject positions');
assert.match(rendererSource,/geometry\.ringAim\(state\.yaw\)\.face/,'sphere band highlight must use the ringAim panel formula');
assert.match(rendererSource,/Math\.cos\(lat\)\*Math\.cos\(a\),r\*Math\.cos\(lat\)\*Math\.sin\(a\),r\*Math\.sin\(lat\)/,'sphere equator band must occupy the XY plane around z=0');

console.log(JSON.stringify({status:'PASS',six_reticle_coverage_percent:Number(sixCoverage.toFixed(2)),four_reticle_coverage_percent:Number(fourCoverage.toFixed(2)),six_bezel_arc_gap_mm:Number(seamGapMm.toFixed(3)),floor_solid_checks:'PASS',gate_yaw_samples:36000},null,2));

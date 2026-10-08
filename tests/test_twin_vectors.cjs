/* Run with Node; tests the same pure module imported by the live browser renderer. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const math=require('../twin/geometry.js');
const ocean=require('../twin/ocean.js');
const config=read('config/twin.json'),faceConfig=read('config/faces.json'),scene=read('config/scene.json');
const g=math.create(config,faceConfig,scene),vectors=read('tests/vectors/twin_vertex_up_vectors.json');
let checks=0;
const mul=(m,v)=>m.map(row=>row.reduce((sum,x,i)=>sum+x*v[i],0));
const wrap=x=>((x%g.stripLengthMm)+g.stripLengthMm)%g.stripLengthMm;
const corners=[[0,0],[1,0],[0,1],[1,1]],distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
function near(a,b,label) {
  checks++;
  if(Array.isArray(a)) {assert.equal(a.length,b.length,label);a.forEach((x,i)=>near(x,b[i],label));}
  else assert.ok(Math.abs(a-b)<1e-9,`${label}: ${a} != ${b}`);
}
for(const n of vectors.normals) {
  const actual=mul(g.mount,g.faces.find(f=>f.id===n.face).normal);
  near(actual,n.normal,n.face);near((Math.atan2(actual[1],actual[0])*180/Math.PI+360)%360,n.azimuth,n.face);
  near(Math.asin(actual[2])*180/Math.PI,n.elevation,n.face);
}
for(const p of vectors.pixels) {
  const actual=g.pixel(p.face,p.x,p.y,p.depth);
  for(const key of ['local','point_mm','strip_mm','atlas_uv']) near(actual[key],p[key],key);
}
for(const s of vectors.seams) {
  near(g.strip(s.a,...s.uv_a),s.strip_a,'seam a');
  near(g.strip(s.b,...s.uv_b),s.strip_b,'seam b');
  near(wrap(s.strip_a[0]-s.strip_b[0]+g.stripLengthMm/2)-g.stripLengthMm/2,0,'seam x');
  near(s.strip_a[1],s.strip_b[1],'seam y');
}
for(const s of vectors.same_y) { assert.equal(s.same_y,true,`same-y ${s.a}/${s.b}`); near(s.delta_y,0,`same-y ${s.a}/${s.b}`); }
for(const face of config.azimuth_order) for(const uv of corners) near(g.strip(face,...uv)[1],g.point(face,...uv)[2]*Math.sqrt(1.5),'mounted height');
let sharedEdges=0;
for(let i=0;i<config.azimuth_order.length;i++) for(let j=i+1;j<config.azimuth_order.length;j++) {
  const a=config.azimuth_order[i],b=config.azimuth_order[j],pairs=[];
  for(const ua of corners) for(const ub of corners) if(distance(g.point(a,...ua),g.point(b,...ub))<1e-9)pairs.push([ua,ub]);
  if(pairs.length!==2)continue; sharedEdges++;
  for(const t of [.137,.5,.863]) { const ua=pairs[0][0].map((x,k)=>x*(1-t)+pairs[1][0][k]*t),ub=pairs[0][1].map((x,k)=>x*(1-t)+pairs[1][1][k]*t); near(g.strip(a,...ua)[1],g.strip(b,...ub)[1],`shared edge ${a}/${b}`); }
}
assert.equal(sharedEdges,12);
for(const p of vectors.aims) {
  const actual=g.aim(p.yaw,p.depth);
  assert.equal(actual.face_id,p.face_id,`aim yaw ${p.yaw}`);assert.equal(actual.visible,p.visible);
  for(const key of ['point_mm','local','pixel_uv','strip_mm','atlas_uv']) near(actual[key],p[key],`aim ${p.yaw} ${key}`);
}
for(let yaw=0;yaw<360;yaw++) for(const value of g.aim(yaw,.4).pixel_uv) { checks++; assert.ok(value>=0&&value<=1,`reticle uv ${yaw}`); }
for(const [yaw,face] of [[0,'px'],[120,'py'],[240,'pz']]) { const hit=g.aim(yaw,.4); assert.equal(hit.face_id,face); near(hit.pixel_uv,[.5,.5],`reticle centre ${yaw}`); }
const aimCoverage=[...Array(360).keys()].filter(y=>g.aim(y,.4).visible).length/360; assert.ok(aimCoverage>.75&&aimCoverage<.78,`reticle coverage ${aimCoverage}`);
for(const s of vectors.sprites) assert.equal(g.subjectAt(s.x_mm,s.y_mm,s.depth,g.poses(s.seconds)),s.subject);
for(const track of vectors.scroll_tracks) {
  near(track.y_depth_08-track.y_depth_01,track.delta_y,'depth scroll');
  near(track.delta_y,-(g.stripScrollMm(0.8)-g.stripScrollMm(0.1)),'depth scroll formula');
}
assert.ok(g.backgroundScrollMm(0)>g.backgroundScrollMm(0.1),'surface band moves off-panel while diving');
assert.equal(g.backgroundScrollMm(0.1),0,'surface band exit');
assert.ok(g.backgroundScrollMm(1)<g.backgroundScrollMm(0.1),'deep map drift follows the dark direction');
const upperFaces=['px','py','pz'];
const skyPixelsAt=depth=>upperFaces.reduce((total,face)=>{
  let count=0;for(let y=0;y<240;y++)for(let x=0;x<240;x++){
    const strip=g.pixel(face,x,y,depth).strip_mm;
    if(0.5-(strip[1]+g.backgroundScrollMm(depth))/g.stripLengthMm<config.depth_darkening.surface_band.threshold_v)count++;
  }
  return total+count;
},0);
assert.ok(skyPixelsAt(0)>0,'surface band is visible at 0 m');
assert.equal(skyPixelsAt(0.1),0,'surface band leaves the upper panels by 304 m');
const brightness=[];
for(const depth of [0,0.1,0.25,0.5,0.65,0.75,1]) {
  const sum=[0,0,0];let count=0;
  for(const face of upperFaces) for(let y=0;y<240;y++) for(let x=0;x<240;x++) {
    const strip=g.pixel(face,x,y,depth).strip_mm;
    const rgb=ocean.backgroundColor(strip[0],strip[1]+g.backgroundScrollMm(depth),depth,true,config.depth_darkening,g.stripLengthMm);
    for(let channel=0;channel<3;channel++)sum[channel]+=rgb[channel];
    count++;
  }
  brightness.push({depth,rgb:sum.map(value=>Number((value/count).toFixed(2)))});
}
for(let i=1;i<brightness.length;i++) for(let channel=0;channel<3;channel++)
  assert.ok(brightness[i-1].rgb[channel]>brightness[i].rgb[channel],`RGB not decreasing at depth ${brightness[i].depth}, channel ${channel}`);
const at=(depth)=>brightness.find(sample=>sample.depth===depth).rgb;
const reportPath=path.join(root,'output/luna-14/depth-rgb.json');
fs.mkdirSync(path.dirname(reportPath),{recursive:true});
fs.writeFileSync(reportPath,JSON.stringify(brightness,null,2)+'\n');
assert.deepEqual(ocean.colorAtDepth(0,config.depth_darkening),[28,154,194]);
assert.ok(at(0)[0]>=25&&at(0)[0]<=40&&at(0)[1]>=145&&at(0)[1]<=170&&at(0)[2]>=185&&at(0)[2]<=212,`surface average: ${at(0)}`);
for(const [actual,want,tolerance,label] of [
  [at(0.25),[20,100,150],[6,16,18],'760 m palette'],
  [at(0.65),[8,55,105],[3,12,14],'1976 m palette']
]) for(let channel=0;channel<3;channel++)
  assert.ok(Math.abs(actual[channel]-want[channel])<=tolerance[channel],`${label} channel ${channel}: ${actual[channel]}`);
assert.ok(at(1)[0]<=12&&at(1)[1]<=45&&at(1)[2]<=95,`3040 m palette: ${at(1)}`);
for(const crossing of vectors.crossings) near(crossing.distance_mm/Math.abs(crossing.speed_mm_s),crossing.cross_time_s,'crossing time');
for(const check of vectors.circle_checks) near(check.width_mm/check.height_mm,check.pixel_ratio,'circle ratio');
const traversal=[];
for(let k=0;k<3600;k++) {
  const x=(k+0.1)/3600*g.stripLengthMm,hit=g.atlasFace(x,g.aimHeightMm,0.1);
  if(hit.valid&&hit.face_id!==traversal.at(-1)) traversal.push(hit.face_id);
}
assert.deepEqual(traversal,['px','py','pz','px']);
near(g.poses(41.667)[0][0]-g.poses(41.666)[0][0],config.subjects[0].speed_mm_s*0.001,'time step');
const report={status:'PASS',numericAssertions:checks,normals:vectors.normals.length,pixels:vectors.pixels.length,
  seams:vectors.seams.length,sameY:vectors.same_y.length,aims:vectors.aims.length,sprites:vectors.sprites.length,faceTraversal:traversal};
fs.writeFileSync(path.join(root,'output/luna-09/js-vectors.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

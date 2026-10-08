/* Opt-in browser acceptance: /twin/index.html?acceptance=1. No board calls. */
'use strict';
(async function() {
  const results=[];
  const check=(name,fn)=>{try{fn();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',error:error.message});}};
  const assert=(ok,message)=>{if(!ok)throw new Error(message);};
  const close=(a,b)=>Math.abs(a-b)<1e-9;
  const wrappedDelta=(a,b)=>{let d=a-b;while(d>geometry.stripLengthMm/2)d-=geometry.stripLengthMm;while(d<-geometry.stripLengthMm/2)d+=geometry.stripLengthMm;return d;};
  state.paused=true;state.seconds=0;state.depth=0.1;state.yaw=0;
  check('six real simulated panels use 50 mm faces and 30 mm openings',()=>{
    assert(panels.length===6&&FACES.every(f=>f.on),'panel count');assert(faceConfig.physical_face_dimensions_mm.face_edge===50,'face size');assert(FACES.every(f=>close(f.rect.right-f.rect.left,0.6)),'30 mm opening');
  });
  check('Three.js mount keeps both diagonal vertices fixed',()=>{
    for(const yaw of [0,60,180,359]){cubeGroup.rotation.z=yaw*Math.PI/180;cubeGroup.updateMatrixWorld(true);for(const sign of [-1,1]){const p=new THREE.Vector3(sign/2,sign/2,sign/2);mountedGroup.localToWorld(p);assert(close(p.x,0)&&close(p.y,0)&&close(p.z,sign*Math.sqrt(3)/2),'vertex wobbles');}}
  });
  check('six upper/lower strip seams coincide in millimetres',()=>{
    const corners=[[0,0],[1,0],[0,1],[1,1]];
    for(let k=0;k<6;k++){const a=config.azimuth_order[k],b=config.azimuth_order[(k+1)%6],pairs=[];for(const ua of corners)for(const ub of corners){const pa=geometry.point(a,...ua),pb=geometry.point(b,...ub);if(Math.hypot(...pa.map((x,i)=>x-pb[i]))<1e-9)pairs.push([ua,ub]);}assert(pairs.length===2,'edge corners '+a+'/'+b);for(const t of [.001,.25,.5,.75,.999]){const ua=pairs[0][0].map((x,i)=>x*(1-t)+pairs[1][0][i]*t),ub=pairs[0][1].map((x,i)=>x*(1-t)+pairs[1][1][i]*t),pa=geometry.stripPoint(a,...ua),pb=geometry.stripPoint(b,...ub);assert(Math.abs(wrappedDelta(pa[0],pb[0]))<1e-9&&close(pa[1],pb[1]),'seam '+a+'/'+b);}}
  });
  check('every strip corner follows mounted world height in millimetres',()=>{
    for(const face of config.azimuth_order) for(const [u,v] of [[0,0],[1,0],[0,1],[1,1]]){const h=geometry.point(face,u,v)[2]*Math.sqrt(1.5);assert(Math.abs(geometry.stripPoint(face,u,v)[1]-h)<=.05,'height '+face+' '+u+'/'+v);}
  });
  check('upper/upper and lower/lower pairs retain common image y',()=>{
    for(const [a,b] of [['px','py'],['py','pz'],['pz','px'],['nz','nx'],['nx','ny'],['ny','nz']]){const ya=geometry.stripPoint(a,.5,.5)[1],yb=geometry.stripPoint(b,.5,.5)[1];assert(close(ya,yb),'same-y '+a+'/'+b);}
  });
  check('every displayed fish pixel matches direct strip hit-test and RGB',()=>{
    const shown=geometry.poses(state.seconds);renderPanels();panels.forEach(p=>{for(let i=0;i<p.subjects.length;i++){const s=geometry.subjectAt(p.stripX[i],p.stripY[i],state.depth,shown);assert(s===p.subjects[i],'subject mismatch');if(s>=0)assert(SUBJECTS[s].rgb.every((c,k)=>p.frame.data[i*4+k]===c),'RGB mismatch');}});
  });
  check('surface fade starts at the top of the panel',()=>{
    state.depth=.1;state.yaw=0;renderPanels();
    const top=panels[0].background[120*4+1],bottom=panels[0].background[(239*PANEL+120)*4+1];
    assert(top>bottom,'vertical fade is inverted '+top+'/'+bottom);
  });
  check('reticle is a linear y=+17.678 mm path over upper faces',()=>{
    const seen=new Set();for(let yaw=0;yaw<360;yaw++){const h=reticleHit(yaw);assert(close(h.strip_mm[1],geometry.aimHeightMm),'reticle y');assert(h.pixel_uv.every(v=>v>=0&&v<=1),'reticle uv');if(h.onPanel)seen.add(h.face_id);}assert(seen.size===3&&['px','py','pz'].every(id=>seen.has(id)),'reticle upper faces');
    for(const [yaw,face] of [[0,'px'],[120,'py'],[240,'pz']]){const h=reticleHit(yaw);assert(h.onPanel&&h.face_id===face&&close(h.u,.5)&&close(h.v,.5),'reticle centre '+yaw);}const coverage=[...Array(360).keys()].filter(y=>reticleHit(y).onPanel).length/360;assert(coverage>.75&&coverage<.78,'reticle coverage');
  });
  check('3D reticle marker is hidden when the hit is under the frame',()=>{
    state.yaw=60;updateAimMarker(reticleHit(state.yaw));assert(!aimMarker.visible,'frame marker visible');
    state.yaw=0;updateAimMarker(reticleHit(state.yaw));assert(aimMarker.visible,'panel marker hidden');
  });
  check('subjects keep their original y translation while depth changes the background',()=>{
    const d=geometry.stripScrollMm(.8)-geometry.stripScrollMm(.1);assert(d>0,'scroll');for(let i=0;i<SUBJECTS.length;i++){const near=geometry.poses(0)[i][1]-geometry.stripScrollMm(.1),far=geometry.poses(0)[i][1]-geometry.stripScrollMm(.8);assert(close(far-near,-d),'fish/background delta');}state.depth=.1;state.yaw=0;renderPanels();const before=panels[0].background.slice();state.depth=.8;renderPanels();assert(before.some((x,i)=>x!==panels[0].background[i]),'background depth');
  });
  check('upper-panel RGB darkens at every tested depth while all six creatures keep their configured positions',()=>{
    const samples=[];
    for(const depth of [0,.1,.25,.5,.65,.75,1]) {
      state.depth=depth;renderPanels();const sum=[0,0,0];let count=0;
      for(let face=0;face<FACES.length;face++) if(['px','py','pz'].includes(FACES[face].id)) {
        const data=panels[face].background;
        for(let i=0;i<PANEL*PANEL;i++) for(let channel=0;channel<3;channel++)sum[channel]+=data[i*4+channel];
        count+=PANEL*PANEL;
      }
      samples.push({depth,rgb:sum.map(value=>value/count)});
      for(let subject=0;subject<SUBJECTS.length;subject++) {
        const spec=SUBJECTS[subject],scroll=geometry.stripScrollMm(depth),pose=geometry.poses(state.seconds)[subject];
        assert(geometry.subjectAt(pose[0],spec.y_mm-scroll,depth,geometry.poses(state.seconds))===subject,'subject '+spec.id+' lost its original depth placement');
      }
    }
    for(let i=1;i<samples.length;i++) for(let channel=0;channel<3;channel++)assert(samples[i-1].rgb[channel]>samples[i].rgb[channel],'RGB channel '+channel+' did not darken at '+samples[i].depth);
    const deep=samples.at(-1).rgb;assert(deep[0]<=12&&deep[1]<=45&&deep[2]<=95,'deep average '+deep);
    state.depth=.1;renderPanels();
  });
  const key=code=>document.body.dispatchEvent(new KeyboardEvent('keydown',{code,key:code.startsWith('Numpad')?'End':code,bubbles:true,cancelable:true}));
  check('Digit and Numpad actions still scan and collect a millimetre fish',()=>{
    const fish=SUBJECTS[0],targetDepth=.1+(fish.y_mm-geometry.aimHeightMm)/(geometry.stripStepMm*2);state.depth=targetDepth;renderPanels();let fixtureYaw=null;for(let yaw=0;yaw<360&&!fixtureYaw;yaw++){const candidate=reticleHit(yaw);if(candidate.onPanel&&subjectAt(candidate.face,candidate.u,candidate.v)===0)fixtureYaw=yaw;}assert(fixtureYaw!==null,'find fish under reticle');state.yaw=fixtureYaw;renderPanels();const h=reticleHit(state.yaw);assert(subjectAt(h.face,h.u,h.v)===0,'fixture fish');
    for(const code of ['Digit1','Numpad1']){key(code);assert($('narration').textContent.includes('Surface Shoal Fish is in the reticle'),'scan '+code);}key('Numpad2');assert(state.collected.length===1,'collect');key('Digit2');assert(state.collected.length===1,'duplicate collect');for(const code of ['Digit3','Numpad3']){key(code);assert($('narration').textContent.includes('Analysis of 1 sample'),'analyze '+code);}
  });
  check('arrow controls, zones, labels, grid, and unfold remain usable',()=>{
    state.yaw=0;key('ArrowRight');assert(state.yaw===5,'right');key('ArrowLeft');assert(state.yaw===0,'left');setDepth(.1);key('ArrowDown');assert(close(state.depth,.12),'depth down');key('ArrowUp');assert(close(state.depth,.1),'depth up');setDepth(.29);assert(state.zone==='mid','mid');setDepth(.69);assert(state.zone==='deep','deep');setDepth(.64);assert(state.zone==='deep','hysteresis');setDepth(.61);assert(state.zone==='mid','mid return');
    $('btn-labels').click();assert(!state.labels,'labels');$('btn-labels').click();$('btn-grid').click();assert(!state.grid,'grid');$('btn-grid').click();$('btn-unfold').click();assert(state.unfold&&!$('unfold-view').hidden,'unfold');$('btn-unfold').click();assert(document.querySelector('.twin-banner').textContent.includes('DIGITAL TWIN — SIMULATED PANELS, NO BOARD ATTACHED'),'banner');
  });
  state.depth=.1;state.yaw=0;state.seconds=0;state.collected=[];state.zone='surface';$('discovery-popup').classList.remove('show');
  const pre=document.createElement('pre');pre.id='acceptance-results';pre.style.cssText='position:fixed;left:12px;top:86px;width:min(430px,calc(100vw - 24px));max-height:38vh;overflow:auto;overflow-wrap:anywhere;white-space:pre-wrap;z-index:300;background:rgba(6,21,31,.9);color:#d9e8ea;padding:10px;font:12px/1.4 monospace;pointer-events:none;border:1px solid #28505d;border-radius:6px';document.body.appendChild(pre);
  const showReport=()=>{pre.textContent=JSON.stringify({status:results.every(r=>r.status==='PASS')?'PASS':'FAIL',results},null,2);};showReport();
  $('btn-start').addEventListener('click',()=>{
    const nameKeys=['shoal','reef','manta','jelly','lantern','seahorse'];
    check('English analysis and all six animal-name files exist',()=>{
      assert(audio.manifest.voice.vo_analyze.en,'analysis voice');
      assert(nameKeys.every(key=>audio.manifest.voice_names[key]),'missing animal-name file');
    });
    const analyzeAfterStart = () => {
      if (!state.started || state.starting) { window.setTimeout(analyzeAfterStart,100); return; }
      state.collected=SUBJECTS.map((subject,index)=>({id:subject.id,depth:.1+index*.03,face:FACES[index].id}));
      updateHUD(reticleHit(state.yaw));
      audio.recent=[];
      doAnalyze();
      const expected=['vo_analyze',...nameKeys.map(key=>'vo_name_'+key)];
      const startedAt=Date.now();
      const checkSequence = () => {
        const events=audio.recent.filter(entry=>expected.includes(entry.cueId)).reverse();
        if (events.length < expected.length && Date.now()-startedAt < 60000) {
          window.setTimeout(checkSequence,250);
          return;
        }
        check('Analyze plays each animal-name clip in tray order',()=>{
          assert(JSON.stringify(events.map(entry=>entry.cueId))===JSON.stringify(expected),'voice sequence '+events.map(entry=>entry.cueId).join(', '));
          assert(events.every(entry=>entry.source==='file'),'analysis or name clip was not a file');
        });
        showReport();
      };
      window.setTimeout(checkSequence,750);
      showReport();
    };
    window.setTimeout(analyzeAfterStart,0);
  },{once:true});
})();

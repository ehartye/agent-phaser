// Run: node phaser-verification-causal-pixels.mjs <host> [--mutation <control>]
// Requires phaser@4.2.1, Playwright and hardware Chromium. CHROME_CHANNEL defaults to chromium.
// A bounded fixture, not a renderer package or a full-game paint certificate.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {gpuArgs,SOFTWARE_RENDERER} from '../verify-checks.mjs';

const controls=['matching-underlay','camera-drift','source-mismatch','render-dispatch','restoration'];
const [host,...args]=process.argv.slice(2);
const mutation=args.length===2&&args[0]==='--mutation'?args[1]:null;
const evidence=await mkdtemp(join(tmpdir(),'phaser-causal-evidence-'));
const report={version:1,probe:'causal-pixels',evidence,passed:false,runs:[],unsupported:[],errors:[],cleanup:{},mutation};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let browser,context,page;
try {
  assert(host&&(!args.length||controls.includes(mutation)),'Usage: node phaser-verification-causal-pixels.mjs <host> [--mutation matching-underlay|camera-drift|source-mismatch|render-dispatch|restoration]');
  const require=createRequire(join(resolve(host),'package.json'));
  assert.equal(require('phaser/package.json').version,'4.2.1','requires phaser@4.2.1');
  const {chromium}=require('@playwright/test');
  const fixture=JSON.parse(await readFile(new URL('./fixtures/causal-pixels/fixture.json',import.meta.url),'utf8'));
  const fixturePng=await readFile(new URL('./fixtures/causal-pixels/fixture.png',import.meta.url));
  assert.equal(hash(fixturePng),fixture.pngSha256,'committed PNG identity');
  assert.equal(hash(Buffer.from(fixture.rgba)),fixture.rgbaSha256,'independent committed RGBA identity');
  report.fixture={id:fixture.id,pngSha256:fixture.pngSha256,rgbaSha256:fixture.rgbaSha256,width:fixture.width,height:fixture.height};
  report.sources={probeSha256:hash(await readFile(new URL(import.meta.url))),phaserSha256:hash(await readFile(require.resolve('phaser')))};
  await writeFile(join(evidence,'fixture.png'),fixturePng);
  await writeFile(join(evidence,'fixture.json'),JSON.stringify(fixture,null,2));
  browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chromium',args:gpuArgs(),timeout:20000});
  report.browser=browser.version();
  context=await browser.newContext({viewport:{width:80,height:64},deviceScaleFactor:1});
  page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.setContent('<!doctype html><style>html,body{margin:0;padding:0;overflow:hidden}canvas{display:block}</style>');
  await page.addScriptTag({path:require.resolve('phaser')});
  await page.evaluate(async ({fixture,png})=>{
    const bounded=async(promise,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),5000);})]);}finally{clearTimeout(timer);}};
    const canvas=document.createElement('canvas');
    const decode=async image=>{
      await bounded(image.decode(),'image decode');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);
      return Array.from(ctx.getImageData(0,0,canvas.width,canvas.height).data);
    };
    const dataBytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
    const blobUrl=URL.createObjectURL(new Blob([dataBytes],{type:'image/png'}));
    const loaded=new Image();loaded.src=blobUrl;await bounded(loaded.decode(),'fixture decode');URL.revokeObjectURL(blobUrl);
    const decoded=await decode(loaded); // Read the retained HTMLImageElement after revocation; never fetch its revoked URL.
    const altered=new Image();canvas.width=fixture.width;canvas.height=fixture.height;
    const ctx=canvas.getContext('2d');ctx.putImageData(new ImageData(new Uint8ClampedArray(fixture.rgba),fixture.width,fixture.height),0,0);
    ctx.fillStyle='#ffffff';ctx.fillRect(1,1,1,1);altered.src=canvas.toDataURL();await bounded(altered.decode(),'altered fixture');
    let game,scene;
    await bounded(new Promise(done=>{
      game=new Phaser.Game({type:Phaser.WEBGL,width:80,height:64,pixelArt:true,backgroundColor:'#101820',audio:{noAudio:true},banner:false,
        scene:{create(){scene=this;this.textures.addImage('fixture',loaded);this.textures.addImage('altered',altered);done();}}});
    }),'Phaser boot');
    await bounded(new Promise(done=>game.events.once(Phaser.Core.Events.POST_RENDER,done)),'first completed frame');
    game.loop.sleep();
    const camera=scene.cameras.main,underlay=scene.add.image(24,20,'fixture').setOrigin(0).setScale(2).setVisible(false);
    const owner=scene.add.image(24,20,'fixture').setOrigin(0).setScale(2).setName('causal-owner');
    // The stable background marker makes camera drift observable outside the owner mask.
    scene.add.rectangle(6,6,4,4,0xffffff).setOrigin(0);
    const nativeStep=owner._renderSteps[0];
    let dispatch=[],frame=0,currentEffect=null,baseline=null,custom=null;
    const witnessedStep=(...a)=>{const value=nativeStep(...a);dispatch.push({owner:a[1].name,sameOwner:a[1]===owner,cameraId:a[2].camera.id,parentMatrix:!!a[3],step:a[4]});return value;};
    owner._renderSteps[0]=witnessedStep;
    const filterState=list=>list.list.map(f=>({node:f.renderNode,active:f.active,matrix:f.colorMatrix?Array.from(f.colorMatrix._matrix):null,alpha:f.colorMatrix?.alpha??null}));
    const state=()=>({owner:{name:owner.name,texture:owner.texture.key,frame:owner.frame.name,x:owner.x,y:owner.y,scaleX:owner.scaleX,scaleY:owner.scaleY,originX:owner.originX,originY:owner.originY,rotation:owner.rotation,alpha:owner.alpha,depth:owner.depth,flipX:owner.flipX,flipY:owner.flipY,parent:owner.parentContainer?.type??null},camera:{id:camera.id,x:camera.x,y:camera.y,width:camera.width,height:camera.height,scrollX:camera.scrollX,scrollY:camera.scrollY,zoomX:camera.zoomX,zoomY:camera.zoomY,rotation:camera.rotation,alpha:camera.alpha,roundPixels:camera.roundPixels,filtersInternal:filterState(camera.filters.internal),filtersExternal:filterState(camera.filters.external)},scene:{active:scene.sys.isActive(),visible:scene.sys.isVisible(),children:scene.children.list.map(x=>x.name||x.type)},canvas:{width:game.canvas.width,height:game.canvas.height,dpr:devicePixelRatio,rect:JSON.parse(JSON.stringify(game.canvas.getBoundingClientRect()))},loopRunning:game.loop.running});
    const eligibility=()=>{
      if(owner.parentContainer)return {supported:false,reason:'unresolved-render-target-to-final-canvas'};
      const filters=[...camera.filters.internal.list,...camera.filters.external.list].filter(f=>f.active);
      if(filters.some(f=>f.renderNode==='FilterBlur'))return {supported:false,reason:'active-spatial-filter'};
      if(filters.length!==(currentEffect?1:0)||filters.some(f=>f!==currentEffect)||camera.filters.external.list.length)return {supported:false,reason:'unsupported-effect-state'};
      if(currentEffect&&JSON.stringify(Array.from(currentEffect.colorMatrix._matrix))!==JSON.stringify(baseline?.camera.filtersInternal[0].matrix))return {supported:false,reason:'unsupported-effect-state'};
      if(scene.cameras.cameras.length!==1||camera.rotation!==0||camera.zoomX!==1||camera.zoomY!==1||camera.alpha!==1||camera.width!==80||camera.height!==64||camera.x!==0||camera.y!==0||owner.rotation!==0||owner.scaleX!==2||owner.scaleY!==2||owner.alpha!==1||owner.flipX||owner.flipY||owner.filters||Object.keys(owner.customRenderNodes).length)return {supported:false,reason:'unsupported-camera-or-owner-state'};
      return {supported:true,mapping:{x:24,y:20,scale:2,width:80,height:64,dpr:1}};
    };
    const restore=()=>{owner.setVisible(true).setPosition(24,20).setTexture('fixture');underlay.setVisible(false);camera.setScroll(0,0).setRotation(0).setZoom(1);owner._renderSteps[0]=witnessedStep;};
    const start=async(effect,control)=>{
      restore();camera.filters.internal.clear();camera.filters.external.clear();currentEffect=null;
      if(effect==='color-matrix'){currentEffect=camera.filters.internal.addColorMatrix();currentEffect.colorMatrix.grayscale(1);}
      baseline=state();
      if(control==='source-mismatch')owner.setTexture('altered');
      if(control==='matching-underlay'){underlay.setVisible(true);owner.setVisible(false);}
      if(control==='render-dispatch')owner._renderSteps[0]=()=>{};
      return {baseline,eligibility:eligibility(),source:{decoded:await decode(owner.texture.getSourceImage()),revoked:owner.texture.key==='fixture',width:owner.texture.getSourceImage().naturalWidth,height:owner.texture.getSourceImage().naturalHeight},actualState:state(),control,effect};
    };
    const capture=(phase,control)=>{
      owner.setVisible(phase!=='hidden'&&control!=='matching-underlay');
      if(control==='camera-drift'&&phase==='hidden')camera.scrollX=1;
      if(control==='restoration'&&phase==='restored')owner.x+=2;
      dispatch=[];let completed=0;const complete=()=>completed++;game.events.once(Phaser.Core.Events.POST_RENDER,complete);
      game.step(1000,0);game.events.off(Phaser.Core.Events.POST_RENDER,complete);frame++;
      return {phase,frame,heldTime:1000,delta:0,completed,dispatch:dispatch.slice(),visible:owner.visible,state:state()};
    };
    const cleanupCase=()=>{restore();const restored=state();return {restored,exact:JSON.stringify(restored)===JSON.stringify(baseline),nativeDispatchRestored:owner._renderSteps[0]===witnessedStep,visibilityRestored:owner.visible&&!underlay.visible};};
    const unsupported=()=>{
      const out=[];restore();camera.filters.internal.clear();currentEffect=null;baseline=state();
      const blur=camera.filters.internal.addBlur();out.push({case:'spatial-filter',actual:filterState(camera.filters.internal),...eligibility()});camera.filters.internal.remove(blur);
      const ownerIndex=scene.children.getIndex(owner);
      custom=scene.add.customcontext(0,0,[owner]);out.push({case:'unresolved-render-target',parentType:owner.parentContainer?.type,...eligibility()});custom.remove(owner);scene.children.add(owner);custom.destroy();custom=null;scene.children.moveTo(owner,ownerIndex);
      camera.rotation=0.1;out.push({case:'camera-rotation',rotation:camera.rotation,...eligibility()});camera.rotation=0;
      const sepia=camera.filters.internal.addColorMatrix();sepia.colorMatrix.sepia();out.push({case:'undeclared-effect',actual:filterState(camera.filters.internal),...eligibility()});camera.filters.internal.remove(sepia);
      return {cases:out,cleanup:{exact:JSON.stringify(state())===JSON.stringify(baseline),before:baseline,after:state()}};
    };
    const gl=game.renderer.gl,debug=gl.getExtension('WEBGL_debug_renderer_info');
    window.causal={start,capture,cleanupCase,unsupported,decode,metadata:{version:Phaser.VERSION,rendererClass:game.renderer.constructor.name,renderer:gl.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:gl.RENDERER),decoded,revoked:true,nativeStepName:nativeStep.name},
      async dispose(){owner._renderSteps[0]=nativeStep;const dispatchRestored=owner._renderSteps[0]===nativeStep;canvas.width=canvas.height=0;loaded.src='';altered.src='';camera.filters.internal.clear();camera.filters.external.clear();game.destroy(true);game.runDestroy();return {dispatchRestored,decodeCanvasReleased:canvas.width===0&&canvas.height===0,rendererReleased:game.renderer.gl===null&&game.renderer.canvas===null,canvasRemoved:!document.querySelector('canvas')};}};
  },{fixture,png:fixturePng.toString('base64')});
  const metadata=await page.evaluate(()=>causal.metadata);
  report.runtime={...metadata,decoded:undefined};
  report.initialDecodedSha256=hash(Buffer.from(metadata.decoded));
  assert.equal(metadata.version,'4.2.1');assert.doesNotMatch(metadata.renderer,SOFTWARE_RENDERER,'Hardware renderer required; software is unverified');
  assert.equal(report.initialDecodedSha256,fixture.rgbaSha256,'Decoded source after blob revocation');

  const cases=mutation?[['unfiltered',mutation]]:[['unfiltered',null],['color-matrix',null],...controls.map(control=>['unfiltered',control])];
  for(const [effect,control] of cases){
    const name=control??effect,folder=join(evidence,name);await mkdir(folder);
    const run={name,effect,control,frames:[],failures:[],artifacts:{}};report.runs.push(run);
    try {
      const initial=await page.evaluate(({effect,control})=>causal.start(effect,control),{effect,control});
      run.baseline=initial.baseline;run.eligibility=initial.eligibility;run.source={...initial.source,decoded:undefined,rgbaSha256:hash(Buffer.from(initial.source.decoded)),fixtureRgbaSha256:fixture.rgbaSha256};
      await writeFile(join(folder,'loaded-source.rgba'),Buffer.from(initial.source.decoded));
      const mask=Buffer.alloc(80*64);
      for(let y=0;y<fixture.height;y++)for(let x=0;x<fixture.width;x++)if(fixture.rgba[(y*fixture.width+x)*4+3])for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)mask[(20+y*2+dy)*80+24+x*2+dx]=255;
      await writeFile(join(folder,'opacity-mask.bin'),mask);
      const maskPng=await page.evaluate(values=>{const c=document.createElement('canvas');c.width=80;c.height=64;const ctx=c.getContext('2d');const pixels=new Uint8ClampedArray(80*64*4);for(let i=0;i<values.length;i++)pixels.set([values[i],values[i],values[i],255],i*4);ctx.putImageData(new ImageData(pixels,80,64),0,0);const png=c.toDataURL().split(',')[1];c.width=c.height=0;return png;},Array.from(mask));
      await writeFile(join(folder,'opacity-mask.png'),Buffer.from(maskPng,'base64'));run.maskSha256=hash(mask);
      const pixels=[];
      for(const phase of ['shown','hidden','restored']){
        const frame=await page.evaluate(({phase,control})=>causal.capture(phase,control),{phase,control});run.frames.push(frame);
        const png=await page.screenshot({type:'png',timeout:10000});await writeFile(join(folder,phase+'.png'),png);run.artifacts[phase]={file:phase+'.png',sha256:hash(png)};
        const rgba=await page.evaluate(async png=>{const image=new Image();image.src='data:image/png;base64,'+png;return causal.decode(image);},png.toString('base64'));
        pixels.push(rgba);frame.rgbaSha256=hash(Buffer.from(rgba));
      }
      let inside=0,outside=0,restoration=0,strictMismatches=0;
      for(let i=0;i<80*64;i++){
        const changed=pixels[0].slice(i*4,i*4+4).some((v,k)=>v!==pixels[1][i*4+k]);if(changed){if(mask[i])inside++;else outside++;}
        if(pixels[0].slice(i*4,i*4+4).some((v,k)=>v!==pixels[2][i*4+k]))restoration++;
        if(mask[i]){const x=Math.floor((i%80-24)/2),y=Math.floor((Math.floor(i/80)-20)/2),source=(y*fixture.width+x)*4;if(pixels[0].slice(i*4,i*4+4).some((v,k)=>v!==fixture.rgba[source+k]))strictMismatches++;}
      }
      run.comparison={insideChanged:inside,outsideChanged:outside,restorationChanged:restoration,strictRawSourceMismatches:strictMismatches,maskPixels:mask.filter(x=>x).length};
      const requireWitness=(condition,witness)=>{if(!condition)run.failures.push(witness);};
      requireWitness(run.eligibility.supported,'supported-mapping');
      requireWitness(run.source.rgbaSha256===fixture.rgbaSha256,'source-authentication');
      requireWitness(inside>0,'nonempty-contribution');requireWitness(outside===0,'mask-confinement');requireWitness(restoration===0,'exact-restoration');
      requireWitness(run.frames.every(f=>JSON.stringify(f.state)===JSON.stringify(run.baseline)),'held-state');
      requireWitness(run.frames.every(f=>f.completed===1),'completed-frame');
      requireWitness(run.frames.every(f=>f.dispatch.length===(f.phase==='hidden'?0:1)&&f.dispatch.every(d=>d.sameOwner&&d.owner==='causal-owner'&&d.cameraId===run.baseline.camera.id&&!d.parentMatrix)),'native-render-dispatch');
      if(effect==='unfiltered')requireWitness(strictMismatches===0,'strict-raw-source');
      else requireWitness(strictMismatches>0,'effect-is-observable');
    } finally {
      run.cleanup=await page.evaluate(()=>causal.cleanupCase());
      if(!run.cleanup.exact||!run.cleanup.nativeDispatchRestored||!run.cleanup.visibilityRestored)run.failures.push('owned-state-cleanup');
      // Persist all measurements before an assertion may abort, including adverse controls.
      await writeFile(join(folder,'result.json'),JSON.stringify(run,null,2));
    }
    if(mutation)assert.deepEqual(run.failures,[],`${mutation}: ${run.failures.join(', ')}`);
    else if(control){const expected={'matching-underlay':'nonempty-contribution','camera-drift':'held-state','source-mismatch':'source-authentication','render-dispatch':'native-render-dispatch',restoration:'exact-restoration'}[control];assert(run.failures.includes(expected),`${control} escaped ${expected}`);assert(!run.failures.includes('owned-state-cleanup'),'adverse cleanup failed');run.expectedFailure=expected;}
    else assert.deepEqual(run.failures,[],`${name} positive witnesses`);
  }
  const unsupported=await page.evaluate(()=>causal.unsupported());report.unsupported=unsupported.cases;report.cleanup.unsupported=unsupported.cleanup;
  assert.equal(unsupported.cleanup.exact,true,'unsupported controls restore exact owned state');
  for(const result of report.unsupported)assert.equal(result.supported,false,`${result.case} must remain unsupported`);
  assert.deepEqual(report.errors,[],'browser errors');report.passed=true;
} catch(error){report.failure={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally {
  if(page)try{report.cleanup.scene=await page.evaluate(()=>window.causal?.dispose());}catch(error){report.cleanup.sceneError=error.message;report.passed=false;process.exitCode=1;}
  if(context)try{await context.close();report.cleanup.contextClosed=true;}catch(error){report.cleanup.contextError=error.message;report.passed=false;process.exitCode=1;}
  if(browser)try{await browser.close();report.cleanup.browserClosed=!browser.isConnected();}catch(error){report.cleanup.browserError=error.message;report.passed=false;process.exitCode=1;}
  if(report.cleanup.scene&&Object.values(report.cleanup.scene).some(value=>value!==true)){report.passed=false;report.failure??={message:'capture resource cleanup failed'};process.exitCode=1;}
  await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}

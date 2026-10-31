// Run: node phaser-native-control-observation.mjs <host> [--output <directory>] [--mutation receiver|revision]
// Phaser 4.2.1 Canvas input witnesses, not paint, hardware, or consumer-adoption proof.
// The host supplies Phaser and Playwright. Reports, screenshots and traces survive failed assertions.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const [host,...args]=process.argv.slice(2);
let output,mutation;
for(let i=0;i<args.length;i++){
  if(args[i]==='--output' && args[i+1])output=resolve(args[++i]);
  else if(args[i]==='--mutation' && ['receiver','revision'].includes(args[i+1]))mutation=args[++i];
  else throw new Error('Usage: node phaser-native-control-observation.mjs <host> [--output <directory>] [--mutation receiver|revision]');
}
assert.ok(host,'A host project directory is required');
const require=createRequire(join(resolve(host),'package.json'));
const manifest=require('phaser/package.json');
assert.equal(manifest.version,'4.2.1','requires phaser@4.2.1');
const pw=['@playwright/test','playwright','playwright-core'].map(name=>{try{return require(name);}catch{return null;}}).find(Boolean);
assert.ok(pw,'host must supply Playwright');
const routes=new Map();
routes.set('/phaser.js',await readFile(require.resolve('phaser')));
for(const name of ['control-observation.mjs','control-observation-fixture.mjs'])routes.set('/'+name,await readFile(new URL('../harness/'+name,import.meta.url)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={version:1,phaser:manifest.version,probeSha256:hash(await readFile(new URL(import.meta.url))),sources:Object.fromEntries([...routes].map(([name,bytes])=>[name,hash(bytes)])),mutation:mutation??null,runs:[],passed:false,limitations:['Canvas synthetic fixture with real browser input; no GPU or authored-paint certification','Two layouts are not independent consumer adoption','Only declared axis-aligned mappings and fixture occlusion are supported']};
const evidence=output??await mkdtemp(join(tmpdir(),'phaser-control-evidence-'));
await mkdir(evidence,{recursive:true});report.evidence=resolve(evidence);
const server=createServer((request,response)=>{
  if(request.url==='/'){
    response.setHeader('content-type','text/html');response.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><body style="margin:0"><script src="/phaser.js"></script></body>');
  }else if(routes.has(request.url)){response.setHeader('content-type','text/javascript');response.end(routes.get(request.url));}
  else{response.statusCode=404;response.end();}
});
let browser,page,context,run;
try{
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  browser=await pw.chromium.launch({channel:process.env.CHROME_CHANNEL||undefined,timeout:20000});report.browser=browser.version();
  for(const [layout,dpr] of [['wide',1],['stacked',1.5]]){
    run={layout,dpr,observations:[],actions:[],negatives:[],console:[],errors:[]};report.runs.push(run);
    context=await browser.newContext({viewport:{width:760,height:560},deviceScaleFactor:dpr});
    await context.tracing.start({screenshots:true,snapshots:true,sources:true});
    page=await context.newPage();page.setDefaultTimeout(10000);
    page.on('pageerror',error=>run.errors.push(error.message));
    page.on('console',message=>{if(['error','warning'].includes(message.type()))run.console.push(message.text());});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async layout=>{const {createControlObservationFixture}=await import('/control-observation-fixture.mjs');window.fixture=await createControlObservationFixture({layout});},layout);
    const observe=async(id,expected)=>{
      const descriptor=await page.evaluate(({id,expected})=>window.fixture.observe(id,expected),{id,expected});run.observations.push(descriptor);return descriptor;
    };
    const state=()=>page.evaluate(()=>window.fixture.snapshot());
    const nativePress=async(id,{field=false,cached}={})=>{
      const descriptor=cached??await observe(id);assert.equal(descriptor.eligible,true,`${id}: ${descriptor.reason}`);
      // Revalidate publication immediately before dispatch. Never fall back to a semantic action.
      const current=await observe(id,{owner:descriptor.owner,revision:descriptor.revision});
      assert.equal(current.eligible,true,`${id}: observation invalidated: ${current.reason}`);
      const before=await state(),{x,y,width,height}=descriptor.bounds;
      await page.mouse.click(x+width/2,y+height/2);
      if(field)await page.keyboard.type('x');
      await page.waitForFunction(({id,n})=>window.fixture.snapshot().events.filter(event=>event.id===id&&['activate','change'].includes(event.type)).length>n,{id,n:before.events.filter(event=>event.id===id&&['activate','change'].includes(event.type)).length});
      const after=await state(),events=after.events.filter(event=>event.sequence>(before.events.at(-1)?.sequence??0));
      run.actions.push({id,descriptor,events,after});
      const activations=events.filter(event=>event.id===id&&event.type===(field?'change':'activate'));
      assert.equal(activations.length,1,`${id}: exactly one original handler`);
      assert.equal(activations[0].receiver,descriptor.receiverId,`${id}: actual native receiver differs`);
      assert.equal(activations[0].revision,descriptor.revision,`${id}: handler revision differs`);
      return after;
    };
    const initial=await state();run.initial=initial;assert.equal(initial.renderer,'CanvasRenderer');
    if(mutation){
      const cached=await observe('chrome');
      await page.evaluate(mode=>mode==='receiver'?window.fixture.mutateReceiver('chrome'):window.fixture.revise(),mutation);
      await nativePress('chrome',{cached});
      // If a mutation escapes its real assertion, return success so the adverse
      // subprocess's expected nonzero exit cannot be satisfied by a sentinel failure.
      report.mutationEscaped=true;
      break;
    }
    const chrome=await observe('chrome');await nativePress('chrome');
    await nativePress('row');await page.evaluate(()=>window.fixture.scroll(8));
    assert.deepEqual((await observe('chrome')).bounds,chrome.bounds,'fixed chrome does not scroll');
    await nativePress('row');
    assert.equal((await nativePress('disclosure')).expanded,true);
    await nativePress('field',{field:true});
    assert.equal((await nativePress('pager')).page,1,'native-local pager original handler advances once');
    const density=await observe('density');assert.equal(density.sourcePixelPhysicalSize,3*dpr);await nativePress('density');
    await page.evaluate(()=>window.fixture.resize());
    const resized=await observe('density');assert.notDeepEqual(resized.bounds,density.bounds);assert.notEqual(resized.revision,density.revision);assert.equal(resized.sourcePixelPhysicalSize,3*dpr);await nativePress('density');
    async function refused(id,reason,expected){
      const before=(await state()).events.length,descriptor=await observe(id,expected);
      run.negatives.push({id,reason,descriptor});assert.equal(descriptor.eligible,false);assert.equal(descriptor.reason,reason);
      assert.equal((await state()).events.length,before,'eligibility refusal invokes no handler');
    }
    await refused('absent','absent');
    await page.evaluate(()=>window.fixture.setEnabled('chrome',false));await refused('chrome','disabled');await page.evaluate(()=>window.fixture.setEnabled('chrome',true));
    await page.evaluate(()=>window.fixture.setPublished('chrome',false));await refused('chrome','unpublished');await page.evaluate(()=>window.fixture.setPublished('chrome',true));
    await page.evaluate(()=>window.fixture.setUnsupported('chrome',true));await refused('chrome','unsupported');await page.evaluate(()=>window.fixture.setUnsupported('chrome',false));
    await page.evaluate(()=>window.fixture.setOcclusionKnown('chrome',false));await refused('chrome','unsupported');await page.evaluate(()=>window.fixture.setOcclusionKnown('chrome',true));
    await page.evaluate(()=>window.fixture.setOccluded('chrome',true));await refused('chrome','occluded');await page.evaluate(()=>window.fixture.setOccluded('chrome',false));
    await page.evaluate(()=>window.fixture.scroll(120));await refused('row','clipped');await page.evaluate(()=>window.fixture.scroll(0));
    await refused('chrome','stale-owner',{owner:'retired-owner'});
    const stale=await observe('chrome');await page.evaluate(()=>window.fixture.revise());await refused('chrome','stale-revision',{revision:stale.revision});
    const hold=await observe('chrome'),beforeCancel=await state();await page.mouse.move(hold.bounds.x+5,hold.bounds.y+5);await page.mouse.down();
    await page.evaluate(()=>window.fixture.revise());await page.mouse.up();
    const cancelled=(await state()).events.filter(event=>event.sequence>(beforeCancel.events.at(-1)?.sequence??0));run.cancellation=cancelled;
    assert.equal(cancelled.filter(event=>event.type==='cancel').length,1);assert.equal(cancelled.filter(event=>event.type==='activate').length,0);
    await page.screenshot({path:join(evidence,`${layout}.png`)});
    const held=await observe('chrome');await page.mouse.move(held.bounds.x+5,held.bounds.y+5);await page.mouse.down();
    await page.evaluate(()=>{window.fixture.dispose();window.fixture.dispose();});await page.mouse.up();
    run.disposal=await state();assert.equal(run.disposal.disposed,true);assert.equal(run.disposal.events.filter(event=>event.type==='dispose').length,1);
    await refused('chrome','stale-owner');assert.equal(await page.locator('canvas').count(),0);
    assert.deepEqual(run.errors,[]);assert.deepEqual(run.console,[]);
    await context.tracing.stop({path:join(evidence,`${layout}.trace.zip`)});await context.close();context=null;page=null;
  }
  report.passed=true;
}catch(error){
  report.failure={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;
  if(page){
    try{run.failureState=await page.evaluate(()=>window.fixture?.snapshot());}catch(captureError){report.stateCaptureError=captureError.message;}
    try{await page.screenshot({path:join(evidence,'failure.png')});}catch(captureError){report.screenshotError=captureError.message;}
  }
}finally{
  // Publish the failure facts before cleanup can destroy the native receivers.
  await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');
  if(context){try{await context.tracing.stop({path:join(evidence,'failure.trace.zip')});}catch(error){report.traceError=error.message;}await context.close();}
  await browser?.close();await new Promise(done=>server.close(done));
  await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));

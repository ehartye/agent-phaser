// Run: node audio-visibility.mjs <Playwright project> <pristine Phaser> <patched Phaser> <new evidence directory>
// Isolated packages only; the host project's dependency and game are read-only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

assert.equal(process.argv.length,6,'Expected Playwright project, pristine package, patched package and new evidence directory');
const [project,pristine,patched,evidence]=process.argv.slice(2).map(value=>resolve(value));
await mkdir(evidence); // Refuse to overwrite a prior attempt.
const {chromium}=createRequire(join(project,'package.json'))('@playwright/test');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const targets=['src/sound/webaudio/WebAudioSoundManager.js','dist/phaser.esm.js','dist/phaser.js'];
const sources=[fileURLToPath(import.meta.url),join(root,'skills/engine-phaser/scripts/assets/phaser-audio-visibility-patch.mjs'),
  join(root,'tests/phaser-audio-visibility.test.mjs'),join(root,'tests/fixtures/phaser-audio-visible-4.2.1.txt'),
  ...[pristine,patched].flatMap(directory=>[join(directory,'package.json'),...targets.map(file=>join(directory,file))])];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async file=>[file,sha(await readFile(file))])));
const inventory=()=>process.platform==='win32'?JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',
  '@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name) | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true})):[];
const descendants=(processes,parent)=>{
  const ids=new Set([parent]);
  for(let changed=true;changed;){changed=false;for(const item of processes)if(ids.has(item.ParentProcessId)&&!ids.has(item.ProcessId)){ids.add(item.ProcessId);changed=true;}}
  return [...ids].filter(id=>id!==parent);
};
const bundles={};
for(const [phase,directory] of [['baseline',pristine],['patched',patched]]){
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  assert.equal(manifest.name,'phaser');assert.equal(manifest.version,'4.2.1');
  bundles[`/${phase}.js`]=await readFile(join(directory,'dist/phaser.esm.js'));
}
// This script boots outside Playwright evaluation. Only genuine keyboard input unlocks native audio.
const body=`import Phaser from '/PHASE.js';
const kind='KIND',calls=[],rejections=[],contexts=[];
window.probe={kind,calls,rejections,trusted:[],version:Phaser.VERSION};
window.addEventListener('unhandledrejection',event=>rejections.push({name:event.reason?.name,message:event.reason?.message,time:performance.now()}));
function observe(context,id){
  contexts.push(context);
  for(const method of ['suspend','resume','close']){const original=context[method].bind(context);context[method]=function(){calls.push({id,method,state:context.state,time:performance.now(),stack:new Error().stack});return original();};}
  return context;
}
let game;
window.addEventListener('keydown',event=>{
  if(!event.isTrusted)return;
  window.probe.trusted.push({key:event.code,time:performance.now()});
  if(event.code==='Enter'){
    window.probe.unlockGesture=true;
    if(kind==='borrowed'&&!game){window.probe.borrowedCreatedByTrustedGesture=true;boot(observe(new AudioContext(),'captured'));}
  }
});
function boot(borrowed){
game=new Phaser.Game({type:Phaser.WEBGL,width:400,height:300,banner:false,audio:borrowed?{context:borrowed}:{},scene:{create(){
  const manager=this.sound,context=borrowed||observe(manager.context,'captured');
  const gl=game.renderer.gl,extension=gl.getExtension('WEBGL_debug_renderer_info');
  Object.assign(window.probe,{nativeWebAudio:manager instanceof Phaser.Sound.WebAudioSoundManager,
    renderer:{version:gl.getParameter(gl.VERSION),renderer:gl.getParameter(extension?extension.UNMASKED_RENDERER_WEBGL:gl.RENDERER)},
    beforeGesture:{state:context.state,locked:manager.locked},ready:true});
  window.addEventListener('keydown',event=>{
    if(!event.isTrusted)return;
    if(event.code!=='Space')return;
    Object.assign(window.probe,{beforeVisible:{state:context.state,locked:manager.locked},visibleAt:performance.now()});
    game.events.emit(Phaser.Core.Events.VISIBLE);
    if(kind==='destroy'||kind==='borrowed')game.destroy(true);
    if(kind==='replacement'){const replacement=observe(new AudioContext(),'replacement');manager.setAudioContext(replacement);window.probe.replacedAt=performance.now();}
    // Wait beyond the native callback and asynchronous rejection delivery before attaching final evidence.
    setTimeout(()=>{
      Object.assign(window.probe,{afterCallback:{capturedState:context.state,managerGame:!!manager.game,currentIsCaptured:manager.context===context},callbackObservedAt:performance.now()});
      if(manager.game)game.destroy(true);
      setTimeout(async()=>{
        window.probe.beforeOwnedCleanup=contexts.map(c=>c.state);
        for(const c of contexts)if(c.state!=='closed')await c.close();
        Object.assign(window.probe,{contextsAfter:contexts.map(c=>c.state),canvasesAfter:document.querySelectorAll('canvas').length,done:true});
      },200);
    },350);
  });
  window.readUnlock=()=>({trusted:!!window.probe.unlockGesture,state:context.state,locked:manager.locked});
}}});
}
if(kind!=='borrowed')boot();`;
await writeFile(join(evidence,'page-template.mjs'),body);
sources.push(join(evidence,'page-template.mjs'));
const report={pid:process.pid,started:new Date().toISOString(),workers:1,retries:0,before:inventory(),hashesBefore:await hashes(),responses:[],console:[],pageErrors:[],results:[]};
const server=createServer((request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');let bytes,type;
  if(bundles[url.pathname]){bytes=bundles[url.pathname];type='text/javascript';}
  else if(url.pathname==='/probe.mjs'){bytes=Buffer.from(body.replaceAll('PHASE',url.searchParams.get('phase')).replaceAll('KIND',url.searchParams.get('kind')));type='text/javascript';}
  else if(url.pathname==='/'){bytes=Buffer.from('<!doctype html><title>Native audio visibility probe</title><body><script type="module" src="/probe.mjs'+url.search+'"></script>');type='text/html';}
  else if(url.pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
  else{response.writeHead(404);response.end();return;}
  response.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});response.end(bytes);
});
let browser,context,page,phase='setup',kind='setup';
try{
  // The OS selects and binds a free port atomically; no unrelated listener is reused.
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  report.server={pid:process.pid,address:server.address(),freePortBound:true};
  browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||undefined,args:['--use-angle=d3d11','--ignore-gpu-blocklist']});
  context=await browser.newContext({viewport:{width:400,height:300}});page=await context.newPage();page.setDefaultTimeout(15000);
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  page.on('console',message=>{const entry={phase,kind,type:message.type(),text:message.text()};report.console.push(entry);console.log(JSON.stringify({console:entry}));});
  page.on('pageerror',error=>{const entry={phase,kind,name:error.name,message:error.message,stack:error.stack};report.pageErrors.push(entry);console.log(JSON.stringify({pageError:entry}));});
  report.during=inventory();report.ownedChildren=descendants(report.during,process.pid);
  for(phase of ['baseline','patched'])for(kind of ['live','destroy','replacement','borrowed']){
    const responsePromise=page.waitForResponse(response=>response.url().endsWith('/'+phase+'.js'));
    await page.goto('http://127.0.0.1:'+server.address().port+'/?phase='+phase+'&kind='+kind);
    const response=await responsePromise,bytes=await response.body();
    report.responses.push({phase,kind,url:response.url(),status:response.status(),bytes:bytes.length,sha256:sha(bytes)});
    assert.equal(response.status(),200);assert.equal(sha(bytes),sha(bundles['/'+phase+'.js']));
    await writeFile(join(evidence,phase+'-'+kind+'-served.mjs'),bytes);
    if(kind==='borrowed')await page.waitForFunction(()=>!!window.probe);
    else{
      await page.waitForFunction(()=>window.probe?.ready);
      const before=await page.evaluate(()=>window.probe.beforeGesture);assert.equal(before.locked,true);assert.equal(before.state,'suspended');
    }
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.probe?.ready);
    await page.waitForFunction(()=>{const s=window.readUnlock();return s.trusted&&!s.locked&&s.state==='running';});
    await page.keyboard.press('Space');await page.waitForFunction(()=>window.probe.done);
    const result=await page.evaluate(()=>window.probe);result.phase=phase;report.results.push(result);
    assert.equal(result.nativeWebAudio,true);assert.equal(result.version,'4.2.1');assert.doesNotMatch(result.renderer.renderer,/swiftshader|llvmpipe|software/i);
    assert.equal(result.trusted.some(e=>e.key==='Enter'),true);assert.equal(result.beforeVisible.locked,false);assert.equal(result.beforeVisible.state,'running');
    if(kind==='borrowed')assert.equal(result.borrowedCreatedByTrustedGesture,true);
    const source=bytes.toString(),start=source.indexOf('    onGameVisible: function ()'),end=source.indexOf('        }, 100);',start);
    assert.ok(start>=0&&end>start);assert.equal(source.indexOf('    onGameVisible: function ()',start+1),-1);
    result.callbackLines=['context.suspend();','context.resume();'].map(text=>source.slice(0,source.indexOf(text,start)).split('\n').length);
    const callback=result.calls.filter(call=>result.callbackLines.some(line=>call.stack.includes('at '+response.url()+':'+line+':')));
    // Exact served callback lines distinguish the independent native onFocus recovery.
    const captured=callback.filter(call=>call.id==='captured'&&['suspend','resume'].includes(call.method));
    result.visibilityCalls=captured;
    await writeFile(join(evidence,phase+'-'+kind+'-result.json'),JSON.stringify(result,null,2));
    assert.deepEqual(captured.map(call=>call.method),kind==='live'||phase==='baseline'?['suspend','resume']:[]);
    for(const call of captured){assert.ok(call.time-result.visibleAt>=95,'Native delay remains 100ms');assert.ok(call.time<result.callbackObservedAt);}
    if(kind==='live')assert.equal(result.afterCallback.capturedState,'running');
    if(kind==='destroy')assert.equal(result.afterCallback.managerGame,false);
    if(kind==='replacement')assert.equal(result.afterCallback.currentIsCaptured,false);
    if(kind==='borrowed'){assert.equal(result.afterCallback.managerGame,false);assert.notEqual(result.afterCallback.capturedState,'closed');}
    assert.equal(result.canvasesAfter,0);assert.ok(result.contextsAfter.every(state=>state==='closed'));
    const errors=report.pageErrors.filter(entry=>entry.phase===phase&&entry.kind===kind);
    assert.equal(errors.length,phase==='baseline'&&['destroy','replacement'].includes(kind)?2:0);
    assert.equal(result.rejections.length,errors.length);for(const error of errors)assert.equal(error.name,'InvalidStateError');
  }
  assert.equal(report.console.filter(entry=>entry.type==='warning').length,0);
  report.beforeCleanup=inventory();report.ownedChildren=[...new Set([...report.ownedChildren,...descendants(report.beforeCleanup,process.pid)])];
  assert.equal(browser.contexts().length,1);assert.equal(context.pages().length,1);
  await page.screenshot({path:join(evidence,'final.png')});report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
  if(context){await context.tracing.stop({path:join(evidence,'trace.zip')}).catch(error=>{report.traceError=String(error);process.exitCode=1;});await context.close();report.contextsAfterClose=browser.contexts().length;}
  if(browser){await browser.close();report.browserConnectedAfter=browser.isConnected();}
  if(server.listening)await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));
  report.serverListeningAfter=server.listening;report.after=inventory();report.survivingOwnedChildren=report.after.filter(item=>report.ownedChildren?.includes(item.ProcessId));
  report.hashesAfter=await hashes();report.hashesUnchanged=JSON.stringify(report.hashesBefore)===JSON.stringify(report.hashesAfter);
  if(!report.hashesUnchanged||report.survivingOwnedChildren.length)process.exitCode=1;
  report.exitCode=process.exitCode||0;report.completed=new Date().toISOString();await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,exitCode:report.exitCode,results:report.results.map(r=>({phase:r.phase,kind:r.kind,renderer:r.renderer,contextsAfter:r.contextsAfter})),cleanup:{contexts:report.contextsAfterClose,browserConnected:report.browserConnectedAfter,serverListening:report.serverListeningAfter,survivingOwnedChildren:report.survivingOwnedChildren},hashesUnchanged:report.hashesUnchanged,error:report.error},null,2));
}

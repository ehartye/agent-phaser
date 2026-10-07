// Run: node audio-decode.mjs <Playwright project> <pristine Phaser> <patched Phaser> <new evidence directory>
// The packages must be isolated phaser@4.2.1 copies. This probe never patches them.
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
await mkdir(evidence); // Refuse to overwrite an earlier run.
const {chromium}=createRequire(join(project,'package.json'))('@playwright/test');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const targets=['src/loader/filetypes/AudioFile.js','dist/phaser.esm.js','dist/phaser.js'];
const sources=[fileURLToPath(import.meta.url),join(root,'skills/engine-phaser/scripts/assets/phaser-audio-decode-patch.mjs'),
  join(root,'tests/phaser-audio-decode.test.mjs'),join(root,'tests/fixtures/phaser-audio-on-process-4.2.1.txt'),
  join(root,'skills/engine-phaser/references/native-audio.md'),join(root,'.claude-plugin/plugin.json'),join(root,'.claude-plugin/marketplace.json'),
  ...[pristine,patched].flatMap(directory=>[join(directory,'package.json'),...targets.map(file=>join(directory,file))])];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async file=>[file,sha(await readFile(file))])));
const inventory=()=>process.platform==='win32'?JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',
  '@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name) | ConvertTo-Json -Compress'],
  {encoding:'utf8',windowsHide:true})):[];
const descendants=(processes,parent)=>{
  const ids=new Set([parent]);
  for(let changed=true;changed;){changed=false;for(const item of processes)if(ids.has(item.ParentProcessId)&&!ids.has(item.ProcessId)){ids.add(item.ProcessId);changed=true;}}
  return [...ids].filter(id=>id!==parent);
};
// Small valid mono PCM recording, used only as a native decoder fixture.
const samples=800,rate=8000,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*1000),44+i*2);
const invalid=Buffer.from('HTTP 200, but not an encoded recording.');
await writeFile(join(evidence,'valid.wav'),wav);await writeFile(join(evidence,'invalid.wav'),invalid);
sources.push(join(evidence,'valid.wav'),join(evidence,'invalid.wav'));
const bundles={};
for(const [phase,directory] of [['baseline',pristine],['patched',patched]]){
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  assert.equal(manifest.name,'phaser');assert.equal(manifest.version,'4.2.1');
  bundles[`/${phase}.js`]=await readFile(join(directory,'dist/phaser.esm.js'));
}
const report={pid:process.pid,started:new Date().toISOString(),workers:1,retries:0,before:inventory(),
  hashesBefore:await hashes(),requests:[],console:[],pageErrors:[],results:[]};
const server=createServer((request,response)=>{
  let body,type;
  if(bundles[request.url]){body=bundles[request.url];type='text/javascript';}
  else if(request.url==='/invalid.wav'){body=invalid;type='audio/wav';}
  else if(request.url==='/valid.wav'){body=wav;type='audio/wav';}
  else if(request.url==='/'){body=Buffer.from('<!doctype html><title>Native audio decode probe</title><style>body{margin:0}</style>');type='text/html';}
  else{response.writeHead(404);response.end();return;}
  response.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});response.end(body);
});
let browser,context,page,phase='setup';
try{
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  report.server={pid:process.pid,address:server.address()};
  browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||undefined,args:['--use-angle=d3d11','--ignore-gpu-blocklist']});
  context=await browser.newContext({viewport:{width:400,height:300}});page=await context.newPage();page.setDefaultTimeout(15000);
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  page.on('console',message=>{const entry={phase,type:message.type(),text:message.text()};report.console.push(entry);console.log(JSON.stringify({console:entry}));});
  page.on('pageerror',error=>{const entry={phase,name:error.name,message:error.message,stack:error.stack};report.pageErrors.push(entry);console.log(JSON.stringify({pageError:entry}));});
  page.on('response',response=>{if(response.url().endsWith('.wav'))report.requests.push({phase,url:response.url(),status:response.status()});});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(()=>{
    window.decodeRejections=[];
    // Observation only: leave the browser's rejection and console reporting intact.
    window.addEventListener('unhandledrejection',event=>window.decodeRejections.push({phase:window.decodePhase,name:event.reason?.name,message:event.reason?.message}));
    window.runDecodeProbe=async phase=>{
      const {default:Phaser}=await import(`/${phase}.js`);window.decodePhase=phase;
      const bounded=(promise,label)=>new Promise((done,reject)=>{
        const timer=setTimeout(()=>reject(Error(`Timed out: ${label}`)),12000);
        promise.then(value=>{clearTimeout(timer);done(value);},error=>{clearTimeout(timer);reject(error);});
      });
      const {game,scene}=await bounded(new Promise(done=>{
        window.decodeGame=new Phaser.Game({type:Phaser.WEBGL,width:400,height:300,banner:false,
          scene:{create(){done({game:this.sys.game,scene:this});}}});
      }),'native game boot');
      const gl=game.renderer.gl,extension=gl.getExtension('WEBGL_debug_renderer_info'),audioContext=game.sound.context;
      const result={phase,version:Phaser.VERSION,manager:game.sound.constructor.name,
        nativeWebAudio:game.sound instanceof Phaser.Sound.WebAudioSoundManager,
        renderer:{type:game.renderer.type,version:gl.getParameter(gl.VERSION),renderer:gl.getParameter(extension?extension.UNMASKED_RENDERER_WEBGL:gl.RENDERER)},
        loads:[]};
      try{
        for(const url of ['/invalid.wav','/valid.wav']){
          const load=await bounded(new Promise(done=>{
            const loader=scene.load,events=Phaser.Loader.Events,entry={url,fileLoads:0,fileComplete:0,httpErrors:0,postProcess:0,complete:0};
            let file;
            const loaded=value=>{file=value;entry.fileLoads++;};
            const completeFile=()=>entry.fileComplete++;
            const errorFile=()=>entry.httpErrors++;
            const post=()=>{entry.postProcess++;entry.processedState=file?.state;entry.decodeFailed=file?.state===Phaser.Loader.FILE_ERRORED;};
            loader.on(events.FILE_LOAD,loaded);loader.on(events.FILE_COMPLETE,completeFile);loader.on(events.FILE_LOAD_ERROR,errorFile);loader.on(events.POST_PROCESS,post);
            loader.once(events.COMPLETE,(_loader,totalComplete,totalFailed)=>{
              entry.complete++;Object.assign(entry,{totalComplete,totalFailed,cached:game.cache.audio.exists('recording'),cache:game.cache.audio.getKeys()});
              loader.off(events.FILE_LOAD,loaded);loader.off(events.FILE_COMPLETE,completeFile);loader.off(events.FILE_LOAD_ERROR,errorFile);loader.off(events.POST_PROCESS,post);done(entry);
            });
            loader.audio('recording',url);loader.start();
          }),`native load ${url}`);
          result.loads.push(load);
          // Let native rejection reporting run after Loader's synchronous COMPLETE.
          await new Promise(done=>setTimeout(done,100));
        }
        result.rejections=window.decodeRejections.filter(entry=>entry.phase===phase);
      }finally{
        await bounded(new Promise(done=>{game.events.once(Phaser.Core.Events.DESTROY,done);game.destroy(true);}),'native game destruction');
        await bounded(new Promise(done=>{const wait=()=>audioContext.state==='closed'?done():setTimeout(wait,10);wait();}),'native AudioContext closure');
        result.contextAfter=audioContext.state;result.canvasesAfter=document.querySelectorAll('canvas').length;
      }
      return result;
    };
  });
  report.during=inventory();report.ownedChildren=descendants(report.during,process.pid);
  for(phase of ['baseline','patched']){
    const result=await page.evaluate(value=>window.runDecodeProbe(value),phase);report.results.push(result);
    assert.equal(result.version,'4.2.1');assert.equal(result.nativeWebAudio,true);assert.doesNotMatch(result.renderer.renderer,/swiftshader|llvmpipe|software/i);
    const [bad,retry]=result.loads;
    assert.deepEqual([bad.fileLoads,bad.fileComplete,bad.httpErrors,bad.postProcess,bad.complete,bad.totalComplete,bad.totalFailed,bad.decodeFailed,bad.cached],[1,0,0,1,1,1,0,true,false]);
    assert.deepEqual([retry.fileLoads,retry.fileComplete,retry.httpErrors,retry.postProcess,retry.complete,retry.totalComplete,retry.totalFailed,retry.decodeFailed,retry.cached],[1,1,0,1,1,1,0,false,true]);
    assert.deepEqual(retry.cache,['recording']);assert.equal(result.contextAfter,'closed');assert.equal(result.canvasesAfter,0);
    assert.equal(result.rejections.length,phase==='baseline'?1:0);
    if(phase==='baseline')assert.equal(result.rejections[0].name,'EncodingError');
  }
  assert.equal(report.console.filter(entry=>entry.type==='error'&&entry.text.includes('Error decoding audio: recording')).length,2,'Native error console remains visible in both phases');
  assert.equal(report.pageErrors.filter(entry=>entry.phase==='baseline').length,1);assert.equal(report.pageErrors.filter(entry=>entry.phase==='patched').length,0);
  assert.deepEqual(report.requests.map(entry=>entry.status),[200,200,200,200]);
  report.beforeCleanup=inventory();
  report.ownedChildren=[...new Set([...report.ownedChildren,...descendants(report.beforeCleanup,process.pid)])];
  report.contextsDuring=browser.contexts().length;report.pagesDuring=context.pages().length;
  assert.equal(report.contextsDuring,1);assert.equal(report.pagesDuring,1);
  await page.screenshot({path:join(evidence,'final.png')});report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
  if(context){await context.tracing.stop({path:join(evidence,'trace.zip')}).catch(error=>{report.traceError=String(error);process.exitCode=1;});await context.close();report.contextsAfterClose=browser.contexts().length;}
  if(browser){await browser.close();report.browserConnectedAfter=browser.isConnected();}
  if(server.listening)await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));
  report.serverListeningAfter=server.listening;report.after=inventory();
  report.survivingOwnedChildren=report.after.filter(item=>report.ownedChildren?.includes(item.ProcessId));
  report.hashesAfter=await hashes();report.hashesUnchanged=JSON.stringify(report.hashesBefore)===JSON.stringify(report.hashesAfter);
  if(!report.hashesUnchanged||report.survivingOwnedChildren.length)process.exitCode=1;
  report.exitCode=process.exitCode||0;report.completed=new Date().toISOString();
  await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,exitCode:report.exitCode,pid:report.pid,ownedChildren:report.ownedChildren,results:report.results,
    cleanup:{contexts:report.contextsAfterClose,browserConnected:report.browserConnectedAfter,serverListening:report.serverListeningAfter,survivingOwnedChildren:report.survivingOwnedChildren},hashesUnchanged:report.hashesUnchanged,error:report.error},null,2));
}

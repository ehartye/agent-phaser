// Run: node phaser-pixel-ui-accessibility-bridge.mjs <host> [--output <directory>] [--mutation aria-hidden|duplicate-action]
// Desktop Chromium/Canvas evidence only. No screen-reader, mobile IME, compliance or paint certification.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const [host,...args]=process.argv.slice(2);let output,mutation;
for(let i=0;i<args.length;i++){
  if(args[i]==='--output'&&args[i+1])output=resolve(args[++i]);
  else if(args[i]==='--mutation'&&['aria-hidden','duplicate-action'].includes(args[i+1]))mutation=args[++i];
  else throw Error('Usage: <host> [--output <directory>] [--mutation aria-hidden|duplicate-action]');
}
assert(host,'host required');const require=createRequire(join(resolve(host),'package.json'));
assert.equal(require('phaser/package.json').version,'4.2.1');const {chromium}=require('@playwright/test');
const evidence=output??await mkdtemp(join(tmpdir(),'phaser-ax-evidence-'));await mkdir(evidence,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),routes=new Map([['/phaser.js',await readFile(require.resolve('phaser'))]]);
for(const name of ['accessibility-bridge.mjs','accessibility-bridge-fixture.mjs'])routes.set('/'+name,await readFile(new URL('../harness/'+name,import.meta.url)));
const report={version:1,evidence,mutation:mutation??null,phaser:'4.2.1',probeSha256:hash(await readFile(new URL(import.meta.url))),sources:Object.fromEntries([...routes].map(([n,b])=>[n,hash(b)])),snapshots:[],actions:[],cycles:[],errors:[],passed:false,cleanup:{},limitations:['Desktop Chromium AX and native input only','No screen-reader, device IME/mobile keyboard, compliance, GPU or authored-paint acceptance']};
const server=createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><body style="margin:0"><script src="/phaser.js"></script></body>');}else if(routes.has(req.url)){res.setHeader('content-type','text/javascript');res.end(routes.get(req.url));}else{res.statusCode=404;res.end();}});
let browser,context,page,cdp;
const state=()=>page.evaluate(()=>window.fixture.snapshot());
async function ax(label){const tree=await cdp.send('Accessibility.getFullAXTree');await writeFile(join(evidence,label+'.ax.json'),JSON.stringify(tree,null,2));report.snapshots.push({label,file:label+'.ax.json',sha256:hash(JSON.stringify(tree))});return tree.nodes.filter(n=>!n.ignored);}
const find=(nodes,role,name)=>nodes.find(n=>n.role?.value===role&&n.name?.value===name);
async function required(label){const nodes=await ax(label);for(const [role,name] of [['button','Music'],['button','Unavailable'],['button','Open settings'],['textbox','Player name']])assert(find(nodes,role,name),`AX membership: required ${role} ${name}`);for(const name of ['Excluded display-none','Excluded hidden','Excluded aria-hidden'])assert(!nodes.some(n=>n.name?.value===name),`excluded ${name} entered AX tree`);assert.equal(find(nodes,'button','Unavailable').properties.find(p=>p.name==='disabled')?.value.value,true);return nodes;}
async function action(label,perform,id,route){const before=await state();await perform();const after=await state(),receipts=after.receipts.slice(before.receipts.length);report.actions.push({label,before,after,receipts});assert.equal(receipts.length,1,`original action once: ${label}`);assert.equal(receipts[0].handlerOwner,after.owner);assert.equal(receipts[0].id,id);assert.equal(receipts[0].route,route);return after;}
function focus(state,id){assert.equal(state.active,id,'native DOM focus');assert.equal(state.focus,id,'model focus');assert.equal(state.visual.find(v=>v.id===id)?.focused,true,'native Canvas focus stroke');}
try{
  await new Promise(done=>server.listen(0,'127.0.0.1',done));report.origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chromium',timeout:20000});report.browser=browser.version();context=await browser.newContext({viewport:{width:440,height:360}});await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await page.goto(report.origin);
  await page.evaluate(async()=>{window.createFixture=(await import('/accessibility-bridge-fixture.mjs')).createAccessibilityBridgeFixture;window.fixture=await window.createFixture();});
  cdp=await context.newCDPSession(page);await cdp.send('Accessibility.enable');report.initial=await state();assert.equal(report.initial.renderer,'CanvasRenderer');
  if(mutation)await page.evaluate(mode=>window.fixture.mutate(mode),mutation);
  await required('initial');
  if(mutation==='duplicate-action'){await page.keyboard.press('Tab');await action('mutated semantic activation',()=>page.keyboard.press('Enter'),'toggle','semantic');report.mutationEscaped=true;}
  else if(mutation==='aria-hidden')report.mutationEscaped=true;
  else{
    focus(await action('canvas pointer',()=>page.mouse.click(180,30),'toggle','canvas'),'toggle');
    assert.equal((await ax('selected')).find(n=>n.name?.value==='Music').properties.find(p=>p.name==='pressed')?.value.value,'true');
    focus(await action('semantic Enter',()=>page.keyboard.press('Enter'),'toggle','semantic'),'toggle');
    await page.keyboard.press('Tab');focus(await state(),'open');
    const opened=await action('open modal',()=>page.keyboard.press('Enter'),'open','semantic');focus(opened,'apply');assert.equal(opened.backgroundInert,true);
    const modalNodes=await ax('modal');assert(find(modalNodes,'dialog','Settings'));assert(find(modalNodes,'button','Apply settings'));assert(!find(modalNodes,'button','Music'),'inert background absent from AX');
    await page.keyboard.press('Tab');focus(await state(),'close');await page.keyboard.press('Tab');focus(await state(),'apply');await page.keyboard.press('Shift+Tab');focus(await state(),'close');
    const beforeBlocked=await state();await page.mouse.click(180,30);assert.equal((await state()).receipts.length,beforeBlocked.receipts.length,'canvas background action blocked in modal');
    focus(await action('Escape modal',()=>page.keyboard.press('Escape'),'close','semantic'),'open');assert.equal((await state()).backgroundInert,false);
    const beforeDisabled=await state();await page.mouse.click(180,74);assert.equal((await state()).receipts.length,beforeDisabled.receipts.length,'disabled canvas refuses');
    // Restore focus through real pointer input before continuing the keyboard sequence.
    await page.mouse.click(180,162);focus(await state(),'name');await page.keyboard.type('Ada');const typed=await state();report.typed=typed;assert.equal(typed.controls.find(c=>c.id==='name').value,'Ada');assert.equal(typed.visual.find(c=>c.id==='name').text,'Player name: Ada');assert.equal(typed.receipts.filter(e=>e.route==='field').length,3);
    const typedNodes=await required('typed');assert.equal(find(typedNodes,'textbox','Player name').value?.value,'Ada');
    assert(typed.nativeEvents.filter(e=>e.type!=='pointerup').every(e=>e.trusted),'semantic events are trusted browser input');
    await page.screenshot({path:join(evidence,'positive.png')});
    for(let cycle=0;cycle<10;cycle++){
      const old=await page.evaluate(()=>{const previous=window.fixture;window.retired=previous;previous.dispose();return previous.dispose();});
      assert.equal(old.disposed,true);assert.equal(old.subscribers,0);assert.equal(old.listeners,0);assert.equal(old.rootConnected,false);assert.equal(await page.locator('canvas').count(),0);
      await page.evaluate(async()=>{window.fixture=await window.createFixture();});await required('cycle-'+cycle);await page.keyboard.press('Tab');const fresh=await action('cycle '+cycle,()=>page.keyboard.press('Enter'),'toggle','semantic');assert.notEqual(old.owner,fresh.owner);assert.equal((await page.evaluate(()=>window.retired.snapshot())).receipts.length,old.receipts.length,'retired owner receives no action');report.cycles.push({cycle,old,fresh});
    }
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;if(page){try{report.failureState=await state();await ax('failure');await page.screenshot({path:join(evidence,'failure.png')});}catch(e){report.captureError=e.message;}}}
finally{
  // Save original failure and native facts before releasing the owning fixture.
  await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));
  if(page)try{report.cleanup.fixture=await page.evaluate(()=>window.fixture?.dispose());assert.equal(report.cleanup.fixture?.listeners,0);assert.equal(report.cleanup.fixture?.rootConnected,false);assert.equal(await page.locator('canvas').count(),0);}catch(e){report.cleanup.error=e.message;report.passed=false;process.exitCode=1;}
  if(cdp){await cdp.detach();report.cleanup.cdpDetached=true;}
  if(context){await context.tracing.stop({path:join(evidence,report.failure?'failure.trace.zip':'positive.trace.zip')});await context.close();report.cleanup.contextClosed=true;}
  if(browser){await browser.close();report.cleanup.browserClosed=!browser.isConnected();}
  await new Promise(done=>server.close(done));report.cleanup.serverClosed=!server.listening;await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report,null,2));

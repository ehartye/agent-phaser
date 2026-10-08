import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm,cp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {patchAudioDecode} from '../skills/engine-phaser/scripts/assets/phaser-audio-decode-patch.mjs';
import {patchGamepadLifecycle} from '../skills/engine-phaser/scripts/assets/phaser-gamepad-lifecycle-patch.mjs';
import {patchFramebufferRestore} from '../skills/engine-phaser/scripts/assets/phaser-framebuffer-restore-patch.mjs';

const fixtureSource=(await readFile(new URL('./fixtures/phaser-audio-visible-4.2.1.txt',import.meta.url),'utf8')).replaceAll('\r\n','\n');
const original=fixtureSource.slice(fixtureSource.indexOf('     * @method Phaser.Sound.WebAudioSoundManager#onGameVisible'),fixtureSource.indexOf('// End extracted native fragment.'));
const script=new URL('../skills/engine-phaser/scripts/assets/phaser-audio-visibility-patch.mjs',import.meta.url);
const patch=existsSync(script)?(await import(script)).patchAudioVisibility:undefined;
const files=['src/sound/webaudio/WebAudioSoundManager.js','dist/phaser.esm.js','dist/phaser.js'];
const prefix=Buffer.from('// Outside bytes: é\n'),suffix=Buffer.from('\n// Trailing bytes\n');
async function fixture(newline='\n'){
  const directory=await mkdtemp(join(tmpdir(),'phaser-audio-visible-'));
  await writeFile(join(directory,'package.json'),JSON.stringify({name:'phaser',version:'4.2.1'}));
  for(const file of files){await mkdir(join(directory,file,'..'),{recursive:true});await writeFile(join(directory,file),Buffer.concat([prefix,Buffer.from(original.replaceAll('\n',newline)),suffix]));}
  return directory;
}
const contents=directory=>Promise.all(files.map(file=>readFile(join(directory,file)).catch(e=>e.code==='ENOENT'?null:Promise.reject(e))));
function installer(){assert.equal(typeof patch,'function','The guarded install-time visibility correction is missing.');return patch;}
async function corrected(){if(!patch)return original;const directory=await fixture();try{await installer()(directory);return (await readFile(join(directory,files[0]))).toString();}finally{await rm(directory,{recursive:true,force:true});}}
function native(source,state='running'){
  const queue=[],calls=[];
  const start=source.indexOf('onGameVisible: function ()'),end=source.indexOf('\n    },',start);
  const fn=runInNewContext(`({${source.slice(start,end+6)}}).onGameVisible`,{window:{setTimeout(callback,delay){queue.push({callback,delay});}}});
  const context={state,suspend(){calls.push('suspend');},resume(){calls.push('resume');}};
  const manager={game:{},context};
  return {manager,context,calls,queue,schedule:()=>fn.call(manager),flush(){for(const {callback,delay} of queue.splice(0)){assert.equal(delay,100);callback();}}};
}
for(const mutation of ['closed','destroyed','replaced'])test(`pinned native callback reproduces calls after ${mutation}`,()=>{
  const n=native(original);n.schedule();if(mutation==='closed')n.context.state='closed';if(mutation==='destroyed')n.manager.game=null;if(mutation==='replaced')n.manager.context={state:'running'};n.flush();assert.deepEqual(n.calls,['suspend','resume']);
});
for(const mutation of ['closed','destroyed','replaced','null'])test(`corrected native callback refuses ${mutation} lifetime`,async()=>{
  const n=native(await corrected());if(mutation==='null')n.manager.context=null;n.schedule();if(mutation==='closed')n.context.state='closed';if(mutation==='destroyed')n.manager.game=null;if(mutation==='replaced')n.manager.context={state:'running'};n.flush();assert.deepEqual(n.calls,[]);
});
for(const state of ['running','suspended'])test(`live ${state} context keeps native 100ms suspend/resume and repeated callbacks`,async()=>{
  const n=native(await corrected(),state);n.schedule();n.schedule();assert.deepEqual(n.calls,[]);assert.deepEqual(n.queue.map(e=>e.delay),[100,100]);n.flush();assert.deepEqual(n.calls,['suspend','resume','suspend','resume']);
});
test('actual live method failures remain observable',async()=>{
  const n=native(await corrected());n.context.suspend=()=>{throw Error('Native failure');};n.schedule();assert.throws(()=>n.flush(),/Native failure/);
});
for(const newline of ['\n','\r\n'])test(`all targets preserve ${newline==='\n'?'LF':'CRLF'} and every outside byte, idempotently`,async()=>{
  const directory=await fixture(newline);try{
    const before=await contents(directory);assert.deepEqual((await installer()(directory)).changed,files);const after=await contents(directory);
    assert.equal(new Set(after.map(b=>b.toString())).size,1);
    for(let i=0;i<files.length;i++){assert.deepEqual(after[i].subarray(0,prefix.length),before[i].subarray(0,prefix.length));assert.deepEqual(after[i].subarray(-suffix.length),suffix);const body=after[i].subarray(prefix.length,-suffix.length).toString();assert.equal(newline==='\r\n'?/(?<!\r)\n/.test(body):body.includes('\r'),false);const n=native(body);n.schedule();n.flush();assert.deepEqual(n.calls,['suspend','resume']);}
    assert.deepEqual((await installer()(directory)).changed,[]);assert.deepEqual(await contents(directory),after);
  }finally{await rm(directory,{recursive:true,force:true});}
});
for(const mutation of ['wrong-name','wrong-version','invalid-manifest','missing-manifest','unknown-fragment','ambiguous-original','ambiguous-marker','ambiguous-mixed','missing-file','mixed-target-newlines','mixed-file-newlines','mixed-states','partial-correction'])test(`API and CLI refuse ${mutation} before any write`,async()=>{
  const directory=await fixture();try{
    const manifest=join(directory,'package.json'),file=join(directory,files[2]);
    if(mutation==='wrong-name'||mutation==='wrong-version')await writeFile(manifest,JSON.stringify({name:mutation==='wrong-name'?'other':'phaser',version:mutation==='wrong-version'?'4.2.2':'4.2.1'}));
    else if(mutation==='invalid-manifest')await writeFile(manifest,'invalid JSON');
    else if(mutation==='missing-manifest')await rm(manifest);
    else if(mutation==='missing-file')await rm(file);
    else{
      let body=(await readFile(file)).toString();
      if(['mixed-states','ambiguous-mixed','partial-correction'].includes(mutation)){
        await installer()(directory);body=(await readFile(file)).toString();
        if(mutation==='mixed-states')body=prefix+original+suffix;
        if(mutation==='ambiguous-mixed')body+=original;
        if(mutation==='partial-correction')body=body.replace('var _this = this;\n\n        ','');
      }
      if(mutation==='unknown-fragment')body=body.replace('context.resume();','context.resume(123);');
      if(mutation==='ambiguous-original')body+=original;
      if(mutation==='ambiguous-marker')body+='\n * @method Phaser.Sound.WebAudioSoundManager#onGameVisible\n';
      if(mutation==='mixed-target-newlines')body=body.replace('var context = this.context;\n','var context = this.context;\r\n');
      if(mutation==='mixed-file-newlines')body=body.replaceAll('\n','\r\n');
      await writeFile(file,body);
    }
    const before=await contents(directory);await assert.rejects(()=>installer()(directory));assert.deepEqual(await contents(directory),before);
    const cli=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(cli.status,1);assert.deepEqual(await contents(directory),before);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('CLI takes exactly one directory, reports changed files; import has no side effect',async()=>{
  const directory=await fixture();try{
    installer();const before=await contents(directory);const imported=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(script.href)});`,directory],{encoding:'utf8'});assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout,'');assert.deepEqual(await contents(directory),before);
    for(const args of [[],[directory,directory]]){const cli=spawnSync(process.execPath,[fileURLToPath(script),...args],{encoding:'utf8'});assert.equal(cli.status,1);assert.match(cli.stderr,/Usage:/);assert.deepEqual(await contents(directory),before);}
    for(const changed of [files,[]]){const cli=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout).changed,changed);}
  }finally{await rm(directory,{recursive:true,force:true});}
});
// Optional real-package input is an isolated npm pack copy, never the game's dependency.
if(process.env.PHASER_VISIBILITY_PRISTINE)for(const order of ['visibility-first','visibility-last'])test(`real pinned bundles compose in ${order} order with independent audio/gamepad/framebuffer/held guards`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'phaser-audio-composition-'));try{
    await cp(process.env.PHASER_VISIBILITY_PRISTINE,directory,{recursive:true});
    const heldFiles=['src/input/gamepad/Gamepad.js','dist/phaser.esm.js','dist/phaser.js'];
    const gate=`        if (pad.timestamp < this._created)\n        {\n            return;\n        }\n`;
    const held=async()=>{for(const file of heldFiles){const body=await readFile(join(directory,file),'utf8'),newline=body.includes('\r\n')?'\r\n':'\n',target=gate.replaceAll('\n',newline);assert.equal(body.split(target).length,2);await writeFile(join(directory,file),body.replace(target,'        // Existing held-input correction; native Button owns edges.'+newline));}};
    const others=async()=>{await patchAudioDecode(directory);await patchGamepadLifecycle(directory);await patchFramebufferRestore(directory);};
    if(order==='visibility-first'){await installer()(directory);await held();await others();}else{await held();await others();await installer()(directory);}
    const heldBodies=await Promise.all(heldFiles.map(file=>readFile(join(directory,file),'utf8')));
    const after=await contents(directory);
    for(const body of after){const n=native(body.toString());n.schedule();n.manager.game=null;n.flush();assert.deepEqual(n.calls,[]);}
    for(const file of heldFiles){const body=await readFile(join(directory,file),'utf8');assert.equal(body.includes(gate),false);assert.ok(body.includes('// Existing held-input correction; native Button owns edges.'));}
    assert.ok(heldBodies.every(body=>body.includes('// Existing held-input correction; native Button owns edges.')));
    assert.deepEqual((await installer()(directory)).changed,[]);await others();assert.deepEqual(await contents(directory),after);
  }finally{await rm(directory,{recursive:true,force:true});}
});

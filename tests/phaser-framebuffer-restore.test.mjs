import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {patchAudioDecode} from '../skills/engine-phaser/scripts/assets/phaser-audio-decode-patch.mjs';
import {patchGamepadLifecycle} from '../skills/engine-phaser/scripts/assets/phaser-gamepad-lifecycle-patch.mjs';

// Complete npm native wrapper and its only dependency; no duplicate resource algorithm.
const {provenance,modules}=JSON.parse(await readFile(new URL('./fixtures/phaser-framebuffer-4.2.1.json',import.meta.url),'utf8'));
const wrapperKey='src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js';
const original=modules[wrapperKey].replaceAll('\r\n','\n');
const files=[wrapperKey,'dist/phaser.esm.js','dist/phaser.js'];
const marker='* @method Phaser.Renderer.WebGL.Wrappers.WebGLFramebufferWrapper#createResource';
const correctedCondition='if (this.webGLFramebuffer && (!renderer.contextLost || gl.isFramebuffer(this.webGLFramebuffer)))';
const script=new URL('../skills/engine-phaser/scripts/assets/phaser-framebuffer-restore-patch.mjs',import.meta.url);
const patch=existsSync(script)?(await import(script)).patchFramebufferRestore:undefined;
const prefix=Buffer.from([0,255,195,169,10]),suffix=Buffer.from([10,254,0]);
async function fixture(newline='\n'){
  const directory=await mkdtemp(join(tmpdir(),'phaser-framebuffer-restore-'));
  await writeFile(join(directory,'package.json'),JSON.stringify({name:'phaser',version:'4.2.1'}));
  for(const file of files){
    await mkdir(join(directory,file,'..'),{recursive:true});
    await writeFile(join(directory,file),Buffer.concat([prefix,Buffer.from(original.replaceAll('\n',newline)),suffix]));
  }
  return directory;
}
const contents=directory=>Promise.all(files.map(file=>readFile(join(directory,file)).catch(error=>error.code==='ENOENT'?null:Promise.reject(error))));
function installer(){assert.equal(typeof patch,'function','The guarded install-time framebuffer correction is missing.');return patch;}
async function corrected(){
  if(!patch)return original;
  const directory=await fixture();try{
    await installer()(directory);
    return (await readFile(join(directory,wrapperKey))).subarray(prefix.length,-suffix.length).toString();
  }finally{await rm(directory,{recursive:true,force:true});}
}
function native(source=original,{canvas=false,depth=true,stencil=true,colors=1}={}){
  const cache={},calls=[],invalid=[];let generation=0,id=0;
  const handle=kind=>({kind,generation,id:++id});
  const gl={FRAMEBUFFER:1,RENDERBUFFER:2,TEXTURE_2D:3,COLOR_ATTACHMENT0:4,DEPTH_STENCIL_ATTACHMENT:8,DEPTH_STENCIL:9,DEPTH_ATTACHMENT:10,DEPTH_COMPONENT16:11,STENCIL_ATTACHMENT:12,STENCIL_INDEX8:13,FRAMEBUFFER_COMPLETE:14};
  for(const [name,kind] of [['createFramebuffer','framebuffer'],['createRenderbuffer','renderbuffer']])gl[name]=()=>{const resource=handle(kind);calls.push([name,resource]);return resource;};
  for(const name of ['deleteFramebuffer','deleteRenderbuffer'])gl[name]=resource=>{calls.push([name,resource]);if(resource&&resource.generation!==generation)invalid.push([name,resource]);else if(resource)resource.deleted=true;};
  gl.isFramebuffer=resource=>resource?.kind==='framebuffer'&&resource.generation===generation&&!resource.deleted;
  for(const name of ['framebufferTexture2D','renderbufferStorage','framebufferRenderbuffer'])gl[name]=(...args)=>calls.push([name,...args]);
  gl.checkFramebufferStatus=()=>gl.FRAMEBUFFER_COMPLETE;
  const renderer={gl,contextLost:false,glWrapper:{updateBindingsFramebuffer(...args){calls.push(['bindFramebuffer',...args]);},updateBindingsRenderbuffer(...args){calls.push(['bindRenderbuffer',...args]);}},deleteTexture(texture){calls.push(['deleteTexture',texture]);}};
  function load(key){
    if(cache[key])return cache[key].exports;
    const module={exports:{}};cache[key]=module;
    const body=key===wrapperKey?source:modules[key];assert.equal(typeof body,'string',key);
    const require=name=>load(posix.join(posix.dirname(key),name)+'.js');
    runInNewContext('(function(require,module,exports){'+body+'\n})',{})(require,module,module.exports);
    return module.exports;
  }
  const textures=Array.from({length:colors},()=>({width:16,height:32,webGLTexture:handle('texture'),resize(width,height){this.width=width;this.height=height;this.webGLTexture=handle('texture');calls.push(['resizeTexture',width,height]);}}));
  const wrapper=new (load(wrapperKey))(renderer,canvas?null:textures,stencil,depth);
  function restore({complete=true}={}){generation++;renderer.contextLost=true;for(const texture of textures)texture.webGLTexture=handle('texture');wrapper.createResource();renderer.contextLost=!complete;}
  return {wrapper,renderer,textures,calls,invalid,restore,generation:()=>generation};
}
const deletes=n=>n.calls.filter(([name])=>name.startsWith('delete'));
test('fixture retains exact npm 4.2.1 source bytes and provenance',()=>{
  assert.equal(provenance.package,'phaser@4.2.1');assert.equal(provenance.tarballSha1,'5512f23d348e6fb5c48ce71a9fbddd200ef919ea');
  assert.equal(provenance.sha256[wrapperKey],'816cf6bca7e7e7a80e94d2f06b582e12460762459d7cf4b0b235a7f9374cc4bc');
  assert.equal(provenance.sha256['src/utils/Class.js'],'ec859381c9ffee033cb22d0e91610d693d57c27ed527fb682a3707d76c2dfb8c');
  for(const [key,source] of Object.entries(modules))assert.equal(createHash('sha256').update(source).digest('hex'),provenance.sha256[key],key);
});
test('pinned native defect deletes two previous-generation resources during restore',()=>{
  const n=native();n.calls.length=0;n.restore();assert.deepEqual(deletes(n).map(([name])=>name),['deleteFramebuffer','deleteRenderbuffer']);assert.equal(n.invalid.length,2);
});
test('restore replaces old-generation handles without deleting them on two cycles',async()=>{
  const n=native(await corrected());
  for(let cycle=0;cycle<2;cycle++){
    const previous=n.wrapper.webGLFramebuffer,oldBuffer=n.wrapper.attachments[1].renderbuffer;n.calls.length=0;n.restore();
    assert.deepEqual(deletes(n),[],'restore must not delete previous-generation GL handles');assert.deepEqual(n.invalid,[]);
    assert.notEqual(n.wrapper.webGLFramebuffer,previous);assert.notEqual(n.wrapper.attachments[1].renderbuffer,oldBuffer);
    assert.equal(n.wrapper.webGLFramebuffer.generation,n.generation());assert.equal(n.wrapper.attachments[1].renderbuffer.generation,n.generation());
    assert.equal(n.calls.filter(([name])=>name==='createFramebuffer').length,1);assert.equal(n.calls.filter(([name])=>name==='createRenderbuffer').length,1);
    const bind=n.calls.find(([name])=>name==='bindFramebuffer');assert.equal(bind[1].bindings.framebuffer,n.wrapper);assert.equal(bind[2],true);
    assert.ok(n.calls.some(([name,,,,texture])=>name==='framebufferTexture2D'&&texture===n.textures[0].webGLTexture));
  }
  const live=n.wrapper.webGLFramebuffer,buffer=n.wrapper.attachments[1].renderbuffer;n.calls.length=0;n.wrapper.createResource();
  assert.deepEqual(deletes(n),[['deleteFramebuffer',live],['deleteRenderbuffer',buffer]]);assert.deepEqual(n.invalid,[]);
});
test('native recreation and resize delete current-generation handles during the same restore phase',async()=>{
  const n=native(await corrected());n.restore({complete:false});n.calls.length=0;
  for(const recreate of [()=>n.wrapper.createResource(),()=>n.wrapper.resize(24,48)]){
    const frame=n.wrapper.webGLFramebuffer,buffer=n.wrapper.attachments[1].renderbuffer;n.calls.length=0;recreate();
    assert.deepEqual(deletes(n),[['deleteFramebuffer',frame],['deleteRenderbuffer',buffer]],'a live restore-phase handle must be disposed before replacement');
    assert.equal(n.renderer.contextLost,true);assert.equal(n.wrapper.webGLFramebuffer.generation,n.generation());assert.equal(frame.deleted,true);assert.equal(buffer.deleted,true);assert.deepEqual(n.invalid,[]);
  }
});
for(const [depth,stencil] of [[false,false],[true,false],[false,true],[true,true]])test(`ordinary recreation owns only renderbuffers (depth=${depth}, stencil=${stencil})`,async()=>{
  const n=native(await corrected(),{depth,stencil,colors:2}),framebuffer=n.wrapper.webGLFramebuffer,buffer=n.wrapper.attachments[2]?.renderbuffer;n.calls.length=0;n.wrapper.createResource();
  assert.deepEqual(deletes(n),[['deleteFramebuffer',framebuffer],...(depth||stencil?[['deleteRenderbuffer',buffer]]:[])]);
  assert.equal(n.wrapper.attachments.length,depth||stencil?3:2);assert.notEqual(n.wrapper.webGLFramebuffer,framebuffer);assert.equal(n.textures.every(t=>t.isRenderTexture),true);
});
test('ordinary native resize recreates owned handles at the requested dimensions',async()=>{
  const n=native(await corrected()),old=n.wrapper.webGLFramebuffer,buffer=n.wrapper.attachments[1].renderbuffer;n.calls.length=0;n.wrapper.resize(64,48);
  assert.deepEqual(deletes(n),[['deleteFramebuffer',old],['deleteRenderbuffer',buffer]]);assert.equal(n.wrapper.width,64);assert.equal(n.wrapper.height,48);
  assert.ok(n.calls.some(call=>JSON.stringify(call)===JSON.stringify(['renderbufferStorage',n.renderer.gl.RENDERBUFFER,n.renderer.gl.DEPTH_STENCIL,64,48])));
  assert.notEqual(n.wrapper.webGLFramebuffer,old);
});
test('canvas wrapper never allocates, recreates or resizes a framebuffer',async()=>{
  const n=native(await corrected(),{canvas:true});assert.deepEqual(n.calls,[]);n.restore();n.wrapper.createResource();n.wrapper.resize(64,48);
  assert.deepEqual(n.calls,[]);assert.equal(n.wrapper.webGLFramebuffer,null);assert.equal(n.wrapper.width,0);assert.equal(n.wrapper.height,0);
  n.wrapper.destroy();assert.deepEqual(deletes(n),[['deleteFramebuffer',null]]);const count=n.calls.length;n.wrapper.destroy();assert.equal(n.calls.length,count);
});
test('ordinary destroy detaches textures, delegates their deletion and retires owned resources once',async()=>{
  const n=native(await corrected(),{colors:2});n.restore();const frame=n.wrapper.webGLFramebuffer,buffer=n.wrapper.attachments[2].renderbuffer;n.calls.length=0;n.wrapper.destroy();
  assert.deepEqual(deletes(n),[['deleteTexture',n.textures[0]],['deleteTexture',n.textures[1]],['deleteRenderbuffer',buffer],['deleteFramebuffer',frame]]);
  assert.equal(n.calls.filter(([name,,,,texture])=>name==='framebufferTexture2D'&&texture===null).length,2);assert.equal(n.wrapper.renderer,null);assert.equal(n.wrapper.renderTexture,null);assert.equal(n.wrapper.webGLFramebuffer,null);assert.equal(n.wrapper.attachments.length,0);
  const count=n.calls.length;n.wrapper.destroy();assert.equal(n.calls.length,count);assert.deepEqual(n.invalid,[]);
});
for(const newline of ['\n','\r\n'])test(`installer preserves every outside byte and ${newline==='\n'?'LF':'CRLF'}, and is idempotent`,async()=>{
  const directory=await fixture(newline);try{
    const before=await contents(directory);assert.deepEqual((await installer()(directory)).changed,files);const after=await contents(directory);
    for(let i=0;i<files.length;i++){
      const oldCondition=Buffer.from('if (this.webGLFramebuffer)'.replaceAll('\n',newline)),index=before[i].indexOf(oldCondition);
      const newCondition=Buffer.from(correctedCondition);
      assert.deepEqual(after[i],Buffer.concat([before[i].subarray(0,index),newCondition,before[i].subarray(index+oldCondition.length)]));
      const source=after[i].subarray(prefix.length,-suffix.length).toString();assert.equal(source.includes('\r'),newline==='\r\n');assert.equal(/(?<!\r)\n/.test(source),newline==='\n');
    }
    assert.deepEqual((await installer()(directory)).changed,[]);assert.deepEqual(await contents(directory),after);
  }finally{await rm(directory,{recursive:true,force:true});}
});
for(const mutation of ['wrong-name','wrong-version','missing-manifest','invalid-manifest','missing-source','missing-esm','missing-cjs','unknown-fragment','unknown-corrected-fragment','ambiguous-original','ambiguous-corrected','ambiguous-marker','mixed-original-corrected','mixed-target-newlines','mixed-file-newlines','mixed-source-bundle-state','mixed-corrected-source-original-bundles'])test(`API and CLI preflight reject ${mutation} without any partial write`,async()=>{
  const directory=await fixture();try{
    if(mutation==='wrong-name'||mutation==='wrong-version')await writeFile(join(directory,'package.json'),JSON.stringify({name:mutation==='wrong-name'?'other':'phaser',version:mutation==='wrong-version'?'4.2.2':'4.2.1'}));
    else if(mutation==='missing-manifest')await rm(join(directory,'package.json'));
    else if(mutation==='invalid-manifest')await writeFile(join(directory,'package.json'),'{');
    else if(mutation.startsWith('missing-'))await rm(join(directory,files[['missing-source','missing-esm','missing-cjs'].indexOf(mutation)]));
    else{
      const changed=original.replace('if (this.webGLFramebuffer)',correctedCondition);
      let source=original;
      if(mutation==='unknown-fragment')source=source.replace('gl.deleteFramebuffer(this.webGLFramebuffer);','gl.deleteFramebuffer(null);');
      if(mutation==='unknown-corrected-fragment')source=changed.replace('gl.deleteFramebuffer(this.webGLFramebuffer);','gl.deleteFramebuffer(null);');
      if(mutation==='ambiguous-original')source+=original;
      if(mutation==='ambiguous-corrected')source=changed+changed;
      if(mutation==='ambiguous-marker')source+='\n'+marker+'\n';
      if(mutation==='mixed-original-corrected')source+=changed;
      if(mutation==='mixed-target-newlines')source=source.replace('            gl.deleteFramebuffer(this.webGLFramebuffer);\n','            gl.deleteFramebuffer(this.webGLFramebuffer);\r\n');
      if(mutation==='mixed-file-newlines')source=source.replaceAll('\n','\r\n');
      if(mutation==='mixed-source-bundle-state'||mutation==='mixed-corrected-source-original-bundles')source=changed;
      await writeFile(join(directory,files[mutation==='mixed-corrected-source-original-bundles'?0:2]),source);
    }
    const before=await contents(directory);await assert.rejects(()=>installer()(directory),/Phaser|framebuffer|ENOENT|JSON/);assert.deepEqual(await contents(directory),before);
    const rejected=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(rejected.status,1,rejected.stderr);assert.match(rejected.stderr,/Phaser|framebuffer|ENOENT|JSON/);assert.equal(rejected.stdout,'');assert.deepEqual(await contents(directory),before);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('installer composes with audio, gamepad lifecycle and held-input corrections in either order',async()=>{
  const audio=(await readFile(new URL('./fixtures/phaser-audio-on-process-4.2.1.txt',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const gamepad=JSON.parse(await readFile(new URL('./fixtures/phaser-gamepad-4.2.1.json',import.meta.url),'utf8')).modules;
  const gamepadKey='src/input/gamepad/GamepadPlugin.js',held=gamepad['src/input/gamepad/Gamepad.js'].replace(/        if \(pad.timestamp < this._created\)\n        \{\n            return;\n        \}\n/,'        // Existing held-input correction; native Button owns edges.\n');
  for(const framebufferFirst of [true,false]){
    const directory=await fixture();try{
      await mkdir(join(directory,'src/loader/filetypes'),{recursive:true});await writeFile(join(directory,'src/loader/filetypes/AudioFile.js'),audio);
      await mkdir(join(directory,'src/input/gamepad'),{recursive:true});await writeFile(join(directory,gamepadKey),gamepad[gamepadKey]);
      for(const file of files.slice(1))await writeFile(join(directory,file),original+'\n'+audio+'\n'+gamepad[gamepadKey]+'\n'+held);
      if(framebufferFirst)await installer()(directory);
      await patchAudioDecode(directory);await patchGamepadLifecycle(directory);
      const before=await contents(directory);await installer()(directory);const after=await contents(directory);
      for(let i=1;i<files.length;i++)assert.equal(after[i].subarray(after[i].indexOf(Buffer.from(audio.slice(0,70)))).toString(),before[i].subarray(before[i].indexOf(Buffer.from(audio.slice(0,70)))).toString());
      assert.deepEqual((await installer()(directory)).changed,[]);assert.deepEqual((await patchAudioDecode(directory)).changed,[]);assert.deepEqual((await patchGamepadLifecycle(directory)).changed,[]);
    }finally{await rm(directory,{recursive:true,force:true});}
  }
});
test('CLI works for postinstall, rejects invalid calls, and importing has no side effect',async()=>{
  const directory=await fixture();try{
    installer();const before=await contents(directory);
    const imported=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(script.href)});`,directory],{encoding:'utf8'});assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout,'');assert.deepEqual(await contents(directory),before);
    const first=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(first.status,0,first.stderr);assert.deepEqual(JSON.parse(first.stdout).changed,files);
    const second=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(second.status,0,second.stderr);assert.deepEqual(JSON.parse(second.stdout).changed,[]);
    for(const args of [[],[directory,'extra']]){const invalid=spawnSync(process.execPath,[fileURLToPath(script),...args],{encoding:'utf8'});assert.equal(invalid.status,1);assert.match(invalid.stderr,/Usage:/);}
    await writeFile(join(directory,'package.json'),JSON.stringify({name:'phaser',version:'4.2.2'}));const snapshot=await contents(directory);const rejected=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(rejected.status,1);assert.match(rejected.stderr,/exactly phaser@4.2.1/);assert.deepEqual(await contents(directory),snapshot);
  }finally{await rm(directory,{recursive:true,force:true});}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {patchAudioDecode} from '../skills/engine-phaser/scripts/assets/phaser-audio-decode-patch.mjs';
import {patchAudioVisibility} from '../skills/engine-phaser/scripts/assets/phaser-audio-visibility-patch.mjs';
import {patchGamepadLifecycle} from '../skills/engine-phaser/scripts/assets/phaser-gamepad-lifecycle-patch.mjs';
import {patchFramebufferRestore} from '../skills/engine-phaser/scripts/assets/phaser-framebuffer-restore-patch.mjs';

// Complete pinned native DynamicTexture and Class; doubles only at external dependencies.
const {provenance,modules}=JSON.parse(await readFile(new URL('./fixtures/phaser-dynamic-texture-4.2.1.json',import.meta.url),'utf8'));
const sourceKey='src/textures/DynamicTexture.js',original=modules[sourceKey].replaceAll('\r\n','\n');
const files=[sourceKey,'dist/phaser.esm.js','dist/phaser.js'];
const marker='function DynamicTexture (manager, key, width, height, forceEven)';
const assignment='            frame.source.glTexture = this.drawingContext.texture;';
const disposal='            renderer.deleteTexture(frame.source.glTexture);\n';
const changed=original.replace(assignment,disposal+assignment);
const script=new URL('../skills/engine-phaser/scripts/assets/phaser-dynamic-texture-patch.mjs',import.meta.url);
const patch=existsSync(script)?(await import(script)).patchDynamicTexture:undefined;
const prefix=Buffer.from([0,255,195,169,10]),suffix=Buffer.from([10,254,0]);
async function fixture(newline='\n'){
  const directory=await mkdtemp(join(tmpdir(),'phaser-dynamic-texture-'));
  await writeFile(join(directory,'package.json'),JSON.stringify({name:'phaser',version:'4.2.1'}));
  for(const file of files){await mkdir(join(directory,file,'..'),{recursive:true});await writeFile(join(directory,file),Buffer.concat([prefix,Buffer.from(original.replaceAll('\n',newline)),suffix]));}
  return directory;
}
const contents=directory=>Promise.all(files.map(file=>readFile(join(directory,file)).catch(error=>error.code==='ENOENT'?null:Promise.reject(error))));
function installer(){assert.equal(typeof patch,'function','The guarded install-time DynamicTexture correction is missing.');return patch;}
async function corrected(){
  if(!patch)return original;
  const directory=await fixture();try{await installer()(directory);return (await readFile(join(directory,sourceKey))).subarray(prefix.length,-suffix.length).toString();}finally{await rm(directory,{recursive:true,force:true});}
}
function native(source=original){
  const calls=[],wrappers=[];let id=0;
  const allocate=owner=>{const wrapper={id:++id,owner,live:true};wrappers.push(wrapper);calls.push(['allocate',wrapper]);return wrapper;};
  const renderer={type:2,deleteTexture(wrapper){calls.push(['deleteTexture',wrapper]);assert.equal(wrapper.live,true,'no double disposal');wrapper.live=false;wrappers.splice(wrappers.indexOf(wrapper),1);}};
  function Texture(manager,key){
    this.manager=manager;this.key=key;
    let glTexture=allocate('TextureSource');
    const source={updateSize(width,height){this.width=width;this.height=height;}};
    Object.defineProperty(source,'glTexture',{get:()=>glTexture,set(value){calls.push(['assign',glTexture,value]);glTexture=value;}});
    this.frame={source,setSize(width,height){this.width=width;this.height=height;}};
  }
  Texture.prototype.add=function(){};Texture.prototype.get=function(){return this.frame;};
  Texture.prototype.destroy=function(){calls.push(['Texture.destroy']);renderer.deleteTexture(this.frame.source.glTexture);};
  function Camera(){};Camera.prototype.setScene=function(){return this;};Camera.prototype.setSize=function(){};Camera.prototype.destroy=function(){calls.push(['Camera.destroy']);};
  function DrawingContext(renderer,{width,height}){this.width=width;this.height=height;this.texture=allocate('DrawingContext');}
  DrawingContext.prototype.destroy=function(){calls.push(['DrawingContext.destroy']);};
  const dependencies={'../utils/Class':load(modules['src/utils/Class.js']), './Texture':Texture,'../cameras/2d/Camera':Camera,'../const':{CANVAS:1,WEBGL:2},'../renderer/webgl/DrawingContext':DrawingContext,'../display/canvas/CanvasPool':{remove(canvas){calls.push(['CanvasPool.remove',canvas]);}}};
  function load(body){const module={exports:{}};runInNewContext('(function(require,module,exports){'+body+'\n})',{})(name=>dependencies[name]??{},module,module.exports);return module.exports;}
  const Constructor=load(source),manager={game:{renderer,scene:{systemScene:{}}},stamp:null};
  return {create:()=>new Constructor(manager,'probe',8,8),renderer,calls,wrappers,manager};
}
test('fixture retains exact npm 4.2.1 source bytes and provenance',()=>{
  assert.equal(provenance.package,'phaser@4.2.1');assert.equal(provenance.tarballSha1,'5512f23d348e6fb5c48ce71a9fbddd200ef919ea');
  assert.equal(provenance.sha256[sourceKey],'5d4b3f535cd07a0fc433ba5a693725f499a541d16461ecb99f5da3d18d9610bf');
  assert.equal(provenance.sha256['src/utils/Class.js'],'ec859381c9ffee033cb22d0e91610d693d57c27ed527fb682a3707d76c2dfb8c');
  for(const [key,source] of Object.entries(modules))assert.equal(createHash('sha256').update(source).digest('hex'),provenance.sha256[key],key);
});
test('pinned native constructor leaves the TextureSource wrapper live after ordinary destroy',()=>{
  const n=native(),texture=n.create();assert.equal(n.wrappers.length,2);texture.destroy();assert.equal(n.wrappers.length,1);assert.equal(n.wrappers[0].owner,'TextureSource');assert.equal(n.wrappers[0].live,true);
});
test('native constructor disposes the source wrapper before assignment and retains its drawing-context texture',async()=>{
  const n=native(await corrected()),texture=n.create(),assignment=n.calls.findIndex(([name])=>name==='assign');
  const old=n.calls[assignment][1],retained=n.calls[assignment][2];
  assert.deepEqual(n.calls[assignment-1],['deleteTexture',old],'dispose the old wrapper immediately before replacement');
  assert.equal(old.live,false);assert.equal(retained.live,true);assert.equal(texture.get().source.glTexture,texture.drawingContext.texture);assert.deepEqual(n.wrappers,[retained]);
  assert.equal(texture.width,8);assert.equal(texture.height,8);
});
test('native ordinary destroy retires retained resources and repeated cycles leave no wrapper growth',async()=>{
  const n=native(await corrected());
  for(let cycle=0;cycle<8;cycle++){
    const texture=n.create(),context=texture.drawingContext,camera=texture.camera,retained=context.texture;texture.destroy();
    assert.equal(retained.live,false);assert.equal(n.wrappers.length,0,'each native create/destroy cycle must return to baseline');
    assert.equal(texture.canvas,null);assert.equal(texture.context,null);assert.equal(texture.renderer,null);assert.ok(camera);
  }
  assert.equal(n.calls.filter(([name])=>name==='deleteTexture').length,16);assert.equal(n.calls.filter(([name])=>name==='DrawingContext.destroy').length,8);assert.equal(n.calls.filter(([name])=>name==='Camera.destroy').length,8);
});
test('correction remains inside the native WebGL-only branch',async()=>{
  const source=await corrected();assert.ok(source.includes('        if (!isCanvas)\n        {\n            var frame = this.get();\n'+disposal+assignment+'\n        }'));
});
for(const newline of ['\n','\r\n'])test(`installer preserves every outside byte and ${newline==='\n'?'LF':'CRLF'}, and is idempotent`,async()=>{
  const directory=await fixture(newline);try{
    const before=await contents(directory);assert.deepEqual((await installer()(directory)).changed,files);const after=await contents(directory);
    for(let i=0;i<files.length;i++){
      const index=before[i].indexOf(Buffer.from(assignment));assert.deepEqual(after[i],Buffer.concat([before[i].subarray(0,index),Buffer.from(disposal.replaceAll('\n',newline)),before[i].subarray(index)]));
      const source=after[i].subarray(prefix.length,-suffix.length).toString();assert.equal(source.includes('\r'),newline==='\r\n');assert.equal(/(?<!\r)\n/.test(source),newline==='\n');
    }
    assert.deepEqual((await installer()(directory)).changed,[]);assert.deepEqual(await contents(directory),after);
  }finally{await rm(directory,{recursive:true,force:true});}
});
for(const mutation of ['wrong-name','wrong-version','missing-manifest','invalid-manifest','missing-source','missing-esm','missing-umd','unknown-fragment','unknown-corrected-fragment','ambiguous-original','ambiguous-corrected','ambiguous-marker','mixed-original-corrected','mixed-fragment-newlines','mixed-target-newlines','mixed-original-source-corrected-bundle','mixed-corrected-source-original-bundles'])test(`API and CLI preflight reject ${mutation} without any partial write`,async()=>{
  const directory=await fixture();try{
    if(mutation==='wrong-name'||mutation==='wrong-version')await writeFile(join(directory,'package.json'),JSON.stringify({name:mutation==='wrong-name'?'other':'phaser',version:mutation==='wrong-version'?'4.2.2':'4.2.1'}));
    else if(mutation==='missing-manifest')await rm(join(directory,'package.json'));
    else if(mutation==='invalid-manifest')await writeFile(join(directory,'package.json'),'{');
    else if(mutation.startsWith('missing-'))await rm(join(directory,files[['missing-source','missing-esm','missing-umd'].indexOf(mutation)]));
    else{
      let source=original;
      if(mutation==='unknown-fragment')source=source.replace(assignment,assignment.replace('this.drawingContext.texture','null'));
      if(mutation==='unknown-corrected-fragment')source=changed.replace(disposal,disposal.replace('frame.source.glTexture','null'));
      if(mutation==='ambiguous-original')source+=original;
      if(mutation==='ambiguous-corrected')source=changed+changed;
      if(mutation==='ambiguous-marker')source+='\n'+marker+'\n';
      if(mutation==='mixed-original-corrected')source+=changed;
      if(mutation==='mixed-fragment-newlines')source=source.replace(assignment+'\n',assignment+'\r\n');
      if(mutation==='mixed-target-newlines')source=source.replaceAll('\n','\r\n');
      if(mutation==='mixed-original-source-corrected-bundle'||mutation==='mixed-corrected-source-original-bundles')source=changed;
      await writeFile(join(directory,files[mutation==='mixed-corrected-source-original-bundles'?0:2]),source);
    }
    const before=await contents(directory);await assert.rejects(()=>installer()(directory),/Phaser|DynamicTexture|ENOENT|JSON/);assert.deepEqual(await contents(directory),before);
    const rejected=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(rejected.status,1,rejected.stderr);assert.match(rejected.stderr,/Phaser|DynamicTexture|ENOENT|JSON/);assert.equal(rejected.stdout,'');assert.deepEqual(await contents(directory),before);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('installer composes with all existing native helpers and preserves held-input correction in either order',async()=>{
  const audio=await readFile(new URL('./fixtures/phaser-audio-on-process-4.2.1.txt',import.meta.url),'utf8'),visible=await readFile(new URL('./fixtures/phaser-audio-visible-4.2.1.txt',import.meta.url),'utf8');
  const gamepad=JSON.parse(await readFile(new URL('./fixtures/phaser-gamepad-4.2.1.json',import.meta.url),'utf8')).modules,framebuffer=JSON.parse(await readFile(new URL('./fixtures/phaser-framebuffer-4.2.1.json',import.meta.url),'utf8')).modules;
  const peers={'src/loader/filetypes/AudioFile.js':audio,'src/sound/webaudio/WebAudioSoundManager.js':visible,'src/input/gamepad/GamepadPlugin.js':gamepad['src/input/gamepad/GamepadPlugin.js'],'src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js':framebuffer['src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js']};
  const held=gamepad['src/input/gamepad/Gamepad.js'].replace(/        if \(pad.timestamp < this._created\)\n        \{\n            return;\n        \}\n/,'        // Existing held-input correction; native Button owns edges.\n');
  const helpers=[patchAudioDecode,patchAudioVisibility,patchGamepadLifecycle,patchFramebufferRestore];
  for(const dynamicFirst of [true,false]){
    const directory=await fixture();try{
      for(const [file,source] of Object.entries(peers)){await mkdir(join(directory,file,'..'),{recursive:true});await writeFile(join(directory,file),source);}
      const tail='\n'+[...Object.values(peers),held].join('\n');for(const file of files.slice(1))await writeFile(join(directory,file),original+tail);
      if(dynamicFirst)await installer()(directory);for(const helper of helpers)await helper(directory);
      const before=await contents(directory);await installer()(directory);const after=await contents(directory);
      for(let i=1;i<files.length;i++){const anchor=Buffer.from(audio.slice(0,70));assert.deepEqual(after[i].subarray(after[i].indexOf(anchor)),before[i].subarray(before[i].indexOf(anchor)));assert.ok(after[i].includes(Buffer.from(held)));}
      assert.deepEqual((await installer()(directory)).changed,[]);for(const helper of helpers)assert.deepEqual((await helper(directory)).changed,[]);
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
  }finally{await rm(directory,{recursive:true,force:true});}
});

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
import {patchDynamicTexture} from '../skills/engine-phaser/scripts/assets/phaser-dynamic-texture-patch.mjs';

// Complete npm native owners and Class; only GL and external dependencies are doubled.
const {provenance,modules}=JSON.parse(await readFile(new URL('./fixtures/phaser-texture-units-4.2.1.json',import.meta.url),'utf8'));
const ownerKey='src/renderer/webgl/wrappers/WebGLTextureUnitsWrapper.js',rendererKey='src/renderer/webgl/WebGLRenderer.js';
const owner=modules[ownerKey].replaceAll('\r\n','\n'),rendererSource=modules[rendererKey].replaceAll('\r\n','\n');
const files=[ownerKey,rendererKey,'dist/phaser.esm.js','dist/phaser.js'];
const marker='function WebGLTextureUnitsWrapper (renderer)',rendererMarker='function WebGLRenderer (game)';
const script=new URL('../skills/engine-phaser/scripts/assets/phaser-texture-units-patch.mjs',import.meta.url);
const patch=existsSync(script)?(await import(script)).patchTextureUnits:undefined;
const prefix=Buffer.from([0,255,195,169,10]),suffix=Buffer.from([10,254,0]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const originalFor=file=>file===ownerKey?owner:file===rendererKey?rendererSource:owner+'\n'+rendererSource;
async function fixture(newline='\n'){
  const directory=await mkdtemp(join(tmpdir(),'phaser-texture-units-'));
  await writeFile(join(directory,'package.json'),JSON.stringify({name:'phaser',version:'4.2.1'}));
  for(const file of files){await mkdir(join(directory,file,'..'),{recursive:true});await writeFile(join(directory,file),Buffer.concat([prefix,Buffer.from(originalFor(file).replaceAll('\n',newline)),suffix]));}
  return directory;
}
const contents=directory=>Promise.all(files.map(file=>readFile(join(directory,file)).catch(error=>error.code==='ENOENT'?null:Promise.reject(error))));
function installer(){assert.equal(typeof patch,'function','The guarded install-time TextureUnits ownership correction is missing.');return patch;}
async function corrected(){
  if(!patch)return {owner,rendererSource};
  const directory=await fixture();try{await installer()(directory);return {owner:(await readFile(join(directory,ownerKey))).subarray(prefix.length,-suffix.length).toString(),rendererSource:(await readFile(join(directory,rendererKey))).subarray(prefix.length,-suffix.length).toString()};}finally{await rm(directory,{recursive:true,force:true});}
}
function native(source={owner,rendererSource}){
  const calls=[],handles=[],bindings=[];let active=0,epoch=0,lost=false;
  const gl={TEXTURE_2D:3553,RGBA:6408,UNSIGNED_BYTE:5121,
    createTexture(){const handle={id:handles.length+1,epoch,live:true};handles.push(handle);calls.push(['create',handle]);return handle;},
    isContextLost:()=>lost,isTexture:handle=>!!handle&&handle.live&&handle.epoch===epoch&&!lost,
    deleteTexture(handle){assert.equal(gl.isTexture(handle),true,'never delete an invalidated or already retired texture');handle.live=false;calls.push(['delete',handle]);},
    bindTexture(target,handle){bindings[active]=handle;calls.push(['bind',active,target,handle]);},
    texImage2D(...args){calls.push(['upload',...args.slice(0,-1),Array.from(args.at(-1))]);}
  };
  function EventEmitter(){};EventEmitter.prototype.off=function(){calls.push(['off']);};EventEmitter.prototype.removeAllListeners=function(){calls.push(['removeAllListeners']);};EventEmitter.prototype.emit=function(event){calls.push(['emit',event]);};
  let Class;
  function load(body,deps={}){const module={exports:{}};runInNewContext('(function(require,module,exports){'+body+'\n})',{console:{warn:message=>calls.push(['warn',message])},DEBUG:false})(name=>deps[name]??{},module,module.exports);return module.exports;}
  Class=load(modules['src/utils/Class.js']);
  const arrayEach=(array,callback)=>array.forEach(callback);
  const Renderer=load(source.rendererSource,{'../../utils/Class':Class,'eventemitter3':EventEmitter,'../../utils/array/Each':arrayEach,'./parameters/WebGLGlobalParametersFactory':{getDefault:()=>({})}});
  const renderer=Object.create(Renderer.prototype);
  Object.assign(renderer,{gl,maxTextures:4,contextLost:false,game:{scale:{baseSize:{width:8,height:8}}},canvas:{removeEventListener(name){calls.push(['removeEventListener',name]);}},baseDrawingContext:{resize(){}},extensions:{},glBufferWrappers:[],glFramebufferWrappers:[],glProgramWrappers:[],glTextureWrappers:[],glVAOWrappers:[],setExtensions(){calls.push(['setExtensions']);},getCompressedTextures(){calls.push(['compression']);return {};},resize(){calls.push(['resize']);},glWrapper:{update(){calls.push(['update']);},updateBindingsActiveTexture({bindings:{activeTexture}},force){active=activeTexture;calls.push(['active',active,force]);}}});
  const Owner=load(source.owner,{'../../../utils/Class':Class});renderer.glTextureUnits=new Owner(renderer);
  return {renderer,units:renderer.glTextureUnits,gl,handles,calls,bindings,get active(){return active;},lose(){lost=true;renderer.contextLost=true;calls.push(['lose',epoch]);},restore(){lost=false;epoch++;renderer.dispatchContextRestored({preventDefault(){calls.push(['preventDefault']);}});},live:()=>handles.filter(handle=>gl.isTexture(handle))};
}

test('fixture retains integrity-bound npm 4.2.1 native source and renderer destroy contract',()=>{
  assert.equal(provenance.package,'phaser@4.2.1');assert.equal(provenance.tarballSha1,'5512f23d348e6fb5c48ce71a9fbddd200ef919ea');assert.equal(provenance.tarballSha256,'10c483ef182f0e2aafdc2a11b3bcf86cedb02a4b62a14cfce673b2f9b714318b');
  assert.equal(provenance.tarballIntegrity,'sha512-WUNwCPJpdjvZiuT6SgCfYVW8Qw/3j0jJ4ws7P2QkhFLFu74sbGuyHJcbFueGkY/AYO4Pi47bNQXn1OCJeLX//w==');
  assert.equal(provenance.sha256[ownerKey],'b8cfcbbee5aff0ad2857129b69387b082ff865c970c91be5df5fda3d1874f0c3');assert.equal(provenance.sha256[rendererKey],'6506cfc97e6e1047953c5b5b60748f7f0f262dd2ff4bb4fa562b215756e89c95');
  assert.equal(provenance.sha256['src/utils/Class.js'],'ec859381c9ffee033cb22d0e91610d693d57c27ed527fb682a3707d76c2dfb8c');
  for(const [key,source] of Object.entries(modules))assert.equal(hash(Buffer.from(source)),provenance.sha256[key],key);
});
test('pinned native Renderer.destroy leaks the bare sampler placeholder',()=>{const n=native();n.renderer.destroy();assert.equal(n.live().length,1);});
test('native ordinary renderer destruction retires the still-valid placeholder while GL is available',async()=>{
  const n=native(await corrected()),handle=n.handles[0];assert.equal(n.gl.isTexture(handle),true);n.renderer.destroy();assert.equal(n.gl.isTexture(handle),false,'native renderer teardown must release its bare sampler placeholder');
  assert.equal(n.live().length,0);assert.equal(n.units.renderer,null);assert.equal(n.units.tempTexture,null);assert.deepEqual(Array.from(n.units.units),[]);assert.deepEqual(Array.from(n.units.unitIndices),[]);assert.equal(n.renderer.gl,null);
  assert.ok(n.calls.findIndex(([name])=>name==='delete')<n.calls.findIndex(([name])=>name==='removeAllListeners'));
  n.units.destroy();assert.equal(n.calls.filter(([name])=>name==='delete').length,1);
});
test('same-context init releases the previous owned texture and retains one complete placeholder',async()=>{
  const n=native(await corrected());for(let i=0;i<6;i++){const old=n.handles.at(-1);n.units.init();assert.equal(n.gl.isTexture(old),false,'live reinit must not accumulate placeholders');assert.equal(n.live().length,1);assert.equal(n.units.tempTexture,n.handles.at(-1));assert.ok(n.bindings.every(handle=>handle===n.units.tempTexture&&n.gl.isTexture(handle)));assert.equal(n.active,0);}
  n.units.destroy();n.units.destroy();assert.equal(n.live().length,0);assert.equal(n.calls.filter(([name])=>name==='delete').length,7);
});
test('placeholder remains valid on all units and blue upload, ordinary bind/null/unbind behavior is native',async()=>{
  const initial=native(await corrected());assert.equal(initial.units.tempTexture,initial.handles[0]);assert.equal(initial.live().length,1);assert.ok(initial.bindings.every(handle=>initial.gl.isTexture(handle)));assert.deepEqual(Array.from(initial.units.units),[undefined,undefined,undefined,undefined]);assert.deepEqual(Array.from(initial.units.unitIndices),[0,1,2,3]);assert.equal(initial.active,0);
  const exercise=n=>{const texture={webGLTexture:{wrapped:true},needsMipmapRegeneration:true,generateMipmap(){n.calls.push(['mipmap']);this.needsMipmapRegeneration=false;}};n.units.bind(texture,2);n.units.bind(texture,2,false,false);n.units.bind(texture,1);n.units.bindUnits([null,undefined,texture,null]);n.units.unbindTexture(texture);n.units.unbindAllUnits();};
  const unpatched=native(),patched=native(await corrected());exercise(unpatched);exercise(patched);assert.deepEqual(patched.calls,unpatched.calls);assert.deepEqual(patched.calls.find(([name])=>name==='upload'),['upload',3553,0,6408,1,1,0,6408,5121,[0,0,255,255]]);assert.equal(patched.active,0);assert.equal(patched.live().length,1,'ordinary unbind must not dispose the lifetime placeholder');
});
test('native restore never deletes invalidated handles and preserves resource restoration order across two epochs',async()=>{
  const n=native(await corrected()),order=[];
  for(const [field,name] of [['glTextureWrappers','texture'],['glBufferWrappers','buffer'],['glFramebufferWrappers','framebuffer'],['glProgramWrappers','program'],['glVAOWrappers','vao']])n.renderer[field].push({createResource(){assert.equal(n.live().length,1);assert.ok(n.bindings.every(handle=>n.gl.isTexture(handle)));order.push(name);},destroy(){order.push('destroy-'+name);}});
  for(let i=0;i<2;i++){const old=n.units.tempTexture;n.lose();assert.equal(n.gl.isTexture(old),false);n.restore();assert.equal(n.calls.filter(([name])=>name==='delete').length,0,'context-freed handles must not receive delete calls');assert.equal(n.live().length,1);assert.equal(n.gl.isTexture(old),false);assert.equal(n.renderer.contextLost,false);assert.equal(n.active,0);}
  assert.deepEqual(order,['texture','buffer','framebuffer','program','vao','texture','buffer','framebuffer','program','vao']);n.renderer.destroy();assert.equal(n.live().length,0);assert.equal(n.calls.filter(([name])=>name==='delete').length,1);assert.equal(n.renderer.glFramebufferWrappers.length,1,'retained dead arrays are not a live-resource leak');
});
test('destroy while context is lost clears owner references without deleting an invalidated placeholder',async()=>{
  const n=native(await corrected());n.lose();n.renderer.destroy();assert.equal(n.calls.filter(([name])=>name==='delete').length,0);assert.equal(n.units.renderer,null);assert.equal(n.units.tempTexture,null);assert.equal(n.units.units.length,0);n.units.destroy();assert.equal(n.calls.filter(([name])=>name==='delete').length,0);
});

for(const newline of ['\n','\r\n'])test(`API preserves every outside byte and ${newline==='\n'?'LF':'CRLF'} and is idempotent`,async()=>{
  const directory=await fixture(newline);try{
    const before=await contents(directory);assert.deepEqual((await installer()(directory)).changed,files);const after=await contents(directory);
    for(let i=0;i<files.length;i++){assert.deepEqual(after[i].subarray(0,prefix.length),prefix);assert.deepEqual(after[i].subarray(-suffix.length),suffix);const text=after[i].subarray(prefix.length,-suffix.length).toString();assert.equal(text.includes('\r'),newline==='\r\n');assert.equal(/(?<!\r)\n/.test(text),newline==='\n');assert.ok(after[i].length>before[i].length);}
    // Reversing only the three specified ownership insertions must recover every original byte.
    for(let i=0;i<files.length;i++){
      let text=after[i].subarray(prefix.length,-suffix.length).toString().replaceAll('\r\n','\n');
      text=text.replace(/        \/\/ Release only a still-live placeholder from this context\.\n        if \(this.tempTexture && !gl.isContextLost\(\) && gl.isTexture\(this.tempTexture\)\)\n        \{\n            gl.deleteTexture\(this.tempTexture\);\n        }\n\n/,'').replace('var tempTexture = this.tempTexture = gl.createTexture();','var tempTexture = gl.createTexture();');
      text=text.replace(/    },\n\n    \/\*\*\n     \* Releases the owned sampler placeholder[\s\S]*?        this.renderer = null;\n    }\n\}\);/,'    }\n});').replace('        this.glTextureUnits.destroy();\n\n','');
      assert.deepEqual(Buffer.concat([prefix,Buffer.from(text.replaceAll('\n',newline)),suffix]),before[i]);
    }
    assert.deepEqual((await installer()(directory)).changed,[]);assert.deepEqual(await contents(directory),after);
  }finally{await rm(directory,{recursive:true,force:true});}
});
const mutations=['wrong-name','wrong-version','missing-manifest','invalid-manifest','null-manifest','missing-owner','missing-renderer','missing-esm','missing-umd','unknown-owner-marker','unknown-renderer-marker','unknown-owner-init','unknown-owner-tail','unknown-renderer','unknown-corrected-init','unknown-corrected-tail','unknown-corrected-renderer','duplicate-owner','duplicate-renderer','duplicate-owner-marker','duplicate-renderer-marker','duplicate-init','duplicate-tail','duplicate-renderer-fragment','duplicate-corrected-init','duplicate-corrected-tail','duplicate-corrected-renderer','mixed-fragment-newlines','mixed-tail-newlines','mixed-renderer-newlines','mixed-target-newlines','mixed-wrapper-fragments','mixed-bundle-fragments'];
for(let mask=1;mask<15;mask++)mutations.push('mixed-target-states-'+mask);
for(const mutation of mutations)test(`API and CLI reject ${mutation} before any writes`,async()=>{
  const directory=await fixture();try{
    if(mutation==='wrong-name'||mutation==='wrong-version')await writeFile(join(directory,'package.json'),JSON.stringify({name:mutation==='wrong-name'?'other':'phaser',version:mutation==='wrong-version'?'4.2.2':'4.2.1'}));
    else if(mutation==='missing-manifest')await rm(join(directory,'package.json'));
    else if(mutation==='invalid-manifest')await writeFile(join(directory,'package.json'),'{');
    else if(mutation==='null-manifest')await writeFile(join(directory,'package.json'),'null');
    else if(mutation.startsWith('missing-'))await rm(join(directory,files[['missing-owner','missing-renderer','missing-esm','missing-umd'].indexOf(mutation)]));
    else if(mutation.startsWith('mixed-target-states-')){
      const clean=await corrected(),mask=Number(mutation.split('-').at(-1));for(let i=0;i<files.length;i++)if(mask&(1<<i))await writeFile(join(directory,files[i]),files[i]===ownerKey?clean.owner:files[i]===rendererKey?clean.rendererSource:clean.owner+'\n'+clean.rendererSource);
    }else{
      let text=originalFor(files[2]);
      if(mutation==='unknown-owner-marker')text=text.replace(marker,'function UnknownTextureUnitsWrapper (renderer)');
      if(mutation==='unknown-renderer-marker')text=text.replace(rendererMarker,'function UnknownWebGLRenderer (game)');
      if(mutation==='unknown-owner-init')text=text.replace('var tempTexture = gl.createTexture();','var tempTexture = null;');
      if(mutation==='unknown-owner-tail')text=text.replace('this.bind(null, i, true, false);\n        }\n    }','this.bind(null, i, false, false);\n        }\n    }');
      if(mutation==='unknown-renderer')text=text.replace('ArrayEach(this.glTextureWrappers, wrapperDestroy);','ArrayEach([], wrapperDestroy);');
      if(mutation==='duplicate-owner')text+='\n'+owner;
      if(mutation==='duplicate-renderer')text+='\n'+rendererSource;
      if(mutation==='duplicate-owner-marker')text+='\n'+marker;
      if(mutation==='duplicate-renderer-marker')text+='\n'+rendererMarker;
      if(mutation==='duplicate-init')text+='\n'+owner.slice(owner.indexOf('        var gl = this.renderer.gl;'),owner.indexOf('        for (var unit ='));
      if(mutation==='duplicate-tail')text+='\n'+owner.slice(owner.indexOf('    unbindAllUnits: function'),owner.indexOf('module.exports'));
      if(mutation==='duplicate-renderer-fragment')text+='\n'+rendererSource.slice(rendererSource.indexOf('        var wrapperDestroy ='),rendererSource.indexOf('        this.removeAllListeners();')+'        this.removeAllListeners();\n'.length);
      if(mutation.includes('corrected')){
        const clean=await corrected();text=clean.owner+'\n'+clean.rendererSource;
        if(mutation==='unknown-corrected-init')text=text.replace('var tempTexture = this.tempTexture = gl.createTexture();','var tempTexture = this.tempTexture = null;');
        if(mutation==='unknown-corrected-tail')text=text.replace('        this.tempTexture = null;','        this.tempTexture = undefined;');
        if(mutation==='unknown-corrected-renderer')text=text.replace('        this.glTextureUnits.destroy();','        this.glTextureUnits.destroy(false);');
        if(mutation==='duplicate-corrected-init')text+='\n'+clean.owner.slice(clean.owner.indexOf('        var gl = this.renderer.gl;'),clean.owner.indexOf('        for (var unit ='));
        if(mutation==='duplicate-corrected-tail')text+='\n'+clean.owner.slice(clean.owner.indexOf('    unbindAllUnits: function'),clean.owner.indexOf('module.exports'));
        if(mutation==='duplicate-corrected-renderer')text+='\n'+clean.rendererSource.slice(clean.rendererSource.indexOf('        var wrapperDestroy ='),clean.rendererSource.indexOf('        this.removeAllListeners();')+'        this.removeAllListeners();\n'.length);
      }
      if(mutation==='mixed-fragment-newlines')text=text.replace('        var tempTexture = gl.createTexture();\n','        var tempTexture = gl.createTexture();\r\n');
      if(mutation==='mixed-tail-newlines')text=owner.slice(0,owner.indexOf('    unbindAllUnits: function'))+owner.slice(owner.indexOf('    unbindAllUnits: function')).replaceAll('\n','\r\n')+'\n'+rendererSource;
      if(mutation==='mixed-renderer-newlines')text=owner+'\n'+rendererSource.replaceAll('\n','\r\n');
      if(mutation==='mixed-target-newlines')text=text.replaceAll('\n','\r\n');
      if(mutation==='mixed-wrapper-fragments'||mutation==='mixed-bundle-fragments'){
        const clean=await corrected();text=mutation==='mixed-bundle-fragments'?clean.owner+'\n'+rendererSource:clean.owner.slice(0,clean.owner.indexOf('    unbindAllUnits: function'))+owner.slice(owner.indexOf('    unbindAllUnits: function'))+'\n'+clean.rendererSource;
      }
      await writeFile(join(directory,files[2]),text);
    }
    const before=await contents(directory);await assert.rejects(()=>installer()(directory),/Phaser|TextureUnits|ENOENT|JSON/);assert.deepEqual(await contents(directory),before);
    const rejected=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(rejected.status,1,rejected.stderr);assert.match(rejected.stderr,/Phaser|TextureUnits|ENOENT|JSON/);assert.equal(rejected.stdout,'');assert.deepEqual(await contents(directory),before);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('installer composes with the five existing helpers without changing their corrected APIs or held-input fragment',async()=>{
  const audio=await readFile(new URL('./fixtures/phaser-audio-on-process-4.2.1.txt',import.meta.url),'utf8'),visible=await readFile(new URL('./fixtures/phaser-audio-visible-4.2.1.txt',import.meta.url),'utf8');
  const gamepad=JSON.parse(await readFile(new URL('./fixtures/phaser-gamepad-4.2.1.json',import.meta.url),'utf8')).modules,framebuffer=JSON.parse(await readFile(new URL('./fixtures/phaser-framebuffer-4.2.1.json',import.meta.url),'utf8')).modules,dynamic=JSON.parse(await readFile(new URL('./fixtures/phaser-dynamic-texture-4.2.1.json',import.meta.url),'utf8')).modules;
  const peers={'src/loader/filetypes/AudioFile.js':audio,'src/sound/webaudio/WebAudioSoundManager.js':visible,'src/input/gamepad/GamepadPlugin.js':gamepad['src/input/gamepad/GamepadPlugin.js'],'src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js':framebuffer['src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js'],'src/textures/DynamicTexture.js':dynamic['src/textures/DynamicTexture.js']};
  const held=gamepad['src/input/gamepad/Gamepad.js'].replace(/        if \(pad.timestamp < this._created\)\n        \{\n            return;\n        \}\n/,'        // Existing held-input correction; native Button owns edges.\n');
  const helpers=[patchAudioDecode,patchAudioVisibility,patchGamepadLifecycle,patchFramebufferRestore,patchDynamicTexture];
  for(const ownershipFirst of [true,false]){
    const directory=await fixture();try{
      for(const [file,source] of Object.entries(peers)){await mkdir(join(directory,file,'..'),{recursive:true});await writeFile(join(directory,file),source);}
      const tail='\n'+[...Object.values(peers),held].join('\n');for(const file of files.slice(2))await writeFile(join(directory,file),originalFor(file)+tail);
      if(ownershipFirst)await installer()(directory);for(const helper of helpers)await helper(directory);
      const before=await contents(directory);await installer()(directory);const after=await contents(directory);
      for(let i=2;i<files.length;i++){const anchor=Buffer.from(audio.slice(0,70));assert.deepEqual(after[i].subarray(after[i].indexOf(anchor)),before[i].subarray(before[i].indexOf(anchor)));assert.ok(after[i].includes(Buffer.from(held)));}
      assert.deepEqual((await installer()(directory)).changed,[]);for(const helper of helpers)assert.deepEqual((await helper(directory)).changed,[]);
    }finally{await rm(directory,{recursive:true,force:true});}
  }
});
test('CLI supports postinstall, validates usage and importing does not patch',async()=>{
  const directory=await fixture();try{
    installer();const before=await contents(directory);const imported=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(script.href)});`,directory],{encoding:'utf8'});assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout,'');assert.deepEqual(await contents(directory),before);
    const first=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(first.status,0,first.stderr);assert.deepEqual(JSON.parse(first.stdout).changed,files);const second=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(second.status,0,second.stderr);assert.deepEqual(JSON.parse(second.stdout).changed,[]);
    for(const args of [[],[directory,'extra']]){const invalid=spawnSync(process.execPath,[fileURLToPath(script),...args],{encoding:'utf8'});assert.equal(invalid.status,1);assert.match(invalid.stderr,/Usage:/);}
  }finally{await rm(directory,{recursive:true,force:true});}
});

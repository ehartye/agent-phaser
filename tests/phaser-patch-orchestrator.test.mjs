import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PATCH_IDS,patchPhaser} from '../examples/node/patch-phaser.mjs';
import {patchGamepadHeldInput} from '../skills/phaser-input/scripts/assets/phaser-gamepad-held-input-patch.mjs';
import {patchGamepadLifecycle} from '../skills/phaser-input/scripts/assets/phaser-gamepad-lifecycle-patch.mjs';
import {patchAudioDecode} from '../skills/phaser-audio/scripts/assets/phaser-audio-decode-patch.mjs';
import {patchAudioVisibility} from '../skills/phaser-audio/scripts/assets/phaser-audio-visibility-patch.mjs';
import {patchDynamicTexture} from '../skills/phaser-rendering/scripts/assets/phaser-dynamic-texture-patch.mjs';
import {patchFramebufferRestore} from '../skills/phaser-rendering/scripts/assets/phaser-framebuffer-restore-patch.mjs';
import {patchTextureUnits} from '../skills/phaser-rendering/scripts/assets/phaser-texture-units-patch.mjs';

// Use the installers' existing pinned native fixtures, rather than retyping
// patch fragments or downloading an engine in the dependency-free merge lane.
const modules={};
for(const name of ['gamepad','dynamic-texture','framebuffer','texture-units']){
  Object.assign(modules,JSON.parse(await readFile(new URL(`./fixtures/phaser-${name}-4.2.1.json`,import.meta.url),'utf8')).modules);
}
const decode=await readFile(new URL('./fixtures/phaser-audio-on-process-4.2.1.txt',import.meta.url),'utf8');
const visibility=await readFile(new URL('./fixtures/phaser-audio-visible-4.2.1.txt',import.meta.url),'utf8');
const sources={
  'src/input/gamepad/Gamepad.js':modules['src/input/gamepad/Gamepad.js'],
  'src/input/gamepad/GamepadPlugin.js':modules['src/input/gamepad/GamepadPlugin.js'],
  'src/loader/filetypes/AudioFile.js':decode.slice(decode.indexOf('     * @method Phaser.Loader.FileTypes.AudioFile#onProcess')),
  'src/sound/webaudio/WebAudioSoundManager.js':visibility.slice(visibility.indexOf('     * @method Phaser.Sound.WebAudioSoundManager#onGameVisible'),visibility.indexOf('// End extracted native fragment.')),
  'src/textures/DynamicTexture.js':modules['src/textures/DynamicTexture.js'],
  'src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js':modules['src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js'],
  'src/renderer/webgl/wrappers/WebGLTextureUnitsWrapper.js':modules['src/renderer/webgl/wrappers/WebGLTextureUnitsWrapper.js'],
  'src/renderer/webgl/WebGLRenderer.js':modules['src/renderer/webgl/WebGLRenderer.js'],
};
const standalone=[patchGamepadHeldInput,patchGamepadLifecycle,patchAudioDecode,patchAudioVisibility,patchDynamicTexture,patchFramebufferRestore,patchTextureUnits];
const script=fileURLToPath(new URL('../examples/node/patch-phaser.mjs',import.meta.url));
const bundles=['dist/phaser.esm.js','dist/phaser.js'];
const files=['package.json',...Object.keys(sources),...bundles,'unrelated.bin'];
const prefix=Buffer.from([0,255,195,169,10]),suffix=Buffer.from([10,254,0]);
async function fixture(newline='\n'){
  const root=await mkdtemp(join(tmpdir(),'phaser orchestrator-'));
  const directory=join(root,'package'),staging=join(root,'staging');
  await mkdir(directory);await mkdir(staging);
  await writeFile(join(directory,'package.json'),JSON.stringify({name:'phaser',version:'4.2.1'}));
  const body=Object.values(sources).join('\n// Next pinned module\n');
  for(const [file,text] of [...Object.entries(sources),...bundles.map(file=>[file,body])]){
    await mkdir(dirname(join(directory,file)),{recursive:true});
    await writeFile(join(directory,file),Buffer.concat([prefix,Buffer.from(text.replaceAll('\r\n','\n').replaceAll('\n',newline)),suffix]));
  }
  await writeFile(join(directory,'unrelated.bin'),Buffer.from([255,0,128,9]));
  return {root,directory,staging};
}
const snapshot=async directory=>Object.fromEntries(await Promise.all(files.map(async file=>[file,await readFile(join(directory,file)).catch(error=>error.code==='ENOENT'?null:Promise.reject(error))])));
const hashes=async directory=>Object.fromEntries(Object.entries(await snapshot(directory)).map(([file,bytes])=>[file,bytes===null?null:createHash('sha256').update(bytes).digest('hex')]));
// Absolute entrypoint, unrelated cwd and a package path containing spaces.
const cli=(fixture,args)=>spawnSync(process.execPath,[script,fixture.directory,...args],{cwd:fixture.root,encoding:'utf8',env:{...process.env,TMPDIR:fixture.staging,TEMP:fixture.staging,TMP:fixture.staging}});
async function using(run,newline){const f=await fixture(newline);try{await run(f);}finally{await rm(f.root,{recursive:true,force:true});}}

for(const [index,id] of PATCH_IDS.entries())test(`explicit ${id} matches its standalone installer and leaves unselected content intact`,async()=>{
  await using(async f=>{
    const expected=await fixture();
    try{
      const changed=(await standalone[index](expected.directory)).changed;
      const result=await patchPhaser(f.directory,{patches:[id]});
      assert.deepEqual(result,{patches:[id],changed,verified:true});
      assert.deepEqual(await snapshot(f.directory),await snapshot(expected.directory));
      assert.deepEqual((await patchPhaser(f.directory,{patches:[id]})).changed,[]);
    }finally{await rm(expected.root,{recursive:true,force:true});}
  });
});

for(const newline of ['\n','\r\n'])test(`all seven compose in fixed order, preserve unrelated bytes and repeat (${newline==='\n'?'LF':'CRLF'})`,async()=>{
  await using(async f=>{
    const result=await patchPhaser(f.directory,{patches:[...PATCH_IDS].reverse()});
    assert.deepEqual(result.patches,PATCH_IDS);
    assert.equal(new Set(result.changed).size,10);
    for(const file of result.changed){
      const bytes=await readFile(join(f.directory,file));
      assert.deepEqual(bytes.subarray(0,prefix.length),prefix);assert.deepEqual(bytes.subarray(-suffix.length),suffix);
      const text=bytes.subarray(prefix.length,-suffix.length).toString();
      assert.equal(newline==='\r\n'?/(?<!\r)\n/.test(text):text.includes('\r'),false,file);
    }
    assert.deepEqual((await patchPhaser(f.directory,{patches:PATCH_IDS})).changed,[]);
    assert.equal((await patchPhaser(f.directory,{patches:PATCH_IDS,verify:true})).verified,true);
  },newline);
});

test('a selected subset accepts another complete pre-applied patch and does not select the rest',async()=>{
  await using(async f=>{
    await patchAudioDecode(f.directory);
    const before=await snapshot(f.directory);
    const result=await patchPhaser(f.directory,{patches:['audio-decode','gamepad-held-input']});
    assert.deepEqual(result.patches,['gamepad-held-input','audio-decode']);
    assert.deepEqual(result.changed,['src/input/gamepad/Gamepad.js',...bundles]);
    assert.deepEqual(await readFile(join(f.directory,'src/loader/filetypes/AudioFile.js')),before['src/loader/filetypes/AudioFile.js']);
    assert.deepEqual(await readFile(join(f.directory,'src/input/gamepad/GamepadPlugin.js')),before['src/input/gamepad/GamepadPlugin.js']);
    assert.equal((await patchPhaser(f.directory,{patches:['gamepad-lifecycle'],verify:true})).verified,false);
  });
});

test('verify exits nonzero for pristine bytes and zero for corrected bytes, preserving all original hashes',async()=>{
  await using(async f=>{
    const before=await hashes(f.directory);
    const pristine=cli(f,['--patches',PATCH_IDS.join(','),'--verify']);
    assert.equal(pristine.status,1,pristine.stderr);assert.equal(JSON.parse(pristine.stdout).verified,false);
    assert.deepEqual(await hashes(f.directory),before);assert.deepEqual(await readdir(f.staging),[]);
    const applied=cli(f,['--patches',PATCH_IDS.join(',')]);assert.equal(applied.status,0,applied.stderr);
    const corrected=await hashes(f.directory);
    const verified=cli(f,['--verify','--patches',PATCH_IDS.join(',')]);assert.equal(verified.status,0,verified.stderr);
    assert.deepEqual(JSON.parse(verified.stdout),{patches:PATCH_IDS,changed:[],verified:true});
    assert.deepEqual(await hashes(f.directory),corrected);assert.deepEqual(await readdir(f.staging),[]);
  });
});

test('selection is mandatory and unknown IDs, versions and packages refuse before writes',async()=>{
  await using(async f=>{
    for(const args of [[],['--patches',''],['--patches','audio-decode,unknown'],['--patches','audio-decode,'],['--verify']]){
      const before=await hashes(f.directory),result=cli(f,args);
      assert.equal(result.status,1,args.join(' '));assert.deepEqual(await hashes(f.directory),before);assert.deepEqual(await readdir(f.staging),[]);
    }
    await assert.rejects(()=>patchPhaser(f.directory),/Explicit --patches/);
    for(const manifest of [{name:'phaser',version:'4.2.2'},{name:'other',version:'4.2.1'}]){
      await writeFile(join(f.directory,'package.json'),JSON.stringify(manifest));
      const before=await hashes(f.directory),result=cli(f,['--patches','audio-decode']);
      assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/requires? exactly phaser@4\.2\.1/);
      assert.deepEqual(await hashes(f.directory),before);assert.deepEqual(await readdir(f.staging),[]);
    }
  });
});

for(const fault of ['corrupt-final-fragment','ambiguous-final-fragment','missing-final-file','mixed-audio-decode'])test(`entire selected composition refuses ${fault} without installed writes and cleans staging`,async()=>{
  await using(async f=>{
    const last=join(f.directory,'dist/phaser.js');
    if(fault==='corrupt-final-fragment')await writeFile(last,(await readFile(last,'utf8')).replace('var tempTexture = gl.createTexture();','var tempTexture = null;'));
    if(fault==='ambiguous-final-fragment')await writeFile(last,Buffer.concat([await readFile(last),Buffer.from(sources['src/renderer/webgl/wrappers/WebGLTextureUnitsWrapper.js'].replaceAll('\r\n','\n'))]));
    if(fault==='missing-final-file')await rm(last);
    if(fault==='mixed-audio-decode'){
      const original=await readFile(join(f.directory,'src/loader/filetypes/AudioFile.js'));
      await patchAudioDecode(f.directory);await writeFile(join(f.directory,'src/loader/filetypes/AudioFile.js'),original);
    }
    const before=await hashes(f.directory);
    for(const extra of [[],['--verify']]){
      const result=cli(f,['--patches',PATCH_IDS.join(','),...extra]);assert.equal(result.status,1,result.stderr);
      assert.deepEqual(await hashes(f.directory),before);assert.deepEqual(await readdir(f.staging),[]);
    }
  });
});

test('a target directory outside the selected package is refused before writes',async()=>{
  await using(async f=>{
    const external=join(f.root,'external-src');
    await rename(join(f.directory,'src'),external);
    await symlink(external,join(f.directory,'src'),process.platform==='win32'?'junction':'dir');
    const before=await hashes(f.directory);
    await assert.rejects(()=>patchPhaser(f.directory,{patches:PATCH_IDS}),/inside the package/);
    assert.deepEqual(await hashes(f.directory),before);
  });
});

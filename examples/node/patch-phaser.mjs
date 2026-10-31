import {createHash} from 'node:crypto';
import {lstat,mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchGamepadHeldInput} from '../../skills/phaser-input/scripts/assets/phaser-gamepad-held-input-patch.mjs';
import {patchGamepadLifecycle} from '../../skills/phaser-input/scripts/assets/phaser-gamepad-lifecycle-patch.mjs';
import {patchAudioDecode} from '../../skills/phaser-audio/scripts/assets/phaser-audio-decode-patch.mjs';
import {patchAudioVisibility} from '../../skills/phaser-audio/scripts/assets/phaser-audio-visibility-patch.mjs';
import {patchDynamicTexture} from '../../skills/phaser-rendering/scripts/assets/phaser-dynamic-texture-patch.mjs';
import {patchFramebufferRestore} from '../../skills/phaser-rendering/scripts/assets/phaser-framebuffer-restore-patch.mjs';
import {patchTextureUnits} from '../../skills/phaser-rendering/scripts/assets/phaser-texture-units-patch.mjs';

// Explicit selection only. This order is independent of the caller's argument order.
const bundles=['dist/phaser.esm.js','dist/phaser.js'];
const patches=[
  {id:'gamepad-held-input',install:patchGamepadHeldInput,files:['src/input/gamepad/Gamepad.js',...bundles]},
  {id:'gamepad-lifecycle',install:patchGamepadLifecycle,files:['src/input/gamepad/GamepadPlugin.js',...bundles]},
  {id:'audio-decode',install:patchAudioDecode,files:['src/loader/filetypes/AudioFile.js',...bundles]},
  {id:'audio-visibility',install:patchAudioVisibility,files:['src/sound/webaudio/WebAudioSoundManager.js',...bundles]},
  {id:'dynamic-texture',install:patchDynamicTexture,files:['src/textures/DynamicTexture.js',...bundles]},
  {id:'framebuffer-restore',install:patchFramebufferRestore,files:['src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js',...bundles]},
  {id:'texture-units',install:patchTextureUnits,files:['src/renderer/webgl/wrappers/WebGLTextureUnitsWrapper.js','src/renderer/webgl/WebGLRenderer.js',...bundles]},
];
export const PATCH_IDS=Object.freeze(patches.map(({id})=>id));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function selection(ids){
  if(!Array.isArray(ids) || ids.length===0 || ids.some(id=>typeof id!=='string' || !id.trim())){
    throw new Error('Explicit --patches selection is required.');
  }
  const selected=new Set(ids.map(id=>id.trim()));
  const unknown=[...selected].filter(id=>!PATCH_IDS.includes(id));
  if(unknown.length)throw new Error(`Unknown Phaser patch ID: ${unknown.join(', ')}.`);
  return patches.filter(({id})=>selected.has(id));
}

async function installedBytes(directory,file){
  const target=join(directory,file),resolved=await realpath(target),within=relative(directory,resolved);
  if(isAbsolute(within) || within==='..' || within.startsWith(`..${sep}`) || !(await lstat(target)).isFile()){
    throw new Error(`Phaser patch target must be a regular file inside the package: ${file}.`);
  }
  return readFile(target);
}

/** Stage the entire selected composition before publishing. Verify never writes installed files.
 * Hash checks detect changes during preflight; publication is not crash-atomic or a filesystem lock.
 */
export async function patchPhaser(packageDirectory,{patches:ids,verify=false}={}){
  const selected=selection(ids);
  const directory=await realpath(resolve(packageDirectory));
  const manifestBytes=await installedBytes(directory,'package.json');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  if(manifest?.name!=='phaser' || manifest?.version!=='4.2.1')throw new Error('Phaser corrections require exactly phaser@4.2.1.');
  const files=[...new Set(selected.flatMap(patch=>patch.files))];
  const originals=new Map([['package.json',manifestBytes]]);
  for(const file of files)originals.set(file,await installedBytes(directory,file));
  const originalHashes=new Map([...originals].map(([file,bytes])=>[file,hash(bytes)]));
  const staging=await mkdtemp(join(tmpdir(),'phaser-patch-stage-'));
  try{
    for(const [file,bytes] of originals){
      await mkdir(dirname(join(staging,file)),{recursive:true});
      await writeFile(join(staging,file),bytes);
    }
    for(const patch of selected){
      const {changed}=await patch.install(staging);
      // An independently installed patch may be present, but one patch cannot be
      // partly present across its native source and consumed bundles.
      if(changed.length && (changed.length!==patch.files.length || patch.files.some(file=>!changed.includes(file)))){
        throw new Error(`Mixed Phaser ${patch.id} source/bundle correction states.`);
      }
    }
    for(const patch of selected){
      if((await patch.install(staging)).changed.length)throw new Error(`Phaser ${patch.id} composition did not verify.`);
    }
    const pending=[];
    for(const file of files){
      const bytes=await readFile(join(staging,file));
      if(!bytes.equals(originals.get(file)))pending.push({file,bytes});
    }
    // Check every selected input, including unchanged files and the manifest,
    // before the first write to the installed dependency.
    for(const [file,expected] of originalHashes){
      if(hash(await installedBytes(directory,file))!==expected)throw new Error(`Phaser package changed during preflight: ${file}.`);
    }
    if(!verify)for(const {file,bytes} of pending)await writeFile(join(directory,file),bytes);
    return {patches:selected.map(({id})=>id),changed:pending.map(({file})=>file),verified:!verify || pending.length===0};
  }finally{
    await rm(staging,{recursive:true,force:true});
  }
}

const usage='Usage: node patch-phaser.mjs <package-directory> --patches <comma-separated-ids> [--verify]';
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [directory,...args]=process.argv.slice(2);let ids,verify=false;
    if(!directory || directory.startsWith('--'))throw new Error(usage);
    for(let i=0;i<args.length;i++){
      if(args[i]==='--verify' && !verify)verify=true;
      else if(args[i]==='--patches' && ids===undefined && args[i+1]!==undefined && !args[i+1].startsWith('--'))ids=args[++i].split(',');
      else throw new Error(usage);
    }
    const result=await patchPhaser(directory,{patches:ids,verify});
    console.log(JSON.stringify(result));
    if(!result.verified){console.error('Selected Phaser corrections are not installed.');process.exitCode=1;}
  }catch(error){console.error(error.message);process.exitCode=1;}
}

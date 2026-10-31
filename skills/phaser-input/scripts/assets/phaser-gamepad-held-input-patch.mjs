import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Temporary Phaser 4.2.1 dependency correction. Remove after an upstream
// Gamepad accepts valid snapshots older than wrapper creation and native Button
// transitions still emit exactly once on acquisition, release and resume.
// The guarded fragment is from npm phaser@4.2.1, by Richard Davey.
// Copyright 2013-2026 Phaser Studio Inc.; https://opensource.org/licenses/MIT
const files=['src/input/gamepad/Gamepad.js','dist/phaser.esm.js','dist/phaser.js'];
const original=`    update: function (pad)
    {
        if (pad.timestamp < this._created)
        {
            return;
        }

        var i;

        //  Sync the button values`;
const corrected=`    update: function (pad)
    {
        //  Browser timestamps may predate this wrapper; Button owns transition edges.
        var i;

        //  Sync the button values`;

/** Preflight native source and consumed bundles before changing any installed file. */
export async function patchGamepadHeldInput(packageDirectory){
  const directory=resolve(packageDirectory);
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  if(manifest.name!=='phaser' || manifest.version!=='4.2.1'){
    throw new Error('Phaser Gamepad held-input correction requires exactly phaser@4.2.1.');
  }
  const pending=[];let packageState;
  for(const file of files){
    const bytes=await readFile(join(directory,file)),matches=[];
    for(const newline of ['\n','\r\n']){
      for(const [text,patched] of [[original,false],[corrected,true]]){
        const fragment=Buffer.from(text.replaceAll('\n',newline));
        const index=bytes.indexOf(fragment);
        if(index!==-1){
          if(bytes.indexOf(fragment,index+1)!==-1)throw new Error(`Ambiguous Phaser Gamepad held-input fragment in ${file}.`);
          matches.push({index,fragment,newline,patched});
        }
      }
    }
    if(matches.length!==1)throw new Error(`Unknown or ambiguous Phaser Gamepad held-input fragment in ${file}.`);
    const {index,fragment,newline,patched}=matches[0];
    if(packageState!==undefined && packageState!==patched)throw new Error('Mixed Phaser Gamepad held-input source/bundle correction states.');
    packageState=patched;
    if(!patched)pending.push({file,bytes:Buffer.concat([bytes.subarray(0,index),Buffer.from(corrected.replaceAll('\n',newline)),bytes.subarray(index+fragment.length)])});
  }
  for(const {file,bytes} of pending)await writeFile(join(directory,file),bytes);
  return {changed:pending.map(({file})=>file)};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3)throw new Error('Usage: node phaser-gamepad-held-input-patch.mjs <installed-phaser-directory>');
    console.log(JSON.stringify(await patchGamepadHeldInput(process.argv[2])));
  }catch(error){
    console.error(error.message);
    process.exitCode=1;
  }
}

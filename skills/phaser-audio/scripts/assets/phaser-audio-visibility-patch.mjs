import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Temporary Phaser 4.2.1 dependency band-aid. Remove after a reviewed upstream
// onGameVisible admits only the live manager's current, open AudioContext.
// Native fragment: Richard Davey; Copyright 2013-2026 Phaser Studio Inc.; MIT.
// https://opensource.org/licenses/MIT
const files=['src/sound/webaudio/WebAudioSoundManager.js','dist/phaser.esm.js','dist/phaser.js'];
const marker=Buffer.from('* @method Phaser.Sound.WebAudioSoundManager#onGameVisible');
const original=`     * @method Phaser.Sound.WebAudioSoundManager#onGameVisible
     * @private
     * @since 3.88.0
     */
    onGameVisible: function ()
    {
        var context = this.context;

        //  setTimeout to avoid weird audio artifacts (thanks Apple)
        window.setTimeout(function ()
        {

            if (context)
            {
                context.suspend();
                context.resume();
            }

        }, 100);
    },

`;
const corrected=original
  .replace('        var context = this.context;', '        var _this = this;\n\n        var context = this.context;')
  .replace('            if (context)', "            if (_this.game && context && _this.context === context && context.state !== 'closed')");

function uniqueIndex(bytes,fragment){
  const index=bytes.indexOf(fragment);
  return index!==-1 && bytes.indexOf(fragment,index+1)===-1?index:-1;
}

/** Preflight all targets before correcting their known native visibility method. */
export async function patchAudioVisibility(installedPhaserDirectory){
  const directory=resolve(installedPhaserDirectory);
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  if(manifest.name!=='phaser' || manifest.version!=='4.2.1'){
    throw new Error('Phaser audio visibility correction requires exactly phaser@4.2.1.');
  }
  const pending=[];
  let expected;
  for(const file of files){
    const bytes=await readFile(join(directory,file));
    if(uniqueIndex(bytes,marker)===-1)throw new Error(`Unknown or ambiguous Phaser onGameVisible in ${file}.`);
    const matches=[];
    for(const newline of ['\n','\r\n']){
      for(const [text,patched] of [[original,false],[corrected,true]]){
        const fragment=Buffer.from(text.replaceAll('\n',newline));
        const index=uniqueIndex(bytes,fragment);
        if(index!==-1)matches.push({index,fragment,newline,patched});
      }
    }
    if(matches.length!==1)throw new Error(`Unknown Phaser onGameVisible fragment in ${file}.`);
    const {index,fragment,newline,patched}=matches[0];
    if(expected && (expected.newline!==newline || expected.patched!==patched)){
      throw new Error('Mixed Phaser onGameVisible correction states or newlines.');
    }
    expected={newline,patched};
    if(!patched)pending.push({file,bytes:Buffer.concat([
      bytes.subarray(0,index),Buffer.from(corrected.replaceAll('\n',newline)),bytes.subarray(index+fragment.length)
    ])});
  }
  for(const {file,bytes} of pending)await writeFile(join(directory,file),bytes);
  return {changed:pending.map(({file})=>file)};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3)throw new Error('Usage: node phaser-audio-visibility-patch.mjs <installed-phaser-directory>');
    console.log(JSON.stringify(await patchAudioVisibility(process.argv[2])));
  }catch(error){
    console.error(error.message);
    process.exitCode=1;
  }
}

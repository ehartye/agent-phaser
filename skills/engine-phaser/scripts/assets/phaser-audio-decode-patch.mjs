import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Temporary Phaser 4.2.1 dependency correction. Remove after a reviewed upstream
// AudioFile handles the native decode Promise as well as its legacy callbacks.
// The guarded fragment is from npm phaser@4.2.1, by Richard Davey.
// Copyright 2013-2026 Phaser Studio Inc.; https://opensource.org/licenses/MIT
const files=['src/loader/filetypes/AudioFile.js','dist/phaser.esm.js','dist/phaser.js'];
const marker=Buffer.from('* @method Phaser.Loader.FileTypes.AudioFile#onProcess');
const original=`     * @method Phaser.Loader.FileTypes.AudioFile#onProcess
     * @since 3.0.0
     */
    onProcess: function ()
    {
        this.state = CONST.FILE_PROCESSING;

        var _this = this;

        // interesting read https://github.com/WebAudio/web-audio-api/issues/1305
        this.config.context.decodeAudioData(this.xhrLoader.response,
            function (audioBuffer)
            {
                _this.data = audioBuffer;

                _this.onProcessComplete();
            },
            function (e)
            {
                // eslint-disable-next-line no-console
                console.error('Error decoding audio: ' + _this.key + ' - ', e ? e.message : null);

                _this.onProcessError();
            }
        );

        this.config.context = null;
    }

});

`;
const corrected=original
  .replace('        this.config.context.decodeAudioData(', '        var decoding = this.config.context.decodeAudioData(')
  .replace('        this.config.context = null;', `        // The native error callback already completes failed processing.
        if (decoding && typeof decoding.catch === 'function')
        {
            decoding.catch(function () {});
        }

        this.config.context = null;`);

function uniqueIndex(bytes,fragment){
  const index=bytes.indexOf(fragment);
  return index!==-1 && bytes.indexOf(fragment,index+1)===-1?index:-1;
}

/** Preflight all three files, then correct only their known AudioFile fragment. */
export async function patchAudioDecode(packageDirectory){
  const directory=resolve(packageDirectory);
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  if(manifest.name!=='phaser' || manifest.version!=='4.2.1'){
    throw new Error('Phaser AudioFile correction requires exactly phaser@4.2.1.');
  }
  const pending=[];
  for(const file of files){
    const bytes=await readFile(join(directory,file));
    if(uniqueIndex(bytes,marker)===-1)throw new Error(`Unknown or ambiguous Phaser AudioFile in ${file}.`);
    const matches=[];
    for(const newline of ['\n','\r\n']){
      for(const [text,patched] of [[original,false],[corrected,true]]){
        const fragment=Buffer.from(text.replaceAll('\n',newline));
        const index=uniqueIndex(bytes,fragment);
        if(index!==-1)matches.push({index,fragment,newline,patched});
      }
    }
    if(matches.length!==1)throw new Error(`Unknown Phaser AudioFile fragment in ${file}.`);
    const {index,fragment,newline,patched}=matches[0];
    if(!patched)pending.push({file,bytes:Buffer.concat([
      bytes.subarray(0,index),Buffer.from(corrected.replaceAll('\n',newline)),bytes.subarray(index+fragment.length)
    ])});
  }
  for(const {file,bytes} of pending)await writeFile(join(directory,file),bytes);
  return {changed:pending.map(({file})=>file)};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3)throw new Error('Usage: node phaser-audio-decode-patch.mjs <installed-phaser-directory>');
    console.log(JSON.stringify(await patchAudioDecode(process.argv[2])));
  }catch(error){
    console.error(error.message);
    process.exitCode=1;
  }
}

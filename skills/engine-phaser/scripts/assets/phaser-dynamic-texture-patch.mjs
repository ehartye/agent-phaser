import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Temporary Phaser 4.2.1 dependency band-aid. Remove only after an equivalent
// reviewed, pinned upstream fix disposes the TextureSource wrapper before its
// DrawingContext replacement, retaining native rendering and destruction.
// Guarded native fragment: npm phaser@4.2.1, by Richard Davey.
// Copyright 2013-2026 Phaser Studio Inc.; https://opensource.org/licenses/MIT
const files=['src/textures/DynamicTexture.js','dist/phaser.esm.js','dist/phaser.js'];
const marker=Buffer.from('function DynamicTexture (manager, key, width, height, forceEven)');
const original=`        this.drawingContext = isCanvas ? null : new DrawingContext(renderer, {
            width: width,
            height: height,
            camera: this.camera,
            autoClear: false,
            enableMipmap: true
        });

        if (!isCanvas)
        {
            var frame = this.get();
            frame.source.glTexture = this.drawingContext.texture;
        }

        this.setSize(width, height, forceEven);
    },
`;
const corrected=original.replace('            frame.source.glTexture =', '            renderer.deleteTexture(frame.source.glTexture);\n            frame.source.glTexture =');

/** Preflight native source and both consumed bundles before correcting ownership. */
export async function patchDynamicTexture(installedPhaserDirectory){
  const directory=resolve(installedPhaserDirectory);
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  if(manifest.name!=='phaser' || manifest.version!=='4.2.1'){
    throw new Error('Phaser DynamicTexture correction requires exactly phaser@4.2.1.');
  }
  const pending=[];let packageState,packageNewline;
  for(const file of files){
    const bytes=await readFile(join(directory,file));
    const markerIndex=bytes.indexOf(marker);
    if(markerIndex===-1 || bytes.indexOf(marker,markerIndex+1)!==-1)throw new Error(`Unknown or ambiguous Phaser DynamicTexture constructor in ${file}.`);
    const matches=[];
    for(const newline of ['\n','\r\n']){
      for(const [text,patched] of [[original,false],[corrected,true]]){
        const fragment=Buffer.from(text.replaceAll('\n',newline));
        const index=bytes.indexOf(fragment);
        if(index!==-1){
          if(bytes.indexOf(fragment,index+1)!==-1)throw new Error(`Ambiguous Phaser DynamicTexture fragment in ${file}.`);
          matches.push({index,fragment,newline,patched});
        }
      }
    }
    if(matches.length!==1)throw new Error(`Unknown or ambiguous Phaser DynamicTexture fragment in ${file}.`);
    const {index,fragment,newline,patched}=matches[0];
    if(packageState!==undefined && (packageState!==patched || packageNewline!==newline)){
      throw new Error('Mixed Phaser DynamicTexture source/bundle correction states or target newlines.');
    }
    packageState=patched;packageNewline=newline;
    if(!patched)pending.push({file,bytes:Buffer.concat([
      bytes.subarray(0,index),Buffer.from(corrected.replaceAll('\n',newline)),bytes.subarray(index+fragment.length)
    ])});
  }
  for(const {file,bytes} of pending)await writeFile(join(directory,file),bytes);
  return {changed:pending.map(({file})=>file)};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3)throw new Error('Usage: node phaser-dynamic-texture-patch.mjs <installed-phaser-directory>');
    console.log(JSON.stringify(await patchDynamicTexture(process.argv[2])));
  }catch(error){
    console.error(error.message);
    process.exitCode=1;
  }
}

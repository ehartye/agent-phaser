import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Temporary Phaser 4.2.1 dependency band-aid. Remove only after an equivalent
// reviewed, pinned upstream fix retains the sampler-completeness placeholder
// while rendering and releases its live current-context handle on reinit/destroy.
// Guarded native fragments: npm phaser@4.2.1, by Benjamin D. Richards and
// Richard Davey et al. Copyright 2013-2026 Phaser Studio Inc.; MIT license.
const init=`        var gl = this.renderer.gl;

        this.units.length = 0;
        this.unitIndices.length = 0;

        // Create a reusable 1x1 texture for all units.
        var tempTexture = gl.createTexture();
`;
const initCorrected=init.replace('        this.units.length = 0;',`        // Release only a still-live placeholder from this context.
        if (this.tempTexture && !gl.isContextLost() && gl.isTexture(this.tempTexture))
        {
            gl.deleteTexture(this.tempTexture);
        }

        this.units.length = 0;`).replace('var tempTexture = gl.createTexture();','var tempTexture = this.tempTexture = gl.createTexture();');
const tail=`    unbindAllUnits: function ()
    {
        for (var i = this.units.length - 1; i >= 0; i--)
        {
            this.bind(null, i, true, false);
        }
    }
});
`;
const tailCorrected=tail.replace('    }\n});',`    },

    /**
     * Releases the owned sampler placeholder and this wrapper's references.
     * Invalidated context handles are already freed by WebGL.
     */
    destroy: function ()
    {
        var gl = this.renderer && this.renderer.gl;

        if (gl && !gl.isContextLost() && this.tempTexture && gl.isTexture(this.tempTexture))
        {
            gl.deleteTexture(this.tempTexture);
        }

        this.tempTexture = null;
        this.units.length = 0;
        this.unitIndices.length = 0;
        this.renderer = null;
    }
});`);
const destroy=`        var wrapperDestroy = function (wrapper)
        {
            wrapper.destroy();
        };
        ArrayEach(this.glBufferWrappers, wrapperDestroy);
        ArrayEach(this.glFramebufferWrappers, wrapperDestroy);
        ArrayEach(this.glProgramWrappers, wrapperDestroy);
        ArrayEach(this.glTextureWrappers, wrapperDestroy);

        this.removeAllListeners();
`;
const destroyCorrected=destroy.replace('        this.removeAllListeners();','        this.glTextureUnits.destroy();\n\n        this.removeAllListeners();');
const owner={marker:'function WebGLTextureUnitsWrapper (renderer)',fragments:[[init,initCorrected],[tail,tailCorrected]]};
const renderer={marker:'function WebGLRenderer (game)',fragments:[[destroy,destroyCorrected]]};
const targets=[
  ['src/renderer/webgl/wrappers/WebGLTextureUnitsWrapper.js',[owner]],
  ['src/renderer/webgl/WebGLRenderer.js',[renderer]],
  ['dist/phaser.esm.js',[owner,renderer]],
  ['dist/phaser.js',[owner,renderer]]
];

/** Preflight both native owners and both consumed bundles before any write. */
export async function patchTextureUnits(installedPhaserDirectory){
  const directory=resolve(installedPhaserDirectory);
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  if(manifest?.name!=='phaser' || manifest?.version!=='4.2.1'){
    throw new Error('Phaser TextureUnits correction requires exactly phaser@4.2.1.');
  }
  const pending=[];let packageState,packageNewline;
  for(const [file,owners] of targets){
    const bytes=await readFile(join(directory,file)),replacements=[];
    for(const {marker:constructor,fragments} of owners){
      const marker=Buffer.from(constructor),markerIndex=bytes.indexOf(marker);
      if(markerIndex===-1 || bytes.indexOf(marker,markerIndex+1)!==-1)throw new Error(`Unknown or ambiguous Phaser TextureUnits owner in ${file}.`);
      for(const [original,corrected] of fragments){
        const matches=[];
        for(const newline of ['\n','\r\n']){
          for(const [text,patched] of [[original,false],[corrected,true]]){
            const fragment=Buffer.from(text.replaceAll('\n',newline)),index=bytes.indexOf(fragment);
            if(index!==-1){
              if(bytes.indexOf(fragment,index+1)!==-1)throw new Error(`Ambiguous Phaser TextureUnits fragment in ${file}.`);
              matches.push({index,fragment,newline,patched});
            }
          }
        }
        if(matches.length!==1)throw new Error(`Unknown or ambiguous Phaser TextureUnits fragment in ${file}.`);
        const {index,fragment,newline,patched}=matches[0];
        if(packageState!==undefined && (packageState!==patched || packageNewline!==newline)){
          throw new Error('Mixed Phaser TextureUnits source/bundle correction states or target newlines.');
        }
        packageState=patched;packageNewline=newline;
        if(!patched)replacements.push({index,length:fragment.length,bytes:Buffer.from(corrected.replaceAll('\n',newline))});
      }
    }
    let correctedBytes=bytes;
    for(const replacement of replacements.sort((a,b)=>b.index-a.index))correctedBytes=Buffer.concat([
      correctedBytes.subarray(0,replacement.index),replacement.bytes,correctedBytes.subarray(replacement.index+replacement.length)
    ]);
    if(replacements.length)pending.push({file,bytes:correctedBytes});
  }
  for(const {file,bytes} of pending)await writeFile(join(directory,file),bytes);
  return {changed:pending.map(({file})=>file)};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3)throw new Error('Usage: node phaser-texture-units-patch.mjs <installed-phaser-directory>');
    console.log(JSON.stringify(await patchTextureUnits(process.argv[2])));
  }catch(error){
    console.error(error.message);
    process.exitCode=1;
  }
}

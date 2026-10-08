import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Temporary Phaser 4.2.1 dependency band-aid. Remove only after an equivalent
// reviewed, pinned upstream fix avoids previous-context framebuffer/renderbuffer
// deletion and still disposes live resources recreated within native restore.
// This does not suppress GL calls or warnings.
// Guarded native fragment: npm phaser@4.2.1, by Benjamin D. Richards.
// Copyright 2013-2026 Phaser Studio Inc.; https://opensource.org/licenses/MIT
const files=['src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js','dist/phaser.esm.js','dist/phaser.js'];
const marker=Buffer.from('* @method Phaser.Renderer.WebGL.Wrappers.WebGLFramebufferWrapper#createResource');
const original=`     * @method Phaser.Renderer.WebGL.Wrappers.WebGLFramebufferWrapper#createResource
     * @since 3.80.0
     */
    createResource: function ()
    {
        if (this.useCanvas) { return; }

        var renderer = this.renderer;
        var glWrapper = renderer.glWrapper;
        var gl = renderer.gl;

        // Remove any existing framebuffer.
        if (this.webGLFramebuffer)
        {
            gl.deleteFramebuffer(this.webGLFramebuffer);
            for (var i = 0; i < this.attachments.length; i++)
            {
                var attachment = this.attachments[i];
                if (!attachment.texture)
                {
                    gl.deleteRenderbuffer(attachment.renderbuffer);
                }
            }
        }

        // Create framebuffer.
`;
const corrected=original.replace('if (this.webGLFramebuffer)','if (this.webGLFramebuffer && (!renderer.contextLost || gl.isFramebuffer(this.webGLFramebuffer)))');

/** Preflight all native source/consumed bundles before correcting their known fragment. */
export async function patchFramebufferRestore(installedPhaserDirectory){
  const directory=resolve(installedPhaserDirectory);
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  if(manifest.name!=='phaser' || manifest.version!=='4.2.1'){
    throw new Error('Phaser framebuffer restore correction requires exactly phaser@4.2.1.');
  }
  const pending=[];let packageState,packageNewline;
  for(const file of files){
    const bytes=await readFile(join(directory,file));
    const markerIndex=bytes.indexOf(marker);
    if(markerIndex===-1 || bytes.indexOf(marker,markerIndex+1)!==-1)throw new Error(`Unknown or ambiguous Phaser framebuffer method in ${file}.`);
    const matches=[];
    for(const newline of ['\n','\r\n']){
      for(const [text,patched] of [[original,false],[corrected,true]]){
        const fragment=Buffer.from(text.replaceAll('\n',newline));
        const index=bytes.indexOf(fragment);
        if(index!==-1){
          if(bytes.indexOf(fragment,index+1)!==-1)throw new Error(`Ambiguous Phaser framebuffer fragment in ${file}.`);
          matches.push({index,fragment,newline,patched});
        }
      }
    }
    if(matches.length!==1)throw new Error(`Unknown or ambiguous Phaser framebuffer fragment in ${file}.`);
    const {index,fragment,newline,patched}=matches[0];
    if(packageState!==undefined && (packageState!==patched || packageNewline!==newline)){
      throw new Error('Mixed Phaser framebuffer source/bundle correction states or target newlines.');
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
    if(process.argv.length!==3)throw new Error('Usage: node phaser-framebuffer-restore-patch.mjs <installed-phaser-directory>');
    console.log(JSON.stringify(await patchFramebufferRestore(process.argv[2])));
  }catch(error){
    console.error(error.message);
    process.exitCode=1;
  }
}

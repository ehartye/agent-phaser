import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Temporary Phaser 4.2.1 dependency correction. Remove after a reviewed upstream
// GamepadPlugin publishes usable FIFO lifecycle before controls and retires its
// pending lifecycle queue at Scene shutdown.
// The guarded fragments are from npm phaser@4.2.1, by Richard Davey.
// Copyright 2013-2026 Phaser Studio Inc.; https://opensource.org/licenses/MIT
const files=['src/input/gamepad/GamepadPlugin.js','dist/phaser.esm.js','dist/phaser.js'];
const fragments=[
  [`    startListeners: function ()
    {
        var _this = this;
        var target = this.target;

        var handler = function (event)
        {
            if (event.defaultPrevented || !_this.isActive())
            {
                // Do nothing if event already handled
                return;
            }

            _this.refreshPads();

            _this.queue.push(event);
        };

`,`    startListeners: function ()
    {
        var _this = this;
        var target = this.target;

        var handler = function (event)
        {
            if (event.defaultPrevented || !_this.isActive())
            {
                // Do nothing if event already handled
                return;
            }

            _this.queue.push(event);
        };

`],
  [`    refreshPads: function ()
    {
        var connectedPads = navigator.getGamepads();`,`    refreshPads: function (event)
    {
        var connectedPads = event ? [ event.gamepad ] : navigator.getGamepads();`],
  [`                    //  If neither of these, it's a pad we've already got, so update it
                    currentPad.update(livePad);`,`                    if (event)
                    {
                        //  Expose the connection sample before controls can emit edges.
                        currentPad.pad = livePad;
                    }
                    else
                    {
                        currentPad.update(livePad);
                    }`],
  [`    update: function ()
    {
        if (!this.enabled)
        {
            return;
        }

        this.refreshPads();

        var len = this.queue.length;

        if (len === 0)
        {
            return;
        }

        var queue = this.queue.splice(0, len);

        //  Process the event queue, dispatching all of the events that have stored up
        for (var i = 0; i < len; i++)
        {
            var event = queue[i];
            var pad = this.getPad(event.gamepad.index);

            if (event.type === 'gamepadconnected')
            {
                this.emit(Events.CONNECTED, pad, event);
            }
            else if (event.type === 'gamepaddisconnected')
            {
                this.emit(Events.DISCONNECTED, pad, event);
            }
        }
    },

`,`    update: function ()
    {
        if (!this.enabled)
        {
            return;
        }

        var len = this.queue.length;

        var queue = this.queue.splice(0, len);

        //  Process the event queue, dispatching all of the events that have stored up
        for (var i = 0; i < len; i++)
        {
            var event = queue[i];

            if (event.type === 'gamepadconnected')
            {
                this.refreshPads(event);
            }

            var pad = this.getPad(event.gamepad.index);

            if (event.type === 'gamepadconnected')
            {
                this.emit(Events.CONNECTED, pad, event);
            }
            else if (event.type === 'gamepaddisconnected')
            {
                this.emit(Events.DISCONNECTED, pad, event);
            }
        }

        this.refreshPads();
    },

`],
  [`    shutdown: function ()
    {
        this.stopListeners();

        this.removeAllListeners();
    },`,`    shutdown: function ()
    {
        this.stopListeners();

        this.queue.length = 0;

        this.removeAllListeners();
    },`]
];

/** Preflight all source/consumed bundles, then replace only the known fragments. */
export async function patchGamepadLifecycle(packageDirectory){
  const directory=resolve(packageDirectory);
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  if(manifest.name!=='phaser' || manifest.version!=='4.2.1'){
    throw new Error('Phaser GamepadPlugin correction requires exactly phaser@4.2.1.');
  }
  const pending=[];let packageState;
  for(const file of files){
    let bytes=await readFile(join(directory,file));
    const edits=[];let fileState,fileNewline;
    for(const [original,corrected] of fragments){
      const matches=[];
      for(const newline of ['\n','\r\n']){
        for(const [text,patched] of [[original,false],[corrected,true]]){
          const fragment=Buffer.from(text.replaceAll('\n',newline));
          const index=bytes.indexOf(fragment);
          if(index!==-1){
            if(bytes.indexOf(fragment,index+1)!==-1)throw new Error(`Ambiguous Phaser GamepadPlugin fragment in ${file}.`);
            matches.push({index,fragment,newline,patched,corrected});
          }
        }
      }
      if(matches.length!==1)throw new Error(`Unknown or ambiguous Phaser GamepadPlugin fragment in ${file}.`);
      const match=matches[0];
      if(fileState!==undefined && (fileState!==match.patched || fileNewline!==match.newline)){
        throw new Error(`Mixed Phaser GamepadPlugin fragments or newlines in ${file}.`);
      }
      fileState=match.patched;fileNewline=match.newline;edits.push(match);
    }
    if(packageState!==undefined && packageState!==fileState)throw new Error('Mixed Phaser GamepadPlugin source/bundle correction states.');
    packageState=fileState;
    if(!fileState){
      for(const {index,fragment,newline,corrected} of edits.sort((a,b)=>b.index-a.index)){
        bytes=Buffer.concat([bytes.subarray(0,index),Buffer.from(corrected.replaceAll('\n',newline)),bytes.subarray(index+fragment.length)]);
      }
      pending.push({file,bytes});
    }
  }
  for(const {file,bytes} of pending)await writeFile(join(directory,file),bytes);
  return {changed:pending.map(({file})=>file)};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3)throw new Error('Usage: node phaser-gamepad-lifecycle-patch.mjs <installed-phaser-directory>');
    console.log(JSON.stringify(await patchGamepadLifecycle(process.argv[2])));
  }catch(error){
    console.error(error.message);
    process.exitCode=1;
  }
}

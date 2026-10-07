import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {patchAudioDecode} from '../skills/engine-phaser/scripts/assets/phaser-audio-decode-patch.mjs';

// Execute the complete pinned native module graph, not a second input engine.
const {modules}=JSON.parse(await readFile(new URL('./fixtures/phaser-gamepad-4.2.1.json',import.meta.url),'utf8'));
const pluginKey='src/input/gamepad/GamepadPlugin.js',padKey='src/input/gamepad/Gamepad.js';
const original=modules[pluginKey];
const timestampGate=`        if (pad.timestamp < this._created)
        {
            return;
        }
`;
assert.ok(modules[padKey].includes(timestampGate));
const heldPad=modules[padKey].replace(timestampGate,'        // Existing held-input correction; native Button owns edges.\n');
const audio=(await readFile(new URL('./fixtures/phaser-audio-on-process-4.2.1.txt',import.meta.url),'utf8')).replaceAll('\r\n','\n');
const script=new URL('../skills/engine-phaser/scripts/assets/phaser-gamepad-lifecycle-patch.mjs',import.meta.url);
const patch=existsSync(script)?(await import(script)).patchGamepadLifecycle:undefined;
const files=[pluginKey,'dist/phaser.esm.js','dist/phaser.js'];
const prefix=Buffer.from('// Outside bytes: é\n'+heldPad+'\n'+audio+'\n');
const suffix=Buffer.from('\n// unrelated trailing bytes\n');
async function fixture(newline='\n'){
  const directory=await mkdtemp(join(tmpdir(),'phaser-gamepad-lifecycle-'));
  await writeFile(join(directory,'package.json'),JSON.stringify({name:'phaser',version:'4.2.1'}));
  await mkdir(join(directory,'src/loader/filetypes'),{recursive:true});
  await writeFile(join(directory,'src/loader/filetypes/AudioFile.js'),audio);
  for(const file of files){
    await mkdir(join(directory,file,'..'),{recursive:true});
    await writeFile(join(directory,file),Buffer.concat([prefix,Buffer.from(original.replaceAll('\n',newline)),suffix]));
  }
  return directory;
}
const contents=directory=>Promise.all(files.map(file=>readFile(join(directory,file))));
function installer(){assert.equal(typeof patch,'function','The guarded install-time lifecycle correction is missing.');return patch;}
function native(source=original,{held=true}={}){
  const cache={},samples={pads:[],polls:0},listeners=new Map();
  const target={addEventListener(type,fn){const list=listeners.get(type)??new Set();list.add(fn);listeners.set(type,list);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);}};
  function load(key){
    if(cache[key])return cache[key].exports;
    const module={exports:{}};cache[key]=module;
    const body=key===pluginKey?source:key===padKey&&held?heldPad:modules[key];
    assert.equal(typeof body,'string',key);
    const require=name=>load(name.startsWith('.')?posix.join(posix.dirname(key),name)+(name.endsWith('.js')?'':modules[posix.join(posix.dirname(key),name)+'.js']?'.js':'/index.js'):name);
    runInNewContext('(function(require,module,exports){'+body+'\n})',{navigator:{getGamepads(){samples.polls++;return samples.pads;}},performance:{now:()=>100}})(require,module,module.exports);
    return module.exports;
  }
  const Emitter=load('eventemitter3'),events=new Emitter();
  const input={scene:{sys:{settings:{input:{}},isActive:()=>true,game:{config:{inputGamepad:true,inputGamepadEventTarget:target},device:{input:{gamepads:true}}}}},pluginEvents:events};
  const plugin=new (load(pluginKey))(input);events.emit('boot');events.emit('start');
  function dispatch(type,pad,defaultPrevented=false){const event={type,gamepad:pad,defaultPrevented};for(const fn of listeners.get(type)??[])fn(event);return event;}
  function frame(){events.emit('update');}
  return {plugin,samples,events,listeners,dispatch,frame};
}
function snapshot({id='Native pad',index=0,value=0,axes=[0,0,0,0],timestamp=0,connected=true}={}){
  return {id,index,mapping:'standard',connected,timestamp,axes,buttons:Array.from({length:17},(_,i)=>({value:i===0?value:0,pressed:i===0&&value>=.5,touched:false}))};
}
function reconnectProof(source,options={}){
  const n=native(source),order=[],captured=new Set();let launches=0,usable=false;
  const old=snapshot(options);n.samples.pads=[old];n.dispatch('gamepadconnected',old);n.frame();
  const oldWrapper=n.plugin.getPad(old.index),next=snapshot({...options,...options.next,value:1,axes:[.12,.05,0,0]});
  n.plugin.on('disconnected',(pad,event)=>{order.push(['disconnected',pad?.id,event.gamepad.id]);assert.equal(pad,oldWrapper);captured.delete(pad.index);});
  n.plugin.on('connected',(pad,event)=>{
    order.push(['connected',pad?.id,event.gamepad.id]);usable=pad.id===event.gamepad.id&&pad.index===event.gamepad.index&&pad.pad===event.gamepad;
    for(const button of pad.buttons)button.threshold=.5;pad.setAxisThreshold(0);
    if(event.gamepad.buttons[0].value>=.5)captured.add(pad.index);
  });
  n.plugin.on('down',pad=>{order.push(['down',pad.id]);if(!captured.has(pad.index))launches++;});
  n.plugin.on('up',pad=>{order.push(['up',pad.id]);captured.delete(pad.index);});
  const before=n.samples.polls;n.samples.pads=[next];
  n.dispatch('gamepaddisconnected',{...old,connected:false});n.dispatch('gamepadconnected',next);n.frame();
  return {n,order,launches:()=>launches,usable,next,oldWrapper,polls:n.samples.polls-before};
}
async function corrected(){if(!patch)return original;const directory=await fixture();try{await installer()(directory);return (await readFile(join(directory,pluginKey))).subarray(prefix.length,-suffix.length).toString();}finally{await rm(directory,{recursive:true,force:true});}}

test('pinned native defect reproduces an uncaptured held edge before queued lifecycle',()=>{
  const proof=reconnectProof(original);
  assert.deepEqual(proof.order.map(e=>e[0]),['down','disconnected','connected']);assert.equal(proof.launches(),1);
});
test('lifecycle capture precedes same-index held edges; neutral release permits one fresh press',async()=>{
  const proof=reconnectProof(await corrected());
  assert.deepEqual(proof.order.map(e=>e[0]),['disconnected','connected','down']);assert.equal(proof.launches(),0);assert.equal(proof.polls,1);assert.equal(proof.usable,true);
  const pad=proof.n.plugin.getPad(0);assert.equal(pad,proof.oldWrapper);assert.equal(pad.buttons[0].pressed,true);
  assert.equal(pad.leftStick.x,.12);assert.equal(pad.leftStick.y,.05);
  proof.n.frame();assert.equal(proof.order.filter(e=>e[0]==='down').length,1);
  proof.n.samples.pads=[snapshot()];proof.n.frame();assert.equal(pad.buttons[0].pressed,false);
  proof.n.samples.pads=[snapshot({value:.7})];proof.n.frame();proof.n.frame();
  assert.equal(pad.buttons[0].pressed,true);assert.equal(proof.launches(),1);assert.equal(proof.order.filter(e=>e[0]==='down').length,2);
});
for(const next of [{id:'Replacement'},{index:2},{id:'Replacement',index:2}])test(`queued reconnect retains disconnected identity and acquires ${JSON.stringify(next)}`,async()=>{
  const proof=reconnectProof(await corrected(),{next});assert.deepEqual(proof.order.slice(0,2).map(e=>e[0]),['disconnected','connected']);assert.equal(proof.launches(),0);assert.equal(proof.polls,1);assert.equal(proof.usable,true);
  const pad=proof.n.plugin.getPad(proof.next.index);assert.equal(pad.id,proof.next.id);assert.equal(pad.buttons[0].pressed,true);
});
test('new held connection configures analog thresholds before update and keeps constructor seeding',async()=>{
  const n=native(await corrected()),order=[];const raw=snapshot({value:.7,axes:[.12,.05,0,0]});
  n.plugin.on('connected',(pad,event)=>{order.push('connected');assert.equal(event.gamepad,raw);assert.equal(pad.buttons[0].pressed,true);assert.equal(pad.pad,raw);pad.buttons[0].threshold=.5;pad.setAxisThreshold(0);});
  n.plugin.on('down',()=>order.push('down'));n.plugin.on('up',()=>order.push('up'));
  n.samples.pads=[raw];const before=n.samples.polls;n.dispatch('gamepadconnected',raw);assert.equal(n.samples.polls,before);n.frame();n.frame();
  assert.deepEqual(order,['connected']);const pad=n.plugin.getPad(0);assert.equal(pad.buttons[0].value,.7);assert.equal(pad.buttons[0].pressed,true);assert.equal(pad.leftStick.y,.05);
});
test('initial held acquisition and unchanged old timestamps keep native Button transitions',async()=>{
  const source=await corrected(),n=native(source);n.samples.pads=[snapshot({value:.7,axes:[.12,.05,0,0]})];n.frame();const pad=n.plugin.getPad(0);pad.buttons[0].threshold=.5;pad.setAxisThreshold(0);n.frame();
  assert.equal(pad.buttons[0].pressed,true);assert.equal(pad.leftStick.y,.05);
  let down=0,up=0;n.plugin.on('down',()=>down++);n.plugin.on('up',()=>up++);n.samples.pads=[snapshot()];n.frame();n.samples.pads=[snapshot({value:.6})];n.frame();n.frame();assert.equal(down,1);assert.equal(up,1);
  // This helper does not silently introduce or undo the independent timestamp fix.
  const uncorrected=native(source,{held:false});uncorrected.samples.pads=[snapshot()];uncorrected.frame();uncorrected.samples.pads=[snapshot({value:1})];uncorrected.frame();assert.equal(uncorrected.plugin.getPad(0).buttons[0].pressed,false);
});
test('ten native shutdown/restart cycles retain one DOM/update listener and discard stopped events',async()=>{
  const n=native(await corrected());for(let i=0;i<10;i++){
    n.events.emit('shutdown');assert.equal(n.listeners.get('gamepadconnected').size,0);assert.equal(n.listeners.get('gamepaddisconnected').size,0);assert.equal(n.events.listenerCount('update'),0);
    n.dispatch('gamepadconnected',snapshot());assert.equal(n.plugin.queue.length,0);n.events.emit('start');
    assert.equal(n.listeners.get('gamepadconnected').size,1);assert.equal(n.listeners.get('gamepaddisconnected').size,1);assert.equal(n.events.listenerCount('update'),1);
  }
  n.events.emit('destroy');assert.equal(n.events.listenerCount('update'),0);assert.equal(n.plugin.scene,null);
});
test('shutdown retires queued native lifecycle events before restart and accepts later connections once',async()=>{
  const n=native(await corrected()),raw=snapshot();n.samples.pads=[raw];n.dispatch('gamepadconnected',raw);n.frame();
  n.dispatch('gamepaddisconnected',{...raw,connected:false});n.dispatch('gamepadconnected',snapshot({value:1}));assert.equal(n.plugin.queue.length,2);
  n.events.emit('shutdown');assert.equal(n.plugin.queue.length,0,'Pending lifecycle events belong to the stopped Scene.');
  n.events.emit('start');const seen=[];n.plugin.on('connected',()=>seen.push('connected'));n.plugin.on('disconnected',()=>seen.push('disconnected'));n.frame();assert.deepEqual(seen,[]);
  const next=snapshot({id:'Later native connection',index:2});n.samples.pads=[next];n.dispatch('gamepadconnected',next);n.frame();n.frame();assert.deepEqual(seen,['connected']);
  n.events.emit('destroy');
});
for(const newline of ['\n','\r\n'])test(`installer composes with audio/held edits, preserves outside bytes and ${newline==='\n'?'LF':'CRLF'}, and is idempotent`,async()=>{
  const directory=await fixture(newline);try{
    await patchAudioDecode(directory);const before=await contents(directory),result=await installer()(directory),after=await contents(directory);assert.deepEqual(result.changed,files);
    for(let i=0;i<files.length;i++){
      const offset=before[i].indexOf(Buffer.from(original.replaceAll('\n',newline)));assert.ok(offset>=0);
      assert.deepEqual(after[i].subarray(0,offset),before[i].subarray(0,offset));assert.deepEqual(after[i].subarray(-suffix.length),suffix);
      const body=after[i].subarray(offset,-suffix.length).toString();assert.equal(newline==='\r\n'?/(?<!\r)\n/.test(body):body.includes('\r'),false);
    }
    assert.deepEqual((await installer()(directory)).changed,[]);assert.deepEqual(await contents(directory),after);
  }finally{await rm(directory,{recursive:true,force:true});}
});
for(const mutation of ['wrong-version','wrong-name','unknown-fragment','ambiguous-fragment','ambiguous-mixed-variants','missing-file','mixed-newlines','mixed-fragments','mixed-files'])test(`preflight refuses ${mutation} before any write`,async()=>{
  const directory=await fixture();try{
    if(mutation==='wrong-version'||mutation==='wrong-name')await writeFile(join(directory,'package.json'),JSON.stringify({name:mutation==='wrong-name'?'other':'phaser',version:mutation==='wrong-version'?'4.2.2':'4.2.1'}));
    else if(mutation==='missing-file')await rm(join(directory,files[2]));
    else if(mutation==='mixed-files'||mutation==='mixed-fragments'||mutation==='ambiguous-mixed-variants'){
      await installer()(directory);const bodies=await contents(directory);
      if(mutation==='mixed-files')await writeFile(join(directory,files[2]),Buffer.concat([prefix,Buffer.from(original),suffix]));
      else if(mutation==='ambiguous-mixed-variants')await writeFile(join(directory,files[2]),Buffer.concat([bodies[2],Buffer.from(original+original)]));
      else await writeFile(join(directory,files[2]),bodies[2].toString().replace('            _this.queue.push(event);','            _this.refreshPads();\n\n            _this.queue.push(event);'));
    }else{
      let body=(await readFile(join(directory,files[2]))).toString();
      if(mutation==='unknown-fragment')body=body.replace('_this.queue.push(event);','_this.queue.push(event, 123);');
      if(mutation==='ambiguous-fragment')body+=original;
      if(mutation==='mixed-newlines')body=body.replace('_this.queue.push(event);\n','_this.queue.push(event);\r\n');
      await writeFile(join(directory,files[2]),body);
    }
    const snapshot=()=>Promise.all(files.map(file=>readFile(join(directory,file)).catch(e=>e.code==='ENOENT'?null:Promise.reject(e))));const before=await snapshot();
    await assert.rejects(()=>installer()(directory),/Phaser|GamepadPlugin|ENOENT/);assert.deepEqual(await snapshot(),before);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('CLI is useful for postinstall and importing has no side effect',async()=>{
  const directory=await fixture();try{
    const before=await contents(directory);const imported=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(script.href)});`,directory],{encoding:'utf8'});assert.equal(imported.status,0,imported.stderr);assert.deepEqual(await contents(directory),before);
    const first=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(first.status,0,first.stderr);assert.deepEqual(JSON.parse(first.stdout).changed,files);
    const second=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(second.status,0,second.stderr);assert.deepEqual(JSON.parse(second.stdout).changed,[]);
    const invalid=spawnSync(process.execPath,[fileURLToPath(script)],{encoding:'utf8'});assert.equal(invalid.status,1);assert.match(invalid.stderr,/Usage:/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

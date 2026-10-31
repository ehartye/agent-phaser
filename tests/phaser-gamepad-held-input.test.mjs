import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';
import {runInNewContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {patchGamepadHeldInput} from '../skills/phaser-input/scripts/assets/phaser-gamepad-held-input-patch.mjs';
import {patchGamepadLifecycle} from '../skills/phaser-input/scripts/assets/phaser-gamepad-lifecycle-patch.mjs';

// Complete pinned native modules: no replacement input model.
const {modules}=JSON.parse(await readFile(new URL('./fixtures/phaser-gamepad-4.2.1.json',import.meta.url),'utf8'));
const padKey='src/input/gamepad/Gamepad.js',pluginKey='src/input/gamepad/GamepadPlugin.js';
const files=[padKey,'dist/phaser.esm.js','dist/phaser.js'];
const prefix=Buffer.from('// unrelated prefix: é\n'),suffix=Buffer.from('\n// unrelated suffix\n');
const script=new URL('../skills/phaser-input/scripts/assets/phaser-gamepad-held-input-patch.mjs',import.meta.url);
async function fixture(newline='\n'){
  const directory=await mkdtemp(join(tmpdir(),'phaser-held-input-'));
  await writeFile(join(directory,'package.json'),JSON.stringify({name:'phaser',version:'4.2.1'}));
  for(const file of [...files,pluginKey]){
    await mkdir(join(directory,file,'..'),{recursive:true});
    const body=file===pluginKey?modules[pluginKey]:modules[padKey]+(file.startsWith('dist/')?'\n'+modules[pluginKey]:'');
    await writeFile(join(directory,file),Buffer.concat([prefix,Buffer.from(body.replaceAll('\n',newline)),suffix]));
  }
  return directory;
}
const contents=directory=>Promise.all(files.map(file=>readFile(join(directory,file)).catch(error=>error.code==='ENOENT'?null:Promise.reject(error))));
async function corrected(){
  const directory=await fixture();
  try{await patchGamepadHeldInput(directory);return (await readFile(join(directory,padKey))).subarray(prefix.length,-suffix.length).toString();}
  finally{await rm(directory,{recursive:true,force:true});}
}
function native(padSource=modules[padKey],initialPads=[]){
  const cache={},samples={pads:initialPads},listeners=new Map();
  const target={addEventListener(type,fn){const list=listeners.get(type)??new Set();list.add(fn);listeners.set(type,list);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);}};
  function load(key){
    if(cache[key])return cache[key].exports;
    const module={exports:{}};cache[key]=module;
    const body=key===padKey?padSource:modules[key];assert.equal(typeof body,'string',key);
    const require=name=>load(name.startsWith('.')?posix.join(posix.dirname(key),name)+(name.endsWith('.js')?'':modules[posix.join(posix.dirname(key),name)+'.js']?'.js':'/index.js'):name);
    runInNewContext('(function(require,module,exports){'+body+'\n})',{navigator:{getGamepads:()=>samples.pads},performance:{now:()=>100}})(require,module,module.exports);
    return module.exports;
  }
  const Emitter=load('eventemitter3'),events=new Emitter();
  const input={scene:{sys:{settings:{input:{}},isActive:()=>true,game:{config:{inputGamepad:true,inputGamepadEventTarget:target},device:{input:{gamepads:true}}}}},pluginEvents:events};
  const plugin=new (load(pluginKey))(input);events.emit('boot');events.emit('start');
  return {plugin,samples,events,frame:()=>events.emit('update')};
}
function snapshot(value=0){return {id:'Native pad',index:0,mapping:'standard',connected:true,timestamp:0,axes:[.12,.05,0,0],buttons:Array.from({length:17},(_,i)=>({value:i===0?value:0,pressed:i===0&&value>=.5,touched:false}))};}
function transitions(source,{held=false,resume=false,boot=false}={}){
  const raw=snapshot(held?.7:0),n=native(source,boot?[raw]:[]),edges=[];
  const listen=()=>{n.plugin.on('down',()=>edges.push('down'));n.plugin.on('up',()=>edges.push('up'));};listen();
  n.samples.pads=[raw];if(!boot)n.frame();const pad=n.plugin.getPad(0);pad.buttons[0].threshold=.5;pad.setAxisThreshold(0);n.frame();n.frame();
  const acquired={value:pad.buttons[0].value,pressed:pad.buttons[0].pressed,y:pad.leftStick.y};
  if(resume){n.events.emit('shutdown');n.events.emit('start');listen();n.frame();n.frame();}
  n.samples.pads=[snapshot()];n.frame();n.frame();n.samples.pads=[snapshot(.6)];n.frame();n.frame();
  return {acquired,edges,pressed:pad.buttons[0].pressed};
}

test('pinned native timestamp guard rejects unchanged old snapshots',()=>{
  const out=transitions();assert.deepEqual(out.acquired,{value:0,pressed:false,y:0});assert.deepEqual(out.edges,[]);assert.equal(out.pressed,false);
});
for(const options of [{},{held:true},{held:true,boot:true},{held:true,resume:true}])test(`corrected native acquisition and resume own exact-once Button edges ${JSON.stringify(options)}`,async()=>{
  const out=transitions(await corrected(),options);
  assert.deepEqual(out.acquired,{value:options.held?.7:0,pressed:!!options.held,y:.05});
  assert.deepEqual(out.edges,options.held?['up','down']:['down']);assert.equal(out.pressed,true);
});
for(const newline of ['\n','\r\n'])test(`held-input installer preserves outside bytes and ${newline==='\n'?'LF':'CRLF'}, composes with lifecycle and repeats`,async()=>{
  const directory=await fixture(newline);
  try{
    const before=await contents(directory);assert.deepEqual((await patchGamepadHeldInput(directory)).changed,files);
    const after=await contents(directory);
    for(let i=0;i<files.length;i++){
      assert.deepEqual(after[i].subarray(0,prefix.length),prefix);assert.deepEqual(after[i].subarray(-suffix.length),suffix);
      const oldBody=before[i].subarray(prefix.length,-suffix.length).toString(),body=after[i].subarray(prefix.length,-suffix.length).toString();
      const start=oldBody.indexOf('    update: function (pad)'),end=oldBody.indexOf('        var i;',start);
      const replacement='    update: function (pad)'+newline+'    {'+newline+'        //  Browser timestamps may predate this wrapper; Button owns transition edges.'+newline;
      assert.equal(body,oldBody.slice(0,start)+replacement+oldBody.slice(end));
      assert.equal(newline==='\r\n'?/(?<!\r)\n/.test(body):body.includes('\r'),false);
    }
    assert.deepEqual((await patchGamepadHeldInput(directory)).changed,[]);assert.deepEqual(await contents(directory),after);
    await patchGamepadLifecycle(directory);assert.deepEqual((await patchGamepadHeldInput(directory)).changed,[]);
    assert.deepEqual((await patchGamepadLifecycle(directory)).changed,[]);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('held-input installer composes after lifecycle already applied',async()=>{
  const directory=await fixture();try{await patchGamepadLifecycle(directory);assert.deepEqual((await patchGamepadHeldInput(directory)).changed,files);assert.deepEqual((await patchGamepadLifecycle(directory)).changed,[]);}finally{await rm(directory,{recursive:true,force:true});}
});
for(const mutation of ['wrong-version','wrong-name','unknown-final-fragment','ambiguous-final-fragment','mixed-variants','mixed-files','mixed-newlines','missing-final-file'])test(`held-input all-target preflight refuses ${mutation} before writing`,async()=>{
  const directory=await fixture();
  try{
    if(mutation==='wrong-version'||mutation==='wrong-name')await writeFile(join(directory,'package.json'),JSON.stringify({name:mutation==='wrong-name'?'other':'phaser',version:mutation==='wrong-version'?'4.2.2':'4.2.1'}));
    else if(mutation==='missing-final-file')await rm(join(directory,files[2]));
    else if(mutation==='mixed-files'||mutation==='mixed-variants'){
      const before=await contents(directory);await patchGamepadHeldInput(directory);
      await writeFile(join(directory,files[2]),mutation==='mixed-files'?before[2]:Buffer.concat([await readFile(join(directory,files[2])),before[2]]));
    }else{
      let body=await readFile(join(directory,files[2]),'utf8');
      if(mutation==='unknown-final-fragment')body=body.replace('pad.timestamp < this._created','pad.timestamp <= this._created');
      if(mutation==='ambiguous-final-fragment')body+='\n'+modules[padKey];
      if(mutation==='mixed-newlines')body=body.replace('        var i;\n','        var i;\r\n');
      await writeFile(join(directory,files[2]),body);
    }
    const before=await contents(directory);await assert.rejects(()=>patchGamepadHeldInput(directory),/Phaser|ENOENT/);assert.deepEqual(await contents(directory),before);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('held-input CLI supports postinstall; import never patches and missing argument refuses',async()=>{
  const directory=await fixture();
  try{
    const before=await contents(directory);const imported=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(script.href)});`,directory],{encoding:'utf8'});assert.equal(imported.status,0,imported.stderr);assert.deepEqual(await contents(directory),before);
    const first=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(first.status,0,first.stderr);assert.deepEqual(JSON.parse(first.stdout).changed,files);
    const second=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});assert.equal(second.status,0,second.stderr);assert.deepEqual(JSON.parse(second.stdout).changed,[]);
    const invalid=spawnSync(process.execPath,[fileURLToPath(script)],{encoding:'utf8'});assert.equal(invalid.status,1);assert.match(invalid.stderr,/Usage:/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {spawnSync} from 'node:child_process';

// Extracted byte-for-byte (newline-normalized) from npm phaser@4.2.1 AudioFile.
const fixtureSource=(await readFile(new URL('./fixtures/phaser-audio-on-process-4.2.1.txt',import.meta.url),'utf8')).replaceAll('\r\n','\n');
const original=fixtureSource.slice(fixtureSource.indexOf('     * @method Phaser.Loader.FileTypes.AudioFile#onProcess'));
const script=new URL('../skills/engine-phaser/scripts/assets/phaser-audio-decode-patch.mjs',import.meta.url);
const patch=existsSync(script)?(await import(script)).patchAudioDecode:undefined;
const files=['src/loader/filetypes/AudioFile.js','dist/phaser.esm.js','dist/phaser.js'];
const prefix=Buffer.from('// held-input correction elsewhere stays intact\nconst unicode = "é";\n');
const suffix=Buffer.from('\n// unrelated trailing bytes\n');
async function fixture(newline='\n'){
  const directory=await mkdtemp(join(tmpdir(),'phaser-audio-decode-'));
  await writeFile(join(directory,'package.json'),JSON.stringify({name:'phaser',version:'4.2.1'}));
  for(const file of files){
    await mkdir(join(directory,file,'..'),{recursive:true});
    await writeFile(join(directory,file),Buffer.concat([prefix,Buffer.from(original.replaceAll('\n',newline)),suffix]));
  }
  return directory;
}
async function contents(directory){return Promise.all(files.map(file=>readFile(join(directory,file))));}
function installer(){assert.equal(typeof patch,'function','The guarded install-time correction is missing.');return patch;}
function processFunction(source){
  const start=source.indexOf('onProcess: function ()'),end=source.indexOf('\n\n});',start);
  return runInNewContext(`({${source.slice(start,end)}}).onProcess`,{CONST:{FILE_PROCESSING:17},console:{error:()=>{}}});
}
async function decode(source,outcome,promiseReturn=true){
  const buffer={native:'AudioBuffer'},error=Object.assign(Error('Invalid recording'),{name:'EncodingError'});
  const calls={success:0,error:0,rejectionsHandled:0},children=[];
  let returned;
  const context={decodeAudioData(bytes,success,failure){
    assert.equal(bytes,'native bytes');
    if(promiseReturn){
      returned=new Promise((resolve,reject)=>queueMicrotask(()=>{
        if(outcome==='success'){resolve(buffer);success(buffer);}else{reject(error);failure(error);}
      }));
      const catchPromise=returned.catch.bind(returned);
      returned.catch=handler=>{calls.rejectionsHandled++;const child=catchPromise(handler);children.push(child);return child;};
      // Observe without changing whether AudioFile attaches its own catch.
      returned.then(()=>{},()=>{});
      return returned;
    }
    queueMicrotask(()=>outcome==='success'?success(buffer):failure(error));
  }};
  const file={config:{context},xhrLoader:{response:'native bytes'},key:'recording',
    onProcessComplete(){calls.success++;},onProcessError(){calls.error++;}};
  processFunction(source).call(file);
  assert.equal(file.state,17);assert.equal(file.config.context,null);
  await Promise.resolve();await Promise.all(children);
  assert.equal(file.data,outcome==='success'?buffer:undefined);
  return calls;
}
test('pinned AudioFile calls native success/error once and ignores the paired Promise',async()=>{
  assert.deepEqual(await decode(original,'success'),{success:1,error:0,rejectionsHandled:0});
  assert.deepEqual(await decode(original,'failure'),{success:0,error:1,rejectionsHandled:0});
});
for(const outcome of ['success','failure'])test(`patched native ${outcome} remains callback-owned once and handles its returned Promise`,async()=>{
  const directory=await fixture();try{
    await installer()(directory);
    const bodies=await contents(directory);
    for(const body of bodies){
      const callbacks=source=>source.slice(source.indexOf('            function (audioBuffer)'),source.indexOf('\n        );'));
      assert.equal(callbacks(body.toString()),callbacks(original),'Both native callback bodies must remain byte-for-byte unchanged');
      assert.deepEqual(await decode(body.toString(),outcome),{success:outcome==='success'?1:0,error:outcome==='failure'?1:0,rejectionsHandled:1});
    }
    assert.equal(new Set(bodies.map(body=>body.toString())).size,1,'source, ESM and CJS must contain the same corrected function');
  }finally{await rm(directory,{recursive:true,force:true});}
});
for(const outcome of ['success','failure'])test(`legacy callback-only ${outcome} accepts an undefined decode return`,async()=>{
  const directory=await fixture();try{
    await installer()(directory);
    for(const body of await contents(directory))assert.deepEqual(await decode(body.toString(),outcome,false),{success:outcome==='success'?1:0,error:outcome==='failure'?1:0,rejectionsHandled:0});
  }finally{await rm(directory,{recursive:true,force:true});}
});
for(const newline of ['\n','\r\n'])test(`install is idempotent and preserves ${newline==='\n'?'LF':'CRLF'} plus every outside byte`,async()=>{
  const directory=await fixture(newline);try{
    const before=await contents(directory),first=await installer()(directory),after=await contents(directory);
    assert.equal(first.changed.length,3);
    for(let i=0;i<files.length;i++){
      assert.deepEqual(after[i].subarray(0,prefix.length),before[i].subarray(0,prefix.length));
      assert.deepEqual(after[i].subarray(-suffix.length),before[i].subarray(-suffix.length));
      const fragment=after[i].subarray(prefix.length,after[i].length-suffix.length).toString();
      if(newline==='\r\n')assert.equal(/(?<!\r)\n/.test(fragment),false);else assert.equal(fragment.includes('\r'),false);
      assert.equal(fragment.match(/_this\.onProcessError\(\)/g).length,1);
      assert.equal(fragment.match(/_this\.onProcessComplete\(\)/g).length,1);
    }
    assert.deepEqual((await installer()(directory)).changed,[]);
    assert.deepEqual(await contents(directory),after);
  }finally{await rm(directory,{recursive:true,force:true});}
});
for(const mutation of ['wrong-version','unknown-function','ambiguous-original','ambiguous-marker','missing-file','mixed-target-newlines'])test(`preflight refuses ${mutation} without partially writing earlier files`,async()=>{
  const directory=await fixture();try{
    if(mutation==='wrong-version')await writeFile(join(directory,'package.json'),JSON.stringify({name:'phaser',version:'4.2.2'}));
    else if(mutation==='missing-file')await rm(join(directory,files[2]));
    else{
      let body=(await readFile(join(directory,files[2]))).toString();
      if(mutation==='unknown-function')body=body.replace('_this.onProcessError();','_this.onProcessError(123);');
      if(mutation==='ambiguous-original')body+=original;
      if(mutation==='ambiguous-marker')body+='\n * @method Phaser.Loader.FileTypes.AudioFile#onProcess\n';
      if(mutation==='mixed-target-newlines')body=body.replace('        var _this = this;\n','        var _this = this;\r\n');
      await writeFile(join(directory,files[2]),body);
    }
    const snapshots=await Promise.all(files.map(file=>readFile(join(directory,file)).catch(error=>error.code==='ENOENT'?null:Promise.reject(error))));
    const install=installer();await assert.rejects(()=>install(directory),/Phaser|AudioFile|ENOENT/);
    const after=await Promise.all(files.map(file=>readFile(join(directory,file)).catch(error=>error.code==='ENOENT'?null:Promise.reject(error))));
    assert.deepEqual(after,snapshots);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('CLI supports a postinstall caller without an import side effect',async()=>{
  const directory=await fixture();try{
    installer();
    const result=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).changed.length,3);
    const second=spawnSync(process.execPath,[fileURLToPath(script),directory],{encoding:'utf8'});
    assert.equal(second.status,0,second.stderr);assert.deepEqual(JSON.parse(second.stdout).changed,[]);
  }finally{await rm(directory,{recursive:true,force:true});}
});

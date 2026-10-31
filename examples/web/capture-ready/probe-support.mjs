import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function setup(argv){
  const [host,...args]=argv;let vids,output,mutation;
  for(let i=0;i<args.length;i++){if(args[i]==='--vids')vids=resolve(args[++i]);else if(args[i]==='--output')output=resolve(args[++i]);else if(args[i]==='--mutation')mutation=args[++i];else throw Error('Unknown argument '+args[i]);}
  assert(host&&vids,'Usage: <host> --vids <managed run-managed.js> [--output <evidence>] [--mutation frames|audio]');
  assert(!mutation||['frames','audio'].includes(mutation),'Unknown mutation');
  const evidence=output||await mkdtemp(join(tmpdir(),'phaser-capture-evidence-'));if(output)await mkdir(evidence);
  const require=createRequire(join(resolve(host),'package.json'));assert.equal(require('phaser/package.json').version,'4.2.1');
  const report={evidence,passed:false,mutation:mutation||null,commands:[],receipts:[],cleanup:{},sources:{}};
  const command=async(label,exe,argv,expected=0)=>{
    const out=join(evidence,label+'.stdout'),err=join(evidence,label+'.stderr');let stdout='',stderr='';
    const outcome=await new Promise((done,reject)=>{const child=spawn(exe,argv,{cwd:evidence,windowsHide:true,stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>{stderr+='\nProducer command exceeded its 240-second bound.\n';if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();},240000);child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);done(code);});});
    await writeFile(out,stdout);await writeFile(err,stderr);report.commands.push({label,exe,argv,exit:outcome,stdout:out,stderr:err});
    if(expected!==null)assert.equal(outcome,expected,`${label}: ${stderr.slice(-1800)} ${stdout.slice(-1800)}`);
    return {exit:outcome,stdout,stderr};
  };
  const run=(label,args,expected=0)=>command(label,process.execPath,[vids,...args],expected);
  try{
  const checked=JSON.parse((await command('producer-setup',process.execPath,[join(dirname(vids),'setup.js'),'--check','--json'])).stdout);assert(checked.ok);assert.equal(checked.cliVersion,'0.5.0');report.producer=checked;
  report.doctor=JSON.parse((await run('doctor',['doctor','--json'])).stdout);assert(report.doctor.ok);
  for(const id of ['stepped-capture','capture-seed','activate-action','wait-until-action','viewport-override','game-discover','verify-determinism','channel-youtube-pixel'])assert(report.doctor.capabilities.some(c=>c.id===id&&c.present),id);
  const runtimeRequire=createRequire(join(checked.runtimeRoot,'package.json')),ffmpeg=runtimeRequire('ffmpeg-static');
  for(const rel of ['src/capture/clock.ts','src/capture/capture.ts','src/capture/determinism.ts','src/capture/browser.ts','src/doctor.ts','src/discover/crawl.ts','src/render.ts','src/storyboard/schema.ts','library/channels/youtube-pixel.json'])report.sources['producer/'+rel]=hash(await readFile(join(checked.runtimeRoot,rel)));
  report.encoder={path:ffmpeg,sha256:hash(await readFile(ffmpeg)),version:(await command('encoder-version',ffmpeg,['-version'])).stdout};
  const routes=new Map();
  for(const name of ['index.html','fixture.mjs','storyboard.json']){const bytes=await readFile(new URL('./'+name,import.meta.url));routes.set('/'+name,bytes);report.sources[name]=hash(bytes);await writeFile(join(evidence,name),bytes);}
  routes.set('/phaser.js',await readFile(require.resolve('phaser')));routes.set('/debug.mjs',await readFile(new URL('../harness/debug.mjs',import.meta.url)));report.sources.phaser=hash(routes.get('/phaser.js'));report.sources.debug=hash(routes.get('/debug.mjs'));
  // Authored test cue: whole-file mono PCM, 440 Hz for 200 ms. No engine audio decoder is involved.
  const samples=9600,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/48000)*12000),44+i*2);routes.set('/cue.wav',wav);report.sources.cue=hash(wav);await writeFile(join(evidence,'cue.wav'),wav);
  let drift=0;const requests=[];
  const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://fixture');requests.push({method:req.method,path:url.pathname,query:url.search});
    if(url.pathname==='/receipt'){let body='';for await(const c of req)body+=c;report.receipts.push(JSON.parse(body));res.end('ok');return;}
    if(url.pathname==='/'&&url.searchParams.has('drift')){res.writeHead(302,{location:'/?variant='+(drift++%2)});res.end();return;}
    const key=url.pathname==='/'?'/index.html':url.pathname,bytes=routes.get(key);if(!bytes){res.writeHead(404);res.end('missing');return;}
    res.setHeader('Content-Type',key.endsWith('.html')?'text/html':key.endsWith('.wav')?'audio/wav':'text/javascript');res.end(bytes);
  });await new Promise(done=>server.listen(0,'127.0.0.1',done));const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  const storyboard=async(name,{mode='external',path='/',seconds=10}={})=>{
    const folder=join(evidence,name,'storyboards');await mkdir(folder,{recursive:true});const sb=JSON.parse(routes.get('/storyboard.json'));sb.name=name;sb.build=report.sources['fixture.mjs'];sb.app.url=origin;sb.scenes[0].path=path==='/'?'/?mode='+mode:path;
    sb.scenes[0].beats[0].do=[{wait:Math.min(1000,seconds*1000)},{activate:'#cue'},{wait:Math.max(0,seconds*1000-1000)},{script:'receipt.js'}];
    await writeFile(join(folder,'configure.js'),"captureFixture.configure(); captureFixture.receipt('before');");
    await writeFile(join(folder,'receipt.js'),`${mode==='manual-frames'?'captureFixture.handFrames(); ':''}captureFixture.receipt('after');`);
    const file=join(folder,'storyboard.json');await writeFile(file,JSON.stringify(sb,null,2));report.sources[name+'/storyboard.json']=hash(await readFile(file));for(const script of ['configure.js','receipt.js'])report.sources[name+'/'+script]=hash(await readFile(join(folder,script)));return {file,out:join(evidence,name,'out',name),sb};
  };
  const frames=async dir=>{const names=(await readdir(dir)).filter(x=>x.endsWith('.jpg')).sort();return Promise.all(names.map(async file=>({file,sha256:hash(await readFile(join(dir,file)))})));};
  return {report,evidence,run,command,ffmpeg,require,origin,storyboard,frames,mutation,async finish(error){if(error){report.failure={message:error.message,stack:error.stack};process.exitCode=1;}report.requests=requests;await new Promise(done=>server.close(done));report.cleanup.serverClosed=!server.listening;report.serverPort=port;await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,evidence,failure:report.failure?.message}));}};
  }catch(error){report.failure={message:error.message,stack:error.stack};await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));console.error(JSON.stringify({passed:false,evidence,failure:error.message}));throw error;}
}

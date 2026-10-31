// Manual lane: node phaser-capture-ready.mjs <host> --vids <run-managed.js> [--output <unique-directory>]
// --mutation frames|audio exposes each retained adverse witness as an expected nonzero probe invocation.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {setup,hash} from '../capture-ready/probe-support.mjs';
const p=await setup(process.argv.slice(2));let failure,browser;
const files=async dir=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]))).flat();
async function compare(name,path,expected){
  const f=await p.storyboard(name,{path});await p.run(name+'-validate',['validate',f.file]);await p.run(name+'-lint',['lint',f.file]);
  const result=await p.run(name+'-compare',['verify-determinism',f.file,'--runs','2','--tolerate','0','--seed','7','--keep'],null);
  const a=await p.frames(join(f.out,'determinism','run-1','scene-0')),b=await p.frames(join(f.out,'determinism','run-2','scene-0'));
  const differing=Array.from({length:Math.max(a.length,b.length)},(_,i)=>i).filter(i=>a[i]?.sha256!==b[i]?.sha256);
  const resultFile=join(p.evidence,name+'-frames.json');await writeFile(resultFile,JSON.stringify({a,b,differing},null,2));
  const witness={exit:result.exit,counts:[a.length,b.length],differing:differing.length,hashes:resultFile,storyboard:hash(await readFile(f.file))};p.report[name]=witness;
  assert(a.length>0&&a.length===b.length,'positive equal captured-frame counts');assert.equal(result.exit,expected,'real producer comparison exit');
  if(expected===0)assert.equal(differing.length,0,'captured frame hashes');else assert(differing.length>0,'adverse mutation must change captured frames');return f;
}
async function renderAudio(name,f,expected){
  const result=await p.run(name+'-render',['render',f.file,'--draft'],null);
  const all=await files(f.out),video=all.find(x=>x.endsWith('-draft.mp4'));assert(video,'retained draft video');
  const decoded=join(p.evidence,name+'-audio.f32');const decode=await p.command(name+'-decode',p.ffmpeg,['-y','-i',video,'-vn','-ac','1','-ar','48000','-f','f32le',decoded]);
  const bytes=await readFile(decoded),energy=[];for(let first=0;first<bytes.length/4;first+=480){let sum=0;for(let i=first;i<Math.min(first+480,bytes.length/4);i++)sum+=bytes.readFloatLE(i*4)**2;energy.push(Math.sqrt(sum/480));}
  const active=energy.flatMap((r,i)=>r>0.01?[i]:[]),start=active.length?active[0]/100:null,end=active.length?(active.at(-1)+1)/100:null;
  const downloads=[];for(const file of all.filter(x=>x.endsWith('.wav')&&x.includes(join('work','sounds'))))if(hash(await readFile(file))===p.report.sources.cue)downloads.push(file);
  const receipt=p.report.receipts.filter(x=>x.label==='after').at(-1),audio=receipt?.audio?.[0];
  // The source is a 440-Hz cue; correlation rejects unrelated broadband noise or a different tone.
  let sine=0,cosine=0,squares=0,n=0;if(start!==null)for(let i=Math.ceil(start*48000);i<Math.min(Math.floor(end*48000),bytes.length/4);i++){const v=bytes.readFloatLE(i*4);sine+=v*Math.sin(2*Math.PI*440*i/48000);cosine+=v*Math.cos(2*Math.PI*440*i/48000);squares+=v*v;n++;}
  const coherence=n&&squares?2*(sine*sine+cosine*cosine)/(n*squares):0;
  const cuePresent=downloads.length>0&&audio?.url==='/cue.wav'&&start>=0.9&&start<=1.5&&end-start>=0.15&&end-start<=0.3&&coherence>0.8;
  const witness={exit:result.exit,video,videoSha256:hash(await readFile(video)),decoded,decodedSha256:hash(bytes),downloads,receipt:audio,start,end,coherence,cuePresent,output1920x1080:/1920x1080/.test(decode.stderr)};
  p.report[name]=witness;await writeFile(join(p.evidence,name+'-audio.json'),JSON.stringify(witness,null,2));
  assert.equal(result.exit,0,'draft rendering');assert(witness.output1920x1080,'encoded output dimensions');assert.equal(cuePresent,expected,'whole-file cue receipt + downloaded bytes + decoded recording-window witness');
  if(!expected){assert.equal(audio?.url,'/missing.wav');assert.equal(downloads.length,0);assert.equal(active.length,0,'missing cue produces silent decoded audio');}return witness;
}
try{
  if(!p.mutation){
    const discover=join(p.evidence,'discover');await p.run('discover',['discover',p.origin,'--repo',p.evidence,'--out',discover,'--channel','youtube-pixel','--max-pages','1','--max-depth','0']);
    const profile=JSON.parse(await readFile(join(discover,'app-profile.json'),'utf8')),controls=profile.screens[0].controls;p.report.controls=controls;
    for(const name of ['Start capture','Play capture cue'])assert.equal(controls.filter(c=>c.name===name).length,1,'unique discovered semantic control '+name);
    browser=await p.require('@playwright/test').chromium.launch({headless:true});p.report.browserVersion=browser.version();
    const context=await browser.newContext({viewport:{width:384,height:216},deviceScaleFactor:5}),page=await context.newPage();
    await page.goto(p.origin);await page.waitForFunction(()=>window.captureFixture?.snapshot().ready);p.report.initial=await page.evaluate(()=>captureFixture.snapshot());assert(p.report.initial.gate);
    const png=await page.screenshot({path:join(p.evidence,'native-geometry.png')});
    p.report.geometry=await page.evaluate(async data=>{const img=new Image();img.src=data;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;let white=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]===255&&pixels[i+1]===255&&pixels[i+2]===255)white++;return {width:c.width,height:c.height,white};},'data:image/png;base64,'+png.toString('base64'));
    assert.deepEqual(p.report.geometry,{width:1920,height:1080,white:25});await page.locator('#start').focus();await page.keyboard.press('Enter');
    p.report.activated=await page.evaluate(()=>captureFixture.snapshot());assert.equal(p.report.activated.actions.length,1);assert(p.report.activated.actions[0].trusted);assert(!p.report.activated.gate);
    p.report.cleanup.fixture=await page.evaluate(()=>captureFixture.dispose());assert(p.report.cleanup.fixture.canvasRemoved&&p.report.cleanup.fixture.rendererReleased);await context.close();await browser.close();browser=null;p.report.cleanup.browserClosed=true;
    const positive=await compare('positive','/',0);await renderAudio('positive-audio',positive,true);
    const producerReceipts=p.report.receipts.filter(x=>x.label==='after');assert(producerReceipts.length>=3);
    for(const r of producerReceipts){assert(r.ready&&!r.gate&&r.loopRunning&&r.ticks>0);assert.deepEqual(r.actions.map(x=>x.id),['start','cue']);assert(r.actions.every(x=>x.trusted));assert.equal(r.actions[0].gateBefore,false,'capture-local title skip before activation');assert.equal(r.seedChoice,producerReceipts[0].seedChoice);assert.equal(r.canvas.dpr,5);assert.equal(r.canvas.width,384);assert.equal(r.canvas.height,216);}
  }
  if(p.mutation!=='audio'){
    await compare('changed-frames','/?drift=1',1);
    if(p.mutation==='frames')assert.equal(p.report['changed-frames'].differing,0,'captured frame hashes: deliberate source variant differs');
  }
  if(p.mutation!=='frames'){
    const missing=await p.storyboard('missing-audio',{path:'/?missing=1'});const witness=await renderAudio('missing-audio',missing,false);
    if(p.mutation==='audio')assert(witness.cuePresent,'whole-file cue witness: missing audio asset');
  }
  p.report.passed=true;
}catch(error){failure=error;}
finally{if(browser){await browser.close();p.report.cleanup.browserClosed=true;}await p.finish(failure);}

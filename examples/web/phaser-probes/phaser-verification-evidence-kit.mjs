// Run: node phaser-verification-evidence-kit.mjs <host> [--output <directory>] [--mutation off-palette|split-cell|long-word|missing-glyph]
// Canvas-only bounded instruments. Default records two positive layouts and all four adverse controls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {measureRgbaRegion} from '../../../skills/phaser-verification/scripts/assets/measure-rgba-regions.mjs';

const mutations = ['off-palette','split-cell','long-word','missing-glyph'];
const [host,...args] = process.argv.slice(2);
let output, mutation;
for (let i=0;i<args.length;i++) {
  if (args[i]==='--output' && args[i+1]) output=resolve(args[++i]);
  else if (args[i]==='--mutation' && mutations.includes(args[i+1])) mutation=args[++i];
  else throw new Error('expected --output <new directory> or --mutation off-palette|split-cell|long-word|missing-glyph');
}
if (!host) throw new Error('host project with Phaser 4.2.1 and Playwright is required');
const evidence = output ? (await mkdir(output), output) : await mkdtemp(join(tmpdir(),'phaser-evidence-kit-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {evidence,mutation:mutation??null,passed:false,cases:[],errors:[],sources:{},cleanup:{},limits:['Canvas only; no GPU or compositor alpha parity','ASCII fixture fonts, identity camera, integer scales 1 and 2 only','No causal paint attribution, aesthetic quality, CVD or consumer adoption claim']};
let server,browser,context,page;
const save = () => writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));
const png = (name,data) => writeFile(join(evidence,name),Buffer.from(data.split(',')[1],'base64'));
try {
  const require = createRequire(resolve(host,'package.json'));
  const pw = ['@playwright/test','playwright','playwright-core'].map(name=>{try{return require(name);}catch{return null;}}).find(Boolean);
  assert(pw,'host needs Playwright');
  const files = {phaser:await readFile(require.resolve('phaser')),fixture:await readFile(new URL('../harness/text-fit-fixture.mjs',import.meta.url)),helper:await readFile(new URL('../../../skills/phaser-verification/scripts/assets/measure-rgba-regions.mjs',import.meta.url)),probe:await readFile(new URL(import.meta.url))};
  for (const [name,bytes] of Object.entries(files)) {report.sources[name]={sha256:hash(bytes),bytes:bytes.length,file:name+'.source.mjs'};await writeFile(join(evidence,name+'.source.mjs'),bytes);}
  server=createServer((req,res)=>{
    if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><body style="margin:0"><script src="/phaser.js"></script></body>');}
    else if(req.url==='/phaser.js'||req.url==='/fixture.mjs'){res.setHeader('content-type','text/javascript');res.end(files[req.url==='/phaser.js'?'phaser':'fixture']);}
    else {res.statusCode=404;res.end();}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  browser=await pw.chromium.launch({channel:process.env.CHROME_CHANNEL||'chromium',timeout:20000});report.browser=browser.version();
  context=await browser.newContext({viewport:{width:160,height:120},deviceScaleFactor:1});
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const sources=await page.evaluate(async()=>{const {createTextFitFixture}=await import('/fixture.mjs');window.fixture=await createTextFitFixture();return window.fixture.sources;});
  for (const [name,source] of Object.entries(sources)) {
    const bytes=Buffer.from(source.rgba);await writeFile(join(evidence,name+'.rgba'),bytes);await png(name+'.png',source.png);
    report.sources[name]={sha256:hash(bytes),width:source.width,height:source.height,rgba:name+'.rgba',png:name+'.png'};
  }
  const cases=mutation?[{scale:1,mutation}]:[{scale:1},{scale:2},...mutations.map(mutation=>({scale:1,mutation}))];
  for (const current of cases) {
    const label=current.mutation??'positive-'+current.scale;
    const capture=await page.evaluate(current=>{window.fixture.layout(current.scale,current.mutation);return window.fixture.capture();},current);
    const {rgba,png:frame,...facts}=capture, bytes=Buffer.from(rgba);
    const measurement=measureRgbaRegion({rgba:bytes,width:capture.width,height:capture.height,...capture.declaration});
    const failures=[];
    if(measurement.offPalettePixels) failures.push({witness:'off-palette',count:measurement.offPalettePixels});
    if(measurement.splitCells) failures.push({witness:'split-cell',count:measurement.splitCells});
    for(const text of facts.text){if(!text.fits)failures.push({witness:'long-word',id:text.id,bounds:text.bounds,allocation:text.allocation});if(text.missingGlyphs.length)failures.push({witness:'missing-glyph',id:text.id,glyphs:text.missingGlyphs});}
    const record={label,...facts,input:{rgba:label+'.rgba',sha256:hash(bytes),png:label+'.png'},measurement,failures};
    report.cases.push(record);
    // Persist decoded bytes, lossless frame and measured failures before any witness assertion.
    await writeFile(join(evidence,label+'.rgba'),bytes);await png(label+'.png',frame);await writeFile(join(evidence,label+'.json'),JSON.stringify(record,null,2));await save();
    assert.equal(capture.version,'4.2.1');assert.equal(capture.renderer,'CanvasRenderer');
    assert(facts.text.every(text=>text.registered&&text.type==='BitmapText'),'actual registered native BitmapText objects');
    for(const text of facts.text) assert.deepEqual(text.nativeCharacters.map(glyph=>glyph.code),text.requiredGlyphs.filter(glyph=>!text.missingGlyphs.some(missing=>missing.code===glyph.code)).map(glyph=>glyph.code),'native character coverage agrees with the actual font');
    if(mutation) assert.equal(failures.length,0,`${mutation}: ${JSON.stringify(failures)}`);
    else if(current.mutation) {
      assert(failures.some(failure=>failure.witness===current.mutation),`${current.mutation} escaped its actual measurement`);
      if(current.mutation==='off-palette')assert.equal(measurement.offPalettePixels,1);
      if(current.mutation==='split-cell'){assert.equal(measurement.splitCells,1);assert.equal(measurement.offPalettePixels,0);}
      if(current.mutation==='missing-glyph')assert(facts.text.every(text=>text.fits),'missing glyph must fail even when bounds fit');
    } else assert.deepEqual(failures,[],'positive region and native text measurements');
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
} catch(error) {
  report.failure={name:error.name,message:error.message};process.exitCode=1;
  if(page)try{await page.screenshot({path:join(evidence,'failure-compositor.png')});}catch(captureError){report.captureError=captureError.message;}
} finally {
  await save();
  if(page)try{
    report.cleanup.fixture=await page.evaluate(()=>window.fixture?.dispose());
    assert(report.cleanup.fixture?.disposed);assert(report.cleanup.fixture.canvasRemoved);assert(report.cleanup.fixture.rendererCanvasReleased);assert(report.cleanup.fixture.rendererContextReleased);assert.equal(report.cleanup.fixture.sceneCount,0);
  }catch(error){report.cleanup.error=error.message;report.passed=false;process.exitCode=1;}
  if(context){await context.close();report.cleanup.contextClosed=true;}
  if(browser){await browser.close();report.cleanup.browserClosed=!browser.isConnected();}
  if(server){await new Promise(done=>server.close(done));report.cleanup.serverClosed=!server.listening;}
  await save();
}
console.log(JSON.stringify(report,null,2));

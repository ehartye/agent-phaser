// Purpose: check the Phaser 4.2.1 Gamepad API facts that the phaser-input skill documents, against a fake navigator.getGamepads
// (Canvas renderer, no GPU and no physical controller):
//   - plugin-level events are (pad, button, value), pad-level events are (index, value, button);
//   - a Button is pressed only at value >= threshold, and the default threshold is 1, so a 0.6 trigger is not pressed;
//   - a stick axis below its threshold (0.1) reads 0 per component;
//   - the named properties (A, B, X, Y, L1, R2, up, down, ...) are hard-wired to the standard-mapping indices: a pad whose
//     mapping is "" is read through the same indices;
//   - the pad state is refreshed in the Game PRE_RENDER hook, after the scene update of the same frame.
//
// Run:    node phaser-input-gamepad.mjs /absolute/path/to/project-with-phaser-and-playwright
//         (the project needs `phaser` and one of `playwright-core`, `playwright` or `@playwright/test`; any Chromium works).
// Expect: exit code 0 and a JSON object. This is synthetic input: it proves the mapping inside Phaser, not a physical device.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve,join,dirname } from 'node:path';
import {cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {patchGamepadHeldInput} from '../../../skills/phaser-input/scripts/assets/phaser-gamepad-held-input-patch.mjs';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const pw = ['@playwright/test', 'playwright', 'playwright-core'].map((name) => { try { return require(name); } catch { return null; } }).find(Boolean);
assert.ok(pw, 'install @playwright/test, playwright or playwright-core in the project');
const installed=dirname(require.resolve('phaser/package.json'));
const targets=['src/input/gamepad/Gamepad.js','dist/phaser.esm.js','dist/phaser.js'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const originals=await Promise.all(targets.map(file=>readFile(join(installed,file))));
for(let i=0;i<targets.length;i++)assert.match(originals[i].toString(),/if \(pad.timestamp < this\._created\)/,'the comparison host must contain pristine Phaser 4.2.1 held-input fragments');
assert.equal(JSON.parse(await readFile(join(installed,'package.json'),'utf8')).version,'4.2.1');
const temporary=await mkdtemp(join(tmpdir(),'phaser-gamepad-browser-'));
let browser;
let out;
try{
  const baseline=join(temporary,'baseline'),corrected=join(temporary,'corrected');
  await cp(installed,baseline,{recursive:true});await cp(installed,corrected,{recursive:true});
  assert.equal((await patchGamepadHeldInput(corrected)).changed.length,3);
  assert.deepEqual((await patchGamepadHeldInput(corrected)).changed,[]);
  browser = await pw.chromium.launch({ channel: process.env.CHROME_CHANNEL || undefined, timeout: 20000 });
  const page = await (await browser.newContext({ viewport: { width: 200, height: 160 } })).newPage();
  page.setDefaultTimeout(15000);
  await page.setContent('<!doctype html><body style="margin:0"><div id="game"></div></body>');
  await page.addScriptTag({ path: join(baseline,'dist/phaser.js') });
  out = await page.evaluate(async () => {
    // A fake pad API: fresh snapshots on every call, null for empty slots.
    const slots = [null, null, null, null];
    const snap = (index, id, mapping, buttons, axes) => ({
      id, index, mapping, connected: true, timestamp: performance.now(), vibrationActuator: null,
      buttons: Array.from({ length: buttons }, () => ({ pressed: false, touched: false, value: 0 })), axes: new Array(axes).fill(0),
    });
    navigator.getGamepads = () => slots.map((s) => (s ? JSON.parse(JSON.stringify(s)) : null));
    const connect = (index, id, mapping, buttons, axes) => {
      slots[index] = snap(index, id, mapping, buttons, axes);
      window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: slots[index] }));
    };
    const press = (index, button, value) => { const s = slots[index]; s.buttons[button] = { pressed: value >= 0.5, touched: value > 0, value }; s.timestamp = performance.now(); };
    const tilt = (index, axis, value) => { const s = slots[index]; s.axes[axis] = value; s.timestamp = performance.now(); };

    const log = [], scenes = {};
    class Main extends Phaser.Scene {
      constructor() { super('Main'); }
      create() {
        scenes.main = this;
        this.input.gamepad.on('down', (...args) => log.push(['plugin-down', args.length, args[0].index, args[1].index, args[2]]));
        this.input.gamepad.on('up', (...args) => log.push(['plugin-up', args.length, args[0].index, args[1].index, args[2]]));
      }
    }
    const game = new Phaser.Game({ type: Phaser.CANVAS, width: 100, height: 100, parent: 'game', audio: { noAudio: true }, input: { gamepad: true }, scene: [Main] });
    await new Promise((r) => { const t = setInterval(() => { if (scenes.main) { clearInterval(t); r(); } }, 20); });
    const frames = async (n = 2) => { for (let i = 0; i < n; i++) await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r)); };
    await frames();
    const pads = () => scenes.main.input.gamepad;
    const result = { version: Phaser.VERSION };

    connect(0, 'Standard Pad (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 'standard', 17, 4);
    await frames();
    press(0, 0, 1); await frames();
    result.pluginDown = log.splice(0);
    result.A = pads().pad1.A;
    const padLevel = [];
    pads().pad1.on('down', (...args) => padLevel.push([args.length, typeof args[0], typeof args[1], args[2].constructor.name]));
    press(0, 0, 0); await frames(); log.length = 0;
    press(0, 1, 1); await frames();
    result.padLevelDown = padLevel;
    press(0, 1, 0); await frames();

    log.length = 0;
    press(0, 7, 0.6); await frames();
    result.trigger = { R2: pads().pad1.R2, pressed: pads().pad1.buttons[7].pressed, threshold: pads().pad1.buttons[7].threshold, events: log.splice(0).length };
    tilt(0, 0, 0.08); tilt(0, 1, 0.5); await frames();
    result.stick = { x: pads().pad1.leftStick.x, y: pads().pad1.leftStick.y, rawX: pads().pad1.axes[0].value };

    connect(1, 'Generic USB Joystick (Vendor: 0079 Product: 0006)', '', 12, 6);
    await frames();
    press(1, 0, 1); press(1, 2, 1); await frames();
    const generic = pads().getPad(1);
    result.nonStandardMapping = { mapping: generic.pad.mapping, A: generic.A, X: generic.X };

    const order = [];
    const pad = pads().pad1, update = pad.update.bind(pad);
    pad.update = (p) => { order.push('pad.update'); return update(p); };
    game.events.on(Phaser.Core.Events.POST_STEP, () => order.push('POST_STEP'));
    game.events.on(Phaser.Core.Events.PRE_RENDER, () => order.push('PRE_RENDER'));
    await frames(2);
    result.frameOrder = order.slice(0, 3);
    return result;
  });

  out.heldInput={sourceHashes:Object.fromEntries(await Promise.all(targets.map(async(file,i)=>[file,{baseline:hash(originals[i]),corrected:hash(await readFile(join(corrected,file)))}]))),runs:[]};
  for(const [label,directory] of [['baseline',baseline],['corrected',corrected]])for(let repeat=1;repeat<=2;repeat++){
    const context=await browser.newContext({viewport:{width:200,height:160}});
    try{
      const heldPage=await context.newPage();heldPage.setDefaultTimeout(15000);
      const pageErrors=[];heldPage.on('pageerror',error=>pageErrors.push(error.message));
      await heldPage.setContent('<!doctype html><body><div id="held"></div></body>');
      await heldPage.addScriptTag({path:join(directory,'dist/phaser.js')});
      const result=await heldPage.evaluate(async()=>{
        // Native browser snapshots have an unchanged timestamp older than Gamepad._created.
        const sample=(index,value)=>({id:'Held '+index,index,mapping:'standard',connected:true,timestamp:0,axes:[.12,.05,0,0],buttons:Array.from({length:17},(_,i)=>({value:i===0?value:0,pressed:i===0&&value>=.5,touched:false}))});
        const slots=[sample(0,.7),null];navigator.getGamepads=()=>slots.map(s=>s?JSON.parse(JSON.stringify(s)):null);
        let scene;const edges=[];
        class Held extends Phaser.Scene{
          create(){
            scene=this;const pad=this.input.gamepad.getPad(0);pad.buttons[0].threshold=.5;pad.setAxisThreshold(0);
            this.input.gamepad.on('down',pad=>edges.push(['down',pad.index]));this.input.gamepad.on('up',pad=>edges.push(['up',pad.index]));
          }
        }
        const game=new Phaser.Game({type:Phaser.CANVAS,width:32,height:32,parent:'held',audio:{noAudio:true},input:{gamepad:true},scene:[Held]});
        const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('held-input probe timed out')),10000))]);
        await bounded(new Promise(resolve=>{const timer=setInterval(()=>{if(scene){clearInterval(timer);resolve();}},10);}));
        const frames=async(n=2)=>{for(let i=0;i<n;i++)await bounded(new Promise(resolve=>game.events.once(Phaser.Core.Events.POST_RENDER,resolve)));};
        const state=index=>{const pad=scene.input.gamepad.getPad(index);return {value:pad.buttons[0].value,pressed:pad.buttons[0].pressed,y:pad.leftStick.y};};
        try{
          await frames();const boot=state(0),bootEdges=edges.splice(0);
          slots[0]=sample(0,0);await frames();slots[0]=sample(0,.6);await frames();const freshEdges=edges.splice(0),fresh=state(0);
          // A second already-exposed pad is acquired through native polling, with no lifecycle event.
          slots[1]=sample(1,.7);await frames(1);const acquired=scene.input.gamepad.getPad(1);acquired.buttons[0].threshold=.5;acquired.setAxisThreshold(0);await frames();
          const acquisition=state(1),acquisitionEdges=edges.splice(0);
          slots[0]=sample(0,0);await frames();edges.length=0;
          scene.scene.pause();slots[0]=sample(0,.7);await frames();scene.scene.resume();await frames(3);
          const resume=state(0),resumeEdges=edges.splice(0);await frames();const repeatedEdges=edges.splice(0);
          return {version:Phaser.VERSION,renderer:game.renderer.constructor.name,boot,bootEdges,fresh,freshEdges,acquisition,acquisitionEdges,resume,resumeEdges,repeatedEdges};
        }finally{game.destroy(true);}
      });
      assert.deepEqual(pageErrors,[]);assert.equal(result.version,'4.2.1');
      if(label==='corrected'){
        for(const field of ['boot','acquisition','resume'])assert.deepEqual(result[field],{value:.7,pressed:true,y:.05},field);
        assert.deepEqual(result.bootEdges,[],'native constructor seeds held state without a down edge');
        assert.deepEqual(result.freshEdges,[['up',0],['down',0]]);assert.deepEqual(result.fresh,{value:.6,pressed:true,y:.05});
        assert.deepEqual(result.acquisitionEdges,[]);assert.deepEqual(result.resumeEdges,[['down',0]]);assert.deepEqual(result.repeatedEdges,[]);
      }else{
        for(const field of ['boot','acquisition','resume'])assert.deepEqual(result[field],{value:0,pressed:true,y:0},field+' baseline adverse');
        assert.deepEqual(result.bootEdges,[]);assert.deepEqual(result.freshEdges,[]);assert.deepEqual(result.acquisitionEdges,[]);assert.deepEqual(result.resumeEdges,[]);assert.deepEqual(result.repeatedEdges,[]);
      }
      out.heldInput.runs.push({label,repeat,...result});
    }finally{await context.close();}
  }
} finally {
  await browser?.close();
  await rm(temporary,{recursive:true,force:true});
  for(let i=0;i<targets.length;i++)assert.deepEqual(await readFile(join(installed,targets[i])),originals[i],'comparison host bytes remain unchanged');
}
console.log(JSON.stringify(out, null, 2));
assert.deepEqual(out.pluginDown, [['plugin-down', 3, 0, 0, 1]], 'plugin down is (pad, button, value)');
assert.equal(out.A, true);
assert.deepEqual(out.padLevelDown, [[3, 'number', 'number', 'Button']], 'pad down is (index, value, button)');
assert.deepEqual(out.trigger, { R2: 0.6, pressed: false, threshold: 1, events: 0 }, 'a 0.6 trigger is not pressed at the default threshold');
assert.deepEqual(out.stick, { x: 0, y: 0.5, rawX: 0.08 }, 'axis below 0.1 reads 0');
assert.deepEqual(out.nonStandardMapping, { mapping: '', A: true, X: true }, 'named properties ignore the mapping string');
assert.deepEqual(out.frameOrder, ['POST_STEP', 'pad.update', 'PRE_RENDER'], 'pads refresh after the scene update, in PRE_RENDER');

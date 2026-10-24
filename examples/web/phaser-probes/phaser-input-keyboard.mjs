// Purpose: reproduce the Phaser 4.2.1 keyboard behaviours that the phaser-input skill documents, with the Canvas renderer
// (input logic only, no GPU needed):
//   1. one DOM key event reaches the listeners of EVERY active scene, synchronously, and a down+up inside one frame leaves
//      isDown and JustDown false while the Key still emits `down`;
//   2. three or more key events inside one frame make earlier events reach listeners again (the plugin re-walks the whole queue
//      on every DOM event, and its duplicate guard only remembers the previous event);
//   3. stopping or restarting ONE scene removes the window-blur key reset of EVERY scene (KeyboardPlugin#shutdown calls
//      game.events.off(BLUR, resetKeys) without the scene context), so a key held across Alt-Tab stays down in the survivors;
//   4. OS auto-repeat is dropped from `keydown` for a code that has a Key object in that scene, stopPropagation reaches only
//      later scenes, a sleeping scene hears nothing and pausing resets its keys;
//   5. addKey/addKeys capture their key globally by default (preventDefault on unmodified keydown), the capture survives the
//      scene that made it and blocks that letter in a DOM <input> until clearCaptures(); disableGlobalCapture() stops it;
//      keyboard.target = a canvas keeps field keystrokes away from Phaser;
//   6. the mitigation: a scene created with input: { keyboard: false } owns no plugin and takes no part in 1 to 3.
//
// Run:    node phaser-input-keyboard.mjs /absolute/path/to/project-with-phaser-and-playwright
//         (the project needs `phaser` and one of `playwright-core`, `playwright` or `@playwright/test`; any Chromium works).
// Expect: exit code 0 and a JSON object. On Phaser 4.2.1 the defect flags are true; on another version the script only
//         reports the observed values (a false flag there means the defect is gone, which is the signal to drop the workaround).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const pw = ['@playwright/test', 'playwright', 'playwright-core'].map((name) => { try { return require(name); } catch { return null; } }).find(Boolean);
assert.ok(pw, 'install @playwright/test, playwright or playwright-core in the project');
const browser = await pw.chromium.launch({ channel: process.env.CHROME_CHANNEL || undefined, timeout: 20000 });
let report;
try {
  const page = await (await browser.newContext({ viewport: { width: 240, height: 200 } })).newPage();
  page.setDefaultTimeout(15000);
  await page.setContent('<!doctype html><body style="margin:0"><div id="game"></div></body>');
  await page.addScriptTag({ path: require.resolve('phaser') });
  report = await page.evaluate(async () => {
    const scenes = {};
    const send = (type, keyCode, key, extra = {}) => {
      const event = new KeyboardEvent(type, { keyCode, key, bubbles: true, cancelable: true, ...extra });
      window.dispatchEvent(event);
      return event;
    };
    class Owner extends Phaser.Scene {
      constructor() { super('Owner'); }
      create() {
        scenes.owner = this;
        this.keyA = this.input.keyboard.addKey('A');
        this.downEvents = 0;
        this.keyA.on('down', () => this.downEvents++);
        this.seen = [];
        this.input.keyboard.on('keydown', (e) => this.seen.push('dn' + e.key + (e.repeat ? '*' : '')));
        this.input.keyboard.on('keyup', (e) => this.seen.push('up' + e.key));
        if (!scenes.second) this.scene.launch('Second');
      }
    }
    class Second extends Phaser.Scene {
      constructor() { super('Second'); }
      create() {
        scenes.second = this;
        this.keyA = this.input.keyboard.addKey('A');
        this.seen = [];
        this.input.keyboard.on('keydown', (e) => this.seen.push('dn' + e.key + (e.repeat ? '*' : '')));
        if (!scenes.passive) this.scene.launch('Passive');
      }
    }
    // The mitigation: no keyboard or gamepad plugin at all.
    class Passive extends Phaser.Scene {
      constructor() { super({ key: 'Passive', input: { keyboard: false, gamepad: false } }); }
      create() { scenes.passive = this; }
    }
    const game = new Phaser.Game({ type: Phaser.CANVAS, width: 100, height: 100, parent: 'game', audio: { noAudio: true }, scene: [Owner, Second, Passive] });
    window.__game = game;
    await new Promise((r) => { const t = setInterval(() => { if (scenes.passive) { clearInterval(t); r(); } }, 20); });
    const frame = () => new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
    const frames = async (n = 2) => { for (let i = 0; i < n; i++) await frame(); };
    await frames();
    const out = { version: Phaser.VERSION };

    // 1. one key, every keyboard scene; synchronous; a tap inside one frame
    let sync = false;
    scenes.second.input.keyboard.once('keydown-B', () => { sync = true; });
    send('keydown', 66, 'b'); out.handlerRanInsideDomEvent = sync; send('keyup', 66, 'b');
    await frames();
    scenes.owner.seen.length = 0; scenes.second.seen.length = 0;
    send('keydown', 65, 'a'); send('keyup', 65, 'a');
    out.oneEventReachesEveryKeyboardScene = scenes.owner.seen.length === 2 && scenes.second.seen.length === 1;
    out.passiveHasKeyboardPlugin = scenes.passive.input.keyboard !== undefined;
    out.subFrameTap = { downEvents: scenes.owner.downEvents, isDown: scenes.owner.keyA.isDown, justDown: Phaser.Input.Keyboard.JustDown(scenes.owner.keyA) };
    await frames();

    // 2. five events in one task (one frame)
    scenes.owner.seen.length = 0;
    const downBefore = scenes.owner.downEvents;
    send('keydown', 65, 'a'); send('keyup', 65, 'a'); send('keydown', 66, 'b'); send('keyup', 66, 'b'); send('keydown', 67, 'c');
    out.fiveEventsDeliveredAs = scenes.owner.seen.length;
    out.keyADownEventsFromOnePress = scenes.owner.downEvents - downBefore;
    out.earlierEventsReplayed = scenes.owner.seen.length > 5;
    await frames();
    send('keyup', 67, 'c');
    await frames();

    // 4. auto-repeat, stopPropagation order, sleep, pause
    scenes.owner.seen.length = 0; scenes.second.seen.length = 0;
    send('keydown', 90, 'z'); await frame(); send('keydown', 90, 'z', { repeat: true }); await frame(); send('keyup', 90, 'z');
    send('keydown', 65, 'a'); await frame(); send('keydown', 65, 'a', { repeat: true }); await frame(); send('keyup', 65, 'a'); await frame();
    out.autoRepeat = scenes.owner.seen.filter((entry) => entry.startsWith('dn'));   // z has no Key object, a has one
    const stopper = (e) => e.stopPropagation();
    scenes.owner.seen.length = 0; scenes.second.seen.length = 0;
    scenes.owner.input.keyboard.on('keydown', stopper); send('keydown', 88, 'x'); send('keyup', 88, 'x');
    const downs = (scene) => scene.seen.filter((entry) => entry.startsWith('dn')).length;
    out.stopInOwner = { owner: downs(scenes.owner), second: downs(scenes.second) };
    scenes.owner.input.keyboard.off('keydown', stopper);
    scenes.owner.seen.length = 0; scenes.second.seen.length = 0;
    scenes.second.input.keyboard.on('keydown', stopper); send('keydown', 88, 'x'); send('keyup', 88, 'x');
    out.stopInSecond = { owner: downs(scenes.owner), second: downs(scenes.second) };
    scenes.second.input.keyboard.off('keydown', stopper);
    await frames();
    scenes.owner.scene.sleep('Second'); await frames(3);
    scenes.second.seen.length = 0; send('keydown', 81, 'q'); send('keyup', 81, 'q');
    out.sleepingSceneHeard = scenes.second.seen.length;
    scenes.owner.scene.wake('Second'); await frames(3);
    send('keydown', 65, 'a'); await frames();
    scenes.owner.scene.pause('Second'); await frames(3);
    out.pauseResetsKeys = { owner: scenes.owner.keyA.isDown, second: scenes.second.keyA.isDown };
    scenes.owner.scene.resume('Second'); await frames(3);
    send('keyup', 65, 'a'); await frames();

    // 3. blur reset after restarting only the Owner
    scenes.owner.scene.restart(); await frames(3);
    send('keydown', 65, 'a');
    game.events.emit(Phaser.Core.Events.BLUR);
    out.ownerKeyReleasedOnBlur = !scenes.owner.keyA.isDown;
    out.secondKeyReleasedOnBlur = !scenes.second.keyA.isDown;
    out.survivorKeepsStuckKeyAfterOtherSceneRestart = scenes.second.keyA.isDown;
    send('keyup', 65, 'a');

    // 5. captures
    const space = send('keydown', 32, ' ');
    out.captureAfterAddKey = { a: send('keydown', 65, 'a').defaultPrevented, withShift: send('keydown', 65, 'a', { shiftKey: true }).defaultPrevented };
    send('keyup', 65, 'a');
    scenes.owner.input.keyboard.disableGlobalCapture();
    out.captureAfterDisableGlobalCapture = send('keydown', 65, 'a').defaultPrevented;
    scenes.owner.input.keyboard.enableGlobalCapture();
    send('keyup', 65, 'a');
    out.spaceNotCapturedWithoutKeyObject = space.defaultPrevented;

    // 6. the mitigation: restarting the plugin-less scene leaves the other scenes' blur listeners alone
    const before = game.events.listenerCount(Phaser.Core.Events.BLUR);
    scenes.passive.scene.restart(); await frames(3);
    out.restartingPassiveSceneKeepsBlurListeners = game.events.listenerCount(Phaser.Core.Events.BLUR) === before;
    return out;
  });

  // 5. captures versus a DOM text field (real typing through Playwright)
  await page.evaluate(() => { const field = document.createElement('input'); field.id = 'field'; field.style.cssText = 'position:absolute;left:0;top:120px;width:80px'; document.body.appendChild(field); });
  const type = async (text) => { await page.focus('#field'); await page.fill('#field', ''); await page.keyboard.type(text); return page.inputValue('#field'); };
  report.typedWhileKeyObjectsExist = await type('aXa');
  await page.evaluate(() => { window.__game.scene.stop('Owner'); window.__game.scene.stop('Second'); });
  await page.waitForTimeout(100);
  report.typedAfterOwnerScenesStopped = await type('aXa');
  await page.evaluate(() => window.__game.input.keyboard.clearCaptures());
  report.typedAfterClearCaptures = await type('aXa');

  // keyboard.target = a focusable canvas: field keystrokes do not reach Phaser
  report.canvasTarget = await page.evaluate(async () => {
    const heard = [], holder = document.createElement('div'), canvas = document.createElement('canvas');
    holder.id = 'targetHost'; document.body.appendChild(holder); canvas.tabIndex = 0;
    class Listen extends Phaser.Scene { constructor() { super('Listen'); } create() { window.__listen = this; this.input.keyboard.on('keydown', (e) => heard.push(e.key)); } }
    const game = new Phaser.Game({ type: Phaser.CANVAS, width: 50, height: 50, parent: 'targetHost', canvas, audio: { noAudio: true }, input: { keyboard: { target: canvas } }, scene: [Listen] });
    await new Promise((r) => { const t = setInterval(() => { if (window.__listen) { clearInterval(t); r(); } }, 20); });
    document.getElementById('field').dispatchEvent(new KeyboardEvent('keydown', { keyCode: 87, key: 'w', bubbles: true, cancelable: true }));
    const fromField = heard.length;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 87, key: 'w', bubbles: true, cancelable: true }));
    const result = { fromField, fromCanvas: heard.length };
    game.destroy(true);
    return result;
  });
} finally {
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
assert.equal(report.handlerRanInsideDomEvent, true, 'key handlers run inside the DOM event');
assert.equal(report.oneEventReachesEveryKeyboardScene, true, 'a DOM key event should reach each keyboard scene once');
assert.deepEqual(report.subFrameTap, { downEvents: 1, isDown: false, justDown: false }, 'a tap inside one frame emits down but leaves no polled trace');
assert.equal(report.passiveHasKeyboardPlugin, false, 'input: { keyboard: false } should leave the scene without a keyboard plugin');
assert.deepEqual(report.autoRepeat, ['dnz', 'dnz*', 'dna'], 'repeats of a code with a Key object are dropped; others arrive with repeat true');
assert.deepEqual(report.stopInOwner, { owner: 1, second: 0 });
assert.deepEqual(report.stopInSecond, { owner: 1, second: 1 });
assert.equal(report.sleepingSceneHeard, 0, 'a sleeping scene hears nothing');
assert.deepEqual(report.pauseResetsKeys, { owner: true, second: false }, 'pausing a scene resets its keys');
assert.equal(report.captureAfterAddKey.a, true);
assert.equal(report.captureAfterAddKey.withShift, false, 'modified keys are never prevented');
assert.equal(report.captureAfterDisableGlobalCapture, false);
assert.equal(report.restartingPassiveSceneKeepsBlurListeners, true, 'a plugin-less scene must not touch the blur listeners');
assert.equal(report.typedAfterClearCaptures, 'aXa', 'clearCaptures() lets the field receive the letter again');
assert.deepEqual(report.canvasTarget, { fromField: 0, fromCanvas: 1 }, 'a canvas target ignores field keystrokes');
if (report.version === '4.2.1') {
  assert.equal(report.earlierEventsReplayed, true, 'expected the 4.2.1 queue replay');
  assert.ok(report.keyADownEventsFromOnePress > 1, 'expected Key a to re-emit down during the replay');
  assert.equal(report.survivorKeepsStuckKeyAfterOtherSceneRestart, true, 'expected the 4.2.1 blur listener loss');
  assert.equal(report.typedWhileKeyObjectsExist, 'X', 'expected addKey to capture the letter globally');
  assert.equal(report.typedAfterOwnerScenesStopped, 'X', 'expected the capture to outlive the scenes');
}

// Purpose: reproduce the Phaser 4.2.1 pointer routing facts that the phaser-input skill documents, with the Canvas renderer
// (input logic only, no GPU needed):
//   - scene routing: an interactive object under the pointer in an upper scene hides the event from lower scenes, scene-level
//     listeners do not, event.stopPropagation() in an object handler also skips that scene's own pointerdown, and
//     this.input.stopPropagation() in a scene-level listener hides the DOWN (not the later UP);
//   - a DOM element above the canvas still delivers its mouse and touch events to Phaser (window listeners), so the object
//     under it is hit, until the element stops propagation of mousedown, mouseup, touchstart, touchend and touchcancel;
//   - input.activePointers defaults to 1 (a second finger is ignored); touchcancel arrives as pointerup with wasCanceled;
//   - pointer.worldX/worldY go stale when the camera moves without the pointer, and getWorldPoint reads the camera matrix from
//     the last render, so it is stale right after setZoom or a scroll in the same tick;
//   - camera.preRender() refreshes that matrix at once; after a layout shift the pointer is wrong until the 500 ms scale poll
//     (or scale.updateBounds());
//   - a BitmapText hit area keeps the size it had at setInteractive(); a Text hit area follows the text;
//   - a Container hit area is centred on the container once it has a size; hover needs a pointer move unless setPollAlways();
//   - the canvas cancels wheel scrolling by default, and a destroyed game's wheel listener survives on the pooled canvas
//     that the next game reuses (MouseManager#stopListeners never removes it), even if that game opts out.
//
// Run:    node phaser-input-pointer.mjs /absolute/path/to/project-with-phaser-and-playwright
//         (the project needs `phaser` and one of `playwright-core`, `playwright` or `@playwright/test`; any Chromium works).
// Expect: exit code 0 and a JSON object. The asserts at the end pin the 4.2.1 behaviour; when a later Phaser changes one,
//         the failing assert names it and the matching sentence in the skill needs a new version stamp.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const pw = ['@playwright/test', 'playwright', 'playwright-core'].map((name) => { try { return require(name); } catch { return null; } }).find(Boolean);
assert.ok(pw, 'install @playwright/test, playwright or playwright-core in the project');
const browser = await pw.chromium.launch({ channel: process.env.CHROME_CHANNEL || undefined, timeout: 20000 });
const out = {};

// A world scene (full-canvas object, a bitmap label, a text label, a sized container) under a UI scene (object on the left).
async function boot(hasTouch) {
  const context = await browser.newContext({ viewport: { width: 320, height: 240 }, hasTouch });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.setContent('<!doctype html><body style="margin:0"><div id="game"></div></body>');
  await page.addScriptTag({ path: require.resolve('phaser') });
  await page.evaluate(async () => {
    window.log = [];
    const S = (window.S = {});
    class World extends Phaser.Scene {
      constructor() { super('World'); }
      create() {
        S.world = this;
        this.add.rectangle(80, 60, 160, 120, 0x224466).setInteractive().on('pointerdown', () => window.log.push('world-object'));
        this.input.on('pointerdown', () => window.log.push('world-scene'));
        this.input.on('pointerup', (p) => window.log.push('world-up canceled=' + p.wasCanceled));
        const f = this.textures.createCanvas('f', 12, 5);
        const c = f.getContext(); c.fillStyle = '#fff'; c.fillRect(0, 0, 12, 5); f.refresh();
        this.cache.bitmapFont.add('rf', Phaser.GameObjects.RetroFont.Parse(this, { image: 'f', width: 3, height: 5, chars: 'AB C', charsPerRow: 4 }));
        S.bitmap = this.add.bitmapText(200, 10, 'rf', 'AB', 3).setInteractive();
        S.text = this.add.text(200, 50, 'AB', { fontSize: '8px' }).setInteractive();
        S.box = this.add.container(260, 150).setSize(40, 20).setInteractive();
        this.scene.launch('Ui');
      }
    }
    class Ui extends Phaser.Scene {
      constructor() { super('Ui'); }
      create() {
        S.ui = this;
        this.add.rectangle(40, 60, 80, 120, 0x884422).setInteractive().on('pointerdown', (pointer, x, y, event) => { window.log.push('ui-object'); if (window.objectStops) event.stopPropagation(); });
        this.input.on('pointerdown', () => { window.log.push('ui-scene'); if (window.uiStops) this.input.stopPropagation(); });
      }
    }
    window.game = new Phaser.Game({ type: Phaser.CANVAS, width: 320, height: 240, parent: 'game', audio: { noAudio: true }, scene: [World, Ui] });
    await new Promise((r) => { const t = setInterval(() => { if (S.ui) { clearInterval(t); r(); } }, 20); });
  });
  const frames = (n = 2) => page.evaluate(async (count) => { for (let i = 0; i < count; i++) await new Promise((r) => window.game.events.once(Phaser.Core.Events.POST_RENDER, r)); }, n);
  const take = async () => { await page.waitForTimeout(80); return page.evaluate(() => window.log.splice(0)); };
  await frames();
  return { context, page, frames, take };
}
const overlay = (page) => page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'overlay';
  d.style.cssText = 'position:absolute;left:100px;top:0;width:60px;height:60px;background:#0a0';
  document.body.appendChild(d);
});
const stopAtOverlay = (page) => page.evaluate(() => {
  for (const type of ['mousedown', 'mouseup', 'touchstart', 'touchend', 'touchcancel']) document.getElementById('overlay').addEventListener(type, (e) => e.stopPropagation());
});

try {
  // Mouse context
  {
    const { page, frames, take } = await boot(false);
    out.version = await page.evaluate(() => Phaser.VERSION);
    // First, before any hover over an upper-scene object: a hover-out that Phaser sees only at the next press would swallow it.
    await overlay(page);
    await page.mouse.click(130, 30); out.mouseOnDomOverlay = await take();
    await stopAtOverlay(page);
    await page.mouse.click(130, 30); out.mouseOnDomOverlayWithStopPropagation = await take();
    await page.evaluate(() => document.getElementById('overlay').remove());

    await page.mouse.click(40, 60); out.clickUiObject = await take();
    await page.mouse.click(120, 60); out.clickWhereUiHasNoObject = await take();
    await page.evaluate(() => { window.objectStops = true; });
    await page.mouse.click(40, 60); out.eventStopPropagationInObject = await take();
    await page.evaluate(() => { window.objectStops = false; window.uiStops = true; });
    await page.mouse.click(120, 60); out.sceneListenerStopsDownNotUp = await take();
    await page.evaluate(() => { window.uiStops = false; window.game.input.globalTopOnly = false; });
    await page.mouse.click(40, 60); out.clickUiObjectWithGlobalTopOnlyFalse = await take();
    await page.evaluate(() => { window.game.input.globalTopOnly = true; });

    await page.mouse.move(100, 80); await frames();
    out.worldPoint = await page.evaluate(async () => {
      const cam = window.S.world.cameras.main, p = window.S.world.input.activePointer, r = {};
      const frame = () => new Promise((res) => window.game.events.once(Phaser.Core.Events.POST_RENDER, res));
      cam.scrollX = 40; await frame(); await frame();
      r.pointerWorldXAfterScrollWithoutMove = p.worldX;
      p.updateWorldPoint(cam); r.afterUpdateWorldPoint = p.worldX;
      cam.scrollX = 0; await frame();
      cam.setZoom(2); r.getWorldPointRightAfterSetZoom = cam.getWorldPoint(100, 80).x;
      cam.preRender(); r.getWorldPointAfterPreRender = cam.getWorldPoint(100, 80).x;
      await frame(); r.getWorldPointAfterFrame = cam.getWorldPoint(100, 80).x;   // zoom 2 about the centre (160): 160 + (100 - 160) / 2
      cam.setZoom(1); await frame();
      return r;
    });

    out.hitAreas = await page.evaluate(() => {
      const { bitmap, text, box, world } = window.S;
      const r = { bitmapAtCreate: [bitmap.input.hitArea.width, bitmap.input.hitArea.height] };
      bitmap.setText('ABABABAB'); text.setText('ABABABABABAB');
      r.bitmapAfterSetText = [bitmap.input.hitArea.width, bitmap.width];
      r.textAfterSetText = [text.input.hitArea.width, text.width];
      const manager = world.input.manager;
      r.containerDisplayOrigin = [box.displayOriginX, box.displayOriginY];
      r.containerCentreHit = manager.pointWithinHitArea(box, 0, 0);
      r.containerFarCornerHit = manager.pointWithinHitArea(box, 19, 9);
      r.containerBeyondCornerHit = manager.pointWithinHitArea(box, 21, 11);
      return r;
    });

    await page.mouse.move(260, 200);
    out.hover = await page.evaluate(async () => {
      const over = [], r = {}, world = window.S.world;
      const frame = () => new Promise((res) => window.game.events.once(Phaser.Core.Events.POST_RENDER, res));
      world.add.rectangle(260, 200, 30, 30, 0xff0000).setInteractive().on('pointerover', () => over.push('over'));
      await frame(); await frame(); await frame();
      r.pollRate = world.input.pollRate; r.overWithoutMove = over.length;
      world.input.setPollAlways(); await frame(); await frame(); await frame();
      r.overAfterSetPollAlways = over.length;
      world.input.setPollOnMove();
      return r;
    });
    // Layout shift: a 20 px header appears above the canvas; the parent keeps its size, so only the poll notices.
    await page.evaluate(() => {
      window.S.world.input.on('pointerdown', (pointer) => { window.lastDown = [pointer.x, pointer.y]; });
      const header = document.createElement('div'); header.id = 'header'; header.style.height = '20px';
      document.body.insertBefore(header, document.getElementById('game'));
    });
    await page.mouse.click(300, 100);                 // canvas-local y is 80
    out.layoutShift = { immediately: await page.evaluate(() => window.lastDown) };
    await page.waitForTimeout(800);
    await page.mouse.click(300, 100);
    out.layoutShift.afterPoll = await page.evaluate(() => window.lastDown);
    await page.mouse.click(300, 101);
    await page.evaluate(() => { document.getElementById('header').style.height = '40px'; window.game.scale.updateBounds(); });
    await page.mouse.click(300, 100);                 // canvas-local y is 60 once updateBounds ran
    out.layoutShift.afterUpdateBounds = await page.evaluate(() => window.lastDown);

    out.wheel = await page.evaluate(async () => {
      const make = async (mouse) => {
        const scenes = {};
        class Idle extends Phaser.Scene { constructor() { super('Idle'); } create() { scenes.idle = this; } }
        const host = document.createElement('div'); host.id = 'host' + Math.random().toString(36).slice(2); document.body.appendChild(host);
        const game = new Phaser.Game({ type: Phaser.CANVAS, width: 100, height: 100, parent: host.id, audio: { noAudio: true }, input: { mouse }, scene: [Idle] });
        await new Promise((r) => { const t = setInterval(() => { if (scenes.idle) { clearInterval(t); r(); } }, 20); });
        return game;
      };
      const wheel = (game) => { const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }); game.canvas.dispatchEvent(event); return event.defaultPrevented; };
      const first = await make({});
      const canvas = first.canvas, result = { defaultPrevented: wheel(first) };
      first.destroy(true);
      await new Promise((r) => setTimeout(r, 400));
      const second = await make({ preventDefaultWheel: false });
      result.canvasReused = second.canvas === canvas;
      result.optOutStillPrevented = wheel(second);
      return result;
    });
    await page.context().close();
  }

  // Touch context
  {
    const { context, page, take } = await boot(true);
    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push(message.text()));
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    await overlay(page);
    await touch('touchStart', [{ x: 130, y: 30, id: 1 }]); await touch('touchEnd', []); out.touchOnDomOverlay = await take();
    await stopAtOverlay(page);
    await touch('touchStart', [{ x: 130, y: 30, id: 1 }]); await touch('touchEnd', []); out.touchOnDomOverlayWithStopPropagation = await take();
    await page.evaluate(() => document.getElementById('overlay').remove());

    await touch('touchStart', [{ x: 120, y: 30, id: 1 }, { x: 140, y: 80, id: 2 }]); await touch('touchEnd', []);
    out.twoFingersDefault = await take();
    out.pointersTotal = await page.evaluate(() => window.game.input.pointersTotal);
    await touch('touchStart', [{ x: 120, y: 30, id: 1 }]); await touch('touchCancel', []);
    out.touchCancel = await take();
    out.touchCancelConsole = consoleMessages.filter((text) => /touchcancel/i.test(text)).length;
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));

assert.deepEqual(out.clickUiObject, ['ui-object', 'ui-scene'], 'UI object hit: only the UI scene hears it');
assert.deepEqual(out.clickWhereUiHasNoObject, ['ui-scene', 'world-object', 'world-scene', 'world-up canceled=false'], 'no UI object: the world hears it too');
assert.deepEqual(out.eventStopPropagationInObject, ['ui-object'], 'event.stopPropagation() in an object handler also skips the scene-level pointerdown too');
assert.deepEqual(out.sceneListenerStopsDownNotUp, ['ui-scene', 'world-up canceled=false'], 'input.stopPropagation() hides the down, the up still arrives');
assert.ok(out.clickUiObjectWithGlobalTopOnlyFalse.includes('world-object'), 'globalTopOnly=false lets lower scenes hear it');
assert.ok(out.mouseOnDomOverlay.includes('world-object'), 'a DOM element above the canvas still reaches Phaser (mouse)');
assert.deepEqual(out.mouseOnDomOverlayWithStopPropagation, [], 'stopPropagation on the element keeps the mouse events from Phaser');
assert.ok(out.touchOnDomOverlay.includes('world-object'), 'a DOM element above the canvas still reaches Phaser (touch)');
assert.deepEqual(out.touchOnDomOverlayWithStopPropagation, [], 'stopPropagation on the element keeps the touch events from Phaser');
assert.equal(out.pointersTotal, 1, 'input.activePointers defaults to 1');
assert.equal(out.twoFingersDefault.filter((entry) => entry === 'world-object').length, 1, 'the second finger is ignored');
assert.ok(out.touchCancel.includes('world-up canceled=true'), 'touchcancel reaches pointerup with wasCanceled');
assert.equal(out.worldPoint.pointerWorldXAfterScrollWithoutMove, 100, 'pointer.worldX is stale after a camera scroll');
assert.equal(out.worldPoint.afterUpdateWorldPoint, 140, 'updateWorldPoint refreshes it');
assert.equal(out.worldPoint.getWorldPointRightAfterSetZoom, 100, 'getWorldPoint reads the matrix from the last render');
assert.equal(out.worldPoint.getWorldPointAfterFrame, 130, 'getWorldPoint is right one frame later');
assert.equal(out.worldPoint.getWorldPointAfterPreRender, 130, 'camera.preRender() refreshes the matrix at once');
assert.equal(out.layoutShift.immediately[1], 100, 'right after a layout shift the pointer still uses the old canvas position');
assert.equal(out.layoutShift.afterPoll[1], 80, 'the scale poll corrects it');
assert.equal(out.layoutShift.afterUpdateBounds[1], 60, 'scale.updateBounds() corrects it at once');
assert.deepEqual(out.hitAreas.bitmapAfterSetText, [out.hitAreas.bitmapAtCreate[0], 24], 'BitmapText hit area keeps its creation size');
assert.equal(out.hitAreas.textAfterSetText[0], out.hitAreas.textAfterSetText[1], 'Text hit area follows the text');
assert.deepEqual(out.hitAreas.containerDisplayOrigin, [20, 10]);
assert.equal(out.hitAreas.containerCentreHit && out.hitAreas.containerFarCornerHit && !out.hitAreas.containerBeyondCornerHit, true);
assert.equal(out.hover.overWithoutMove, 0, 'hover needs a pointer move with the default pollRate -1');
assert.equal(out.hover.overAfterSetPollAlways, 1, 'setPollAlways() delivers it');
assert.equal(out.wheel.defaultPrevented, true, 'the canvas cancels wheel scrolling by default');
assert.deepEqual([out.wheel.canvasReused, out.wheel.optOutStillPrevented], [true, true], 'a destroyed game leaves its wheel listener on the pooled canvas');

// Purpose: check the Phaser 4.2.1 panel and DOM facts that the phaser-pixel-ui skill documents:
//   - a NineSlice with tileX repeats floor(scalable / source) tiles and stretches them to fill, so a panel is pixel-exact only
//     when (width - left - right) is a whole multiple of the source centre (WebGL, NEAREST, pixels read back from the canvas);
//   - with NEAREST sampling a fractional NineSlice position only shifts the whole panel to the nearest pixel (0.4 and 0.6 differ);
//   - a Graphics rounded rectangle has soft edge pixels with the default context (antialiasGL) and none with pixelArt: true;
//   - Align.In.Center puts an odd-width object on a half pixel inside an even box;
//   - dom: { createContainer: true } without a parent leaves no container and DOMElement throws;
//   - inside the DOM container CSS lengths are game pixels: with scale zoom 0.5 a 60 px wide element is 30 CSS px wide;
//   - stopping a scene removes its DOMElement nodes and restarting creates them again;
//   - a click on the canvas does not blur a focused DOM input (mousedown default is prevented) until
//     input.mouse.preventDefaultDown is false.
//
// Run:    node phaser-pixel-ui-panels.mjs /absolute/path/to/project-with-phaser-and-playwright
//         (the project needs `phaser` and one of `playwright-core`, `playwright` or `@playwright/test`; any Chromium works;
//         WebGL runs on the software renderer by default, set CHROME_CHANNEL=chrome for a real GPU).
// Expect: exit code 0 and a JSON object; the asserts pin the 4.2.1 behaviour.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const pw = ['@playwright/test', 'playwright', 'playwright-core'].map((name) => { try { return require(name); } catch { return null; } }).find(Boolean);
assert.ok(pw, 'install @playwright/test, playwright or playwright-core in the project');
const browser = await pw.chromium.launch({
  channel: process.env.CHROME_CHANNEL || undefined, timeout: 20000,
  args: process.env.CHROME_CHANNEL ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const out = {};
try {
  const page = await (await browser.newContext({ viewport: { width: 320, height: 240 } })).newPage();
  page.setDefaultTimeout(15000);
  await page.setContent('<!doctype html><body style="margin:0"><div id="game"></div><div id="zoomed"></div></body>');
  await page.addScriptTag({ path: require.resolve('phaser') });

  out.panel = await page.evaluate(async () => {
    const scenes = {};
    class Main extends Phaser.Scene {
      constructor() { super('Main'); }
      create() {
        scenes.main = this;
        // 8x8 frame, 2 px borders, centre columns R G B W so a stretched tile shows as a repeated colour.
        const t = this.textures.createCanvas('panel', 8, 8), c = t.getContext();
        c.fillStyle = '#000'; c.fillRect(0, 0, 8, 8);
        ['#f00', '#0f0', '#00f', '#fff'].forEach((color, i) => { c.fillStyle = color; c.fillRect(2 + i, 2, 1, 4); });
        t.refresh();
        this.add.nineslice(0, 0, 'panel', null, 24, 8, 2, 2, 2, 2, true, false).setOrigin(0, 0);
        this.add.nineslice(0, 16, 'panel', null, 22, 8, 2, 2, 2, 2, true, false).setOrigin(0, 0);
        window.fractional = this.add.nineslice(0.4, 40, 'panel', null, 24, 8, 2, 2, 2, 2, true, false).setOrigin(0, 0);
        const box = this.add.rectangle(0, 0, 20, 20).setOrigin(0, 0);
        const label = this.add.rectangle(0, 0, 3, 3).setOrigin(0, 0);
        Phaser.Display.Align.In.Center(label, box);
        window.centredX = label.x;
      }
    }
    const game = new Phaser.Game({ type: Phaser.WEBGL, width: 64, height: 64, parent: 'game', audio: { noAudio: true }, pixelArt: true, render: { preserveDrawingBuffer: true }, scene: [Main] });
    await new Promise((r) => { const t = setInterval(() => { if (scenes.main) { clearInterval(t); r(); } }, 20); });
    for (let i = 0; i < 2; i++) await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
    const copy = document.createElement('canvas'); copy.width = 64; copy.height = 64;
    const c2d = copy.getContext('2d'); c2d.drawImage(game.canvas, 0, 0);
    const data = c2d.getImageData(0, 0, 64, 64).data;
    const names = { '255,0,0': 'R', '0,255,0': 'G', '0,0,255': 'B', '255,255,255': 'W', '0,0,0': 'k' };
    const row = (y, n) => { let s = ''; for (let i = 0; i < n; i++) { const o = (y * 64 + i) * 4; s += names[`${data[o]},${data[o + 1]},${data[o + 2]}`] || '?'; } return s; };
    const tiles = scenes.main.children.list.filter((o) => o.type === 'NineSlice');
    const snapshot = (y) => { game.renderer.type; const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d'); x.drawImage(game.canvas, 0, 0); const px = x.getImageData(0, 0, 64, 64).data; let line = ''; for (let i = 0; i < 26; i++) { const o = (y * 64 + i) * 4; line += names[`${px[o]},${px[o + 1]},${px[o + 2]}`] || '?'; } return line; };
    const fractionalAt04 = row(44, 26);
    window.fractional.x = 0.6;
    for (let i = 0; i < 2; i++) await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
    const fractionalAt06 = snapshot(44);
    const result = { fractionalAt04, fractionalAt06, renderer: game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas', width24: row(4, 24), width22: row(20, 22), repeat: tiles.map((n) => [n.width, n._repeatCountX]), alignInCenterX: window.centredX };
    game.destroy(true);
    return result;
  });

  out.graphics = await page.evaluate(async () => {
    const measure = async (renderConfig, label) => {
      const scenes = {};
      class Draw extends Phaser.Scene {
        constructor() { super('Draw' + label); }
        create() { scenes.draw = this; this.add.graphics().fillStyle(0xffffff, 1).fillRoundedRect(4, 4, 24, 16, 5); }
      }
      const host = document.createElement('div'); host.id = 'graphics' + label; document.body.appendChild(host);
      const game = new Phaser.Game({ type: Phaser.WEBGL, width: 40, height: 30, parent: host.id, audio: { noAudio: true }, render: { preserveDrawingBuffer: true, ...renderConfig }, scene: [Draw] });
      await new Promise((r) => { const t = setInterval(() => { if (scenes.draw) { clearInterval(t); r(); } }, 20); });
      for (let i = 0; i < 3; i++) await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
      const copy = document.createElement('canvas'); copy.width = 40; copy.height = 30;
      const context = copy.getContext('2d'); context.drawImage(game.canvas, 0, 0);
      const data = context.getImageData(0, 0, 40, 30).data, levels = new Set();
      for (let i = 0; i < data.length; i += 4) if (data[i] > 0 && data[i] < 255) levels.add(data[i]);
      game.destroy(true);
      return levels.size;
    };
    return { defaultContextSoftLevels: await measure({}, 'A'), pixelArtSoftLevels: await measure({ pixelArt: true, antialias: false, antialiasGL: false }, 'B') };
  });

  out.dom = await page.evaluate(async () => {
    const result = {};
    // 1. no parent: no container, DOMElement throws.
    let error = null;
    class NoParent extends Phaser.Scene {
      constructor() { super('NoParent'); }
      create() { try { this.add.dom(0, 0, 'button', '', 'x'); } catch (e) { error = e.message; } }
    }
    const bare = new Phaser.Game({ type: Phaser.CANVAS, width: 50, height: 50, audio: { noAudio: true }, dom: { createContainer: true }, scene: [NoParent] });
    await new Promise((r) => setTimeout(r, 300));
    result.noParent = { container: bare.domContainer, error };
    bare.destroy(true);

    // 2. zoom 0.5 (the device-pixel policy at devicePixelRatio 2): CSS lengths inside the container are game pixels.
    const holder = document.createElement('div'); holder.id = 'zoomedHost'; document.body.appendChild(holder);
    class Zoomed extends Phaser.Scene {
      constructor() { super('Zoomed'); }
      create() {
        const button = document.createElement('button'); button.style.cssText = 'width:60px;height:40px';
        window.zoomedButton = button;
        this.add.dom(20, 10, button).setOrigin(0, 0);
      }
    }
    const zoomed = new Phaser.Game({ type: Phaser.CANVAS, width: 320, height: 240, parent: 'zoomedHost', audio: { noAudio: true }, dom: { createContainer: true }, scale: { mode: Phaser.Scale.NONE, zoom: 0.5 }, scene: [Zoomed] });
    await new Promise((r) => setTimeout(r, 400));
    const box = window.zoomedButton.getBoundingClientRect(), canvas = zoomed.canvas.getBoundingClientRect();
    result.zoomHalf = { cssRect: [box.x - canvas.x, box.y - canvas.y, box.width, box.height], containerTransform: zoomed.domContainer.style.transform, containerPointerEvents: getComputedStyle(zoomed.domContainer).pointerEvents };
    const before = zoomed.domContainer.children.length;
    zoomed.scene.stop('Zoomed'); await new Promise((r) => setTimeout(r, 200));
    const afterStop = zoomed.domContainer.children.length;
    zoomed.scene.start('Zoomed'); await new Promise((r) => setTimeout(r, 300));
    result.lifecycle = [before, afterStop, zoomed.domContainer.children.length];
    zoomed.destroy(true);
    return result;
  });

  // Focus and wheel defaults: a click on the canvas versus a focused DOM field.
  out.focus = {};
  for (const [label, mouse] of [['default', {}], ['optOut', { preventDefaultDown: false }]]) {
    await page.evaluate(async (mouse) => {
      const scenes = {};
      class Idle extends Phaser.Scene { constructor() { super('Idle'); } create() { scenes.idle = this; } }
      const host = document.createElement('div'); host.id = 'focusHost'; document.body.appendChild(host);
      const field = document.createElement('input'); field.id = 'field'; field.style.cssText = 'position:absolute;left:0;top:110px;width:80px'; document.body.appendChild(field);
      window.focusGame = new Phaser.Game({ type: Phaser.CANVAS, width: 100, height: 100, parent: 'focusHost', audio: { noAudio: true }, input: { mouse }, scene: [Idle] });
      await new Promise((r) => { const t = setInterval(() => { if (scenes.idle) { clearInterval(t); r(); } }, 20); });
    }, mouse);
    await page.focus('#field');
    const rect = await page.evaluate(() => { const r = window.focusGame.canvas.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(rect.x, rect.y);
    out.focus[label] = await page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
    await page.evaluate(() => { window.focusGame.destroy(true); document.getElementById('field').remove(); document.getElementById('focusHost').remove(); });
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
assert.equal(out.panel.width24, 'kkRGBWRGBWRGBWRGBWRGBWkk', 'a width of left + right + 5 tiles repeats the centre exactly');
assert.notEqual(out.panel.width22, 'kkRGBWRGBWRGBWRGBWkk', 'a width that is not a multiple stretches some texels');
assert.ok(out.panel.width22.includes('RR'), 'a 4.5 px tile doubles a texel');
assert.deepEqual(out.panel.repeat, [[24, 5], [22, 4], [24, 5]]);
assert.equal(out.panel.alignInCenterX, 8.5);
assert.equal(out.panel.fractionalAt04, 'kkRGBWRGBWRGBWRGBWRGBWkkkk', 'x 0.4 draws on the pixel grid starting at 0');
assert.equal(out.panel.fractionalAt06, 'kkkRGBWRGBWRGBWRGBWRGBWkkk', 'x 0.6 shifts the whole panel by one pixel');
assert.equal(out.graphics.pixelArtSoftLevels, 0, 'Graphics edges are hard when the context is created without antialiasing');
assert.equal(out.dom.noParent.container, null);
assert.equal(out.dom.noParent.error, 'No DOM Container set in game config');
assert.deepEqual(out.dom.zoomHalf.cssRect, [10, 5, 30, 20], 'CSS lengths in the container are game pixels');
assert.equal(out.dom.zoomHalf.containerPointerEvents, 'none');
assert.deepEqual(out.dom.lifecycle, [1, 0, 1], 'stop removes the node, start creates it again');
assert.equal(out.focus.default, 'field', 'by default a canvas click keeps focus in the field');
assert.equal(out.focus.optOut, 'BODY', 'preventDefaultDown: false lets the click blur the field');

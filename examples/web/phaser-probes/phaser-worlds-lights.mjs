// Purpose: reproduce the dynamic-light claims in skills/phaser-worlds/references/dynamic-lights.md on Phaser 4.2.1.
// Run:     node phaser-worlds-lights.mjs /absolute/path/to/host-project   (host has phaser 4.2.1 and playwright-core or @playwright/test)
// Expect:  JSON with every check ok and exit code 0. A failing "maxLights keeps creation order" check means Phaser fixed the
//          nearest-lights sort; update the reference when that happens.
// Covers:  lit objects are black until scene.lights.enable(), default ambient, cone angles (full widths) and rotation convention,
//          radius independent of camera zoom, CPU and GPU tilemap layers are lit, maxLights ordering, Light#setVisible as the cull switch.
import { startProbe } from './phaser-worlds-lib.mjs';

const p = await startProbe(process.argv[2], {
  game: { pixelArt: true },
  setup: `
    const big = scene.textures.createCanvas('big', 64, 64); big.context.fillStyle = '#fff'; big.context.fillRect(0, 0, 64, 64); big.refresh();
    const tiles = scene.textures.createCanvas('tiles', 16, 16); tiles.context.fillStyle = '#fff'; tiles.context.fillRect(0, 0, 16, 16); tiles.refresh();
  `,
});
const grey = (px) => px[0]; // white surfaces: r = g = b

// 1. enabling.
await p.page.evaluate(() => { window.spr = scene.add.image(100, 100, 'big').setLighting(true); });
await p.frames(2);
const noEnable = await p.pixel(100, 100);
await p.page.evaluate(() => { scene.lights.enable(); });
await p.frames(2);
const enabled = await p.pixel(100, 100);
p.check('a lit object is black until scene.lights.enable()', grey(noEnable) === 0, noEnable);
p.check('after enable() with no lights the default ambient (0.1) shows: about 26', Math.abs(grey(enabled) - 26) <= 2, enabled);

// 2. point light and zoom independence.
await p.page.evaluate(() => { window.pl = scene.lights.addLight(100, 100, 100, 0xffffff, 1); });
await p.frames(2);
const centre = await p.pixel(100, 100);
const d28 = await p.pixel(128, 100);
p.check('a point light is full strength at its centre', grey(centre) >= 250, centre);
await p.page.evaluate(() => { scene.cameras.main.setZoom(3).centerOn(100, 100); });
await p.frames(3);
const d28z3 = await p.pixel(200 + 84, 150); // 28 world px = 84 screen px at zoom 3
p.check('light radius is in world units: 28 px away looks the same at zoom 1 and zoom 3', Math.abs(grey(d28) - grey(d28z3)) <= 4, { d28: grey(d28), d28z3: grey(d28z3) });
await p.page.evaluate(() => { scene.cameras.main.setZoom(1).setScroll(0, 0); scene.lights.removeLight(pl); });

// 3. cone: angles are full widths, rotation 0 points right, PI/2 points down.
await p.page.evaluate(() => {
  spr.setPosition(200, 150).setScale(4);   // covers 72..328 x 22..278
  window.cone = scene.lights.addConeLight(100, 100, 200, 0xffffff, 1, 0, Phaser.Math.DegToRad(30), Phaser.Math.DegToRad(60));
});
await p.frames(2);
const tan = Math.tan;
const ahead = await p.pixel(160, 100);
const half30 = await p.pixel(160, 100 + Math.round(60 * tan(Math.PI / 12)));  // 15 degrees off axis: half the inner width
const half60 = await p.pixel(160, 100 + Math.round(60 * tan(Math.PI / 6)));   // 30 degrees off axis: half the outer width
p.check('inside the inner cone is lit', grey(ahead) > 60 && grey(half30) > 60, { ahead, half30 });
p.check('at half the outer angle the light has faded to ambient', Math.abs(grey(half60) - 26) <= 3, half60);
await p.page.evaluate(() => { cone.setConeRotation(Math.PI / 2); });
await p.frames(2);
const right = await p.pixel(160, 100);
const below = await p.pixel(100, 160);
p.check('rotation PI/2 points down the screen (+y), so the right side is unlit', grey(below) > 60 && Math.abs(grey(right) - 26) <= 3, { right, below });
await p.page.evaluate(() => { cone.disableCone(); });
await p.frames(2);
const omni = await p.pixel(160, 100);
p.check('disableCone() returns to a full radius light', grey(omni) > 60 && grey(await p.pixel(100, 160)) > 60, omni);
await p.page.evaluate(() => { scene.lights.removeLight(cone); spr.destroy(); });

// 4. maxLights: 12 lights, 10 allowed. The nearest are not the ones kept.
const max = await p.page.evaluate(() => {
  const made = [];
  for (let i = 0; i < 12; i++) made.push(scene.lights.addLight(i < 6 ? 350 : 205 + i, 150, 10)); // ids 0-5 far from the view centre, 6-11 near it
  const ids = (list) => list.map((e) => made.indexOf(e.light));
  const kept = ids(scene.lights.getLights(scene.cameras.main));
  for (let i = 0; i < 6; i++) made[i].setVisible(false);
  const afterHiding = ids(scene.lights.getLights(scene.cameras.main));
  made.forEach((l) => scene.lights.removeLight(l));
  return { maxLights: scene.lights.maxLights, kept, afterHiding };
});
p.check('default maxLights is 10', max.maxLights === 10, max);
p.check('over the limit the first 10 created are kept, not the 10 nearest (current behaviour)', JSON.stringify(max.kept) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), max.kept);
p.check('Light#setVisible(false) takes a light out before the cap is applied', JSON.stringify(max.afterHiding) === JSON.stringify([6, 7, 8, 9, 10, 11]), max.afterHiding);

// 5. tilemap layers are lit, CPU and GPU.
const layers = {};
for (const gpu of [false, true]) {
  await p.page.evaluate((gpu) => {
    scene.lights.setAmbientColor(0x000000);
    const data = []; for (let y = 0; y < 40; y++) data.push(new Array(40).fill(0));
    const map = scene.make.tilemap({ data, tileWidth: 16, tileHeight: 16 });
    const set = map.addTilesetImage('tiles', 'tiles', 16, 16, 0, 0);
    window.layer = map.createLayer(0, set, 0, 0, gpu);
    layer.setLighting(true);
    window.tl = scene.lights.addLight(100, 100, 100, 0xffffff, 1);
  }, gpu);
  await p.frames(2);
  layers[gpu ? 'gpu' : 'cpu'] = { centre: await p.pixel(100, 100), far: await p.pixel(250, 100) };
  await p.page.evaluate(() => { layer.destroy(); scene.lights.removeLight(tl); });
}
p.check('CPU tilemap layer is lit by a point light', grey(layers.cpu.centre) >= 250 && grey(layers.cpu.far) === 0, layers.cpu);
p.check('GPU tilemap layer is lit by a point light', grey(layers.gpu.centre) >= 250 && grey(layers.gpu.far) === 0, layers.gpu);

await p.finish();

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

// 8. Self-shadow: it darkens dark texels that do not face the light and leaves bright ones alone, and one settings object is shared by every object.
const ss = await p.page.evaluate(async () => {
  const frames = () => new Promise((res) => { let k = 0; const f = () => { if (++k >= 3) res(); else game.events.once('postrender', f); }; game.events.once('postrender', f); });
  const pix = (x, y) => new Promise((res) => game.renderer.snapshotPixel(x, y, (c) => res(c.r)));
  const stripes = scene.textures.createCanvas('stripes', 64, 64);
  for (let i = 0; i < 64; i += 8) { stripes.context.fillStyle = ((i / 8) % 2 === 0) ? 'rgb(255,255,255)' : 'rgb(25,25,25)'; stripes.context.fillRect(i, 0, 8, 64); }
  stripes.refresh();
  const img = scene.add.image(100, 100, 'stripes').setLighting(true);
  const white = 72, dark = 80;                                      // centres of the first white and the first dark stripe
  const light = scene.lights.addLight(100, 100, 600, 0xffffff, 1, 200);
  const read = async () => { await frames(); return { white: await pix(white, 100), dark: await pix(dark, 100) }; };
  const out = { defaults: { enabled: img.selfShadow.enabled, penumbra: img.selfShadow.penumbra, diffuseFlatThreshold: +img.selfShadow.diffuseFlatThreshold.toFixed(3), game: game.config.selfShadow } };
  img.setSelfShadow(false); out.off = await read();
  img.setSelfShadow(true, 0.5, 1 / 3); out.on = await read();
  img.setSelfShadow(true, 0.5, 1); out.wideThreshold = await read();
  img.setSelfShadow(true, 0.05, 1 / 3); out.sharpPenumbra = await read();
  // The settings object is shared: setSelfShadow on one object changes every object, including ones made later.
  const other = scene.add.image(300, 100, 'stripes').setLighting(true);
  img.setSelfShadow(true, 0.9, 0.2);
  out.shared = { sameObject: img.selfShadow === other.selfShadow, otherSeesIt: { enabled: other.selfShadow.enabled, penumbra: other.selfShadow.penumbra }, newObject: scene.add.image(300, 200, 'stripes').selfShadow.enabled };
  // A per-object copy isolates it.
  other.selfShadow = { enabled: false, penumbra: 0.5, diffuseFlatThreshold: 1 / 3 };
  img.setSelfShadow(true, 0.5, 1 / 3);
  other.setSelfShadow(false);
  out.isolated = { img: img.selfShadow.enabled, other: other.selfShadow.enabled };
  // Draw calls: two lit images with the same shader variant batch together; one with self-shadow and one without do not.
  const drawCalls = async () => {
    const r = game.renderer, de = r.drawElements, di = r.drawInstancedArrays; let n = 0;
    r.drawElements = function () { n++; return de.apply(this, arguments); }; r.drawInstancedArrays = function () { n++; return di.apply(this, arguments); };
    await frames(); n = 0; await new Promise((res) => game.events.once('postrender', res)); r.drawElements = de; r.drawInstancedArrays = di; return n;
  };
  const b = scene.add.image(200, 100, 'stripes').setLighting(true);
  const set = (a, c) => { img.selfShadow = { enabled: a, penumbra: 0.5, diffuseFlatThreshold: 1 / 3 }; b.selfShadow = { enabled: c, penumbra: 0.5, diffuseFlatThreshold: 1 / 3 }; };
  img.setPosition(100, 100); other.setVisible(false);
  scene.children.list.filter((o) => o !== img && o !== b).forEach((o) => o.setVisible(false));
  set(false, false); out.draws = { bothOff: await drawCalls() };
  set(true, true); out.draws.bothOn = await drawCalls();
  set(true, false); out.draws.mixed = await drawCalls();
  scene.lights.removeLight(light);
  scene.children.list.slice().forEach((o) => o.destroy());
  return out;
});
p.check('self-shadow is off by default (game config false, object enabled null, penumbra 0.5, flat threshold 1/3)', ss.defaults.enabled === null && ss.defaults.game === false && ss.defaults.penumbra === 0.5 && ss.defaults.diffuseFlatThreshold === 0.333, ss.defaults);
p.check('self-shadow leaves bright texels alone and darkens dark ones; a flat threshold of 1 darkens them more; a sharp penumbra changes nothing under a high light', ss.off.white === ss.on.white && ss.on.dark < ss.off.dark && ss.wideThreshold.dark < ss.on.dark && ss.sharpPenumbra.dark === ss.off.dark, ss);
p.check('setSelfShadow edits one settings object shared by every object, existing and new', ss.shared.sameObject && ss.shared.otherSeesIt.enabled === true && ss.shared.otherSeesIt.penumbra === 0.9 && ss.shared.newObject === true, ss.shared);
p.check('assigning an object its own selfShadow settings isolates it from the shared ones', ss.isolated.img === true && ss.isolated.other === false, ss.isolated);
p.check('lit images with different self-shadow settings split the batch: mixed costs more draw calls than both on or both off', ss.draws.mixed > ss.draws.bothOn && ss.draws.mixed > ss.draws.bothOff && ss.draws.bothOn === ss.draws.bothOff, ss.draws);

await p.finish();

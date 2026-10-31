// Purpose: reproduce the dynamic-light claims in skills/phaser-worlds/references/dynamic-lights.md on Phaser 4.2.1.
// Run:     node phaser-worlds-lights.mjs /absolute/path/to/host-project   (host has phaser 4.2.1 and playwright-core or @playwright/test)
// Expect:  JSON with every check ok and exit code 0. A failing "maxLights keeps creation order" check means Phaser fixed the
//          nearest-lights sort; update the reference when that happens.
// Covers:  lit objects are black until scene.lights.enable(), default ambient, cone angles (full widths) and rotation convention,
//          radius independent of camera zoom, CPU and GPU tilemap layers are lit, maxLights ordering, Light#setVisible as the cull switch.
import { startProbe } from './phaser-worlds-lib.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const options = process.argv.slice(3);
let mutation = null, outputRoot = tmpdir();
while (options.length) {
  const flag = options.shift(), value = options.shift();
  if (flag === '--mutation' && ['normal-source', 'restoration'].includes(value)) mutation = value;
  else if (flag === '--out' && value) outputRoot = resolve(value);
  else throw new Error('Expected --out <directory> or --mutation normal-source|restoration');
}
await mkdir(outputRoot, { recursive: true });
const evidence = await mkdtemp(join(outputRoot, 'phaser-authored-shadow-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { evidence, mutation, passed: false, baseline: [], rows: [], sources: {}, cleanup: {}, verdict: 'unverified' };
const save = () => writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const hostRequire = createRequire(resolve(process.argv[2] ?? '.', 'package.json'));
report.sources.phaser = { sha256: hash(await readFile(hostRequire.resolve('phaser'))) };
const bounded = async (promise, name) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(name + ' timed out')), 15000); })]); }
  finally { clearTimeout(timer); }
};
let p;
try {

p = await startProbe(process.argv[2], {
  startupTimeout: 15000,
  game: { pixelArt: true, render: { preserveDrawingBuffer: true } },
  setup: `
    const big = scene.textures.createCanvas('big', 64, 64); big.context.fillStyle = '#fff'; big.context.fillRect(0, 0, 64, 64); big.refresh();
    const tiles = scene.textures.createCanvas('tiles', 16, 16); tiles.context.fillStyle = '#fff'; tiles.context.fillRect(0, 0, 16, 16); tiles.refresh();
  `,
});
report.renderer = p.renderer;
report.hardwareQualified = !/swiftshader|software|llvmpipe|swiftshader|lavapipe/i.test(p.renderer.renderer);
const evaluate = p.page.evaluate.bind(p.page);
p.page.evaluate = (...args) => bounded(evaluate(...args), 'lighting page evaluation');
const check = p.check.bind(p);
p.check = (name, ok, detail) => { report.baseline.push({ name, ok: !!ok, detail }); check(name, ok, detail); };
// The old stripe witness intentionally mutates a prototype-level object and draw hooks.
// Save descriptors and identities before it runs; all success/failure paths restore them.
report.sharedBefore = await p.page.evaluate(() => {
  const owners = [Phaser.GameObjects.Image.prototype, Phaser.GameObjects.Sprite.prototype].map(prototype => {
    while (!Object.hasOwn(prototype, 'selfShadow')) prototype = Object.getPrototypeOf(prototype);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'selfShadow');
    return { prototype, descriptor, value: descriptor.value, values: Object.getOwnPropertyDescriptors(descriptor.value) };
  });
  window.shadowOriginal = { owners, drawElements: game.renderer.drawElements, drawInstancedArrays: game.renderer.drawInstancedArrays };
  window.restoreShadowShared = () => {
    for (const item of owners) {
      for (const key of Reflect.ownKeys(item.value)) if (!Object.hasOwn(item.values, key)) delete item.value[key];
      Object.defineProperties(item.value, item.values);
      Object.defineProperty(item.prototype, 'selfShadow', item.descriptor);
    }
    game.renderer.drawElements = shadowOriginal.drawElements;
    game.renderer.drawInstancedArrays = shadowOriginal.drawInstancedArrays;
    return owners.map(item => ({ sameIdentity: item.prototype.selfShadow === item.value,
      sameDescriptor: ['value', 'writable', 'enumerable', 'configurable'].every(key => Object.getOwnPropertyDescriptor(item.prototype, 'selfShadow')[key] === item.descriptor[key]),
      sameValues: Reflect.ownKeys(item.value).length === Reflect.ownKeys(item.values).length && Reflect.ownKeys(item.values).every(key => {
        const now = Object.getOwnPropertyDescriptor(item.value, key), before = item.values[key];
        return Reflect.ownKeys(before).every(field => Object.is(now[field], before[field]));
      }), values: { ...item.value } }));
  };
  return owners.map(item => ({ values: { ...item.value }, ownProperty: true }));
});
await save();
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

report.sharedAfterBaseline = await p.page.evaluate(() => restoreShadowShared());
assert.ok(report.sharedAfterBaseline.every(item => item.sameIdentity && item.sameDescriptor && item.sameValues), 'baseline shared-setting restoration');
await observeAuthoredShadow();
assert.ok(report.baseline.every(item => item.ok), 'preserved lighting baseline');
assert.equal(p.errors.length, 0, 'no native page errors');
report.passed = true;
} catch (error) {
  report.failure = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  if (p) {
    try {
      report.cleanup.native = await p.page.evaluate(async () => {
        const restored = window.restoreShadowShared?.() ?? [];
        const renderer = game.renderer, canvas = game.canvas, manager = game.scene, loop = game.loop;
        const hooksRestored = renderer.drawElements === shadowOriginal.drawElements && renderer.drawInstancedArrays === shadowOriginal.drawInstancedArrays;
        const sceneObjectsBefore = scene.children.length;
        // Remove objects while their original shared state is still inspectable.
        scene.children.list.slice().forEach(object => object.destroy());
        scene.lights.lights.slice().forEach(light => scene.lights.removeLight(light));
        const sceneObjectsAfter = scene.children.length;
        game.loop.wake();
        await new Promise((done, reject) => {
          const timer = setTimeout(() => reject(Error('lighting game destroy timed out')), 5000);
          game.events.once(Phaser.Core.Events.DESTROY, () => { clearTimeout(timer); setTimeout(done, 0); });
          game.destroy(true, true);
        });
        return { restored, hooksRestored, sceneObjectsBefore, sceneObjectsAfter, canvasRemoved: !canvas.isConnected,
          scenesDestroyed: manager.scenes.length === 0, loopStopped: !loop.running,
          rendererReleased: renderer.gl === null && renderer.game === null && renderer.canvas === null };
      });
      const cleanup = report.cleanup.native;
      assert.ok(cleanup.restored.length === 2 && cleanup.restored.every(item => item.sameIdentity && item.sameDescriptor && item.sameValues), 'exact shared property identity, descriptor and values restored');
      assert.ok(cleanup.hooksRestored && cleanup.sceneObjectsAfter === 0 && cleanup.canvasRemoved && cleanup.scenesDestroyed && cleanup.loopStopped && cleanup.rendererReleased, 'owned lighting resources cleaned');
    } catch (error) { report.cleanup.failure = error.stack; report.passed = false; process.exitCode = 1; }
    try {
      const browser = p.page.context().browser();
      await p.finish();
      report.cleanup.browserClosed = !browser.isConnected();
    } catch (error) { report.cleanup.browserFailure = error.stack; report.passed = false; process.exitCode = 1; }
  }
  if (!report.passed) report.verdict = 'unverified';
  await save();
  console.log(JSON.stringify(report, null, 2));
}

async function observeAuthoredShadow() {
  // Independent declaration precedes capture. These are setter arguments, not inferred shader uniforms.
  const declaration = {
    width: 400, height: 300, frame: '1', sourceSize: [32, 24], cut: [30, 0, 30, 22], trim: [1, 1],
    position: [100, 70], scale: 6, origin: [0, 0], ambient: 0x303030,
    light: { radius: 2000, intensity: 2, z: 120, color: 0xffffff },
    directions: { left: [-150, 140], right: [600, 140], above: [200, -250], below: [200, 600] },
    variants: ['authored', 'flat'],
    settings: [
      { name: 'off', enabled: false, penumbra: 0.5, diffuseFlatThreshold: 1 / 3 },
      { name: 'default-on', enabled: true, penumbra: 0.5, diffuseFlatThreshold: 1 / 3 },
      { name: 'low-penumbra-on', enabled: true, penumbra: 0.05, diffuseFlatThreshold: 1 / 3 },
      { name: 'high-threshold-on', enabled: true, penumbra: 0.5, diffuseFlatThreshold: 1 },
    ],
    regions: { left: [4, 7, 12, 16], right: [11, 14, 12, 16], top: [7, 11, 9, 12], bottom: [7, 11, 16, 19] },
    camera: { scrollX: 0, scrollY: 0, zoom: 1, rotation: 0 }, heldTime: 1000, delta: 0,
  };
  report.declaration = declaration;
  for (const variant of declaration.variants) for (const direction of Object.keys(declaration.directions)) for (const setting of declaration.settings) {
    report.rows.push({ id: `${variant}-${direction}-${setting.name}`, variant, direction, setting, disposition: 'unverified' });
  }
  const fixture = new URL('../../../tests/fixtures/normal-atlas/', import.meta.url);
  const files = {};
  for (const name of ['color.png', 'normal.png', 'color.atlas.json', 'normal.atlas.json']) {
    files[name] = await readFile(new URL(name, fixture));
    report.sources[name] = { bytes: files[name].length, sha256: hash(files[name]) };
    await writeFile(join(evidence, 'fixture-' + name), files[name]);
  }
  report.sources.probe = { sha256: hash(await readFile(new URL(import.meta.url))) };
  await save();
  await p.page.route('http://shadow-fixtures.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const body = files[mutation === 'normal-source' && name === 'normal.png' ? 'color.png' : name];
    return route.fulfill({ status: body ? 200 : 404, body: body ?? '', headers: {
      'access-control-allow-origin': '*', 'content-type': name.endsWith('.png') ? 'image/png' : 'application/json',
    } });
  });
  const admitted = await p.page.evaluate(async ({ declaration, expectedColor, expectedNormal }) => {
    const base = 'http://shadow-fixtures.test/';
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(Error('authored atlas load timed out')), 5000);
      const failed = file => { clearTimeout(timer); reject(Error('atlas load failed: ' + file.key)); };
      scene.load.once('loaderror', failed);
      scene.load.once('complete', () => { clearTimeout(timer); scene.load.off('loaderror', failed); done(); });
      scene.load.atlas('shadow-authored', [base + 'color.png', base + 'normal.png'], base + 'color.atlas.json');
      scene.load.atlas('shadow-flat', base + 'color.png', base + 'color.atlas.json');
      scene.load.start();
    });
    const bytes64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384)); return btoa(text); };
    window.shadowDecode = image => {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
      const result = { width: canvas.width, height: canvas.height, rgba: bytes64(context.getImageData(0, 0, canvas.width, canvas.height).data), png: canvas.toDataURL().split(',')[1] };
      canvas.width = canvas.height = 0; return result;
    };
    const decodeExpected = async encoded => { const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode(); return shadowDecode(image); };
    const authored = scene.textures.get('shadow-authored'), flat = scene.textures.get('shadow-flat');
    const sources = { color: authored.source[0], normal: authored.dataSource[0], flatColor: flat.source[0] };
    window.shadowSources = { ...sources, images: Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, source.image])) };
    scene.lights.enable(); scene.lights.setAmbientColor(declaration.ambient);
    scene.cameras.main.setPosition(0, 0).setSize(400, 300).setScroll(0, 0).setZoom(1).setRotation(0);
    window.shadowSprite = scene.add.sprite(100, 70, 'shadow-authored', '1').setOrigin(0).setScale(6).setLighting(true);
    shadowSprite.selfShadow = { enabled: false, penumbra: 0.5, diffuseFlatThreshold: 1 / 3 };
    window.shadowLight = scene.lights.addLight(-150, 140, 2000, 0xffffff, 2, 120);
    game.loop.sleep();
    window.shadowState = () => {
      const camera = scene.cameras.main, sprite = shadowSprite, frame = sprite.frame;
      const actualSources = { color: authored.source[0], normal: authored.dataSource[0], flatColor: flat.source[0] };
      const sourceSame = Object.entries(actualSources).every(([key, source]) => source === shadowSources[key] && source.image === shadowSources.images[key]);
      return { camera: { x: camera.x, y: camera.y, width: camera.width, height: camera.height, scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom, rotation: camera.rotation, alpha: camera.alpha,
        internalEffects: camera.filters.internal.list.length, externalEffects: camera.filters.external.list.length },
        sprite: { x: sprite.x, y: sprite.y, scaleX: sprite.scaleX, scaleY: sprite.scaleY, originX: sprite.originX, originY: sprite.originY, alpha: sprite.alpha, rotation: sprite.rotation, flipX: sprite.flipX, flipY: sprite.flipY,
          texture: sprite.texture.key, frame: frame.name, cut: [frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight], trim: [frame.x, frame.y], sourceSize: [frame.realWidth, frame.realHeight], lighting: sprite.lighting, animationPlaying: sprite.anims.isPlaying,
          parent: sprite.parentContainer?.type ?? null, customRenderNodes: Object.keys(sprite.customRenderNodes).length, effects: sprite.filters ? 1 : 0 },
        light: { x: shadowLight.x, y: shadowLight.y, radius: shadowLight.radius, intensity: shadowLight.intensity, z: shadowLight.z, color: [shadowLight.color.r, shadowLight.color.g, shadowLight.color.b] },
        ambient: [scene.lights.ambientColor.r, scene.lights.ambientColor.g, scene.lights.ambientColor.b],
        selfShadow: { ...sprite.selfShadow }, sourcesSame: sourceSame, children: scene.children.length, lights: scene.lights.lights.length, loopRunning: game.loop.running,
        canvas: [game.canvas.width, game.canvas.height], time: scene.time.now, pixelArt: game.config.pixelArt };
    };
    window.shadowCapture = () => {
      let completed = 0; const rendered = () => completed++;
      game.events.once(Phaser.Core.Events.POST_RENDER, rendered);
      try { game.step(1000, 0); } finally { game.events.off(Phaser.Core.Events.POST_RENDER, rendered); }
      const capture = shadowDecode(game.canvas);
      return { ...capture, state: shadowState(), completed, heldTime: 1000, delta: 0 };
    };
    return { sources: { expectedColor: await decodeExpected(expectedColor), expectedNormal: await decodeExpected(expectedNormal),
      actualColor: shadowDecode(sources.color.image), actualNormal: shadowDecode(sources.normal.image), actualFlatColor: shadowDecode(sources.flatColor.image) },
      flatNormalSources: flat.dataSource.length, frame: declaration.frame };
  }, { declaration, expectedColor: files['color.png'].toString('base64'), expectedNormal: files['normal.png'].toString('base64') });
  const retain = async (stem, shot) => {
    const rgba = Buffer.from(shot.rgba, 'base64'), png = Buffer.from(shot.png, 'base64');
    await writeFile(join(evidence, stem + '.rgba'), rgba); await writeFile(join(evidence, stem + '.png'), png);
    const { rgba: _rgba, png: _png, ...facts } = shot;
    const artifact = { ...facts, rgba: stem + '.rgba', png: stem + '.png', rgbaSha256: hash(rgba), pngSha256: hash(png) };
    return { rgba, artifact };
  };
  report.decoded = {};
  for (const [name, source] of Object.entries(admitted.sources)) report.decoded[name] = (await retain('source-' + name, source)).artifact;
  const capture = async stem => retain(stem, await p.page.evaluate(() => shadowCapture()));
  report.authenticationFrame = (await capture('authentication-frame')).artifact;
  await save();
  assert.equal(report.decoded.actualColor.rgbaSha256, report.decoded.expectedColor.rgbaSha256, 'colour-source authentication');
  assert.equal(report.decoded.actualNormal.rgbaSha256, report.decoded.expectedNormal.rgbaSha256, 'normal-source authentication');
  assert.equal(report.decoded.actualFlatColor.rgbaSha256, report.decoded.expectedColor.rgbaSha256, 'flat colour-source authentication');
  for (const [actual, expected] of [['actualColor', 'expectedColor'], ['actualNormal', 'expectedNormal'], ['actualFlatColor', 'expectedColor']]) {
    assert.deepEqual([report.decoded[actual].width, report.decoded[actual].height], [report.decoded[expected].width, report.decoded[expected].height], 'decoded source dimensions');
  }
  assert.equal(admitted.flatNormalSources, 0, 'flat variant uses renderer flat normal');

  const difference = (before, after, region = [0, 400, 0, 300]) => {
    const [x0, x1, y0, y1] = region;
    let changedPixels = 0, darkerPixels = 0, lighterPixels = 0, rgbDelta = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * 400 + x) * 4;
      if ([0, 1, 2, 3].some(c => before[i + c] !== after[i + c])) changedPixels++;
      const delta = after[i] + after[i + 1] + after[i + 2] - before[i] - before[i + 1] - before[i + 2];
      if (delta < 0) darkerPixels++; if (delta > 0) lighterPixels++; rgbDelta += delta;
    }
    return { changedPixels, darkerPixels, lighterPixels, rgbDelta };
  };
  const physicalRegions = Object.fromEntries(Object.entries(declaration.regions).map(([name, [x0, x1, y0, y1]]) => [name, [100 + x0 * 6, 100 + (x1 + 1) * 6, 70 + y0 * 6, 70 + (y1 + 1) * 6]]));
  report.physicalRegions = physicalRegions;
  const offFrames = {};
  for (const variant of declaration.variants) for (const [direction, position] of Object.entries(declaration.directions)) {
    await p.page.evaluate(({ variant, position }) => {
      shadowSprite.setTexture('shadow-' + variant, '1'); shadowLight.setPosition(...position); shadowSprite.setSelfShadow(false, 0.5, 1 / 3);
    }, { variant, position });
    let off;
    for (const setting of declaration.settings) {
      const row = report.rows.find(row => row.variant === variant && row.direction === direction && row.setting.name === setting.name);
      await p.page.evaluate(setting => shadowSprite.setSelfShadow(setting.enabled, setting.penumbra, setting.diffuseFlatThreshold), setting);
      const frame = await capture(row.id); row.frame = frame.artifact; await save();
      const state = frame.artifact.state;
      assert.equal(frame.artifact.completed, 1, 'one completed held frame');
      assert.deepEqual(state.camera, { x: 0, y: 0, width: 400, height: 300, scrollX: 0, scrollY: 0, zoom: 1, rotation: 0, alpha: 1, internalEffects: 0, externalEffects: 0 }, 'declared camera and effects');
      assert.deepEqual(state.sprite, { x: 100, y: 70, scaleX: 6, scaleY: 6, originX: 0, originY: 0, alpha: 1, rotation: 0, flipX: false, flipY: false,
        texture: 'shadow-' + variant, frame: '1', cut: [30, 0, 30, 22], trim: [1, 1], sourceSize: [32, 24], lighting: true, animationPlaying: false, parent: null, customRenderNodes: 0, effects: 0 }, 'declared sprite state');
      assert.deepEqual(state.light, { x: position[0], y: position[1], radius: 2000, intensity: 2, z: 120, color: [1, 1, 1] }, 'declared light');
      assert.deepEqual(state.selfShadow, { enabled: setting.enabled, penumbra: setting.penumbra, diffuseFlatThreshold: setting.diffuseFlatThreshold }, 'exact setter arguments');
      assert.ok(state.sourcesSame && state.children === 1 && state.lights === 1 && !state.loopRunning && state.pixelArt, 'held source and scene identity');
      assert.deepEqual(state.canvas, [400, 300]);
      if (!setting.enabled) {
        off = frame; offFrames[variant + '-' + direction] = frame; row.disposition = 'baseline';
      } else {
        assert.deepEqual({ ...state, selfShadow: off.artifact.state.selfShadow }, off.artifact.state, 'held native state aside from declared self-shadow settings');
        row.change = difference(off.rgba, frame.rgba);
        row.regions = Object.fromEntries(Object.entries(physicalRegions).map(([name, rect]) => [name, difference(off.rgba, frame.rgba, rect)]));
        row.disposition = row.change.darkerPixels && !row.change.lighterPixels ? 'contribution' : row.change.changedPixels ? 'unsupported-change' : 'no-contribution';
        await p.page.evaluate(mutate => { shadowSprite.setSelfShadow(false, 0.5, 1 / 3); if (mutate) shadowSprite.x += 1; }, mutation === 'restoration' && variant === 'authored' && direction === 'left' && setting.name === 'default-on');
        const restored = await capture(row.id + '-restored'); row.restored = restored.artifact;
        row.restoration = difference(off.rgba, restored.rgba); await save();
        assert.equal(row.restoration.changedPixels, 0, 'restoration pixels exactly match off');
        assert.deepEqual(restored.artifact.state, off.artifact.state, 'restoration native state exactly matches off');
      }
      await save();
    }
  }
  report.normalControl = Object.fromEntries(Object.keys(declaration.directions).map(direction => [direction,
    difference(offFrames['flat-' + direction].rgba, offFrames['authored-' + direction].rgba)]));
  await save();
  assert.ok(Object.values(report.normalControl).every(change => change.changedPixels > 0), 'authored normals versus flat control contributes in every declared direction');
  assert.equal(report.rows.length, 32);
  assert.ok(report.rows.every(row => row.disposition !== 'unverified'), 'every declared matrix row has a disposition');
  const authored = report.rows.filter(row => row.variant === 'authored' && row.setting.enabled);
  const contributions = authored.filter(row => row.disposition === 'contribution').length;
  report.observedVerdict = contributions === authored.length ? 'validated' : contributions ? 'partial' : 'invalidated';
  report.verdict = report.hardwareQualified ? report.observedVerdict : 'unverified';
  report.limits = ['Only the declared fixture, geometry, lights and setter arguments; no aesthetic, performance or universal self-shadow claim.',
    'Software runs retain baseline/matrix observations but cannot qualify the authored hardware verdict.',
    'Normal-versus-flat establishes this source affects paint; it does not establish visual quality.'];
  await save();
}

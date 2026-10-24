// Purpose: reproduce the camera claims in skills/phaser-worlds/references/cameras.md on Phaser 4.2.1.
// Run:     node phaser-worlds-cameras.mjs /absolute/path/to/host-project   (host has phaser 4.2.1 and playwright-core or @playwright/test)
// Expect:  JSON with every check ok and exit code 0. A failing check means a Phaser upgrade changed that behaviour; fix the reference.
// Covers:  worldView vs scroll under zoom, worldView staleness, bounds smaller than the view, getWorldPoint with a viewport offset,
//          startFollow resetting roundPixels, vertex rounding at zoom, shake amplitude under zoom, scrollFactor 0 under zoom,
//          camera.ignore on Layer / Group / Container, offscreen objects still processed, a second camera doubling the work,
//          camera rotation ignored by worldView, pointer.worldX only refreshed by hit tests.
import { startProbe } from './phaser-worlds-lib.mjs';

const p = await startProbe(process.argv[2], {
  game: { pixelArt: true },
  setup: `const t = scene.textures.createCanvas('px', 4, 4); t.context.fillStyle = '#fff'; t.context.fillRect(0, 0, 4, 4); t.refresh();`,
});

// 1. scroll is the centre-anchored pan, not the top-left of the view, once zoom is not 1; worldView updates during render.
const c1 = await p.page.evaluate(async () => {
  const cam = scene.cameras.main;
  cam.setScroll(100, 50).setZoom(2);
  const stale = [cam.worldView.x, cam.worldView.y];
  await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
  return { stale, fresh: [cam.worldView.x, cam.worldView.y, cam.worldView.width, cam.worldView.height] };
});
p.check('worldView is stale until the next render', c1.stale[0] === 0 && c1.stale[1] === 0, c1.stale);
p.check('worldView.x = scrollX + w/2 - w/(2 zoom)', c1.fresh[0] === 200 && c1.fresh[1] === 125 && c1.fresh[2] === 200, c1.fresh);

// 2. bounds smaller than the view pin to the bounds origin; with zoom the clamped scroll goes negative.
const c2 = await p.page.evaluate(async () => {
  const cam = scene.cameras.main;
  const next = () => new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
  cam.setZoom(1).setBounds(0, 0, 200, 100).setScroll(500, 500); await next();
  const small = [cam.scrollX, cam.scrollY];
  cam.setBounds(0, 0, 2000, 1000).setZoom(2).setScroll(-500, -500); await next();
  const zoomed = { scroll: [cam.scrollX, cam.scrollY], view: [cam.worldView.x, cam.worldView.y] };
  cam.removeBounds(); cam.setZoom(1).setScroll(0, 0);
  return { small, zoomed };
});
p.check('bounds smaller than the view pin the scroll to the bounds origin', c2.small[0] === 0 && c2.small[1] === 0, c2.small);
p.check('at zoom 2 the bound edge is worldView.x = 0 with scrollX = -100', c2.zoomed.view[0] === 0 && c2.zoomed.scroll[0] === -100, c2.zoomed);

// 3. getWorldPoint accounts for viewport offset and zoom; pointer.worldX is only refreshed by input hit tests.
await p.page.evaluate(() => { scene.cameras.main.setScroll(100, 50).setZoom(2); });
await p.frames(2);
await p.page.mouse.move(200, 150);
await p.frames(2);
const c3 = await p.page.evaluate(() => {
  const ptr = scene.input.activePointer;
  const w = scene.cameras.main.getWorldPoint(ptr.x, ptr.y);
  return { pointer: [ptr.x, ptr.y], viaCamera: [w.x, w.y], pointerWorld: [ptr.worldX, ptr.worldY] };
});
p.check('camera.getWorldPoint(pointer.x, pointer.y) maps screen to world', c3.viaCamera[0] === 300 && c3.viaCamera[1] === 200, c3);
const c3b = await p.page.evaluate(async () => {
  scene.cameras.main.setZoom(1).setScroll(0, 0);
  const cam = scene.cameras.add(100, 50, 200, 150).setZoom(2).setScroll(40, 30);
  await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
  const centre = cam.getWorldPoint(100 + 100, 50 + 75);
  const out = { centre: [centre.x, centre.y], mid: [cam.midPoint.x, cam.midPoint.y] };
  scene.cameras.remove(cam);
  return out;
});
await p.page.evaluate(async () => {
  scene.cameras.main.setScroll(100, 50).setZoom(2);
  scene.cameras.add(300, 0, 100, 75).setZoom(0.25).setScroll(0, 0);   // a minimap in the top-right corner
  await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
});
await p.page.mouse.move(350, 40);
await p.frames(2);
const c3c = await p.page.evaluate(() => {
  const ptr = scene.input.activePointer;
  const mini = scene.cameras.cameras[1];
  const main = scene.cameras.main.getWorldPoint(ptr.x, ptr.y);
  const onMini = mini.getWorldPoint(ptr.x, ptr.y);
  scene.cameras.remove(mini);
  return { pointerWorld: [ptr.worldX, ptr.worldY], main: [main.x, main.y], mini: [onMini.x, onMini.y] };
});
p.check('with a minimap under the pointer, pointer.worldX/Y is the main camera mapping', c3c.pointerWorld[0] === c3c.main[0] && c3c.pointerWorld[0] !== c3c.mini[0], c3c);
p.check('a camera with a viewport offset and zoom maps its centre to midPoint', c3b.centre[0] === c3b.mid[0] && c3b.centre[1] === c3b.mid[1], c3b);

// 4. startFollow resets roundPixels unless asked; rotation is ignored by worldView.
const c4 = await p.page.evaluate(async () => {
  const cam = scene.cameras.main;
  const before = cam.roundPixels;
  cam.startFollow({ x: 50, y: 50 });
  const afterDefault = cam.roundPixels;
  cam.startFollow({ x: 50, y: 50 }, true);
  const afterTrue = cam.roundPixels;
  cam.stopFollow();
  cam.setZoom(1).setScroll(0, 0).setRotation(0.6);
  await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
  const view = [cam.worldView.width, cam.worldView.height];
  cam.setRotation(0);
  return { before, afterDefault, afterTrue, view };
});
p.check('startFollow(target) switches camera.roundPixels off', c4.before === true && c4.afterDefault === false && c4.afterTrue === true, c4);
p.check('worldView ignores camera rotation', c4.view[0] === 400 && c4.view[1] === 300, c4.view);

// 5. vertex rounding: safeAuto rounds only when the combined matrix is a pure translation.
const c5 = await p.page.evaluate(async () => {
  const node = game.renderer.renderNodes.getNode('TransformerImage');
  const cam = scene.cameras.main;
  const img = scene.add.image(10.4, 10.4, 'px').setOrigin(0);
  const rows = {};
  for (const [key, zoom, mode] of [['zoom1_safeAuto', 1, 'safeAuto'], ['zoom3_safeAuto', 3, 'safeAuto'], ['zoom3_fullAuto', 3, 'fullAuto']]) {
    cam.setZoom(zoom).setRoundPixels(true).setScroll(0.3, 0.3);
    img.setVertexRoundMode(mode);
    let quad = null;
    const orig = node.run;
    node.run = function () { const r = orig.apply(this, arguments); if (!quad) quad = [this.quad[0], this.quad[1]]; return r; };
    await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
    node.run = orig;
    rows[key] = quad;
  }
  img.destroy(); cam.setZoom(1).setScroll(0, 0);
  return rows;
});
const whole = (q) => Number.isInteger(q[0]) && Number.isInteger(q[1]);
p.check('roundPixels snaps vertices at zoom 1', whole(c5.zoom1_safeAuto), c5.zoom1_safeAuto);
p.check('roundPixels does not snap vertices at zoom 3 in safeAuto mode', !whole(c5.zoom3_safeAuto), c5.zoom3_safeAuto);
p.check('fullAuto snaps vertices at zoom 3', whole(c5.zoom3_fullAuto), c5.zoom3_fullAuto);

// 6. shake: the offset is rounded when roundPixels is on, then multiplied by zoom a second time by matrix.translate.
const c6 = await p.page.evaluate(async () => {
  const cam = scene.cameras.main;
  const rows = [];
  for (const [zoom, rp] of [[1, true], [3, true], [3, false]]) {
    cam.setZoom(zoom).setRoundPixels(rp).setScroll(0, 0);
    await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
    const base = cam.matrix.matrix[4];
    const random = Math.random; Math.random = () => 0.9;
    cam.shake(100000, 0.01, true);
    await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
    await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
    rows.push({ zoom, roundPixels: rp, offset: cam.shakeEffect._offsetX, screenDelta: cam.matrix.matrix[4] - base });
    Math.random = random; cam.resetFX();
  }
  cam.setZoom(1).setRoundPixels(true).setScroll(0, 0);
  return rows;
});
p.check('shake offset is a whole number when roundPixels is on', Number.isInteger(c6[0].offset) && Number.isInteger(c6[1].offset) && !Number.isInteger(c6[2].offset), c6);
p.check('shake moves the view by offset * zoom (amplitude grows with zoom squared)', c6[1].screenDelta === c6[1].offset * 3, c6);

// 6b. The rendered shift of a rounded shake is a whole multiple of the zoom, so it stays on the art grid at integer zoom.
const c6b = await p.page.evaluate(async () => {
  const cam = scene.cameras.main;
  const marker = scene.add.image(100, 100, 'px').setOrigin(0);
  const box = async () => {
    await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
    const img = await new Promise((res) => game.renderer.snapshot(res));
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let minX = Infinity, minY = Infinity;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 128) { const q = i / 4; minX = Math.min(minX, q % c.width); minY = Math.min(minY, Math.floor(q / c.width)); }
    return [minX, minY];
  };
  cam.setZoom(3).setRoundPixels(true).centerOn(110, 110);
  await box();
  const before = await box();
  const random = Math.random; Math.random = () => 0.9;
  cam.shake(100000, 0.01, true);
  await box(); await box();
  const after = await box();
  Math.random = random; cam.resetFX(); marker.destroy(); cam.setZoom(1).setScroll(0, 0);
  return { shift: [after[0] - before[0], after[1] - before[1]] };
});
p.check('a rounded shake at zoom 3 shifts the picture by whole multiples of 3 device pixels', c6b.shift.every((v) => v !== 0 && v % 3 === 0), c6b);

// 7. scrollFactor 0 is not a HUD under zoom.
const c7 = await p.page.evaluate(async () => {
  const node = game.renderer.renderNodes.getNode('TransformerImage');
  const cam = scene.cameras.main;
  const out = [];
  for (const zoom of [1, 3]) {
    cam.setZoom(zoom).setScroll(50, 50);
    const hud = scene.add.image(10, 10, 'px').setOrigin(0).setScrollFactor(0);
    let quad = null;
    const orig = node.run;
    node.run = function () { const r = orig.apply(this, arguments); quad = [this.quad[0], this.quad[1]]; return r; };
    await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
    node.run = orig; hud.destroy();
    out.push(quad);
  }
  cam.setZoom(1).setScroll(0, 0);
  return out;
});
p.check('scrollFactor 0 keeps the object on screen at zoom 1', c7[0][0] === 10 && c7[0][1] === 10, c7[0]);
p.check('scrollFactor 0 is zoomed about the viewport centre at zoom 3', c7[1][0] === -370 && c7[1][1] === -270, c7[1]);

// 8. camera.ignore on Layer, Group and Container.
const c8 = await p.page.evaluate(() => {
  const ui = scene.cameras.add(0, 0, 400, 300);
  const layer = scene.add.layer(); const group = scene.add.group(); const container = scene.add.container(0, 0);
  ui.ignore(layer); ui.ignore(group); ui.ignore(container);
  const inLayer = scene.add.image(0, 0, 'px'); layer.add(inLayer);
  const inGroup = scene.add.image(0, 0, 'px'); group.add(inGroup);
  const inContainer = scene.add.image(0, 0, 'px'); container.add(inContainer);
  const out = { layerChild: inLayer.willRender(ui), groupLateChild: inGroup.willRender(ui), containerHidden: !container.willRender(ui) };
  scene.cameras.remove(ui);
  const next = scene.cameras.add(0, 0, 100, 100);
  out.idReused = next.id === ui.id; out.layerHiddenFromNewCamera = !layer.willRender(next);
  scene.cameras.remove(next);
  [inLayer, inGroup, inContainer, layer, group, container].forEach((o) => o.destroy());
  return out;
});
p.check('ignore(layer) also hides children added later', c8.layerChild === false, c8);
p.check('ignore(group) only marks the children present at the call', c8.groupLateChild === true, c8);
p.check('ignore(container) skips the container and so its children', c8.containerHidden === true, c8);
p.check('a removed camera leaves its ignore bit on the objects, and the next camera reuses the id', c8.idReused && c8.layerHiddenFromNewCamera, c8);

// 9. nothing culls display objects by position: offscreen images are still transformed, hidden ones are not, a second camera doubles it.
const c9 = await p.page.evaluate(async () => {
  const node = game.renderer.renderNodes.getNode('TransformerImage');
  const next = () => new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
  let calls = 0; const orig = node.run; node.run = function () { calls++; return orig.apply(this, arguments); };
  await next(); calls = 0; await next();
  const base = calls;                       // images left in the scene by the earlier checks
  const far = []; for (let i = 0; i < 200; i++) far.push(scene.add.image(100000 + i * 10, 100000, 'px'));
  await next(); calls = 0; await next();
  const offscreen = calls - base;
  const mini = scene.cameras.add(300, 0, 100, 75).setZoom(0.25);
  await next(); calls = 0; await next();
  const twoCameras = calls - 2 * base;
  scene.cameras.remove(mini);
  far.forEach((s) => s.setVisible(false));
  await next(); calls = 0; await next();
  const hidden = calls - base;
  node.run = orig; far.forEach((s) => s.destroy());
  return { base, offscreen, twoCameras, hidden };
});
p.check('200 far offscreen images all go through the transformer', c9.offscreen === 200, c9);
p.check('a second camera repeats the pass', c9.twoCameras === 2 * c9.offscreen, c9);
p.check('setVisible(false) removes the cost', c9.hidden === 0, c9);

// 10. CPU cost of the draw submission, printed for comparison only (software GL, CPU side).
const cost = await p.page.evaluate(async () => {
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return +b[Math.floor(b.length / 2)].toFixed(2); };
  const frames = (n) => new Promise((res) => { let k = 0; const h = () => { if (++k >= n) { game.events.off(Phaser.Core.Events.POST_RENDER, h); res(); } }; game.events.on(Phaser.Core.Events.POST_RENDER, h); });
  const times = []; const orig = game.renderer.render;
  game.renderer.render = function () { const t0 = performance.now(); const r = orig.apply(this, arguments); times.push(performance.now() - t0); return r; };
  const rows = {};
  for (const [name, x, visible] of [['10000 images on screen', 0, true], ['10000 images far offscreen', 100000, true], ['10000 images far offscreen, hidden', 100000, false]]) {
    const imgs = []; for (let i = 0; i < 10000; i++) imgs.push(scene.add.image(x ? x + Math.random() * 400 : Math.random() * 400, x ? x : Math.random() * 300, 'px').setVisible(visible));
    await frames(5); times.length = 0; await frames(30);
    rows[name] = med(times); imgs.forEach((s) => s.destroy());
  }
  game.renderer.render = orig;
  return rows;
});
p.check('hidden objects cost far less than offscreen ones', cost['10000 images far offscreen, hidden'] < cost['10000 images far offscreen'], cost);
console.error('CPU ms per renderer.render call (comparison only):', JSON.stringify(cost));

await p.finish();

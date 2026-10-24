// Purpose: reproduce the grouping and z-order claims in skills/phaser-worlds/references/world-streaming-and-layers.md on Phaser 4.2.1.
// Run:     node phaser-worlds-layers.mjs /absolute/path/to/host-project   (host has phaser 4.2.1 and playwright-core or @playwright/test)
// Expect:  JSON with every check ok and exit code 0. A failing check means a Phaser upgrade changed that behaviour.
// Covers:  Layer sorts children by depth while Container keeps list order, Container#sort, a filter on a Layer leaves objects outside it
//          alone, hiding a container skips its children, setActive(false) stops a sprite animating, and the cost of sorting 5000 objects.
import { startProbe } from './phaser-worlds-lib.mjs';

const p = await startProbe(process.argv[2], {
  width: 200, height: 100,
  game: { pixelArt: true },
  setup: `
    const solid = (key, color) => { const t = scene.textures.createCanvas(key, 16, 16); t.context.fillStyle = color; t.context.fillRect(0, 0, 16, 16); t.refresh(); };
    solid('red', '#f00'); solid('green', '#0f0');
    const sheet = scene.textures.createCanvas('sheet', 16, 8); sheet.context.fillStyle = '#f00'; sheet.context.fillRect(0, 0, 8, 8);
    sheet.context.fillStyle = '#0f0'; sheet.context.fillRect(8, 0, 8, 8); sheet.refresh();
    sheet.add(0, 0, 0, 0, 8, 8); sheet.add(1, 0, 8, 0, 8, 8);
    scene.anims.create({ key: 'blink', frames: [{ key: 'sheet', frame: 0 }, { key: 'sheet', frame: 1 }], frameRate: 30, repeat: -1 });
  `,
});
const letter = (px) => (px[0] === 255 && px[1] === 0 ? 'R' : px[1] === 255 && px[0] === 0 ? 'G' : px.slice(0, 3).join(','));

// 1. Layer sorts by child depth; Container draws in list order and ignores child depth until you sort it.
await p.page.evaluate(() => {
  const lr = scene.add.image(0, 0, 'red').setOrigin(0).setDepth(5);     // added first, higher depth
  const lg = scene.add.image(8, 0, 'green').setOrigin(0).setDepth(1);
  scene.add.layer([lr, lg]);
  const cr = scene.add.image(0, 0, 'red').setOrigin(0).setDepth(5);
  const cg = scene.add.image(8, 0, 'green').setOrigin(0).setDepth(1);
  window.box = scene.add.container(100, 0, [cr, cg]);
});
await p.frames(2);
const inLayer = letter(await p.pixel(10, 4));            // overlap of the two squares
const inBox = letter(await p.pixel(110, 4));
p.check('in a Layer the higher depth draws on top (red, added first, wins the overlap)', inLayer === 'R', inLayer);
p.check('in a Container child depth is ignored: list order decides (green, added last, wins)', inBox === 'G', inBox);
const sorted = await p.page.evaluate(() => { box.list[0].y = 20; box.list[1].y = 10; box.sort('y'); return box.list.map((o) => o.y); });
p.check('Container#sort("y") reorders the list', JSON.stringify(sorted) === JSON.stringify([10, 20]), sorted);
await p.page.evaluate(() => { scene.children.list.slice().forEach((o) => o.destroy()); });

// 2. A filter on a Layer touches only the Layer's children.
await p.page.evaluate(() => {
  const world = scene.add.layer([scene.add.image(0, 0, 'red').setOrigin(0)]);
  scene.add.image(40, 0, 'red').setOrigin(0);
  world.enableFilters();
  world.filters.external.addColorMatrix().colorMatrix.grayscale(1, false);
});
await p.frames(3);
const inside = await p.pixel(4, 4);
const outside = await p.pixel(44, 4);
p.check('an Image inside a filtered Layer is greyscale', inside[0] === inside[1] && inside[1] === inside[2] && inside[0] > 0, inside);
p.check('an Image outside the Layer keeps its colour on the same camera', outside[0] === 255 && outside[1] === 0, outside);
await p.page.evaluate(() => { scene.children.list.slice().forEach((o) => o.destroy()); });

// 2b. The nesting that places a GPU tile layer: Layer > Container (positioned) > GPU layer at (0, 0).
await p.page.evaluate(() => {
  const map = scene.make.tilemap({ data: [[0, 0]], tileWidth: 8, tileHeight: 8 });
  const set = map.addTilesetImage('red', 'red', 8, 8, 0, 0);
  const gpu = map.createLayer(0, set, 0, 0, true);
  scene.add.layer([scene.add.container(60, 0, [gpu])]);
});
await p.frames(3);
const nested = [letter(await p.pixel(64, 4)), letter(await p.pixel(4, 4))];
p.check('a GPU layer inside a Container inside a Layer is drawn at the container position', nested[0] === 'R' && nested[1] !== 'R', nested);
await p.page.evaluate(() => { scene.children.list.slice().forEach((o) => o.destroy()); });

// 3. Hiding one container skips every child; hiding the children one by one gives the same output but needs n writes.
const hide = await p.page.evaluate(async () => {
  const node = game.renderer.renderNodes.getNode('TransformerImage');
  const next = () => new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
  let calls = 0; const orig = node.run; node.run = function () { calls++; return orig.apply(this, arguments); };
  const kids = []; for (let i = 0; i < 300; i++) kids.push(scene.add.image(i, 0, 'red'));
  const chunk = scene.add.container(0, 0, kids);
  await next(); calls = 0; await next(); const shown = calls;
  chunk.setVisible(false); await next(); calls = 0; await next(); const hidden = calls;
  node.run = orig; chunk.destroy();
  return { shown, hidden };
});
p.check('a visible container submits all 300 children; one setVisible(false) submits none', hide.shown === 300 && hide.hidden === 0, hide);

// 4. setActive(false) stops a sprite's animation (the update list skips inactive objects).
const anim = await p.page.evaluate(async () => {
  const sprite = scene.add.sprite(100, 50, 'sheet').play('blink');
  const idle = () => new Promise((r) => setTimeout(r, 250));
  const seen = new Set(); const watch = () => seen.add(sprite.anims.currentFrame.index);
  const tick = setInterval(watch, 5); await idle(); clearInterval(tick);
  const whileActive = seen.size;
  sprite.setActive(false);
  const frozen = sprite.anims.currentFrame.index; await idle();
  const after = sprite.anims.currentFrame.index;
  sprite.destroy();
  return { whileActive, frozen, after };
});
p.check('an active sprite cycles frames and an inactive one stops', anim.whileActive === 2 && anim.frozen === anim.after, anim);

// 5. Sorting cost, printed for comparison only.
const sort = await p.page.evaluate(async () => {
  const ds = scene.sys.displayList; const orig = ds.depthSort; const t = [];
  ds.depthSort = function () { const t0 = performance.now(); const r = orig.apply(this, arguments); t.push(performance.now() - t0); return r; };
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return +b[Math.floor(b.length / 2)].toFixed(3); };
  const frames = (n) => new Promise((res) => { let k = 0; const h = () => { if (++k >= n) { game.events.off(Phaser.Core.Events.POST_RENDER, h); res(); } }; game.events.on(Phaser.Core.Events.POST_RENDER, h); });
  const imgs = []; for (let i = 0; i < 5000; i++) imgs.push(scene.add.image(Math.random() * 200, Math.random() * 100, 'red').setDepth(i));
  await frames(5); t.length = 0; await frames(30); const still = med(t);
  const ySort = () => { for (const im of imgs) im.setDepth(im.y); };
  game.events.on(Phaser.Core.Events.PRE_RENDER, ySort); t.length = 0; await frames(30); const every = med(t);
  game.events.off(Phaser.Core.Events.PRE_RENDER, ySort);
  imgs.forEach((i) => i.destroy()); ds.depthSort = orig;
  return { images: 5000, sortMsStill: still, sortMsYSortEveryFrame: every };
});
p.check('re-sorting 5000 objects by y every frame stays well under a frame budget', sort.sortMsYSortEveryFrame < 8, sort);
console.error('depth sort ms (this machine, comparison only):', JSON.stringify(sort));

await p.finish();

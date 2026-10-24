// Tilemap collision probe for Phaser 4.2.1 Arcade Physics: tileBias tunnelling, GPU layers, runtime tile edits,
// containers, overlap callbacks, seams and one-way tiles. It backs the [tested] claims in
// skills/phaser-physics/references/tilemap-collision.md.
//
// Run:      node phaser-physics-tilemap.mjs /absolute/path/to/host-project
// Needs:    Phaser 4.2.1 and @playwright/test in the host project; Playwright's Chromium (or CHROME_CHANNEL=chrome).
// WebGL:    a TilemapGPULayer needs a WebGL context. Software WebGL is enough: this probe checks collision logic and never
//           reads a pixel, so it says nothing about GPU correctness or speed. Frames are stepped by hand with game.step().
// Expected: one line, "phaser-physics-tilemap: N checks passed", and exit code 0. PROBE_VERBOSE=1 prints every measurement.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL || undefined,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
let checks = 0;
const ok = (value, name) => { assert.ok(value, name); checks++; };
const eq = (actual, expected, name) => { assert.deepEqual(actual, expected, name); checks++; };
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<div id="g"></div>');
  await page.addScriptTag({ path: require.resolve('phaser') });
  const result = await page.evaluate(async () => {
    const out = {};
    const sheet = Object.assign(document.createElement('canvas'), { width: 64, height: 16 });
    sheet.getContext('2d').fillRect(0, 0, 64, 16);
    const game = await new Promise((done) => {
      const g = new Phaser.Game({
        type: Phaser.WEBGL, width: 640, height: 480, audio: { noAudio: true }, banner: false, parent: 'g',
        physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
        scene: { create() { this.textures.addCanvas('tiles', sheet); done(g); } },
      });
    });
    game.loop.sleep();
    const scene = game.scene.scenes[0], world = scene.physics.world;
    const clock = { t: 1000 };
    const frames = (n) => { for (let i = 0; i < n; i++) { clock.t += 1000 / 60; game.step(clock.t, 1000 / 60); } };
    const make = (cols, rows, fill, gpu, x = 0, y = 0, tile = 16) => {
      const data = [];
      for (let r = 0; r < rows; r++) { const row = []; for (let q = 0; q < cols; q++) row.push(fill(q, r)); data.push(row); }
      const map = scene.make.tilemap({ data, tileWidth: tile, tileHeight: tile });
      const tileset = map.addTilesetImage('tiles', 'tiles', 16, 16, 0, 0);
      return { map, layer: map.createLayer(0, tileset, x, y, !!gpu) };
    };
    const box = (x, y, w = 14, h = 14) => { const b = scene.add.rectangle(x + w / 2, y + h / 2, w, h); scene.physics.add.existing(b); return b; };
    out.worldBoundsWidth = world.bounds.width;

    // 1. Tunnelling through a three-tile wall as a function of tileBias.
    const through = (speed, bias) => {
      world.TILE_BIAS = bias;
      let n = 0;
      for (let phase = 0; phase < 16; phase++) {
        const { map, layer } = make(100, 6, (q) => (q >= 10 && q < 13 ? 1 : -1), false);
        layer.setCollision([1]);
        const m = box(phase, 40, 16, 16); m.body.setVelocityX(speed);
        const col = scene.physics.add.collider(m, layer);
        frames(120);
        if (m.body.x >= 13 * 16) n++;
        col.destroy(); m.destroy(); map.destroy();
      }
      world.TILE_BIAS = 16;
      return n;
    };
    out.tileBias = { v600: through(600, 16), v2400: through(2400, 16), v2400bias64: through(2400, 64) };

    // 2. A GPU layer collides like a CPU layer, and edits collide before any data-texture regeneration.
    {
      const { map, layer } = make(10, 6, () => 0, true);
      layer.setCollision([1]);
      const m = box(30, 40); m.body.setVelocityX(100);
      const col = scene.physics.add.collider(m, layer);
      layer.putTileAt(1, 5, 2);
      frames(60);
      out.gpu = { type: layer.constructor.name, isTilemap: layer.isTilemap, bodyX: Math.round(m.body.x) };
      col.destroy(); m.destroy(); map.destroy();
    }

    // 3. Runtime putTileAt: which collision setters register an index for later edits.
    {
      const { map, layer } = make(10, 6, (q, r) => (r === 5 ? 1 : -1), false);
      layer.getTileAt(3, 5).properties = { solid: true };
      layer.setCollisionByProperty({ solid: true });
      const afterProperty = { collideIndexes: [...layer.layer.collideIndexes], placed: layer.putTileAt(1, 3, 2).collides };
      layer.setCollision([1]);
      const afterIndex = { collideIndexes: [...layer.layer.collideIndexes], placed: layer.putTileAt(1, 4, 2).collides };
      out.putTileAt = { afterProperty, afterIndex };
      map.destroy();
      const ex = make(10, 6, (q, r) => (r === 5 ? 1 : -1), false);
      ex.layer.setCollisionByExclusion([-1]);
      out.exclusion = { collideIndexes: [...ex.layer.layer.collideIndexes], newIndexPlaced: ex.layer.putTileAt(2, 3, 2).collides };
      ex.map.destroy();
    }

    // 3b. The edit that works for property-driven maps: set the tile's own collision and recompute nearby faces.
    {
      const { map, layer } = make(10, 6, (q, r) => (r === 5 ? 1 : -1), false);
      layer.getTileAt(3, 5).properties = { solid: true };
      layer.setCollisionByProperty({ solid: true });
      const put = layer.putTileAt(1, 5, 2, false);
      put.setCollision(true, true, true, true, false);
      layer.calculateFacesWithin(4, 1, 3, 3);
      const m = box(30, 40); m.body.setVelocityX(100);
      const col = scene.physics.add.collider(m, layer);
      frames(60);
      out.safeEdit = { collides: put.collides, faceLeft: put.faceLeft, bodyX: Math.round(m.body.x) };
      col.destroy(); m.destroy(); map.destroy();
    }

    // 3c. A tile collision callback that returns true cancels the collision.
    {
      const { map, layer } = make(10, 6, (q) => (q === 5 ? 1 : -1), false);
      layer.setCollision([1]);
      let calls = 0;
      layer.setTileIndexCallback([1], () => { calls++; return true; }, scene);
      const m = box(30, 40); m.body.setVelocityX(100);
      const col = scene.physics.add.collider(m, layer);
      frames(60);
      out.callbackCancels = { calls: calls > 0, bodyX: Math.round(m.body.x) };
      col.destroy(); m.destroy(); map.destroy();
    }

    // 4. Layers inside a container, and a collision-only layer placed where the chunk is.
    {
      const { map, layer } = make(10, 6, (q) => (q === 5 ? 1 : -1), false);
      layer.setCollision([1]);
      const container = scene.add.container(1000, 0, [layer]);
      const m = box(40, 40); m.body.setVelocityX(100);
      const col = scene.physics.add.collider(m, layer);
      frames(60);
      out.inContainer = { bodyX: Math.round(m.body.x), layerLocalStop: 66, containerWorldStop: 1066 };
      col.destroy(); m.destroy(); container.destroy(); map.destroy();
      const far = make(10, 6, (q) => (q === 5 ? 1 : -1), false, 1000, 0);
      far.layer.setCollision([1]); far.layer.setVisible(false);
      const m2 = box(1040, 40); m2.body.setVelocityX(100);
      const col2 = scene.physics.add.collider(m2, far.layer);
      frames(60);
      out.hiddenAtOffset = { bodyX: Math.round(m2.body.x) };
      col2.destroy(); m2.destroy(); far.map.destroy();
    }

    // 5. A live collider on a destroyed layer throws on the next step.
    {
      const { map, layer } = make(10, 6, (q) => (q === 5 ? 1 : -1), false);
      layer.setCollision([1]);
      const m = box(30, 40); const col = scene.physics.add.collider(m, layer);
      layer.destroy();
      let message = null; try { frames(1); } catch (e) { message = String(e.message); }
      out.destroyedLayer = message;
      col.destroy(); m.destroy(); map.destroy();
    }

    // 6. Overlap with a layer fires for every tile in reach, including empty ones.
    {
      const { map, layer } = make(10, 6, (q, r) => (r === 5 ? 1 : -1), false);
      layer.setCollision([1]);
      const m = box(48, 40);
      const seen = []; const col = scene.physics.add.overlap(m, layer, (s, tile) => seen.push(tile.index));
      frames(2);
      out.overlapEmpty = { callbacks: seen.length, indices: [...new Set(seen)] };
      col.destroy(); m.destroy(); map.destroy();
    }

    // 7. Seams: collideTiles treats every face as solid; the layer collider does not.
    {
      world.gravity.y = 600;
      for (const mode of ['layer', 'collideTiles']) {
        const { map, layer } = make(30, 6, (q, r) => (r === 4 ? 1 : -1), false);
        layer.setCollision([1]);
        const m = box(20, 40); m.body.setVelocityX(120);
        const col = mode === 'layer' ? scene.physics.add.collider(m, layer) : null;
        for (let i = 0; i < 120; i++) {
          if (!col) world.collideTiles(m, layer.getTilesWithin(0, 0, 30, 6, { isColliding: true }));
          frames(1);
        }
        out['seam_' + mode] = { x: Math.round(m.body.x), vx: Math.round(m.body.velocity.x) };
        if (col) col.destroy(); m.destroy(); map.destroy();
      }
      // 8. One-way tiles: only the top face collides.
      const { map, layer } = make(10, 8, (q, r) => (r === 4 ? 1 : -1), false);
      layer.setCollision([1]);
      layer.forEachTile((t) => { if (t.index === 1) t.setCollision(false, false, true, false); });
      const up = box(40, 120); up.body.setVelocityY(-420);
      const down = box(100, 20);
      const col = scene.physics.add.collider([up, down], layer);
      frames(25); const mid = up.body.y; frames(120);
      out.oneWayTiles = { risingMid: Math.round(mid), risingEnd: Math.round(up.body.y), fallingEnd: Math.round(down.body.y) };
      col.destroy(); up.destroy(); down.destroy(); map.destroy();
      world.gravity.y = 0;
    }
    return out;
  });

  if (process.env.PROBE_VERBOSE) console.log(JSON.stringify(result));
  eq(result.worldBoundsWidth, 640, 'world bounds default to the game size, not the map size');
  eq(result.tileBias.v600, 0, 'a 10 px step stops at a three-tile wall');
  ok(result.tileBias.v2400 > 0, 'a 40 px step passes through the wall for some start phases at the default tileBias 16');
  eq(result.tileBias.v2400bias64, 0, 'tileBias at or above the step removes it');
  eq(result.gpu, { type: 'TilemapGPULayer', isTilemap: true, bodyX: 66 }, 'a GPU layer collides, and a putTileAt edit collides without regenerating');
  eq(result.putTileAt.afterProperty, { collideIndexes: [], placed: false }, 'setCollisionByProperty registers no index, so a placed tile is not solid');
  eq(result.putTileAt.afterIndex, { collideIndexes: [1], placed: true }, 'setCollision([1]) registers the index, so a placed tile is solid');
  eq(result.exclusion, { collideIndexes: [1], newIndexPlaced: false }, 'setCollisionByExclusion registers only indexes present at call time');
  eq(result.safeEdit, { collides: true, faceLeft: true, bodyX: 66 }, 'tile.setCollision plus calculateFacesWithin makes a placed tile solid on a property-driven map');
  eq(result.callbackCancels.calls && result.callbackCancels.bodyX > 100, true, 'a tile callback that returns true cancels the collision');
  eq(result.inContainer.bodyX, 66, 'collision uses the layer position, not its container');
  eq(result.hiddenAtOffset.bodyX, 1066, 'a hidden layer at the real offset collides there');
  ok(/tileWidth/.test(result.destroyedLayer ?? ''), 'a collider on a destroyed layer throws');
  eq(result.overlapEmpty.indices, [-1], 'overlap fires for empty tiles');
  ok(result.overlapEmpty.callbacks > 0, 'overlap callbacks arrive without a solid tile in reach');
  ok(result.seam_layer.vx === 120 && result.seam_collideTiles.vx === 0, 'collideTiles snags on a seam that the layer collider slides over');
  ok(result.oneWayTiles.risingMid < 60 && result.oneWayTiles.risingEnd === 50 && result.oneWayTiles.fallingEnd === 50, 'a tile solid only on top is a one-way platform');
  eq(errors, [], 'no page errors');
  console.log(`phaser-physics-tilemap: ${checks} checks passed`);
} finally {
  await browser.close();
}

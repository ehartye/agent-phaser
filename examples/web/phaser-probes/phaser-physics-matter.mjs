// Matter physics probe for Phaser 4.2.1: the step rate, what set30Hz() still does, velocity units, determinism,
// snapshot/restore, and tile bodies. It backs the [tested] claims in skills/phaser-physics/references/matter-physics.md.
//
// Run:      node phaser-physics-matter.mjs /absolute/path/to/host-project
// Needs:    Phaser 4.2.1 and @playwright/test in the host project; Playwright's Chromium (or CHROME_CHANNEL=chrome).
// WebGL:    the tile-body check builds a TilemapGPULayer, so the game uses WebGL. Software WebGL is enough: nothing here
//           reads a pixel, and it says nothing about GPU correctness or speed. Frames are stepped by hand with game.step().
// Expected: one line, "phaser-physics-matter: N checks passed", and exit code 0. PROBE_VERBOSE=1 prints every measurement.
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
    const boot = (matter) => new Promise((done) => {
      const game = new Phaser.Game({
        type: Phaser.WEBGL, width: 640, height: 480, audio: { noAudio: true }, banner: false, parent: 'g',
        physics: { default: 'matter', matter: { gravity: { y: 1 }, ...matter } },
        scene: { create() { this.textures.addCanvas('tiles', sheet); done({ game, scene: this }); } },
      });
    });
    const clock = { t: 1000 };
    const r = (v) => Math.round(v * 1e6) / 1e6;

    // 1. Engine updates in two seconds of frames, for different frame rates and settings.
    const updates = async (matter, dts, after) => {
      const { game, scene } = await boot(matter);
      game.loop.sleep();
      after?.(scene);
      let n = 0; scene.matter.world.on('beforeupdate', () => n++);
      for (let elapsed = 0, i = 0; elapsed < 2000; i++) { const dt = dts[i % dts.length]; elapsed += dt; clock.t += dt; game.step(clock.t, dt); }
      game.destroy(true);
      return n;
    };
    out.rate = {
      hz60: await updates({}, [1000 / 60]), hz120: await updates({}, [1000 / 120]), hz30: await updates({}, [1000 / 30]),
      jitter: await updates({}, [10, 23, 12, 21]),
      set30Hz: await updates({}, [1000 / 60], (s) => s.matter.set30Hz()),
      runner30: await updates({ runner: { fps: 30 } }, [1000 / 60]),
      runner120: await updates({ runner: { fps: 120 } }, [1000 / 60]),
      frames100ms: await updates({}, [100]),
    };

    // 2. Velocity is per base step (16.67 ms): a longer engine step moves the body farther.
    {
      const { game, scene } = await boot({ gravity: { y: 0 }, autoUpdate: false });
      const b = scene.matter.add.rectangle(100, 100, 10, 10, { frictionAir: 0 });
      scene.matter.body.setVelocity(b, { x: 6, y: 0 });
      scene.matter.world.step(1000 / 60); const a = b.position.x - 100;
      scene.matter.world.step(1000 / 30); const c = b.position.x - 100 - a;
      out.velocityUnits = { at60: r(a), at30: r(c) };
      game.destroy(true);
    }

    // 3. Determinism and snapshot/restore into a fresh world.
    const world = async (initial) => {
      const { game, scene } = await boot({ autoUpdate: false });
      const m = scene.matter;
      m.add.rectangle(200, 380, 400, 20, { isStatic: true });
      const bodies = [];
      for (let i = 0; i < 6; i++) bodies.push(m.add.rectangle(150 + (i % 3) * 22, 100 - i * 24, 20, 20, { restitution: 0.1, friction: 0.5 }));
      bodies.push(m.add.circle(210, 40, 14, { restitution: 0.5 }));
      if (initial) bodies.forEach((b, i) => {
        const s = initial[i];
        m.body.setPosition(b, { x: s.x, y: s.y }, false); m.body.setAngle(b, s.a, false);
        b.positionPrev.x = s.px; b.positionPrev.y = s.py; b.anglePrev = s.pa;
        b.velocity.x = s.x - s.px; b.velocity.y = s.y - s.py; b.angularVelocity = s.a - s.pa;
      });
      const step = (n, dt = 1000 / 60) => { for (let i = 0; i < n; i++) m.world.step(dt); };
      const state = () => bodies.map((b) => ({ x: b.position.x, y: b.position.y, px: b.positionPrev.x, py: b.positionPrev.y, a: b.angle, pa: b.anglePrev }));
      return { step, state, ids: bodies.slice(0, 2).map((b) => b.id), destroy: () => game.destroy(true) };
    };
    const A = await world(); A.step(400); const straight = A.state(); const idsA = A.ids; A.destroy();
    const B = await world(); B.step(400); const again = B.state(); const idsB = B.ids; B.destroy();
    out.determinism = { sameResult: JSON.stringify(straight) === JSON.stringify(again), idsDiffer: idsA[0] !== idsB[0] };
    const C = await world(); C.step(200); const mid = C.state(); C.destroy();
    const D = await world(mid); D.step(200); const resumed = D.state(); D.destroy();
    out.snapshotDrift = Math.max(...straight.map((s, i) => Math.max(Math.abs(s.x - resumed[i].x), Math.abs(s.y - resumed[i].y))));
    out.snapshotExact = JSON.stringify(straight) === JSON.stringify(resumed);
    const E = await world(); E.step(400, 1000 / 30); out.otherDeltaDiffers = JSON.stringify(E.state()) !== JSON.stringify(straight); E.destroy();

    // 4. A small fast body tunnels through a thin static wall in Matter too: an 8 px wall, a 16 px body.
    {
      const { game, scene } = await boot({ gravity: { y: 0 }, autoUpdate: false });
      const m = scene.matter;
      const through = (speed) => {
        let n = 0;
        for (let i = 0; i < 25; i++) {
          const wall = m.add.rectangle(300, 100, 8, 200, { isStatic: true });
          const b = m.add.rectangle(100 + i * 0.5, 100, 16, 16, { frictionAir: 0, friction: 0 });
          m.body.setVelocity(b, { x: speed, y: 0 });
          for (let s = 0; s < 60; s++) m.world.step(1000 / 60);
          if (b.position.x > 310) n++;
          m.world.remove(b); m.world.remove(wall);
        }
        return n;
      };
      out.tunnel = { v8: through(8), v10: through(10), v40: through(40) };
      game.destroy(true);
    }

    // 4b. Seams: frictionless bodies sliding at 6 px per step over 80 adjacent 16 px static rectangles (what tile bodies are)
    // against one merged rectangle, from 8 start phases. Speed is read after 120 steps.
    {
      const slide = {};
      for (const mode of ['seams', 'merged']) {
        const { game, scene } = await boot({ autoUpdate: false });
        const m = scene.matter;
        if (mode === 'seams') for (let i = 0; i < 80; i++) m.add.rectangle(i * 16 + 8, 88, 16, 16, { isStatic: true });
        else m.add.rectangle(640, 88, 1280, 16, { isStatic: true });
        const free = { friction: 0, frictionAir: 0, frictionStatic: 0 };
        for (const shape of ['box', 'circle']) {
          const speeds = [];
          for (let phase = 0; phase < 16; phase += 2) {
            const body = shape === 'box' ? m.add.rectangle(30 + phase, 70, 14, 14, free) : m.add.circle(30 + phase, 70, 7, free);
            m.body.setVelocity(body, { x: 6, y: 0 });
            for (let i = 0; i < 120; i++) m.world.step(1000 / 60);
            speeds.push(Math.round(body.velocity.x * 10) / 10);
            m.world.remove(body);
          }
          (slide[mode] ??= {})[shape] = speeds;
        }
        game.destroy(true);
      }
      out.seams = slide;
    }

    // 5. One static body per colliding tile, also for a GPU layer.
    {
      const { game, scene } = await boot({ autoUpdate: false });
      const data = []; for (let y = 0; y < 6; y++) { const row = []; for (let x = 0; x < 40; x++) row.push(y === 5 ? 1 : 0); data.push(row); }
      const map = scene.make.tilemap({ data, tileWidth: 16, tileHeight: 16 });
      const layer = map.createLayer(0, map.addTilesetImage('tiles', 'tiles', 16, 16, 0, 0), 0, 0, true);
      layer.setCollision([1]);
      const before = scene.matter.world.getAllBodies().length;
      scene.matter.world.convertTilemapLayer(layer);
      out.tileBodies = { type: layer.constructor.name, added: scene.matter.world.getAllBodies().length - before, collidingTiles: 40 };
      game.destroy(true);
    }
    return out;
  });

  if (process.env.PROBE_VERBOSE) console.log(JSON.stringify(result));
  const near = (n, target, name) => ok(Math.abs(n - target) <= 3, `${name}: ${n} updates, expected about ${target}`);
  near(result.rate.hz60, 120, 'default at 60 Hz frames'); near(result.rate.hz120, 120, 'default at 120 Hz frames');
  near(result.rate.hz30, 120, 'default at 30 Hz frames'); near(result.rate.jitter, 120, 'default with jittery frames');
  near(result.rate.set30Hz, 120, 'set30Hz() leaves the rate at 60 a second');
  near(result.rate.runner30, 60, 'runner.fps 30'); near(result.rate.runner120, 240, 'runner.fps 120');
  ok(result.rate.frames100ms <= 21, 'a 100 ms frame advances about one engine step, not six');
  eq(result.velocityUnits, { at60: 6, at30: 12 }, 'velocity is per base step: the same velocity moves twice as far in a 33 ms engine step');
  eq(result.determinism, { sameResult: true, idsDiffer: true }, 'the same scene gives the same result even when body ids differ');
  ok(result.snapshotDrift > 0 && result.snapshotDrift < 2 && !result.snapshotExact, 'a fresh world restored from positions and previous positions drifts a little: not bit-exact');
  ok(result.otherDeltaDiffers, 'a different engine step size gives a different result');
  eq(result.tunnel.v8, 0, 'an 8 px step stops at a thin wall');
  ok(result.tunnel.v10 > 0 && result.tunnel.v40 > 0, 'Matter tunnels from about 10 px per step, below the 12 px that Arcade allows for the same shapes');
  eq(result.tileBodies, { type: 'TilemapGPULayer', added: 40, collidingTiles: 40 }, 'convertTilemapLayer adds one body per colliding tile');
  ok(result.seams.merged.box.every((v) => v >= 5.9) && result.seams.merged.circle.every((v) => v >= 5.9), 'on one merged rectangle both shapes keep their speed in every phase');
  ok(result.seams.seams.box.filter((v) => v < 2).length >= 6, 'a frictionless box nearly stops on adjacent tile rectangles in most phases');
  ok(result.seams.seams.circle.every((v) => v < 4.5), 'a frictionless circle slows in every phase');
  eq(errors, [], 'no page errors');
  console.log(`phaser-physics-matter: ${checks} checks passed`);
} finally {
  await browser.close();
}

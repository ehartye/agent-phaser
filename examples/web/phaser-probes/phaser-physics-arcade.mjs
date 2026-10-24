// Arcade Physics probe for Phaser 4.2.1: stepping, tunnelling, body size and offset, pooling, moving platforms,
// determinism and snapshot/restore. It backs the [tested] claims in skills/phaser-physics/references/arcade-bodies-and-colliders.md
// and testing-physics.md.
//
// Run:      node phaser-physics-arcade.mjs /absolute/path/to/host-project
// Needs:    Phaser 4.2.1 and @playwright/test in the host project; Playwright's Chromium (or CHROME_CHANNEL=chrome).
// No GPU:   the game uses Phaser.HEADLESS (no renderer), so software rendering is irrelevant. Frames are driven by hand with
//           game.headlessStep(time, delta); game.step() throws without a renderer.
// Expected: one line, "phaser-physics-arcade: N checks passed", and exit code 0. Any failed check throws with its name.
//           PROBE_VERBOSE=1 also prints every measured value as JSON.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || undefined });
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
    const boot = (arcade) => new Promise((done) => {
      const game = new Phaser.Game({
        type: Phaser.HEADLESS, width: 800, height: 600, audio: { noAudio: true }, banner: false, parent: 'g',
        physics: { default: 'arcade', arcade },
        scene: { create() { this.textures.addCanvas('box', Object.assign(document.createElement('canvas'), { width: 32, height: 32 })); done({ game, scene: this }); } },
      });
    });
    const clock = { t: 1000 };
    const frames = (game, n, dt = 1000 / 60) => { for (let i = 0; i < n; i++) { clock.t += dt; game.headlessStep(clock.t, dt); } };
    const r = (v) => Math.round(v * 1000) / 1000;

    // 1. Steps per frame at different frame rates, timeScale, fps.
    {
      const { game, scene } = await boot({ gravity: { y: 0 } });
      game.loop.sleep();
      const w = scene.physics.world, b = scene.physics.add.sprite(100, 100, 'box');
      let steps = 0; w.on('worldstep', () => steps++);
      const run = (n, dt) => { steps = 0; b.body.reset(100, 100); b.setVelocityX(60); frames(game, n, dt); return { steps, x: r(b.x) }; };
      out.rate60 = run(60, 1000 / 60);
      out.rate30 = run(30, 1000 / 30);
      out.rate120 = run(120, 1000 / 120);
      w.timeScale = 2; out.timeScale2 = run(60, 1000 / 60); w.timeScale = 1;
      w.setFPS(120); out.fps120 = run(60, 1000 / 60); w.setFPS(60);
      steps = 0; b.body.reset(100, 100); b.setVelocityX(60); w._elapsed = 0; frames(game, 1, 2000);
      out.oneBigFrame = { steps };
      // 144 Hz display with 60 Hz physics
      b.body.reset(100, 100); w._elapsed = 0;
      const pattern = []; for (let i = 0; i < 144; i++) { steps = 0; frames(game, 1, 1000 / 144); pattern.push(steps); }
      out.hz144 = { total: pattern.reduce((a, c) => a + c, 0), zeroFrames: pattern.filter((n) => n === 0).length, oneFrames: pattern.filter((n) => n === 1).length };
      game.destroy(true);
    }

    // 2. Driving the step yourself.
    {
      const { game, scene } = await boot({ gravity: { y: 0 }, customUpdate: true });
      game.loop.sleep();
      const w = scene.physics.world, b = scene.physics.add.sprite(100, 100, 'box');
      b.setVelocityX(60);
      frames(game, 10);
      out.customUpdateIdle = b.x;
      for (let i = 0; i < 6; i++) w.singleStep();
      out.singleStep6 = r(b.x);
      w.pause(); w.singleStep(); out.pausedSingleStep = r(b.x); w.resume();
      b.body.reset(100, 100); b.setVelocityX(60);
      w.update(0, 1000 / 60); w.update(0, 1000 / 60); w.update(0, 1000 / 60); w.postUpdate();
      out.updateThrice = r(b.x);
      b.body.reset(100, 100); b.setVelocityX(60);
      w.singleStep(); w.singleStep(); w.singleStep();
      out.singleStepThrice = r(b.x);
      b.body.reset(100, 100); b.setVelocityX(60);
      w.step(1 / 60); w.step(1 / 60); w.postUpdate();
      out.stepTwicePost = r(b.x);
      game.destroy(true);
    }

    // 2b. Ground flags after a jump: singleStep() clears them, bare world.step() leaves them stale.
    for (const mode of ['singleStep', 'step']) {
      const { game, scene } = await boot({ gravity: { y: 600 }, customUpdate: true });
      game.loop.sleep();
      const w = scene.physics.world;
      const floor = scene.add.rectangle(100, 200, 200, 20); scene.physics.add.existing(floor, true);
      const b = scene.add.rectangle(100, 180, 14, 14); scene.physics.add.existing(b);
      scene.physics.add.collider(b, floor);
      const advance = (n) => { for (let i = 0; i < n; i++) { if (mode === 'singleStep') w.singleStep(); else { w.step(1 / 60); w.postUpdate(); } } };
      if (mode === 'step') { w.update(0, 1000 / 60); w.postUpdate(); }
      advance(30);
      b.body.setVelocityY(-400); advance(5);
      (out.flags ??= {})[mode] = { airborne: b.body.y < 150, blockedDown: b.body.blocked.down };
      game.destroy(true);
    }

    // 3. Tunnelling against a static wall: thin wall, 16 px body. Phase matters, so scan start positions.
    {
      const { game, scene } = await boot({ gravity: { y: 0 } });
      game.loop.sleep();
      const count = (speed, cap) => {
        let through = 0;
        for (let i = 0; i < 25; i++) {
          const wall = scene.add.rectangle(304, 100, 8, 200); scene.physics.add.existing(wall, true);
          const m = scene.add.rectangle(108 + i * 0.5, 100, 16, 16); scene.physics.add.existing(m);
          if (cap) m.body.setMaxVelocity(cap, cap);
          m.body.setVelocityX(speed);
          const col = scene.physics.add.collider(m, wall);
          frames(game, 60);
          if (m.body.x > 307) through++;
          col.destroy(); m.destroy(); wall.destroy();
        }
        return through;
      };
      out.tunnel = { v600: count(600), v700: count(700), v1200: count(1200), v3000: count(3000), v3000capped700: count(3000, 700) };
      game.destroy(true);
    }

    // 4. Body size, offset, scale, flip.
    {
      const { game, scene } = await boot({ gravity: { y: 0 } });
      game.loop.sleep();
      const s = scene.physics.add.sprite(200, 200, 'box');
      const box = () => [r(s.body.x), r(s.body.y), r(s.body.width), r(s.body.height)];
      frames(game, 1); out.size32 = box();
      s.setScale(2); frames(game, 1); out.scaled2 = box();
      s.setBodySize(16, 16); frames(game, 1); out.scaled2Body16 = { box: box(), offset: [s.body.offset.x, s.body.offset.y] };
      s.setScale(1); s.body.setOffset(0, 8); frames(game, 1); const before = box();
      s.setFlipX(true); frames(game, 1); out.flipX = { before, after: box() };
      s.setFlipX(false); s.body.setOffset(8, 8); frames(game, 1); const centred = box();
      s.setScale(-1, 1); frames(game, 1); out.negativeScale = { centred, mirrored: box(), spriteX: s.x };
      const s2 = scene.physics.add.sprite(300, 300, 'box'); s2.setSize(10, 10);
      out.spriteSetSize = { spriteWidth: s2.width, bodyWidth: s2.body.width };
      game.destroy(true);
    }

    // 5. Pooling.
    {
      const { game, scene } = await boot({ gravity: { y: 0 } });
      game.loop.sleep();
      const group = scene.physics.add.group({ allowGravity: false });
      const bullet = group.create(500, 100, 'box');
      const target = scene.physics.add.sprite(500, 100, 'box'); target.body.setAllowGravity(false);
      let hits = 0; scene.physics.add.overlap(group, target, () => { hits++; });
      group.killAndHide(bullet); hits = 0; frames(game, 2);
      out.killAndHide = { bodyEnabled: bullet.body.enable, active: bullet.active, overlapFired: hits > 0 };
      bullet.disableBody(true, true); hits = 0; frames(game, 2);
      out.disableBody = { bodyEnabled: bullet.body.enable, overlapFired: hits > 0 };
      const again = group.get(500, 100, 'box'); again.enableBody(true, 600, 100, true, true);
      out.reused = { same: again === bullet, x: again.x, bodyEnabled: again.body.enable, active: again.active };
      game.destroy(true);
    }

    // 6. Moving platform: velocity-driven, position written from outside, and directControl.
    {
      const run = async (mode) => {
        const { game, scene } = await boot({ gravity: { y: 600 }, customUpdate: true });
        game.loop.sleep();
        const plat = scene.add.rectangle(200, 300, 120, 16); scene.physics.add.existing(plat);
        plat.body.setImmovable(true).setAllowGravity(false);
        const rider = scene.add.rectangle(200, 280, 16, 16); scene.physics.add.existing(rider);
        scene.physics.add.collider(rider, plat);
        if (mode === 'velocity') plat.body.setVelocityX(60);
        if (mode === 'direct') plat.body.setDirectControl(true);
        for (let i = 0; i < 120; i++) {
          if (mode !== 'velocity') plat.x = 200 + i + 1;
          scene.physics.world.singleStep();
        }
        const res = { platX: r(plat.x), riderX: r(rider.x), riderY: r(rider.y), onPlatform: rider.body.blocked.down };
        game.destroy(true);
        return res;
      };
      out.platform = { velocity: await run('velocity'), external: await run('external'), direct: await run('direct') };
    }

    // 7. Determinism and snapshot/restore.
    {
      const sim = async (stepsA, stepsB, wreck) => {
        const { game, scene } = await boot({ gravity: { y: 500 }, customUpdate: true });
        game.loop.sleep();
        const w = scene.physics.world; w.setBounds(0, 0, 400, 300);
        const walls = scene.physics.add.staticGroup();
        for (const [x, y, ww, hh] of [[200, 200, 120, 12], [80, 120, 60, 12]]) { const rect = scene.add.rectangle(x, y, ww, hh); scene.physics.add.existing(rect, true); walls.add(rect); }
        const balls = [];
        for (const [x, y, vx, vy] of [[60, 20, 90, 0], [300, 40, -120, 30], [200, 10, 20, 0]]) {
          const b = scene.add.rectangle(x, y, 14, 14); scene.physics.add.existing(b);
          b.body.setBounce(0.8).setCollideWorldBounds(true).setVelocity(vx, vy); balls.push(b);
        }
        scene.physics.add.collider(balls, walls); scene.physics.add.collider(balls, balls);
        const snap = () => balls.map((b) => [b.body.position.x, b.body.position.y, b.body.velocity.x, b.body.velocity.y]);
        const go = (n) => { for (let i = 0; i < n; i++) w.singleStep(); };
        go(stepsA);
        const saved = snap();
        if (wreck) {
          balls.forEach((b) => b.body.reset(0, 0)); go(7);
          balls.forEach((b, i) => { b.body.reset(saved[i][0] + b.body.halfWidth, saved[i][1] + b.body.halfHeight); b.body.setVelocity(saved[i][2], saved[i][3]); });
        }
        go(stepsB);
        const end = JSON.stringify(snap());
        game.destroy(true);
        return end;
      };
      const straight = await sim(0, 600, false);
      out.determinism = {
        rerun: straight === await sim(0, 600, false),
        split: straight === await sim(300, 300, false),
        restoredFromPlainNumbers: straight === await sim(300, 300, true),
      };
    }

    // 8. One-way platform from checkCollision flags on a static body.
    {
      const { game, scene } = await boot({ gravity: { y: 600 } });
      game.loop.sleep();
      const plat = scene.add.rectangle(100, 200, 100, 10); scene.physics.add.existing(plat, true);
      Object.assign(plat.body.checkCollision, { down: false, left: false, right: false });
      const up = scene.add.rectangle(100, 260, 14, 14); scene.physics.add.existing(up); up.body.setVelocityY(-450);
      const down = scene.add.rectangle(140, 100, 14, 14); scene.physics.add.existing(down);
      scene.physics.add.collider([up, down], plat);
      frames(game, 40); const mid = up.body.y; frames(game, 120);
      out.oneWay = { risingMid: Math.round(mid), risingEnd: Math.round(up.body.y), fallingEnd: Math.round(down.body.y), platformTop: 195 };
      game.destroy(true);
    }

    // 9a. Area queries need no body or collider.
    {
      const { game, scene } = await boot({ gravity: { y: 0 } });
      game.loop.sleep();
      const a = scene.add.rectangle(100, 100, 16, 16); scene.physics.add.existing(a);
      const b = scene.add.rectangle(120, 100, 16, 16); scene.physics.add.existing(b);
      const wall = scene.add.rectangle(100, 130, 40, 8); scene.physics.add.existing(wall, true);
      frames(game, 1);
      const before = scene.physics.world.bodies.size + scene.physics.world.staticBodies.size;
      out.query = {
        rectDefault: scene.physics.overlapRect(90, 90, 40, 50).length,
        rectWithStatic: scene.physics.overlapRect(90, 90, 40, 50, true, true).length,
        circ: scene.physics.overlapCirc(100, 100, 10).length,
        createsBodies: scene.physics.world.bodies.size + scene.physics.world.staticBodies.size !== before,
      };
      game.destroy(true);
    }

    // 9b. Bodies on container children: right for a translated parent, distorted for a scaled or rotated one.
    {
      const { game, scene } = await boot({ gravity: { y: 0 } });
      game.loop.sleep();
      out.container = {};
      for (const [label, scale, rotation] of [['translated', 1, 0], ['scaled2', 2, 0], ['rotated90', 1, Math.PI / 2]]) {
        const rect = scene.add.rectangle(16, 16, 32, 32);
        const container = scene.add.container(300, 200, [rect]).setScale(scale).setRotation(rotation);
        scene.physics.add.existing(rect); rect.body.setVelocity(60, 0);
        frames(game, 1);
        const start = [Math.round(rect.body.x), Math.round(rect.body.y)];
        const m0 = rect.getWorldTransformMatrix(), x0 = m0.tx, y0 = m0.ty;
        frames(game, 59);
        const m1 = rect.getWorldTransformMatrix();
        out.container[label] = { bodyStart: start, worldMoved: [Math.round(m1.tx - x0), Math.round(m1.ty - y0)] };
        rect.destroy(); container.destroy();
      }
      game.destroy(true);
    }

    // 9. Default speed cap and a body spawned inside a wall.
    {
      const { game, scene } = await boot({ gravity: { y: 2000 } });
      game.loop.sleep();
      const b = scene.physics.add.sprite(100, 100, 'box'); frames(game, 120);
      out.maxVelocity = { vy: Math.round(b.body.velocity.y), cap: b.body.maxVelocity.y };
      game.destroy(true);
      const g2 = await boot({ gravity: { y: 0 } }); g2.game.loop.sleep();
      const wall = g2.scene.add.rectangle(100, 100, 100, 100); g2.scene.physics.add.existing(wall, true);
      const inside = g2.scene.add.rectangle(100, 100, 16, 16); g2.scene.physics.add.existing(inside); inside.body.setVelocityX(10);
      g2.scene.physics.add.collider(inside, wall); frames(g2.game, 30);
      out.spawnedInside = { moved: r(inside.body.x - 92), embedded: inside.body.embedded };
      g2.game.destroy(true);
    }
    return out;
  });

  if (process.env.PROBE_VERBOSE) console.log(JSON.stringify(result));
  eq([result.rate60.steps, result.rate30.steps, result.rate120.steps], [60, 60, 60], 'one second of frames at 60, 30 or 120 Hz runs 60 steps');
  eq([result.rate60.x, result.rate30.x, result.rate120.x, result.fps120.x], [160, 160, 160, 160], 'velocity is px per second at any fps');
  eq(result.timeScale2.steps, 30, 'timeScale 2 halves the step rate');
  ok(result.oneBigFrame.steps >= 119, 'a 2000 ms frame runs about 120 steps: Arcade has no catch-up cap of its own');
  eq(result.hz144.total >= 59 && result.hz144.total <= 61, true, '144 Hz frames still give 60 steps a second');
  ok(result.hz144.zeroFrames > 50 && result.hz144.oneFrames > 50, 'on a 144 Hz display most frames are either a step or no step, so motion is uneven');
  eq(result.customUpdateIdle, 100, 'customUpdate stops the automatic step');
  eq([result.singleStep6, result.pausedSingleStep], [106, 106], 'singleStep is exactly one step, and does nothing while paused');
  eq([result.updateThrice, result.singleStepThrice, result.stepTwicePost], [101, 103, 102], 'update() x3 then postUpdate() keeps one step; singleStep() x3 keeps three');
  eq(result.flags, { singleStep: { airborne: true, blockedDown: false }, step: { airborne: true, blockedDown: true } }, 'bare world.step() leaves blocked.down true while rising; singleStep() clears it');
  eq([result.tunnel.v600, result.tunnel.v700], [0, 0], 'step <= half of body + wall (12 px) never tunnels');
  ok(result.tunnel.v1200 > 0 && result.tunnel.v3000 > 0, 'faster steps tunnel for some start phases');
  eq(result.tunnel.v3000capped700, 0, 'setMaxVelocity at the safe speed removes tunnelling');
  eq(result.size32, [184, 184, 32, 32], 'default body is the frame size, centred on the origin');
  eq(result.scaled2, [168, 168, 64, 64], 'default body follows the scale');
  eq(result.scaled2Body16, { box: [184, 184, 32, 32], offset: [8, 8] }, 'setBodySize is in source pixels and is scaled; offset is in source pixels');
  eq(result.flipX.after, result.flipX.before, 'flipX does not move the body');
  ok(result.negativeScale.mirrored[0] !== result.negativeScale.centred[0], 'a negative scale shifts a centred body');
  eq(result.spriteSetSize, { spriteWidth: 32, bodyWidth: 10 }, 'sprite.setSize resizes the Arcade body, not the sprite');
  eq(result.killAndHide, { bodyEnabled: true, active: false, overlapFired: true }, 'killAndHide leaves the body live');
  eq(result.disableBody, { bodyEnabled: false, overlapFired: false }, 'disableBody removes it from collision');
  eq(result.reused, { same: true, x: 600, bodyEnabled: true, active: true }, 'group.get reuses the dead one and enableBody revives it');
  ok(result.platform.velocity.onPlatform && result.platform.velocity.riderX > 300, 'velocity-driven platform carries its rider');
  ok(!result.platform.external.onPlatform && result.platform.external.riderX < 250, 'a platform moved by writing x does not carry its rider');
  ok(result.platform.direct.onPlatform && result.platform.direct.riderX > 300, 'setDirectControl lets a written-position platform carry its rider');
  eq(result.determinism, { rerun: true, split: true, restoredFromPlainNumbers: true }, 'same inputs give the same bodies, and positions plus velocities restore exactly');
  ok(result.oneWay.risingMid < 195 && result.oneWay.risingEnd === 181 && result.oneWay.fallingEnd === 181, 'checkCollision flags make a one-way platform');
  eq([result.container.translated.bodyStart, result.container.translated.worldMoved.map((v) => Math.abs(v - 59) <= 1 ? 59 : v)], [[301, 200], [59, 0]], 'a body on a child of a translated container sits at the child world position and moves at its own speed');
  ok(result.container.scaled2.worldMoved[0] > 100, 'under a container scaled 2 the child moves about twice as far as its body');
  eq(result.container.rotated90.worldMoved[0], 0, 'under a container rotated 90 degrees the child moves along the wrong axis');
  eq(result.query, { rectDefault: 2, rectWithStatic: 3, circ: 1, createsBodies: false }, 'overlapRect and overlapCirc query bodies without making any, and skip static bodies unless asked');
  eq(result.maxVelocity, { vy: 4000, cap: 10000 }, 'the default speed cap is 10000 px/s per axis');
  ok(result.spawnedInside.embedded && result.spawnedInside.moved === 5, 'a body spawned deep inside a wall is not ejected');
  eq(errors, [], 'no page errors');
  console.log(`phaser-physics-arcade: ${checks} checks passed`);
} finally {
  await browser.close();
}

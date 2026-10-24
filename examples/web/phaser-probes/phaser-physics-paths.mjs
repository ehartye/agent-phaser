// Curves, Path and PathFollower probe for Phaser 4.2.1: arc-length spacing, null and stale-length traps, the follower's
// wall-clock tween, and a path-driven platform that carries a rider. It backs the [tested] claims in
// skills/phaser-physics/references/paths-and-followers.md and testing-physics.md.
//
// Run:      node phaser-physics-paths.mjs /absolute/path/to/host-project
// Needs:    Phaser 4.2.1 and @playwright/test in the host project; Playwright's Chromium (or CHROME_CHANNEL=chrome).
// No GPU:   the game uses Phaser.HEADLESS (no renderer). Frames are driven by hand with game.headlessStep(time, delta).
// Expected: one line, "phaser-physics-paths: N checks passed", and exit code 0. PROBE_VERBOSE=1 prints every measurement.
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
    const boot = (gravityY = 0) => new Promise((done) => {
      const game = new Phaser.Game({
        type: Phaser.HEADLESS, width: 800, height: 600, audio: { noAudio: true }, banner: false, parent: 'g',
        physics: { default: 'arcade', arcade: { gravity: { y: gravityY } } },
        scene: { create() { this.textures.addCanvas('box', Object.assign(document.createElement('canvas'), { width: 16, height: 16 })); done({ game, scene: this }); } },
      });
    });
    const r = (v) => Math.round(v * 100) / 100;
    const { game, scene } = await boot();
    game.loop.sleep();
    const clock = { t: 1000 };
    const frames = (n) => { for (let i = 0; i < n; i++) { clock.t += 1000 / 60; game.headlessStep(clock.t, 1000 / 60); } };

    // 1. Spacing and edge cases of Path.getPoint.
    const path = new Phaser.Curves.Path(0, 0); path.lineTo(300, 0); path.lineTo(300, 100);
    const at = (u) => { const p = path.getPoint(u); return p && [r(p.x), r(p.y)]; };
    out.getPoint = { length: path.getLength(), q25: at(0.25), q50: at(0.5), q75: at(0.75), end: at(1), over: path.getPoint(1.0000001), isVector2: path.getPoint(0.5) instanceof Phaser.Math.Vector2, hasPointClass: typeof Phaser.Geom.Point };
    out.emptyPath = new Phaser.Curves.Path(0, 0).getPoint(0.5);
    const spline = new Phaser.Curves.Spline([0, 0, 10, 0, 20, 0, 300, 0]);
    const spread = (fn) => { const xs = []; for (let i = 0; i <= 8; i++) xs.push(fn(i / 8).x); const d = xs.slice(1).map((x, i) => x - xs[i]); return r(Math.max(...d) - Math.min(...d)); };
    out.splineSpread = { byT: spread((u) => spline.getPoint(u)), byLength: spread((u) => spline.getPointAt(u)) };

    // 2. Cached lengths.
    const circle = new Phaser.Curves.Ellipse(0, 0, 50, 50, 0, 360, false, 0);
    const loop = new Phaser.Curves.Path(50, 0); loop.add(circle);
    const l0 = loop.getLength();
    circle.xRadius = 100; circle.yRadius = 100;
    const stale = loop.getLength();
    circle.updateArcLengths(); loop.updateArcLengths();
    out.lengths = { before: r(l0), staleAfterEdit: r(stale), afterUpdate: r(loop.getLength()) };
    const gap = new Phaser.Curves.Path(0, 0); gap.lineTo(100, 0); gap.moveTo(500, 500); gap.lineTo(600, 500);
    out.moveToGap = { length: gap.getLength(), curves: gap.curves.length };

    // 3. A PathFollower moves on the tween manager's clock, not the stepped one.
    const f = scene.add.follower(path, 0, 0, 'box');
    f.startFollow({ duration: 1000, positionOnPath: true });
    frames(60);
    out.virtualClock = { progress: r(f.pathTween.progress), x: r(f.x) };
    const realNow = Date.now; let fake = realNow.call(Date); Date.now = () => fake;
    const f2 = scene.add.follower(path, 0, 0, 'box');
    scene.tweens.tick(); f2.startFollow({ duration: 1000, positionOnPath: true });
    for (let i = 0; i < 30; i++) { fake += 1000 / 60; frames(1); }
    const lagging = path.getPoint(f2.pathTween.getValue());
    out.stubbedClock = { progress: r(f2.pathTween.progress), x: r(f2.x), tweenPointX: r(lagging.x) };
    Date.now = realNow;
    f.destroy(); f2.destroy();
    game.destroy(true);

    // 4. A path-driven platform carries a rider only with directControl, using the same stubbed clock.
    const ride = async (direct) => {
      const g = await boot(600); g.game.loop.sleep();
      const lane = new Phaser.Curves.Path(200, 300); lane.lineTo(320, 300);
      const platform = g.scene.add.follower(lane, 200, 300, 'box');
      g.scene.physics.add.existing(platform); platform.setDisplaySize(120, 16);
      platform.body.setSize(120, 16, false).setOffset(0, 0).setImmovable(true).setAllowGravity(false);
      if (direct) platform.body.setDirectControl(true);
      const rider = g.scene.add.rectangle(200, 270, 16, 16); g.scene.physics.add.existing(rider);
      g.scene.physics.add.collider(rider, platform);
      const save = Date.now; let t = save.call(Date); Date.now = () => t;
      g.scene.tweens.tick(); platform.startFollow({ duration: 2000, positionOnPath: true });
      for (let i = 0; i < 90; i++) { t += 1000 / 60; clock.t += 1000 / 60; g.game.headlessStep(clock.t, 1000 / 60); }
      Date.now = save;
      const res = { platformX: r(platform.x), riderX: r(rider.x), onPlatform: rider.body.blocked.down };
      g.game.destroy(true);
      return res;
    };
    out.ride = { plain: await ride(false), direct: await ride(true) };

    // 5. A patrol that steers a body by velocity toward waypoints, in a hand-driven step, against moveTo.
    const patrol = async () => {
      const g = await boot(0);
      g.game.loop.sleep();
      const world = g.scene.physics.world;
      const body = g.scene.add.rectangle(100, 100, 10, 10); g.scene.physics.add.existing(body);
      const points = [[300, 100], [300, 250], [100, 250]];
      let target = 0; const reached = []; const speed = 120, stepLength = speed / 60;
      for (let i = 0; i < 600 && target < points.length; i++) {
        const dx = points[target][0] - body.x, dy = points[target][1] - body.y, d = Math.hypot(dx, dy);
        if (d <= stepLength) { reached.push(i); body.body.reset(points[target][0] - 5, points[target][1] - 5); target++; continue; }
        body.body.setVelocity((dx / d) * speed, (dy / d) * speed);
        world.singleStep();
      }
      const result = { reached, x: r(body.x), y: r(body.y) };
      g.game.destroy(true);
      return result;
    };
    const first = await patrol(), second = await patrol();
    out.patrol = { first, replays: JSON.stringify(first) === JSON.stringify(second) };
    {
      const g = await boot(0);
      g.game.loop.sleep();
      const b = g.scene.add.rectangle(100, 100, 10, 10); g.scene.physics.add.existing(b);
      g.scene.physics.moveTo(b, 300, 100, 120);
      for (let i = 0; i < 180; i++) { clock.t += 1000 / 60; g.game.headlessStep(clock.t, 1000 / 60); }
      out.moveTo = { x: r(b.x), vx: r(b.body.velocity.x) };
      g.game.destroy(true);
    }
    return out;
  });

  if (process.env.PROBE_VERBOSE) console.log(JSON.stringify(result));
  eq([result.getPoint.q25, result.getPoint.q50, result.getPoint.q75, result.getPoint.end], [[100, 0], [200, 0], [300, 0], [300, 100]], 'Path.getPoint is uniform in arc length across segments of different length');
  eq(result.getPoint.over, null, 'Path.getPoint(t > 1) returns null');
  eq(result.emptyPath, null, 'Path.getPoint on an empty path returns null');
  eq([result.getPoint.isVector2, result.getPoint.hasPointClass], [true, 'undefined'], 'points are Vector2 and Phaser.Geom.Point is gone in 4.x');
  ok(result.splineSpread.byT > 30 && result.splineSpread.byLength < 30, 'Curve.getPoint(t) is uneven on a spline while getPointAt(u) is close to even');
  eq([result.lengths.before, result.lengths.staleAfterEdit], [314.11, 314.11], 'editing a curve in place leaves the path length stale');
  ok(result.lengths.afterUpdate > 600, 'updateArcLengths on the curve and then the path refreshes it');
  eq([result.moveToGap.length, result.moveToGap.curves], [200, 3], 'a moveTo gap adds a curve but no length');
  eq(result.virtualClock, { progress: 0, x: 0 }, 'a follower does not advance on stepped frames: the tween manager reads Date.now');
  ok(result.stubbedClock.progress > 0.45 && result.stubbedClock.progress < 0.5, 'with Date.now following the stepped clock the follower advances');
  ok(result.stubbedClock.x < result.stubbedClock.tweenPointX, 'the follower sits one frame behind the tween value');
  ok(!result.ride.plain.onPlatform || result.ride.plain.riderX < result.ride.plain.platformX - 40, 'a follower platform without directControl does not carry a rider');
  ok(result.ride.direct.onPlatform && Math.abs(result.ride.direct.riderX - result.ride.direct.platformX) < 30, 'with directControl the rider stays on the follower platform');
  eq(result.patrol.first.reached.length, 3, 'steering by velocity reaches every waypoint');
  ok(result.patrol.replays, 'the patrol replays exactly with a hand-driven step');
  ok(result.moveTo.x > 320 && result.moveTo.vx === 120, 'physics.moveTo does not stop at the target');
  eq(errors, [], 'no page errors');
  console.log(`phaser-physics-paths: ${checks} checks passed`);
} finally {
  await browser.close();
}

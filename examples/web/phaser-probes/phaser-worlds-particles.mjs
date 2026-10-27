// Purpose: reproduce the particle claims in skills/phaser-worlds/references/particles.md on Phaser 4.2.1.
// Run:     node phaser-worlds-particles.mjs /absolute/path/to/host-project   (host has phaser 4.2.1 and playwright-core or @playwright/test)
// Expect:  JSON with every check ok and exit code 0. A failing check means a Phaser upgrade changed that behaviour.
// Covers:  particles live in emitter-local space, frequency 0 emits per frame, maxParticles vs maxAliveParticles,
//          scrollFactor 0 emitters stay on screen, WebGL particle quads are not vertex-rounded, the CPU cost of alive particles,
//          GravityWell defaults and space, and colorEase.
import { startProbe } from './phaser-worlds-lib.mjs';

const p = await startProbe(process.argv[2], {
  game: { pixelArt: true },
  setup: `
    const t = scene.textures.createCanvas('px', 6, 6); t.context.fillStyle = '#fff'; t.context.fillRect(0, 0, 6, 6); t.refresh();
  `,
});
const white = (px) => px[0] === 255 && px[1] === 255 && px[2] === 255;
const black = (px) => px[0] === 0 && px[1] === 0 && px[2] === 0;

// 1. Particles are in emitter-local space: moving the emitter moves every alive particle.
await p.page.evaluate(() => {
  window.em = scene.add.particles(100, 100, 'px', { speed: 0, lifespan: 100000, frequency: -1, emitting: false });
  em.explode(1);
});
await p.frames(2);
const before = { at100: await p.pixel(100, 100), at200: await p.pixel(200, 100) };
await p.page.evaluate(() => { em.setPosition(200, 100); });
await p.frames(2);
const after = { at100: await p.pixel(100, 100), at200: await p.pixel(200, 100), local: await p.page.evaluate(() => [em.alive[0].x, em.alive[0].y]) };
p.check('a particle emitted by an emitter at (100,100) is drawn at (100,100)', white(before.at100) && black(before.at200), before);
p.check('moving the emitter to (200,100) moves the already emitted particle with it', black(after.at100) && white(after.at200) && after.local[0] === 0, after);
await p.page.evaluate(() => { em.destroy(); window.em2 = scene.add.particles(0, 0, 'px', { speed: 0, lifespan: 100000, frequency: -1, emitting: false }); em2.emitParticleAt(150, 50); });
await p.frames(2);
const fixedAt = await p.pixel(150, 50);
p.check('emitParticleAt on an emitter at the origin leaves the particle in world space', white(fixedAt), fixedAt);
await p.page.evaluate(() => { em2.destroy(); });

// 2. Rates: frequency 0 emits quantity per frame; a positive frequency is time based. Drive preUpdate with a fake delta.
const rate = await p.page.evaluate(() => {
  const count = (cfg, frames, ms) => {
    const e = scene.add.particles(0, 0, 'px', Object.assign({ speed: 0, lifespan: 100000, emitting: true }, cfg));
    for (let i = 0; i < frames; i++) e.preUpdate(0, ms);
    const n = e.getAliveParticleCount(); e.destroy(); return n;
  };
  return {
    f0_60: count({ frequency: 0, quantity: 1 }, 60, 1000 / 60), f0_144: count({ frequency: 0, quantity: 1 }, 144, 1000 / 144),
    f100_60: count({ frequency: 100, quantity: 2 }, 60, 1000 / 60), f100_144: count({ frequency: 100, quantity: 2 }, 144, 1000 / 144),
  };
});
p.check('frequency 0 emits one batch per frame: 60 in a second at 60 fps, 144 at 144 fps', rate.f0_60 === 60 && rate.f0_144 === 144, rate);
p.check('frequency 100 is time based: about the same count at 60 and 144 fps', Math.abs(rate.f100_60 - rate.f100_144) <= 2 && rate.f100_60 >= 16, rate);

// 3. maxParticles is a lifetime cap on created particles; maxAliveParticles is the concurrent cap.
const caps = await p.page.evaluate(() => {
  const run = (cfg) => {
    const e = scene.add.particles(0, 0, 'px', Object.assign({ speed: 0, lifespan: 100, frequency: 10, quantity: 1 }, cfg));
    let emitted = 0; e.onParticleEmit(() => { emitted++; });
    for (let i = 0; i < 300; i++) e.preUpdate(0, 16);
    const r = { emitted, alive: e.getAliveParticleCount() }; e.destroy(); return r;
  };
  return { open: run({}), maxParticles5: run({ maxParticles: 5 }), maxAlive5: run({ maxAliveParticles: 5 }) };
});
p.check('maxParticles: 5 emits five particles in total and then never again', caps.maxParticles5.emitted === 5 && caps.maxParticles5.alive === 0, caps);
p.check('maxAliveParticles: 5 keeps emitting but never holds more than five', caps.maxAlive5.alive <= 5 && caps.maxAlive5.emitted > 50, caps);

// 4. A scrollFactor 0 emitter stays in screen space at zoom 1.
await p.page.evaluate(() => {
  window.hud = scene.add.particles(50, 50, 'px', { speed: 0, lifespan: 100000, frequency: -1, emitting: false }).setScrollFactor(0);
  hud.explode(1); scene.cameras.main.setScroll(100, 0);
});
await p.frames(3);
const sf0 = { at50: await p.pixel(50, 50), at150: await p.pixel(150, 50) };
p.check('with scrollFactor 0 and camera scroll 100 the particle is still drawn at screen (50,50)', white(sf0.at50) && black(sf0.at150), sf0);
await p.page.evaluate(() => { hud.destroy(); scene.cameras.main.setScroll(0, 0); });

// 5. The WebGL particle path does not round vertices; an Image at the same fractional position is rounded.
const round = await p.page.evaluate(async () => {
  const em = scene.add.particles(10.4, 10.4, 'px', { speed: 0, lifespan: 100000, frequency: -1, emitting: false });
  em.explode(1);
  const sub = em.defaultRenderNodes.Submitter;
  let particleQuad = null; const run = sub.run;
  sub.run = function (ctx, emitter, parentMatrix, tint, texturer, transformer) { particleQuad = Array.from(transformer.quad); return run.apply(this, arguments); };
  await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
  sub.run = run; em.destroy();
  const node = game.renderer.renderNodes.getNode('TransformerImage');
  const img = scene.add.image(10.4, 10.4, 'px').setOrigin(0);
  let imageQuad = null; const irun = node.run;
  node.run = function () { const r = irun.apply(this, arguments); imageQuad = Array.from(this.quad); return r; };
  await new Promise((r) => game.events.once(Phaser.Core.Events.POST_RENDER, r));
  node.run = irun; img.destroy();
  return { roundPixels: scene.cameras.main.roundPixels, particleQuad: particleQuad.slice(0, 2), imageQuad: imageQuad.slice(0, 2) };
});
p.check('camera.roundPixels is on, the Image quad is whole pixels', round.roundPixels && Number.isInteger(round.imageQuad[0]), round);
p.check('the particle quad is not rounded', !Number.isInteger(round.particleQuad[0]), round);

// 6. CPU cost of alive particles, printed for comparison only.
const cost = await p.page.evaluate(async () => {
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return +b[Math.floor(b.length / 2)].toFixed(2); };
  const frames = (n) => new Promise((res) => { let k = 0; const h = () => { if (++k >= n) { game.events.off(Phaser.Core.Events.POST_RENDER, h); res(); } }; game.events.on(Phaser.Core.Events.POST_RENDER, h); });
  const times = []; const orig = game.renderer.render;
  game.renderer.render = function () { const t0 = performance.now(); const r = orig.apply(this, arguments); times.push(performance.now() - t0); return r; };
  const rows = {};
  for (const n of [2000, 10000]) {
    const e = scene.add.particles(200, 150, 'px', { speed: { min: 10, max: 60 }, lifespan: 100000, frequency: -1, emitting: false });
    e.explode(n);
    await frames(5); times.length = 0; await frames(30);
    const upd = []; for (let i = 0; i < 20; i++) { const t0 = performance.now(); e.preUpdate(0, 16.7); upd.push(performance.now() - t0); }
    rows[n + ' alive'] = { renderCallMs: med(times), preUpdateMs: med(upd) }; e.destroy();
  }
  game.renderer.render = orig;
  return rows;
});
p.check('10000 alive particles cost more than 2000 to render', cost['10000 alive'].renderCallMs >= cost['2000 alive'].renderCallMs, cost);
console.error('CPU ms (comparison only):', JSON.stringify(cost));

// 7. GravityWell: power defaults to 0, coordinates are emitter-local, and an attractor with no drag is passed, not stopped.
const well = await p.page.evaluate(() => {
  const run = (wells, frames = 30) => {
    const e = scene.add.particles(100, 100, 'px', { speed: 0, lifespan: 100000, frequency: -1, emitting: false });
    wells.forEach((w) => e.createGravityWell(w));
    e.explode(1);
    for (let i = 0; i < frames; i++) e.preUpdate(0, 16.67);
    const q = e.alive[0], res = { x: +q.x.toFixed(2), y: +q.y.toFixed(2), vx: +q.velocityX.toFixed(2), processors: e.getAliveParticleCount() === 1 };
    e.destroy(); return res;
  };
  const g = new Phaser.GameObjects.Particles.GravityWell();
  return {
    defaults: { power: g._power, epsilonSquared: g._epsilon, gravity: g._gravity },
    noPower: run([{ x: 400, y: 0 }]),
    far: run([{ x: 400, y: 0, power: 10 }]),
    near: run([{ x: 100, y: 0, power: 10 }]),
  };
});
p.check('a GravityWell created with only x and y has power 0 and does nothing (epsilon 100, gravity 50 by default)', well.defaults.power === 0 && well.defaults.epsilonSquared === 10000 && well.defaults.gravity === 50 && well.noPower.x === 0 && well.noPower.y === 0, well);
p.check('with power it pulls toward the well in the emitter-local space: y stays 0 for a well at local y 0 on an emitter at world y 100', well.far.x > 10 && well.far.vx > 0 && well.far.y === 0, well.far);
p.check('an attractor has no drag: a particle started 100 units away passes a well at x 100 and is pulled back', well.near.x > 100 && well.near.vx < 0, well.near);

// 8. colorEase: the default is linear, and an ease changes how far along the colour list a particle is at the same life.
const ease = await p.page.evaluate(() => {
  const at = (cfgEase) => {
    const cfg = { speed: 0, lifespan: 1000, frequency: -1, emitting: false, color: [0xff0000, 0x0000ff] };
    if (cfgEase) cfg.colorEase = cfgEase;
    const e = scene.add.particles(100, 100, 'px', cfg); e.explode(1);
    const q = e.alive[0]; for (let i = 0; i < 30; i++) e.preUpdate(0, 16.67);
    const res = { tint: q.tint, blue: q.tint & 0xff, red: (q.tint >> 16) & 0xff, name: e.colorEase, life: +q.lifeT.toFixed(2) };
    e.destroy(); return res;
  };
  return { unset: at(null), linear: at('linear'), quadOut: at('quad.out') };
});
p.check('colorEase is linear when unset, and quad.out is further along the colour list at the same particle life', ease.unset.tint === ease.linear.tint && ease.quadOut.blue > ease.linear.blue && ease.quadOut.red < ease.linear.red, ease);

await p.finish();

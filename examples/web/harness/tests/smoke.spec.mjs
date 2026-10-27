// A smoke spec that proves the game really boots and draws, on the renderer you think it is on. Layers, cheapest first:
//   1. boots with a clean console (the fixture fails on any error or warning) and says which renderer it got;
//   2. the manual loop is deterministic: N frames run exactly N frames, with no sleeps anywhere (scene ticks follow the virtual clock; tweens do not, so none is asserted);
//   3. pixels, not "not black": known colours at known places (`@gpu`: exact colours need a real renderer).
import { expect, test } from './fixtures.mjs';
import { settle } from './wait.mjs';

const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;

test('boots and says what the renderer is', async ({ game }) => {
  await game.open();
  const gl = await game.renderer();
  console.log(`[renderer] ${gl.context} / ${gl.renderer} / max texture ${gl.maxTexture}`);
  expect(gl.context).toMatch(/^WebGL2?RenderingContext$/);
  expect(gl.maxTexture).toBeGreaterThanOrEqual(4096);
});

test('@gpu runs on a hardware renderer, not software', async ({ game }) => {
  await game.open();
  const { renderer } = await game.renderer();
  console.log(`[renderer] ${renderer}`);
  expect(renderer, 'software WebGL raises no error: only the renderer string gives it away').not.toMatch(SOFTWARE);
  // "Hardware" is not "the discrete GPU": on a laptop with two, a run can pass on the integrated one. EXPECT_GPU=nvidia (any regular expression) asserts the adapter.
  if (process.env.EXPECT_GPU) expect(renderer, `EXPECT_GPU=${process.env.EXPECT_GPU}`).toMatch(new RegExp(process.env.EXPECT_GPU, 'i'));
});

test('the manual loop is deterministic', async ({ game }) => {
  await game.open();
  await game.frames(30);
  const a = await game.state();
  await game.frames(60);
  const b = await game.state();
  expect(b.ticks - a.ticks, 'exactly 60 more frames ran').toBe(60);
  // Not asserted: the block's x. Phaser 4.2.1 tweens read Date.now(), not the virtual clock passed to game.step, so the block moves with the wall time
  // between two reads and any comparison here would pass or fail for the wrong reason. Assert tween positions only under page.clock or with tweens
  // paused (see deterministic-test-driving.md).
});

test('@gpu draws the colours the scene asks for, in the right places', async ({ game }) => {
  await game.open();
  await game.frames(2);
  const near = (c, want, tol = 6) => [c.r - want[0], c.g - want[1], c.b - want[2]].every((d) => Math.abs(d) <= tol);
  expect(near(await game.pixel(10, 10), [0x20, 0x60, 0xc0]), 'sky').toBe(true);
  expect(near(await game.pixel(10, 350), [0x30, 0xa0, 0x50]), 'ground').toBe(true);
  const { blockX } = await game.state();
  // the block is the only orange thing; it must be exactly where the scene says it is
  expect(near(await game.pixel(Math.round(blockX), 200), [0xff, 0x8a, 0x2a]), 'block under its reported x').toBe(true);
});

test('a real animation is waited for in frames, not milliseconds', async ({ page, game }) => {
  await game.open();                                    // the page's own loop is running here
  const before = (await game.state()).ticks;
  await settle(page, 20);
  expect((await game.state()).ticks - before).toBeGreaterThanOrEqual(15);
});

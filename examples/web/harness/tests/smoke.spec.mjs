// A smoke spec that proves the game really boots and draws, on the renderer you think it is on. Layers, cheapest first:
//   1. boots with a clean console (the fixture fails on any error or warning) and says which renderer it got;
//   2. the manual loop is deterministic: N frames run exactly N frames, with no sleeps anywhere;
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
  expect(renderer, 'software WebGL raises no error: only the renderer string gives it away').not.toMatch(SOFTWARE);
});

test('the manual loop is deterministic', async ({ game }) => {
  await game.open();
  await game.frames(30);
  const a = await game.state();
  await game.frames(60);
  const b = await game.state();
  expect(b.ticks - a.ticks, 'exactly 60 more frames ran').toBe(60);
  expect(b.blockX, 'the tween followed the virtual clock').not.toBe(a.blockX);
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

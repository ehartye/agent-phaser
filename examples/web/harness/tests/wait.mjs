// Waiting without a wall-clock guess. A fixed `page.waitForTimeout(600)` is a bet about how fast this machine is today: it breaks when a
// bigger atlas slows the first boot, when two workers share one GPU, or on a software-GL CI runner that draws one frame a second.
// Wait on a CONDITION, on display FRAMES, or on elapsed PAGE TIME, in that order of preference.
//
//   until(page, fn, arg)        a condition you can name (a scene is ready, the player moved). Polls every animation frame.
//   settle(page, frames)        a genuine animation (a fade, a tween). Counts display frames, so a slow machine stretches the wait.
//   elapsed(page, ms)           a duration that is itself the thing under test (a notice outlasts 3 s). Page time, so it is a condition.
//   framesUntil(page, fn, ...)  the same as `until` for a MANUAL loop, where nothing happens unless a frame is run.
//
// `fn` is serialised into the page: it cannot close over variables, and a helper defined in the spec does not exist there. Pass data as `arg`.

/** Wait until `fn(arg)` is truthy in the page. Polls every animation frame (the page's own loop must be running). */
export async function until(page, fn, arg, timeout = 30_000) {
  await page.waitForFunction(fn, arg, { timeout, polling: 'raf' });
}

/** Let the page draw `frames` display frames. */
export async function settle(page, frames = 8) {
  await page.evaluate((n) => new Promise((resolve) => {
    let i = 0;
    const f = () => { if (++i >= n) resolve(); else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }), Math.max(1, Math.ceil(frames)));
}

/** Frames for a wait you would have written in milliseconds (16.7 ms a frame at 60 Hz). */
export const framesFor = (ms) => Math.ceil(ms / 16.7);

/** Wait until `ms` of page time has passed. Never "frames == N": on software GL the toast clock and the frame clock disagree. */
export async function elapsed(page, ms) {
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction(({ t0, ms }) => performance.now() - t0 >= ms, { t0, ms }, { timeout: ms + 30_000 });
}

/**
 * Manual-loop wait. With `debug.manual()` the page's frame loop is stopped, so `until` would wait for ever. This runs frames one at a time
 * inside the page until `fn(arg)` holds and returns how many it took, throwing after `maxFrames`. It yields to the event loop between
 * batches: asset loads finish on the event loop, and a tight synchronous `while (!ready) game.step()` never lets them.
 */
export async function framesUntil(page, fn, arg, { maxFrames = 600, dtMs = 1000 / 60, batch = 20 } = {}) {
  const used = await page.evaluate(async ({ src, a, max, dt, batch }) => {
    const test = new Function(`return (${src})`)();
    const d = globalThis.__game.debug;
    for (let i = 0; i <= max; i++) {
      if (test(a)) return i;
      if (i < max) d.frames(1, { dt });
      if (i % batch === batch - 1) await new Promise((r) => requestAnimationFrame(r));   // yield: loads, decodes, DOM events
    }
    return -1;
  }, { src: fn.toString(), a: arg, max: maxFrames, dt: dtMs, batch });
  if (used < 0) throw new Error(`framesUntil: the condition never held in ${maxFrames} frames: ${fn}`);
  return used;
}

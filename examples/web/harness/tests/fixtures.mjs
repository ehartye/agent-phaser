// The `test` every browser spec imports instead of Playwright's own. It adds:
//   * a `game` fixture that opens the page with the debug API, waits for the scene to be ready (a condition, not a sleep) and FAILS the
//     test on any console error, console warning or page error: "no errors" is the floor, not the proof;
//   * the `@gpu` convention: a test whose title contains `@gpu` needs a real GPU (exact colours, frame rate) and is skipped when
//     SOFTWARE_GL=1, which is how a CI runner with no GPU runs the rest as a smoke.
import { test as base, expect } from '@playwright/test';
import { until } from './wait.mjs';

export const test = base.extend({
  game: async ({ page }, use, info) => {
    if (process.env.SOFTWARE_GL && /@gpu/.test(info.title)) info.skip(true, 'needs a real GPU (@gpu)');
    const problems = [];
    const allowed = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    const game = {
      /** Expected noise (a known browser warning): excuse the pattern, not the whole test. */
      allowErrors: (re) => { allowed.push(re); },
      async open(query = '?debug=1') {
        await page.goto(`/${query}`);
        await until(page, () => globalThis.__game?.debug?.state().ready === true);   // the scene says it is up
        return game;
      },
      /** Switch to the manual loop, then run `n` frames on a virtual clock. */
      async frames(n = 1, dt = 1000 / 60) {
        await page.evaluate(([n, dt]) => { const d = globalThis.__game.debug; d.manual(true); d.frames(n, { dt }); }, [n, dt]);
      },
      state: () => page.evaluate(() => globalThis.__game.debug.state()),
      renderer: () => page.evaluate(() => globalThis.__game.debug.renderer()),
      pixel: (x, y) => page.evaluate(([x, y]) => globalThis.__game.debug.pixel(x, y), [x, y]),
    };
    await use(game);
    expect(problems.filter((p) => !allowed.some((re) => re.test(p))), 'console errors, warnings and page errors').toEqual([]);
  },
});

export { expect };

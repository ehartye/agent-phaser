// The debug API: ONE typed object on the page that the browser tests, command-line tools and demo mode all use.
// Gate it: always on a dev server, on a production build only when the URL asks. In a real game load this module through a dynamic
// import() so a production build carries it as a separate chunk; here it is a plain import to keep the example dependency-free.

/** Is the tooling wanted? `?debug=1` (or `?debug=panel`), or a dev host. */
export function gate(search, host = location.hostname) {
  return /[?&]debug(=|&|$)/.test(search) || host === 'localhost' || host === '127.0.0.1';
}

export function installDebug(game) {
  let manual = false, clock = 0;
  const gl = () => game.renderer.gl;
  const debug = {
    /** Stop the page's own requestAnimationFrame loop. From here nothing moves unless `frames` or `step` runs. */
    manual(on = true) {
      if (on === manual) return manual;
      manual = on;
      if (on) { clock = game.loop.now; game.loop.sleep(); } else game.loop.wake();
      return manual;
    },
    /** Run `n` whole frames (input, tweens, scene updates, render) on a virtual clock of `dt` ms. Needs `manual()`. */
    frames(n = 1, { dt = 1000 / 60 } = {}) {
      if (!manual) throw new Error('frames(): call manual() first, or use a condition wait in the page loop');
      for (let i = 0; i < n; i++) { clock += dt; game.step(clock, dt); }
    },
    /** Read one pixel of the canvas at game coordinates, after rendering one frame. Resolves {r,g,b,a}. */
    pixel(x, y) {
      return new Promise((resolve) => {
        game.renderer.snapshotPixel(x, y, (c) => resolve({ r: c.red, g: c.green, b: c.blue, a: c.alpha }));
        if (manual) debug.frames(1, { dt: 0 });          // a snapshot is fulfilled at the end of the next rendered frame
      });
    },
    /** What the renderer really is. Software WebGL raises no error, so tests assert on this string. */
    renderer() {
      const ext = gl().getExtension('WEBGL_debug_renderer_info');
      return {
        context: gl().constructor.name,
        renderer: String(gl().getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl().RENDERER)),
        maxTexture: gl().getParameter(gl().MAX_TEXTURE_SIZE),
      };
    },
    /** Plain data only: never return a Phaser object across page.evaluate. */
    state() {
      const world = game.scene.getScene('default') ?? game.scene.scenes[0];
      return { ready: !!world?.ready, ticks: world?.ticks ?? 0, blockX: world?.block?.x ?? null, fps: game.loop.actualFps };
    },
  };
  globalThis.__game.debug = debug;
  return debug;
}

// How many display objects each camera is handed per frame, against how many are anywhere near its view.
// Pure ES module: no Phaser import, no dependencies. Phaser culls nothing by position, so an object far off screen is
// submitted and transformed every frame until something hides it; this census shows how much of a frame that is.
//
//   In a running game:   const report = viewCensus(game);                  // `game` is the Phaser.Game
//                        const verdict = checkViewCensus(report);
//   From a browser test: await page.evaluate(`(${viewCensus})(window.__game)`)   // the function is self-contained
//
// Per camera it counts the leaf objects that would be drawn (visible, with every ancestor visible, and not ignored by that
// camera) and sorts them by where their bounds lie: inside the camera's world view, inside the view grown by a margin on
// every side (the keep-alive ring a streamed world holds on purpose), or beyond it ("far"). A world that hides by chunk has
// few far objects; a world that adds everything flat to the scene has most of its objects there.
//
// It counts objects, not time: what one far object costs on a device is a profiling question. Objects with no bounds
// (emitters, Graphics, tile layers, which cull or size themselves) are counted as unmeasured and never as far.
//
// Proof: `node --test tests/phaser-view-census.test.mjs`; against real Phaser 4.2.1,
// `node examples/web/phaser-probes/phaser-verification-content-cost.mjs <host project>`.

/**
 * Census of every active scene and camera. Self-contained, so its source can be evaluated in a page.
 * options.margin is the ring around the view, as a fraction of the view's width and height added on each side (default 1:
 * one more screen in every direction). Returns { cameras: [{ scene, camera, view, submitted, inView, nearView, far,
 * unmeasured, farRatio }], submitted, far } where submitted = inView + nearView + far + unmeasured.
 */
export function viewCensus(game, options) {
  const margin = options && Number.isFinite(options.margin) ? options.margin : 1;
  if (margin < 0) throw new RangeError('margin must not be negative');
  const manager = game && game.scene;
  if (!manager || typeof manager.getScenes !== 'function') throw new TypeError('viewCensus needs a Phaser.Game (game.scene.getScenes is missing)');
  const cameras = [];
  const overlaps = (b, x, y, w, h) => b.x < x + w && b.x + b.width > x && b.y < y + h && b.y + b.height > y;
  for (const scene of manager.getScenes(true)) {
    const roots = scene.children && Array.isArray(scene.children.list) ? scene.children.list : [];
    const sceneCameras = scene.cameras && Array.isArray(scene.cameras.cameras) ? scene.cameras.cameras : [];
    for (const camera of sceneCameras) {
      if (camera.visible === false) continue;
      const view = camera.worldView;
      const row = {
        scene: scene.sys && scene.sys.settings ? scene.sys.settings.key : '', camera: camera.name || String(camera.id),
        view: { x: view.x, y: view.y, width: view.width, height: view.height },
        submitted: 0, inView: 0, nearView: 0, far: 0, unmeasured: 0, farRatio: 0,
      };
      const visit = (object) => {
        if (!object || object.visible === false) return;
        if (typeof object.willRender === 'function' ? !object.willRender(camera) : false) return;
        const children = Array.isArray(object.list) ? object.list : null;   // a Container or a Layer
        if (children) { for (const child of children) visit(child); return; }
        row.submitted++;
        const fixed = object.scrollFactorX === 0 && object.scrollFactorY === 0;   // drawn at a screen position
        if (fixed || typeof object.getBounds !== 'function') { row.unmeasured++; return; }
        const b = object.getBounds();
        if (overlaps(b, view.x, view.y, view.width, view.height)) row.inView++;
        else if (overlaps(b, view.x - view.width * margin, view.y - view.height * margin, view.width * (1 + 2 * margin), view.height * (1 + 2 * margin))) row.nearView++;
        else row.far++;
      };
      for (const root of roots) visit(root);
      row.farRatio = row.submitted === 0 ? 0 : row.far / row.submitted;
      cameras.push(row);
    }
  }
  return { margin, cameras, submitted: cameras.reduce((n, c) => n + c.submitted, 0), far: cameras.reduce((n, c) => n + c.far, 0) };
}

/**
 * { ok, failures: [message], message } for a report from viewCensus. A camera fails when it is handed at least
 * `minSubmitted` objects and more than `maxFarRatio` of them are far from its view. The defaults (0.25 of at least 200
 * objects) are a starting point, not a measured limit: set them from your own frame budget.
 */
export function checkViewCensus(report, { maxFarRatio = 0.25, minSubmitted = 200 } = {}) {
  if (!report || !Array.isArray(report.cameras)) throw new TypeError('checkViewCensus needs a report from viewCensus');
  if (!(maxFarRatio >= 0 && maxFarRatio <= 1)) throw new RangeError('maxFarRatio must be between 0 and 1');
  const failures = report.cameras
    .filter((c) => c.submitted >= minSubmitted && c.farRatio > maxFarRatio)
    .map((c) => `scene ${c.scene} camera ${c.camera}: ${c.far} of ${c.submitted} submitted objects are far from the view (${Math.round(c.farRatio * 100)}%, limit ${Math.round(maxFarRatio * 100)}%); ${c.inView} are in view`);
  return { ok: failures.length === 0, failures, message: failures.length === 0 ? `${report.submitted} objects submitted, ${report.far} far from a view` : failures.join('\n') };
}

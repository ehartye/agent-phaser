// Probe for skills/phaser-rendering/references/stencil-and-custom-context.md (Phaser 4.2.1).
//
// Purpose: prove how Stencil, StencilReference and CustomContext behave on a live game: the default Stencil is a HOLE (later
// objects are hidden where its children drew), `stencilInvert` turns it into a window, alpha strategies decide which source
// pixels count, the stencil is shared by every scene drawn after it in the same frame until a `clear` Stencil resets it,
// StencilReference undoes a layer, `render.stencil: false` makes Stencil a silent no-op, and a CustomContext scissor
// clips a container without a framebuffer.
// Run:  node phaser-rendering-stencil.mjs /absolute/path/to/project-with-phaser-and-playwright
// Expected: JSON evidence, then {"passed":true}. Logic probe; see phaser-rendering-harness.mjs for the stack it uses.
import assert from 'node:assert/strict';
import { runProbe } from './phaser-rendering-harness.mjs';

const { evidence, errors } = await runProbe('stencil', async page => {
  const out = await page.evaluate(async () => {
    const out = {};
    const { scene } = await H.boot({}, {
      create() {
        H.solid(this, 'white', 8, '#fff'); H.solid(this, 'red', 8, '#f00'); H.solid(this, 'green', 8, '#0f0');
      },
    });
    const reset = () => { scene.children.removeAll(true); };
    const hole = () => scene.add.image(60, 60, 'white').setScale(5); // covers x 40..80, y 40..80
    const cover = () => scene.add.image(80, 60, 'red').setScale(20); // covers the whole 160x120 canvas
    const redShare = (rgba) => { let n = 0; for (let i = 0; i < rgba.length; i += 4) if (rgba[i] === 255 && rgba[i + 1] === 0) n++; return n / (rgba.length / 4); };

    // 1. Default Stencil: later objects are hidden where the stencil children drew.
    reset(); scene.add.stencil(0, 0, [hole()]); cover();
    out.defaultInside = await H.pixel(60, 60); out.defaultOutside = await H.pixel(120, 100);

    // 2. stencilInvert: the same shape becomes a window.
    reset(); scene.add.stencil(0, 0, [hole()], { stencilInvert: true }); cover();
    out.invertInside = await H.pixel(60, 60); out.invertOutside = await H.pixel(120, 100);

    // 3. A StencilReference with subtractLayer removes the layer again; objects after it draw inside the shape.
    reset();
    const s = scene.add.stencil(0, 0, [hole()]);
    scene.add.image(60, 60, 'red');
    scene.add.stencilreference(s, { stencilLayerMode: 'subtractLayer' });
    scene.add.image(60, 70, 'green');
    out.beforeReference = await H.pixel(60, 60); out.afterReference = await H.pixel(60, 70);

    // 4. Alpha strategy of the stencil source (a 40% alpha hole), measured as the share of the 30x30 area that stays visible.
    const share = async (alpha, strategy) => {
      reset(); const h = hole().setAlpha(alpha);
      scene.add.stencil(0, 0, [h], { stencilAlphaStrategy: strategy }); cover();
      return redShare(await H.region(45, 45, 30, 30));
    };
    out.alphaKeep = await share(0.4, 'keep');
    out.alphaDither = await share(0.4, 'dither');
    out.thresholdBelow = await share(0.4, 0.5);
    out.thresholdAbove = await share(0.6, 0.5);

    // 4b. A Shader game object ignores alpha strategies, so its translucent pixels stamp a fully opaque stencil, unless the Stencil
    //     composites its children through a framebuffer first (stencilCompositeCheck: true), which then applies the strategy.
    const shaderHole = () => scene.add.shader({ name: 'halfAlpha', fragmentSource: 'precision mediump float; varying vec2 outTexCoord; void main () { gl_FragColor = vec4(0.4, 0.0, 0.0, 0.4); }' }, 60, 60, 40, 40);
    const shaderShare = async check => {
      reset(); const h = shaderHole();
      scene.add.stencil(0, 0, [h], { stencilCompositeCheck: check }); cover();
      return redShare(await H.region(45, 45, 30, 30));
    };
    out.shaderChildAuto = await shaderShare('auto');
    out.shaderChildComposite = await shaderShare(true);

    // 5. One stencil per frame, shared by every scene drawn after it, until a clear Stencil.
    reset(); scene.add.stencil(0, 0, [hole()]);
    game.scene.add('ui', { create() { this.add.image(80, 60, 'red').setScale(20); } }, true);
    await H.frames(2);
    out.nextSceneInHole = await H.pixel(60, 60);
    scene.add.stencil(0, 0, [], { stencilLayerMode: 'clear' });
    out.nextSceneAfterClear = await H.pixel(60, 60);
    game.scene.remove('ui');

    // 5b. API details: StencilReference has no depth, and setStencil() with no arguments disables stencil writes while the factory default enables them.
    reset();
    const target = scene.add.stencil(0, 0, []);
    const reference = scene.add.stencilreference(target);
    out.referenceDepth = reference.depth;
    const ctx = game.renderer.baseDrawingContext.getClone();
    out.writeMaskFactoryDefault = ctx.state.stencil.writeMask;
    ctx.setStencil();
    out.writeMaskAfterSetStencil = ctx.state.stencil.writeMask;

    // 6. CustomContext: a scissor box set on the cloned drawing context clips its children (top-left origin, no framebuffer).
    reset();
    scene.add.customcontext(0, 0, [cover()], ctx => ctx.setScissorBox(20, 20, 40, 30));
    scene.add.image(130, 100, 'green');
    out.scissorInside = await H.pixel(30, 25); out.scissorOutside = await H.pixel(30, 100); out.afterContext = await H.pixel(130, 100);
    out.scissorDraws = (await H.draws()).elements;
    return out;
  });

  // 7. render.stencil = false: the Stencil draws nothing into a stencil buffer, so the hole does not exist.
  await page.evaluate(() => game.destroy(true));
  const off = await page.evaluate(async () => {
    const { scene } = await H.boot({ render: { stencil: false } }, {
      create() { H.solid(this, 'white', 8, '#fff'); H.solid(this, 'red', 8, '#f00'); },
    });
    const h = scene.add.image(60, 60, 'white').setScale(5);
    scene.add.stencil(0, 0, [h]);
    scene.add.image(80, 60, 'red').setScale(20);
    return { inside: await H.pixel(60, 60), stencilBits: game.renderer.gl.getParameter(game.renderer.gl.STENCIL_BITS) };
  });
  return { ...out, stencilOff: off };
});

assert.deepEqual(evidence.defaultInside.slice(0, 3), [0, 0, 0], 'default Stencil hides later objects inside its shape');
assert.deepEqual(evidence.defaultOutside.slice(0, 3), [255, 0, 0]);
assert.deepEqual(evidence.invertInside.slice(0, 3), [255, 0, 0]);
assert.deepEqual(evidence.invertOutside.slice(0, 3), [0, 0, 0]);
assert.deepEqual(evidence.beforeReference.slice(0, 3), [0, 0, 0]);
assert.deepEqual(evidence.afterReference.slice(0, 3), [0, 255, 0]);
assert.equal(evidence.alphaKeep, 0, 'keep: a 40% alpha source is a fully opaque stencil');
assert.ok(evidence.alphaDither > 0.4 && evidence.alphaDither < 0.8, `dither share ${evidence.alphaDither}`);
assert.equal(evidence.thresholdBelow, 1, 'threshold 0.5: alpha 0.4 writes nothing');
assert.equal(evidence.thresholdAbove, 0, 'threshold 0.5: alpha 0.6 writes the full stencil');
assert.equal(evidence.shaderChildAuto, 0, 'a Shader child writes an opaque stencil');
assert.ok(evidence.shaderChildComposite > 0.4 && evidence.shaderChildComposite < 0.8, `composited Shader child is dithered: ${evidence.shaderChildComposite}`);
assert.deepEqual(evidence.nextSceneInHole.slice(0, 3), [0, 0, 0], 'a later scene is stencilled by an earlier scene');
assert.deepEqual(evidence.nextSceneAfterClear.slice(0, 3), [255, 0, 0], 'a clear Stencil lifts it');
assert.equal(evidence.referenceDepth, undefined, 'StencilReference has no Depth component');
assert.deepEqual([evidence.writeMaskFactoryDefault, evidence.writeMaskAfterSetStencil], [0xff, 0x00]);
assert.deepEqual(evidence.scissorInside.slice(0, 3), [255, 0, 0]);
assert.deepEqual(evidence.scissorOutside.slice(0, 3), [0, 0, 0]);
assert.deepEqual(evidence.afterContext.slice(0, 3), [0, 255, 0], 'the scissor ends with the CustomContext');
assert.deepEqual(evidence.stencilOff.inside.slice(0, 3), [255, 0, 0], 'stencil disabled: no hole');
assert.equal(evidence.stencilOff.stencilBits, 0);
assert.deepEqual(errors, []);
console.log(JSON.stringify({ passed: true }));

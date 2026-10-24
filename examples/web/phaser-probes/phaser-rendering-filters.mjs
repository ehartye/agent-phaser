// Probe for skills/phaser-rendering/references/filters.md (Phaser 4.2.1).
//
// Purpose: prove the filter facts an agent most often gets wrong: padding is off by default, camera fade and flash are drawn
// inside the filtered image, what each filter adds to the draw-call count, the draw-context pool never shrinks on its own,
// and two traps in authoring a custom filter (the guide's `additions = {}` sample, an unregistered render node name).
// Run:  node phaser-rendering-filters.mjs /absolute/path/to/project-with-phaser-and-playwright
// Expected: JSON evidence, then {"passed":true}. Logic probe; see phaser-rendering-harness.mjs for the stack it uses.
import assert from 'node:assert/strict';
import { runProbe } from './phaser-rendering-harness.mjs';

const { evidence, errors } = await runProbe('filters', async page => {
  return page.evaluate(async () => {
    const out = {};
    const RN = Phaser.Renderer.WebGL.RenderNodes;
    const FRAG = [
      'precision mediump float;',
      'uniform sampler2D uMainSampler;',
      'varying vec2 outTexCoord;',
      'void main () { vec4 c = texture2D(uMainSampler, outTexCoord); gl_FragColor = vec4(c.rgb * vec3(0.0, 1.0, 0.0), c.a); }',
    ].join('\n');
    class FilterGreen extends RN.BaseFilterShader {
      constructor(manager) { super('FilterGreen', manager, null, FRAG, []); }
    }
    class Green extends Phaser.Filters.Controller {
      constructor(camera) { super(camera, 'FilterGreen'); }
    }
    class FilterBad extends RN.BaseFilterShader {
      constructor(manager) { super('FilterBad', manager, null, FRAG, {}); }
    }
    const { scene } = await H.boot({ render: { renderNodes: { FilterGreen, FilterBad } } }, {
      create() {
        H.solid(this, 'white', 16, '#fff');
        this.box = this.add.image(80, 60, 'white');
      },
    });
    const cam = scene.cameras.main;

    // 1. Padding. The controller starts with a zero-size override, so expanding filters clip at the object's bounds.
    const blur = scene.box.enableFilters().filters.internal.addBlur();
    out.defaultOverride = { isNull: blur.paddingOverride === null, w: blur.paddingOverride && blur.paddingOverride.width };
    const outsideClipped = (await H.pixel(68, 60))[0]; // red channel over the opaque black background
    blur.setPaddingOverride(null);
    const outsidePadded = (await H.pixel(68, 60))[0];
    out.blurRedOutsideBounds = { defaultPadding: outsideClipped, autoPadding: outsidePadded };
    const pad = blur.getPaddingCeil();
    out.blurPaddingCeil = { x: pad.x, y: pad.y, width: pad.width, height: pad.height };
    scene.box.filters.internal.remove(blur);

    // 2. Camera fade is drawn before the camera's filters run, so a camera colour filter recolours it.
    cam.fade(1, 255, 0, 0);
    await H.frames(3);
    out.fadeUnfiltered = await H.pixel(10, 10);
    const gray = cam.filters.internal.addColorMatrix();
    gray.colorMatrix.grayscale(1);
    out.fadeWithInternalGrayscale = await H.pixel(10, 10);
    cam.filters.internal.remove(gray);
    const grayExternal = cam.filters.external.addColorMatrix();
    grayExternal.colorMatrix.grayscale(1);
    out.fadeWithExternalGrayscale = await H.pixel(10, 10);
    cam.filters.external.remove(grayExternal);
    cam.resetFX();

    // 3. Draw calls per effect: one sprite, then the same scene with each effect.
    const draws = async () => (await H.draws()).elements;
    out.drawCalls = { baseline: await draws() };
    const measure = async (label, add, remove) => { const f = add(); out.drawCalls[label] = await draws(); remove(f); };
    const camInt = cam.filters.internal, camExt = cam.filters.external;
    await measure('cameraColorMatrix', () => camInt.addColorMatrix(), f => camInt.remove(f));
    await measure('cameraBlurLow', () => camInt.addBlur(0), f => camInt.remove(f));
    await measure('cameraBlurMed', () => camInt.addBlur(1), f => camInt.remove(f));
    await measure('cameraBlurHigh', () => camInt.addBlur(2), f => camInt.remove(f));
    await measure('cameraBlurOneStep', () => camInt.addBlur(0, 2, 2, 1, 0xffffff, 1), f => camInt.remove(f));
    await measure('cameraGlow', () => camInt.addGlow(), f => camInt.remove(f));
    await measure('cameraVignetteExternal', () => camExt.addVignette(), f => camExt.remove(f));
    await measure('cameraColorMatrixPlusVignette', () => [camInt.addColorMatrix(), camExt.addVignette()], f => { camInt.remove(f[0]); camExt.remove(f[1]); });
    cam.setAlpha(0.5); out.drawCalls.cameraAlphaHalf = await draws(); cam.setAlpha(1);
    cam.setForceComposite(true); out.drawCalls.cameraForceComposite = await draws(); cam.setForceComposite(false);
    const bloom = Phaser.Actions.AddEffectBloom(cam);              // returns an array, one entry per recipient; external by default
    out.bloomReturnIsArray = Array.isArray(bloom);
    out.drawCalls.cameraBloom = await draws();
    bloom[0].parallelFilters.destroy();
    await measure('maskFromGameObject', () => { const m = scene.make.graphics({ x: 0, y: 0 }); m.fillStyle(0xffffff).fillRect(0, 0, 80, 60); return camInt.addMask(m); }, f => camInt.remove(f));

    // 4. A filtered sprite between two plain ones splits the batch three ways, plus its own passes.
    const a = scene.add.image(20, 20, 'white'), c = scene.add.image(140, 20, 'white');
    out.drawCalls.threePlainSprites = await draws();
    scene.box.filters.internal.addColorMatrix();
    out.drawCalls.middleSpriteFiltered = await draws();
    scene.box.filters.internal.clear();
    a.destroy(); c.destroy();

    // 5. The context pool keeps framebuffers after every filter is gone (nothing in src calls pool.prune()).
    const pool = game.renderer.drawingContextPool;
    const f1 = camInt.addBlur(2); await H.frames(2); camInt.remove(f1);
    out.poolAfterRemoval = pool.agePool.length;
    await new Promise(r => setTimeout(r, pool.maxAge + 300));
    await H.frames(2);
    out.poolAfterMaxAge = pool.agePool.length;
    const framebuffersBefore = game.renderer.glFramebufferWrappers.length;
    pool.clear();
    out.poolAfterClear = pool.agePool.length;
    out.framebuffersFreed = framebuffersBefore - game.renderer.glFramebufferWrappers.length;
    const f2 = camInt.addColorMatrix(); await H.frames(2); camInt.remove(f2); // still renders after clear()
    out.poolMaxAge = pool.maxAge;

    // 6. Custom filter: a fragment-only BaseFilterShader works when registered and given an array.
    scene.box.filters.internal.add(new Green(scene.box.filterCamera));
    out.customFilterPixel = await H.pixel(80, 60);
    scene.box.filters.internal.clear();
    //    The guide's sample passes `{}` as the additions list; the constructor then calls .push on it.
    try { game.renderer.renderNodes.getNode('FilterBad'); out.additionsObjectError = null; }
    catch (error) { out.additionsObjectError = error.message; }
    out.unregisteredNode = game.renderer.renderNodes.getNode('FilterNotRegistered');
    // 7. Groups: a Layer (a real GameObject since 4.1.0) filters everything inside it and always focuses on the camera;
    //    a Container without a size does too, but a sized Container focuses on its own bounds.
    scene.children.removeAll(true);
    H.solid(scene, 'red', 16, '#f00');
    const inside = scene.add.image(40, 60, 'red'), outside = scene.add.image(120, 60, 'red');
    const layer = scene.add.layer([inside]);
    layer.enableFilters().filters.internal.addColorMatrix().colorMatrix.grayscale(1);
    out.layerFocusContext = layer.filtersFocusContext;
    out.layerPixels = { inside: (await H.pixel(40, 60)).slice(0, 3), outside: (await H.pixel(120, 60)).slice(0, 3) };
    const unsized = scene.add.container(0, 0, []).enableFilters();
    const sized = scene.add.container(0, 0, []).setSize(64, 64).enableFilters();
    out.containerFocusContext = { unsized: unsized.filtersFocusContext, sized: sized.filtersFocusContext };
    return out;
  });
});

assert.deepEqual(evidence.defaultOverride, { isNull: false, w: 0 });
assert.equal(evidence.blurRedOutsideBounds.defaultPadding, 0, 'no padding: blur clipped at bounds');
assert.ok(evidence.blurRedOutsideBounds.autoPadding > 0, 'setPaddingOverride(null) lets the blur spill outside');
assert.deepEqual(evidence.fadeUnfiltered, [255, 0, 0, 255]);
for (const px of [evidence.fadeWithInternalGrayscale, evidence.fadeWithExternalGrayscale]) {
  assert.ok(px[0] === px[1] && px[1] === px[2] && px[0] > 0 && px[0] < 255, `fade was recoloured: ${px}`);
}
assert.equal(evidence.drawCalls.baseline, 1);
assert.ok(evidence.drawCalls.cameraColorMatrix > evidence.drawCalls.baseline);
assert.equal(evidence.drawCalls.cameraBlurHigh, evidence.drawCalls.cameraBlurLow, 'blur quality changes the shader, not the pass count');
assert.equal(evidence.drawCalls.cameraBlurLow, 2 + 2 * 4, 'scene + 2 passes per step (default 4 steps) + composite');
assert.equal(evidence.drawCalls.cameraBlurOneStep, 2 + 2 * 1);
assert.equal(evidence.bloomReturnIsArray, true);
assert.ok(evidence.drawCalls.cameraBloom > evidence.drawCalls.cameraBlurLow, 'bloom runs a full blur plus threshold and blend');
assert.ok(evidence.drawCalls.cameraAlphaHalf > evidence.drawCalls.baseline, 'camera alpha < 1 composites through a framebuffer');
assert.ok(evidence.drawCalls.middleSpriteFiltered > evidence.drawCalls.threePlainSprites);
assert.ok(evidence.poolAfterRemoval > 0);
assert.equal(evidence.poolAfterMaxAge, evidence.poolAfterRemoval, 'pooled framebuffers are not released by age alone');
assert.equal(evidence.poolAfterClear, 0);
assert.ok(evidence.framebuffersFreed > 0);
assert.deepEqual(evidence.customFilterPixel.slice(0, 3), [0, 255, 0]);
assert.match(evidence.additionsObjectError, /push is not a function/);
assert.equal(evidence.unregisteredNode, null);
assert.equal(evidence.layerFocusContext, true);
assert.ok(evidence.layerPixels.inside[0] === evidence.layerPixels.inside[1] && evidence.layerPixels.inside[0] > 0, 'layer child is grayscale');
assert.deepEqual(evidence.layerPixels.outside, [255, 0, 0], 'a sibling outside the layer is untouched');
assert.deepEqual(evidence.containerFocusContext, { unsized: true, sized: false });
assert.deepEqual(errors, []);
console.log(JSON.stringify({ passed: true }));

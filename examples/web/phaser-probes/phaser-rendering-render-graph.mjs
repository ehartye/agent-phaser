// Probe for skills/phaser-rendering/references/render-system-overview.md (Phaser 4.2.1).
//
// Purpose: prove, on a live game, how sprites reach draw calls: batch breaks from blend mode and lighting, the render-node
// debug tree, a custom Submitter registered through `render.renderNodes`, the silent no-op of a mistyped
// `setRenderNodeRole`, and two blend-mode traps (`addBlendMode` return value, blend modes WebGL does not implement).
// Run:  node phaser-rendering-render-graph.mjs /absolute/path/to/project-with-phaser-and-playwright
// Expected: JSON evidence, then {"passed":true}. Logic probe; see phaser-rendering-harness.mjs for the stack it uses.
import assert from 'node:assert/strict';
import { runProbe } from './phaser-rendering-harness.mjs';

const { evidence, errors } = await runProbe('render-graph', async page => {
  return page.evaluate(async () => {
    const out = {};
    const RN = Phaser.Renderer.WebGL.RenderNodes;
    let submitted = 0;
    class CountingSubmitter extends RN.SubmitterQuad {
      constructor(manager) { super(manager, { name: 'CountingSubmitter' }); }
      run(...args) { submitted++; return super.run(...args); }
    }
    const { scene } = await H.boot({ render: { renderNodes: { CountingSubmitter } } }, {
      create() {
        this.lights.enable();
        for (const [k, c] of [['red', '#f00'], ['green', '#0f0'], ['blue', '#00f'], ['white', '#fff']]) H.solid(this, k, 8, c);
        this.row = [0, 1, 2, 3].map(i => this.add.image(20 + i * 20, 20, ['red', 'green', 'blue', 'white'][i]));
      },
    });

    // 1. Four images from four textures share one draw call (multi-texture batch).
    out.sameBlendDraws = (await H.draws()).elements;

    // 2. One ADD image in the middle splits the batch: the display list is walked in order, a blend change opens a new context.
    scene.row[1].setBlendMode(Phaser.BlendModes.ADD);
    out.addBreaksBatch = (await H.draws()).elements;
    scene.row[1].setBlendMode(Phaser.BlendModes.NORMAL);

    // 3. Lighting turns multi-texturing off: each different texture becomes its own draw call.
    scene.row.forEach(image => image.setLighting(true));
    out.litDraws = (await H.draws()).elements;
    scene.row.forEach(image => image.setLighting(false));

    // 3b. Texture-unit limit: four textures in one batch need four units; capping parallel units at 1 (what autoMobileTextures does on
    //     a non-desktop device) turns that into four draws, and 20 distinct textures exceed the device's units.
    const nodes = game.renderer.renderNodes, units = nodes.maxParallelTextureUnits;
    nodes.setMaxParallelTextureUnits(1);
    out.oneUnitDraws = (await H.draws()).elements;
    nodes.setMaxParallelTextureUnits(units);
    out.maxParallelTextureUnits = units;
    const many = [];
    for (let i = 0; i < 20; i++) { H.solid(scene, 'many' + i, 4, '#' + (i + 1).toString(16).padStart(2, '0') + '0000'); many.push(scene.add.image(10 + i * 7, 60, 'many' + i)); }
    out.twentyTexturesDraws = (await H.draws()).elements;
    many.forEach(image => image.destroy());
    //     The batch also ends at render.batchSize quads (16384 by default).
    const crowd = [];
    for (let i = 0; i < 16385; i++) crowd.push(scene.add.image(5 + (i % 150), 100, 'red'));
    out.crowdDraws = (await H.draws()).elements;
    crowd.forEach(image => image.destroy());

    // 4. The render tree of one frame, from the built-in debug capture.
    out.tree = await H.tree();

    // 5. A mistyped role name is a silent no-op; a registered name takes effect and appears in the next debug tree.
    const sprite = scene.row[0];
    sprite.setRenderNodeRole('Submitter', 'CountingSubmiter');
    out.typoLeavesCustomEmpty = sprite.customRenderNodes.Submitter === undefined;
    sprite.setRenderNodeRole('Submitter', 'CountingSubmitter');
    out.customSet = sprite.customRenderNodes.Submitter && sprite.customRenderNodes.Submitter.name;
    const before = submitted;
    await H.frames(3);
    out.customRunsPerFrame = (submitted - before) / 3;
    out.customTree = await H.tree();
    //    Registering the same name twice throws, so scene code that registers in create() must guard with hasNode().
    try { game.renderer.renderNodes.addNodeConstructor('CountingSubmitter', CountingSubmitter); out.duplicateRegistration = null; }
    catch (error) { out.duplicateRegistration = error.message; }
    out.hasNode = game.renderer.renderNodes.hasNode('CountingSubmitter');

    // 6. addBlendMode: the returned index is one lower than the slot the new mode occupies.
    const r = game.renderer, gl = r.gl;
    const lengthBefore = r.blendModes.length;
    out.addBlendModeReturn = r.addBlendMode([gl.ONE, gl.ONE], gl.FUNC_ADD);
    out.newBlendModeSlot = lengthBefore;
    const compare = async (mode, tint = 0x4080c0) => {
      scene.cameras.main.setBackgroundColor(0x806040);
      const s = scene.add.image(120, 90, 'white').setScale(2).setTint(tint).setBlendMode(mode);
      const p = await H.pixel(120, 90);
      s.destroy();
      return p;
    };
    // Using the returned index draws NORMAL (a default slot); the next index is the additive mode that was just added.
    out.returnedIndexPixel = await compare(out.addBlendModeReturn, 0x202020);
    out.slotIndexPixel = await compare(out.newBlendModeSlot, 0x202020);

    // 7. Canvas-only blend modes are default (NORMAL) parameters in WebGL: OVERLAY draws exactly like NORMAL.
    out.normalPixel = await compare(Phaser.BlendModes.NORMAL);
    out.overlayPixel = await compare(Phaser.BlendModes.OVERLAY);
    out.multiplyPixel = await compare(Phaser.BlendModes.MULTIPLY);
    out.maxTextures = r.maxTextures;
    return out;
  });
});

assert.equal(evidence.sameBlendDraws, 1);
assert.equal(evidence.addBreaksBatch, 3);
assert.equal(evidence.litDraws, 4);
assert.equal(evidence.oneUnitDraws, 4);
assert.equal(evidence.twentyTexturesDraws, Math.ceil(24 / evidence.maxParallelTextureUnits), '4 + 20 distinct textures, one draw per full set of texture units');
assert.equal(evidence.crowdDraws, 2, '4 + 16385 quads exceed one batch of 16384');
assert.match(evidence.tree, /BatchHandlerQuad/);
assert.equal(evidence.typoLeavesCustomEmpty, true);
assert.equal(evidence.customSet, 'CountingSubmitter');
assert.ok(evidence.customRunsPerFrame >= 1);
assert.match(evidence.customTree, /CountingSubmitter/);
assert.match(evidence.duplicateRegistration, /already exists/);
assert.equal(evidence.hasNode, true);
assert.equal(evidence.addBlendModeReturn, evidence.newBlendModeSlot - 1, 'addBlendMode returns the slot below the new mode');
assert.deepEqual(evidence.returnedIndexPixel, [32, 32, 32, 255], 'the returned index draws as NORMAL');
assert.deepEqual(evidence.slotIndexPixel, [160, 128, 96, 255], 'the slot one higher is the additive mode');
assert.deepEqual(evidence.overlayPixel, evidence.normalPixel, 'OVERLAY is drawn as NORMAL in WebGL');
assert.notDeepEqual(evidence.multiplyPixel, evidence.normalPixel);
assert.deepEqual(errors, []);
console.log(JSON.stringify({ passed: true }));

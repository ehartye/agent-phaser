// Probe for skills/phaser-rendering/references/mesh2d-and-triangle-batching.md and sprite-gpu-layer-and-batching.md (Phaser 4.2.1).
//
// Purpose: count what a Mesh2D really submits for each index strategy, show that `renderAsTriangles` uses its own batch node
// and splits batches around sprites, check the tint2 / MULTIPLY_TWO difference between the two Mesh2D paths, and verify the
// SpriteGPULayer limits that fail silently: members past `size`, unknown frame names, and a container transform that the layer
// ignores. Also reports the per-member buffer size and that a layer is one instanced draw.
// Run:  node phaser-rendering-mesh-and-gpu-layer.mjs /absolute/path/to/project-with-phaser-and-playwright
// Expected: JSON evidence, then {"passed":true}. Logic probe; see phaser-rendering-harness.mjs for the stack it uses.
import assert from 'node:assert/strict';
import { runProbe } from './phaser-rendering-harness.mjs';

const { evidence, errors } = await runProbe('mesh-and-gpu-layer', async page => {
  return page.evaluate(async () => {
    const out = {};
    const { scene } = await H.boot({}, {
      create() { H.solid(this, 'white', 8, '#fff'); H.solid(this, 'black', 8, '#000'); },
    });

    // A grid of N x N cells = 2 N^2 triangles. Each cell: (tl, bl, tr) then (tr, bl, br).
    const N = 4, vertices = [], cells = [];
    for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) vertices.push(x * 10, y * 10, x / N, y / N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const tl = y * (N + 1) + x, tr = tl + 1, bl = tl + N + 1, br = bl + 1;
      cells.push([[tl, bl, tr, 0], [tr, bl, br, 0]]);
    }
    const adjacent = cells.flat(2);                                              // both triangles of a cell are neighbours in the list
    const split = [...cells.map(c => c[0]), ...cells.map(c => c[1])].flat();     // all first halves, then all second halves
    const triangles = 2 * N * N;
    const quadsDrawn = async () => (await H.draws()).indices.reduce((sum, count) => sum + count / 6, 0);
    const trisDrawn = async () => (await H.draws()).indices.reduce((sum, count) => sum + count / 3, 0);

    out.triangles = triangles;
    let mesh = scene.add.mesh2d(20, 10, 'white', vertices, adjacent);
    out.quadsDefault = await quadsDrawn();
    mesh.buildOrderedIndices(2); out.quadsBuiltButNotEnabled = await quadsDrawn();   // the list exists but useOrderedIndices is still false
    mesh.setUseOrderedIndices(true); out.quadsAfterEnable = await quadsDrawn();
    mesh.buildOrderedIndices(0, true); out.quadsStrategy0 = await quadsDrawn();
    mesh.buildOrderedIndices(1, true); out.quadsStrategy1Adjacent = await quadsDrawn();
    mesh.buildOrderedIndices(2, true); out.quadsStrategy2Adjacent = await quadsDrawn();
    mesh.destroy();
    mesh = scene.add.mesh2d(20, 10, 'white', vertices, split);
    mesh.buildOrderedIndices(1, true); out.quadsStrategy1Split = await quadsDrawn();
    mesh.buildOrderedIndices(2, true); out.quadsStrategy2Split = await quadsDrawn();
    mesh.setUseOrderedIndices(false).setRenderAsTriangles(true);
    out.trianglesDrawn = await trisDrawn();
    mesh.destroy();

    // renderAsTriangles uses BatchHandlerTri, a different batch node: it does not share a draw call with sprites.
    scene.children.removeAll(true);
    scene.add.image(10, 100, 'white');
    mesh = scene.add.mesh2d(20, 10, 'white', vertices, adjacent).buildOrderedIndices(2, true);
    scene.add.image(150, 100, 'white');
    out.spriteMeshSpriteDraws = (await H.draws()).elements;
    mesh.setRenderAsTriangles(true);
    out.spriteTriMeshSpriteDraws = (await H.draws()).elements;
    out.triTree = await H.tree();
    scene.children.removeAll(true);

    // tint2 with MULTIPLY_TWO: a black texel takes the second tint. The triangle path writes no second tint.
    // Tint modes 6 and 7 are not applied by software GL (see the textures probe), so the assertion needs a hardware stack.
    const gl = game.renderer.gl, info = gl.getExtension('WEBGL_debug_renderer_info');
    out.software = /swiftshader|llvmpipe|software/i.test(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    const probe = async asTriangles => {
      scene.children.removeAll(true);
      const m = scene.add.mesh2d(0, 0, 'black', [0, 0, 0, 0, 160, 0, 1, 0, 0, 120, 0, 1, 160, 120, 1, 1], [0, 2, 1, 0, 1, 2, 3, 0]);
      m.setTintMode(Phaser.TintModes.MULTIPLY_TWO).setTint(0xff0000).setTint2(0x0000ff).setRenderAsTriangles(asTriangles);
      return H.pixel(100, 60);
    };
    out.tint2QuadPath = await probe(false);
    out.tint2TrianglePath = await probe(true);
    scene.children.removeAll(true);

    // SpriteGPULayer.
    const layer = scene.add.spriteGPULayer(scene.textures.get('white'), 100);
    for (let i = 0; i < 150; i++) layer.addMember({ x: 5 + (i % 10) * 12, y: 5 + Math.floor(i / 10) * 8 });
    out.layerMembersAfter150Adds = layer.memberCount;
    layer.addMember({ x: 0, y: 0, frame: 'no-such-frame' });
    out.layerMembersAfterBadFrame = layer.memberCount;
    layer.resize(120);                                   // size is a maximum; growing it is an explicit call
    layer.addMember({ x: 0, y: 0 });
    out.layerMembersAfterResize = layer.memberCount;
    out.bytesPerMember = layer.getDataByteSize();
    const d = await H.draws();
    out.layerDraws = { elements: d.elements, instanced: d.instanced };
    layer.destroy();

    const one = scene.add.spriteGPULayer(scene.textures.get('white'), 4);
    one.addMember({ x: 40, y: 40, scaleX: 2, scaleY: 2 });
    const box = scene.add.container(60, 0, [one]);
    out.containerIgnored = { atOwnPosition: await H.pixel(40, 40), atContainerOffset: await H.pixel(100, 40) };
    box.destroy();
    return out;
  });
});

assert.equal(evidence.quadsDefault, evidence.triangles, 'default: one quad per triangle');
assert.equal(evidence.quadsBuiltButNotEnabled, evidence.triangles, 'buildOrderedIndices(2) alone does not switch the list on');
assert.equal(evidence.quadsAfterEnable, evidence.triangles / 2);
assert.equal(evidence.quadsStrategy0, evidence.triangles, 'strategy 0 pairs nothing');
assert.equal(evidence.quadsStrategy1Adjacent, evidence.triangles / 2);
assert.equal(evidence.quadsStrategy2Adjacent, evidence.triangles / 2);
assert.equal(evidence.quadsStrategy1Split, evidence.triangles, 'strategy 1 only pairs list neighbours');
assert.equal(evidence.quadsStrategy2Split, evidence.triangles / 2, 'strategy 2 finds partners anywhere');
assert.equal(evidence.trianglesDrawn, evidence.triangles);
assert.equal(evidence.spriteMeshSpriteDraws, 1);
assert.equal(evidence.spriteTriMeshSpriteDraws, 3);
assert.match(evidence.triTree, /BatchHandlerTri\b/);
if (evidence.software) console.log('software GL: tint2 assertions skipped (set PROBE_GL=hardware on a machine with a GPU)');
else {
  assert.deepEqual(evidence.tint2QuadPath.slice(0, 3), [0, 0, 255], 'quad path applies tint2');
  assert.deepEqual(evidence.tint2TrianglePath.slice(0, 3), [0, 0, 0], 'triangle path drops tint2');
}
assert.equal(evidence.layerMembersAfter150Adds, 100);
assert.equal(evidence.layerMembersAfterBadFrame, 100);
assert.equal(evidence.layerMembersAfterResize, 101);
assert.equal(evidence.layerDraws.instanced, 1);
assert.equal(evidence.layerDraws.elements, 0);
assert.deepEqual(evidence.containerIgnored.atOwnPosition.slice(0, 3), [255, 255, 255], 'members stay at world coordinates');
assert.deepEqual(evidence.containerIgnored.atContainerOffset.slice(0, 3), [0, 0, 0], 'the container offset is ignored');
assert.deepEqual(errors, []);
console.log(JSON.stringify({ passed: true }));

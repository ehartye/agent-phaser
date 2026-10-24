# Mesh2D and triangle batching (4.2.0)

Mesh2D draws textured triangles in 2D and batches with sprites. It is not the removed Phaser 3 Mesh or Plane and has no 3D, bones or depth buffer. Every [tested] label is asserted by `node examples/web/phaser-probes/phaser-rendering-mesh-and-gpu-layer.mjs /absolute/path/to/project-with-phaser-and-playwright` (run on software GL; the tint2 lines need `PROBE_GL=hardware` and are skipped otherwise).

## Data and API

```js
const mesh = this.add.mesh2d(x, y, 'atlasKey', vertices, indices, flipV);
// vertices: [x, y, u, v, x, y, u, v, ...]   indices: [a, b, c, page, a, b, c, page, ...]
mesh.buildOrderedIndices(2, true);          // once, when the topology is stable
```

- [documented] The factory name is `mesh2d`. Vertices step 4 (`x, y, u, v`), indices step 4 (`a, b, c, page`, `page` is the texture source index, usually 0). UVs are yours: frame data is not used, so pack atlas UVs by hand. `flipV` for UVs authored top-down (`src/gameobjects/mesh2d/Mesh2D.js`).
- [documented] Components: alpha, blend mode, depth, flip, lighting, origin, scroll factor, texture crop, transform, visible; tint comes from its own `tint`, `tint2`, `tintMode`. There is no Mask component (use the Mask filter) and no skinning API: move vertices yourself.
- [documented] Vertex positions may change every frame without rebuilding anything; only the triangle list needs a rebuild (`buildOrderedIndices`) when the topology changes.

## Strategies

| Strategy | What is submitted | Batches with sprites |
| --- | --- | --- |
| default (unordered) | one quad per triangle, the fourth corner repeats vertex c | yes |
| `buildOrderedIndices(0 or omitted)` | the same, no pairing | yes |
| `buildOrderedIndices(1)` | pairs a triangle with the next one in the list if they share an edge | yes |
| `buildOrderedIndices(2)` | pairs by a global edge map, any order | yes |
| `renderAsTriangles = true` | individual triangles through BatchHandlerTri | no, its own node |

- [tested] A 4 by 4 cell grid is 32 triangles. Default and strategy 0 submitted 32 quads. Strategy 1 submitted 16 when each cell's two triangles are neighbours in the list and 32 when the list was ordered first halves then second halves. Strategy 2 submitted 16 in both orders. Triangle mode submitted 32 triangles. Strategy 0 ("fast" in the class comment) is only the cheapest to build: it pairs nothing and submits what the default does. The numbers are the quad count passed to `drawElements`.
- [tested] `buildOrderedIndices(2)` with no second argument builds the list but leaves `useOrderedIndices` false, so the mesh still submitted 32 quads until `setUseOrderedIndices(true)` (or `buildOrderedIndices(2, true)`) switched it on.
- [documented] Pairing halves the quads: 4 vertices and 6 indices per two triangles instead of 8 and 12 (`src/gameobjects/mesh2d/Mesh2D.js`). Strategy 2 builds an edge map (an object keyed by edge), so call it at load or on topology change, never per frame.
- [general] Pick: static or rarely changing topology, strategy 2 (or strategy 1 if you author the list in cell order); topology that changes every frame (cutting, tearing, metaballs), `renderAsTriangles`; anything you do not need as a mesh, sprites.

## Batching with sprites

- [tested] Sprite, quad-strategy mesh, sprite: 1 draw. Sprite, `renderAsTriangles` mesh, sprite: 3 draws, because BatchHandlerTri is a different node and each switch flushes the other. Group triangle-mode meshes in one depth band, or avoid interleaving them with sprites.
- [documented] Batch capacity is 16384 instances for both nodes; the quad node's vertex layout, shader, lighting and texture-unit rules are shared (`BatchHandlerTri` extends `BatchHandlerQuad`). Lighting disables multi-texturing as for sprites ([overview](render-system-overview.md)); a rotated UV rotates the apparent light direction on normal maps.

## Cost and limits

- [documented] Every vertex is transformed on the CPU each frame: `TransformerVertex.setupMatrix` runs once per mesh, `transformVertex` once per vertex (`SubmitterMeshToQuad.js`). Cost scales with triangles times frames. Bake static decoration into a DynamicTexture ([textures](textures-and-render-targets.md)) or use a [GPU layer](sprite-gpu-layer-and-batching.md) for repeated quads.
- [documented] Pages: a triangle's `page` picks `texture.source[page]`, so one mesh can use a multi-source atlas, but each distinct source in a batch consumes a texture unit.
- [tested] MULTIPLY_TWO with `tint2`: on a hardware GL stack a black texel became the second tint on the quad path, but stayed black on the `renderAsTriangles` path. `BatchHandlerTri.batchTriangles` writes `tintEffect << 24` for the second tint and never reads `tint2` (`src/renderer/webgl/renderNodes/BatchHandlerTri.js`). Use an ordered-index strategy whenever you use `tint2`; report upstream if you depend on it.
- [documented] Vertex rounding follows `vertexRoundMode` (default `safeAuto`): vertices round only when the camera has `roundPixels` and the mesh is neither rotated nor scaled (`TransformerVertex.js`, `MIGRATION-GUIDE.md` section 16), so a rotating pixel-art mesh does not snap.

## Verify

- [tested] Count what was submitted, not what you built: wrap `renderer.drawElements`, sum the `count` argument, and divide by 6 for the quad node or 3 for BatchHandlerTri.
- [general] Compare frame time with the strategies swapped on the target device before choosing; the saving is vertex writes and index entries, which only matter above a few thousand triangles.

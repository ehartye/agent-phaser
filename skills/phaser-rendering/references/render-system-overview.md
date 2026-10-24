# How a Phaser 4.2.1 object reaches the GPU: render nodes, batches and draw calls

Read this before touching batching, writing a custom render node, or debugging a render that is wrong. Every [tested] label is asserted by `node examples/web/phaser-probes/phaser-rendering-render-graph.mjs /absolute/path/to/project-with-phaser-and-playwright` (software GL passes; `PROBE_GL=hardware` uses the platform GPU).

## The path from object to draw call

- [documented] `renderWebGLStep` walks the object's `_renderSteps` array (`src/gameobjects/components/RenderSteps.js`). Filters, Stencil and CustomContext insert steps; every step must call the next one with `renderStep + 1` or the object draws nothing, and a missing step returns silently.
- [documented] The last step is `renderWebGL`, which runs the object's render-node roles: `customRenderNodes[role] || defaultRenderNodes[role]` for Submitter (fills one quad), Transformer, Texturer and BatchHandler (`src/gameobjects/image/ImageWebGLRenderer.js`). A BatchHandler only stores vertices; it draws when something flushes it.
- [documented] Anything that changes the `DrawingContext` (blend mode, framebuffer, scissor, stencil, alpha strategy) clones it and calls `use()`, which flushes the current batch (`src/renderer/webgl/DrawingContext.js`, `ListCompositor.js`).

| Object | Submitter | Batch handler | Notes |
| --- | --- | --- | --- |
| Image, Sprite, Text, BitmapText, Blitter, Particles, Video, Stamp | SubmitterQuad | BatchHandlerQuad | share batches |
| NineSlice, CaptureFrame | (own render function) | BatchHandlerQuad | share batches |
| Mesh2D | SubmitterMeshToQuad | BatchHandlerQuad, or BatchHandlerTri when `renderAsTriangles` | see [Mesh2D](mesh2d-and-triangle-batching.md) |
| TileSprite, CPU TilemapLayer | SubmitterTileSprite, SubmitterTile | BatchHandlerTileSprite | own shader |
| Graphics, Shape | BatchHandlerTriFlat | | untextured |
| Rope, PointLight | | BatchHandlerStrip, BatchHandlerPointLight | |
| Shader, Noise, TilemapGPULayer, SpriteGPULayer | stand-alone | none | one draw each, flushes the batch |

- [documented] Table source: `src/renderer/webgl/renderNodes/defaults/Default*Nodes.js`. Two quad-batch limits: 16384 quads per batch (`render.batchSize`, indices are 16-bit) and `renderer.maxTextures` texture units per draw.

## What splits a batch

- [tested] Four images from four textures: 1 draw. One ADD image between normal ones: 3 draws. The same four images with `setLighting(true)`: 4 draws, because lighting turns multi-texturing off and a texture change starts a new draw.
- [tested] `renderNodes.setMaxParallelTextureUnits(1)` (what `render.autoMobileTextures`, default true, applies on a non-desktop device) turns those four textures into 4 draws. 24 distinct textures on a 16-unit device draw twice; 16385 quads of one texture draw twice.
- [documented] Also splitting: filters, a different shader (object family), lighting or self-shadow differences, `smoothPixelArt` variants (`src/renderer/webgl/renderNodes/BatchHandlerQuad.js` `updateRenderOptions`). Interleaving families in depth order (sprite, graphics, sprite) costs three batches.
- [general] Fixes in order: one atlas per family, sort by blend mode and family within a depth band, light only what needs it, keep stand-alone objects together.
- [tested] Count draws by wrapping `game.renderer.drawElements` and `drawInstancedArrays`; every Phaser draw passes through them, so no GL-context patching is needed.

```js
const r = game.renderer, n = { draws: 0 };
for (const k of ['drawElements', 'drawInstancedArrays']) { const f = r[k]; r[k] = function () { n.draws++; return f.apply(this, arguments); }; }
// reset n.draws = 0 at the start of a frame, read it after 'postrender'
```

## See the render graph

- [tested] `game.renderer.renderNodes.setDebug(true)`, wait one frame, then `renderNodes.debugToString()` prints the nodes that ran, nested by caller. A `BatchHandlerQuad` line is a call to its `run` (a flush attempt), not a construction, and an empty batch returns without drawing, so read flush positions from it and take draw counts from the wrapper above. Normal, ADD, normal prints:

```
Camera
  ListCompositor
    SubmitterQuad (+ TexturerImage, TransformerImage, BatchHandlerQuad)
    BatchHandlerQuad                  <- flush when the ADD context starts
    SubmitterQuad (+ TexturerImage, TransformerImage)
    BatchHandlerQuad                  <- flush when the context returns to NORMAL
    SubmitterQuad (+ TexturerImage, TransformerImage)
  BatchHandlerQuad                    <- final flush at the end of the camera
```

- [general] Read it for: an object missing entirely (culled, invisible or a broken step), a node you did not expect (a filter, a CaptureFrame), and flushes between objects that should batch.

## Writing and registering a custom render node

```js
const { SubmitterQuad } = Phaser.Renderer.WebGL.RenderNodes;
class TracedSubmitter extends SubmitterQuad {
  constructor(manager) { super(manager, { name: 'TracedSubmitter' }); }
  run(...args) { /* before */ return super.run(...args); }
}
new Phaser.Game({ render: { renderNodes: { TracedSubmitter } } /* ... */ });
sprite.setRenderNodeRole('Submitter', 'TracedSubmitter');
```

- [tested] A node registered through `render.renderNodes` is built lazily with `new Ctor(manager)` and then runs in place of the default for that object; it shows in the debug tree.
- [tested] `setRenderNodeRole('Submitter', 'TypoName')` is a silent no-op (`getNode` returns null, `customRenderNodes` stays empty). Check `sprite.customRenderNodes.Submitter` after setting.
- [tested] Registering the same name twice throws `node constructor X already exists.`; scene code that registers in `create()` must guard with `renderer.renderNodes.hasNode(name)` because scenes restart.
- [documented] Copy the argument list of the role you replace from its source node; call `onRunBegin` and `onRunEnd` so the debug tree shows it; never call `gl` directly, use the wrappers, or run the GL work inside an `Extern` game object, which resets state afterwards (`changelog/v4/4.0/MIGRATION-GUIDE.md`).
- [documented] For per-object data use `setRenderNodeRole(role, name, data)` and `setRenderNodeData`; the data is keyed by the node's own `name`.

## What replaced Phaser 3 pipelines

- [documented] `setPipeline('Light2D')` is `setLighting(true)`; custom pipelines are render nodes; PostFX pipelines and preFX/postFX are [filters](filters.md); `BitmapMask` and WebGL `GeometryMask` are the Mask filter. `Mesh` and `Plane` were removed (Mesh2D arrived in 4.2.0). Shader texture coordinates are Y-up (`changelog/v4/4.0/MIGRATION-GUIDE.md`).
- [tested] WebGL implements only NORMAL, ADD, MULTIPLY, SCREEN and ERASE. OVERLAY, DARKEN and the other canvas modes draw exactly like NORMAL; use the Blend filter through a CaptureFrame or DynamicTexture.
- [tested] `renderer.addBlendMode(func, equation)` returns the slot below the one it created (27 for slot 28), so `setBlendMode(returned)` draws NORMAL. Use `renderer.blendModes.length - 1` right after the call.
- [documented] `sprite.setMask()` in WebGL logs a warning and does nothing (`src/gameobjects/components/Mask.js`).

## Where to look when something draws wrong

- [general] For script-driven inspection in general (scene-graph dumps, missing textures, console capture) see [debugging a Phaser game](../../phaser-verification/references/debugging-a-phaser-game.md). Renderer order: is the renderer WebGL (`game.renderer.type === Phaser.WEBGL`; on Canvas `enableFilters()` returns early and `obj.filters` stays null); read the render tree; count draws; remove the suspect feature (lighting, filter, blend) and see what the count and the tree do; then compare on a hardware GPU, because software GL does not apply every tint mode ([textures](textures-and-render-targets.md)).
- [general] Shader compile errors throw from the render loop (`Fragment Shader failed`) and stop it; a blank canvas plus a page error means a shader, not a missing object.
- [general] Blank or stale after focus loss or restore is a lifecycle problem: [context loss](phaser-4-webgl-context-gotchas.md), [renderer destruction](phaser-4-renderer-destruction-gotchas.md).

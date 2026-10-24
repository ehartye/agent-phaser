# Many sprites: SpriteGPULayer, Blitter, batching and what to measure

Pick the object by how often its data changes, not by how many there are. Every [tested] label is asserted by `node examples/web/phaser-probes/phaser-rendering-mesh-and-gpu-layer.mjs` and `phaser-rendering-render-graph.mjs` in `examples/web/phaser-probes` (each takes `/absolute/path/to/project-with-phaser-and-playwright`; draw counts and limits are stack independent).

## Choose

| You have | Use | Why |
| --- | --- | --- |
| Interactive or moving sprites, up to some thousands | Image or Sprite, one atlas, one blend mode | batches to one draw per 16384 quads |
| Many simple moving things: position, alpha, tint, flip, one texture | Blitter | no per-object GameObject cost; Bobs cannot scale or rotate |
| Short-lived effects | ParticleEmitter | batched quads, pooled particles |
| Static or looping background decoration, thousands to millions | SpriteGPULayer | one instanced draw, no per-frame upload |
| A tile grid | TilemapGPULayer ([worlds](../../phaser-worlds/SKILL.md)) | one quad, cost per pixel |
| Rarely changing composite of many objects | DynamicTexture bake | one quad per frame ([textures](textures-and-render-targets.md)) |
| Grouping for transform, depth or a filter | Container or Layer | grouping only; children still batch individually |

- [documented] Phaser's own guidance is tens of thousands of ordinary sprites with good performance, against a layer "a hundred times faster" because its data is uploaded once (`docs/Phaser 4 Rendering Concepts`). [general] Treat both figures as hardware dependent and measure on the target device ([measuring](../../phaser-verification/references/performance.md)).

## SpriteGPULayer

```js
const layer = this.add.spriteGPULayer('leavesAtlas', 200000);   // key or Texture; size is a maximum
const m = { x: 0, y: 0, frame: 'leaf', scaleX: 1, scaleY: 1, alpha: 1 }; // reuse ONE object
for (let i = 0; i < 200000; i++) { m.x = xs[i]; m.y = ys[i]; layer.addMember(m); }
```

- [tested] A layer is one instanced draw (`drawInstancedArrays` 1, `drawElements` 0) and each member is 168 bytes (`layer.getDataByteSize()`).
- [documented] Members are held on both the CPU and the GPU side, so a million members is about 168 MB twice (`docs/Phaser 4 Rendering Concepts`). Edits (`editMember`, `patchMember`, `removeMembers`, `addMember`) re-upload the buffer, in 24 segments at best; populate once.
- [tested] `size` is a hard maximum: 150 `addMember` calls on a size-100 layer left `memberCount` at 100 with no error, `resize(120)` allowed one more. An unknown `frame` name is also skipped silently. Check `memberCount === expected` after population.
- [tested] The layer has no Transform: members live in world coordinates, and a layer inside a Container ignores the Container's position and scale (the member stayed at its own x and drew nothing at the offset). Move members, not the layer; per-member `scrollFactorX` and `scrollFactorY` give parallax.
- [documented] One texture, one image: no multi-atlas. Use a power-of-two texture for pixel art or pad each frame by a pixel to avoid seams. No Mask component since 4.2.0. Members take `tintMode`, `tintBlend` and four corner tints, and a mode that needs a second colour sees black (`src/gameobjects/spritegpulayer/typedefs/Member.js`); lighting works.
- [documented] Member values can animate on the GPU (`{ base, amplitude, duration, delay, ease, loop, yoyo }`); eases compile into the shader, so use all the eases you need in the first members, because a new animation after the first compile rebuilds the shader and frame texture. Late members take a `creationTime` against `layer.timeElapsed`.
- [documented] "Remove" a member from a grid by setting its scale and alpha to 0 instead of splicing, which shifts every later index and re-uploads the buffer. Fill rate still applies: keep large quads to a few million pixels per frame.

## Blitter and Container

- [documented] A Blitter binds one texture; Bobs have position, alpha, tint, flip and a frame, no scale or rotation, and render through the same quad batch (`src/gameobjects/blitter/Blitter.js`). Since 4.2.0 a Blitter destroys its Bobs when it is destroyed.
- [general] A Container does not make its children cheaper; it adds a transform multiply and, with a filter, a framebuffer. Use a Layer for depth grouping without a transform.

## Batching rules that decide sprite cost

- [tested] One draw per 16384 quads, per set of texture units (16 on the stack tested), and per blend or lighting change ([overview](render-system-overview.md)). Four textures batch, an ADD in the middle makes three draws, lighting makes one draw per texture.
- [documented] Atlas frames need at least 1 px of padding or extrusion: linear sampling bleeds neighbours (`docs/Phaser 4 Rendering Concepts`). Text redraws its whole texture on any change, BitmapText does not.
- [general] Order the display list by blend mode and family within each depth band; avoid per-sprite `setLighting` or filters; share one atlas per scene layer.

## Measure

- [tested] Wrap `renderer.drawElements` and `renderer.drawInstancedArrays` for one frame and print counts, then compare against the batching rules above; the render-node debug tree shows where flushes occur.
- [general] If draws are few but frames are slow, the cost is fill rate (layers, large filtered areas) or CPU submission (sprites per frame); switch the suspect object type and re-measure.

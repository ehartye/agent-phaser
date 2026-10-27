---
name: phaser-rendering
description: Drive the Phaser 4.2 WebGL renderer - render nodes, batching and draw calls, filters (blur, glow, mask, color matrix, and the pixel-art Blocky, Pixelate, Quantize and GradientMap), Stencil and CustomContext, Mesh2D, SpriteGPULayer, render and dynamic textures, tint and blend modes, smoothPixelArt at a fractional zoom, Shader objects and custom filters, WebGL 1 versus 2 - and diagnose a render that is blank, doubled, stale, clipped, wrong-coloured or lost after a context loss. Use when adding or debugging a filter, mask, stencil, shader, render texture, mesh or large sprite layer, when a Phaser 3 pipeline, FX or mask must be ported, or when picking which Phaser 4 rendering feature fits an effect. Not for tilemaps and lighting (phaser-worlds), pixel-exact UI and clipped panes (phaser-pixel-ui), measuring frame cost or proving pixels on a GPU (phaser-verification), or shaders in a custom engine (engine-custom-shaders).
---

# Phaser rendering

Phaser 4 replaced the Phaser 3 renderer with render nodes, filters and GPU layers, so Phaser 3 sample code often does not apply. Written for 4.2.1; version-sensitive claims carry their version. Read the reference that matches the work, not all of them.

## Which feature for which effect

| Effect | Use | Watch for |
| --- | --- | --- |
| Screen grade, blur, vignette | camera filters | 3 to 10 draws; camera fade is filtered too |
| Glow, outline, shadow on one object | internal Glow or Shadow | padding is off until `setPaddingOverride(null)` |
| Soft or animated clip | Mask filter | a per-frame render unless `autoUpdate = false` |
| Hard, shared hole or window | Stencil, ended by a `clear` Stencil | it leaks into later scenes |
| Rectangle clip | CustomContext scissor | no framebuffer, pixel coordinates |
| Heavy composite that rarely changes | DynamicTexture or RenderTexture | nothing draws before `render()` |
| Static decoration, thousands to millions | SpriteGPULayer | fill once; no Transform |
| Moving sprites | Image or Sprite, one atlas | blend, lighting and texture changes split batches |
| Deformable textured polygon | Mesh2D, `buildOrderedIndices(2, true)` | CPU cost per vertex |
| Procedural quad | Shader, Gradient, Noise | no alpha; write premultiplied colour |
| Custom post effect | custom filter | register the node; fresh additions array |
| Two-colour tint | `MULTIPLY_TWO` with `setTint2` | check on a hardware GPU |
| OVERLAY, DARKEN or another canvas blend mode | camera Blend filter fed a camera-sized DynamicTexture | fill it neutral gray, keep it opaque |

- [tested] The table is backed by eight probes in `examples/web/phaser-probes/phaser-rendering-*.mjs`; each reference names the one that asserts its claims.

| You are about to | Read |
| --- | --- |
| Reason about batching, count draw calls, read the render tree, write a custom render node, or port a pipeline | [Render system overview](references/render-system-overview.md) |
| Add or debug a filter, mask, blur or glow; choose filter versus shader versus stencil | [Filters](references/filters.md) |
| Pixelate, posterise or recolour pixel art (Blocky, Pixelate, Quantize, GradientMap), or choose `smoothPixelArt` for a fractional zoom | [Pixel-art filters](references/pixel-art-filters.md) |
| Use Stencil, StencilReference, CustomContext or an alpha strategy | [Stencil and CustomContext](references/stencil-and-custom-context.md) |
| Draw a deformable textured polygon | [Mesh2D](references/mesh2d-and-triangle-batching.md) |
| Draw thousands of sprites or choose between sprite, Blitter and layer | [SpriteGPULayer and batching](references/sprite-gpu-layer-and-batching.md) |
| Use a RenderTexture or DynamicTexture, a tint mode, `tint2` or a blend mode | [Textures and render targets](references/textures-and-render-targets.md) |
| Write a Shader object or a custom filter, or touch GLSL | [Custom shaders](references/custom-shaders-in-phaser.md) |
| Choose WebGL 1 or 2, supply a context, or ask about Phaser AE | [WebGL backends](references/webgl-backends.md) |
| Hit a render that is blank, doubled, stale, wrong-coloured or throws | [Gotchas index](references/phaser-4-gotchas.md): [API and effects](references/phaser-4-api-and-effects-gotchas.md), [context loss](references/phaser-4-webgl-context-gotchas.md), [renderer destruction](references/phaser-4-renderer-destruction-gotchas.md) |

## Rules that earned their place

- [tested] **Look and count first.** Wrap `renderer.drawElements` and `drawInstancedArrays`, and capture `renderNodes.setDebug(true)` then `debugToString()`. Four textures are one draw, an ADD image between them makes three, lighting makes four.
- [tested] **Silent no-ops are the common failure.** A mistyped `setRenderNodeRole`, a `SpriteGPULayer` past its `size` or with an unknown frame, `buildOrderedIndices` without enabling the list, a missing `render()`, a command queued inside `callback()`, OVERLAY and other canvas blend modes, and `render.stencil: false` with a Stencil all do nothing without an error.
- [tested] **Phaser's own docs and API have traps.** `updateShaderConfig` receives `(drawingContext, gameObject, node)`; custom filter `shaderAdditions` must be an array; filter padding is not automatic; the noise factories are lowercase (`noisecell2d`); `addBlendMode` returns the slot below the new one.
- [tested] **Verify on real hardware.** Headless software GL drew HARD_LIGHT and MULTIPLY_TWO untinted; a supplied WebGL 2 context breaks `smoothPixelArt`, Gradient, GradientMap and noise normal maps. Print the renderer string (`WEBGL_debug_renderer_info`) with every pixel claim.
- [documented] **Phaser 3 advice that is now wrong:** `setPipeline`, `preFX` and `postFX`, `BitmapMask` (removed) and `setMask` (a warning, then nothing), `setTintFill`, Mesh and Plane, and canvas blend modes in WebGL. Use filters, `setLighting(true)`, tint modes and Mesh2D.
- [general] **Isolate before theorising.** Build the smallest standalone object that should work inside the live scene and compare it with the real pipeline; this found several Phaser bugs in minutes.
- [tested] **Version-pinned patches carry a removal condition.** The install-time patches in `scripts/assets` target Phaser 4.2.1 exactly, fail on any other version and say what makes them unnecessary (`tests/phaser-patches-pinned.test.mjs`).

## Not covered here

Tilemap layers and lighting are [phaser-worlds](../phaser-worlds/SKILL.md). Pixel-exact canvas rules and scroll panes are [phaser-pixel-ui](../phaser-pixel-ui/SKILL.md). Frame budgets and GPU pixel proof are [phaser-verification](../phaser-verification/SKILL.md).

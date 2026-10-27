# Phaser 4.2.1 filters: choosing, padding, cost and order

Filters replace Phaser 3 FX, masks and PostFX pipelines. Phaser's own API tour is `node_modules/phaser/skills/filters-and-postfx/SKILL.md`; this page adds the decisions and the traps. Every [tested] label is asserted by `node examples/web/phaser-probes/phaser-rendering-filters.mjs /absolute/path/to/project-with-phaser-and-playwright` (draw counts and flags are stack independent; run it on software or hardware GL).

## Choose the tool for the effect

| Effect | Use | Instead use something else when |
| --- | --- | --- |
| Recolour or grade the whole screen | camera ColorMatrix | the grade must skip the HUD: put the HUD on its own camera or scene |
| Glow, outline, drop shadow on one object | internal Glow or Shadow with auto padding | many identical objects: bake once into a DynamicTexture |
| Soft, animated or per-frame shaped clip | Mask filter | a hard edge reused by many objects: [Stencil](stencil-and-custom-context.md) |
| Plain rectangular clip | CustomContext scissor | the clip is not axis aligned: Mask filter |
| Blur, bloom, vignette, wipe | camera filters (bloom: `ParallelFilters` or `Phaser.Actions.AddEffectBloom`) | a fixed background: pre-render it |
| An expensive result that rarely changes | RenderTexture or DynamicTexture ([textures](textures-and-render-targets.md)) | it changes every frame |
| Procedural pattern, not a post effect | Shader, Gradient, Noise ([shaders](custom-shaders-in-phaser.md)) | the input is existing pixels: filter |
| A pixel effect Phaser lacks | custom filter ([shaders](custom-shaders-in-phaser.md)) | a built-in chain already reproduces it |

- [documented] Each filter is a pass: `BaseFilterShader#run` takes an output `DrawingContext` from the pool (`drawingContextPool.get`), draws the input through the shader and releases the input (`src/renderer/webgl/renderNodes/filters/BaseFilterShader.js`).
- [tested] Adding a Blocky filter to a camera that already had a Blur added one draw (9 to 10) at the full 160 x 120 size (`phaser-rendering-pixel-filters.mjs`, `passes`). Filters are the expensive end of the toolbox.
- [general] Prefer one camera or Layer filter over a filter per object.

## Internal, external and what runs first

- [documented] The camera node runs: background, children, flash, fade, internal filters, camera transform, external filters, output (`src/renderer/webgl/renderNodes/Camera.js`). Internal filters see an untransformed, bounds-sized image (a blur on a rotated object rotates with it); external filters see the transformed, camera-sized image. Phaser's illustrated explanation is `docs/Phaser 4 Internal Space Guide`.
- [tested] Camera flash and fade are inside the filtered image: a red `camera.fade` seen through a grayscale ColorMatrix was gray for both an internal and an external filter. Keep fades unfiltered by drawing them on a camera or scene that has no filter, or with an overlay object after the filtered camera.
- [documented] A camera with `alpha < 1` or `setForceComposite(true)` renders through a framebuffer even with no filters (`Camera.js` `useFramebuffers`); [tested] each costs one extra draw.
- [documented] `Stencil` and `CustomContext` add their steps at index 0 and run before the filter step; since 4.2.0 the filter step sits directly before the core render step, so other steps can wrap it.

## Padding (4.1.0 and later)

- [tested] A new controller's `paddingOverride` is an empty Rectangle, not null, so a Blur clips at the object's bounds: a blurred 16 px square showed no spill outside its edge until `controller.setPaddingOverride(null)`, then the red channel 4 px outside the edge rose from 0 to 48. Phaser's filters skill says padding is automatic; it is opt-in.
- [documented] Glow, Shadow, Bokeh and Displacement use the same `paddingOverride` check in `getPadding` (`src/filters/`), so expect the same clipping and the same fix.
- [tested] Default Blur (x 2, y 2, 4 steps) needs 11 px on every side (`getPaddingCeil()`); [documented] Glow pads `ceil(distance * scale)`; Blur pads `ceil(x * steps * strength * k)` with k 1.33, 3.23 or 5.18 for quality 0, 1, 2 (`src/filters/Blur.js`). Explicit padding is `setPaddingOverride(left, top, right, bottom)`.
- [documented] 4.1.0: custom render nodes must call `controller.getPaddingCeil()`, not `getPadding()`, to avoid fractional-padding blur. A custom controller has zero padding until you set it or implement `getPadding`.
- [documented] For a camera filter that samples outside the view, `camera.getPaddingWrapper(n)` enlarges the camera instead.

## Cost model

| Case (one sprite scene) | Draws |
| --- | --- |
| nothing | 1 |
| camera ColorMatrix, or Glow | 3 |
| external Vignette only | 2 |
| Blur, 4 steps (any quality) | 10 (2 + 2 per step; 1 step is 4) |
| `Phaser.Actions.AddEffectBloom(camera)` | 11 |
| camera `alpha` 0.5, or `setForceComposite(true)` | 2 |
| Mask from a Graphics object | 4 |
| filter on one of three sprites | 4 instead of 1 |

- [tested] `AddEffectBloom` returns an array, one entry per recipient, so `AddEffectBloom(camera)[0].parallelFilters.destroy()` removes it; Phaser's third doc example destructures the return as an object, which is wrong.
- [documented] It adds its filters to the external list unless `config.useInternal`, and it suits full-screen use only: on an object with alpha regions the glow cannot blend correctly (`src/actions/AddEffectBloom.js`).
- [tested] The table is measured by wrapping `renderer.drawElements`. Blur `quality` changes the shader, not the pass count; a filtered object also splits the batch around it.
- [documented] Each pass renders into a pooled `DrawingContext` keyed by exact `width x height` (`DrawingContextPool.js`); sizes that change every frame (animated padding, a growing object) resize framebuffers. A framebuffer is 4 bytes per pixel plus 1 byte for stencil while `render.stencil` is true.
- [tested] Pooled framebuffers outlive their filters: six stayed after a blur was removed and after the pool's 1000 ms `maxAge`, because nothing in 4.2.1 calls `pool.prune()`. `renderer.drawingContextPool.clear()` freed all six. Call it after a heavy scene (a pause blur, a transition) if memory matters; Phaser's Rendering Concepts guide says idle framebuffers are destroyed, the 4.2.1 source does not.
- [tested] Filter and DynamicTexture framebuffers are sampled LINEAR by default and NEAREST when `render.antialias` is false (`pixelArt: true` sets it); a filter on pixel art without that setting is blurred when scaled.

## What the filter focuses on

- [tested] A Layer (a real GameObject since 4.1.0) filters everything in it and always focuses on the camera. A Container with no size focuses on the camera too (full-screen cost for a small widget); set its size before `enableFilters()` to focus on its bounds.
- [documented] Shapes also default to camera focus (`src/gameobjects/shape/Shape.js`). Override with `focusFiltersOverride(x, y, w, h)`; `maxFilterSize` defaults to the GPU's maximum texture size (`src/gameobjects/components/Filters.js`).
- [documented] `enableFilters()` is silent on Canvas (it returns early), so `obj.filters` is null and the next `obj.filters.internal` throws.

## Masks

- [documented] A Mask filter with a game-object source re-renders that object into a DynamicTexture the size of the filter's drawing context (the object's region for an internal mask, the camera for an external one) every frame while `autoUpdate` is true; for a static shape set `autoUpdate = false` and trigger `needsUpdate = true` when it changes, and keep `scaleFactor` at 1 for crisp edges (`src/filters/Mask.js`).
- [documented] Each such mask owns a DynamicTexture, so gotcha 24 (wrapper leak) and gotcha 23 (restore) in [context loss](phaser-4-webgl-context-gotchas.md) apply to it. Scrolling panes: [clipped scrolling](../../phaser-pixel-ui/references/pixel-ui-clipped-scrolling.md).
- [documented] `ignoreDestroy = true` keeps a controller alive when its list is destroyed; you then own its lifecycle.

## Custom filters and list order

- [tested] A fragment-only `BaseFilterShader` registered through `render.renderNodes` and added with `obj.filters.internal.add(new Controller(obj.filterCamera))` ran; build it as in [custom shaders](custom-shaders-in-phaser.md), including the two construction traps.
- [tested] Order inside a list is draw order: Blocky then Blur ends soft, Blur then Blocky ends on blocks. It does not change the cost: Blocky with Blur and Pixelate with Blur each asked the pool for the same framebuffers (36 requests, all 160 x 120) and made the same 10 draws in either order, so no filter here shrinks the work of the one after it. Choose the order for the look; Quantize was not measured.

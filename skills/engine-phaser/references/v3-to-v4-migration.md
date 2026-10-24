# Phaser 3 to 4: what breaks, what to ignore (4.2.1)

A decision map for moving an old codebase, or for reading old tutorials, answers and training-data code. Phaser's full guide is `changelog/v4/4.0/MIGRATION-GUIDE.md` and `node_modules/phaser/skills/v3-to-v4-migration/SKILL.md`; this file says which parts matter for what your code uses, which Phaser 3 advice is now wrong, and how to find the hits. `[tested]` ones are check ids of the [foundations probe](../../../examples/web/phaser-probes/engine-phaser-foundations.mjs) or the pattern test named below.

## Decide first

| The old code uses | Effort | Do |
| --- | --- | --- |
| Scenes, loader, input, audio, tweens, timers, Arcade or Matter, Tiled maps on CPU layers, camera scroll and zoom | Small | Bump the version, fix the config defaults, compare screenshots |
| `postFX`, `preFX`, `BitmapMask`, `GeometryMask`, `setPipeline`, custom pipelines, `Light2D` | Rewrite those parts | Filters, the `Mask` filter, render nodes, `setLighting(true)` ([phaser-rendering](../../phaser-rendering/SKILL.md)) |
| `Mesh`, `Plane`, OBJ files, bundled Spine plugins, `Create.GenerateTexture`, Camera3D | Replace | `Mesh2D` (4.2.0) for textured triangles, Esoteric's official Spine plugin, canvas textures |
| `RenderTexture` or `DynamicTexture` drawing, `Shader` objects, compressed textures, third-party plugins built on pipelines | Test each | Behaviour changed without a compile error; see the silent list |
| Reliance on the Canvas renderer | Plan out | It is deprecated and lacks every Phaser 4 effect |

- [documented] The migration guide lists no breaking change for scenes, loader, input, audio, tweens, timers or physics; its breaking list is the renderer, filters and masks, tint, camera matrices, texture orientation, `DynamicTexture`, `Shader`, lighting, `TileSprite`, geometry and math, round pixels and removed objects (`changelog/v4/4.0/MIGRATION-GUIDE.md`).
- [general] Move first on a branch with the old screenshots kept, fix the throw-on-load items below, then work through the silent ones with a visual diff. A third-party plugin that registers pipelines needs a Phaser 4 release before you start.

## Phaser 3 advice to ignore

| Phaser 3 advice | Phaser 4.2.1 |
| --- | --- |
| `type: Phaser.AUTO` is fine | `AUTO` can fall back to Canvas, which has no filters, GPU layers, lights or stencil; use `Phaser.WEBGL` ([config](config-and-boot.md)) |
| `roundPixels` is on, so sprites are crisp | Default false. `pixelArt` turns it on, and it only rounds unscaled, axis-aligned objects under an integer camera zoom |
| `pixelArt` gives crisp art at any zoom | For art scaled up or rotated use `smoothPixelArt`, or an integer scale ([scale](scale-and-responsive.md)) |
| `sprite.postFX.addGlow()` | `sprite.enableFilters()` then `sprite.filters.internal.addGlow()` (or `.external`) |
| `setMask(new BitmapMask(...))` | `filters.internal.addMask(maskObject)`; `setMask` only warns in WebGL |
| `setPipeline('Light2D')` | `setLighting(true)`; lights now have a `z` |
| `setTintFill(c)` | `setTint(c).setTintMode(Phaser.TintModes.FILL)` |
| `Math.TAU` is half pi, `Math.PI2` is tau | `TAU` is 2 pi, `PI2` is gone, `PI_OVER_2` is new |
| `new Phaser.Geom.Point(x, y)` | `Phaser.Math.Vector2` |
| `renderTexture.draw(...)` shows at once | Drawing is buffered; call `render()` |
| Shadertoy-style uniforms arrive on a `Shader` | Nothing is set for you; pass them in the config and `setUniform` |
| Compressed textures are top-left origin | Re-encode with the Y axis flipped |

- [tested] Those removals and stubs exist in 4.2.1: `Phaser.Geom.Point`, `Display.Masks.BitmapMask`, `GameObjects.Mesh` and `Plane`, `Phaser.Create`, `Math.PI2`, `Structs.Set`, `Phaser.Device`, `Physics.Impact`, `setPipeline`, `setPostPipeline`, `postFX`, `preFX`, `textures.generate`, `load.obj` and `add.mesh` are all undefined; `Math.TAU` equals 2 pi; `setTintFill` logs an error and returns `undefined`, so a chained call throws; `setMask` warns and does nothing; `roundPixels` defaults to false (`migration-v3-apis-are-gone-or-stubbed`).

## Find the hits

Run each pattern over the source folder (`rg -n -e '<pattern>' src`, or any regex search). `break` patterns fail or do nothing in 4.2.1; `review` patterns still run but their meaning changed.

```text
pipeline   break   \.(setPipeline|setPostPipeline|resetPipeline)\(|Light2D|pipeline\s*:\s*[\{\[]
fx         break   \.(postFX|preFX)\b|\.setPostPipeline
masks      break   BitmapMask|createBitmapMask|\.setMask\(|createGeometryMask
tintfill   break   \.setTintFill\(|\.tintFill\b
point      break   Geom\.Point\b|new Phaser\.Point\b
mathconst  break   Math\.PI2\b|Structs\.Set\b
removed    break   GameObjects\.(Mesh|Plane)\b|add\.(mesh|plane)\(|load\.obj\(|textures\.generate\(|Create\.GenerateTexture|Camera3D|Layer3D|phaser-ie9
spine      review  [Ss]pine
rtdraw     review  [Rr]enderTexture|DynamicTexture|add\.renderTexture
tau        review  Math\.TAU\b
shader     review  add\.shader\(|GameObjects\.Shader|iResolution|setUniform
camera     review  camera\.matrix\b|GetCalcMatrix|setQuad\(
renderer   review  Phaser\.(AUTO|CANVAS)\b|roundPixels|pixelArt
compress   review  load\.texture\(|compressed
```

- [tested] `node --test tests/engine-phaser-migration-patterns.test.mjs` runs every pattern above against sample Phaser 3 lines (each must match) and sample Phaser 4 lines (no `break` pattern may match), and checks that each label has a row below.

| Label | Why | Do |
| --- | --- | --- |
| pipeline, fx, masks | The methods or properties are undefined or no-ops | Filters and render nodes |
| tintfill, point, mathconst, removed | Removed | Replacements in the table above |
| spine | The bundled Spine plugins are not shipped (the 4.2.1 package has no `plugins` folder) | Use Esoteric's official plugin; the pattern also matches that plugin, so it is a review |
| rtdraw | Buffered drawing | Call `render()` after the draws, or use `capture` |
| tau | Value changed from half pi to 2 pi | Check each use; `PI_OVER_2` is the old value |
| shader, camera | Constructor, uniforms and matrices changed | Read the guide sections 5 and 8 |
| renderer | Defaults and semantics changed | Decide in [config](config-and-boot.md) |
| compress | Y orientation | Re-encode ([loading assets](loading-assets.md)) |

## Silent changes that do not throw

- [documented] `DynamicTexture#render` (4.0.0) must run before anything drawn to a `DynamicTexture` or `RenderTexture` is visible (`src/textures/DynamicTexture.js`).
- [documented] Canvas offered 27 blend modes and WebGL has four native ones; the `Blend` filter recreates the rest through a capture (guide section 2). `TileSprite` was rewritten: no cropping, atlas frames supported (guide section 11).
- [documented] The camera matrix no longer holds position; `matrixExternal` does (guide section 5). Direct WebGL calls are unsupported: use an `Extern` object, which restores state (guide section 1).
- [general] Pixel-exact art, lighting looks and any shader work need new golden screenshots; do not accept "no console errors" as a migration result ([phaser-verification](../../phaser-verification/SKILL.md)).

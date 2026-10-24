# Textures, render targets, tint modes and blend modes (4.2.1)

Phaser's own tour is `node_modules/phaser/skills/render-textures/SKILL.md`; this page keeps what it omits: silent failures, filtering and memory, the 4.2.0 tint change, and blend-mode limits. Every [tested] label is asserted by `node examples/web/phaser-probes/phaser-rendering-textures-and-shaders.mjs /absolute/path/to/project-with-phaser-and-playwright`, or by the render-graph probe for blend modes. Run both on software and hardware GL; the two tint modes noted below are skipped on software.

## Choose a render target

| Need | Use | Cost |
| --- | --- | --- |
| A visible surface you draw onto (trail, paint, minimap) | RenderTexture, `renderMode: 'all'` to redraw each frame | one framebuffer, one quad |
| A texture many objects or shaders share, or a mask source | `textures.addDynamicTexture(key, w, h)` | one framebuffer |
| Part of the already drawn scene as a texture | CaptureFrame (needs a framebuffer context, e.g. `camera.setForceComposite(true)`) | a copy |
| An effect on the pixels of one object or camera | a [filter](filters.md) | passes per frame |
| Shader output reused elsewhere | `shader.setRenderToTexture(key)` | one framebuffer |

- [general] Draw once and reuse when the content is static; redraw per frame only what changes. A DynamicTexture bake replaces many sprites with one quad.

## Lifecycle rules that fail silently

- [tested] Nothing appears until `render()` runs: a `fill` on a RenderTexture left the screen black until `render()`. Commands queued from inside a `callback()` while the buffer executes are dropped and the buffer is emptied afterwards (a blue fill queued there never drew).
- [tested] `forceEven` defaults to true and rounds up: a 33 by 33 DynamicTexture is 34 by 34 (`addDynamicTexture(key, w, h, false)` keeps 33). [documented] Default sizes are 256 for a DynamicTexture and 32 for a RenderTexture.
- [documented] `preserve(true)` keeps the buffer across renders; `renderMode: 'redraw'` renders without displaying, which is how a same-frame shader output feeds another object; a texture cannot draw itself (`src/textures/DynamicTexture.js`, `DynamicTextureHandler.js`). `resize` erases the content.
- [documented] Contents are not restored after WebGL context loss; redraw on the restore event, and count wrappers, not texture keys, when checking for leaks ([context loss](phaser-4-webgl-context-gotchas.md) gotchas 13, 15 and 24; the install-time patches are [dynamic texture](../scripts/assets/phaser-dynamic-texture-patch.mjs), [framebuffer restore](../scripts/assets/phaser-framebuffer-restore-patch.mjs), [texture units](../scripts/assets/phaser-texture-units-patch.mjs)).
- [tested] `rt.saveTexture('key')` renames the RenderTexture's own texture into the manager (the old key stops existing; a second call renames again), and that texture then outlives `rt.destroy()`. An unsaved RenderTexture's texture is destroyed with it. A saved texture is yours to free: `scene.textures.remove('key')`.
- [tested] CaptureFrame copies what was drawn before it, upright, into the texture key you gave it (`this.add.captureFrame('cap')`), and not what comes after. It needs a framebuffer context: with `camera.setForceComposite(true)` the capture worked; on the plain canvas it captured nothing and logged one `CaptureFrame: Cannot capture from main canvas` warning. [documented] `setAlpha` and `setScrollFactor` do nothing on it, the texture is as large as the context, and a CaptureFrame inside a filtered Container captures only that Container (`src/gameobjects/captureframe/`).
- [documented] `renderer.glTextureWrappers` and `renderer.glFramebufferWrappers` are the arrays to count (the filters probe reads the second); pooled filter framebuffers also live there ([filters](filters.md)).

## Sampling, mipmaps and memory

- [tested] Render targets and filter framebuffers are sampled LINEAR when `render.antialias` is true (the default) and NEAREST when it is false, which `pixelArt: true` sets; a scaled RenderTexture is blurry in a non-pixelArt game.
- [tested] `render.mipmapRegeneration` (4.1.0, default false) with `mipmapFilter: 'LINEAR_MIPMAP_LINEAR'` gave a 32 by 32 DynamicTexture the mipmap minification filter and a 33 by 33 one did not; without `mipmapRegeneration` neither got it.
- [documented] Every `render()` of a mipmapped target regenerates its mipmaps (10 microseconds or more per texture), and filters never use mipmaps (`src/core/Config.js`, `DrawingContext.js`). Leave it off for atlases and pixel art.
- [documented] Memory: 4 bytes per pixel, +33% with mipmaps, +1 byte per pixel for the stencil attachment while `render.stencil` is true; texture data is also kept in system memory (`docs/Phaser 4 Rendering Concepts`).
- [documented] Compressed textures must be encoded Y-up in Phaser 4; texture coordinates and framebuffers use GL orientation throughout.

## Tint modes (the 4.2.0 change)

| Mode | Value | Result per channel (c = texel, t = tint, t2 = tint2) |
| --- | --- | --- |
| MULTIPLY | 0 | c * t |
| FILL | 1 | t, texel alpha kept |
| ADD | 2 | c + t |
| SCREEN, OVERLAY, HARD_LIGHT | 4, 5, 6 | the Photoshop-style blends |
| MULTIPLY_TWO | 7 | c * t + (1 - c) * t2: black takes t2, white takes t |

- [tested] On a mid-gray texel with tint `0xff4020`: MULTIPLY gave (128, 32, 16), FILL (255, 64, 32), ADD (255, 192, 160). On a black texel with tint2 `0x2040ff`, MULTIPLY_TWO gave exactly (32, 64, 255) on the hardware stack.
- [tested] HARD_LIGHT and MULTIPLY_TWO drew with no tint at all on headless software GL (SwiftShader), while the hardware stack applied both. [general] Likely cause: `applyTint` picks the mode by exact float equality on an interpolated varying (`src/renderer/webgl/shaders/ApplyTint-glsl.js`), which is only safe where interpolation of a constant is exact. Verify these two modes on real hardware, never headless software.
- [documented] 4.2.0 changed the `inTintEffect` vertex attribute from one float to four normalised bytes (tint mode in the fourth), so a custom batch handler or shader addition that reads it must be updated. `setTint2(...)`, `tint2TopLeft` etc. exist on Tint-component objects; `clearTint()` resets both tints. TilemapGPULayer tiles cannot be tinted. `setTintFill` is gone: `setTint(c).setTintMode(Phaser.TintModes.FILL)`.
- [documented] There is no SUBTRACT tint mode (3 is reserved), and no per-vertex tint modes: one mode per object.

## Blend modes

- [documented] WebGL defines blend parameters for NORMAL, ADD, MULTIPLY, SCREEN and ERASE (17) only (`src/renderer/webgl/WebGLRenderer.js`). [tested] Every other index draws as NORMAL: a tinted OVERLAY sprite produced the same pixel as NORMAL, while MULTIPLY produced a different one.
- [documented] The Blend filter implements the canvas modes (OVERLAY, DARKEN, DIFFERENCE, SOFT_LIGHT and more) and can overdrive outside 0 to 1 (`src/renderer/webgl/renderNodes/filters/FilterBlend.js`); the filtered image is the base and its texture is the blend layer. ERASE punches holes in a RenderTexture (`rt.erase`).

```js
// OVERLAY layer over the whole scene: a camera-sized DynamicTexture, neutral gray where nothing should change
const layer = this.textures.addDynamicTexture('overlayLayer', cam.width, cam.height);
layer.fill(0x808080); layer.draw(overlayObjects); layer.render();          // redraw when the layer changes
cam.filters.external.addBlend('overlayLayer', Phaser.BlendModes.OVERLAY, 1);
```

- [tested] That recipe reproduced the OVERLAY formula exactly (a (128, 96, 64) scene under a (64, 128, 192) patch became (65, 96, 96)) and left neutral-gray areas unchanged. Keep the layer opaque: the shader blends premultiplied values, so a transparent texel is not neutral (OVERLAY with zero darkened the neutral-test pixel from (128, 96, 64) to (1, 0, 0)).
- [general] The layer is a screen-space texture: it does not follow camera scroll or zoom, so redraw it from the camera's view when it must track the world.
- [tested] A custom `renderer.addBlendMode` returns the slot below the one it made; see [overview](render-system-overview.md).
- [documented] Blend and texture data are premultiplied (`ONE, ONE_MINUS_SRC_ALPHA` is the default function); a custom shader must write premultiplied colour ([shaders](custom-shaders-in-phaser.md)).

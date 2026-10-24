# Stencil, StencilReference, CustomContext and alpha strategies (4.2.0, fixed in 4.2.1)

Use a stencil for a sharp-edged mask that many later objects share, and a CustomContext to change draw state (scissor, write mask, alpha strategy) for a subtree. Every [tested] label is asserted by `node examples/web/phaser-probes/phaser-rendering-stencil.mjs /absolute/path/to/project-with-phaser-and-playwright` (passes on software and hardware GL). Factory names are lowercase: `this.add.stencil(x, y, children, options)`, `this.add.stencilreference(target, options)`, `this.add.customcontext(x, y, children, callback)`.

## What a Stencil does

- [tested] The default Stencil is a hole. Its children draw only into the stencil buffer (colour writes off, +1 per layer), and every object drawn after it is rejected where the buffer is not 0: a 40 px square Stencil hid a full-screen image inside the square and left it visible outside. `stencilInvert: true` makes it a window (visible only inside) at the price of one extra full-camera draw.
- [documented] The test is `EQUAL 0`, enabled by default since 4.2.0 (`src/renderer/webgl/parameters/WebGLStencilParametersFactory.js`). Overlapping children inside one Stencil add, so two overlapping shapes make 2 and one `subtractLayer` leaves 1. The buffer is 8 bits: 255 layers, then it wraps unless `stencilValueWrap` is false.
- [documented] Layer modes: `addLayer`, `subtractLayer`, `clear` (whole buffer to `stencilClearValue`, ignores children), `clearRegion` (children paint the value). `stencilInvert` is invalid with the last two. The class comment mentions `removeLayer`; the mode is `subtractLayer`.
- [tested] `StencilReference(target, { stencilLayerMode: 'subtractLayer' })` re-renders the target's children with new options. Objects after it drew inside the shape; objects between the two stayed hidden.
- [tested] StencilReference has no `depth` (it is undefined) and [documented] no Transform; it renders the target with the target's parent matrix (`src/gameobjects/stencilreference/`). Add it in display-list order among objects of equal depth, or inside a Container or Layer; do not depth-sort around it. If the target is destroyed it silently draws nothing.

## Alpha strategies

| Strategy | Effect on a source pixel | Use |
| --- | --- | --- |
| `keep` | alpha is ignored, any drawn pixel is opaque stencil | hard-edged art |
| `dither` | kept with probability alpha (screen-locked grain) | soft edges, the Stencil default |
| number 0 to 1 | discarded below that alpha | clean threshold edge |

- [tested] A 40% alpha source: `keep` hid the whole area, `dither` left about 60% visible (0.60 measured), threshold 0.5 wrote nothing and a 60% source with threshold 0.5 wrote everything.
- [documented] Defaults: `render.stencilAlphaStrategy` `'dither'`, `render.alphaStrategy` `'keep'`. The grain comes from `gl_FragCoord` (`src/renderer/webgl/shaders/ApplyAlphaDiscard-glsl.js`), so it does not move with the object.
- [tested] Setting the global `render.alphaStrategy: 'dither'` makes every half-transparent sprite draw as a half-on, half-off pixel mix instead of blending (391 of 784 pixels fully on); leave it at `keep`.
- [tested] A Shader game object child ignores the strategy and stamps an opaque stencil; `stencilCompositeCheck: true` renders the children to a framebuffer first and the strategy then applies (0 became about 0.6 visible). [documented] No `alphaStrategy` read exists in the Shader, Noise, PointLight, TilemapGPULayer or filter-shader nodes; sprites, text, graphics, tiles, strips and SpriteGPULayer honour it.
- [documented] A Stencil nested in a Stencil composites its contents through a framebuffer by default (extra draws, poor antialiasing). Keep stencils few and flat.

## Scope and lifetime

- [tested] The buffer is cleared once per frame, not per scene. A stencil stays in force for every later scene in that frame: a second scene's image was hidden inside the first scene's hole until a childless Stencil with `stencilLayerMode: 'clear'` was added. [documented] Cameras that draw straight to the canvas share that buffer too; only cameras with filters, alpha or `forceComposite` render into a framebuffer with a fresh stencil (`src/renderer/webgl/renderNodes/Camera.js`).
- [documented] With `clearBeforeRender: false` the base context never clears and layers accumulate across frames (`WebGLRenderer.preRender`). Filter and DynamicTexture framebuffers get their own stencil attachment, but their composite onto the canvas is stencilled like any draw.
- [tested] `render.stencil: false` makes Stencil a silent no-op (`STENCIL_BITS` 0), so the hole simply is not there. Never disable it in a game that uses Stencil.
- [documented] The option exists to save the 1 byte per framebuffer pixel of the stencil attachment (`WebGLFramebufferWrapper.js`, `STENCIL_INDEX8`).
- [documented] 4.2.1 fixes: `stencilInvert` now works (an alpha bug nulled it in 4.2.0) and framebuffers clear their stencil on use. On 4.2.0 neither is reliable; pin 4.2.1.
- [tested] `DrawingContext#setStencil()` called with no arguments sets `writeMask` to 0x00 while the context's default is 0xFF; pass all nine arguments if you call it from a CustomContext.

## Recipe: a window onto part of the scene

```js
const opening = this.add.image(x, y, 'circle');              // white disc, any alpha edge
this.add.stencil(0, 0, [opening], { stencilInvert: true }).setDepth(10);
// ... objects at depth 11 to 19 show only inside the disc ...
this.add.stencil(0, 0, [], { stencilLayerMode: 'clear' }).setDepth(20); // end of the window
```

- [tested] The probe asserts each piece: an inverted Stencil shows later content only inside its shape, and a childless `clear` Stencil lifts it for what follows. [general] Both are ordinary Containers, so depth places them; give the content depths between the two.

## CustomContext

```js
this.add.customcontext(0, 0, [bigContent], ctx => ctx.setScissorBox(20, 20, 40, 30));
```

- [tested] The callback gets a clone of the current `DrawingContext` each frame; a scissor box set on it clips the children with no framebuffer (x, y from the top-left, in drawing-context pixels) and ends with the container: an image drawn after it was unclipped.
- [documented] Scissor is not transformed by camera zoom or scroll, so convert world rectangles to pixels yourself. Other settable state: `setColorWritemask`, `setAlphaStrategy`, `setBlendMode`, `state.stencil`. Creating a framebuffer inside is wrong (it never reaches the canvas); use a DynamicTexture.
- [general] Prefer a scissor to a Mask filter for rectangular panes: no framebuffer, no per-frame mask render. Use the Mask filter for rotated or soft shapes ([filters](filters.md)).

## Choosing

- [general] Stencil: sharp, persistent, shared by many later objects (fog-of-war hole, portal window, split screen). Mask filter: soft or animated shape, one target. CustomContext scissor: axis-aligned rectangle. RenderTexture or Blend filter: when you need the combined pixels, not just visibility.
- [general] Verify with a pixel read inside and outside the shape, then add a second scene or camera to see whether the stencil leaks into it.

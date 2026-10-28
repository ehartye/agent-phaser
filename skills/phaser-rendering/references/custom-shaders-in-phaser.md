# Custom shaders in Phaser 4.2.1: Shader objects, custom filters, GLSL rules

Phaser's walk-through is `node_modules/phaser/docs/Phaser 4 Shader Guide`; this page corrects it where the source disagrees and lists the traps. Every [tested] label is asserted by `phaser-rendering-textures-and-shaders.mjs`, `phaser-rendering-filters.mjs` or `phaser-rendering-webgl2-context.mjs` in `examples/web/phaser-probes` (run `node <file> /absolute/path/to/project-with-phaser-and-playwright`). For shaders outside Phaser see agent-engine:engine-custom-shaders.

## Pick the vehicle

| Goal | Use | Notes |
| --- | --- | --- |
| Procedural or animated quad (water, energy field, backdrop) | Shader game object, or a ready-made `gradient`, `noise`, `noisecell2d`, `noisesimplex2d` (lowercase factories) | stand-alone draw |
| Process existing pixels of an object or camera | custom filter: Controller plus BaseFilterShader | [filters](filters.md) |
| Change how every sprite is shaded (tint maths, an extra attribute) | shader additions or a custom Submitter or BatchHandler | advanced; [overview](render-system-overview.md) |
| A recolour or distortion that Phaser already has | the built-in filter | cheaper than your own |

- [tested] The ready-made factories are lowercase: `this.add.noiseCell2D` is not a function in 4.2.1 (Phaser's v4-new-features skill spells it that way); registered names include `noise`, `noisecell2d`, `noisecell3d`, `noisecell4d`, `noisesimplex2d`, `noisesimplex3d`, `gradient`, `shader`.

## The Shader game object

```js
const sh = this.add.shader({
  name: 'water', fragmentSource: FRAG, initialUniforms: { uTex: 0 },
  setupUniforms: (setUniform, drawingContext) => setUniform('uTime', performance.now() / 1000),
  updateShaderConfig: (drawingContext, gameObject, node) => { /* toggle additions */ },
}, x, y, w, h, ['textureKey']);
```

- [tested] `updateShaderConfig` is called with `(drawingContext, gameObject, renderNode)`. The guide's example names the first two the other way round; read the source (`src/renderer/webgl/renderNodes/ShaderQuad.js`) or log `arguments`.
- [tested] A Shader has no Alpha component: `shader.alpha` is undefined and `setAlpha()` returns the object and changes nothing. Pass your own `uAlpha` uniform and multiply the output. [documented] It also has no Tint, Mask or Lighting component (every GameObject still has the Filters component).
- [documented] Each Shader builds its own ShaderQuad and program (`name` need not be unique), is a stand-alone render (it flushes the sprite batch) and uses the default vertex shader, which supplies `varying vec2 outTexCoord` from 0 to 1 with Y up. Shadertoy-style uniforms are no longer set for you; `setTextures` replaces the list; `setTextureCoordinatesFromFrame` maps an atlas frame; `setRenderToTexture(key)` and `renderImmediate()` render into a texture.
- [documented] Textures bind to units by position in the constructor array, so set the sampler uniforms (`initialUniforms`) to 0, 1, 2 explicitly.
- [tested] Output is blended as premultiplied alpha: a shader writing `vec4(1.0, 0.0, 0.0, 0.5)` drew full red on black, while `vec4(0.5, 0.0, 0.0, 0.5)` drew half red. Multiply colour by alpha before writing.

## A custom filter

```js
class FilterGreen extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(manager) { super('FilterGreen', manager, null, FRAG, []); }    // a fresh array every time
  setupUniforms(controller, ctx) { this.programManager.setUniform('uAmount', controller.amount); }
}
class Green extends Phaser.Filters.Controller {
  constructor(camera) { super(camera, 'FilterGreen'); this.amount = 1; }
}
// new Phaser.Game({ render: { renderNodes: { FilterGreen } } });
obj.enableFilters(); obj.filters.internal.add(new Green(obj.filterCamera));   // camera.filters.internal.add(new Green(camera))
```

- [tested] This pattern ran and recoloured a sprite. The fragment shader reads `uMainSampler` (unit 0, the previous step's output) and `varying vec2 outTexCoord`; `setupTextures(controller, textures, ctx)` adds more samplers from index 1 (`BaseFilterShader.js`).
- [tested] `shaderAdditions` must be an array: the guide's `const additions = {}` throws `config.shaderAdditions.push is not a function` when the node is first built. [documented] The constructor pushes a BoundedSampler addition onto the array you pass, so a shared module-level array grows with every instance.
- [tested] `renderNodes.getNode('NameNotRegistered')` returns null; [documented] the camera node then calls `.run` on it, so the controller's string must match a registered name (`render.renderNodes` at boot, or `addNodeConstructor` guarded by `hasNode`).
- [documented] The vertex shader is fixed (`SimpleTexture-vert`: `outTexCoord`, `outFragCoord`), a filter is a full pass over a pooled framebuffer, and padding is zero until you set it (`setPaddingOverride` or a `getPadding` override that `getPaddingCeil` then rounds).
- [documented] A filter is skipped, not failed, for frames while a parallel-compiled program is not ready (`render.skipUnreadyShaders`, `ProgramManager` returns no program suite); do not treat a returned target as proof the shader drew.

## GLSL and WebGL version rules

- [tested] A GLSL compile or link error throws from the render loop (`Fragment Shader failed`, `Link Shader failed`) and stops it; the canvas freezes and the console shows the log.
- [tested] On a supplied WebGL 2 context, Phaser's own shaders for `smoothPixelArt`, Gradient, GradientMap and noise normal maps fail, because they enable `GL_OES_standard_derivatives`; your own ES 1.00 shaders using `dFdx` fail the same way. A custom ES 3.00 Shader needs both `vertexSource` and `fragmentSource` as `#version 300 es` (the default vertex shader is ES 1.00, and a fragment-only ES 3.00 pair fails to link). Details in [WebGL backends](webgl-backends.md).
- [documented] Shader source is templated with `#pragma phaserTemplate(key)` points; additions (`Phaser.Renderer.WebGL.ShaderAdditionMakers`) splice code into them, and a program is cached by addition name, so changing an addition's text without changing its name does nothing (`Phaser 4 Shader Guide`).
- [general] Do not compare interpolated varyings with `==`; the tint-mode failure on software GL ([textures](textures-and-render-targets.md)) is the cautionary case. Use `highp` where the device allows and test precision-sensitive maths on hardware.

## Alpha strategy in your own shader

- [documented] Custom shaders ignore `alphaStrategy` (`keep`, `dither`, threshold) unless they add `MakeApplyAlphaDiscard` and refresh it from `drawingContext.alphaStrategy` in `updateShaderConfig`, as `BatchHandlerQuad.updateShaderConfig` does. The helper returns `fragColor / fragColor.a`, so call it last.
- [tested] The cheap route for a Stencil source is `stencilCompositeCheck: true`, which renders the Shader to a framebuffer and applies the strategy in a compatible pass ([stencil](stencil-and-custom-context.md)).

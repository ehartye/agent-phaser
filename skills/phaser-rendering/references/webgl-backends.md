# Phaser 4 WebGL versions and custom shaders

Checked against open-source Phaser **4.2.1** on 2026-10-06. Keep supported capabilities, default selection and project verification separate.

## Supported WebGL 2, default WebGL 1

- [general] Phaser 4 **officially supports WebGL 2 canvases**. The [renderer announcement](https://phaser.io/news/2026/04/phaser-4-renderer-faster-cleaner-and-built-for-modern-games) and [4.0 changelog](https://github.com/phaserjs/phaser/blob/v4.0.0/changelog/v4/4.0/CHANGELOG-v4.0.0.md) explicitly document it. Do not describe WebGL 2 as an unsupported Phaser backend.

The pinned [4.2.1 renderer source](https://github.com/phaserjs/phaser/blob/v4.2.1/src/renderer/webgl/WebGLRenderer.js#L698) accepts `game.config.context`; without one it requests `webgl` or `experimental-webgl`. Thus `type: Phaser.WEBGL` selects the renderer, **not** the WebGL API version. Supply a WebGL 2 context on the same canvas when custom GLSL ES 3 shaders require it; no engine fork is needed to select that context.

```js
import Phaser from 'phaser';

const canvas = document.createElement('canvas');
const context = canvas.getContext('webgl2', {
  antialias: false, alpha: false, premultipliedAlpha: false
});
if (!context) throw new Error('WebGL 2 unavailable');
const game = new Phaser.Game({
  type: Phaser.WEBGL, canvas, context,
  width: 384, height: 216, pixelArt: true,
  antialias: false, antialiasGL: false, premultipliedAlpha: false,
  scene: [BootScene] // the project's scene class
});
```

This example requires WebGL 2. Choose the project's explicit fallback before boot if context creation fails. Keep supplied context attributes consistent with the Game configuration; use one active Game/context owner. Print `gl.getParameter(gl.VERSION)` plus the unmasked renderer string to record API version and hardware/software identity. Re-check source and tests when upgrading Phaser.

## What fails on a supplied WebGL 2 context (4.2.1)

Measured with `node examples/web/phaser-probes/phaser-rendering-webgl2-context.mjs /absolute/path/to/project-with-phaser-and-playwright` (Chromium/ANGLE, software and hardware GL): one game per feature on the default and on a supplied WebGL 2 context.

- [tested] Plain scenes, the Blur filter, the Mask filter and Stencil render the same on both contexts.
- [tested] `render.smoothPixelArt`, the Gradient game object, the GradientMap filter and noise `noiseNormalMap` fail on the WebGL 2 context with `Fragment Shader failed`, and the render loop stops. [documented] Their GLSL ES 1.00 sources enable `GL_OES_standard_derivatives` (`MakeSmoothPixelArt.js`, `Ramp-glsl.js`), which a WebGL 2 context does not offer; the extension shims in `WebGLRenderer.setExtensions` are applied only to a WebGL 1 context.
- [tested] A custom Shader game object with `#version 300 es` in both `vertexSource` and `fragmentSource` renders on WebGL 2. With only the fragment source in ES 3.00 it fails with `Link Shader failed: Fragment shader version does not match other shader versions`. ES 1.00 shaders still run on WebGL 2.
- [general] Choose by need: stay on the default WebGL 1 context unless your own shader needs ES 3.00. On a WebGL 2 context replace the four failing features (use `pixelArt` with integer zoom instead of `smoothPixelArt`; a canvas gradient texture instead of Gradient) rather than expecting them to work.

## Custom ES3 programs and renderer ownership

- [general] Phaser 4 uses render nodes and filters rather than Phaser 3 pipelines. A WebGL 2 context does not rewrite custom shader source. A working ES3 filter uses matching `#version 300 es` **vertex and fragment** sources through that filter's `ProgramManager.setBaseShader`; replacing only the fragment leaves incompatible program interfaces. Keep GLSL versions, `in`/`out`, samplers and `texelFetch` requirements explicit. Do not globally replace standard renderer programs to configure one custom effect.

Use Phaser-managed texture/program/framebuffer wrappers and render-node state handling. Raw GL changes outside those contracts can invalidate Phaser's state; raw handles can change on restoration. Test native effect-target dimensions, texture orientation, alpha/premultiplication, integer sampling and actual atlas pixels. Keep independently scaled pixel UI outside world filters. Broad backend support is not a promise of exact custom-effect parity or a measured speedup.

Phaser provides renderer context restoration. The application still owns repainting its dynamic terrain/effect contents and resetting temporal history. Test loss/restore with the actual scene/resources. A healthy-context shader failure can use a tested CPU-composed texture fallback; a lost GL context cannot display that upload. Treat whole-context recovery or serial renderer replacement as a distinct lifecycle path.

## Render options that only this skill explains (4.2.1 defaults)

The decision table for `type`, `pixelArt`, `roundPixels`, `transparent`, `stencil`, `powerPreference`, `mipmap*`, `skipUnreadyShaders` and `autoMobileTextures` is in [config and boot](../../engine-phaser/references/config-and-boot.md). These are the ones it leaves to the renderer:

| Option | Default | What it changes |
| --- | --- | --- |
| `antialias` | true | LINEAR sampling for sprites and for every filter and DynamicTexture framebuffer; false gives NEAREST |
| `batchSize` | 16384 | quads per batch, capped by the 16-bit index limit |
| `maxTextures` | -1 | texture units per draw; -1 means the GPU maximum (16 on the stacks tested) |
| `alphaStrategy`, `stencilAlphaStrategy` | `keep`, `dither` | [alpha strategies](stencil-and-custom-context.md) |
| `clearBeforeRender` | true | per-frame clear of colour, depth and stencil; false lets stencil layers accumulate |
| `pathDetailThreshold` | 1 | Graphics vertices closer than this many pixels are merged |
| `renderNodes` | empty | custom [render nodes](render-system-overview.md) by name |

- [documented] Each option reads `render.<name>` first and the top-level `<name>` second (`GetValue(renderConfig, name, default, config)` in `src/core/Config.js`), so `pixelArt: true` and `render: { pixelArt: true }` are the same.
- [general] To make a test fail instead of silently running on a software stack, set `failIfMajorPerformanceCaveat: true` and print the renderer string.

## Phaser AE is separate

- [general] [Phaser AE v2](https://phaser.io/news/2026/07/phaser-ae-v2-is-now-the-engine-behind-every-new-game) selects WebGPU with automatic WebGL 2 fallback. Phaser's [product explanation](https://phaser.io/news/2026/07/no-you-didn-t-miss-a-3d-update) identifies AE as a separate proprietary engine/API. Installing npm `phaser` does not supply AE APIs, WebGPU selection or its automatic backend policy. Phaser 4's supported WebGL 2 configuration stands independently of AE.

## Evidence and limits

- [general] A separate project probe, not reproduced in this repo (the section above is the part that is), exercised both default GL1 and a supplied GL2 context in Phaser 4.2.1 on ANGLE/D3D11 Chromium with an integrated GPU and muted audio. It reported native 384×216 custom-filter output, separately enlarged pixel UI, a second sampler and ES3 `texelFetch`; saved PNGs independently matched the expected opaque sprite pixels (1,036 of them) in both paths, and hiding the sprite failed the assertion. Earlier blank/missing-sprite observations were recorded without claiming an isolated engine bug. Public engine-capability evidence is in the official sources above; the probe is additional bounded evidence from one project. Reproduce the pixel check with the method in [GPU verification](../../phaser-verification/references/verifying-on-a-gpu.md).

That is a bounded API/pixel proof. Production terrain eviction, full lighting/emissive/temporal-history composition, fallback, restoration, other devices and frame-rate improvements remain project-specific checks. See [GPU verification](../../phaser-verification/references/verifying-on-a-gpu.md) for the normal verification workflow.

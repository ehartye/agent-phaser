# Phaser 4 WebGL versions and custom shaders

Checked against open-source Phaser **4.2.1** on 2026-10-06. Keep supported capabilities, default selection and project verification separate.

## Supported WebGL 2, default WebGL 1

Phaser 4 **officially supports WebGL 2 canvases**. The [renderer announcement](https://phaser.io/news/2026/04/phaser-4-renderer-faster-cleaner-and-built-for-modern-games) and [4.0 changelog](https://github.com/phaserjs/phaser/blob/v4.0.0/changelog/v4/4.0/CHANGELOG-v4.0.0.md) explicitly document it. Do not describe WebGL 2 as an unsupported Phaser backend.

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

## Custom ES3 programs and renderer ownership

Phaser 4 uses render nodes and filters rather than Phaser 3 pipelines. A WebGL 2 context does not rewrite custom shader source. The tested ES3 filter uses matching `#version 300 es` **vertex and fragment** sources through that filter's `ProgramManager.setBaseShader`; replacing only the fragment leaves incompatible program interfaces. Keep GLSL versions, `in`/`out`, samplers and `texelFetch` requirements explicit. Do not globally replace standard renderer programs to configure one custom effect.

Use Phaser-managed texture/program/framebuffer wrappers and render-node state handling. Raw GL changes outside those contracts can invalidate Phaser's state; raw handles can change on restoration. Test native effect-target dimensions, texture orientation, alpha/premultiplication, integer sampling and actual atlas pixels. Keep independently scaled pixel UI outside world filters. Broad backend support is not a promise of exact custom-effect parity or a measured speedup.

Phaser provides renderer context restoration. The application still owns repainting its dynamic terrain/effect contents and resetting temporal history. Test loss/restore with the actual scene/resources. A healthy-context shader failure can use a tested CPU-composed texture fallback; a lost GL context cannot display that upload. Treat whole-context recovery or serial renderer replacement as a distinct lifecycle path.

## Phaser AE is separate

[Phaser AE v2](https://phaser.io/news/2026/07/phaser-ae-v2-is-now-the-engine-behind-every-new-game) selects WebGPU with automatic WebGL 2 fallback. Phaser's [product explanation](https://phaser.io/news/2026/07/no-you-didn-t-miss-a-3d-update) identifies AE as a separate proprietary engine/API. Installing npm `phaser` does not supply AE APIs, WebGPU selection or its automatic backend policy. Phaser 4's supported WebGL 2 configuration stands independently of AE.

## Evidence and limits

The [Cyberpunkt probe](https://github.com/ehartye/cyberpunkt/blob/3449f0a7664cef7181875ffeb07b75e589d8b677/docs/spikes/phaser-migration/README.md) (private repository; access required) exercises both default GL1 and supplied GL2 in Phaser 4.2.1 on Intel ANGLE D3D11 Chromium, with muted audio. It verifies native 384×216 custom-filter output, separately enlarged pixel UI, a second sampler and ES3 `texelFetch`. Saved PNGs independently match 1,036 opaque Runner pixels in both paths; hiding Runner fails the assertion. Earlier blank/missing-sprite observations remain documented without claiming an isolated engine bug. Public engine-capability evidence is available in the official sources above; the private project result is additional bounded evidence.

That is a bounded API/pixel proof. Production terrain eviction, full lighting/emissive/temporal-history composition, fallback, restoration, other devices and frame-rate improvements remain project-specific checks. See [GPU verification](verifying-on-a-gpu.md) for the normal verification workflow.

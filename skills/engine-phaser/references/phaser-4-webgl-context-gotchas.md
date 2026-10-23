# Phaser 4.2.1 WebGL context restore gotchas

Focus, visibility and context loss, dead GL wrappers and invalid handles during WebGL context restore. Numbers match the index in [phaser-4-gotchas.md](phaser-4-gotchas.md).

## 13. `generateLayerDataTexture()` leaves a dead GL wrapper, and that breaks WebGL context restore

- [general] `TilemapGPULayer.generateLayerDataTexture()` replaces its data texture with `layerDataTexture.destroy()`, which frees the GL
  texture but leaves the wrapper in `renderer.glTextureWrappers` (its `renderer` is null). Each regeneration leaks one, and when the
  browser restores a lost context Phaser calls `createResource()` on every wrapper and throws
  `Cannot read properties of null (reading 'gl')`: the renderer never comes back. The layer's own `destroy()` also never frees the
  data texture. Workaround: before regenerating, `renderer.deleteTexture(layer.layerDataTexture)` and null the field; do the same
  when you destroy a chunk. Test: count `renderer.glTextureWrappers.filter(w => w.renderer === null)` (expect 0) and run
  `gl.getExtension('WEBGL_lose_context').loseContext()` then `restoreContext()` and assert the world draws again.

## 15. Focus, visibility, context loss, and unused audio

- [general] Phaser pauses its loop in a hidden tab (and resets the delta on return) but keeps running when the window only loses focus, so a
  simulation plays on unseen: listen once per game for `Core.Events.BLUR/FOCUS/HIDDEN/VISIBLE` and stop stepping. On
  `renderer.on(Renderer.Events.LOSE_WEBGL)` Phaser disables the renderer but your update loop still runs, and creating a GL
  resource then throws (`Framebuffer Unsupported`): hold the frame until `RESTORE_WEBGL`. Dynamic textures (RenderTexture) must be
  redrawn after a restore. If sound comes from another engine, set `audio: { noAudio: true }` or Phaser builds an unused AudioContext.

## 23. Filter-mask framebuffers delete invalid handles during WebGL context restore

- [general] **Symptom and cause.** On pinned npm Phaser 4.2.1, a native `Container`/`Rectangle` with an external `Graphics` filter mask
  draws again after actual `WEBGL_lose_context` restoration, but logs `INVALID_OPERATION` for `deleteFramebuffer` and
  `deleteRenderbuffer`. `WebGLRenderer.dispatchContextRestored()` recreates wrapper resources while `renderer.contextLost`
  is still true. `WebGLFramebufferWrapper.createResource()` first deletes its previous-context framebuffer and owned
  renderbuffers, which the browser has already invalidated. A plain scene without the mask does not reproduce these calls.

**Temporary dependency band-aid.** Copy the exact released
[phaser-framebuffer-restore-patch.mjs](../scripts/assets/phaser-framebuffer-restore-patch.mjs) into the consuming project's
scripts directory and invoke it from the existing postinstall after Phaser is installed:

```sh
node scripts/phaser-framebuffer-restore-patch.mjs node_modules/phaser
```

An existing Node postinstall can instead import `patchFramebufferRestore` from that copied module and
`await patchFramebufferRestore(installedPhaserDirectory)`. Import alone has no side effect. It requires exactly package
name `phaser` and version `4.2.1`, and preflights the unique original or corrected native fragment in
`src/renderer/webgl/wrappers/WebGLFramebufferWrapper.js`, `dist/phaser.esm.js` and `dist/phaser.js` before any write.
Unknown, ambiguous, mixed original/corrected states or mixed target newlines fail installation without partial edits.
LF/CRLF and every byte outside the fragment are preserved; repeated installation is idempotent. The helper composes
with the separate audio, gamepad lifecycle and held-input corrections. Keep the consuming project's integrity guards
consistent with the released helper and invalidate any existing bundler dependency cache after correcting its input.

The guard skips invalid previous-context handles during restore, using native `gl.isFramebuffer` validity. It still
deletes live handles recreated during that same restore phase: native renderer resize listeners run before
`contextLost` is cleared, so the flag alone is insufficient. Ordinary live recreation, resize, attachment creation,
canvas use and destroy keep their native behavior. This corrects resource ownership; it does not suppress GL warnings.

**Evidence and limits.** Node tests execute the complete pinned native wrapper and its actual `Class` dependency,
with exact npm source hashes recorded in the fixture. They cover stale and live restore-phase handles, texture versus
renderbuffer ownership, repeat restore/recreate, resize, canvas use, destroy and installer refusal/composition.
A standalone native mask and plain control were also checked on a discrete GPU through ANGLE/D3D11, with two actual context
loss/restore cycles, identical nonempty restored pixels, live recreate/resize and teardown. This is bounded evidence
for Phaser 4.2.1 and that GPU/backend, not a claim about every browser or renderer. Remove this band-aid only after an
equivalent reviewed, pinned upstream fix passes both stale-handle restore and live-handle disposal checks.

## 24. DynamicTexture and RenderTexture creation leaves a live GPU texture wrapper behind

- [general] **Symptom and cause.** Pinned npm Phaser 4.2.1 creates a TextureSource GL wrapper in the base Texture constructor,
  then replaces `frame.source.glTexture` with `this.drawingContext.texture` without disposing the first wrapper.
  Removing the DynamicTexture, or destroying its native RenderTexture owner, disposes the replacement while the
  original remains registered and live. Texture-manager keys return to baseline, so counting keys alone misses it.
  Related primary [report #7379](https://github.com/phaserjs/phaser/issues/7379) and proposed
  [upstream fix #7381](https://github.com/phaserjs/phaser/pull/7381) describe this replacement path; their status is not
  a substitute for testing the consumed pin.

**Temporary dependency band-aid.** Copy the exact released
[phaser-dynamic-texture-patch.mjs](../scripts/assets/phaser-dynamic-texture-patch.mjs) into the consuming project's
scripts directory and invoke it from the existing postinstall after Phaser is installed:

```sh
node scripts/phaser-dynamic-texture-patch.mjs node_modules/phaser
```

An existing Node postinstall can instead import `patchDynamicTexture` and
`await patchDynamicTexture(installedPhaserDirectory)` from the copied module. Import alone has no side effect.
The helper requires exactly package name `phaser` and version `4.2.1`, and preflights one known native constructor
fragment in `src/textures/DynamicTexture.js`, `dist/phaser.esm.js` and `dist/phaser.js` before any write. Missing,
unknown, ambiguous, mixed original/corrected targets or mixed target newlines fail without partial edits. All targets
must share one original or corrected state and LF/CRLF style. Every outside byte is preserved, and repeated
installation is idempotent. It composes with the separate audio decode, audio visibility, gamepad lifecycle,
held-input and framebuffer restore corrections. Keep the consuming project's integrity guards consistent with the
released helper and invalidate any existing bundler dependency cache after correcting its input.

The correction calls native `renderer.deleteTexture(frame.source.glTexture)` immediately before assignment within
the existing WebGL-only branch. Native DynamicTexture/RenderTexture ownership and APIs remain in charge; this is
an install-time dependency correction, not a game-side runtime shim or warning suppression. Remove this band-aid
only after an equivalent reviewed, pinned upstream fix passes both allocation/disposal and retained-texture pixel
checks.

**Evidence and limits.** The Node fixture stores exact npm 4.2.1 DynamicTexture and Class source hashes and executes
the native constructor and destroy method with minimal external dependency doubles. In an isolated native discrete-GPU
ANGLE/D3D11 probe, eight DynamicTexture removals and eight RenderTexture destructions grew registered
wrappers from 4 to 20 before correction; GL texture counts were 32 creates and 16 deletes, with all sixteen orphans
live. The corrected separate package copy kept wrappers at 4 and balanced 32 creates with 32 deletes. Texture keys,
framebuffers and scene display counts returned to their original state after each cycle. Eight native RenderTexture
draws and their on-screen samples returned expected RGBA `(98, 201, 168, 255)`, preserving the drawing-context
texture. Actual served optimizer code and source map were bound to the corrected ESM; native browser warnings and
errors were zero, and scene/game resources, owned browser and server were closed. This is bounded pin/backend
evidence, not full game acceptance, sustained memory measurement, context recovery or phone certification.

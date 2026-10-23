# Phaser 4.2.1 renderer destruction gotchas

The texture-unit sampler placeholder at renderer destruction. Numbers match the index in [phaser-4-gotchas.md](phaser-4-gotchas.md).

## 25. Renderer destruction leaves the texture-unit sampler placeholder live

**Symptom and cause.** npm Phaser 4.2.1's native `WebGLTextureUnitsWrapper.init()` creates one bare `tempTexture`,
binds it to every texture unit and uploads a blue 1x1 pixel. The source states that the placeholder prevents MacOS
WebGL errors. It is not registered in `glTextureWrappers`, retained by its owner or deleted by `WebGLRenderer.destroy()`.
Restore calls `init()` again; live-context reinitialization also accumulates placeholders. Registered-wrapper counts alone miss it.
After ten native World restarts and two real context epochs, the consuming game's final valid epoch had 147 texture creates,
146 deletes and one valid survivor whose creation stack was `WebGLTextureUnitsWrapper.init -> WebGLRenderer.dispatchContextRestored`.
Framebuffers balanced 5/5 with zero live handles. Retained dead framebuffer-array entries were a separate harness-counting error.

**Temporary dependency band-aid.** Copy the exact released
[phaser-texture-units-patch.mjs](../scripts/assets/phaser-texture-units-patch.mjs) into the consuming project's scripts
and run it from the existing postinstall after installing Phaser:

```sh
node scripts/phaser-texture-units-patch.mjs node_modules/phaser
```

An existing Node postinstall can import `patchTextureUnits` and `await patchTextureUnits(installedPhaserDirectory)`.
Import alone has no side effect. The helper requires exactly `phaser@4.2.1`; it preflights both native owners
(`src/renderer/webgl/wrappers/WebGLTextureUnitsWrapper.js` and `src/renderer/webgl/WebGLRenderer.js`) and both consumed
bundles (`dist/phaser.esm.js`, `dist/phaser.js`) before any write. Only unambiguous all-original or all-corrected fragments
with common LF/CRLF are accepted. Missing, unknown, duplicate, mixed fragment/target states or mixed newlines fail without
partial edits. Outside bytes are preserved and repeat installation is idempotent. It composes in either order with all five
released audio decode, audio visibility, gamepad lifecycle, framebuffer restore and DynamicTexture helpers; preserve existing
held-input corrections too. Update consuming integrity guards and invalidate the old dependency optimizer cache.

The native owner retains `tempTexture` for the whole rendering lifetime. Before reinit it deletes only its still-valid
current-context placeholder, and its idempotent `destroy()` releases that valid handle and clears its own references.
Native renderer destruction invokes the owner while GL is still available. `isContextLost()` and `isTexture()` keep
context-invalidated handles out of deletion. The initial/restored placeholder, blue upload, active-unit behavior, ordinary
wrapped bind/null/unbind semantics and restoration order stay native. Immediate placeholder deletion defeats sampler
completeness; a game cleanup shim, custom registry, broad native-array clearing or warning suppression does not correct ownership.
Remove this band-aid only after an equivalent reviewed, pinned upstream fix passes live reinit, ordinary/lost destruction,
real context epochs and preserved initial/restored authored-pixel checks.

**Evidence and limits.** [Node tests](../../../tests/phaser-texture-units.test.mjs) execute the actual complete native owner
and renderer destroy/restore methods with their native Class and minimal external-boundary doubles. The
[fixture](../../../tests/fixtures/phaser-texture-units-4.2.1.json) retains exact native bytes and SHA-256 hashes from the
npm tarball verified against SHA-512 integrity, SHA-1 and SHA-256. Tests cover live sampler completeness, ordinary bindings,
repeat destruction, live reinit, restore and destroy-while-lost, plus API/CLI refusal, LF/CRLF, unchanged bytes and composition.

A separate integrity-bound package with all six helpers passed a focused Chromium 153 / discrete-GPU ANGLE/D3D11
WebGL 1 proof. Six live-context reinitializations retired their previous valid placeholder. Two actual context loss/restore
epochs kept the restored placeholder valid; native RenderTexture target/on-screen and Image pixels all returned RGBA
`(98, 201, 168, 255)` before and after restoration. The final non-invalidated epoch balanced 6 texture creates/deletes and
1 framebuffer create/delete, with zero valid handles and zero registered LIVE wrappers after native Game destruction.
The native dead framebuffer array retained one entry. Native AudioContext closed, game/scene/canvas were released, and the
owned browser/server/port closed. Four expected native context messages were retained separately; unintended browser/GL
warnings and errors were zero. The actual served optimizer response/cache/map was bound to corrected ESM bytes.
Earlier invalidated epochs are context-freed, not balanced-delete evidence. This proves the scoped pinned owners on this
backend; it does not establish full planet/game acceptance, sustained memory magnitude, every custom effect or phone/backend certification.

# Select and verify Phaser dependency corrections

## Select by feature and symptom

- [documented] These seven independent installers target exactly `phaser@4.2.1`. Select the corrections required by the game's features and reproduced symptoms. The order below is fixed even when arguments arrive in another order; no selection is automatic. Each installer corrects its native source and both unminified bundles, `dist/phaser.esm.js` and `dist/phaser.js`.

| Order | Patch ID | Feature and symptom | Installer and composition boundary | Verification command | Remove after a reviewed upstream fix |
| --- | --- | --- | --- | --- | --- |
| 1 | `gamepad-held-input` | Gamepad controls: older unchanged timestamps leave held values and axes stale or lose release/fresh-press edges. | [phaser-gamepad-held-input-patch.mjs](../../phaser-input/scripts/assets/phaser-gamepad-held-input-patch.mjs): `Gamepad.js` timestamp guard only; independent of lifecycle ordering and cached membership. | `node --test tests/phaser-gamepad-held-input.test.mjs` | Upstream accepts old unchanged snapshots at boot, acquisition and resume, preserving native constructor seeding and exact-once release/fresh-press edges. |
| 2 | `gamepad-lifecycle` | Gamepad connection capture: a held down can precede connected/disconnected callbacks; stopped scenes retain queued lifecycle events. | [phaser-gamepad-lifecycle-patch.mjs](../../phaser-input/scripts/assets/phaser-gamepad-lifecycle-patch.mjs): `GamepadPlugin.js` FIFO lifecycle publication and shutdown queue; held timestamp correction remains separate. | `node --test tests/phaser-gamepad-lifecycle.test.mjs` | Upstream publishes usable FIFO lifecycle before controls and retires stopped queues with bounded native listeners across restarts. |
| 3 | `audio-decode` | WebAudio loading: a rejected native decode Promise escapes despite the legacy error callback completing file failure. | [phaser-audio-decode-patch.mjs](../../phaser-audio/scripts/assets/phaser-audio-decode-patch.mjs): `AudioFile.js` Promise rejection handling; visibility lifetime is separate. | `node --test tests/phaser-audio-decode.test.mjs` | Upstream handles the native decode Promise and callbacks without unhandled rejection or duplicate completion. |
| 4 | `audio-visibility` | WebAudio visibility: the delayed callback uses a destroyed manager's closed or replaced context. | [phaser-audio-visibility-patch.mjs](../../phaser-audio/scripts/assets/phaser-audio-visibility-patch.mjs): `WebAudioSoundManager.js` callback lifetime/context guard; retains the live 100ms suspend/resume path. | `node --test tests/phaser-audio-visibility.test.mjs` | Upstream admits only a live manager's current open context while retaining the live visibility behavior. |
| 5 | `dynamic-texture` | WebGL DynamicTexture creation: replacing the initial TextureSource wrapper leaves an owned texture behind. | [phaser-dynamic-texture-patch.mjs](../../phaser-rendering/scripts/assets/phaser-dynamic-texture-patch.mjs): `DynamicTexture.js` disposes that wrapper before replacement; framebuffer and sampler ownership remain separate. | `node --test tests/phaser-dynamic-texture.test.mjs` | Upstream disposes the replaced TextureSource wrapper while preserving native drawing, resizing and destruction. |
| 6 | `framebuffer-restore` | WebGL context restoration: framebuffer recreation tries to delete handles invalidated by context loss. | [phaser-framebuffer-restore-patch.mjs](../../phaser-rendering/scripts/assets/phaser-framebuffer-restore-patch.mjs): `WebGLFramebufferWrapper.js` deletion guard; still deletes valid resources recreated during restore. | `node --test tests/phaser-framebuffer-restore.test.mjs` | Upstream avoids previous-context deletion and still disposes live resources recreated during native restore. |
| 7 | `texture-units` | WebGL sampler ownership: the completeness placeholder survives reinitialization or renderer destruction. | [phaser-texture-units-patch.mjs](../../phaser-rendering/scripts/assets/phaser-texture-units-patch.mjs): `WebGLTextureUnitsWrapper.js` and `WebGLRenderer.js` own and retire the placeholder; retains it during rendering. | `node --test tests/phaser-texture-units.test.mjs` | Upstream releases live current-context placeholders on reinit/destruction, preserves sampler completeness and handles context loss. |

## Apply and verify an explicit selection

- [tested] [patch-phaser.mjs](../../../examples/node/patch-phaser.mjs) uses the shipped installer APIs in the order above. `node --test tests/phaser-patch-orchestrator.test.mjs` covers individual, subset and complete selections, already-applied corrections, LF/CRLF, refusal before installed-file writes, verify hashes and temporary-copy cleanup.

Run from the plugin checkout, or invoke the entrypoint by absolute path and pass the installed package directory. Keep its relative imports and the shipped `skills/` layout together; copying this entrypoint alone does not copy its installers. For a game requiring both input corrections, for example:

```sh
node examples/node/patch-phaser.mjs /path/to/game/node_modules/phaser --patches gamepad-held-input,gamepad-lifecycle
node examples/node/patch-phaser.mjs /path/to/game/node_modules/phaser --patches gamepad-held-input,gamepad-lifecycle --verify
```

The API is `patchPhaser(packageDirectory, {patches: ['gamepad-held-input'], verify: false})`; `PATCH_IDS` lists the supported IDs. Its result is `{patches, changed, verified}` with ordered IDs and relative changed paths. Apply returns `verified: true` after validating the staged composition. Verify returns `verified: false` and lists paths needing corrections when recognized input is uncorrected; the CLI exits 1. Corrected input returns an empty changed list and exits 0. Invalid or unknown input throws; the CLI exits 1.

Apply validates the manifest and copies the selected targets to an isolated temporary directory, stages the entire composition, then checks its idempotence. Missing selection, unknown IDs, unsupported package/version, unknown or ambiguous fragments, and inconsistent source/bundle correction states refuse before any installed-file write. One selected correction may already be applied while another remains pristine. Only the selected fragments are validated; unrelated package contents are preserved without being certified.

Verify runs the same composition on isolated copies and never publishes the pending changes. Both modes recheck original SHA-256 hashes before publication/return and remove their temporary copies on success or failure. Hashes are taken from the supplied package; there is no table of patch-subset identities.

## Integration and removal

- [general] Apply after dependency installation and before the bundler optimizes Phaser; recreate an existing optimized dependency cache afterward. Keep the selection explicit in the consuming project's installation command. Existing individual installer entrypoints and their `{changed: [...]}` API remain supported.

There are no downloads, automatic patch choices or runtime monkey patches. Multi-file publication is not crash-atomic and does not lock the package against concurrent writers; stop competing installation/build work while applying. An I/O failure during publication can leave partial writes. Hash checks detect changes during preflight, not every possible race after it.

For a Phaser upgrade, rerun the row's behavior controls against unpatched upstream bytes, including its adverse/repeat controls, then remove only the correction whose upstream behavior passes. Every installer refuses versions other than 4.2.1; a newer version number alone is not evidence that a correction can be removed. The input [lifecycle hazards](../../phaser-input/references/gamepad-lifecycle-hazards.md) describe the synthetic browser evidence and physical-controller limits. Node rendering controls do not establish GPU/backend coverage; use the rendering references' manual probes for that evidence.

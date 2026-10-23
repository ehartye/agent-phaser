# Phaser 4.2.1 gotchas

Each entry: symptom, cause, evidence, workaround. The early entries were observed on Phaser 4.2.1
(published 2026-07-09), in WebGL on a discrete GPU through ANGLE/D3D11 on Windows; their upstream `master` source was
checked on 2026-10-05 and their suggested fixes are ours. Later entries identify their own bounded native evidence and related
upstream reports.

The gotchas are numbered; the number is stable across the files below.

| Section | File |
|---|---|
| 1. `TilemapGPULayer` draws at twice its position | [phaser-4-tilemap-gotchas.md](phaser-4-tilemap-gotchas.md) |
| 2. Empty tiles in a GPU layer render as an opaque tile 0 | [phaser-4-tilemap-gotchas.md](phaser-4-tilemap-gotchas.md) |
| 3. Hand-built tile animations need `animationDuration` | [phaser-4-tilemap-gotchas.md](phaser-4-tilemap-gotchas.md) |
| 8. A Container's alpha does not reach the CPU tilemap layers inside it | [phaser-4-tilemap-gotchas.md](phaser-4-tilemap-gotchas.md) |
| 10. Tile animations: GPU layers only, and the second animation plays the wrong tiles | [phaser-4-tilemap-gotchas.md](phaser-4-tilemap-gotchas.md) |
| 18. CPU tilemap layers inside a positioned container are culled as if the container were at the origin | [phaser-4-tilemap-gotchas.md](phaser-4-tilemap-gotchas.md) |
| 20. Per-plant motion on tilemaps: split the layer by phase, move the parent container | [phaser-4-tilemap-gotchas.md](phaser-4-tilemap-gotchas.md) |
| 4. A missing `import Phaser` compiles, then fails at runtime | [phaser-4-api-and-effects-gotchas.md](phaser-4-api-and-effects-gotchas.md) |
| 5. `anims.createFromAseprite` registers animations under the bare tag name, globally | [phaser-4-api-and-effects-gotchas.md](phaser-4-api-and-effects-gotchas.md) |
| 6. Phaser 4 removed `setTintFill` | [phaser-4-api-and-effects-gotchas.md](phaser-4-api-and-effects-gotchas.md) |
| 7. Smaller observations | [phaser-4-api-and-effects-gotchas.md](phaser-4-api-and-effects-gotchas.md) |
| 9. Lighting, camera filters and render textures (measured on 4.2.1) | [phaser-4-api-and-effects-gotchas.md](phaser-4-api-and-effects-gotchas.md) |
| 12. Whole-pixel screen shake | [phaser-4-api-and-effects-gotchas.md](phaser-4-api-and-effects-gotchas.md) |
| 16. `emitter.setFrequency()` resets the flow counter, so calling it every frame starves the emitter | [phaser-4-api-and-effects-gotchas.md](phaser-4-api-and-effects-gotchas.md) |
| 21. Reactive companion art on a prop (a level meter): atlas frames owned by the prop's view | [phaser-4-api-and-effects-gotchas.md](phaser-4-api-and-effects-gotchas.md) |
| 11. Restarting scenes: a loading scene ignores `start`, and the sim must change in `init`, not before | [phaser-4-scene-lifecycle-gotchas.md](phaser-4-scene-lifecycle-gotchas.md) |
| 14. Scene lifecycle: what survives stop/start | [phaser-4-scene-lifecycle-gotchas.md](phaser-4-scene-lifecycle-gotchas.md) |
| 15. Focus, visibility, context loss, and unused audio | [phaser-4-webgl-context-gotchas.md](phaser-4-webgl-context-gotchas.md) |
| How these were found (do it this way) | [phaser-4-scene-lifecycle-gotchas.md](phaser-4-scene-lifecycle-gotchas.md) |
| 17. The `delta` your scene receives is smoothed | [phaser-4-scene-lifecycle-gotchas.md](phaser-4-scene-lifecycle-gotchas.md) |
| 19. Never destroy and recreate interactive objects in response to input | [phaser-4-scene-lifecycle-gotchas.md](phaser-4-scene-lifecycle-gotchas.md) |
| 22. A Scene object is reused, so state keyed to it survives with destroyed display objects | [phaser-4-scene-lifecycle-gotchas.md](phaser-4-scene-lifecycle-gotchas.md) |
| 13. `generateLayerDataTexture()` leaves a dead GL wrapper, and that breaks WebGL context restore | [phaser-4-webgl-context-gotchas.md](phaser-4-webgl-context-gotchas.md) |
| 23. Filter-mask framebuffers delete invalid handles during WebGL context restore | [phaser-4-webgl-context-gotchas.md](phaser-4-webgl-context-gotchas.md) |
| 24. DynamicTexture and RenderTexture creation leaves a live GPU texture wrapper behind | [phaser-4-webgl-context-gotchas.md](phaser-4-webgl-context-gotchas.md) |
| 25. Renderer destruction leaves the texture-unit sampler placeholder live | [phaser-4-renderer-destruction-gotchas.md](phaser-4-renderer-destruction-gotchas.md) |

# Dynamic lights and cone lights in Phaser 4.2.1

Phaser lights are per-object WebGL shader effects. Cone guide: `node_modules/phaser/docs/Phaser 4 Cone Lights/Phaser 4 Cone Lights.md`. Pixel-banded light maps, day/night grade and weather: [lighting and atmosphere](lighting-and-atmosphere.md).

Probe: `node examples/web/phaser-probes/phaser-worlds-lights.mjs /path/to/host-project`. Every [tested] bullet below is a check in [the probe](../../../examples/web/phaser-probes/phaser-worlds-lights.mjs).

## Turn it on

- [tested] A lit object is black, not dim, until `scene.lights.enable()` has run; after it the default ambient `0.1` shows (26 of 255). `setLighting(true)` alone is a trap.
- [documented] `lights.disable()` puts lit objects back in that black state (`src/renderer/webgl/Utils.js#updateLightingUniforms` returns early when the manager is inactive), so for daylight set ambient to `0xffffff` instead.
- [documented] Opt in with `setLighting(true)`: Image, Sprite, TileSprite, Text, BitmapText, Blitter, Graphics, Shape, Mesh2D, ParticleEmitter, SpriteGPULayer, Stamp, Video, TilemapLayer and TilemapGPULayer support it. Container/Layer do not: opt in each child. `PointLight` glows but lights nothing else.
- [tested] CPU and GPU tilemap layers are both lit.
- [general] `lighting` is a flag on the object: a recreated layer starts unlit, while a reused pooled layer keeps it.
- [documented] Normal maps ride on the texture: `load.image(key, [colorUrl, normalUrl])` or `{ normalMap }`; atlases take `normalMap` too ([paired atlas from agent-sprites](normal-mapped-sprites.md)); a GPU tilemap layer reads the tileset texture's `dataSource[0]` (`SubmitterTilemapGPULayer.js`). Without one the renderer's flat normal is used and shading depends only on distance and light height `z`.
- [documented] `addLight(x, y, radius, rgb, intensity, z)`: `z` defaults to `radius * 0.1`; a Light is a Circle with origin, scrollFactor and visible, so `light.setScrollFactor(0)` pins it to the screen (`src/gameobjects/lights/Light.js`).

## Cone lights (4.2.0)

- [documented] API: `lights.addConeLight(x, y, radius, rgb, intensity, rotation, inner, outer, z)`, `light.setCone(rotation, inner, outer)`, `setConeRotation`, `setConeAngles`, `disableCone`. Fields: `coneEnabled`, `coneRotation`, `coneInnerAngle`, `coneOuterAngle`. Angles clamp to 0..2PI and outer >= inner; omitted outer gives a hard edge (`Light.js#setCone`).
- [tested] Angles are full widths and rotation is radians with 0 pointing +x and PI/2 pointing +y (down the screen). Inner 30 and outer 60 degrees: lit at 15 degrees off axis, back to ambient at 30. `disableCone()` returns to a full radius light.
- [documented] The shader fades with `smoothstep(cos(outer/2), cos(inner/2), dot)`; equal angles switch to a hard `step` (`src/renderer/webgl/shaders/DefineLights-glsl.js`). The direction goes through the camera matrix, so a rotated camera turns the cone with the world.
- [documented] Guide defaults: flashlight radius 360/intensity 2.5/angles 35°/75° (narrow 18°/35°); lantern 60°/120°; searchlight 25°/25°. Up-pointing art: `setConeRotation(rotation - Math.PI / 2)`.
- [general] Headlight: radius 400, angles 25°/45°. Enemy vision: radius 160, hard 90°/90°. Update position/rotation from the display object each frame.
- [general] A vision cone in a game is a sim fact (an angle test on positions). The light is its picture; never read light state for logic.

## Limits and cost

- [documented] `render.maxLights` defaults to 10 (`src/core/Config.js`) and is compiled into every lit shader as `LIGHT_COUNT`, the loop bound. A light whose circle misses `camera.worldView` is skipped for that camera ([cameras](cameras.md) explains the stale, rotation-blind view).
- [tested] Over the cap Phaser kept the first 10 visible lights created, despite its nearest-light comment/guide. `LightsManager#sortByDistance` returns a boolean rather than a number; Chromium left creation order unchanged. Sort lights by camera-centre distance yourself and `setVisible(false)` beyond the cap; hidden lights leave before the cap applies.
- [documented] `getLights` runs for every lit draw call (`BatchHandlerQuad#setupUniforms` calls `updateLightingUniforms`) and allocates a record per visible light. Lit and unlit objects, and different self-shadow settings, start a new batch (`docs/Phaser 4 Rendering Concepts`), so light the ground and actors, not every particle.
- [documented] The guide describes a small shader cost per active cone: use one player cone plus a few radius lights; ambient colour replaces many dim lights. Avoid many large overlapping cones.
- [tested] Radius and `z` are world units: a point light 28 px away reads the same at zoom 1 and zoom 3.

## Self-shadow

- [documented] `obj.setSelfShadow(enabled, penumbra, diffuseFlatThreshold)` requires lighting/WebGL (`components/Lighting.js`). Defaults: null/0.5/1⁄3; null follows `render.selfShadow` (false). Shader `DefineLights-glsl.js` scales diffuse by `smoothstep((diffuse-threshold)/penumbra)`, with `threshold=1-(r+g+b)/diffuseFlatThreshold`: dark texels can raise threshold above zero; normal direction affects diffuse.
- [tested] On white/near-black (25) stripes under a high light, whites stayed 224; darks went 22 (off), 13 (on), 2 with `diffuseFlatThreshold` 1, and 22 with `penumbra` 0.05 (`phaser-worlds-lights.mjs`). The colour map affects self-shadow; this flat-normal stripe result alone does not qualify authored normals.
- [tested] `setSelfShadow` mutates a prototype-level object shared by existing/new objects. First assign `obj.selfShadow = { enabled: false, penumbra: 0.5, diffuseFlatThreshold: 1 / 3 }`; subsequent calls then affect only that object. The probe restores original shared identity, descriptors, values and draw hooks on success/failure.
- [tested] Different self-shadow settings split the batch: two lit images with the same setting drew in 1 call, and one with it on beside one with it off drew in 2. Set it per layer (the ground, the actors), not per sprite.

- [tested] The same probe validates the bounded authored-normal fixture: 32 rows (authored/flat × four directions × off/three enabled states), unchanged paired atlas frame `1`, scale 6, origin 0, position (100,70), 400×300 identity camera. Light radius/intensity/z are 2000/2/120; ambient is 0x303030. All 12 enabled authored rows darkened pixels; every restored-off frame matched exactly. Counts below are full-frame changed pixels, not a quality score.

| Light position | On (0.5, 1/3) | On (0.05, 1/3) | On (0.5, 1) |
| --- | --- | --- | --- |
| Left (-150,140) | 20478 | 197 | 21600 |
| Right (600,140) | 20187 | 121 | 21549 |
| Above (200,-250) | 18467 | 100 | 20238 |
| Below (200,600) | 20152 | 108 | 20556 |

- [tested] The low-penumbra rows changed none of the four declared orb observer regions despite their nonzero full-frame counts. Authored-versus-flat off frames differed in every direction. Results retain all rows, decoded source hashes, region counts, PNG/RGBA and held state. `--mutation normal-source` fails actual loaded-source authentication; `--mutation restoration` shifts the sprite and fails restored pixels. Both retain failure frames and exact cleanup. `--out <directory>` retains unique runs there.
- [general] This table qualifies one hardware fixture and exact `setSelfShadow(enabled, penumbra, diffuseFlatThreshold)` arguments, not arbitrary art, aesthetics or performance. Software runs retain observations with `hardwareQualified: false` and verdict `unverified`; they cannot qualify hardware acceptance. Keep shader parameter names separate from these observed setter-argument mappings.

## Choosing a lighting approach

| Want | Use | Why |
| --- | --- | --- |
| Soft lamps, flashlight, normal-mapped art | Phaser lights with `setLighting` | smooth falloff in the shader, no extra pass |
| Hard pixel bands, walls that block light, a day and night grade | the light map in [lighting and atmosphere](lighting-and-atmosphere.md) | banded stamps, CPU line of sight, one grade function |
| A glow with no effect on other objects | `PointLight` or an ADD-blended image | cheapest; ignores normal maps |
| Whole-screen mood | ambient colour plus a filter on the world camera or world Layer | no per-object cost |

- [general] They combine: drive `setAmbientColor` from the same pure grade function the light map uses, and feed both from one light list. Do not run both for the same lamp, or the area is lit twice.
- [general] Phaser lights have no occlusion and light falloff is smooth; on strict pixel art, test that the smooth gradient is acceptable before building on it.

## Verify

- [general] At zoom 1 and game zoom, sample lamp centre/radius, inside/outside cone and behind it ([verification](../../phaser-verification/references/verifying-on-a-gpu.md)). Check `getLights(camera).length <= maxLights` and `visibleLights`. Mutate `outerAngle` to 2PI: the outside-cone pixel must cross its threshold.

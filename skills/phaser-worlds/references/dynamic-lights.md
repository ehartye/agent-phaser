# Dynamic lights and cone lights in Phaser 4.2.1

Phaser's own lights: per-object, WebGL only, evaluated in the object's shader. This covers turning them on, what they light, the limits, and the 4.2.0 cone lights for flashlights, lanterns, headlights and vision cones. Phaser's cone guide is `node_modules/phaser/docs/Phaser 4 Cone Lights/Phaser 4 Cone Lights.md`. The pixel-banded light map, day and night grade and weather live in [lighting and atmosphere](lighting-and-atmosphere.md).

Probe: `node examples/web/phaser-probes/phaser-worlds-lights.mjs /path/to/host-project`. Every [tested] bullet below is a check in [the probe](../../../examples/web/phaser-probes/phaser-worlds-lights.mjs).

## Turn it on

- [tested] A lit object is black, not dim, until `scene.lights.enable()` has run; after it the default ambient `0.1` shows (26 of 255). `setLighting(true)` alone is a trap.
- [documented] `lights.disable()` puts lit objects back in that black state (`src/renderer/webgl/Utils.js#updateLightingUniforms` returns early when the manager is inactive), so for daylight set ambient to `0xffffff` instead.
- [documented] Each object opts in with `setLighting(true)`. Lit classes in 4.2.1: Image, Sprite, TileSprite, Text, BitmapText, Blitter, Graphics, Shape, Mesh2D, ParticleEmitter, SpriteGPULayer, Stamp, Video, TilemapLayer and TilemapGPULayer. `Container` and `Layer` have no lighting flag; set it on each child. `PointLight` is a separate glow object that lights nothing else.
- [tested] CPU and GPU tilemap layers are both lit.
- [general] `lighting` is a flag on the object: a recreated layer starts unlit, while a reused pooled layer keeps it.
- [documented] Normal maps ride on the texture: `load.image(key, [colorUrl, normalUrl])` or `{ normalMap }`; atlases take `normalMap` too ([paired atlas from agent-sprites](normal-mapped-sprites.md)); a GPU tilemap layer reads the tileset texture's `dataSource[0]` (`SubmitterTilemapGPULayer.js`). Without one the renderer's flat normal is used and shading depends only on distance and light height `z`.
- [documented] `addLight(x, y, radius, rgb, intensity, z)`: `z` defaults to `radius * 0.1`; a Light is a Circle with origin, scrollFactor and visible, so `light.setScrollFactor(0)` pins it to the screen (`src/gameobjects/lights/Light.js`).

## Cone lights (4.2.0)

- [documented] API: `lights.addConeLight(x, y, radius, rgb, intensity, rotation, inner, outer, z)`, `light.setCone(rotation, inner, outer)`, `setConeRotation`, `setConeAngles`, `disableCone`. Fields `coneEnabled`, `coneRotation`, `coneInnerAngle`, `coneOuterAngle`. Angles clamp to 0..2PI; an outer angle below the inner one becomes the inner; omit outer for a hard edge (`Light.js#setCone`).
- [tested] Angles are full widths and rotation is radians with 0 pointing +x and PI/2 pointing +y (down the screen). Inner 30 and outer 60 degrees: lit at 15 degrees off axis, back to ambient at 30. `disableCone()` returns to a full radius light.
- [documented] The shader fades with `smoothstep(cos(outer/2), cos(inner/2), dot)`; equal angles switch to a hard `step` (`src/renderer/webgl/shaders/DefineLights-glsl.js`). The direction goes through the camera matrix, so a rotated camera turns the cone with the world.
- [documented] Starting numbers from the guide: player flashlight radius 360, intensity 2.5, 35 / 75 degrees (a narrow beam is 18 / 35); soft lantern 60 / 120; hard searchlight 25 / 25. If the sprite art points up, `setConeRotation(rotation - Math.PI / 2)`.
- [general] Headlight: radius 400, 25 / 45. Enemy vision cone: 90 / 90 degrees, hard edge, radius 160. Update position and rotation from the display object each frame so the beam never leads the sprite.
- [general] A vision cone in a game is a sim fact (an angle test on positions). The light is its picture; never read light state for logic.

## Limits and cost

- [documented] `render.maxLights` defaults to 10 (`src/core/Config.js`) and is compiled into every lit shader as `LIGHT_COUNT`, the loop bound. A light whose circle misses `camera.worldView` is skipped for that camera ([cameras](cameras.md) explains the stale, rotation-blind view).
- [tested] Over the cap Phaser kept the first 10 visible lights in creation order, not the 10 nearest, although its comment and the cone guide say nearest. `LightsManager#sortByDistance` returns a boolean instead of a number, and in Chromium that left the order unchanged. Keep the active count under the cap yourself: each frame sort your lights by distance to the camera centre and `setVisible(false)` the rest. Hidden lights leave before the cap is applied.
- [documented] `getLights` runs for every lit draw call (`BatchHandlerQuad#setupUniforms` calls `updateLightingUniforms`) and allocates a record per visible light. Lit and unlit objects, and different self-shadow settings, start a new batch (`docs/Phaser 4 Rendering Concepts`), so light the ground and actors, not every particle.
- [documented] The guide calls a cone a small amount of shader math per active cone. Its advice: one player cone plus a few radius lights, not many large overlapping cones; use ambient colour for general darkness instead of many dim lights.
- [tested] Radius and `z` are world units: a point light 28 px away reads the same at zoom 1 and zoom 3.

## Self-shadow

- [documented] `obj.setSelfShadow(enabled, penumbra, diffuseFlatThreshold)` (`src/gameobjects/components/Lighting.js`) needs `setLighting(true)` and WebGL. Each setting is an object `{ enabled, penumbra, diffuseFlatThreshold }` with defaults `null`, 0.5 and 1/3; `enabled: null` follows `render.selfShadow`, which defaults to `false`. The shader (`DefineLights-glsl.js`) scales each light's diffuse by `smoothstep((diffuse - threshold) / penumbra)` with `threshold = 1 - (r + g + b) / diffuseFlatThreshold`: only texels whose colour is dark enough to push the threshold above 0 can be shadowed, and they are lit only where their normal faces the light.
- [tested] Self-shadow darkens dark texels and leaves bright ones alone. On a texture of white and near-black (25) stripes under a light high above it, the white stripes stayed 224 and the dark ones went from 22 (off) to 13 (on), to 2 with `diffuseFlatThreshold` 1, and stayed 22 with `penumbra` 0.05 (`phaser-worlds-lights.mjs`). So the effect is authored in the colour map: very dark crevice texels get contact shadow, bright art does not.
- [tested] The settings object is shared. `setSelfShadow` on one object changed the settings every other object sees, existing ones and ones made afterwards, because they all read one prototype-level object. Give an object its own copy first (`obj.selfShadow = { enabled: false, penumbra: 0.5, diffuseFlatThreshold: 1 / 3 }`) and then call `setSelfShadow` on it: after that it changed only that object.
- [tested] Different self-shadow settings split the batch: two lit images with the same setting drew in 1 call, and one with it on beside one with it off drew in 2. Set it per layer (the ground, the actors), not per sprite.

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

- [general] Read pixels at the lamp centre, at a known radius, inside the cone, outside the cone and behind the light, with the camera at zoom 1 and at the game zoom ([verifying](../../phaser-verification/references/verifying-on-a-gpu.md)). Assert `scene.lights.getLights(camera).length <= maxLights` and `scene.lights.visibleLights`. Mutation proof: set `outerAngle` to 2PI and watch the outside-cone pixel cross the threshold.

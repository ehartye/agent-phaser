---
name: phaser-worlds
description: Build a Phaser 4 world and make it feel alive - levels made of tilemaps or loose sprites, hiding what is off screen, chunk streaming, cameras and zoom, dynamic and cone lights, normal-mapped sprites, day and night, fog, weather, particle emitters, animated water and ambient motion. Use when working in a project that depends on phaser and the task touches the world, its camera or its atmosphere, even when the user names only the result - build a level, room or dungeon with walls and props, top-down or isometric, the water does not read as water, add ripples, rain, mist or wind, add weather or mood lighting, make the level feel alive - or when a tile layer draws in the wrong place, a camera follows, zooms, shakes or snaps wrongly, or choosing a particle emitter, pooled sprites or a GPU layer. Not for glow, bloom and other filters (phaser-rendering), physics and tile collision (phaser-physics), tweens and sprite animation (phaser-motion), pixel UI (phaser-pixel-ui) or measuring frame cost (phaser-verification).
---

# Phaser worlds

How a Phaser 4.2.1 game draws, lights and moves a camera through a world bigger than the screen. Phaser 3 habits fail here: there is no automatic culling of sprites, tile layers have two renderers, and `roundPixels` stops snapping at zoom. Before writing the function that builds a level or area, read the first row: hiding by position is one call in that loop and a rewrite afterwards. Read the reference that matches the work; the numbers in them come from the 4.2.1 source and from the probes under `examples/web/phaser-probes`.

| You are about to | Read |
| --- | --- |
| Build a level or area: a tilemap, or a floor image with loose sprites for walls, plants, props and creatures (top-down or isometric) | [building a level](references/building-a-level.md) |
| Set up cameras: follow, zoom, bounds, minimap, shake, snapping; find out why a HUD, pointer or worldView is off | [cameras](references/cameras.md) |
| Add a flashlight, lantern, headlight, vision cone or point lights; a lit object is black or lights go missing | [dynamic lights](references/dynamic-lights.md) |
| Light a sprite from an agent-sprites colour atlas plus normal atlas: loader call, frames, tags, pivot, which way the light falls | [normal-mapped sprites](references/normal-mapped-sprites.md) |
| Add an emitter, rain, snow or dust; choose emitter, pooled sprites or `SpriteGPULayer` | [particles](references/particles.md) |
| Pull particles toward a point (`GravityWell`) or ease their colour over life (`colorEase`) | [particle processors](references/particle-processors.md) |
| Load Tiled, CSV or array maps; choose a CPU or GPU layer; edit tiles at runtime; read object layers | [tilemap data and formats](references/tilemap-data-and-formats.md) |
| Group a world: Layer or Container, depth, parallax, hiding far objects, HUD versus world space | [world structure and streaming](references/world-streaming-and-layers.md) |
| Draw a chunked tilemap with pooled views, blends, animated water or procedural terrain | [tilemaps and terrain](references/tilemaps-and-terrain.md) |
| Hit a tile layer that draws in the wrong place, paints tile 0, animates the wrong tiles or is culled wrongly | [Phaser 4 tilemap gotchas](references/phaser-4-tilemap-gotchas.md) |
| Add day and night, fog, saturation, heat shimmer or a pixel-banded light map | [lighting and atmosphere](references/lighting-and-atmosphere.md) |
| Add drifting shadows, wind, ambient particles or footsteps to a strict pixel game | [ambient motion](references/ambient-motion.md) |

## Rules that earned their place

- [documented] **Dense ground is a GPU layer; sparse or special content is a CPU layer.** A GPU layer paints an empty cell as the sheet's top-left pixel and has no per-tile tint (`TilemapGPULayer-frag.js`, 4.2.0 changelog).
- [tested] **A GPU layer keeps only `flipX` and `flipY`.** Tiled rotations and vertical flips draw wrong on it, so a map authored with rotated tiles needs CPU layers.
- [tested] **Place layers by type.** A GPU layer draws at twice its position, so keep it at (0, 0) inside a positioned Container, but tile collision reads the layer's own x, y, not the container's ([tilemap collision](../phaser-physics/references/tilemap-collision.md)). A CPU layer inside a Container is culled as if at the origin, so give it its real x, y directly or inside a `Layer`. Layer and Container alpha never fade tile layers; set alpha on the layer.
- [tested] **File every world object under a chunk as you create it, and hide the chunks away from the view.** Nothing culls sprites by position: offscreen images cost the same as visible ones, every extra camera repeats the pass, and only hidden objects are free. This holds for a floor image with loose wall, prop and creature sprites as much as for a tilemap. In the loop that builds an area, give each object to [`createChunkVisibility`](scripts/assets/chunk-visibility.mjs) (objects stay flat, so depth sorting is unchanged) or to its chunk's Container or Layer, update from the follow target, not from `worldView`, and prove it with the view census ([building a level](references/building-a-level.md)).
- [tested] **Camera numbers have traps.** `scrollX` is not the left edge once zoom is not 1, `worldView` is a frame stale and ignores rotation, `startFollow(target)` switches `roundPixels` off unless you pass `true`, and `roundPixels` does not snap vertices at zoom other than 1.
- [tested] **Lights.** A lit object is black until `scene.lights.enable()`. Over `maxLights` (10) Phaser keeps the first lights created, not the nearest, so hide the extras yourself. Cone angles are full widths; rotation 0 points right and PI/2 points down.
- [tested] **Particles.** Emitter particles live in emitter space (moving the emitter moves them), `frequency: 0` emits per frame so density follows the monitor, `maxParticles` is a lifetime cap, and the WebGL path does not round vertices. A strict pixel game uses a pooled sprite set.
- [tested] **`setScrollFactor(0)` is not a HUD under zoom.** Put the HUD in its own scene with its own camera.
- [tested] **Camera filters belong to the world camera only**, or to a world Layer when the UI shares the camera: a camera filter grayed the UI the same camera drew, while a second UI camera and a Layer filter left it red (`phaser-worlds-cameras.mjs`).

## Probes

- [tested] Re-run after every Phaser upgrade: `node examples/web/phaser-probes/phaser-worlds-cameras.mjs <host>`, then `-lights`, `-particles`, `-tilemaps`, `-layers`, and `phaser-verification-content-cost.mjs` for the chunk-visibility helper. `<host>` is a folder with `phaser` 4.2.1 and `playwright-core` or `@playwright/test` installed. Each prints its checks and exits non-zero when a behaviour changed, so a reference can be corrected rather than trusted. All 84 checks passed on a software renderer and on one hardware Direct3D 11 backend.

## Not covered here

Renderer internals, filters and context loss are [phaser-rendering](../phaser-rendering/SKILL.md). Collision with tiles is [phaser-physics](../phaser-physics/SKILL.md). Tweens and sprite animation are [phaser-motion](../phaser-motion/SKILL.md). Integer scale and pixel UI are [phaser-pixel-ui](../phaser-pixel-ui/SKILL.md). Measuring frame cost is [phaser-verification](../phaser-verification/SKILL.md). The headless sim a world draws from is described in [engine-phaser](../engine-phaser/SKILL.md).

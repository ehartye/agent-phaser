# Particles in a Phaser 4.2.1 world: emitters, weather, cost

How `ParticleEmitter` really behaves in a scrolling world, what it costs, and when to use a bespoke pool or `SpriteGPULayer` instead. Phaser's config tour is `node_modules/phaser/skills/particles/SKILL.md`; the pixel-exact pool pattern is [ambient motion](ambient-motion.md).

Probe: `node examples/web/phaser-probes/phaser-worlds-particles.mjs /path/to/host-project`. Every [tested] bullet below is a check in [the probe](../../../examples/web/phaser-probes/phaser-worlds-particles.mjs).

## What an emitter is

- [tested] Particles live in the emitter's local space. Moving the emitter to (200, 100) moved a particle already alive at (100, 100) with it, and the particle's own `x, y` stayed (0, 0). A trail that stays behind needs the emitter fixed at (0, 0) and `emitParticleAt(worldX, worldY)` or `startFollow(target)` (`Particle#fire` adds the follow position to the local position).
- [documented] The emitter is a Game Object with Transform, Depth, BlendMode, ScrollFactor, Lighting, Mask and a single alpha (`src/gameobjects/particles/ParticleEmitter.js`). Depth, scrollFactor, blend mode and `setLighting` are per emitter, not per particle; the draw alpha is particle alpha times emitter alpha.
- [tested] An emitter with `setScrollFactor(0)` stays at its screen position while the camera scrolls (zoom 1). Under zoom it is scaled about the viewport centre like any other scrollFactor 0 object ([cameras](cameras.md)).

## Rates and limits

- [tested] `frequency: 0`, the default, emits `quantity` per rendered frame: 60 particles after a second at 60 fps, 144 at 144 fps. `frequency > 0` is milliseconds and time based (100 ms with 2 per batch gave 20 and 18 particles in a second at 60 and 144 fps). Use `flow(ms, n)` for weather so density does not follow the monitor.
- [documented] `setFrequency()` resets the flow counter, so calling it every frame starves the emitter: gotcha 16 in [phaser-rendering](../../phaser-rendering/references/phaser-4-api-and-effects-gotchas.md) (`ParticleEmitter.js#setFrequency`).
- [tested] `maxParticles: 5` emitted five particles in total and never again, because `atLimit` compares alive plus dead against it. It is a lifetime cap, not a pool size. `maxAliveParticles: 5` is the concurrent cap: it kept emitting and never held more than five.
- [documented] `frequency: -1` emits only on `explode` and `emitParticleAt`. `stopAfter` and `duration` stop emission and fire `COMPLETE` when the last particle dies; `fastForward(ms)` pre-warms by running `preUpdate` in 16.7 ms steps, so a long pre-warm costs that many updates at creation.

## Cost

- [documented] `preUpdate` advances every alive particle on the CPU each frame, on screen or not. Each death allocates a record and splices the alive array (`ParticleEmitter.js#preUpdate`). `viewBounds` only skips drawing the emitter, not updating it; `pause()` (sets `active = false`) stops updates.
- [tested] Alive particles are cheap but not free: 2,000 cost about 0.2 ms of CPU draw submission and 10,000 about 0.9 ms, with about 0.2 ms to update 10,000 (one desktop CPU, software GL, CPU side only; compare ratios, not the figure).
- [general] Fill rate from large soft or additive quads is the usual limit on phones: shrink the texture and the count before anything else.
- [tested] The WebGL particle path does not round vertices. With `roundPixels` on at zoom 1, an Image at x 10.4 drew a whole-pixel quad and a particle at 10.4 drew a fractional one. Particles therefore shimmer on strict pixel art; use a bespoke pool there.
- [documented] Particles are in the quad batch family with Image and Sprite; a different blend mode, a lit emitter among unlit objects, or a different round-pixels behaviour starts a new batch (`docs/Phaser 4 Rendering Concepts`). `sortProperty` or `sortCallback` re-sorts every frame (`ParticleEmitterWebGLRenderer.js`).
- [general] Budget by `maxAliveParticles` and choose `lifespan` so the steady state sits under it. One shared emitter at (0, 0) with many `explode(n, x, y)` bursts beats an emitter per hit; destroy one-shot emitters on `COMPLETE`.

## Weather and ambient recipes

- [general] Screen-space weather (rain, snow, dust motes): a `scrollFactor 0` emitter in a scene or camera at zoom 1, spawning along the top edge with a random rectangle zone, falling with `gravityY`. No camera tracking and no world coordinates, but it cannot stop at roofs.
- [general] World-space weather: emitter at (0, 0) and an emit zone that reads the camera each spawn, plus a death zone for shelter.

```ts
emitter.addEmitZone({ type: 'random', source: { getRandomPoint: (p) => {
  const v = cam.worldView; p.x = v.x + Math.random() * v.width; p.y = v.y - 8; return p; } } });
emitter.addDeathZone({ type: 'onEnter', source: { contains: (x, y) => underRoof(x, y) } });
```

- [documented] An emit zone source needs `getRandomPoint(point)` and a death zone source needs `contains(x, y)` (`src/gameobjects/particles/zones/`). The death zone tests `particle.worldPosition` each update, so a lookup in your own tile data costs no allocation.
- [documented] Wind: `accelerationX`, `gravityX/Y` or a `ParticleProcessor` (`addParticleProcessor`). A processor runs per particle per frame, so keep it to arithmetic. Bursts for footsteps, dust and sparks: `explode(n, x, y)`.

## Emitter, bespoke pool or SpriteGPULayer

| Need | Use | Limit |
| --- | --- | --- |
| Bursts and trails with tint, scale or alpha over life; up to a few thousand alive | `ParticleEmitter` | CPU per alive particle; no vertex rounding |
| Strict pixel look (whole-pixel positions, palette tints, blink not fade) or spawn rules from sim data | pooled Images, see [ambient motion](ambient-motion.md) | you write the rules |
| Tens of thousands of looping decorations (rain streaks, motes, fireflies, grass) fixed at creation | `SpriteGPULayer` ([details](../../phaser-rendering/references/sprite-gpu-layer-and-batching.md)) | one single-image texture, edits rebuild the buffer, no sim interaction |
| A repeating texture across the view (cloud shadows, haze) | `TileSprite` sized to the view | see ambient motion |

- [documented] `SpriteGPULayer` stores 168 bytes per member on CPU and GPU, draws every member in one call, animates members in the shader (looping, yoyo, a `Gravity` ease), needs a power-of-two texture for pixel art, and treats `addMember`, `editMember` and `removeMembers` as buffer updates; "remove" a member by setting scale and alpha to 0 (`src/gameobjects/spritegpulayer/SpriteGPULayer.js`; `changelog/v4/4.0/CHANGELOG-v4.0.0.md`).
- [general] Pick the pool for anything the game must react to (shelter, wind from a sim, collisions) and the GPU layer for scenery that only needs to loop.

## Verify

- [general] Assert `emitter.getAliveParticleCount()` against the budget after a long run; step `preUpdate(0, ms)` directly to test rates without a browser loop; compare counts at 60 and 144 fps for any `frequency: 0` emitter; read pixels to prove placement and that a death zone empties a sheltered area.

# Particle processors and colour over life (Phaser 4.2.1)

`GravityWell` attractors and `colorEase` on an emitter: defaults, the space their numbers live in, and the traps. Emitter basics, rates and cost are in [particles](particles.md); the check ids are in `phaser-worlds-particles.mjs` in [the probes folder](../../../examples/web/phaser-probes/README.md).

## Gravity wells

- [documented] `emitter.createGravityWell({ x, y, power, epsilon, gravity })` builds a `GravityWell` (`src/gameobjects/particles/GravityWell.js`), adds it as a processor and returns it; `addParticleProcessor(new GravityWell(...))` is the same with a processor you made. Each frame it adds velocity toward the well, scaled by `power * gravity` and by the particle's distance; `epsilon` is a softening distance inside which the pull stops growing.
- [tested] `power` defaults to 0, so a well created with only `x` and `y` does nothing: a particle beside one stayed exactly where it was. The other defaults are `epsilon` 100 (kept squared, 10,000) and `gravity` 50.
- [tested] The well's `x` and `y` are in the particles' own space, the emitter's local space. On an emitter at world y 100, a well at local `(400, 0)` with `power: 10` moved a particle along x only (x 39 and still rising after 30 frames, y exactly 0). Place wells relative to the emitter, and move the emitter, not the well, to move a vortex.
- [tested] An attractor has no drag. A particle started 100 units from a `power: 10` well at x 100 flew past it (x 179) and was pulled back at speed 500 after 30 frames. Use a low `power` and a short `lifespan`, or write a small `ParticleProcessor` that damps velocity, when you want a swirl that does not orbit forever.

## Colour over life

- [tested] `color: [a, b]` interpolates the tint over a particle's life, and `colorEase` is the curve: unset is the same as `'linear'` (identical tints at 48 percent of life), and `'quad.out'` was further along the list at the same life (blue 186 and red 68, against blue 123 and red 131 for linear).
- [documented] `colorEase` has no effect unless the emitter has a `color` list (`ParticleEmitter#colorEase`). Easing names are the Phaser ease strings such as `'quad.out'`; the getter returns the name as written (`'Linear'` for the default).
- [general] Pixel-art particles that must stay on the palette should not interpolate through blended colours: use two or three `color` stops that are palette entries, or step the colour in an `update` callback.

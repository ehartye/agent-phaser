# Performance of a Phaser 4 tile game: measure first, then these

Numbers are Fallow Valley on Phaser 4.2.1, a real GPU (D3D11), 1920x1080 at devicePixelRatio 2 with 4x CPU throttle unless stated.

## 1. How to measure (do this before changing anything)

- **Real GPU, vsync off.** Launch Chromium with `--use-angle=d3d11 --ignore-gpu-blocklist --disable-gpu-vsync --disable-frame-rate-limit` (platform
  equivalent elsewhere) and read `game.loop.actualFps`; otherwise every scene reads 60. Software GL hides GPU problems and invents CPU ones.
- **CPU frame cost**, not fps: record `performance.now()` at `Core.Events.PRE_STEP` and `POST_RENDER`; keep a window of 240 frames; report average,
  p95 and max. The GPU runs asynchronously, so a long CPU frame is the signal that matters.
- **Draw calls have no counter in the renderer.** Wrap `drawElements`, `drawArrays` and their instanced forms on the `WebGLRenderingContext` and reset the
  count at `POST_RENDER`:

```ts
for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const) {
  const orig = gl[fn].bind(gl); (gl as any)[fn] = (...a: unknown[]) => { draws++; return orig(...a); };
}
```

- **CPU throttling** through CDP (`Emulation.setCPUThrottlingRate`, 4x) finds problems a fast desktop hides; use Event Timing (key to next paint),
  long tasks, and a sampling CPU profile (self and inclusive time) for the real story.
- **Toggle layers off one at a time** (shadows, atmosphere, ambient, clouds, weather, roofs, ui) and re-measure; the delta is the cost.
- Put budgets in tests, loosely (they should catch doubling, not drift), and attach the numbers to the report.

example: fallow-valley-next `src/game/debug/perf.ts` (counter and window), `debug/layers.ts`, `tools/profile-title.mjs`, `tools/cpu-profile.mjs`,
`tools/profile-layers.mjs`, `tests/perf/budget.spec.ts`, `docs/PERF.md`.

## 2. Findings that generalise

| Finding | Evidence | Do |
| --- | --- | --- |
| **Submit only what touches the screen.** A pooled chunk ring bound one chunk beyond the camera was drawn too. CPU tilemap layers with `skipCull` walk all their tiles each frame, so the margin ring was about 60% of render time | world render 29 ms to 9 ms, draw calls 88 to 40, title idle 29 to 58 fps | bind a margin, but `setVisible(false)` every view that does not intersect `camera.worldView` (plus a small slack) |
| **Hide empty layers.** A hidden tilemap layer is not walked or submitted | most of 10 layers per chunk are empty most of the time | keep a live-tile count per layer; toggle visibility when it crosses 0 |
| **One `Tileset` per atlas and layer kind.** `addTilesetImage` walks the whole atlas frame list; ten per chunk view made creating a view about 17 ms (70 ms at 4x throttle) | 16 views on the first frame | build one per `(texture, gpu or cpu)` in a `WeakMap`; a layer accepts a Tileset object directly; reuse `map.tiles` |
| **GPU layer for the dense ground** | one quad and one data texture per layer, flat cost | GPU for dense or animated, CPU for sparse; see [tilemaps](tilemaps-and-terrain.md) and gotcha 2 |
| **Batch GPU data uploads** | `generateLayerDataTexture` repeated many times per frame still works but is waste | mark layers dirty on edit, flush once per frame |
| **Allocation, not count, is the cost** | 640 pooled images with typed-array state ran under 0.3 ms | pool objects, struct-of-arrays, free-list; avoid template-string keys, `Map.values()` iterators and per-call object builders in hot loops; read `chunk.ground[i]` directly |
| **Skip passes that cannot change anything** | full-daylight skips the light map | early-out on "nothing to do" |
| **Filters cost nothing while inactive** | `setActive(false)` | turn on only while needed |
| **Rate-limit expensive CPU effects** | heat map repaint at 12 Hz; solid grid rebuilt only when the view crosses a tile | cache and key on view tile |
| **Lights cost one quad each** | 48 cap | cull and cap by distance to the view centre |
| **Chunk binding is the remaining spike** | one task of 0.9 to 1.5 s at 4x throttle for 16 views | bind in time slices (open item) |

Things measured and cleared (do not chase): audio unlock (decodes run off the main thread), title UI rebuild (about 2 ms), devicePixelRatio (CPU
bound, not fill bound).

## 3. Camera and chunk maths worth knowing

At zoom 3 on 1280x720 the world view is 427x240 world pixels: 4 chunk windows (32x32 tiles at 16 px = 512 px) touch the screen and 16 are bound with a
one-chunk margin. A long teleport that binds new views before releasing old ones transiently doubles the pool (32 views, 64 containers); release first if
you need a hard ceiling. The simulation's own chunk store is separate and, if it never evicts, grows with exploration; say so.

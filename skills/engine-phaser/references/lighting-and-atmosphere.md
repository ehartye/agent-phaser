# Light, time of day and weather in a pixel-exact Phaser 4 game

Day and night, lanterns, fog, saturation and heat shimmer for a game that must not blur or blend art colours. Measured on
Phaser 4.2.1, a real GPU, 1280x720 at zoom 3. Complements gotcha 9 (the short measurements) with the design.

## 1. Three problems, three owners

1. **The grade**: a pure function `computeGrade({ hour, weather, biome, underground })` returning an ambient RGB multiplier, fog
   colour and amount, saturation, shimmer, flicker. It reads the sim's one `daylight(hour)`; nothing else keeps its own idea of
   night. Ease the live grade toward the target (`1 - exp(-dt / tau)`, about 0.7 s) so weather and the clock never pop. Unit-test it
   in Node.
2. **The lights**: a list of `{ x, y, radius, colour, intensity, flicker, daylit }` gathered from tiles (re-scanned only when the view
   crosses a tile or a tile/prop changes), entities and glowing particles; cull against the view and keep the nearest N (48).
3. **The effects**: fog, saturation, shimmer, pulse, wetness. Whole-screen treatments chosen by the grade.

## 2. A light map: one texel per world pixel, multiplied over the world

```ts
const rt = scene.add.renderTexture(0, 0, viewW + 2, viewH + 2).setOrigin(0).setDepth(D).setBlendMode(Phaser.BlendModes.MULTIPLY);
rt.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
// every frame
rt.setPosition(Math.floor(cam.worldView.x), Math.floor(cam.worldView.y));          // world-locked, integer position
rt.fill(ambientHex, 1);
for (const l of lights) rt.stamp('pool', undefined, Math.round(l.x - ox), Math.round(l.y - oy), { scale: l.radius / 64, tint: l.hex, blendMode: Phaser.BlendModes.ADD });
rt.render();                                                                          // commands only run here
```

- `pool` is a 128 px disc made once on a canvas with **twelve stepped alpha bands** and no dithering, nearest-filtered. Edges are
  crisp pixel bands at any integer zoom; nothing blurs.
- **RenderTexture and DynamicTexture commands are queued and run, and are cleared, only in `render()`** (`DynamicTexture.render`
  empties the buffer at its end, `src/textures/DynamicTexture.js#L299`). Never queue without rendering.
- **Skip the whole pass in full daylight** (every ambient channel above 0.97 and no flicker): about 0.6 ms saved.
- **Occlusion** (walls blocking light underground) cannot be done with stamps. Compute the same bands on the CPU with tile line of
  sight into a `CanvasTexture` (`putImageData`, `refresh`), drawn MULTIPLY and nearest. About 3 ms in the heaviest room at 1280x720;
  rebuild the solid grid only when the view crosses a tile or a tile changes.
- Fog is the one linear-filtered thing (haze is not pixel art): a vignette image that keeps the player's surroundings clear, tinted
  by the grade.

example: fallow-valley-next `src/game/view/Atmosphere.ts` (`drawLightMap`, `drawField`, `makePoolTexture`), `atmosphere-math.ts`,
`light-field.ts`, `docs/ATMOSPHERE.md`.

## 3. Camera filters on the world camera only

```ts
const color = cam.filters.internal.addColorMatrix();   color.setActive(false);
const heat  = cam.filters.internal.addDisplacement('heatMap', 0, 0); heat.setActive(false);
// each frame: color.setActive(needSaturation); if (needSaturation) color.colorMatrix.reset().saturate(sat - 1);
```

- Filters belong to one camera (`FilterList`, `src/gameobjects/components/FilterList.js#L364`). Put the interface in its **own scene
  with its own camera** and no world filter can touch it (assert `uiScene.cameras.main.filters.internal.list.length === 0`).
- `setActive(false)` costs nothing. Turn a filter on only while it has work.
- `ColorMatrix.saturate(-1)` is full greyscale, `0` identity (`src/display/ColorMatrix.js#L204`).
- Crispness: with `pixelArt: true`, shimmer left the distinct colour count unchanged (449 on, 546 off). A blur would add hundreds;
  a displacement only moves existing pixels. Test it that way.
- Heat shimmer: a 64x64 displacement canvas of rising bands repainted at about 12 Hz; strength a few thousandths.

## 4. Why not `setLighting`

Measured, not assumed: 8 lights on 183 objects cost 1.7 ms (577 fps); the light map's heaviest scene 2.3 ms. Speed was not the
reason. Smooth falloff fights hard-banded art, there is no occlusion, it is per-object opt-in (pooled chunk layers would need
re-enabling on every rebind), and it cannot express a grade (saturation, haze, flicker). It does work on tilemap layers, sprites and
images. If you want smooth lamps and have no pixel constraint, use it.

## 5. Test it on the GPU

Read real pixels (see [verifying](verifying-on-a-gpu.md)): night over noon luminance ratio (0.33 measured; assert under 0.6); the
player's pool against far field; vault dark corner against lit pool; pairwise weather grades differ; shimmer moves pixels without adding
colours and spares the UI camera; fps at least 55 with everything on. Mutation proofs: revert a fix and watch the number cross the
threshold.

Known limits to write down: no surface occlusion; creature lights use the sim position (up to one tick ahead of the sprite); colours
unjudged on other GPUs or calibrated displays.

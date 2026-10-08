# Ambient motion in a strict pixel game (Phaser 4.2.1)

How Fallow Valley made a procedural world feel alive without breaking a pixel-only look (nearest filtering, one integer
scale per layer, whole-pixel positions, palette colours). Measured on a real GPU.

## Layers that cover the screen: `TileSprite`, moved in whole pixels

Cloud shadows, sun rays and similar are `scene.add.tileSprite(...)` over a small texture (128x128 four-band noise,
64x64 diagonal bands) with `texture.setFilter(NEAREST)` and an **integer** `setTileScale(6, 6)`, so every texel is a hard
square of the world. To keep it world-locked while it drifts:

1. Each frame, place the sprite at the camera's `Math.floor(worldView.x/y)` and size it to the view plus 2 px.
2. Keep a drifting offset as a float, but use `Math.round(offset)`.
3. `tilePositionX = (viewX - roundedOffsetX) / scale` (same for Y).

Texel edges then land on integer world pixels and the pattern moves in whole-pixel steps. MULTIPLY with texel colours
0.7..1.0 darkens ground to 0.73-0.75 of its luma at alpha 1; alpha fades the strength. Non-power-of-two textures (112x64)
are fine. A stepped vignette is the same idea: a small texture with four brightness bands drawn as an `Image` at the
integer scale that covers the view, centred on the rounded camera centre.

## Particles: one pool, typed arrays, whole pixels

- A fixed pool of `Image`s (640 ran in under 0.3 ms) with struct-of-arrays state (`Float32Array` x, y, z, vx...), a free-list
  stack and per-kind caps. Never create or destroy objects per particle; hide and reuse.
- Draw frames from one canvas atlas painted at boot from ascii: white or mid-grey frames so `setTint(paletteColour)` gives
  exact colours; bake colour only where a frame needs several (tumbleweed, puddle).
- **Origin (0,0) and `round(x) - (width >> 1)`.** An odd-sized frame on the default centred origin sits on half pixels and
  breaks the integer grid. Positions `Math.round`, scale 1, rotation 0, alpha 1. Blink instead of fading.
- Height is a separate `z` (screen y = y - z), with a ground shadow image for things that hop or fly.
- Spawn rules as data (kind, rate per screen per second, grounds, biomes, weather, daylight window, edge/shore/inner).
  Scan the visible tiles when the view crosses a tile and sample from per-rule candidate lists; rejection sampling starves
  rare ground such as a pond or a road. Read `chunk.ground[i]` directly (`tx >> 5`, `& 31`) instead of building tile objects.
- Particles that glow (fireflies, sparks) should hand real light sources to the lighting pass, not just draw bright dots.
- Kill particles outside the view plus a margin: cost follows the screen, not the world.

## Wind: a pure field, whole-pixel sway

Wind is a pure `windAt(weather, t, x, y)` with a travelling gust wave, so two places differ at one instant, plus a forced-wind control for
the harness. Plants sway by whole pixels through four phase containers per layer set (a tilemap layer has no per-tile transform: see
[gotchas](phaser-4-gotchas.md) 20); roofed tiles go to non-swaying layers; a Reduce motion setting zeroes the offsets and cuts gusts to
about 40%. Prove it with three specs: calm is pixel-identical to no sway, a gale peak moves the pixels, a roofed field does not move.

## Test it

- Frame diff: screenshot twice 0.9 s apart in a scene where nothing else moves; it must differ by a measured fraction
  (8.6 percent in a desert noon) and be **identical (0.000 percent)** with the motion layer switched off, so the difference
  is the motion layer.
- Ratio: read 16x16 block luma with the layer on and off; assert the deep band's ratio and that open sky is untouched.
- Palette and grid: read back `image.tintTopLeft`, `x`, `y`, `scaleX`, `rotation`, `alpha` for every visible particle.
- Fps with everything running, uncapped (`--disable-gpu-vsync --disable-frame-rate-limit`) and capped.
- A contact sheet of cropped frames (tools/motion-seq.mjs in Fallow Valley) is how you judge "does it feel alive"; look at
  whole-screen frames too, because a particle can be correct and invisible against the ground.

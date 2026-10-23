# Pixel-perfect rendering: the source-pixel footprint (Phaser 4.2.1)

One integer footprint per context and the device-pixel mapping. Index: [pixel-perfect-and-ui.md](pixel-perfect-and-ui.md).

## 1. One integer source-pixel footprint per context, chosen from device pixels

- [general] **World layer**: choose a whole source-pixel multiplier `N`. For a layer using a uniform `A` world units per source pixel,
  camera zoom is `N / A`, not necessarily a whole number. With the device-pixel canvas policy below, a requested CSS/world zoom
  can use `N = max(1, round(A * requestedCssZoom / scene.scale.zoom))`; the actual CSS/world footprint is `N * scene.scale.zoom / A`.
  Report that quantized footprint at fractional DPR. A source-scale-1 tile world may still choose its integer camera zoom from
  `clamp(floor(canvasWidth / (tilesAcross * TILE)), min, max)`; that fit policy is an example, not a requirement for every game.
- [general] **UI layer**: a separate scene with its own camera. A common single-density path uses whole zoom `S`. `S = clamp(min(floor(h / 270), floor(w / 320)), 1, 6)`
  gives 2x at 1280x720, 3x at 1600x900, 4x at 1080p and 1x on a 390 px phone. Lay out in **logical pixels** (canvas / S, rounded
  down); at most `S - 1` device pixels are left over at the right and bottom and nothing draws there.
- [general] **Resolution contexts may differ** (world 3x, menu 4x, HUD 3x, cards 2x). Define each density and transform with a named native owner;
  reuse compatible pane cameras instead of allocating a camera per widget. Within a context, preserve its authored source-pixel
  footprint. A bigger title uses a separately authored bigger face. Do not infer density from the theme or silently enlarge a face.
- [general] For the common single-density path, apply the UI scale with the camera:

```ts
cam.setViewport(0, 0, w, h).setOrigin(0, 0).setZoom(S).setScroll(0, 0);
cam.roundPixels = scene.game.renderer.type !== Phaser.CANVAS;
// re-run on Scale.Events.RESIZE and on your own "scale changed" event; remove both on SHUTDOWN
```

Keep the scale calculation a pure, unit-tested function and the camera setup a thin wrapper around it.

For pinned Phaser 4.2.1 native Canvas, keep `roundPixels=false`; the common whole-zoom/single-density path with physically aligned
origins uses explicit integer local object geometry. Contextual geometry instead follows the physical paint quantization below.
WebGL uses `true` in that common path. Canvas `batchSprite` adds 0.5 to destination frame width and height when camera rounding
is enabled; `BitmapTextCanvasRenderer` separately rounds glyph x/y. Those branches are separate from snapping object placements. Native
bitmap, tiled panel and trimmed Image crop controls qualified both backends at integer UI camera zooms,
including fractional DPR, in one project. Recheck actual source pixels when changing Phaser versions; do not patch the renderer
or add a second text compositor. Source: Phaser 4.2.1 `src/renderer/canvas/CanvasRenderer.js` (`batchSprite`),
`src/gameobjects/bitmaptext/static/BitmapTextCanvasRenderer.js`.

Phaser 4.2.1 sets `camera.renderRoundPixels` only when both camera zoom axes are integers (`src/cameras/2d/Camera.js`). That flag
does not inspect art scale: at `A = 2`, camera zoom 3.5 gives 7-device-pixel source blocks even while the flag is false. Use native
camera bounds, centering/following and `getWorldPoint`; a false flag alone does not justify a renderer patch or copied transform.
Verify actual sprites, labels, origins and camera motion with framebuffer samples before adding any alignment policy.
The standalone [source-pixel probe](../../../examples/web/phaser-probes/source-pixels.mjs) measures integer and half-integer camera
zooms on scaled art, alongside a fractional source-scale-1 UI counterexample. Its tiny texture does not certify a whole game or phone.

### Mixed-density calculation and native binding

Keep three spaces explicit: atlas/font **source pixels**, component **local coordinates**, and backbuffer **physical pixels**.
Released agent-sprites 0.88.0 exports `pixelResolution`, `projectPixelPoint`, `projectPixelRect`, `quantizePhysicalPoint`
and `quantizePhysicalRect` in `ui-runtime.mjs`. Pin and verify that export; use its contract rather than inventing a camera transform
in a shared widget package. Its immutable
descriptor has a caller-namespaced `id`, nonnegative integer `revision`, uniform positive `localToPhysical.scale`, finite
`localToPhysical.origin`, and positive integer `physicalPixelsPerSourcePixel`. Rotation, shear and nonuniform transforms reject.
The game chooses contexts, cameras and density; the helpers neither allocate nor discover them.

For local-to-physical scale `S = 3` and physical source-pixel footprint `P = 2`, source-to-local scale is `P / S = 2/3`.
This is valid: one source pixel still occupies two whole physical pixels. Do not require integer component-local geometry or
camera zoom as a substitute for that footprint. Native adapters must feed the planned physical geometry through their final
transforms; camera rounding alone is not proof. Preserve the pinned Phaser 4.2.1 Canvas exception above.

Projection defaults to `to-physical`; `to-local` is its continuous inverse. Neither snaps points or rectangles, including negative
or fractional origins. Quantization is an explicit physical-space paint decision. Contextual `placeBitmapText` and `planNineSlice`
take `{resolution}` instead of `{scale}`; supplying both rejects. Plans carry `context: {id, revision}`, local destinations and
`physicalDestination`. Text snaps its anchor nearest on grid 1 and fit bounds inward. Skin extents fit whole source-pixel crops
relative to the snapped origin, so the painted face can be smaller than its requested allocation. Check reported painted overflow;
a narrow skin can still escape its allocation. These decisions do not fit, ellipsize or clip the content for the game.

Keep **paint, hit, focus and clip bounds separate**. A small painted face can have a full touch/semantic target. Reject cached plans
whose identity or revision differs from the current context. Advance the descriptor revision whenever the local-to-physical mapping
or source-pixel footprint changes, including pane scroll, viewport, zoom, origin and density transitions; `Display.revision` alone
is insufficient. Use continuous inverse projection for pointer, hit and focus geometry; never pass them through paint quantization.
Gate press and release against the actual interaction clip. Route input through the control's owning camera/context rather than
assuming every control belongs to the main UI camera.

The game owns CSS canvas extent/offset, DPR conversion, safe areas and resize publication. Convert client coordinates to physical
pixels once; in a device-pixel Phaser setup, Phaser pointer coordinates are already physical. Convert safe areas once into their
destination context. Cancel held input before publishing any updated mapping or source-pixel footprint with its context revision,
including scroll and density transitions. On resize, coherently publish the backbuffer, targets, camera transforms and revised
contexts through that same cancellation barrier. Preserve input cancellation on close, blur, pointer cancellation and shutdown,
and dispose owned listeners, objects and cameras, including partial mount failure.

Informational regions with no actions do not prove interactive routing at another density.
Before claiming native adoption, exercise both an informational region and an actual interactive control whose painted face is
smaller than its full target. Prove visible focus, pointer/keyboard activation, clipping, cancellation, scroll/density/resize
transitions with stale-plan rejection and repeated disposal on native WebGL and Canvas. Reuse existing display, viewport, camera, HUD-density and input owners.
Pure projection checks establish calculations; native controls and framebuffer evidence establish downstream rendering/input.

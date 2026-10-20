# Pixel-perfect rendering and a pixel-only UI layer (Phaser 4.2.1)

For a game whose every visible pixel, including text and menus, must come from authored pixel assets. Keep one integer physical
footprint per authored source pixel in each resolution context, device pixels not CSS pixels, and no resampling. Component-local
units and camera zoom need not be integers. The existing native camera policy was verified on a real GPU at devicePixelRatio 1,
1.25, 1.5 and 3; that evidence does not establish mixed-density interactive controls.

## 1. One integer source-pixel footprint per context, chosen from device pixels

- **World layer**: choose a whole source-pixel multiplier `N`. For a layer using a uniform `A` world units per source pixel,
  camera zoom is `N / A`, not necessarily a whole number. With the device-pixel canvas policy below, a requested CSS/world zoom
  can use `N = max(1, round(A * requestedCssZoom / scene.scale.zoom))`; the actual CSS/world footprint is `N * scene.scale.zoom / A`.
  Report that quantized footprint at fractional DPR. A source-scale-1 tile world may still choose its integer camera zoom from
  `clamp(floor(canvasWidth / (tilesAcross * TILE)), min, max)`; that fit policy is an example, not a requirement for every game.
- **UI layer**: a separate scene with its own camera. A common single-density path uses whole zoom `S`. `S = clamp(min(floor(h / 270), floor(w / 320)), 1, 6)`
  gives 2x at 1280x720, 3x at 1600x900, 4x at 1080p and 1x on a 390 px phone. Lay out in **logical pixels** (canvas / S, rounded
  down); at most `S - 1` device pixels are left over at the right and bottom and nothing draws there.
- **Resolution contexts may differ** (world 3x, menu 4x, HUD 3x, cards 2x). Define each density and transform with a named native owner;
  reuse compatible pane cameras instead of allocating a camera per widget. Within a context, preserve its authored source-pixel
  footprint. A bigger title uses a separately authored bigger face. Do not infer density from the theme or silently enlarge a face.
- For the common single-density path, apply the UI scale with the camera:

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

## 2. Device pixels, not CSS pixels

`Scale.RESIZE` sizes the canvas in CSS pixels. On a display with `devicePixelRatio` 1.25 or 1.5 the browser stretches that canvas by a
fraction and every art pixel becomes a different width. Size the canvas to the page times the ratio and set Phaser's CSS zoom to the
inverse, so each layer picks its integer source-pixel footprint from device pixels:

```ts
scale.scaleMode = Phaser.Scale.NONE;
const dpr = Math.max(1, devicePixelRatio), w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
if (scale.zoom !== 1 / dpr) scale.setZoom(1 / dpr);
if (scale.width !== w || scale.height !== h) scale.resize(w, h);
// re-apply on window resize and on matchMedia(`(resolution: ${devicePixelRatio}dppx)`) change (browser zoom, moving monitors)
```

This is the one `1 / dpr` in the codebase; allow-list it in the "no fractional scale" test. A browser spec at DPR 1.25, 1.5 and 3 proves
it.

## 3. All text is `BitmapText` from the tool's own font export

- Never `add.text`/`make.text`, CSS fonts, or browser tooltips for visible game UI. Ban them with a test that scans the presentation code
  and checks for unintended browser-rendered game chrome. Semantic controls and native input bridges follow section 7; do not ban them by counting DOM nodes.
- Use the tool's exported metrics (agent-sprites `ui-phaser.json`: advances, frame rectangles, texture coordinates per tone) and
  register each tone as a `BitmapFont` with `cache.bitmapFont.add(key, { data, texture, frame: '__BASE', fromAtlas: false })`. **A tone
  is a different set of glyph frames, never a tint.**
- Prefer released agent-sprites 0.88.0's pinned `ui-runtime.mjs`, which exports `normalizeBitmapFont`, `bitmapLineWidth`, `wrapBitmapText`,
  `measureBitmapText` and `placeBitmapText`. Normalize once per loaded font; the immutable snapshot preserves advances, authored
  tones, atlas rectangles and trim offsets. Use the same calculations for Node layout and native binding instead of maintaining
  another metrics implementation. Keep existing native adapters until their required export and downstream parity are verified.
- A single-density native path can draw one `BitmapText` per wrapped line at font scale 1 and integer offsets. A contextual adapter
  consumes the plan in its declared space, including fractional local destinations. Retain game-authored newline/tab/empty,
  trailing-advance, line-height/spacing and terminal-space policies explicitly; defaults do not prove legacy parity. Keep fitting,
  ellipsis and glyph-coverage decisions in the game. Missing legacy cell/baseline or ink stays unknown; texture dimensions do not
  establish it. Trim offsets apply once and cannot substitute for reported source-cell ink bounds.
- Floating world labels are the same face at the *world* layer's zoom: rise in whole-pixel steps, blink out instead of fading.

## 4. Panels are tiled, not stretched

Phaser's `NineSlice` stretches its centre and edges. A stretch by a fraction (a 16 px centre drawn 20 px wide) puts texel boundaries
between device pixels, which breaks the one-scale rule wherever the centre has detail (a slot inset, a highlight line). Build the panel
from nine whole-pixel pieces instead: four corners at their own size, and the edges and centre as `TileSprite`s that repeat the art in
whole source pixels. Take insets, padding, minimum sizes and painted bounds from the tool's export; there should be no size in the UI
code that came from looking at the art. (A flat single-colour shadow plate has no detail, so `NineSlice` is fine there.)

Prefer the same pinned sprites runtime's `planNineSlice` and `iterateNineSliceTiles` for portable skin geometry, then bind the
source crops and local/physical destinations to native rendering. Preserve authored padding/minimum-size policy in the adapter;
the pure planner does not infer a minimum. Existing Canvas wrappers keep their positive-integer guards and defaults.
Attribute a copied runtime's software source/version separately from the font/skin art manifest. Updating pure helper code does
not require regenerating font images or relabeling historical PNGs with a new producer version.

- Dim behind a modal with the skin's **dithered scrim** (a hard-alpha checkerboard) in a `TileSprite`, not a translucent rectangle.
- In the common whole-zoom/single-density path with physically aligned origins, slide with a tween that rounds local positions
  every frame (`setPosition(Math.round(fx + (tx - fx) * t), ...)`). For contextual motion, project the intended position to physical
  space, apply the declared physical paint quantization, then project back for native placement. Do not round local coordinates:
  at `S = 1.5`, local x = 1 becomes physical x = 1.5 even when `P = 2`. Preserve continuous semantic geometry independently; when
  motion changes a context mapping, advance its revision and cancel held input before publishing it as described in section 1.
  Leave by sliding. Nothing fades: a half-transparent pixel is a colour the art does not contain.
- Interface code never uses tint, rotation, alpha blends, `Graphics` or shapes as chrome. Enforce each with a source-scanning test.

## 5. Text must fit, in three layers

A string that runs off its box is a bug the type system cannot see. What worked:

1. **Static**: a table of every container (id, face, width as a function of the logical screen width, maximum lines) and every string
   that can go in it, measured with the real glyph advances at every supported width. A mutation block proves the check can fail.
   A source scan for unbounded `.print(` of dynamic text with a list of allowed exceptions that may only shrink.
2. **Runtime guard**: every text object registers itself; a debug call measures what is on screen from the real transforms and lists
   lines that leave the screen, leave a declared clip box, or overlap another line. The browser fixture fails any test with a finding.
3. **GPU walk-through**: open every screen with worst-case content at several viewport sizes and scales; compare pixels outside the
   window rectangle with the window hidden and shown.

Details that mattered: wrap to `maxLines` and end in an ellipsis; take width and height from the container, never from the text; let a clip
container declare its bounds; hide what a stepper covers so the guard never sees two texts on one pixel; keep a minimum logical height for the
scale override. Add a **glyph-repertoire test**: collect every string the game can show and require the bitmap font to draw all of it (there is
no system-font fallback, so a missing glyph shows as `?`). Key read-model deny tables by the sim's union so a new deny reason fails to compile
without words. A screen that rebuilds itself on a key must re-centre its window. Toasts: cap at two, merge identical messages, and give changes
already visible elsewhere a quiet flag.

A `Container` measures its hit area from its centre: `setInteractive(new Rectangle(0, 0, w, h))` on a container is offset by half its size, so a
click on a slot's centre selects the neighbour. Offset the rectangle (or put the zone on a child) and test by clicking centres.

Cover text fitting twice: a pure unit test of the measuring and layout function, and a browser spec that checks the rendered text stays inside its box.

## 6. Input capture and the keyboard queue

- One shared UI state (`{ capture, pointerOnUi, paused }`) on the registry. While a modal is open, and for a few frames after it closes,
  the world ignores movement, hotbar and tile clicks, so the key that closed a screen does not also act.
- **A keydown can reach a handler twice.** The keyboard queue is on the shared manager and every active scene's `KeyboardPlugin.update`
  dispatches it to its own listeners (`src/input/keyboard/KeyboardPlugin.js#L733`); the duplicate guard is per plugin. With the title and
  the world both active, a handler registered in both sees one DOM event twice (a typed name came out "AAda"). Dedupe by event identity
  (`WeakSet<KeyboardEvent>`) in every interface handler.
- Focus is spatial for menus on a pad (nearest node in a direction; drift across the axis counts double; wrap) and kept as a pure function
  (see [gamepad and input](gamepad-and-input.md)).

## 7. Accessible controls and native input without a second UI implementation

Pixel-only describes the game's visible rendering, not its accessibility tree. An `aria-live` node can announce a message but cannot
replace navigable buttons, named controls, selection state or editable text. Preserve those capabilities when porting an existing game.

- Define each screen's labels, actions, enabled/selected state and input values once. The Phaser view and semantic DOM projection consume
  that model and invoke the same action handlers. DOM measurements must not drive Phaser layout; do not maintain a second set of menus or rules.
- Project the interactive controls needed by assistive technology as real semantic elements with appropriate names, state and focus order.
  Visually conceal that projection without removing it from the accessibility tree (`display:none`, `hidden` and `aria-hidden` are not
  suitable for controls that must remain accessible). Use one live region for status updates where appropriate, without duplicate announcements.
- For character names, save-slot names or other editable fields, use a native input/textarea bridge for IME, selection, paste and the mobile
  software keyboard. Share its value and composition state with the bitmap presentation. Focus it from a real user gesture; support composition
  events and commit/cancel without letting typing trigger game commands. Keep browser chrome out of the rendered game; the OS keyboard remains native.
- Synchronize semantic and visual focus, visibly indicate focus in Phaser, contain it in modals and restore it on close. When a modal opens,
  underlying controls must stop being actionable in both projections. Manage listeners and DOM nodes with the owning scene's shutdown lifecycle.
- Verify keyboard-only navigation, assistive-technology activation reaching the same handler exactly once, names/states, focus restoration,
  text composition and repeated scene teardown. Inspect visible pixels separately. Test the actual mobile keyboard and VoiceOver on iPhone;
  desktop DOM tests and simulated events do not establish those device behaviors.

An `aria-live` announcement helper is not evidence of complete interactive accessibility. A one-node architecture assertion is
too restrictive for games with semantic controls or native text entry. The bridge above is architectural guidance, not a
validated shipped implementation.

## 8. Clipped scrolling in Phaser 4 WebGL

`Graphics.createGeometryMask()` plus `Container.setMask()` is a Phaser 3 recipe: in **4.2.1 WebGL**, `setMask` warns and does
nothing (`src/gameobjects/components/Mask.js`). It remains a Canvas API. Use native filter masks for WebGL; never recreate GL
scissors or upload a DOM/canvas UI image each frame. A dedicated camera viewport is another native option for a rectangular pane
when the screen already has clean camera ownership; keep its display/input exclusions explicit.

For the camera-viewport option, render a pane's panel, text, icons, button faces and focus indicators through
the same pane camera. Cameras render in their array order; object depth cannot put a main-camera button
above an opaque panel drawn by a later camera. Keep fixed chrome outside the pane and use explicit
`Camera.ignore` exclusions to prevent duplicate draws. When reusing pooled objects, reset their camera
exclusions before assigning their current owner. Remove owned pane cameras on scene shutdown.

Use the same clipped rectangle and scroll offset for pointer zones and visual controls. Verify actual
button/focus pixels with the pane visible, then without it; a working click zone does not prove a visible
control. Repeat after scrolling, resizing and scene restart on both native backends. This
diagnostic is not performance or physical-device acceptance.
Pinned source: [CameraManager.render](https://github.com/phaserjs/phaser/blob/v4.2.1/src/cameras/2d/CameraManager.js)
and [BaseCamera.ignore](https://github.com/phaserjs/phaser/blob/v4.2.1/src/cameras/2d/BaseCamera.js).

For a scrollable Container within the existing UI camera, keep a fixed parent and move only its content. This whole-zoom,
single-density recipe assumes physically aligned origins; its local scroll rounding does not apply to contextual rendering.
The GameObject mask is invisible rendering machinery, not drawn UI chrome:

```ts
const viewCamera = scene.cameras.main;
const viewport = new Phaser.Geom.Rectangle(x, y, width, height); // UI world coordinates
const content = scene.add.container(0, 0); // authored rows in local coordinates
const panel = scene.add.container(x, y, [content]);
const shape = scene.make.graphics({ x: 0, y: 0 }); // not in the display list
shape.fillStyle(0xffffff).fillRect(x, y, width, height);
panel.enableFilters();
panel.filtersFocusContext = true; // camera-sized surface, not full document height
panel.filterCamera!.setOrigin(viewCamera.originX, viewCamera.originY);
const mask = panel.filters!.external.addMask(shape, false, viewCamera);
mask.autoUpdate = false; // fixed viewport; invalidate after changes below

// Whole-zoom/single-density only: clamp to [0, max(0, contentHeight - height)]:
content.y = -Math.round(scrollY);

// After camera origin/zoom/scroll, viewport geometry, resize or context restore:
panel.filterCamera!.setOrigin(viewCamera.originX, viewCamera.originY);
mask.needsUpdate = true;
```

For contextual scrolling, retain the intended continuous scroll/model geometry separately. Project the intended paint position
to physical space, apply the declared physical paint quantization, and project back for native placement. Use the continuous
inverse for hit/focus/clip mapping; never feed them through local scroll rounding or paint snapping. When scrolling changes the
context mapping, advance its revision, cancel held input before publishing the updated mapping, and reject old-context plans.
Update the native mask/camera from that same current context; this recipe adds no alternate renderer or widget runtime.

The external mask uses the explicit view camera's coordinates. Keep `shape` outside the scrolling content. Redraw its rectangle
when the viewport changes, and update the panel position/layout from the same rectangle. In 4.2.1, `focusFiltersOnCamera` copies
zoom/scroll/rotation but not camera origin: synchronize the public `filterCamera` origin, especially for the top-left UI camera
in section 1. A zoom-1 test alone misses this mismatch. Internal masks use the filtered object's context instead; they are not a
drop-in replacement for this external world-coordinate recipe.

**Clipping pixels does not clip input.** Keep one fixed interactive `Zone` over the viewport and map its local pointer coordinates
plus the scroll offset to rows in the shared UI model; leave the rendered rows noninteractive. If existing widgets retain individual
hit targets, explicitly gate both press and release against the viewport in the correct camera coordinates. Masked-out rows must
not activate. Keyboard/controller/semantic focus uses that same model: scroll the focused row into view before indicating focus,
contain focus in modals, and route wheel only while the pointer is inside the pane.

For touch drag, retain the initiating pointer id, use camera-transformed coordinates, and cancel row activation once the gesture
becomes a scroll. Release capture on pointerup/upoutside, pointer cancellation, blur/hidden and shutdown; no drag may survive a
modal close or scene restart. Remove scene/global wheel, move, release and lifecycle listeners with their owner. Destroy the
unlisted `shape` explicitly. Destroy the owning `panel` (or let scene shutdown do so) to release its filter and dynamic mask texture;
if removing only the filter, remove it from its FilterList rather than leaving a destroyed controller registered.

**Bound resources to the viewport/camera.** The recipe deliberately uses `filtersFocusContext`, so a 20,000-pixel document does
not request a 20,000-pixel texture. External filtering still costs camera-sized intermediate surfaces and extra draw passes: reuse
one mask per open pane, invalidate only when its geometry/camera changes, close/destroy unused panes, and pool or virtualize large
row lists. Do not cache a unique text/whole-document texture for every scroll offset, value or screen. Measure before adding more
filtered panes; a camera viewport can avoid mask render targets for a simple rectangle. Do not allocate surfaces at the GPU maximum
texture size as a substitute for a viewport budget.

**Evidence:** [`examples/web/phaser-probes/scroll-mask.mjs`](../../../examples/web/phaser-probes/scroll-mask.mjs) is a runnable paired failure/correction probe using the host project's
Phaser 4.2.1 and Playwright. On 2026-10-06, Chrome with integrated-GPU D3D11 hardware rendering reproduced legacy overflow, then verified
outside/inside pixels, fixed clipping while scrolling, zoom 2 with matching camera origin, viewport-only pointer activation, and ten
scene restarts with stable texture/display-object/shutdown-listener counts. The long document retained a 400x300 filter camera.
It does not certify touch cancellation, semantic focus, GPU heap usage, context restoration, or iPhone behavior; add those tests in
the consuming game's real screen and test actual touch hardware before claiming mobile parity.

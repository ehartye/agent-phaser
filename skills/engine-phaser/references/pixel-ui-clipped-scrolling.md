# Pixel UI: clipped scrolling in Phaser 4 WebGL

Index: [pixel-perfect-and-ui.md](pixel-perfect-and-ui.md).

## 8. Clipped scrolling in Phaser 4 WebGL

- [general] `Graphics.createGeometryMask()` plus `Container.setMask()` is a Phaser 3 recipe: in **4.2.1 WebGL**, `setMask` warns and does
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

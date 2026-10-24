# Game objects, containers, groups and destroy (Phaser 4.2.1)

Which grouping object to use, what a Container costs and breaks, how pools and `destroy` behave. Facts are read from `src/gameobjects`; `[tested]` ones are check ids of the [foundations probe](../../../examples/web/phaser-probes/engine-phaser-foundations.mjs). Phaser's guides are `node_modules/phaser/skills/groups-and-containers/SKILL.md` and `game-object-components/SKILL.md`.

## Pick the grouping

| Need | Use | Limits |
| --- | --- | --- |
| A draw-order bucket with shared alpha, blend mode or filters | `Layer` | No position, rotation, scale or scroll factor; cannot sit inside a Container |
| Children that move, rotate or scale as one (a HUD widget, a composite character) | `Container` | Per-child matrix work every frame; list order, not depth; centred hit area |
| A pool, batch operations, a collision set | `Group` | Not drawn; `destroy()` keeps its children |
| Dozens of static pieces that never move apart | One texture (atlas frame or `DynamicTexture`) | Cannot re-pose pieces |

- [tested] Draw order differs. The scene display list sorts by `depth`; a `Layer` sorts its own children by `depth` at render; a `Container` draws its children in list order and ignores their `depth`. With a red object at depth 5 added first and a blue one at depth 1 added second, red won in the scene and the layer and blue won in the container (`objects-draw-order-scene-container-layer`, read from the framebuffer). Reorder inside a container with `bringToTop`, `moveTo` or `sort('depth')`.
- [tested] In 4.2.1 a `Layer` is a `List` with the `GameObject` mixin, not a subclass: `layer instanceof Phaser.GameObjects.GameObject` is false, it has `enableFilters`, it has no `setPosition` or `setScale`, and `container.add(layer)` throws `Tried to add a Layer to a Container: this is not allowed` (`objects-layer-is-a-mixin-without-a-transform`). The 4.1.0 changelog made it a "true GameObject" so filters work on it. Test `obj.type === 'Layer'`, not `instanceof`.
- [documented] Every game object carries the `Filters` and `RenderSteps` components (`src/gameobjects/GameObject.js`), so `enableFilters()` works on sprites, containers and layers alike; filter design is [phaser-rendering](../../phaser-rendering/SKILL.md).

## Container traps

- [tested] A container's input area is centred on its position. At (100, 100) with `setSize(50, 50)` it hit from 75 to 125 on both axes, not from 100 to 150 (`objects-container-hit-area-is-centred`); its `originX` and `originY` read 0.5. Lay children out around (0, 0) or offset them by half the size, and call `setSize` before `setInteractive`.
- [documented] Each frame the container renderer reads every child's `willRender`, writes the child's alpha and scroll factor, renders it, and restores them; a child with its own blend mode clones the drawing context, and a container with a blend mode overrides its children's (`src/gameobjects/container/ContainerWebGLRenderer.js`). Nesting multiplies this. Keep trees shallow and measure ([performance](../../phaser-verification/references/performance.md)).
- [documented] `exclusive` (default true) removes a child from the scene display list and from any other container when added. `Container#preDestroy` destroys exclusive children (`src/gameobjects/container/Container.js`). An Arcade body on a child takes the child's world position (`Body#updateBounds` reads `getWorldTransformMatrix`, `src/physics/arcade/Body.js`), so a translated container is fine; a scaled or rotated one distorts the body's motion, see [arcade bodies](../../phaser-physics/references/arcade-bodies-and-colliders.md). GPU tilemap layers add their own position, see [gotcha 1](../../phaser-worlds/references/phaser-4-tilemap-gotchas.md).
- [tested] An interactive object with `alpha` 0, `visible` false or scale 0 never receives pointer events, because `InputManager#inputCandidate` requires `willRender`; a `Zone` does (`objects-hidden-or-transparent-gets-no-input`). Use a `Zone` for an invisible hit area.

## Destroy semantics

- [documented] `GameObject#destroy` sets `isDestroyed`, runs `preDestroy`, emits `destroy(gameObject, fromScene)`, then removes all listeners (yours included), takes the object off the display and update lists, and destroys its input, data, body and filter camera. A second call returns at once (`src/gameobjects/GameObject.js`).
- [tested] `group.destroy()` leaves its children alive; `group.destroy(true)` destroys them; `container.destroy()` destroys its children (`objects-group-destroy-keeps-children-by-default`).
- [documented] Scene shutdown destroys the display list and update list with `destroy(true)`. A pool or reference you keep outside the scene then holds dead objects: rebuild it in `init` or `create` ([gotcha 22](phaser-4-scene-lifecycle-gotchas.md)). Timers, tweens and callbacks that outlive an object must check `obj.active` or `obj.isDestroyed` first.

## Pools

- [tested] `Group#get` and `getFirstDead` find the first member with `active === false`, move it and return it, but do not set `active` or `visible`. Until you call `setActive(true).setVisible(true)` the same member is handed out again. A full pool with no dead member returns `null` (`objects-group-get-reuses-without-reviving`). `killAndHide` only flips those two flags; reset physics bodies yourself ([phaser-physics](../../phaser-physics/SKILL.md)).
- [documented] `getHandler` copies the member set with `Array.from` and scans it on every call (`src/gameobjects/group/Group.js`), so a spawn costs time proportional to the pool size. Keep pools to tens or hundreds, or keep your own free list. `runChildUpdate: true` calls `update(time, delta)` on active members only.
- [general] Size a pool from a measured peak, set `maxSize` to it, and decide what a `null` spawn does (drop it, or recycle the oldest). A pool that grows without bound hides a leak.

## Verify

- [tested] `node examples/web/phaser-probes/engine-phaser-foundations.mjs <host project> --only=objects` runs the checks above; the draw-order check reads one pixel per case, so a software renderer is enough.

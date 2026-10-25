# Contract owners, themed families and local extensions

## Keep ownership explicit

- [documented] Agent-engine is a skills library over native engine capabilities. Architecture coordination here does not add runtime code. See the [shared UI API](shared-ui-api.md) for the actual export owner/version map, complete software pin and native ports; producer release and consumer adoption are independently verified.

| Concern | Contract owner | Consumer responsibility |
| --- | --- | --- |
| Portable pixel/font/skin geometry and exported asset identity | Agent-sprites | Native caches, display objects, clipping, input bindings and final downstream transforms |
| Reusable audio generation/playback capabilities and locked exports | Agent-beeps | Cue decisions, loading, gesture/mute/resume, specialized effects and delivery seams |
| Reusable test/playbot configuration, observations and cost evidence | Agent-tests | Game adapters, policies, domain facts and production-action bindings |
| Architectural coordination and adoption guidance | Agent-engine | Apply the contract through the existing native engine |
| Rules, actions, saves/session state and authored content | Each game | Keep one authoritative implementation and observable commands/results |

- [documented] Tests 0.4.1 ships Playbot configuration/recording; games retain directors/input execution. Sprites UI ships in 0.96.1; each consumer independently verifies its released pin. Verify installed exports; keep game-name switches out of shared code and widget runtimes out of Engine.
- [documented] Useful donor seams include a pure UI layout with bespoke-body composition, a sim/content/game split with playbot adapters, and native hardware admission with owned origins. Recheck donor source before extracting; a session wrapper does not automatically have the independently instantiated sim semantics of a project that was built around one.

## Define the session boundary before sharing

- [general] Commands enter an authoritative session/rules owner; observable state/events leave it. Views, UI and bots dispatch actions rather than mutate rules state. Storage, clock, gameplay RNG, bot RNG, input, audio and lifecycle belong to named owners rather than rendering callbacks or shared globals.
- [general] Preserve each game's authoritative state during incremental migration. A headless sim pattern is a target boundary, not permission to label a facade around global state pure or independently instantiable. Separate bot randomness from gameplay randomness and preserve relevant RNG state in continuation evidence.
- [general] Declare save compatibility per project. Pre-release games may break historical formats when authorized; retain current write/read/recovery correctness. Do not require old-version migration fixtures solely because another donor retained them.

## Share family behavior; theme the pixels

- [documented] Sprites 0.96.1 exports confirmation, menu, form, list, reading, notice and HUD families; exact constructors and native binding are in the [shared UI API](shared-ui-api.md). Family defines behavior and content structure; modal/bottom-sheet/drawer placement is independent. Theme data supplies bitmap fonts, edges, icons, palette roles and focus/selection artwork. Game models supply content, values, actions and enabled state.
- [general] Preserve cancellation, focus and action semantics across themes. Accessible/native input controls project the same semantic model as visible bitmap UI. Avoid a separate DOM decision model or theme data that changes controller behavior.
- [documented] Released Sprites 0.88.0 introduced portable normalized font metrics, measurement, placement, tiled-skin and resolution helpers in `ui-runtime.mjs`. Current shared UI adoption needs the complete versioned software closure described in the [shared UI API](shared-ui-api.md), not an isolated historical helper copy. Pure calculations do not establish native adoption. Fitting/ellipsis remains an authored consumer policy.
- [general] Before adopting one metrics owner, define glyph advances versus painted bounds, wrapping, fallback and overflow. Match existing newline/tab/empty, trailing-advance, line-height/spacing and terminal-space policies explicitly rather than adding another local metrics copy. Missing legacy ink/cell metadata stays unknown. Keep current native adapters until migration is proven. Track copied helper software/version separately from historical art manifests; a pure helper update does not regenerate or relabel font PNGs.
- [general] Preserve whole physical pixels per authored source pixel and verify the actual framebuffer. Keep source, component-local and physical spaces distinct. At local-to-physical scale 3 with source-pixel footprint 2, a source-to-local ratio of 2/3 is valid. Density/context selection belongs to the game, independent of theme, actions and family behavior.

## Bind resolution contexts through native owners

- [general] Use the pinned producer's resolution descriptor: namespaced identity/revision, uniform axis-aligned local-to-physical scale/origin and integer physical source-pixel footprint. The shared host's input `Context` and resolved `PixelResolution` shapes differ; use the [actual API](shared-ui-api.md). Advance its revision whenever that mapping or source-pixel footprint changes, including pane scroll, viewport, zoom, origin and density transitions; `Display.revision` alone is insufficient. Plans carry local/physical geometry and context identity; native adapters reject plans with an old context identity or revision. Unsupported rotation, shear and nonuniform transforms need an explicit separate design, not approximation by this seam.
- [general] Continuous forward/inverse projection preserves fractional and negative origins. Apply explicit physical-grid quantization to paint only. Keep paint, hit, focus and clip bounds distinct; a smaller painted control retains its full semantic target. Themes do not select density or actions. Do not snap pointer/focus geometry or let painted bounds replace hit targets.
- [general] Games own cameras/density, CSS/DPR and safe-area conversion once, pointer routing through the proper context, and disposal on unmount/partial failure. Cancel held input before publishing any changed mapping/source-pixel footprint with its context revision, including scroll and density transitions. Coherent resize publication uses the same barrier. Reuse compatible native pane/camera owners rather than a camera or texture per widget. Agent-engine adds guidance, not a universal UI package or native widget runtime.
- [documented] A low-density informational card with `actions: []`, whose native hit checks use the main UI camera, is an informational donor seam, not proof of interactive controls at another density. Recheck current donor source before adoption.
- [general] The producer native fixture covers mixed-density informational regions and interactive controls; consumer adoption retains one actual interactive control with a small painted face/full target on native WebGL and Canvas. Verify pointer and keyboard activation, visible focus, input/pixel clipping, cancellation, scroll/density/resize transitions with stale-context rejection and repeated disposal through existing consumer owners. Preserve pinned Phaser 4.2.1 Canvas `roundPixels=false` controls. Pure helper checks prove neither native adoption nor performance improvement.

## Give unusual screens a local extension

- [documented] Released `registerExtension` admits namespaced IDs per host. Pure measurement reports minimum/preferred geometry and overflow; native mounts receive bounded allocation and a resource-owning narrow facade. See [shared UI API](shared-ui-api.md).
- [general] A custom body made from common parts inherits the shell's header, action bar, scrolling, clipping and focus. A custom native visual mounts within an allocated region, declares hit targets/semantics and disposes objects/listeners/timers on unmount and partial failure. Both use ordinary game actions.
- [general] The shared boundary owns allocated bounds, focus entry/restoration, hit routing, cancellation and lifecycle. The game owns the ship diagram or other one-off's actions and meaningful states. Bypassing the host's input/focus/renderer assumptions widens consumer validation; it should not silently fork the core.
- [general] Use stable chrome/content/overlay parents. Preserve default press cancellation unless the game meets `retainUnchangedPresses` original-binding/equality obligations; see [shared UI API](shared-ui-api.md).
- [general] Verify two themes and representative extensions centrally in the producer; adopt independently through each consumer contract. Geometry changes require affected families/viewports; palette or edge-art changes with unchanged metrics need theme validation and a representative rendered sample. Preserve local novelty rather than extracting every screen at once.

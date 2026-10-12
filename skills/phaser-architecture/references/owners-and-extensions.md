# Contract owners, themed families and local extensions

## Keep ownership explicit

- [documented] Agent-engine is a skills library over native engine capabilities. Architecture coordination here does not add runtime code. Existing asset exports and game-local donor implementations are distinct from proposed shared contracts.

| Concern | Contract owner | Consumer responsibility |
| --- | --- | --- |
| Portable pixel/font/skin geometry and exported asset identity | Agent-sprites | Native caches, display objects, clipping, input bindings and final downstream transforms |
| Reusable audio generation/playback capabilities and locked exports | Agent-beeps | Cue decisions, loading, gesture/mute/resume, specialized effects and delivery seams |
| Reusable test/playbot configuration, observations and cost evidence | Agent-tests | Game adapters, policies, domain facts and production-action bindings |
| Architectural coordination and adoption guidance | Agent-engine | Apply the contract through the existing native engine |
| Rules, actions, saves/session state and authored content | Each game | Keep one authoritative implementation and observable commands/results |

- [general] The owner map assigns future reusable work; it does not assert that agent-tests ships a common playbot runner or sprites ships a shared dialog runtime. Verify installed exports before using them. Do not create game-name switches in a shared core or put a widget engine in agent-engine.
- [documented] Useful donor seams include Space's pure UI layout and bespoke-body composition, Fallow's sim/content/game split and playbot adapters, and Cyber's native hardware admission and owned origins. Recheck donor source before extracting; Space and Cyber session wrappers do not automatically have Fallow's independently instantiated sim semantics.

## Define the session boundary before sharing

- [general] Commands enter an authoritative session/rules owner; observable state/events leave it. Views, UI and bots dispatch actions rather than mutate rules state. Storage, clock, gameplay RNG, bot RNG, input, audio and lifecycle belong to named owners rather than rendering callbacks or shared globals.
- [general] Preserve each game's authoritative state during incremental migration. A headless sim pattern is a target boundary, not permission to label a facade around global state pure or independently instantiable. Separate bot randomness from gameplay randomness and preserve relevant RNG state in continuation evidence.
- [general] Declare save compatibility per project. Pre-release games may break historical formats when authorized; retain current write/read/recovery correctness. Do not require old-version migration fixtures solely because another donor retained them.

## Share family behavior; theme the pixels

- [general] Proposed families are confirmation, conversation/reading, inventory/list, settings/form and notice/toast. Family defines behavior and content structure; modal/bottom-sheet/drawer placement is independent. Theme data supplies bitmap fonts, edges, icons, palette roles and focus/selection artwork. Game models supply content, values, actions and enabled state.
- [general] Preserve cancellation, focus and action semantics across themes. Accessible/native input controls project the same semantic model as visible bitmap UI. Avoid a separate DOM decision model or theme data that changes controller behavior.
- [documented] Sprites already has bitmap-font, fallback, opaque-bound and pixel-fitting capabilities. A portable measurement/fitting/skin contract and shared family runtime remain proposals until actual exports and consumers prove them. Existing Canvas-oriented measurement is not automatically a renderer-neutral API.
- [general] Before adopting one metrics owner, define glyph advances versus painted bounds, wrapping, fallback and overflow. Match existing assets/policies explicitly rather than adding a fourth local metrics copy. Prefer the pinned sprites helper once the required portable API is available; keep current native adapters until migration is proven.
- [general] Preserve whole device pixels per source pixel and verify the actual framebuffer. Logical units, camera scale and portrait scale can differ while meeting that footprint; do not flatten every portrait to the font scale or equate fractional logical scale with blur.

## Give unusual screens a local extension

- [general] A proposed application-owned registry uses namespaced extension IDs, per-application registration and a bounded host. An extension receives model, theme, bounds, metrics and action dispatch; deterministic measurement reports overflow. These are responsibilities, not shipped method names.
- [general] A custom body made from common parts inherits the shell's header, action bar, scrolling, clipping and focus. A custom native visual mounts within an allocated region, declares hit targets/semantics and disposes objects/listeners/timers on unmount and partial failure. Both use ordinary game actions.
- [general] The shared boundary owns allocated bounds, focus entry/restoration, hit routing, cancellation and lifecycle. The game owns the ship diagram or other one-off's actions and meaningful states. Bypassing the host's input/focus/renderer assumptions widens consumer validation; it should not silently fork the core.
- [general] Pilot one confirmation family with two themes and one extension in two games. Geometry changes require affected families/viewports; palette or edge-art changes with unchanged metrics need theme validation and a representative rendered sample. Preserve local novelty rather than extracting every screen at once.

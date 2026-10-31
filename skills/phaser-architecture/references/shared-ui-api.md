# Shared Phaser UI: exports and native ownership

## Availability and owners

- [documented] **Authenticated agent-sprites 0.99.0**: released source `b6ceb6f0a28b231bf416c185a69e140501a28700`. Hosts independently verify their complete pin and adoption contract.

| Boundary | Owner and availability | Consumer responsibility |
| --- | --- | --- |
| Theme/components/layout/interaction/mounts | Sprites 0.99.0; `ui-index.mjs` + declarations | Pin software; supply content/contexts/ports/actions |
| Font/skin art | Sprites; separate exports | Immutable art; historical receipts |
| Playbot evidence | Tests 0.4.1; `playbot-contract.mjs` + declaration | Directors/adapters/input/outcomes |
| Architecture/adoption | Agent-engine | Native engine/project owners |
| Rules/session/content/composition | Each game | One action owner/lifecycle |

## Complete software pin and authentication

- [documented] `server/build/ui-software.mjs` exports `publishUiSoftware({output})` and `UI_SOFTWARE_FILES`: **16 payloads + manifest = 17 files**. `ui-runtime`, `ui-action-group`, `ui-theme`, `ui-components`, `ui-layout`, `ui-interaction`, `ui-phaser-runtime`, `ui-index` each have `.mjs`/`.d.mts`. Copy all; browsers import `ui-index.mjs`, not the Node publisher.
- [documented] `ui-software-manifest.json`: format `agent-sprites/ui-software@1`, schema `1`, producer version, bytes/SHA-256, `sha256-ui-software-v1` identity. Hash input: `JSON.stringify({version: manifest.producer.version, files: manifest.files})`, producer file order. Publication verifies prior bytes, rejects modifications/collisions/links, writes manifest last.
- [general] Against a trusted release, verify source/version, inventory, byte counts/digests and aggregate identity. A manifest cannot authenticate origin. Reverify copied/packed bytes; update all files without mixed versions or vendor patches.
- [documented] Run `node scripts/sprite.js ui-runtime-export --out <isolated-pin> --json`, then `node scripts/sprite.js ui-runtime-export --out <isolated-pin> --verify --json` in the authenticated checkout. Rebuilt producer bytes must yield `ok: true`, `checked: 17`, empty `missing`/`differing`. A changed module in an owned copy must fail naming that payload; reverify the untouched original. This authenticates software, not adoption.
- [general] Software updates neither regenerate art nor relabel historical receipts. Keep identities separate. Producers verify publication; consumers verify loading/delivery.

## Actual APIs and native ports

- [documented] `defineTheme` prepares fonts/skins/roles/geometry. Constructors: `panel`, `text`, `button`, `field`, containers, `extension`. Families: `confirmationFamily`, `menuFamily`, `formFamily`, `listFamily`, `readingFamily`, `noticeFamily`, `hudFamily`. Games own values/actions/content/timing.
- [documented] `layoutUi(tree, {theme, revision, context, additionalContexts, extensions})` prepares geometry; `createUiInteraction({id, plan}, policy)` owns portable interaction. `createPhaserUi({scene, theme, ports, limits})`: `mount`/`registerExtension`/`dispose`. Mounts: `update`/`handle`/bounded `inspect`/`dispose`. Bind Phaser 4.2.1 structural types.
- [documented] Ports: `resolveAsset`, `attachContext`, optional `extensionFacade`/`readSourceRGBA`. Textures are immutable/borrowed. Attachments declare borrowed/owned parents; owned ones provide `release`. `OwnershipScope.own`/`onDispose` track only owned resources. Readback is bounded source RGBA, not widget raster.
## Independent contexts and semantic geometry

- [documented] Snapshot: `{revision, tree, context, additionalContexts?}`. Input `Context`: `{id, revision, localToPhysical: {scale, x, y}, sourcePixelPhysicalSize, viewport}`. Resolved `PixelResolution` instead uses `localToPhysical.origin`/`physicalPixelsPerSourcePixel`. Node `contextId`/`labelContextId`/`skinContextId` select independent semantic/text/skin contexts.
- [general] Bind `attachContext`; distinguish source/local/physical spaces. Scale 3, footprint 2 permits local scale 2/3. Reject rotation/shear/nonuniform transforms; fractional/negative geometry is valid.
- [general] Keep allocation/paint/hit/focus/clip distinct. `regions.hit`/`regions.focus` are continuous allocation-relative rectangles, including negative offsets. Quantize paint only; convert client/DPR coordinates once.
- [documented] Every native `handle` event with `point` requires `pointSpace: 'physical'` (backbuffer) or `pointSpace: {contextId, revision}` (local). Omission throws despite the permissive portable type.
- [general] Revise contexts on mapping/footprint changes: scroll, viewport, zoom, origin, density. Cancel holds before coherent context/camera/target publication; reject stale plans/events.

## One action owner and press retention

- [documented] `handle` returns `activate` with `actionId`/`modelRevision`/`activationId`, or controlled `change`/`focus`/`cancel`. Focus reveals/republishes without activation. Press/release share `inputId`; one-shots need fresh IDs. Queued input can bind scope/model/context revisions.
- [general] Validate live scope/revision and original bindings; invoke once through `handle`. Rules stay outside theme/extension data; edits use the same game model owner.
- [documented] `retainUnchangedPresses` defaults false: updates cancel holds. Opt-in requires identical complete control records/dependent context revisions, unchanged theme and visible ancestry. Activation reports current model revision; stale queued input rejects.
- [general] Opt in only with the original press-time action binding retained through equality-approved updates; matching IDs/labels is insufficient. Otherwise keep default cancellation. Always cancel on mapping changes, close, blur, pointer cancellation and shutdown.

## Extensions and lifecycle

- [documented] `registerExtension('app:chart', definition)` returns unregister. Version `1`: pure `measure`, optional bounded semantic `regions`, `mount(model, allocation, scope)`. Allocate natively in `mount` through `scope.native` and its resource owner.
- [general] Namespace extensions; bound allocation/clip/regions and facade authority. Register owned objects/listeners/timers before further allocation. Never own borrowed assets/parents for destruction.
- [general] Hosts own allocation/routing/cancellation/mounts; games own theme/content/action/save rules and extensions. Wider facade authority needs consumer checks.

## Stable chrome and content parents

- [general] Give paint owners stable sibling parents: chrome, then content/overlays. Context recreation may destroy/append owned Images without preserving foreign interleaving.
- [general] Siblings order independent mounts. Within mixed compositions, the host must preserve exact authored stock/portrait/card/text order through reconciliation/context recreation. Grouping all stock behind custom objects can change it; stable parents or object depth alone do not prove final paint order.
- [documented] `update` preparation/validation failure preserves the prior mount. After publication, reconciliation failure retires/drains it; later updates reject. Replace retired mounts. Retirement rethrows the original error, aggregating cleanup failures. Sibling mounts and game-owned parents/listeners are outside its cleanup scope.
- [general] If mount two fails, clean mount one and owned parents. After native failure, cancel composed input and clean all owned sibling mounts/parents/listeners. Attempt every cleanup; retain original and cleanup errors, never destroy borrowed resources. Shutdown unregisters extensions and disposes owned UI/containers/input. Witness preparation preservation, native retirement, composed cleanup and repeated disposal.
- [general] Check initial/resized sibling order, positive content/action pixels, clipping, focus and exact-once input. Counts can pass beneath opaque chrome; hide it as a causal control. Retain the regression.

## Verification boundary

- [general] Generic producer code/fixtures contain no consumer names, paths, assets or special cases. Producer verification and packaging checks suffice to release; consumer acceptance is independent.
- [general] Producer invariants stay central; consumers verify assets, paint/input, modal/text bridge, contexts, extension/cleanup and real transaction/refusal. Retire only mapped duplicates.
- [documented] Producer `tests/engine/ui-phaser-runtime.test.js` owns preparation preservation, reconciliation retirement and cleanup errors. `scripts/test-ui-native.mjs` covers WebGL/Canvas, night/day, context revision, exact pixels, input and teardown. SwiftShader establishes neither hardware performance nor consumer mixed composition. Reuse these owners; add no duplicate probe.

- [documented] Sprites owns closure/receipts in `tests/cli/ui-software.test.js`, strict Phaser types in `tests/fixtures/ui-software-consumer.mts`. Engine checks docs, not sketch compilation/native adoption.

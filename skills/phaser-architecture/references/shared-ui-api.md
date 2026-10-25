# Shared Phaser UI: exports and native ownership

## Availability and owners

- [documented] **Available in agent-sprites 0.96.1.** Producer verification is independent; each host verifies its complete released pin and adoption contract.

| Boundary | Owner and availability | Consumer responsibility |
| --- | --- | --- |
| Theme, components/families, layout, interaction, Phaser mounts | Agent-sprites 0.96.1; `ui-index.mjs` and declarations | Pin released software; supply content, contexts, ports and actions |
| Font/skin art | Sprites; separate exports | Immutable art; historical receipts |
| Playbot evidence | Tests 0.4.1; `playbot-contract.mjs` and declaration | Directors, adapters, input and observed outcomes |
| Architecture/adoption guidance | Agent-engine | Apply native engine and project owners |
| Rules/session/content/native composition | Each game | One action owner/lifecycle |

## Complete software pin and authentication

- [documented] Producer `server/build/ui-software.mjs` exports `publishUiSoftware({output})` and `UI_SOFTWARE_FILES`: **16 payloads plus one manifest, 17 total**. `ui-runtime`, `ui-action-group`, `ui-theme`, `ui-components`, `ui-layout`, `ui-interaction`, `ui-phaser-runtime` and `ui-index` each have `.mjs` and `.d.mts`. Copy all; browsers import `ui-index.mjs`, not the Node-only publisher.
- [documented] `ui-software-manifest.json` records format `agent-sprites/ui-software@1`, schema version `1`, producer version, bytes/SHA-256 and `sha256-ui-software-v1` identity. Identity hashes `JSON.stringify({version: manifest.producer.version, files: manifest.files})` in producer file order. Publication verifies previous bytes, rejects modified files/collisions/links and writes the manifest last.
- [general] Acquire from a trusted producer source/release. Verify source/version, exact inventory, final byte counts/digests and aggregate identity against it. A manifest cannot authenticate its origin. Reverify delivered bytes after copying/packing. Update all files; never mix versions or patch vendor code.
- [general] Software updates neither regenerate art nor relabel its historical receipts. Preserve separate identities. Producers test publication; consumers test loading/delivered bytes.

## Actual APIs and native ports

- [documented] `defineTheme` prepares fonts/skins/roles/geometry. Constructors include `panel`, `text`, `button`, `field`, containers and `extension`; families are `confirmationFamily`, `menuFamily`, `formFamily`, `listFamily`, `readingFamily`, `noticeFamily`, `hudFamily`. Games own values/actions/content/timing.
- [documented] `layoutUi(tree, {theme, revision, context, additionalContexts, extensions})` prepares geometry. `createUiInteraction({id, plan}, policy)` owns renderer-independent interaction. `createPhaserUi({scene, theme, ports, limits})` provides `mount`, `registerExtension` and `dispose`; mounts provide `update`, `handle`, bounded `inspect` and `dispose`. Bind the installed Phaser 4.2.1 structural types.
- [documented] Ports supply `resolveAsset`, `attachContext`, optional `extensionFacade`/`readSourceRGBA`. Assets are immutable borrowed textures. Attachments declare borrowed/owned parents; owned ones provide `release`. `OwnershipScope.own`/`onDispose` track owned resources only. Readback is bounded source RGBA, not a widget raster.
## Independent contexts and semantic geometry

- [documented] Snapshots contain `{revision, tree, context, additionalContexts?}`. Input `Context` is `{id, revision, localToPhysical: {scale, x, y}, sourcePixelPhysicalSize, viewport}`. Resolved `PixelResolution` uses `localToPhysical.origin` and `physicalPixelsPerSourcePixel`; these shapes differ. Node `contextId`, `labelContextId` and `skinContextId` select independent semantic/text/skin contexts.
- [general] Bind mappings through `attachContext`. Keep source/local/physical spaces distinct: scale 3 and source footprint 2 permit local scale 2/3. Reject rotation/shear/nonuniform transforms. Fractional/negative geometry is valid.
- [general] Keep allocation/paint/hit/focus/clip distinct. `regions.hit`/`regions.focus` are continuous allocation-relative rectangles, including negative offsets. Quantize paint only; convert client/DPR coordinates once.
- [documented] Native `handle` requires explicit `pointSpace` on every event containing `point`: use `pointSpace: 'physical'` for backbuffer points, or `pointSpace: {contextId, revision}` for local points. Omission throws, even though the portable event type permits it.
- [general] Revise contexts on mapping/footprint changes: scroll, viewport, zoom, origin, density. Cancel holds before coherent context/camera/target publication; reject stale plans/events.

## One action owner and press retention

- [documented] `handle` returns `activate` intents with `actionId`, `modelRevision`, `activationId`, or controlled `change`, `focus` and `cancel`. Focus requests reveal/republish without activation. Press/release share `inputId`; one-shot inputs need fresh identities. Queued input can bind scope/model/context revisions.
- [general] Validate intents against live scope/revision and original game bindings, then invoke once. Avoid callbacks bypassing `handle`. Rules stay outside theme/extension data; edits use the same game model owner.
- [documented] `retainUnchangedPresses` defaults false: model updates cancel holds. Opt-in preservation requires an identical complete control record and dependent context revisions, unchanged theme and visible ancestry. Activation reports the current model revision; stale queued input still rejects.
- [general] Opt in only when the game captures the original action binding at press time and retains it through equality-approved unrelated updates. Matching IDs/labels is insufficient. Otherwise keep default cancellation. Always cancel on changed mapping, close, blur, pointer cancellation and shutdown.

## Extensions and lifecycle

- [documented] `registerExtension('app:chart', definition)` returns unregister. Version `1` definitions supply pure `measure`, optional bounded semantic `regions` and `mount(model, allocation, scope)`. Native allocation belongs in `mount` through `scope.native` and its resource owner.
- [general] Use namespaced extensions, allocation/clip/region limits and a narrow facade, such as chart operations. Immediately register owned objects/listeners/timers before later allocation can fail. Never register borrowed assets/parents for destruction.
- [general] Hosts own allocation/routing/cancellation/mounts; games own content/actions. Widening facade authority needs consumer checks. Attempt all cleanup; retain failures.

## Stable chrome and content parents

- [general] Give each paint owner a stable parent: chrome, then content/overlays. Context recreation may destroy/append owned Images there without preserving interleaved foreign children.
- [documented] `update` prepares/validates before publication; failure here preserves the previous mount. After publication, native reconciliation failure retires/drains that mount; further updates reject. Replace a retired mount. Retirement rethrows the original failure, aggregating any cleanup failure. Sibling mounts and game-owned parents/listeners remain outside its cleanup scope.
- [general] If mount two fails, clean mount one and owned parents. After later native failure, cancel the composed view's input and clean every owned sibling mount/parent/listener. Preserve the original error alongside cleanup errors; attempt all cleanup, never destroy borrowed resources. Shutdown also unregisters extensions and disposes owned UI/containers/input. Consumer witnesses must cover preparation preservation, native retirement, composed cleanup and repeated disposal.
- [general] Check initial/resized sibling order, positive content/action pixels, clipping, focus and exact-once input. Counts can remain correct beneath opaque chrome; hiding it is a causal control. Retain the consumer regression.

## Verification boundary

- [general] Reusable behavior is independently producer-owned: generic implementation and native fixtures contain no consumer names, paths, assets or special cases. Producer verification and established packaging checks suffice to release; consumer acceptance is independent.
- [general] Host obligations are immutable borrowed assets, accurate source/local/physical mappings, context revision changes whenever those mappings change, one normalized input/action authority, and cleanup according to ownership. Theme/content/action/save rules and custom extension implementations remain consumer-owned.
- [general] Producer invariants stay central; consumers verify assets, paint/input, modal/text bridge, contexts, extension/cleanup and real transaction/refusal. Retire only mapped duplicates.

- [documented] Sprites owns closure/receipts in `tests/cli/ui-software.test.js`, strict Phaser types in `tests/fixtures/ui-software-consumer.mts`. Engine checks docs, not sketch compilation/native adoption.

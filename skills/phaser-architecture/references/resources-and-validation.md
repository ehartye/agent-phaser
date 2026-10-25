# Owned resources, change-based validation and publication

## Reuse infrastructure; isolate scenarios

- [documented] Playwright Test already reuses worker browsers while giving tests fresh contexts. A new context/page is not another Chromium launch. Node's default file/process isolation prevents an imported singleton from being a cross-file browser owner.
- [general] Reuse an immutable source-identified build per invocation and a compatible server/browser per file or worker. Independent scenarios get fresh context/session/storage, viewport/init setup and error logs. Preserve real backend assertions; launch flags request an adapter but do not prove one.
- [general] Compatibility includes engine/channel, launch flags, GPU lane, source/build root and instrumentation. A poisoned browser, GPU leak or context-loss owner may require a fresh process. Start with a bounded file/worker pilot; do not disable process isolation or add a cross-process broker merely to share module globals.
- [general] Own ephemeral or strict endpoints and verify source identity. Require the attached child's successful-listen evidence before admitting HTTP health; a matching foreign service can win a port-selection race. Never borrow an unverified developer server.
- [general] Attach child-close tracking immediately. Teardown waits for actual process close, not just a shutdown acknowledgement. Mark command owners closing, refuse late launches and abort/drain pending commands before closing the server. Clean partial startup and attempt all owned cleanup even if an earlier close fails; preserve both failures.
- [general] Profile bootstrap, page setup (context/navigation/game boot), case work, evidence and cleanup with honest boundaries. Compare matching assertions and cache/source/workload conditions. Faster later cases or fewer starts do not establish an overall speedup when cold boot or long journeys dominate.

## Select checks from changed inputs

- [general] Reusable UI libraries own generic components, layout, themes, interaction,
rendering, extensions and resource lifetime. Verify those independently through
producer CPU/type/export checks and a standalone native fixture with small authored
assets, supported backends and representative context/input/cleanup boundaries.
Producer fixtures and implementation must have no consumer names or dependencies.
Each consumer chooses and verifies its own immutable released pin. Broad game
campaigns and unrelated world/rendering failures do not gate a library release.

- [general] A bounded consumer contract should cover actual theme/assets and representative
text/shell/control pixels; pointer, keyboard and controller routing exactly once;
modal cancellation/focus restoration and the native text bridge; resize, scrolling
and context changes; one clipped extension; remount/failure cleanup; and one real
action/transaction with its refusal path. Retire duplicate generic assertions only
after identifying their producer replacements. Preserve game adapter, action,
transaction, extension and gameplay protections. Reuse one compatible browser/server
with fresh scenario contexts, one worker and zero retries. Measure startup, case and
cleanup separately; target under two minutes without relaxing assertions.

- [general] After passing selected checks, review/push/handoff and unchanged metadata do not
justify another run. Widen only for changed dependencies, an observed failure or a
named unresolved risk. Build the final production artifact once, verify applicable
packaging/offline/audio obligations, then verify live assets and ordinary UI input.

| Change | Relevant owners and escalation |
| --- | --- |
| Rules/session/saves | Authoritative rules/transaction/recovery checks; native seam if platform wiring changes |
| UI/font/insets/scale/portraits | Geometry and affected family/viewports plus real render/input/semantic seam |
| Palette/edge artwork with stable geometry | Asset/theme validation and representative rendered sample |
| Generator/recipe/postprocessor | Producer invariants, final-byte identity after all transforms, consumer frame/loading seam |
| Browser/resource/runner ownership | Isolation, partial failure, honest child exits, exhaustive inventory reconciliation |
| Dependencies/Phaser patches | Clean install/patch checks and affected native lifecycle owners |
| Build/entry/catalog/base path/offline | One attributable build and owning built-payload checks |
| Shared library release | Independent producer CPU/type/export/native contract and established packaging checks |
| Consumer UI adoption | Complete released export, typecheck and bounded host contract; widen for named integration risk |
| Unknown gameplay impact | Deliberate owning inventory and appropriate hardware/earned-route acceptance |

- [general] Discover actual imports/helpers/subprocesses before admitting CPU parallelism. Unknown resource use stays conservative. Bound browser/GPU files and machine load; retain failures, signals, cancellations and applicable skips. A null child status, signal or spawn error is not success.
- [general] Run selected owners and the changed consumer seam once. Stop after passing checks with unchanged relevant inputs; review, push or handoff alone is not a new risk. Changed inputs, observed failures, unknown impact or a named remaining risk justify additional checks. Keep repo-local commands and inventories authoritative rather than publishing an unvalidated universal fast subset.
- [general] Test a producer property once in its owning tool, then test each consuming boundary meaningfully. Sprites exports require complete inputs/toolchain and exact final output identity; verify after downstream packing. Beeps' existing lock/check/fetch workflow can be adopted without rendering every unchanged recipe in every game. Keep game cue/loading/gesture/mute/resume/delivery seams and inventory specialized audio effects before migrating playback.
- [general] For shared UI, verify the complete software closure and producer identity once, then each game's owned loading, geometry, native paint/input, extension and disposal seams. Keep software receipts separate from historical art receipts; the [shared UI API](shared-ui-api.md) defines the payload inventory. Do not repeat producer invariants inside every consumer or infer visibility from object counts alone.

## Separate observation, acceptance and publication

- [general] A path-scoped PR observer selects required owner checks; it does not certify a deployment or replace deep acceptance. State complete lane membership, deliberate skips and remaining release gates. Do not omit tests merely to meet a time target.
- [general] Declare required publication gates before splitting workflows. Build and publish one exact final-main artifact; attribute served payload hashes/revision to that artifact. Broader/scheduled matrices can have their own cadence and bounded concurrency when policy allows it. Publication success, deep acceptance and live-payload verification remain separate states.
- [general] Reuse same-attempt evidence only when its relevant inputs/artifact match. Candidate, merged source, build and live site identities differ; preserve attributable receipts and invalidation rules. Moving CI jobs does not silently authorize dropping a gate or reusing an unrelated PR payload.
- [general] Record the relevant input identity for each result: producer bytes/version, consumer rules/content/adapters, policy/seed, build, viewport/context and native backend as applicable. Invalidate every result whose inputs changed; shared or unknown impact requires wider coverage. A narrow test-only or guidance correction with unchanged runtime/content inputs does not itself require replaying a long earned route. A changed route assertion still needs its owning witness, and a changed target/policy may invalidate the route's completion claim. State reused evidence and its limits explicitly.
- [general] Before an expensive route, record beat/simulation/wall budgets and the stop target. At completion retain actual totals, observed target, termination, child exit and cleanup status. Report partial, failed, cancelled and still-running jobs separately from passed acceptance. Do not launch another identical heavy route for review/handoff while one attributable owner is already running.
- [general] A guidance-only skill/reference patch needs its structural, metadata and link checks; it does not require a game build, browser suite or game deployment. Executable tool/runtime, build or runner changes require their owning functional checks and affected consumer seams. Record design/roadmap/adoption state in the canonical project wiki, while keeping installed skill references portable.

# Owned resources, change-based validation and publication

## Reuse infrastructure; isolate scenarios

- [documented] Playwright Test already reuses worker browsers while giving tests fresh contexts. A new context/page is not another Chromium launch. Node's default file/process isolation prevents an imported singleton from being a cross-file browser owner.
- [general] Reuse an immutable source-identified build per invocation and a compatible server/browser per file or worker. Independent scenarios get fresh context/session/storage, viewport/init setup and error logs. Preserve real backend assertions; launch flags request an adapter but do not prove one.
- [general] Compatibility includes engine/channel, launch flags, GPU lane, source/build root and instrumentation. A poisoned browser, GPU leak or context-loss owner may require a fresh process. Start with a bounded file/worker pilot; do not disable process isolation or add a cross-process broker merely to share module globals.
- [general] Own ephemeral or strict endpoints and verify source identity. Require the attached child's successful-listen evidence before admitting HTTP health; a matching foreign service can win a port-selection race. Never borrow an unverified developer server.
- [general] Attach child-close tracking immediately. Teardown waits for actual process close, not just a shutdown acknowledgement. Mark command owners closing, refuse late launches and abort/drain pending commands before closing the server. Clean partial startup and attempt all owned cleanup even if an earlier close fails; preserve both failures.
- [general] Profile bootstrap, page setup (context/navigation/game boot), case work, evidence and cleanup with honest boundaries. Compare matching assertions and cache/source/workload conditions. Faster later cases or fewer starts do not establish an overall speedup when cold boot or long journeys dominate.

## Select checks from changed inputs

| Change | Relevant owners and escalation |
| --- | --- |
| Rules/session/saves | Authoritative rules/transaction/recovery checks; native seam if platform wiring changes |
| UI/font/insets/scale/portraits | Geometry and affected family/viewports plus real render/input/semantic seam |
| Palette/edge artwork with stable geometry | Asset/theme validation and representative rendered sample |
| Generator/recipe/postprocessor | Producer invariants, final-byte identity after all transforms, consumer frame/loading seam |
| Browser/resource/runner ownership | Isolation, partial failure, honest child exits, exhaustive inventory reconciliation |
| Dependencies/Phaser patches | Clean install/patch checks and affected native lifecycle owners |
| Build/entry/catalog/base path/offline | One attributable build and owning built-payload checks |
| Shared/unknown impact or release | Deliberate complete inventory and appropriate hardware/earned-route acceptance |

- [general] Discover actual imports/helpers/subprocesses before admitting CPU parallelism. Unknown resource use stays conservative. Bound browser/GPU files and machine load; retain failures, signals, cancellations and applicable skips. A null child status, signal or spawn error is not success.
- [general] Run selected owners and the changed consumer seam once. Stop after passing checks with unchanged relevant inputs; review, push or handoff alone is not a new risk. Changed inputs, observed failures, unknown impact or a named remaining risk justify additional checks. Keep repo-local commands and inventories authoritative rather than publishing an unvalidated universal fast subset.
- [general] Test a producer property once in its owning tool, then test each consuming boundary meaningfully. Sprites exports require complete inputs/toolchain and exact final output identity; verify after downstream packing. Beeps' existing lock/check/fetch workflow can be adopted without rendering every unchanged recipe in every game. Keep game cue/loading/gesture/mute/resume/delivery seams and inventory specialized audio effects before migrating playback.

## Separate observation, acceptance and publication

- [general] A path-scoped PR observer selects required owner checks; it does not certify a deployment or replace deep acceptance. State complete lane membership, deliberate skips and remaining release gates. Do not omit tests merely to meet a time target.
- [general] Declare required publication gates before splitting workflows. Build and publish one exact final-main artifact; attribute served payload hashes/revision to that artifact. Broader/scheduled matrices can have their own cadence and bounded concurrency when policy allows it. Publication success, deep acceptance and live-payload verification remain separate states.
- [general] Reuse same-attempt evidence only when its relevant inputs/artifact match. Candidate, merged source, build and live site identities differ; preserve attributable receipts and invalidation rules. Moving CI jobs does not silently authorize dropping a gate or reusing an unrelated PR payload.
- [general] A guidance-only skill/reference patch needs its structural, metadata and link checks; it does not require a game build, browser suite or game deployment. Executable tool/runtime, build or runner changes require their owning functional checks and affected consumer seams. Record design/roadmap/adoption state in the canonical project wiki, while keeping installed skill references portable.

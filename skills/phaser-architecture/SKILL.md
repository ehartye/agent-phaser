---
name: phaser-architecture
description: Coordinate architecture across Phaser games and owned tools. Use when shared dialogs, playbots, asset contracts or repeated testing/publication costs cross subsystem or game boundaries. Not for choosing an engine, ordinary Phaser implementation or cloud architecture.
---

# Phaser architecture coordination

Keep architecture guidance encapsulated in agent-engine. The games own their rules,
content and native bindings; the asset and testing tools own their reusable capabilities.
This skill supplies coordination guidance. Runtime exports belong to their producer;
the linked API reference distinguishes released contracts from unreleased candidates.

Read only the reference needed for the decision.

| You are about to | Read |
| --- | --- |
| Choose contract owners, align sessions, share themed dialogs or add a bespoke panel | [Owners and extensions](references/owners-and-extensions.md) |
| Bind the shared Sprites UI exports, native ports, contexts or mount lifecycle | [Shared UI API and native ownership](references/shared-ui-api.md) |
| Align playbot configuration, transports, starting states or acceptance evidence | [Playbot evidence](references/playbot-evidence.md) |
| Reduce browser/build duplication, select checks or separate publication from deep acceptance | [Resources and validation](references/resources-and-validation.md) |
| Set or verify a frame budget across games, or cost a content increase against it | [Profiling method](../phaser-verification/references/profiling-method.md) |

## Establish the actual boundary

- [documented] The donor patterns are a model-driven UI, a headless sim with a playbot, and a native backend with ephemeral-harness controls. They are examples to inspect at a current source identity, not proof that every consumer shares a pure sim or the same APIs.
- [general] Read the project's current architecture, owner inventory and adoption decisions first; use wiki-master for this owner's canonical wiki when available. Keep project design, roadmap and measured results there. These portable references describe responsibilities without duplicating private rollout records.
- [general] Separate existing, proposed and proven consumer adoption. A shared module is existing only when its pinned export and applicable checks are present. A donor implementation does not establish a shared interface.

## Make one bounded adoption decision

1. [general] Map each concern to one contract owner and its consumers. Name the authoritative rules/session seam, storage/clock/RNG/input/audio owners and the changed boundary; inspect global-state assumptions before promising independent sim instances.
2. [general] Verify the reusable producer contract independently, then let each consumer select and verify its own released pin. Preserve native bindings and game extensions. State what remains local, which API details still need design and which source/version consumers will pin.
3. [general] Choose checks from changed inputs: producer invariants once, meaningful consumer render/input/loading seams, and explicit wider coverage for unknown/shared impact. Preserve actual transport, starting-state origin, fallback and backend evidence.
4. [general] Keep immutable build/resource identity separate from mutable scenarios and publication identity. Retain failure/cleanup controls and required publication gates when moving a job; a fast observer is not deep acceptance.
5. [general] Return the ownership map, proposed pilot, existing-versus-planned status, checks/stop condition and remaining acceptance limits. When presenting alternatives, explain time, risk, complexity, best practice and maintainability for each. Reuse passing checks with unchanged relevant inputs rather than repeating them for a handoff.

## Scope and routing

- [documented] Native implementation stays with [engine-phaser](../engine-phaser/SKILL.md); engine choice stays with [engine-selection](../engine-selection/SKILL.md). This capability adds no widget engine, replacement game engine, cloud service or cross-game mutable registry.
- [general] Extract a separate game-architecture plugin only when references, recurring cross-tool coordination or release cadence outgrow this folder. Shared runtime availability follows the actual producer export/version and consumer acceptance; this guidance does not add runtime code to Engine.

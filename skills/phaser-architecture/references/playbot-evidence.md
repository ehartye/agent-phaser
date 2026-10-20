# Playbot contracts and honest evidence

## Consolidate configuration and results first

- [documented] Existing consumers supply useful adapter, policy, telemetry and lab patterns; each has its own director and game-specific semantics. The proposed reusable contract belongs in agent-tests with native adapter guidance in engine. No common runner or API is introduced by this skill.
- [general] A proposed run configuration identifies game/adapter, scenario, game seed, independent bot seed, policy, simulated-time/beat and wall-time budgets, stop predicates and observation cadence. Keep detailed telemetry bounded or streamed; full state/screenshots every beat can dominate cost.
- [general] Results bind source/build/assets, effective configuration, transport, starting-state origin, progress, intent changes, action attempts/results, refusals, deaths/stalls, termination and evidence paths. Use actual production actions and observed outcomes rather than a bot-side copy of the rules as the oracle.
- [general] Game adapters supply observations, proposals/actions, stepping/waiting and domain routines. Shared fields must not require hunger, farming, a day cycle or one universal intent list. Preserve optional capabilities and decide director/hysteresis semantics before consolidating implementations.

## Preserve transport and fallback scope

- [general] Label headless rules execution, native-browser execution and strict ordinary-input execution separately. A headless economy run does not exercise visible controls; a browser can still bypass them through direct commands.
- [general] In strict input acceptance, reject direct-command/routing/tap fallbacks. In exploratory runs, record every fallback and the action attempted before it. Panels-hidden or command-driven runs cannot certify visible UI accessibility. Preserve the useful fallback instead of relabeling its evidence strict.
- [general] Evaluate rendered/input states with meaningful assertions. A capture path proves a screenshot was created; it needs a pixel/geometry/semantic oracle or explicit human review to establish appearance. Software rendering can establish functional behavior; hardware/performance claims require the observed adapter and real frame timing.

## Preserve starting-state origin

| Origin | What it establishes | What remains open |
| --- | --- | --- |
| Fixture start | Behavior from a declared staged state | Whether earlier progress was earned |
| Earned prefix | The observed route reached the starting state | Unobserved branches and other policies/seeds |
| Saved continuation | Restore/continuation from a source-identified save | An earned journey unless the save carries that provenance |

- [general] Bind reused checkpoints to relevant source, content, policy, game RNG and bot/policy state. Report origin independently from transport: an ordinary-input late-game fixture still does not prove earlier chapters were earned.
- [general] Use short representative scenarios for edits/merge; run full journeys and seed/policy sweeps at their deliberate scheduled/release cadence. Retain one appropriate end-to-end earned route instead of replaying a prefix for every independent assertion.
- [general] Pilot configuration/results in two games before extracting a director. Declare changes to policy semantics explicitly and retain refusals, failures and termination evidence. Report selected coverage and omissions instead of claiming a generic bot established complete gameplay acceptance.

# Playbot contracts and honest evidence

## Consolidate configuration and results first

- [documented] Agent-tests 0.7.0 ships browser-safe `playbot-contract.mjs`, `playbot-contract.d.mts` and `PLAYBOT_VERSION.json` through its checked pin export. Contract version 1 uses exactly `agent-tests/playbot-config@1` and `agent-tests/playbot-result@1`. `validateConfig`, `createRunRecorder` and `summarizeRun` provide configuration validation and observed evidence recording. Games retain directors, rules, input execution, clocks, watchdogs and cleanup; this skill supplies native adapter guidance.
- [documented] Contract version 1 records game/adapter, scenario, game seed, independent bot seed, effective policy, simulated-time/beat and wall-time budgets, stop predicate and observation cadence. Recorder `attempt` precedes delivery and `confirm` follows an observed result. Budgets are cooperative; the game still owns enforcement. Detailed event tails are bounded while action/refusal/fallback counters remain complete.
- [general] Results bind source/build/assets, effective configuration, transport, starting-state origin, progress, intent changes, action attempts/results, refusals, deaths/stalls, termination and evidence paths. Use actual production actions and observed outcomes rather than a bot-side copy of the rules as the oracle.
- [general] Game adapters supply observations, proposals/actions, stepping/waiting and domain routines. Shared fields must not require hunger, farming, a day cycle or one universal intent list. Preserve optional capabilities and decide director/hysteresis semantics before consolidating implementations.

## Authenticate the producer before binding an adapter

- [documented] From the authenticated agent-tests 0.7.0 plugin root, export to a new isolated directory, then verify through the actual managed launcher:

```sh
node scripts/run-managed.js playbot-export --out <isolated-pin>
node scripts/run-managed.js playbot-export --out <isolated-pin> --verify --require-current
```

- [documented] Both commands must exit 0 with verification `valid: true`, `current: true` and `pin.contractVersion: 1`. Retain the producer version/fingerprint and three file hashes. Verification checks module/declaration digests against the producer; `--require-current` also requires matching version/fingerprint. It never repairs a pin. Missing runtime leaves this unverified; follow the producer's setup instructions.
- [general] Keep the verified directory unchanged. In a separate owned copy, change a module byte and repeat verification: require a nonzero exit with `Playbot module digest mismatch`, retain the failure output, and recheck the clean hashes. Preserve exact exported bytes through Git checkout. Pin verification establishes software identity; the game still needs its own adapter and gameplay acceptance.
- [general] When using donor source, retain the repository, immutable revision, file hashes and import/call locations privately. Reopen the exact bytes before attributing a responsibility. A test double, historical integration or unavailable revision cannot establish current adoption, two-game director suitability or measured savings; leave missing or mismatched source unverified.

## Bind the game-owned observation and action seam

| Boundary | Producer responsibility | Game responsibility |
| --- | --- | --- |
| Admission | Validate configuration and declared adapter capabilities | Resolve actual scenario, policy, seeds, transport and simulation units before acquiring listeners or changing state |
| Observation | Record bounded events, complete counters and supplied positions | Read authoritative state/events; supply monotonic beat, simulation and wall positions without inventing unit conversions |
| Delivery and outcome | Allocate attempt IDs and correlate confirmations | Record the attempt before the production action/input; correlate the actual completion or refusal to that ID |
| Budgets and termination | Report cooperative budget hits and construct final evidence | Own stepping, waits, hard watchdogs, stop predicates, publication and cleanup on success and failure |
| Decisions | Record effective policy and intent changes | Own directors, scoring, hysteresis, routines, domain rules and separate bot RNG |

- [general] Keep one authoritative action owner. A synchronous command adapter can confirm its actual returned outcome; an asynchronous native adapter needs the game's completion event, receipt or explicit observed predicate. A proposal, queued request, input delivery or provisional acknowledgement alone is not a successful action. Preserve identity through delivery so an unrelated equal-looking completion cannot consume a pending attempt.
- [documented] `attempt` returns an ID; `confirm` records `accepted` or `refused` for that ID. Pending attempts remain in `summary.actions.unconfirmed` and prevent a passing finalized result. Failed checks also prevent passing. A bounded event tail may omit earlier details; retain useful unresolved native identities or artifact references without treating an evicted event as confirmation.
- [general] Retain partial evidence and the original failure. Restore any owned dispatch wrapper, clock hook or receipt subscription in `finally`, release held input, and bound publication/cleanup through the existing game owner. The producer does not deliver actions, advance Phaser, enforce a hard deadline or dispose game resources.

## Preserve transport and fallback scope

- [documented] Transport separates `host` (`headless` or `browser`), `actions` (`commands`, `native-driver` or `ordinary-input`) and `clock` (`native` or `controlled`). Ordinary input requires a browser, `fallback: 'forbid'` and adapter fallback accounting. A forbidden alternate route records failure and throws from `attempt`; call it before delivery so the alternate command never executes.
- [general] Label headless rules execution, native-browser execution and strict ordinary-input execution separately. A headless economy run does not exercise visible controls; a browser can still bypass them through direct commands. Native driver calls or DOM `.click()` alone do not establish ordinary keyboard/pointer input. Verify the actual route through the game's input owner; see [native control observation](../../phaser-verification/references/native-control-observation.md).
- [general] In strict input acceptance, reject direct-command/routing/tap fallbacks. In exploratory runs, record every fallback and the action attempted before it. Panels-hidden or command-driven runs cannot certify visible UI accessibility. Preserve the useful fallback instead of relabeling its evidence strict.
- [general] Evaluate rendered/input states with meaningful assertions. A capture path proves a screenshot was created; it needs a pixel/geometry/semantic oracle or explicit human review to establish appearance. Software rendering can establish functional behavior; hardware/performance claims require the observed adapter and real frame timing.

## Preserve starting-state origin

| Origin | What it establishes | What remains open |
| --- | --- | --- |
| Fresh start | Behavior from a declared new run | Progress beyond the observed route |
| Fixture start | Behavior from a declared staged state | Whether earlier progress was earned |
| Earned prefix | The observed route reached the starting state | Unobserved branches and other policies/seeds |
| Saved continuation | Restore/continuation from a source-identified save | An earned journey unless the save carries that provenance |

- [documented] Version 1 origin kinds are `fresh`, `fixture`, `earned-prefix` and `saved`; `origin.bot` is `new`. Saved game continuation does not mean serialized bot restoration.
- [general] Bind reused checkpoints to relevant source, content, policy, game RNG and bot/policy state. Report origin independently from transport: an ordinary-input late-game fixture still does not prove earlier chapters were earned.
- [general] Use short representative scenarios for edits/merge; run full journeys and seed/policy sweeps at their deliberate scheduled/release cadence. Retain one appropriate end-to-end earned route instead of replaying a prefix for every independent assertion.
- [general] Record configured route budgets, actual beat/simulation/wall totals, target reached, pending/unconfirmed actions and the final termination reason. A live process, budget reservation or partial checkpoint is not completed acceptance. Report an unfinished earned route as pending even when shorter witnesses pass; exact serialized bot continuation is unsupported by contract version 1.
- [general] Pilot configuration/results in two games before extracting a director. Declare changes to policy semantics explicitly and retain refusals, failures and termination evidence. Report selected coverage and omissions instead of claiming a generic bot established complete gameplay acceptance.

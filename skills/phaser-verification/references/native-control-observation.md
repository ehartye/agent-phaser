# Observe native controls through renderer-owned facts

## Boundary and ownership

- [tested] The [observer example](../../../examples/web/harness/control-observation.mjs) returns whitelisted plain descriptors, not Phaser objects. `node --test tests/phaser-native-control-observation.test.mjs` checks serialization, stale revisions, registration/lifecycle invalidation and unsupported receivers. This is an example convention, not an extracted runtime for games.

The renderer factory registers each actual receiver with `createControlObserver({owner})`. `register(id, {role, label, receiver, receiverId, read})` returns an unregister function. Its private `read` callback reads current native bounds, allocation, clip, readiness, enabled/publication state, supported mapping, occlusion knowledge and source-pixel footprint. Native references and action callbacks never cross the browser boundary. `observe(id, {owner, revision})` optionally checks previously observed opaque tokens; callers must not parse their spelling. `revise()` invalidates cached observations; `dispose()` retires the owner.

The descriptor contains `id`, `owner`, `revision`, `eligible` and `reason`; a registered current control also reports role, label, receiver kind/identity, readiness, enabled state, CSS viewport `bounds`, `clip`, declared `allocation` and `sourcePixelPhysicalSize`. Rectangle values remain continuous. Source-grid density is separate from hit coordinates. Facts come from registration-owned objects, camera/scale state and DOM `getBoundingClientRect`, rather than a second layout model in the test.

## Native input and revision protocol

- [tested] The [fixture](../../../examples/web/harness/control-observation-fixture.mjs) and [probe](../../../examples/web/phaser-probes/phaser-native-control-observation.mjs) exercise fixed chrome, a scrolling row, HUD disclosure, a DOM field, a native-local pager and a source-grid image across wide/stacked layouts at DPR 1/1.5. Actual Playwright mouse input reaches Phaser pointer handlers; actual keyboard input changes the DOM field. Original handlers run once. Scrolling preserves chrome bounds; resize changes the image's bounds/revision while preserving independent density.

Observe the control, require eligibility, then reobserve with its owner/revision immediately before dispatch. Use the CSS bounds for browser input, and compare the resulting original-handler event's actual receiver identity and revision to the observation. Semantic projection remains useful for labels and assertions; it cannot substitute for a failed native press. No direct-dispatch fallback exists in this fixture.

Revise mappings/publication coherently when layout, scroll, density or eligibility changes. Cancel retained holds before publishing a revised mapping. The fixture proves a held press is cancelled on revision without activation, and disposal cancels input, retires observations, removes the canvas and tolerates repeat disposal. Keep scene/native objects inside their renderer owner and expose only bounded plain event facts to Node.

## Refusals and unsupported observations

- [tested] The probe records ineligible results for `absent`, `unpublished`, `stale-owner`, `stale-revision`, `disabled`, `clipped`, `occluded` and `unsupported`; the Node boundary also covers `not-ready`. An unknown receiver or unknown occlusion result is unsupported and never eligible. These checks do not invoke original handlers or semantic fallbacks.

Supported receiver kinds in this example are `phaser-pointer`, `dom-field` and `phaser-local-pager`. Pager behavior remains local to its original handler; this is not a universal pager API. The fixture supports its declared axis-aligned camera/CSS mappings and fully contained rectangles. A partially clipped control is refused rather than choosing an unverified subregion.

Occlusion checks are limited to the controlled fixture's DOM cover at the dispatch center. They are not a generic oracle for overlapping Phaser objects, arbitrary DOM overlays, masks, rotation/shear, multiple cameras or transformed consumers. The renderer must report unsupported/unknown mappings as ineligible. A descriptor is not proof that authored paint reached the screen; use [causal pixel observation](causal-pixel-observation.md) to distinguish source authenticity, eligible geometry and final-screen contribution. [Pixel assertions](visual-and-pixel-assertions.md) retain the separate strict raw-colour obligation.

## Run and retain evidence

- [tested] Run `node examples/web/phaser-probes/phaser-native-control-observation.mjs <host>` with a host supplying Phaser 4.2.1 and Playwright. The probe declares `CanvasRenderer`, records browser/source SHA-256 identities, observations, actual handler receivers, revisions and viewport/clip facts, and retains reports, screenshots and traces. It runs in the runner's software lane; this establishes no GPU/backend acceptance.

```sh
node examples/web/phaser-probes/phaser-native-control-observation.mjs /path/to/host --output /path/to/evidence
node examples/web/phaser-probes/phaser-native-control-observation.mjs /path/to/host --output /path/to/receiver-failure --mutation receiver
node examples/web/phaser-probes/phaser-native-control-observation.mjs /path/to/host --output /path/to/revision-failure --mutation revision
```

The normal run exits 0. Each mutation must exit 1: receiver replacement reaches a different native handler, while revision mutation invalidates the cached observation before dispatch. Inspect `report.json`, `failure.png` and `failure.trace.zip` in each failure directory. Failed assertion facts are written before cleanup, then the browser/context and dynamic-port server are closed. If `--output` is omitted, an owned temporary evidence directory is created and its path is included in the report. Use a fresh directory per run; keep the report and matching trace together.

Two fixture layouts are not two independent consumer adoptions and establish no cost reduction. Adoption, runtime extraction, physical-controller coverage and authored-paint certification require separate evidence. Native browser checks stay outside `node scripts/check.mjs`; the merge lane runs the public-boundary tests, existing probe inventory and strict reference/routing checks.

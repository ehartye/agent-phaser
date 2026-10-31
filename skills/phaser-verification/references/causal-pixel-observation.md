# Prove final-screen paint through controlled comparisons

## Three independent obligations

- [general] Authentic decoded art, eligible geometry and actual paint contribution answer different questions. A loaded image can be authentic while another object covers it; matching pixels can come entirely from an underlay. A native input descriptor establishes neither source authenticity nor final paint. Keep all three witnesses.

The bounded [hardware probe](../../../examples/web/phaser-probes/phaser-verification-causal-pixels.mjs) exercises Phaser 4.2.1 using a committed [fixture and metadata](../../../examples/web/phaser-probes/fixtures/causal-pixels/fixture.json). It is a recipe for a controlled fixture, not an exported renderer runtime or full-game certificate. Native input remains a separate [observation contract](native-control-observation.md).

## Supported held state and captures

- [tested] The probe supports its 80 by 64 final canvas at DPR 1, one unrotated full-canvas camera at unit zoom, and an untinted opaque image at `(24,20)` with origin zero and integer scale 2. The 8 by 8 fixture has binary alpha. Its mapped opacity mask counts opaque source texels only, including holes, rather than the image's bounding rectangle.
- [tested] Two cases are exercised: unfiltered UI and one camera-internal ColorMatrix with `grayscale(1)`. The matrix stays enabled and unchanged throughout shown, hidden and restored captures. The effect case deliberately differs from raw source colours; no colour tolerance or effect-neutralised capture establishes its contribution.

After the initial completed frame, the fixture sleeps the loop and drives `game.step(1000, 0)` once per capture. It contains no tweens, animations, physics or other changing simulation. Each step must emit one `POST_RENDER`. Playwright then captures the entire viewport as lossless PNG while the loop remains asleep. The declared viewport is exactly the canvas: this qualifies the fixture's compositor output, not arbitrary DOM overlays, CSS transforms or nested render targets.

Record and compare owner, source/frame, camera, scene, canvas and effect state for all three frames. Visibility is the deliberate intervention and is recorded separately. Do not infer stability merely from equal timestamps: [deterministic driving](deterministic-test-driving.md) explains which clocks a manual step does not control.

## Source, dispatch and contribution witnesses

- [tested] The probe decodes the actual loaded `HTMLImageElement` after revoking its blob URL and compares every RGBA byte against independently committed fixture metadata, with SHA-256 identities for the PNG and RGBA. Revocation does not discard decoded pixels. A failed fetch of the old URL alone says nothing about their authenticity.
- [tested] Native dispatch is witnessed at the invoked `_renderSteps` entry, preserving the original call. Shown and restored frames must dispatch the same owner and camera once; the hidden frame must dispatch it zero times. Bypassing that native entry fails its witness. Wrapping a method that native dispatch no longer invokes cannot prove a render occurred.

Require all of the following together:

1. [general] Authenticated loaded RGBA and an explicitly supported mapping.
2. [general] Held owner/camera/effect state, completed frames and expected native dispatch.
3. [general] A nonempty shown-versus-hidden change set within the exact mapped source-opacity mask, with zero changed pixels outside it.
4. [general] Exact RGBA equality between the shown and restored frames.

For the unfiltered case, also require exact equality to raw source colours at every mapped opaque pixel. Preserve [strict pixel assertions](visual-and-pixel-assertions.md) and `source-pixels.mjs`; causal contribution under the declared ColorMatrix does not replace them. The effect case instead requires that its effect is observable while contribution remains confined and restoration remains exact.

## Adverse controls and unsupported boundaries

- [tested] The default run rejects five controls through their corresponding witnesses: a missing owner over a matching underlay (`nonempty-contribution`), camera drift (`held-state`), altered decoded source (`source-authentication`), bypassed native dispatch (`native-render-dispatch`) and displaced restoration (`exact-restoration`). Some controls also fail other witnesses; a nonzero exit alone is insufficient evidence.
- [tested] Actual active Blur, a CustomContext parent with unresolved final mapping, camera rotation and an undeclared ColorMatrix are reported as unsupported. They are never counted as positive paint cases. Other spatial effects, fractional/nonuniform transforms, multiple cameras, arbitrary compositors and consumer scenes need separate qualification; this fixture provides none.

Do not disable effects, raise the owner's depth or regenerate art to force a result. A tolerance-based or effect-neutralised diagnostic changes the question and cannot establish ordinary final paint. Nonempty contribution also does not establish that every authored pixel is visible, visual quality or accessibility.

## Run, inspect and retain evidence

- [tested] The entrypoint takes the usual host argument, requires Phaser 4.2.1 and `@playwright/test`, and defaults to full Chromium with the platform hardware flags. It prints the actual renderer and a unique temporary evidence directory in its JSON report. Software rendering fails the hardware requirement and remains unverified. The runner skips this probe without `--hardware`; a skip is never a pass.

```sh
node examples/web/phaser-probes/phaser-verification-causal-pixels.mjs /path/to/host
node examples/web/phaser-probes/run-all.mjs /path/to/host --hardware --only phaser-verification-causal-pixels
node examples/web/phaser-probes/phaser-verification-causal-pixels.mjs /path/to/host --mutation render-dispatch
```

The normal command must exit 0. Repeat the mutation command for `matching-underlay`, `camera-drift`, `source-mismatch`, `render-dispatch` and `restoration`; each must exit 1 with its corresponding witness in `runs[].failures`. If a mutation escapes its witnesses the standalone command succeeds, exposing the broken negative test.

Inspect `report.json` and each case's `result.json`, `loaded-source.rgba`, `opacity-mask.bin`, `opacity-mask.png` and `shown.png`, `hidden.png`, `restored.png`. Reports retain fixture/source/probe hashes, held state, dispatch facts and comparison counts. Measurements and lossless artifacts are saved before witness assertions abort. Partial failures retain whatever was captured and the failure details; they are not complete evidence.

- [tested] Case cleanup runs in `finally`, restores owned visibility, source, position, camera and native dispatch, and compares state exactly with the case baseline. Unsupported controls also compare before/after state. Final cleanup restores the original dispatch entry, releases the decode canvas, destroys the game and closes the browser context/browser. Inspect cleanup results on success and on every mutation failure. Keep retained evidence; cleanup releases resources rather than deleting failure artifacts.

Browser/GPU execution stays outside `node scripts/check.mjs`. The dependency-free merge gate checks the existing runner inventory, lane routing and documentation structure; it cannot establish native paint acceptance.

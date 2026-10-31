# Capture a bounded Phaser scene with agent-vids

## Contract and evidence

- [documented] This recipe targets Phaser 4.2.1 and the agent-vids 0.5.0 producer contract. Its `src/doctor.ts`, `src/storyboard/schema.ts`, `src/capture/capture.ts`, `src/capture/clock.ts`, `src/capture/determinism.ts` and `library/channels/youtube-pixel.json` define the capability, action, clock, sound and geometry contracts. The probes hash installed producer sources and retain the actual managed-runtime fingerprint and doctor report. A matching version alone is insufficient.
- [general] Use the standalone [fixture](../../../examples/web/capture-ready/fixture.mjs) and [storyboard template](../../../examples/web/capture-ready/storyboard.json) as a bounded example. Its capture model owns both named buttons' original handlers. Do not move a game's action implementation into a capture adapter. The [semantic bridge](../../phaser-pixel-ui/references/pixel-ui-input-and-controls.md) owns accessibility evidence; [native control observation](native-control-observation.md) and [causal pixel observation](causal-pixel-observation.md) prove different things.

| Requirement | Producer source | Fixture provision and retained witness |
| --- | --- | --- |
| Installed capabilities | `doctor.ts` | Require environment `ok` and all eight IDs below; retain doctor JSON, setup identity and command outputs |
| Ready state and title gate | `storyboard/schema.ts`, `capture/capture.ts` | `waitUntil` checks `captureFixture.snapshot().ready`; capture-local `app.localStorage` sets `capture-skip-title`; native initial and producer receipts show gate state |
| Unique semantic actions | `discover/crawl.ts`, `capture/capture.ts` | Discover Start capture and Play capture cue; `activate` reaches their original handlers once, with trusted events |
| One clock owner | `capture/clock.ts` | External stepped capture drives the live Phaser loop; supported setup never calls `manual(true)` or `frames()` |
| Repeatable state and frames | `capture/determinism.ts` | Seed 7, integer tick-based motion, ten seconds of action waits, two retained real captures and exact captured-file hashes |
| Declared pixel geometry | `channels/youtube-pixel.json` | 384x216 CSS viewport, DPR 5, one source pixel occupying 25 native screenshot pixels, encoded 1920x1080 output |
| Whole-file one-shot audio | `capture/capture.ts` | Receipt, downloaded WAV hash and decoded 440-Hz cue in the output recording window; missing asset is an adverse witness |
| No attract/idle-demo interference | Fixture policy | Motion begins only at Start capture; no asynchronous art loading, idle demo or independent animation clock |

## Clock experiment

- [tested] The [clock probe](../../../examples/web/phaser-probes/phaser-capture-clock-experiment.mjs) executes real `verify-determinism` captures for three cases. In the initial observed run each case produced 160 identical frames in each of two captures. Over the same approximately 2250 ms observer interval, the external live loop advanced 135 ticks; adding `manual(true)` advanced zero; the separate explicit `frames(60)` experiment advanced 60. Its report records exact observer times, before/after state, captured-frame hashes, source identities and the `validated` verdict.
- [general] Keep a single clock owner for supported capture. The hand-driven case demonstrates why sleeping the loop needs a separate driver; it is not a supported dual-owner adapter. A future run records `invalidated` if all cases are observed without the hypothesized distinction, `partial` if only some are observed, and `unverified` if prerequisites or all cases fail. Any failed command remains a failure regardless of the verdict.

## Run the actual producer

- [general] Prepare a separate host containing `phaser@4.2.1` and Playwright, and install agent-vids through its documented managed setup. Pass the plugin's `scripts/run-managed.js` launcher as `--vids`. These probes create a dynamic localhost server and run real producer commands; they neither install dependencies nor start in the merge lane. Give each invocation a new evidence directory, or omit `--output` for an automatically unique temporary directory.

```sh
node examples/web/phaser-probes/phaser-capture-clock-experiment.mjs /path/to/host --vids /path/to/agent-vids/scripts/run-managed.js --output /path/to/clock-evidence
node examples/web/phaser-probes/phaser-capture-ready.mjs /path/to/host --vids /path/to/agent-vids/scripts/run-managed.js --output /path/to/capture-evidence
node examples/web/phaser-probes/phaser-capture-ready.mjs /path/to/host --vids /path/to/agent-vids/scripts/run-managed.js --output /path/to/frame-failure --mutation frames
node examples/web/phaser-probes/phaser-capture-ready.mjs /path/to/host --vids /path/to/agent-vids/scripts/run-managed.js --output /path/to/audio-failure --mutation audio
```

The doctor must report `stepped-capture`, `capture-seed`, `activate-action`, `wait-until-action`, `viewport-override`, `game-discover`, `verify-determinism` and `channel-youtube-pixel`. The supported driver runs `discover`, `validate`, `lint`, `verify-determinism --runs 2 --tolerate 0 --seed 7 --keep`, and `render --draft`. Command arguments, stdout/stderr and exit statuses stay in the JSON report. The declared ten-second action interval is distinct from producer setup, pre-roll and planned padding; assert positive equal actual frame counts instead of assuming exactly 600.

- [tested] The [capture probe](../../../examples/web/phaser-probes/phaser-capture-ready.mjs) observed 640 matching captured frames per run, unique discovered controls, original trusted handlers and a 5x5 native footprint for its one source pixel. Its 1920x1080 draft contained the downloaded 440-Hz cue from 1.00 to 1.20 seconds. Alternating fixture paint changed all 640 compared frames and made the producer exit 1. A missing cue still allowed a draft render, but yielded no matching download or decoded cue; its standalone mutation failed the audio witness. These are bounded fixture observations, not a guarantee for other content.

## Audio and limits

- [documented] The producer reads `window.__vidsAudio` entries with `t`, `url`, optional `gain`, `pan`, `rate`. `t` is page `performance.now()` in milliseconds. The collector maps that time into the recording timeline and downloads the URL. It can skip a failed HTTP response without failing rendering. URL presence or render exit zero alone cannot prove captured audio.
- [general] This example supports one whole-file, 200-ms cue. It does not adapt loop, offset, marker, stop-event or arbitrary mixer semantics. Inspect the receipt, matching downloaded WAV bytes and independently decoded output together. The frame adverse control alternates actual fixture paint between producer captures; the missing-audio control keeps its receipt while returning 404 for the asset. Mutation invocations must fail their respective witness after retaining evidence.
- [general] Keep reports, native screenshot, discovery profile, producer frames, rendered video, downloaded audio, decoded PCM and hash manifests on failures. The fixture and producer pages are owned temporary resources; the driver closes its browser and server in `finally`. This is desktop Chromium Canvas capture evidence, not GPU performance, visual-quality scoring, full-game certification or accessibility compliance. [Strict pixel assertions](visual-and-pixel-assertions.md) remain a separate obligation.

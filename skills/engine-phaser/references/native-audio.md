# Recorded audio through Phaser

For exported WAVs and other browser-supported recordings, start with Phaser's Loader, audio cache and game-wide SoundManager. Agent-beeps authoring does not require the beeps browser player at runtime. Keep Phaser audio enabled; `audio.noAudio: true` selects its silent NoAudioSoundManager.

This reference owns the Phaser integration choice. Sound recipes, synthesis, rendering, loudness normalization, export metadata and the beeps player's specialized behavior belong to agent-beeps. Consume its released exports or APIs; do not copy that implementation into agent-engine or a game-side substitute.

## One playback owner

Read the pinned package's `skills/audio-and-sound/SKILL.md`, `src/sound/SoundManagerCreator.js`, `src/sound/BaseSoundManager.js` and the chosen backend. Phaser's SoundManager belongs to the Game, so playing sounds survive an ordinary scene change. A room's shutdown must not destroy shared music. Keep retained loop references with the existing game-wide audio owner; a persistent scene can host native loading and tweens when room scenes restart.

The native operations are small:

```ts
// Queue through a scene's native Loader, at the project's chosen loading boundary.
scene.load.audio('garden-music', 'audio/garden-music.wav');
scene.load.audio('harvest', 'audio/harvest.wav');

// After loader completion, cache verification and the project's audio activation:
const music = scene.sound.add('garden-music', {loop: true, volume: 0.6});
music.play();
scene.sound.play('harvest', {volume: 0.8});
```

The filenames and gains above are illustrative; use the project's existing catalog and mix. Phaser owns fetching, decoding, sound instances, loop scheduling and context teardown. Do not add a parallel fetch/decode service, AudioContext, loop timer or playback manager for these recordings.

Keep game policy separate: the area-to-track table, automatic/forced/off selection, preview precedence, bus levels and cue eligibility. Reconcile only when the desired state changes. An unchanged track must retain its sound instance and playback position; calling `play()` again restarts it. Cancel or supersede obsolete pending selections so a late decode cannot start the previous area's music.

Use native sound volume and native tweens for ordinary fades. Compose each sound's volume as category level × existing authored gain × fade envelope, and reapply that product when a level or envelope changes so sliders and fades do not overwrite each other. Phaser has global and per-sound volume; three named categories alone do not justify a second gain-node graph. Preserve the existing mix, transition timing, preview restoration and sound-toggle behavior rather than adding hysteresis, ducking or bar synchronization to a migration.

## Loading, activation and recovery

- Preserve the project's download policy. If it loads audio after a gesture, queue only its needed recordings through the native Loader then. For an initial runtime batch or retry outside `preload`, register completion/error listeners before calling `scene.load.start()` after queueing; queueing alone does not start the load. A suspended, game-owned Phaser context before activation is distinct from downloaded audio bytes.
- Use Phaser's native unlock mechanism and `locked`/`UNLOCKED` state. Verify keyboard, pointer, semantic and controller activation paths on the target devices before adding a bridge. Reproduce an actual native failure before proposing a scoped repair; do not assume every browser interruption is handled by a network retry.
- Loader `COMPLETE` is not proof that every recording decoded. Check requested keys in the audio cache, report failure through the existing status UI, and retry missing keys on the authorized retry action. Keep successful cached audio and discard failed initialization state. Reconcile the latest request after asynchronous loading.
- Check the pinned backend's blur/focus behavior and the game's hidden/visible events separately. Preserve intentional preview/menu holds; a blanket resume can restart sounds meant to remain paused. Pair every owned listener with teardown.
- Select supported formats from the delivered assets. Codec conversion, loop repair and export validation belong to beeps. WebAudio and HTML5Audio have different loop/overlap behavior; source inspection is not mobile or audible certification.

## Phaser 4.2.1 decode rejection correction

Phaser 4.2.1's native `AudioFile.onProcess` supplies success and error callbacks to `decodeAudioData` but ignores its returned Promise. The [Web Audio specification](https://www.w3.org/TR/webaudio-1.1/#dom-baseaudiocontext-decodeaudiodata) requires an undecodable recording to reject that Promise with `EncodingError` and invoke the error callback. An HTTP 200 invalid recording therefore reaches Phaser's ordinary `FILE_ERRORED` processing path and Loader `COMPLETE`, then produces an uncaught rejection. Loader `totalFailed` counts HTTP failures; it remains zero in this case. The missing audio-cache key is still the readiness/retry signal.

Use the released [install-time correction](../scripts/assets/phaser-audio-decode-patch.mjs) as a temporary dependency band-aid. Copy that exact artifact into the consuming project's scripts directory and call it from the existing postinstall after Phaser is installed:

```sh
node scripts/phaser-audio-decode-patch.mjs node_modules/phaser
```

An existing Node postinstall can instead import `patchAudioDecode` from that copied module and `await patchAudioDecode(installedPhaserDirectory)`. Importing alone has no side effect. The installer requires package name `phaser` and exactly version `4.2.1`; it preflights the known, unique original or corrected AudioFile fragment in `src/loader/filetypes/AudioFile.js`, `dist/phaser.esm.js` and `dist/phaser.js` before any write. Unknown, ambiguous or mixed-newline target fragments fail installation. Repeated installation is idempotent; LF or CRLF and all bytes outside the target fragment are preserved. This permits composition with an existing held-input correction elsewhere in a bundle. Keep any consuming project's independent integrity guards consistent with both released corrections.

The correction immediately attaches a no-op rejection handler to the returned native decode Promise. Both native callback bodies remain unchanged and own success/failure processing exactly once. Callback-only implementations returning `undefined` remain supported. Native decode errors remain visible in the console and failed recordings remain outside the cache; the correction does not retry, suppress global errors, change playback, or modify `WebAudioSoundManager.decodeAudio`.

Remove this band-aid when a reviewed upstream Phaser release handles the AudioFile decode Promise, then verify failure and valid retry on the new pinned version. The current installer deliberately refuses that version rather than guessing whether a changed function needs patching. The guarded source is the [pinned 4.2.1 AudioFile](https://github.com/phaserjs/phaser/blob/v4.2.1/src/loader/filetypes/AudioFile.js), not a replacement decoder.

Maintenance verification is focused: `node --test tests/phaser-audio-decode.test.mjs` exercises the extracted pinned function, paired Promise/callback outcomes, callback-only returns, all three targets, refusal without partial writes, newline/byte preservation and idempotence. For the [native Chromium probe](../../../examples/web/phaser-probes/audio-decode.mjs), obtain a pristine `npm pack phaser@4.2.1` package and a separate patched copy containing its package manifest and all three target files, then run from this repository:

```sh
node examples/web/phaser-probes/audio-decode.mjs <project-with-playwright> <pristine-phaser-directory> <patched-phaser-directory> <new-evidence-directory>
```

The host project supplies only `@playwright/test`; its Phaser installation and game are untouched. The probe runs sequentially with no retries in one Chromium page/context, serves actual ESM bundles and HTTP 200 invalid/valid recording fixtures, and records native processing, Loader completion, missing-cache failure and cached retry. It compares the pristine uncaught rejection with the corrected result, retaining native console errors, actual canvas renderer, raw events, trace, source/fixture hashes and owned-process cleanup. This is desktop Chromium native-loader evidence, not audible playback, mobile/HTML5Audio, codec coverage or a physical-device pass. Callback-only compatibility is a unit fixture check.

## Phaser 4.2.1 delayed visibility lifetime correction

The pinned [WebAudioSoundManager](https://github.com/phaserjs/phaser/blob/v4.2.1/src/sound/webaudio/WebAudioSoundManager.js) captures its context in `onGameVisible`, then unconditionally suspends and resumes it after 100 ms. Native destruction can close that owned context; [BaseSoundManager.destroy](https://github.com/phaserjs/phaser/blob/v4.2.1/src/sound/BaseSoundManager.js) clears `game`. `setAudioContext` can also replace the captured context. The pending callback can therefore touch a closed, stale or destroyed manager's context.

Copy the released [install-time correction](../scripts/assets/phaser-audio-visibility-patch.mjs) into the consuming project's scripts directory and call it from the existing postinstall:

```sh
node scripts/phaser-audio-visibility-patch.mjs node_modules/phaser
```

A Node postinstall can instead import `patchAudioVisibility` and `await patchAudioVisibility(installedPhaserDirectory)`; import alone does nothing. This temporary dependency band-aid requires exactly `phaser@4.2.1`. Before writing, it preflights a unique complete original or corrected fragment in `src/sound/webaudio/WebAudioSoundManager.js`, `dist/phaser.esm.js` and `dist/phaser.js`. Unknown, missing, ambiguous, partially corrected, mixed-state or inconsistent target-newline files fail installation without partial writes. LF and CRLF are supported, all outside bytes are retained, and repeated installation is idempotent.

The callback admits only a manager with `game` still present and its captured context still current and not closed. It preserves the native 100 ms delay and exact `suspend(); resume();` sequence for live recovery. It adds no rejection suppression, runtime audio adapter, unlock policy, manager state or second playback owner. Genuine live-context failures remain observable. Compose this helper with the independent decode, gamepad lifecycle, framebuffer restoration and project held-input corrections; retain each consuming project's integrity guards and update their expected identities after composition. Remove the band-aid only when a reviewed upstream fix provides equivalent lifetime checks, then reverify live recovery and teardown on that new pinned release.

`node --test tests/phaser-audio-visibility.test.mjs` executes the extracted pinned method with a controlled native timeout queue, including stale lifetimes, running/suspended live contexts, repeated callbacks and refusal/byte-preservation cases. Set `PHASER_VISIBILITY_PRISTINE` to an isolated pristine npm-pack directory to additionally check real-package composition in both orders. For actual native browser evidence, use a pristine `npm pack phaser@4.2.1` and a separate copy corrected through the helper:

```sh
node examples/web/phaser-probes/audio-visibility.mjs <project-with-playwright> <pristine-phaser-directory> <patched-phaser-directory> <new-evidence-directory>
```

The host supplies only Playwright. The standalone probe serves the real ESM bodies, boots outside Playwright evaluation, unlocks with a trusted keyboard gesture, then emits native `VISIBLE`. Sequential live, immediate-destroy, replacement and externally supplied context cases retain method stacks/timing, all page errors, rejections and console events, actual renderer/HTTP body hashes, trace and owned cleanup. Exact callback source lines distinguish the visibility pair from independent native `onFocus` recovery. This is desktop Chromium lifecycle evidence; it does not certify iPhone recovery, audible playback or performance.

## When the beeps player is the right owner

Live synthesis or existing beeps-specific adaptive layers, variant selection, priority handling or processing may require its player or a released integration API. First check the concrete requirement against native Phaser behavior. Preserve required beeps behavior instead of copying it into an engine helper. If a reusable beeps adapter/export capability is missing, fix and release it in agent-beeps; agent-engine documents how the engine consumes it.

Choose the playback owner explicitly. If the beeps player owns all audio, disable Phaser audio to avoid an unused second context and follow the conditional [beeps integration reference](audio-directors.md). Shared-context injection by itself does not resolve duplicate playback or lifecycle ownership. Do not disable Phaser merely because a recording was authored with beeps.

## Verification

Test selection policy headlessly, then exercise native loading and playback: first activation; simultaneous music/ambience; unchanged handles and advancing seek across ten room restarts; previews and separate levels; interrupted/stale loads; HTTP and decode failure followed by retry; hidden without blur; visible with an intentional hold; bounded sounds/listeners and final teardown. Inspect the actual manager/backend and context count. Listen to loop boundaries and mix on the target devices, or report them as unverified.

- [tested] Check first activation in Chromium launched without `--autoplay-policy=no-user-gesture-required`, with one real `page.mouse.click` or key press. Playwright's `page.evaluate` counts as user activation, so a context created or resumed from an evaluate runs before any click and a context-state gate passes vacuously (Sector Run React Three Fiber and Babylon.js apps; the beeps-player Phaser 3.90 sample in `examples/web`). Assert audio is locked and silent before the click from a flag only a trusted pointer or key event sets. Phaser 4's native `locked` state under Playwright was not measured.

Sources: [official Phaser audio concepts](https://docs.phaser.io/phaser/concepts/audio) and the [4.2.1 SoundManagerCreator](https://github.com/phaserjs/phaser/blob/v4.2.1/src/sound/SoundManagerCreator.js). The APIs above were checked against the pinned package. This guide does not claim a new engine sample-scene, listening or physical-device pass.

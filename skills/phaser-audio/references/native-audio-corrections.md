# Recorded audio through Phaser: the 4.2.1 corrections

Index: [native-audio.md](native-audio.md).

## Phaser 4.2.1 decode rejection correction

- [general] Phaser 4.2.1's native `AudioFile.onProcess` supplies success and error callbacks to `decodeAudioData` but ignores its returned Promise. The [Web Audio specification](https://www.w3.org/TR/webaudio-1.1/#dom-baseaudiocontext-decodeaudiodata) requires an undecodable recording to reject that Promise with `EncodingError` and invoke the error callback. An HTTP 200 invalid recording therefore reaches Phaser's ordinary `FILE_ERRORED` processing path and Loader `COMPLETE`, then produces an uncaught rejection. Loader `totalFailed` counts HTTP failures; it remains zero in this case. The missing audio-cache key is still the readiness/retry signal.

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

- [general] The pinned [WebAudioSoundManager](https://github.com/phaserjs/phaser/blob/v4.2.1/src/sound/webaudio/WebAudioSoundManager.js) captures its context in `onGameVisible`, then unconditionally suspends and resumes it after 100 ms. Native destruction can close that owned context; [BaseSoundManager.destroy](https://github.com/phaserjs/phaser/blob/v4.2.1/src/sound/BaseSoundManager.js) clears `game`. `setAudioContext` can also replace the captured context. The pending callback can therefore touch a closed, stale or destroyed manager's context.

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

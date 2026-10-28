# Testing Phaser audio when you cannot hear it

Read this before you claim audio "works". A headless Chromium has a running audio clock and a null output, so an agent can prove decoding, gating, events and signal level, but not how anything sounds. Backed by [`phaser-audio-manager.mjs`](../../../examples/web/phaser-probes/phaser-audio-manager.mjs) and [`phaser-audio-sounds.mjs`](../../../examples/web/phaser-probes/phaser-audio-sounds.mjs); the gesture-gate helper is `audioGateChecks` in [`examples/web/verify-checks.mjs`](../../../examples/web/verify-checks.mjs).

## What a headless run can prove

| Question | Read this in the page | Number or state to expect |
| --- | --- | --- |
| Was the file decoded, and to the right length? | `game.cache.audio.get(key).length` | `round(seconds * context.sampleRate)` |
| Is the gate real? | a trusted click, then `sound.locked`, `context.state`, your own `unlocked` flag | locked and silent before; running after |
| Does signal reach the output? | an `AnalyserNode` on `sound.masterVolumeNode` | peak above 0 while playing |
| Are gain, pan, mute and ducking right? | the same analyser, per channel through a `ChannelSplitter` | exact ratios below |
| Did the game play the cue? | `play`, `complete`, `looped` events on the sound, or a counting wrapper on `sound.play` | event counts |
| Is the loop alive? | `looped` events rising while frames run | one per loop length |
| Did anything leak? | `sound.sounds.length` before and after ten restarts | equal |

- [tested] Headless Chromium advanced `AudioContext.currentTime` and ran the analyser, so audio-clock waits work in headless runs; the repo's CI notes say Firefox needs a PulseAudio null sink (the ci-for-generated-assets reference of agent-engine:engine-asset-import).
- [tested] Decoded length is in the context's rate, not the file's: a 1 s file at 22050 Hz decoded to 48000 frames in a 48000 Hz context. Compare to `Math.round(seconds * ctx.sampleRate)` and, for a loop, to the catalogue's frame count (the audio-integration reference of agent-engine:engine-asset-import).
- [tested] A tap on the master gain read, for a half-scale sine: centre 0.354 per channel; hard left 0.707 / 0; `sound.volume = 0.25` gave 0.088; global `volume = 0.5` gave 0.177; global or per-sound `mute` gave 0. These are ratios you can assert with a 0.02 tolerance:

```js
const tap = (ctx, from) => { const a = ctx.createAnalyser(); a.fftSize = 2048; from.connect(a); return a; };
const peak = (a) => { const d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); return Math.max(...d.map(Math.abs)); };
const level = tap(game.sound.context, game.sound.masterVolumeNode);   // read peak(level) after a change settles
```

- [general] Wait for a change to reach the analyser with the audio clock (`ctx.currentTime` advanced by about 0.1 s, longer than the 2048-sample window), not a sleep. The clock stops when the context is suspended.

## Drive it without sleeps

- [general] Wait on conditions in this order: a Phaser event (`complete`, `looped`, `unlocked`, `decodedall`), a state read (`context.state`, `cache.audio.exists(key)`), then the audio clock. Never `waitForTimeout`; the harness guard in [the verification skill](../../phaser-verification/references/verifying-loop-and-waiting.md) fails the build on one.
- [tested] The tests above need frames to keep running: a loop driven with `game.loop.sleep()` falls silent after two repetitions ([loops and scene lifetime](loops-and-scene-lifetime.md)). When you step by hand, keep stepping while you wait for audio.
- [tested] `sound.volume` lags the setter; assert `sound.currentConfig.volume` or wait a frame. Compare floats with a tolerance (`0.3` reads `0.30000001192`).
- [documented] Do not boot the game with `audio.noAudio: true` to test audio: `NoAudioSoundManager` accepts missing keys, plays nothing and emits no events (`src/sound/noaudio/NoAudioSoundManager.js`).
- [tested] Playwright's `page.evaluate` grants user activation. Boot the game from a page script, make the first gesture a real `page.mouse.click`, `page.keyboard.press` or `page.touchscreen.tap`, and never create or resume audio from an evaluate before it. The flag `--autoplay-policy=no-user-gesture-required` removes the gate you are trying to test; use it only for tests about something else.
- [tested] Overriding `document.hidden` and dispatching `visibilitychange` raises the game's `pause` and `resume`; `game.events.emit('blur')` and `'focus'` reach the manager. These verify Phaser's reaction. Real focus loss under Playwright needs focus emulation turned off, which this repo has not automated.

## Failure and retry cases worth a test

- [tested] A failed `decodeAudio('bad', new ArrayBuffer(200))` logged `Error decoding audio: bad`, left the key out of the cache, emitted `decodedall`, and raised an uncaught `Unable to decode audio data` rejection. The 4.2.1 decode correction covers the loader's `AudioFile` only, not `sound.decodeAudio` ([the 4.2.1 corrections](native-audio-corrections.md)).
- [tested] The loader tells the two failures apart differently: a 404 raised `loaderror` and `totalFailed` 1; a 200 with garbage raised no `loaderror`, counted as completed and left the key out of the cache ([the sound manager page](sound-manager-in-4x.md)).
- [general] Test in this order: HTTP 404, HTTP 200 with garbage, a URL Phaser drops (no extension), retry with a valid file (key present, music retained), and a gesture before and after each. Assert on `cache.audio.exists`, never on loader `COMPLETE`.

## What cannot be verified here

- [general] Report each of these as unverified rather than passing: how a cue or mix sounds and whether levels are comfortable; clicks at a loop seam (measure the decoded file offline, or listen); Safari and iPhone decode, unlock and interruption recovery; Bluetooth latency; HTML5 Audio on phones; real window focus and tab visibility on a device; speaker or headphone loudness.
- [general] Say which of the tap, event and decode checks passed and on which Chromium and renderer, then list the above. A passing analyser proves signal reached the master gain, not that a person would hear a good sound.

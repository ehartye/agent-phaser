# The Phaser 4 sound manager: which one, unlocking, blur and limits

Read this before you wire audio into a game or debug "silent until I click" and "stops when I switch windows". Phaser's own `skills/audio-and-sound/SKILL.md` (in the installed package) lists the API; this page adds the decisions and the traps. The probe that backs the `[tested]` lines is [`phaser-audio-manager.mjs`](../../../examples/web/phaser-probes/phaser-audio-manager.mjs).

## Which manager you get

| Manager | Chosen when | Use it when | Trap |
| --- | --- | --- | --- |
| `WebAudioSoundManager` | the device has `AudioContext` and `audio.disableWebAudio` is not set | always, for a shipped game | none specific; see the sections below |
| `HTML5AudioSoundManager` | `audio.disableWebAudio: true`, or no `AudioContext` | only to test a fallback you really ship | no pan, no spatial, loops are timer driven, `instances` fixed at load |
| `NoAudioSoundManager` | `audio.noAudio: true`, or neither backend exists | a game with no sound at all | accepts keys that do not exist, `play()` returns `false`, emits nothing |

- [documented] `src/sound/SoundManagerCreator.js` picks in that order. `load.audio()` returns without queueing anything when `noAudio` is set (`src/loader/filetypes/AudioFile.js`).
- [tested] With `noAudio: true`, `sound.add('missing')` succeeds and `sound.play('missing')` returns `false`; the WebAudio manager throws `Audio key "missing" not found in cache` for both. A test run on `noAudio` therefore hides a missing or failed-decode key that crashes production.
- [documented] The 4.x changelogs list no sound API change beyond removing the `AudioContextMonkeyPatch` polyfill and fixing audio loaded from base64 data URIs (`changelog/v4/4.0/MIGRATION-GUIDE.md`, `changelog/v4/4.0/CHANGELOG-v4.0.0.md`), so Phaser 3 audio advice still applies.
- [general] Keep audio switchable with a URL flag that changes only the output you assert on, never `noAudio` in the test build.
- [general] Guard every game call that can follow a failed decode: `if (this.cache.audio.exists(key)) this.sound.play(key)`. A failed file is absent from the cache (see [the 4.2.1 corrections](native-audio-corrections.md)).

## Loading URLs and formats

- [documented] `load.audio(key, urls)` uses the first URL whose extension (`/.([a-zA-Z0-9]+)($|?)/`) maps to a true flag in `game.device.audio` (`ogg`, `opus`, `mp3`, `wav`, `m4a`, `aac`, `flac`, `webm`). `blob:` and `data:` URLs always pass, and `{url, type}` entries override the extension (`src/loader/filetypes/AudioFile.js`). The `ogg` flag is a Vorbis probe and `opus` is an Opus probe (`src/device/Audio.js`), so Ogg Opus data in a `.ogg` file is judged by the Vorbis probe: name it `.opus` or pass `type: 'opus'` if a target browser answers the two differently.
- [tested] A URL with no extension queued nothing and only warned (`No audio URLs for "noext" can play on this device`); the same URL as `[{url, type: 'wav'}]` loaded; an array whose first entry has an unknown extension fell through to the second.
- [tested] A 404 raised `loaderror` and counted in `totalFailed`. A 200 response with undecodable bytes raised no `loaderror`, was counted among the completed files, never reached the cache, and logged `Error decoding audio` plus an uncaught rejection (the 4.2.1 decode correction targets that rejection, see [the 4.2.1 corrections](native-audio-corrections.md)). Check `cache.audio.exists(key)` after `complete`; images and JSON behave the same way ([loading](../../engine-phaser/references/loading-assets.md)).

## Unlock and the first gesture

- [documented] `WebAudioSoundManager.unlock()` listens on `document.body` for `touchstart`, `touchend`, `mousedown`, `mouseup` and `keydown`, calls `context.resume()`, and removes the listeners once that promise settles (`src/sound/webaudio/WebAudioSoundManager.js`). It does not listen for `pointerdown` or `click`, so a DOM overlay that calls `stopPropagation()` on those mouse or touch events keeps the game locked.
- [tested] A real mouse click, a key press and a touch tap each took the context from `suspended` to `running`; a dispatched bare `pointerdown` did not.
- [documented] `sound.locked` and the `unlocked` event are not set at the gesture. `BaseSoundManager.update` clears `locked` and emits `UNLOCKED` on the next `PRE_STEP` (`src/sound/BaseSoundManager.js`).
- [tested] With `game.loop.sleep()` active, the context was `running` after the click while `sound.locked` stayed `true` and no `unlocked` event fired; one `game.step()` cleared it. A test that drives frames by hand must step once after the gesture.
- [tested] Playwright's `page.evaluate` counts as user activation: with the game booted from a page script and nothing clicked, the first `sound.play()` made from an evaluate took the context to `running` while `sound.locked` was still `true`. Assert the gate with a trusted click and the Phaser flags, never from `context.state` alone ([testing audio](testing-audio.md)).
- [general] Start music from the unlock, and give the player a visible reason to click:

```js
const start = () => this.sound.add('theme', {loop: true}).play();
if (this.sound.locked) this.sound.once(Phaser.Sound.Events.UNLOCKED, start); else start();
```

## Global volume, mute, rate and detune

- [documented] On WebAudio `sound.volume` and `sound.mute` write two gain nodes, `masterVolumeNode` and `masterMuteNode`; every sound connects to `manager.destination`, which is `masterMuteNode`. Rate and detune multiply per sound: `totalRate = sound.rate * manager.rate * 1.0005777895065548 ^ (sound.detune + manager.detune)` (`src/sound/BaseSound.js`).
- [tested] Reading a volume right after setting it returns the old gain: `sound.volume = 0.3` then `sound.volume` read `1` in the same task and `0.30000001192` (float32) later. Read `sound.currentConfig.volume` for the value you set, or compare with a tolerance after a frame.
- [general] Keep the player's saved levels in your own settings object and apply them with one function ([spatial and mix](spatial-and-mix.md)); the manager has one volume, one mute and no buses.

## Blur, visibility and the frame loop

- [documented] On `BLUR` the manager sets `gameLostFocus` and, when `pauseOnBlur` is true (the default) and the manager is not locked, suspends the context; `FOCUS` resumes it. On `VISIBLE` it suspends and resumes after 100 ms (`onGameVisible`, since 3.88.0). `update()` calls `onFocus()` every frame while the game has focus, which resumes a context that is `suspended` or `interrupted`.
- [tested] A manual `context.suspend()` was undone by the next frame; after a synthetic `blur` frames did not resume it; `focus` did; with `pauseOnBlur = false` a `blur` left it `running`. Overriding `document.hidden` and dispatching `visibilitychange` raised the game `pause` and `resume` events.
- [general] To hold sound silent for a menu or a modal use `mute`, `pauseAll()` or per-sound volume, not `context.suspend()`. Synthetic `blur` proves Phaser's reaction, not the browser's: a real window switch needs Playwright's focus emulation turned off, which is not covered here.
- [documented] The 4.2.1 delayed `suspend()/resume()` can touch a closed or replaced context; the install-time correction is in [the 4.2.1 corrections](native-audio-corrections.md).
- [tested] Phaser reschedules loops from `update()`, so the frame loop must keep running ([loops and scene lifetime](loops-and-scene-lifetime.md)).

## Limits and concurrency

- [documented] The WebAudio manager has no instance cap. Each sound builds four nodes: a mute gain, a volume gain, a spatial `PannerNode` and a `StereoPannerNode` (`src/sound/webaudio/WebAudioSound.js`).
- [tested] 300 simultaneous `sound.play()` calls all reported playing.
- [documented] HTML5 Audio plays through a pool of `<audio>` tags sized by `instances` at load (`load.audio(key, url, {instances: 4})`, default 1); with `override` true (default) a busy pool hijacks the sound furthest along (`src/loader/filetypes/HTML5AudioFile.js`, `src/sound/html5/HTML5AudioSoundManager.js`).
- [general] Write the cap yourself: ignore a cue played within a few tens of milliseconds of the same key, and refuse new one-shots above a voice count (`this.sound.getAllPlaying().length`).
- [general] A decoded buffer costs `frames * channels * 4` bytes and stays in `cache.audio` after its sounds are destroyed; remove it with `this.cache.audio.remove(key)` when a level is done. The budget method is in [audio integration](../../engine-asset-import/references/audio-integration.md).

## Related

[native recorded audio](native-audio.md), [sounds, markers and sprites](sounds-markers-and-sprites.md), [spatial and mix](spatial-and-mix.md), [testing audio](testing-audio.md).

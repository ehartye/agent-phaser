# Sounds, markers and audio sprites in Phaser 4

Read this before you write a sound-effects layer: which call to use for a one-shot, why a volume you set once keeps changing, and how markers and audio sprites actually behave. Backed by [`phaser-audio-sounds.mjs`](../../../examples/web/phaser-probes/phaser-audio-sounds.mjs); the manager side is in [the sound manager page](sound-manager-in-4x.md).

## Retained or fire-and-forget

| Call | Creates | Overlaps itself | Use it when | Leaks when |
| --- | --- | --- | --- | --- |
| `sound.play(key, config)` | a sound that destroys itself on `complete` | yes | a one-shot you never touch again | you `stopAll()` or `stopByKey()` it |
| `sound.add(key, config)` then `.play()` | a sound you keep | no, `play()` restarts it | music, ambience, anything you fade, stop or listen to | you add one per scene start and never reuse it |
| `sound.playAudioSprite(key, name, config)` | a self-destroying sound per call | yes | an overlapping cue from a sprite | same as `play` |
| `sound.addAudioSprite(key)` | a retained sprite sound | no | a bank you retune or stop | same as `add` |

- [documented] `BaseSoundManager.play` is `add` plus `sound.once('complete', sound.destroy)` (`src/sound/BaseSoundManager.js`). `stop()` emits `stop`, never `complete`, and a looping sound never completes.
- [tested] Five `sound.play('tone')` calls followed by `stopAll()` left five stopped sounds registered in `sound.sounds`, each with one `complete` listener, until `removeAll()`; a self-completing cue removed itself.
- [tested] A second `play()` on a retained sound restarted it (one playing); three `sound.play()` calls overlapped (three playing).
- [general] To cut one-shots, call `removeByKey(key)` or `removeAll()`, not `stop`. Give each repeated cue a short minimum gap so a held button cannot stack hundreds of voices.

## A config you pass to play() sticks

- [documented] `BaseSound.play` runs `Extend(this.currentConfig, config)`, and `currentConfig` is the sound's own `config` (or the marker's `config`), so the values are written into it (`src/sound/BaseSound.js`).
- [tested] `sound.play({volume: 0.2})`, then `stop()`, then `sound.play()` played at 0.2 and `sound.config.volume` stayed 0.2. The same held for a marker: `play('hit', {volume: 0.5})` changed `markers.hit.config.volume` for every later `play('hit')`.
- [general] Pass the full config on every call, or keep random per-play variation (`rate`, `detune`, `volume`) on `sound.play(key, config)` where each call has its own sound. Compose a mix as `authored * bus * duck`, written once per frame ([spatial and mix](spatial-and-mix.md)).
- [tested] `sound.volume` reads the gain node, so it lags a render quantum behind the setter; assert `sound.currentConfig.volume` or read a frame later.

## Picking among variants (agent-beeps exports)

- [tested] A sidecar from `beeps export --variants --manifest` lists `variants` (`file`, `weight`) and `noRepeat`, and the native sound manager runs none of that. [`scripts/assets/pick-variant.mjs`](../scripts/assets/pick-variant.mjs) is the picker, pure and with an injectable random source: `createVariantPicker(sidecar, rng).next()` returns the next `{ file, weight, index }`. It follows the beeps player's rules (weights default to 1, `noRepeat` defaults to true, one variant is always returned) and gave the same index as the player's own picker on all 18,000 draws of a comparison (six weight sets, both `noRepeat` settings, three seeds). `tests/phaser-audio-pick-variant.test.mjs` pins no immediate repeat over 5,000 picks, weights within 2 points over 20,000, zero weights and reproducible sequences.
- [general] Pass the full config on every `sound.play(key, config)` for the picked file (the config sticks, above), and pass a seeded `rng` in tests and replays. The sections-to-markers and kit-to-audio-sprite converters are not here: they wait for section times in the beeps export.

## Markers

- [documented] `addMarker({name, start, duration, config})` returns `false` for a missing or non-string name; a duplicate name logs `console.error` and returns `false`; `duration` defaults to `totalDuration - start`; `removeMarker(name)` sets the slot to `null` rather than deleting it (`src/sound/BaseSound.js`).
- [tested] Duplicate add returned `false`, a removed marker read `null` and could be added again, and `play('nope')` for an unknown marker logged a warning and returned `false`. A mistyped cue name is a silent no-op in game code: check the return value of `play` in a test.
- [documented] A marker's `config.loop` loops that region only; `sound.duration` is the marker's duration while it plays.
- [general] Marker times are seconds in the decoded buffer, so they stay valid at any `rate` while the audible length changes. Convert frame offsets from your editor with the context rate ([decoded length](testing-audio.md)).

## Audio sprites

- [documented] `load.audioSprite(key, jsonURL, audioURLs, audioConfig)` loads the audio into `cache.audio[key]` and the JSON into `cache.json[key]`. The JSON needs `spritemap: {name: {start, end, loop?}}` in seconds; `addAudioSprite` turns each entry into a marker with `duration = end - start` and `loop` defaulting to `false`. An optional `resources` array in the JSON can supply the audio URLs when none is passed (`src/loader/filetypes/AudioSpriteFile.js`, `src/sound/BaseSoundManager.js`).
- [tested] A two-entry spritemap became markers `a` (0 to 0.2 s, no loop) and `b` (0.2 to 0.5 s, loop); `a` emitted `complete` at its marker end; `b` emitted `looped` while it played.
- [general] Pack a sprite when many short cues share a request budget (one request and one decode instead of forty). Keep separate files when cues are loaded by level, because a sprite decodes whole and sits in memory whole. Leave 100 ms or more of silence between entries so a lossy codec's ringing and edge priming do not bleed into the next cue.
- [general] A sprite is one sound: `playAudioSprite` is the call for overlapping hits, `addAudioSprite` for one at a time.

## Rate, detune and seek

- [documented] `rate` changes speed and pitch together; `detune` is in cents (documented range -1200 to 1200). Both feed `totalRate`. `seek` set while stopped does nothing, and is ignored while a `delay` has not elapsed; `pause()` before a delayed start returns `false` (`src/sound/webaudio/WebAudioSound.js`).
- [tested] At `rate: 2`, 0.2 s of audio clock advanced `sound.seek` to about 0.4 s: the getter reports position in the buffer, not wall time.
- [general] For random pitch variation use the seeded generator (`Phaser.Math.RND.realInRange(0.95, 1.05)`) so a replay is reproducible; `Phaser.Math.Between` is not seeded ([deterministic driving](../../phaser-verification/references/deterministic-test-driving.md)).

## Events and cleanup

- [documented] A sound emits `play`, `pause`, `resume`, `stop`, `complete`, `looped`, `loop`, `mute`, `volume`, `rate`, `detune`, `seek`, `pan` and `destroy`; `destroy()` calls `removeAllListeners()`, nulls `manager` and `config`, and the manager drops it on its next update (`src/sound/BaseSound.js`).
- [general] Use `once` for completion handlers on retained sounds, and `off` them when the owner shuts down, or a re-entered scene stacks listeners. Never call a setter on a sound after `destroy()`: its `config` is `null` ([loops and scene lifetime](loops-and-scene-lifetime.md)).

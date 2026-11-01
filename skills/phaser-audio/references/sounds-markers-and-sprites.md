# Sounds, markers and audio sprites in Phaser 4

Evidence: [`phaser-audio-sounds.mjs`](../../../examples/web/phaser-probes/phaser-audio-sounds.mjs). For manager ownership, see [the sound manager](sound-manager-in-4x.md).

## Retained or fire-and-forget

| Call | Lifetime | Overlap | Use |
| --- | --- | --- | --- |
| `sound.play(key, config)` | destroys on complete | yes | one-shots |
| `sound.add(key, config).play()` | retained | restarts itself | music, fades, listeners |
| `sound.playAudioSprite(key, name, config)` | destroys on complete | yes | overlapping cues |
| `sound.addAudioSprite(key)` | retained | restarts itself | one cue at a time |

- [documented] `BaseSoundManager.play` is add plus `once('complete', sound.destroy)` (`src/sound/BaseSoundManager.js`). Stop emits stop, never complete; loops never complete. Retained sounds require disposal; adding music every scene start stacks voices.
- [tested] Five fire-and-forget plays then stopAll left five registered sounds with completion listeners; removeAll cleared them. Completion removed a self-completing cue. Two retained plays left one voice; three fire-and-forget plays overlapped.
- [general] Dispose stopped one-shots with `removeByKey(key)` or `removeAll()`. Reuse music; space repeated cues to cap voices.

## A config you pass to play() sticks

- [documented] `BaseSound.play` extends currentConfig, which aliases the sound/marker's config (`src/sound/BaseSound.js`); per-play values persist.
- [tested] `play({volume: 0.2}); stop(); play()` retained volume/config 0.2. A marker's volume 0.5 persisted on its next plain play. The volume getter lagged its setter by a render quantum.
- [general] Pass full config each play. Vary rate/detune/volume on fire-and-forget calls for independent voices. Mix `authored * bus * duck` once per frame ([spatial and mix](spatial-and-mix.md)). Assert currentConfig.volume or wait a frame before reading the getter.

## Picking among variants (agent-beeps exports)

- [tested] `beeps export --variants --manifest` supplies variants (file, weight) and noRepeat; Phaser does no selection. Pure [`pick-variant.mjs`](../scripts/assets/pick-variant.mjs): `createVariantPicker(sidecar, rng).next()` returns `{file, weight, index}`. Defaults: weight 1, noRepeat true; always one variant. Indices matched the producer on 18,000 draws: six weight sets, both repeat modes, three seeds.
- [tested] `tests/phaser-audio-pick-variant.test.mjs` checks 5,000 no-repeat draws, weights within two points over 20,000 draws, zero weights and reproducibility.
- [general] Seed rng for replay and pass full playback config. Packed PCM cues use the separate frame-map helper below.

## Song sections as markers (agent-beeps 0.35.0 or later)

- [tested] `beeps song export --manifest --sections`, or recipe `"sections": true`, emits `sections: [{name, start, end, startFrame, endFrame}]`. [`beeps-markers.mjs`](../scripts/assets/beeps-markers.mjs) uses frame/sampleRate positions: `for (const m of markersFromSections(sidecar, {loopSections: ['survey']})) music.addMarker(m)`, then `music.play('survey')`. `loopSections: true` loops all; repeated form sections get name-2 names. Missing sections throw with export guidance instead of returning no markers.
- [tested] `tests/phaser-audio-beeps-markers.test.mjs` uses eight contiguous sections spanning the looped file. The native probe's three level-distinct regions played their own half-second: nonloops completed at 0.50-0.51 seconds; the looped marker repeated.
- [general] This needs agent-beeps, not an agent-engine release. Before trusting MP3/Opus section times, compare whole-file sound.duration with frames/sampleRate: codec padding can change decoded length.

## Markers

- [documented] `addMarker({name, start, duration, config})` returns false for missing/non-string names or duplicates (duplicates log errors). Duration defaults to totalDuration minus start; removeMarker(name) leaves null (`src/sound/BaseSound.js`). Config.loop loops the region; playing sound.duration is its duration.
- [tested] Duplicate add returned false; removal left null and allowed re-adding. Unknown-marker play('nope') warned and returned false. Check play's return value for cue-name mistakes.
- [general] Times address the decoded buffer: rate changes audible duration, not offsets. Convert editor frames with the context rate ([decoded length](testing-audio.md)).

## Audio sprites

- [documented] `load.audioSprite(key, jsonURL, audioURLs, audioConfig)` fills cache.audio[key] and cache.json[key]. JSON contains `spritemap: {name: {start, end, loop?}}` in seconds. `addAudioSprite` creates markers with duration end minus start and loop default false. JSON resources can supply omitted URLs (`src/loader/filetypes/AudioSpriteFile.js`, `src/sound/BaseSoundManager.js`).
- [tested] Entries a (0-0.2 seconds, no loop) and b (0.2-0.5, loop) became markers; a completed at its end and b emitted loop events.
- [general] Pack cues sharing loading needs to save requests/decodes; separate level-specific files because sprites decode and occupy memory whole. General lossy packing guidance leaves at least 100 ms silence against edge ringing/priming; the PCM contract below makes no lossy guarantee. Use playAudioSprite for overlaps, addAudioSprite for a retained voice.

## Released PCM sprites (agent-beeps 0.36.0)

- [tested] Pure [`beeps-spritemap.mjs`](../scripts/assets/beeps-spritemap.mjs) exports `spritemapFromMap(map, urls)`. Released beeps/audio-sprite@1 plus an explicit nonempty array of resource URL strings becomes `{resources, spritemap}`. Entries preserve loops and authoritative startFrame/sampleRate and exclusive endFrame/sampleRate. Schema, IDs, hashes, ranges, gaps and resources are validated without mutation or Phaser/DOM/filesystem/network dependencies.
- [documented] The producer preserves canonical PCM16 WAV samples: mono/stereo, one common rate up to 192000 Hz, `ceil(sampleRate / 10)` zero frames between entries only. Limits: 1-128 entries, 16 MiB/source WAV, 64 MiB packed WAV. The helper does no packing, normalization, resampling, fetching or decoding. Metadata validation does not authenticate bytes or establish lossy timing/padding.
- [tested] `tests/fixtures/audio-sprite/` records released producer 0.36.0 source/tag `377a95eeabbac7da2609dc4aa0862bb9b1bffeae` and source/WAV/map hashes. Run `node tests/fixtures/audio-sprite/regenerate.mjs /path/to/released-agent-beeps` to authenticate it, repeat build/check/verify and compare exact bytes.
- [tested] Serve converted JSON/resources; call `scene.load.audioSprite('bank', jsonURL)`, then `scene.sound.addAudioSprite('bank').play('name')`. `node examples/web/phaser-probes/phaser-audio-sounds.mjs /path/to/host` proves original checks plus three half-second PCM entries (220/440/880 Hz, levels 0.2/0.5/0.9), nonloop completion within 0.46-0.57 audio-clock seconds, and looping in-range until stopped.
- [tested] Append `--mutation sprite-range`, `--mutation sprite-source` or `--mutation sprite-loop`; each exits nonzero. Range/loop change playback after authentication and fail native signal/repetition witnesses; source changes a WAV byte and fails authentication first. `--evidence-dir /path/to/new-directory` retains identities, decoded metadata, raw windows, events, failures and cleanup. One analysis tap is used; sounds, contexts, pages, browser and server close on success/failure.
- [general] Headless checks establish PCM timing/signal behavior, not audible quality, device latency, Safari/iOS behavior, lossy support or game adoption. Variant and section-marker helpers remain separate.

## Rate, detune and seek

- [documented] Rate changes pitch/speed; detune is cents (documented -1200 to 1200); both feed totalRate. Stopped/delayed sounds ignore seek; pause before delayed start returns false (`src/sound/webaudio/WebAudioSound.js`).
- [tested] At rate 2, 0.2 audio-clock seconds advanced seek about 0.4 seconds: seek addresses the buffer.
- [general] Seed variation with `Phaser.Math.RND.realInRange(0.95, 1.05)`, not unseeded Phaser.Math.Between ([deterministic driving](../../phaser-verification/references/deterministic-test-driving.md)).

## Events and cleanup

- [documented] Events: play, pause, resume, stop, complete, looped, loop, mute, volume, rate, detune, seek, pan, destroy. Destroy removes listeners, nulls manager/config, and the manager drops the sound next update (`src/sound/BaseSound.js`).
- [general] Use once for completion, remove retained listeners on shutdown, and never set a destroyed sound's properties: config is null ([loops and scene lifetime](loops-and-scene-lifetime.md)).

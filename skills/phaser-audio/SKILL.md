---
name: phaser-audio
description: Play, mix and test sound in a Phaser 4 game - the sound manager and first-gesture unlock, music that survives scene restarts, loops, markers and audio sprites, pan, distance and ducking, the 4.2.1 decode and visibility patches, and checking audio without ears. Use when loading or playing exported sound or music in Phaser, when audio is silent until a click, stops when the tab hides, falls silent mid-loop, doubles on a level restart, throws on a missing key, or when deciding who owns sound decisions. Not for authoring sounds (agent-beeps), shipping audio to other engines (engine-asset-import), or input (phaser-input).
---

# Phaser audio

Phaser 4.2.1 owns loading, decoding, playback and lifecycle of exported recordings; the sound tools own authoring. The sound system is unchanged from Phaser 3, so 3.x snippets still apply, but several of its behaviours bite a 4.x game, and each is proved by a probe in `examples/web/phaser-probes`. Read the reference that matches the work.

| You are about to | Read |
| --- | --- |
| Pick the audio backend, unlock on the first gesture, set global volume, handle blur and hidden tabs, cap voices | [the sound manager in 4.x](references/sound-manager-in-4x.md) |
| Write a sound-effects layer: one-shots, retained sounds, per-play config, markers, audio sprites, rate and seek | [sounds, markers and sprites](references/sounds-markers-and-sprites.md) |
| Start music, restart a level, pause for a menu, clean up on shutdown, or debug a loop that went silent | [loops and scene lifetime](references/loops-and-scene-lifetime.md) |
| Add pan, distance falloff, a music/effects balance, fades or ducking | [spatial and mix](references/spatial-and-mix.md) |
| Prove audio works without hearing it, or say what stays unverified | [testing audio](references/testing-audio.md) |
| Play exported recordings and own loading and lifecycle in Phaser | [native recorded audio](references/native-audio.md), [4.2.1 corrections](references/native-audio-corrections.md) |
| Use the beeps procedural or adaptive player and direct game sound decisions | [audio directors](references/audio-directors.md) |
| Ship audio: lock, store, Opus-only format, unsupported-browser notice, decoded-memory budget, a CI that fetches instead of rendering | [audio integration](../engine-asset-import/references/audio-integration.md), [CI for generated assets](../engine-asset-import/references/ci-for-generated-assets.md) |

## Rules that earned their place

- [tested] **A Phaser loop needs frames.** WebAudio loops are rescheduled from the manager's per-frame update; with `game.loop.sleep()` or `game.pause()` a loop plays two repetitions and goes silent while `isPlaying` stays `true`. Hold sound with `mute` or `pauseAll()`, never by stopping the loop.
- [tested] **Reuse music by key.** `scene.sound` is the game's manager, so `this.sound.add('theme', {loop: true}).play()` in `create()` stacks one more loop on every restart. Use `sound.get(key) ?? sound.add(key)`.
- [tested] **A config passed to `play()` sticks** to the sound or marker, and `stopAll()` leaves fire-and-forget sounds registered. Pass full config each call and remove with `removeByKey`.
- [tested] **Do not use the built-in listener for a 2D game.** After `setListenerPosition` every sound without a `source` is nearly silent, and a coordinate of 0 is ignored. Compute distance and pan yourself ([spatial and mix](references/spatial-and-mix.md)).
- [tested] **The gate and its flag are separate.** `sound.locked` clears on the next frame after the gesture, and Playwright's `page.evaluate` grants activation, so assert the gate with a real click and Phaser's own flags.
- [tested] **`noAudio` hides bugs.** It accepts missing keys and emits nothing; the WebAudio manager throws on both. Do not use it as a test switch.
- [general] **Phaser owns exported-recording loading and lifecycle; the sound tool owns authoring.** Missing reusable processing belongs in the sound tool, not copied into a game.
- [general] **Version-pinned patches carry a removal condition.** The decode and visibility patches target Phaser 4.2.1 exactly; remove each when a reviewed upstream release fixes it.

## Verify

- [tested] `node examples/web/phaser-probes/phaser-audio-manager.mjs <project>` and `phaser-audio-sounds.mjs <project>` (a project with `phaser@4.2.1` and `@playwright/test`) re-prove every `[tested]` claim above in headless Chromium and print the measured numbers. Rerun them after a Phaser upgrade; a failure names the claim to update.

## Not covered here

Procedural sound design is agent-beeps. Importing audio into other engines is [engine-asset-import](../engine-asset-import/SKILL.md).

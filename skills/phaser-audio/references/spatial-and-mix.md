# Pan, distance and mixing in Phaser 4

Read this before you add positional sound, a music/effects balance, fades or ducking. The built-in spatial sound has four traps that make it the wrong default for a 2D game; a thirty-line helper does the job on both backends. Backed by [`phaser-audio-manager.mjs`](../../../examples/web/phaser-probes/phaser-audio-manager.mjs).

## Pan

- [documented] `sound.pan` (-1 left, 1 right) drives a `StereoPannerNode`. HTML5 Audio fires the `pan` event but makes no audible change, and the package's audio notes say Safari builds without `StereoPannerNode` behave the same (`src/sound/webaudio/WebAudioSound.js`, `skills/audio-and-sound/SKILL.md`).
- [tested] For a mono source, centre read 0.354 on each channel; hard left read 0.707 on the left and 0 on the right (the sound's spatial node feeds the stereo panner two channels, and a hard pan sums them). The loud channel is twice the level (6 dB) and the total power 3 dB higher than at centre, so a cue panned to the edge sounds louder than the same cue centred.
- [general] Pan from the camera, not the world: `pan = Phaser.Math.Clamp((x - cam.worldView.centerX) / (cam.worldView.width / 2), -1, 1) * 0.8`. Stop short of full width so a cue near the screen edge is not a single-ear sound.

## Phaser's spatial source and its four traps

- [documented] `sound.add(key, {source: {x, y, refDistance, maxDistance, rolloffFactor, distanceModel, follow}})` configures the sound's `PannerNode`; `setListenerPosition(x, y)` sets the listener, defaulting to the canvas centre in game pixels. Defaults are the Web Audio ones: inverse model, `refDistance` 1, `rolloffFactor` 1, `maxDistance` 10000 (`src/sound/webaudio/WebAudioSound.js`). WebAudio only: HTML5 ignores `source`.
- [documented] With the inverse model gain is `ref / (ref + rolloff * (distance - ref))`. In world pixels the default `refDistance` of 1 puts a cue 500 px away at 0.002 (-54 dB). Set `refDistance` near a screen width fraction (for example 200) and `maxDistance` past the farthest audible object.
- [tested] Trap 1: once the listener has moved, every sound without a `source` is almost silent. With the listener at (400, 300), a plain looping tone peaked at 0.001 against 0.354 before, while a sound whose `source` sat on the listener kept 0.354. Give music and UI sounds a `source` at the listener, or use the helper below.
- [tested] Trap 2: a listener coordinate of 0 is ignored. `update()` tests `if (x && x !== this._spatialx)`, so moving the listener from 100 back to 0 left it at 100.
- [tested] Trap 3: the same truthiness test applies to `follow`. A follow target at `x = 0` kept the sound at its last x (300) while `y` still updated.
- [documented] Trap 4: nothing moves the listener for you. Write the camera centre into it every frame, or `setListenerPosition()` stays at the canvas centre and sources are measured from the wrong place.
- [general] If you do use it, keep every world coordinate away from 0 (offset the world by +1000), or skip it. For a 2D game the helper is the recommended route.

## A distance and pan helper

```js
// Call once per frame for each audible source (or when the camera or source moves).
export function place(sound, base, srcX, srcY, cam, {near = 150, far = 700} = {}) {
  const v = cam.worldView, dx = srcX - v.centerX, dy = srcY - v.centerY, d = Math.hypot(dx, dy);
  const gain = d <= near ? 1 : d >= far ? 0 : 1 - (d - near) / (far - near);
  sound.volume = base * gain;                                   // base = authored * bus * duck
  sound.pan = Phaser.Math.Clamp(dx / (v.width / 2), -1, 1) * 0.8;
}
```

- [general] It works on HTML5 Audio for volume and on every browser with `StereoPannerNode` for pan, has no truthiness trap, and tests with plain numbers. Linear falloff is crude; square it (`gain * gain`) for a steeper curve.
- [general] Cull before you call: skip sources outside `far` and stop a looping emitter when it leaves range, so you do not run thousands of setters a frame.

## Buses, fades and ducking

- [documented] There is no bus API. The manager has `masterVolumeNode` and `masterMuteNode`, every sound connects to `manager.destination` in its constructor, and nothing in `src/sound` fades (a search for "fade" finds none).
- [general] Treat a bus as a number in your code: `volume = authored * bus[category] * duck * fade`, recomputed in one function whenever any term changes, so a settings slider and a fade never overwrite each other (the rule in [native recorded audio](native-audio.md)).
- [general] Fade by tweening a plain object and applying the product, not by tweening `sound.volume` directly, so a destroyed sound cannot be hit by a live tween ([loops and scene lifetime](loops-and-scene-lifetime.md)):

```js
const duck = {v: 1};
this.tweens.add({targets: duck, v: 0.35, duration: 350, onUpdate: () => applyMix()});   // down fast
this.tweens.add({targets: duck, v: 1, duration: 1600, delay: 800, onUpdate: () => applyMix()});   // up slow
```

- [documented] The `volume` setter calls `gain.setValueAtTime(value, 0)`, a step that takes effect at once (`src/sound/webaudio/WebAudioSound.js`).
- [general] Updated once per frame that step is smooth enough for fades and ducks. Do not also schedule `linearRampToValueAtTime` on the same gain node: the two write the same parameter and the result is not specified here.
- [general] Duck, do not mute: music steps back while dialogue or a stinger plays and returns slowly. Keep effects out of the duck so hit feedback stays readable.

## When to hand off to the beeps player

| Need | Phaser native | Use the beeps player ([audio directors](audio-directors.md)) |
| --- | --- | --- |
| Play, loop, fade, pan, mute a recording | yes | not needed |
| Bar-quantised crossfades, layered adaptive music | no | yes |
| Voice stealing by priority, loudness-matched buses | write it | yes |
| Decoded-memory budget with eviction | write it | yes |
| Live synthesis of a cue | no | yes |

- [general] Ask for the beeps player when the game needs a behaviour in the right-hand column and the cost of writing it exceeds a day, not because a recording came from beeps. If it owns all playback, set `audio.noAudio: true` so Phaser builds no second context.

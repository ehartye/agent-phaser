# Music-reactive visuals (Phaser 4.2.1)

Reading the music so visuals can follow it: where to tap, what the numbers look like, and the one trap in Phaser's own snippet. The tap harness for tests is in [testing audio](testing-audio.md); a beeps player that owns playback is in [audio directors](audio-directors.md). The check is in `phaser-audio-manager.mjs` in [the probes folder](../../../examples/web/phaser-probes/README.md) (name starts "music-reactive tap").

## Tap, do not route

- [tested] Phaser's own audio document connects `masterVolumeNode` to an analyser and the analyser to `context.destination`. That adds a second connection to the destination (one extra in the probe, against none for the tap below), and Web Audio sums every path into the destination, so the output is doubled. A tap branches off and stops: `this.sound.masterVolumeNode.connect(analyser)` and nothing after it.
- [tested] The tap works without being connected onward: a 440 Hz tone read as the loudest bin (421.9 Hz at an FFT of 2048 and 48 kHz, within one 23.4 Hz bin) at full byte magnitude.
- [documented] Branching from `masterVolumeNode` reads after the mute node and the global volume, so a muted or quiet game reads quiet. Branch from a single sound's own node only if you need that sound alone.

```js
const ctx = this.sound.context;
const tap = ctx.createAnalyser();
tap.fftSize = 2048; tap.smoothingTimeConstant = 0.6;
this.sound.masterVolumeNode.connect(tap);           // a branch: never tap.connect(ctx.destination)
const bins = new Uint8Array(tap.frequencyBinCount);  // allocate once, read every frame in update()
// in update(): tap.getByteFrequencyData(bins); const level = Math.max(...bins.subarray(1, 12)) / 255;
```

## Reading and using the numbers

- [tested] Silence reads zero: the tap read 0 under `sound.mute = true` and 0 after the sound stopped, so a visual that pulses while the game is muted is a bug in the visual, not the audio.
- [general] Turn band energy into a bounded, quantised parameter: take the maximum of a few bins, divide by 255, then round to a small number of steps (eight, for a pixel-art pulse) before it drives a scale, a palette index or a camera zoom. Steps keep pixel art on the grid ([pixel motion craft](../../phaser-motion/references/pixel-motion-craft.md)).
- [general] Read once per frame in `update`, with the typed array allocated once. An analyser is real time and reports the audio clock even under a hand-stepped `game.step` loop, so tests play a fixed tone, wait on the audio clock and use a tolerance ([testing audio](testing-audio.md)).

## When there is no signal

- [tested] With `audio: { noAudio: true }` the manager has no `context` at all (`hasContext` false in the manager-choice check), so there is nothing to tap: guard the tap on `this.sound.context`. [documented] A locked or suspended context and a muted game read zero. Give the visual a fallback (a timer pulse from the song's `bpm` and `meter`, which the beeps sidecar carries) or none, and decide it once.
- [documented] When the beeps player owns playback, tap its output or drive the visual from the song's beat clock; for a shared context see [hybrid playback](hybrid-playback.md).

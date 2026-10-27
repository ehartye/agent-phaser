# Hybrid playback: native recordings plus beeps live cues (Phaser 4.2.1)

Use this when music and ambience are Phaser sounds and some effects are agent-beeps runtime cues built live on the same `AudioContext`. When one library can own all playback, do that instead ([native audio](native-audio.md) has the one-owner rule and [audio directors](audio-directors.md) the beeps-owned case). Check names are in `phaser-audio-manager.mjs` in [the probes folder](../../../examples/web/phaser-probes/README.md).

## One context

- [tested] Pass the app's context as `audio: { context }`: the manager's `context` is that object, it starts suspended until a user gesture, and Phaser's own unlock resumed it after one real click (`game.sound.locked` cleared on the next frame). The game adds no second unlock path for it (check "a supplied audio.context is unlocked by Phaser and suspended, not closed, on destroy").
- [tested] Teardown differs: `game.destroy(true)` suspended the supplied context and closed the one Phaser made itself. A context you supply is yours to close, and a shared one stays usable by the other library after Phaser is gone.
- [documented] The beeps player takes the same object with `createPlayer({ context })` and its `dispose()` never closes a context it was given; `contextFactory` makes one the player owns instead (`runtime/player/player.d.ts`, `PlayerOptions`). Its master shaper connects to `context.destination` and there is no output-node option, so a player on a shared context reaches the destination directly and does not follow Phaser's mute.

## Where a live cue joins

- [tested] `game.sound.destination` is `masterMuteNode`. A 440 Hz cue joined there played at 0.5 unmuted and 0 under `game.sound.mute = true`; the same cue joined at `masterVolumeNode` played at 0.5 both ways, because it skips the mute node (check "game.sound.destination follows mute; masterVolumeNode skips it"). Join cues at `game.sound.destination`.
- [documented] A beeps live cue is built with `build(ctx, out, cue, { samples })` where `out` is any node (`docs/runtime.md`): pass `game.sound.destination`. Cues started by the beeps player itself do not pass through it.
- [general] Pick the owner of each sound class once: recordings through Phaser, cues through `build` into `game.sound.destination`, and nothing in both. Two owners for one sound doubles it, and a pause or mute that reaches only one leaves the other playing.

## Testing

- [tested] Tap `masterVolumeNode` as in [testing audio](testing-audio.md) to read the joined output as a number: both joins read 0.5, and under mute only the `destination` join reads 0. A cue joined at `masterVolumeNode` is the failure to test for.
- [general] The beeps cue behaviour itself (voices, variants, loudness) is the beeps player's to prove; this page claims only the Phaser side of the join.

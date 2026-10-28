# Loops, scene changes and pausing in Phaser 4

Read this before you start music, pause a game or restart a level. Three things go wrong: a loop that goes silent while the game says it is playing, music that doubles on every restart, and cleanup that throws. Backed by [`phaser-audio-sounds.mjs`](../../../examples/web/phaser-probes/phaser-audio-sounds.mjs).

## How a WebAudio loop is scheduled

- [documented] Phaser never sets `source.loop`. It starts one `AudioBufferSourceNode`, schedules a second at the exact end time (`getLoopTime()`), and on each `ended` flips a flag; the next `update()` promotes the second node and schedules the one after it, then emits `looped`. `loopStart` and `loopEnd` are not used (`src/sound/webaudio/WebAudioSound.js`).
- [documented] `update()` runs from the manager's `PRE_STEP` listener (`src/sound/BaseSoundManager.js`), and `Game.step` returns before emitting `PRE_STEP` when `game.isPaused` is true (`src/core/Game.js`).
- [tested] With `game.loop.sleep()` (no frames), a 0.3 s loop played its first two repetitions (0.6 s) and then went silent: the output peak fell from 0.354 to 0 while `sound.isPlaying` stayed `true` and no `looped` event fired. With frames running, the same loop sounded continuously and emitted `looped` four times in 1.2 s.
- [general] What stops frames: `game.loop.sleep()`, `game.pause()`, a hidden tab when `pauseOnBlur` is false (browsers stop `requestAnimationFrame`), and a main-thread stall longer than the loop. Keep `pauseOnBlur` true so a hidden tab suspends the context; never "pause the game" with `loop.sleep()` while music must continue; keep loops much longer than your worst load hitch; in a hand-driven test keep stepping while you wait ([testing audio](testing-audio.md)).
- [general] A loop is gapless only as far as the decoded buffer is: encoder delay and padding that a browser leaves in the file become an audible gap or click because Phaser plays the whole buffer. Check the decoded frame count, not the file (the audio-integration reference of agent-engine:engine-asset-import).

## Music that survives scene changes

- [tested] `scene.sound` is the game's manager (`game.scene.getScene('Level').sound === game.sound`), so music started in one scene keeps playing when that scene shuts down.
- [tested] A scene whose `create()` does `this.sound.add('theme', {loop: true}).play()` had four sounds and four playing after four starts. Reusing by key left one:

```js
const sm = this.sound;
const theme = sm.get('theme') ?? sm.add('theme', {loop: true});
if (!theme.isPlaying) theme.play();
```

- [general] Pick one owner for each long sound. A persistent scene or a plain module holding the sound is simpler than asking every level whether the music already runs. Change track by fading the old one out and removing it ([spatial and mix](spatial-and-mix.md)); calling `play()` on a playing sound restarts it.
- [general] Compare the requested track with the current one before acting, and cancel a pending request when a newer one arrives, so a slow decode cannot start the previous level's music ([native recorded audio](native-audio.md)).

## Cleanup on shutdown

- [documented] The sound manager registers no scene hooks, so a scene's shutdown stops nothing and the docs say looping sounds continue across scene changes (`skills/audio-and-sound/SKILL.md` in the package).
- [tested] A tween on `sound.volume` outlived `sound.destroy()` and threw `Cannot set properties of null (setting 'volume')` on its next update.
- [general] Stop the tween before the sound, and remove what the scene owns:

```js
this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
  this.fade?.stop();                      // tween first
  this.sound.removeByKey('level-wind');   // then sounds this scene made
  this.sound.off(Phaser.Sound.Events.UNLOCKED, this.startMusic, this);
});
```

- [general] Listeners you put on a retained sound or on the manager are yours to remove, for the same reason scene-event listeners are ([leaks and lifecycle](../../phaser-verification/references/leaks-and-lifecycle-tests.md)). Count `sound.sounds.length` before and after ten restarts in a test.

## Pausing for a menu

| You do | Sounds | Loops | Notes |
| --- | --- | --- | --- |
| `scene.pause()` | keep playing | keep scheduling | the manager is game-level, not scene-level |
| `sound.pauseAll()` / `resumeAll()` | paused, seek kept | resume where they stopped | skips a sound that starts during the pause |
| `sound.mute = true` | keep playing silently | keep scheduling | cheapest hold; restores instantly |
| `game.pause()` or `game.loop.sleep()` | keep playing | die after two repetitions | not an audio pause |
| `context.suspend()` | frozen | frozen | undone by the next frame ([the sound manager page](sound-manager-in-4x.md)) |

- [documented] `pauseAll()` calls `pause()` on every active sound and emits `pauseall`; `WebAudioSound.pause()` stores the current position and drops the buffer source (`src/sound/BaseSoundManager.js`, `src/sound/webaudio/WebAudioSound.js`).
- [general] Hold a sound by name rather than blanket-resuming: a menu that paused only the music should resume only the music, and a modal opened during a pause should keep its hold when the menu closes.

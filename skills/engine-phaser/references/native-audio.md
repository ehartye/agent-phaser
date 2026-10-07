# Recorded audio through Phaser

For exported WAVs and other browser-supported recordings, start with Phaser's Loader, audio cache and game-wide SoundManager. Agent-beeps authoring does not require the beeps browser player at runtime. Keep Phaser audio enabled; `audio.noAudio: true` selects its silent NoAudioSoundManager.

This reference owns the Phaser integration choice. Sound recipes, synthesis, rendering, loudness normalization, export metadata and the beeps player's specialized behavior belong to agent-beeps. Consume its released exports or APIs; do not copy that implementation into agent-engine or a game-side substitute.

## One playback owner

Read the pinned package's `skills/audio-and-sound/SKILL.md`, `src/sound/SoundManagerCreator.js`, `src/sound/BaseSoundManager.js` and the chosen backend. Phaser's SoundManager belongs to the Game, so playing sounds survive an ordinary scene change. A room's shutdown must not destroy shared music. Keep retained loop references with the existing game-wide audio owner; a persistent scene can host native loading and tweens when room scenes restart.

The native operations are small:

```ts
// Queue through a scene's native Loader, at the project's chosen loading boundary.
scene.load.audio('garden-music', 'audio/garden-music.wav');
scene.load.audio('harvest', 'audio/harvest.wav');

// After loader completion, cache verification and the project's audio activation:
const music = scene.sound.add('garden-music', {loop: true, volume: 0.6});
music.play();
scene.sound.play('harvest', {volume: 0.8});
```

The filenames and gains above are illustrative; use the project's existing catalog and mix. Phaser owns fetching, decoding, sound instances, loop scheduling and context teardown. Do not add a parallel fetch/decode service, AudioContext, loop timer or playback manager for these recordings.

Keep game policy separate: the area-to-track table, automatic/forced/off selection, preview precedence, bus levels and cue eligibility. Reconcile only when the desired state changes. An unchanged track must retain its sound instance and playback position; calling `play()` again restarts it. Cancel or supersede obsolete pending selections so a late decode cannot start the previous area's music.

Use native sound volume and native tweens for ordinary fades. Compose each sound's volume as category level × existing authored gain × fade envelope, and reapply that product when a level or envelope changes so sliders and fades do not overwrite each other. Phaser has global and per-sound volume; three named categories alone do not justify a second gain-node graph. Preserve the existing mix, transition timing, preview restoration and sound-toggle behavior rather than adding hysteresis, ducking or bar synchronization to a migration.

## Loading, activation and recovery

- Preserve the project's download policy. If it loads audio after a gesture, queue only its needed recordings through the native Loader then. For an initial runtime batch or retry outside `preload`, register completion/error listeners before calling `scene.load.start()` after queueing; queueing alone does not start the load. A suspended, game-owned Phaser context before activation is distinct from downloaded audio bytes.
- Use Phaser's native unlock mechanism and `locked`/`UNLOCKED` state. Verify keyboard, pointer, semantic and controller activation paths on the target devices before adding a bridge. Reproduce an actual native failure before proposing a scoped repair; do not assume every browser interruption is handled by a network retry.
- Loader `COMPLETE` is not proof that every recording decoded. Check requested keys in the audio cache, report failure through the existing status UI, and retry missing keys on the authorized retry action. Keep successful cached audio and discard failed initialization state. Reconcile the latest request after asynchronous loading.
- Check the pinned backend's blur/focus behavior and the game's hidden/visible events separately. Preserve intentional preview/menu holds; a blanket resume can restart sounds meant to remain paused. Pair every owned listener with teardown.
- Select supported formats from the delivered assets. Codec conversion, loop repair and export validation belong to beeps. WebAudio and HTML5Audio have different loop/overlap behavior; source inspection is not mobile or audible certification.

## When the beeps player is the right owner

Live synthesis or existing beeps-specific adaptive layers, variant selection, priority handling or processing may require its player or a released integration API. First check the concrete requirement against native Phaser behavior. Preserve required beeps behavior instead of copying it into an engine helper. If a reusable beeps adapter/export capability is missing, fix and release it in agent-beeps; agent-engine documents how the engine consumes it.

Choose the playback owner explicitly. If the beeps player owns all audio, disable Phaser audio to avoid an unused second context and follow the conditional [beeps integration reference](audio-directors.md). Shared-context injection by itself does not resolve duplicate playback or lifecycle ownership. Do not disable Phaser merely because a recording was authored with beeps.

## Verification

Test selection policy headlessly, then exercise native loading and playback: first activation; simultaneous music/ambience; unchanged handles and advancing seek across ten room restarts; previews and separate levels; interrupted/stale loads; HTTP and decode failure followed by retry; hidden without blur; visible with an intentional hold; bounded sounds/listeners and final teardown. Inspect the actual manager/backend and context count. Listen to loop boundaries and mix on the target devices, or report them as unverified.

Sources: [official Phaser audio concepts](https://docs.phaser.io/phaser/concepts/audio) and the [4.2.1 SoundManagerCreator](https://github.com/phaserjs/phaser/blob/v4.2.1/src/sound/SoundManagerCreator.js). The APIs above were checked against the pinned package. This guide does not claim a new engine sample-scene, listening or physical-device pass.

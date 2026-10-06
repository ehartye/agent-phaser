# Audio directors: decision tables and state machines, not scattered `play()` calls

How a Phaser game drives procedural audio (agent-beeps) so that every sim event has a sound decision, the score never thrashes, and the
whole thing is unit-tested in Node with a fake player. Phaser's own sound manager is not involved: set `audio: { noAudio: true }` in the
game config or Phaser builds an unused AudioContext (gotcha 15).

## 1. A tiny player interface, and the director owns the decisions

Define the smallest surface the director needs; the real player satisfies it structurally, tests pass a fake.

```ts
interface AudioPlayer {
  unlock(): Promise<boolean>;
  play(id: string, o?: { gainDb?: number; cooldownSec?: number; cap?: number; pan?: number; at?: 'now' | 'beat' | 'bar' }): unknown;
  music(id: string | null, o?: { fadeSec?: number; at?: 'now' | 'beat' | 'bar'; sync?: boolean }): Promise<boolean>;
  setState(state: string, o?: { fadeSec?: number; at?: 'now' | 'beat' | 'bar' }): boolean;
  duck(bus: Bus | Bus[], gainDb: number, o?: { fadeSec?: number }): void;
  ambience(id: string | null, o?: { slot?: string; fadeSec?: number }): Promise<boolean>;
}
// a compile-time guard that a vendored player update cannot silently drift: const _ok = (p: Player): AudioPlayer => p;
```

The **director decides, the player plays**. `director.handle(event)` for one-shots with cooldowns and de-duplication;
`director.update(worldState)` each frame, which talks to the player *only on change*; `director.walk(distance, ground)` per stride;
`director.unlock()` from the first gesture. One audio stack per page (a module-level `getGameAudio()`), not per scene, so the
AudioContext, the unlock and the beds survive scene restarts.

example: fallow-valley-next `src/game/audio/AudioPlayer.ts`, `BeepsPlayerAdapter.ts`, `SoundDirector.ts`.

## 2. Exhaustive decision tables, enforced by the compiler and by tests

- Keep the table as pure data in the content layer: `EVENT_SOUNDS` maps every sim event type to a rule (a cue, or a `by` rule that picks
  a cue from an event field with `cases` and a `fallback`), plus tables for deny reasons, ground to footstep surface, creature class to
  voice, weather and biome and daylight to ambience layers, priorities and mix levels.
- Make completeness a **type error**:

```ts
type _EveryEventHasADecision = Exclude<SimEvent['type'], keyof typeof EVENT_SOUNDS> extends never ? true : never;
type _NoStaleDecision = Exclude<keyof typeof EVENT_SOUNDS, SimEvent['type']> extends never ? true : never;
const _checks: [_EveryEventHasADecision, _NoStaleDecision] = [true, true];
```

  Adding a sim event or a deny reason then fails `tsc` until it has words and a sound; a test file builds
  `{...} satisfies Record<SimEvent['type'], 1>` for the same effect with a readable error.
- Runtime tests: every cue in the table exists in the build's catalogue (`recipes.json` and, when built, `index.json`), every
  catalogue file exists, is Ogg, is non-empty; every fauna id has a voice; every content id that should be audible is. A silent decision
  (`null`) must carry a reason and appear in a coverage list.
- An event another branch added but the table does not know yet goes in a `PENDING_EVENT_SOUNDS` table or is silent; never crashes.
  Remove the entry when the table lands.

example: `src/content/sounds.ts`, `src/content/sound-coverage.ts`, `tests/audio/*.test.ts`, `tools/build-audition.mjs` (a page that
lists every event with its sound for the owner to hear; a "listening room" is how decisions get reviewed by ear).

## 3. Music is a state machine with hysteresis

`MusicDirector` is pure: it owns no audio and no clock; it is told the world (`update(input)`), the news (`handle(event)`) and the
scene (`setScene('title' | 'world' | 'paused' ...)`), and tells the player which loop and which of its layers to play, how far to duck
the buses and which sting to ask for.

- **Fixed priority**, highest first: a rest after death, the title scenes, a boss, a vault, a fight, the biome by time of day and weather.
- **Every transition has a minimum hold or hysteresis**, so a roach, a biome border or a dusk that flickers cannot make the score thrash.
  A `Ladder` goes *up* as soon as asked (after a minimum interval since the last change) and *down* only after the lower level has been
  asked for continuously for N seconds: danger music climbs fast and relaxes slowly.
- **Quantise changes**: `at: 'bar'` and `sync: true` crossfade on the next bar with the new loop starting in the old one's phase (needs
  songs of the same tempo and length). Stings use `at: 'beat'`.
- **Duck, do not mute**: dialogue, trade, inventory, map and journal each add a reason to a set; while any is on the music steps back.
- Pass `now` into the director (wall seconds in the game, a fake in tests) and a `later(sec, fn)` for delayed cues; tests drive time by hand.

example: `src/game/audio/MusicDirector.ts` (`Ladder`, `timeOfDay`), `tests/audio/music-director.test.ts`.

## 4. Browser audio rules

- Nothing plays before a user gesture: unlock once on the first `pointerdown` or `keydown` and remove the listeners. Download nothing from
  `audio/` before the gesture; after it, fetch the catalogue, the cues and beds that play and the playing music, never the folder. Measured:
  0 audio bytes before the gesture; 14 files and 4.1 MB after the first cue out of a 33 MB build.
- Ogg Opus decodes in Chromium and Firefox; Safari support is recent and unmeasured. Report decode failures (`E_DECODE`) and carry on silent.
- `document.visibilitychange` must reach the player (`player.setHidden(document.hidden)`).
- Render the audio in CI with caching keyed by the renderer version and a hash of the sources; render caches keyed by patch content let a
  one-patch change re-render one patch. Gate the hosted build on a test that every catalogue entry has its file and the folder stays
  inside a size budget.

example: `src/game/audio/BeepsPlayerAdapter.ts`, `.github/workflows/pages.yml`, `tests/browser/pages-audio.spec.ts`.

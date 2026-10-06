# Wiring agent-sprites and agent-beeps into Phaser

## agent-sprites

- **Animated sheets** (characters, creatures, effects): `load.aseprite(key, png, atlasJson)` then
  `anims.createFromAseprite(key)`. Every cell group becomes a named animation with per-frame durations. Phaser ignores
  the pivot slice: set the origin by hand (usually `setOrigin(0.5, 1)` for bottom-centre).
- **Tile sheets**: the same loader works; use the texture as a tileset image (see
  [tilemaps and terrain](tilemaps-and-terrain.md)). Build a `name -> index` map from the frames.
- **Terrain**: the `terrain-overlay` environment kind (agent-sprites 0.61.0) exports base tiles, 47-mask encroachment
  overlay tiles and a four-frame water animation in one atlas. Aliases are `<material>_<variant>` and
  `<material>_<mask>_<variant>`. Its report lists the mask convention. Stack overlays by priority, at most two per tile.
- **Creatures**: the `creature` source (0.62.0) exports idle, walk, attack, hurt and down per view with a report giving
  the ground anchor and a collision footprint; drive movement from the report, not from the cell bottom.
- **Characters**: native 16x32 characters (four directions, idle plus a four-frame walk). Draw at the report's ground
  anchor.
- **Use the managed launcher**; never copy a tool script into the game. If the installed plugin is older than a tool
  feature you need, run the repository checkout's CLI and say so in the build script's error message until a release is
  installed.
- Check in generated sheets and atlases with the build's ownership marker; gitignore large derived files
  (`*.project.json`, `operations.json`) because every build regenerates them.
- Draw at integer zoom with `pixelArt: true` and `roundPixels: true`; never let a camera zoom fractionally.

## agent-beeps

- Build with `beeps` (export every sound and song to one folder, `beeps bundle` for `index.json`, `beeps player export`
  to vendor the browser player). Keep the audio output directory out of git (it can be large) and build it in CI or on
  demand.
- `player.unlock()` must run from a real user gesture. A title screen's key press counts.
- Keep a **sound director** between sim events and the player: it maps every event to a decision (a cue, a variant set,
  or silence with a reason), layers ambience (base, weather, biome) with separate crossfades, ducks beds under weather,
  and follows daylight with hysteresis. Give it a compile-time check that every event type has a decision.
- Voice priority follows `meta.priority` (1 most important); the player has a voice budget and returns null when a burst
  exceeds it. That is correct behaviour, not a failure.
- Sound is judged by ear. An agent can measure, lint and look at renders, then prepare an audition, but must report
  sounds as "measured, not heard".

## Order of work when starting a game

1. Sim and content with tests, no art. 2. Placeholder atlases generated in code with the same frame names the real art
will use, so the pipeline is proven before art lands. 3. Real terrain and objects. 4. Characters and creatures. 5. Audio.
Replace placeholders by changing atlas loading only.

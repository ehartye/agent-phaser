# Errata for Phaser's own documents: behaviour (Phaser 4.2.1)

Lines in `node_modules/phaser/skills` that describe a behaviour 4.2.1 does not have. The format and the upgrade check are in [the names page](phaser-docs-errata-names.md). Run `examples/web/phaser-probes/phaser-docs-errata.mjs` against the host project after a Phaser upgrade; a row whose needle is gone may be obsolete.

## Behaviour that differs from the document

- [documented] A `[tested]` row names a probe check in `examples/web/phaser-probes` that reproduces it; a `[documented]` row was read from the named 4.2.1 source and not run.

| Phaser file | Needle | What 4.2.1 does | Evidence | Fuller fix |
| --- | --- | --- | --- | --- |
| `skills/animations/SKILL.md` | `added to the base msPerFrame` | A per-frame `duration` replaces the base time for that frame. | [tested] `phaser-motion-clocks.mjs` (`per-frame-duration-replaces`) | [sprite animations](../../phaser-motion/references/sprite-animations.md) |
| `skills/filters-and-postfx/SKILL.md` | `can automatically calculate padding` | A new controller's `paddingOverride` is an empty Rectangle, so a blur clips at the object's bounds until `setPaddingOverride(null)`. | [tested] `phaser-rendering-filters.mjs` | [filters](../../phaser-rendering/references/filters.md) |
| `skills/loading-assets/SKILL.md` | `will log a warning and skip it` | A duplicate key is skipped with no log. | [tested] `engine-phaser-foundations.mjs` (`loader-duplicate-key-is-silent-and-completes-at-once`) | [loading assets](loading-assets.md) |
| `skills/events-system/SKILL.md` | `this.events.on(Phaser.Scenes.Events.SHUTDOWN` | `Systems#shutdown` removes only the transition listeners, so registering this in `create` adds one more listener on every restart; use `once`. | [documented] `src/scene/Systems.js` | [events and data](events-and-data.md) |
| `skills/audio-and-sound/SKILL.md` | `this.sound.masterVolumeNode.connect(analyser);` | The manager already routes to `context.destination`, so connecting the analyser onward adds a second output path; a tap branches to the analyser and stops there. | [tested] `phaser-audio-manager.mjs` (connection counts: the tap adds none, the snippet one) | [music-reactive visuals](../../phaser-audio/references/music-reactive-visuals.md) |
| `skills/game-object-components/SKILL.md` | `Tint modes in v4` | The tint modes listed there omit `MULTIPLY_TWO` (value 7), which only the v4-new-features document lists; the sprites-and-images document's list omits it too. | [documented] `src/renderer/TintModes.js` | [API and effects gotchas](../../phaser-rendering/references/phaser-4-api-and-effects-gotchas.md) |

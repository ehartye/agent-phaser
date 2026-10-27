# Errata for Phaser's own documents: names, signatures and links (Phaser 4.2.1)

`engine-phaser` step 2 tells a builder to read the documents in `node_modules/phaser/skills`. Most are right for the installed version; the rows below are lines that are not. Each names the Phaser file, the exact text to find (the needle), what 4.2.1 does, the evidence and where the fuller fix lives. Behaviour errata are in [the behaviour page](phaser-docs-errata-behaviour.md). After a Phaser upgrade run `examples/web/phaser-probes/phaser-docs-errata.mjs` against the host project: a row whose needle is gone may be obsolete and should be trimmed.

## Event, factory and method names

- [documented] These rows rest on the 4.2.1 source named in the Evidence column, read and not run unless the cell cites a probe check. A listener registered under a wrong event string is never called and raises no error.

| Phaser file | Needle | What 4.2.1 does | Evidence | Fuller fix |
| --- | --- | --- | --- | --- |
| `skills/animations/SKILL.md` | `removeanimation` | The manager events are `'add'` and `'remove'`; `pauseall` and `resumeall` are right. | [documented] `src/animations/events/ADD_ANIMATION_EVENT.js`, `REMOVE_ANIMATION_EVENT.js` | this table |
| `skills/audio-and-sound/SKILL.md` | `'globalmute'` | The global events are `'mute'`, `'volume'`, `'rate'` and `'detune'`. | [documented] `src/sound/events/GLOBAL_*_EVENT.js` | this table |
| `skills/cameras/SKILL.md` | `cam.filters.external.addGlow(0xff0000, 4, 0, false, 0.1, 10);` | The arguments are `(color, outerStrength, innerStrength, scale, knockout, quality, distance)`, so `false` lands in `scale` and `0.1` in `knockout`. | [documented] `src/gameobjects/components/FilterList.js` | this table |
| `skills/v4-new-features/SKILL.md` | `this.add.noiseCell2D()` | Noise factories are lowercase: `noisecell2d`. | [tested] `phaser-rendering-textures-and-shaders.mjs` | [custom shaders](../../phaser-rendering/references/custom-shaders-in-phaser.md) |
| `skills/physics-matter/SKILL.md` | `this.matter.set60Hz();` | `set30Hz()` and `set60Hz()` do nothing; set `runner: { fps }`. | [tested] `phaser-physics-matter.mjs` | [Matter physics](../../phaser-physics/references/matter-physics.md) |
| `skills/text-and-bitmaptext/SKILL.md` | `{ data: Phaser.GameObjects.RetroFont.Parse(this, config) }` | `Parse` returns the whole cache entry; the wrapped form makes `add.bitmapText` throw. | [tested] `phaser-pixel-ui-text.mjs` | [text and bitmap fonts](../../phaser-pixel-ui/references/text-and-bitmap-fonts.md) |
| `skills/text-and-bitmaptext/SKILL.md` | `Phaser does not load web fonts` | `load.font` exists (`src/loader/filetypes/FontFile.js`). | [documented] `FontFile.js` | [text and bitmap fonts](../../phaser-pixel-ui/references/text-and-bitmap-fonts.md) |
| `skills/game-setup-and-config/SKILL.md` | `EXPAND scale mode added` | `Phaser.Scale.EXPAND` is not new in v4: the v3.80 changelog introduced it. The scale skill is right. | [documented] changelogs 3.80 to 3.90 in the package | [scale](scale-and-responsive.md) |
| `skills/cameras/SKILL.md` | `references/REFERENCE..//SKILL.md` | The link path is malformed and does not resolve; the sprites-and-images skill ends the same way. | [documented] the two documents | this table |

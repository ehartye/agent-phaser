# Released PCM audio-sprite fixture

`tones.wav` and `tones.sprite.json` were built and verified through the normal CLI of agent-beeps **0.36.0**, source/tag `377a95eeabbac7da2609dc4aa0862bb9b1bffeae`. `provenance.json` records the released runtime, source formulas and exact source/WAV/map identities.

The sources are canonical PCM16, 48 kHz mono. Each entry is 24000 frames (0.5 seconds): `low` is a 220 Hz sine at amplitude 0.2, `mid` is 440 Hz at 0.5, and `high` is 880 Hz at 0.9. Only `high` loops. The producer inserts 4800 zero frames between entries, giving ranges `[0, 24000)`, `[28800, 52800)` and `[57600, 81600)`. The final end is exclusive; there is no trailing gap.

With the released producer checked out exactly and its locked dependencies installed, reproduce and check every committed data file:

```sh
node tests/fixtures/audio-sprite/regenerate.mjs /path/to/agent-beeps
```

Append `--write` only to deliberately regenerate the committed files. The script authenticates the actual remote release tag, runs normal build/check/verify, compares exact bytes, and removes its unique temporary workspace in `finally`. It does not install or modify the producer.

This proves the bounded PCM packing contract. Native Phaser loading, regions, completion and looping belong to `examples/web/phaser-probes/phaser-audio-sounds.mjs`; a successful decode alone does not authenticate these source bytes.

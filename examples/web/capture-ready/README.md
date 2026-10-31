# Capture-ready fixture

This isolated Phaser 4.2.1 Canvas example exercises agent-vids 0.5.0. It has a single model/action owner, two named semantic buttons, a readiness predicate, capture-local title skip, seeded tick-based motion and one whole-file sound receipt. It owns no game integration runtime.

Run the two manual probes from the repository root with an external host containing Phaser and Playwright, and the installed producer's managed launcher:

```sh
node examples/web/phaser-probes/phaser-capture-clock-experiment.mjs /path/to/host --vids /path/to/agent-vids/scripts/run-managed.js
node examples/web/phaser-probes/phaser-capture-ready.mjs /path/to/host --vids /path/to/agent-vids/scripts/run-managed.js
```

The driver serves this fixture on a dynamic localhost port, serves the host's pinned Phaser bundle and the unchanged debug helper, and creates an authored 200-ms 440-Hz PCM cue. It copies fixture bytes and the cue into a unique evidence directory. It resolves the storyboard template's placeholder URL and writes each case's setup/receipt scripts beside its storyboard. `configure.js` and `receipt.js` here show the supported external-clock scripts; the clock experiment writes its explicit manual-case variants only into evidence.

Use a new path for `--output`; existing directories are refused to preserve earlier evidence. `--mutation frames` and `--mutation audio` expose the adverse cases as expected nonzero invocations. Reports retain actual commands, output, runtime/source hashes, native geometry, frames, audio and cleanup state. The probe intentionally leaves artifacts for inspection.

The [contract and checklist](../../../skills/phaser-verification/references/capture-ready-game.md) explains evidence boundaries. The independent producer must supply its own browser and encoder; the dependency-free merge gate installs or launches neither.

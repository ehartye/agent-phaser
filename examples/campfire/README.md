# Campfire

An 8-frame looping campfire (32x40 cells, 10 fps) made with agent-sprites: layered flame tongues, two
logs, flickering coals and rising sparks. Every motion term is a whole harmonic of the frame phase, so the
loop is seamless.

Rebuild with the managed launcher from the agent-sprites plugin:

```text
node <agent-sprites-root>/scripts/run-managed.js build sprite-project.json --json
```

`dist/` holds the last build. The atlas has 24 frame entries for 8 cells: the tag `burn` covers entries 8 to
15 (100 ms each). A loader must follow the tag into the `frames` array, not assume frame index equals cell
index.

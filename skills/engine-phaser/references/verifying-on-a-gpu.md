# Verifying a Phaser game on a real GPU

Software WebGL hides performance problems and some correctness problems, and "no console errors" passes on a blank
screen. Verify on the GPU and assert on pixels.

The method is split by stage:

| Section | File |
|---|---|
| Playwright configuration | [verifying-playwright-setup.md](verifying-playwright-setup.md) |
| What to assert | [verifying-assertions-and-harness.md](verifying-assertions-and-harness.md) |
| Prove the test by mutation | [verifying-assertions-and-harness.md](verifying-assertions-and-harness.md) |
| Debugging harness (small scripts worth keeping) | [verifying-assertions-and-harness.md](verifying-assertions-and-harness.md) |
| Gotchas in the harness itself | [verifying-assertions-and-harness.md](verifying-assertions-and-harness.md) |
| Read pixels inside the page: `renderer.snapshotPixel` | [verifying-assertions-and-harness.md](verifying-assertions-and-harness.md) |
| Drive the real loop by hand, deterministically | [verifying-loop-and-waiting.md](verifying-loop-and-waiting.md) |
| Waiting: conditions, frames and page time, never sleeps | [verifying-loop-and-waiting.md](verifying-loop-and-waiting.md) |
| Determinism proofs and regression tests worth having | [verifying-loop-and-waiting.md](verifying-loop-and-waiting.md) |
| A debug API, a manual frame loop and a page object (what replaces the sleeps) | [verifying-loop-and-waiting.md](verifying-loop-and-waiting.md) |

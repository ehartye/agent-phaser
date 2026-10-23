# Touch, tap to move and mobile in a Phaser 4 game

Everything here comes from giving one Phaser 4.2.1 game (pixel-only strict UI, headless deterministic sim) a complete
touch scheme: tap to move, gestures, an on-screen button cluster, a joystick and d-pad option, left-handed layout, safe areas, an
installable manifest and a phone render-quality tier. Tested in Chromium with touch emulation
only: no physical device, no real iOS Safari. Treat the iOS lines as unverified.

The reference is split in two:

| Section | File |
|---|---|
| What Phaser 4.2.1 does with fingers | [touch-input-and-design.md](touch-input-and-design.md) |
| Design rules that held up | [touch-input-and-design.md](touch-input-and-design.md) |
| Pathfinding for tap to move (in the sim) | [touch-tap-to-move-and-page.md](touch-tap-to-move-and-page.md) |
| The page: stop the browser's own gestures | [touch-tap-to-move-and-page.md](touch-tap-to-move-and-page.md) |
| Safe areas without a DOM node | [touch-tap-to-move-and-page.md](touch-tap-to-move-and-page.md) |
| Render quality on phones: keep the ratio a whole number | [touch-tap-to-move-and-page.md](touch-tap-to-move-and-page.md) |
| Accidental input, haptics and install | [touch-tap-to-move-and-page.md](touch-tap-to-move-and-page.md) |
| Testing touch with Playwright | [touch-tap-to-move-and-page.md](touch-tap-to-move-and-page.md) |
| Not done, and why it matters | [touch-tap-to-move-and-page.md](touch-tap-to-move-and-page.md) |

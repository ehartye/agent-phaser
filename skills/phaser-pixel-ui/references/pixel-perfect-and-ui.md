# Pixel-perfect rendering and a pixel-only UI layer (Phaser 4.2.1)

For a game whose every visible pixel, including text and menus, must come from authored pixel assets. Keep one integer physical
footprint per authored source pixel in each resolution context, device pixels not CSS pixels, and no resampling. Component-local
units and camera zoom need not be integers. The existing native camera policy was verified on a real GPU at devicePixelRatio 1,
1.25, 1.5 and 3; that evidence does not establish mixed-density interactive controls.

Sections are numbered; the number is stable across the files below.

| Section | File |
|---|---|
| 1. One integer source-pixel footprint per context, chosen from device pixels | [pixel-perfect-footprint.md](pixel-perfect-footprint.md) |
| 2. Device pixels, not CSS pixels | [pixel-perfect-text-and-panels.md](pixel-perfect-text-and-panels.md) |
| 3. All text is `BitmapText` from the tool's own font export | [pixel-perfect-text-and-panels.md](pixel-perfect-text-and-panels.md) |
| 4. Panels are tiled, not stretched | [pixel-perfect-text-and-panels.md](pixel-perfect-text-and-panels.md) |
| 5. Text must fit, in three layers | [pixel-perfect-text-and-panels.md](pixel-perfect-text-and-panels.md) |
| 6. Input capture and the keyboard queue | [pixel-ui-input-and-controls.md](pixel-ui-input-and-controls.md) |
| 7. Accessible controls and native input without a second UI implementation | [pixel-ui-input-and-controls.md](pixel-ui-input-and-controls.md) |
| 8. Clipped scrolling in Phaser 4 WebGL | [pixel-ui-clipped-scrolling.md](pixel-ui-clipped-scrolling.md) |

Researched against 4.2.1 source, outside the numbered sections:

| Topic | File |
|---|---|
| Text, BitmapText, retro fonts, glyph lookup, wrapping | [text-and-bitmap-fonts.md](text-and-bitmap-fonts.md) |
| NineSlice tiling, Graphics and shapes, which objects stay pixel-exact | [panels-nine-slice-and-graphics.md](panels-nine-slice-and-graphics.md) |
| `DOMElement`, forms over the canvas, click-through and focus traps | [dom-overlays-and-forms.md](dom-overlays-and-forms.md) |
| Layout helpers, hit areas, spatial focus and menu navigation | [ui-layout-focus-and-navigation.md](ui-layout-focus-and-navigation.md) |

---
name: phaser-pixel-ui
description: Build pixel-exact UI on a Phaser 4.2.1 canvas - integer scale per layer, bitmap fonts and BitmapText, NineSlice and tiled panels, DOM overlays and forms, layout, focus and keyboard or controller menus, clipped scrolling panes and the accessibility bridge. Use when pixels look blurry or uneven, text drops glyphs or wraps wrong, a panel stretches, a DOM input fights the canvas, a menu cannot be reached from the keyboard, or a scrolling list leaks past its box. Not for gameplay input devices (phaser-input), the WebGL pipeline (phaser-rendering) or tilemap art (phaser-worlds).
---

# Phaser pixel-perfect UI

Pixel art survives only if every authored source pixel lands on whole physical pixels. Read the reference that matches the work.
Targets Phaser 4.2.1; version-sensitive claims carry the version or a probe name.

| You are about to | Read |
| --- | --- |
| Pick Text, BitmapText or DynamicBitmapText, load a retro font, wrap or align text, check which glyphs a font can draw | [text and bitmap fonts](references/text-and-bitmap-fonts.md) |
| Draw a panel, plate or divider with NineSlice, tiled pieces, Graphics or a rounded rectangle | [panels, NineSlice and Graphics](references/panels-nine-slice-and-graphics.md) |
| Put an input, button or long text over the canvas with `DOMElement` or a page overlay | [DOM overlays and forms](references/dom-overlays-and-forms.md) |
| Lay out a screen, size hit areas, or make a menu work from keyboard and controller | [layout, focus and navigation](references/ui-layout-focus-and-navigation.md) |
| Bind shared themed UI families, independent contexts or native mount ownership | [shared UI API](../phaser-architecture/references/shared-ui-api.md) |
| Make the canvas pixel-exact, choose the integer footprint, handle device pixels, tile panels, fit text | [pixel-perfect and UI](references/pixel-perfect-and-ui.md): [footprint](references/pixel-perfect-footprint.md), [text and panels](references/pixel-perfect-text-and-panels.md) |
| Clip a scrolling pane in WebGL | [clipped scrolling](references/pixel-ui-clipped-scrolling.md) |
| Capture input while a modal is open, or keep controls accessible next to a canvas UI | [input and controls](references/pixel-ui-input-and-controls.md) |

## Rules that earned their place

- [general] **A strict pixel-only UI** draws every UI and message pixel from agent-sprites bitmap fonts, skins and icons (no browser
  text, no Phaser `Text`; ban `Text` creation with a test). The UI layer may have a higher resolution than the gameplay layer;
  require whole physical pixels per authored source pixel in each context.
- [tested] **Fractional camera scales are valid** when the final footprint is whole device pixels: art scale 2 at zoom 3.5, 4.5 and 7.5 drew exact 7, 9 and 15 pixel blocks at device pixel ratios 1 and 1.5 (`source-pixels.mjs`, hardware lane).
- [general] **Fractional logical units are valid** on the same condition, with paint origins aligned.
- [tested] **A character that is not in the font is skipped**: no glyph, no advance, no `?`, so test the glyph repertoire of every
  string. `RetroFont.Parse` returns the cache entry (do not wrap it in `{ data }`), and `setMaxWidth` wraps at spaces only and ignores
  `letterSpacing` (`node examples/web/phaser-probes/phaser-pixel-ui-text.mjs <project>`).
- [tested] **A NineSlice with tiling is pixel-exact only at sizes the tiles divide** (width 24 on a 4 px centre, not 22): snap the
  size, or build the panel from tiled pieces (`phaser-pixel-ui-panels.mjs`).
- [tested] **Graphics edges are hard only on a context created with `pixelArt: true`**; the flag cannot be changed afterwards.
- [tested] **A DOM element over the canvas also presses the Phaser object under it**: call `stopPropagation()` for `mousedown`,
  `mouseup`, `touchstart`, `touchend` and `touchcancel` on the element (`phaser-input-pointer.mjs`).
- [tested] **A changing `BitmapText` keeps its first hit area, and a sized `Container` hit-tests from its centre.** Put a fixed `Zone`
  on each control and test targets by clicking centres.
- [general] **Keep accessible controls and native text entry** through the shared-model semantic bridge; a live region alone is not
  an interactive interface.

## Not covered here

Keyboard, pointer, controller and touch devices are [phaser-input](../phaser-input/SKILL.md). Frame cost of UI is
[phaser-verification](../phaser-verification/SKILL.md). The pure focus helper is
[spatial-focus.mjs](scripts/assets/spatial-focus.mjs), tested by `tests/phaser-pixel-ui-focus.test.mjs`.

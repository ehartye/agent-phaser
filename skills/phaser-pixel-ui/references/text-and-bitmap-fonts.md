# Text, BitmapText and bitmap fonts in Phaser 4.2.1

Which text object to use, how a bitmap font is loaded and measured, and the places where the numbers differ from what a pixel
UI expects. Reproduce the tested facts with `node examples/web/phaser-probes/phaser-pixel-ui-text.mjs <project>` (a font
generated on a canvas, Canvas renderer, no GPU). Phaser's overview is `node_modules/phaser/skills/text-and-bitmaptext/SKILL.md`;
the strict pixel-only rules are in [text and panels](pixel-perfect-text-and-panels.md).

## Choose the object

| Need | Use | Not when |
| --- | --- | --- |
| Score, timer, HUD, damage numbers, any string that changes often | `BitmapText` | the glyph set is open ended |
| Fixed pixel face, exact pixels | `BitmapText` from the tool's own font export | you need web fonts or strokes |
| Per-glyph motion (wave) or a scrolling text window | `DynamicBitmapText` | per-glyph tint only: `BitmapText` has `setCharacterTint` and `setWordTint` |
| CJK, Arabic, Thai, user-typed or translated long text | `Text` (canvas) or a DOM element | the face must be pixel-exact |
| Selectable, copyable or assistive-technology text | DOM, see [DOM overlays](dom-overlays-and-forms.md) | it must sit inside the canvas layers |

- [documented] `DynamicBitmapText` is still shipped in 4.2.1 and not marked deprecated; its display callback runs for every glyph
  every frame, its renderers ignore the drop shadow it inherits from `BitmapText`, and in WebGL its `cropWidth` and `cropHeight` clip with a scissor
  (`src/gameobjects/bitmaptext/dynamic/DynamicBitmapTextWebGLRenderer.js`). Check a crop with pixels before relying on it at
  camera zoom.
- [documented] `BitmapText#setDropShadow`, `setCharacterTint` and `setWordTint` need WebGL: the Canvas renderer draws glyphs without
  a tint (`src/gameobjects/bitmaptext/static/BitmapTextCanvasRenderer.js`). 4.0.0 fixed `BitmapText` tinting
  (`changelog/v4/4.0/MIGRATION-GUIDE.md`). A tone that is a different set of glyph frames is still a different font, not a tint.
- [documented] `BitmapText` has no right-to-left, shaping or fallback-font support (it places glyphs by code unit, left to right, and
  the source has no `rtl` option); `Text` has `style.rtl` and `setRTL`, which is applied while the canvas is built
  (`src/gameobjects/text/Text.js`). Use `Text` or DOM for Arabic, Hebrew and scripts that need joined forms.
- [documented] `Text` renders to a canvas texture and re-uploads it on every change. Its `style.resolution` defaults to 0, which
  the object forces to 1 (`src/gameobjects/text/Text.js`): at a UI camera zoom of `S` set `resolution: S` or the glyphs are
  upscaled and soft.

## Loading and the font entry

- [tested] `Phaser.GameObjects.RetroFont.Parse(scene, config)` returns the complete cache entry `{ data, frame, texture }`. Add it as
  is: `scene.cache.bitmapFont.add(key, RetroFont.Parse(scene, config))`. Phaser's bundled text skill shows
  `add(key, { data: RetroFont.Parse(...) })`; that double wrap makes `add.bitmapText` throw on `fontData.chars`.
- [documented] A loaded font (`load.bitmapFont(key, png, xml)`) puts the same entry in `cache.bitmapFont`; read glyph metrics from
  `cache.bitmapFont.get(key).data` (`size`, `lineHeight`, `chars[code]` with `xAdvance`, `xOffset`, `yOffset`, `kerning`).
- [tested] The draw scale is `fontSize / fontData.size`. A size-3 font drawn at `fontSize` 4 is scaled by 4/3 and its glyphs are
  uneven pixels. Create labels with the font's own size (omit the size argument) and scale only by whole numbers, or author a
  second face for a bigger title.

## Missing glyphs and measuring

- [tested] A character that is not in the font is skipped: `AB`, `AXB`, `A?B`, `A<tab>B` and `A<emoji>B` all measured 6 px, and
  only two glyphs were drawn. There is no fallback glyph, no `?` and no system-font substitute.
- [documented] Lookup is by UTF-16 code unit (`charCodeAt`), so an emoji or any astral character is two missing units, and text is
  not normalised (`src/gameobjects/bitmaptext/GetBitmapTextSize.js`). Normalise and substitute in your own rendering projection
  before the string reaches the object, and keep the original string for storage and search.
- [general] Test the repertoire: collect every string the game can show, map it through the projection, and require each code unit
  to exist in `data.chars`; list the strings that fail instead of eyeballing screens.
- [documented] `getTextBounds()` returns local and global rectangles, per-line lengths, words and characters with their `x`, `y`,
  `w`, `h`; it is cached until the text or scale changes. `width` and `height` are the scaled global size.

## Wrapping, alignment and spacing

- [tested] `setMaxWidth(px)` wraps at spaces only (the character code is its second argument) and compares scaled pixels: at scale 2 a
  maxWidth of 20 broke `AB AB` into two lines. A word wider than the limit is left on one line and overflows (a 10 glyph word
  measured 30 against a limit of 14).
- [tested] The wrap measure ignores `letterSpacing`: with spacing 2 and maxWidth 20, `AB AB` stayed on one line and measured 23.
  Wrap with your own measure when you use spacing, and for text without spaces (CJK) insert the breaks yourself.
- [tested] Centre alignment lands on half pixels: with lines of 6 and 3 px the short line started at x 1.5. Centre by drawing one
  `BitmapText` per line at an integer origin, or pad the strings so the line widths differ by an even number.
- [documented] Right alignment offsets a line by `longestLine - lineWidth`, so it stays on whole pixels while the advances are whole
  numbers; `lineSpacing` adds to `fontData.lineHeight` per line and `letterSpacing` adds to every advance
  (`src/gameobjects/bitmaptext/GetBitmapTextSize.js`).

## Clickable labels

- [tested] A `BitmapText` keeps the hit area it had at `setInteractive()` after `setText`; see
  [pointer and mouse](../../phaser-input/references/pointer-and-mouse.md) for the fix. Do not make a changing label its own button:
  put a fixed-size `Zone` or panel behind it.

## Verify

- [general] Assert measured width against the container for every string and width in a unit test, then check the rendered
  pixels once per screen ([text and panels](pixel-perfect-text-and-panels.md) describes the three layers).
- [tested] The probe asserts the 4.2.1 numbers above; when it fails after an upgrade the changed sentence needs a new stamp.

## Links

[footprint](pixel-perfect-footprint.md), [panels and graphics](panels-nine-slice-and-graphics.md), [input and controls](pixel-ui-input-and-controls.md).

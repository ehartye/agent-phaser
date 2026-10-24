// Purpose: check the Phaser 4.2.1 BitmapText facts that the phaser-pixel-ui skill documents, with a retro font generated on a
// canvas (no assets, Canvas renderer, no GPU):
//   - RetroFont.Parse returns the cache entry itself; wrapping it in { data: ... } (as Phaser's bundled text skill does)
//     makes bitmapText() throw;
//   - a character that is not in the font is skipped: no glyph, no advance, no fallback glyph (so no "?" either);
//   - setMaxWidth wraps at spaces only, measures in scaled pixels, ignores letterSpacing, and lets an unbroken word overflow;
//   - centre alignment can put a line on a half pixel.
//
// Run:    node phaser-pixel-ui-text.mjs /absolute/path/to/project-with-phaser-and-playwright
//         (the project needs `phaser` and one of `playwright-core`, `playwright` or `@playwright/test`; any Chromium works).
// Expect: exit code 0 and a JSON object; the asserts pin the 4.2.1 behaviour.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const project = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(project, 'package.json'));
const pw = ['@playwright/test', 'playwright', 'playwright-core'].map((name) => { try { return require(name); } catch { return null; } }).find(Boolean);
assert.ok(pw, 'install @playwright/test, playwright or playwright-core in the project');
const browser = await pw.chromium.launch({ channel: process.env.CHROME_CHANNEL || undefined, timeout: 20000 });
let out;
try {
  const page = await (await browser.newContext({ viewport: { width: 200, height: 160 } })).newPage();
  page.setDefaultTimeout(15000);
  await page.setContent('<!doctype html><body style="margin:0"><div id="game"></div></body>');
  await page.addScriptTag({ path: require.resolve('phaser') });
  out = await page.evaluate(async () => {
    const scenes = {};
    class Main extends Phaser.Scene {
      constructor() { super('Main'); }
      create() { scenes.main = this; }
    }
    const game = new Phaser.Game({ type: Phaser.CANVAS, width: 100, height: 100, parent: 'game', audio: { noAudio: true }, scene: [Main] });
    await new Promise((r) => { const t = setInterval(() => { if (scenes.main) { clearInterval(t); r(); } }, 20); });
    const scene = scenes.main, r = { version: Phaser.VERSION };

    // A 4-glyph strip, 3x5 px per glyph: A B space C.
    const strip = scene.textures.createCanvas('strip', 12, 5);
    const context = strip.getContext(); context.fillStyle = '#fff'; context.fillRect(0, 0, 12, 5); strip.refresh();
    const config = { image: 'strip', width: 3, height: 5, chars: 'AB C', charsPerRow: 4 };
    const entry = Phaser.GameObjects.RetroFont.Parse(scene, config);
    r.parseReturns = Object.keys(entry).sort();
    scene.cache.bitmapFont.add('wrapped', { data: entry });
    try { scene.add.bitmapText(0, 0, 'wrapped', 'AB', 3); r.wrappedEntryThrows = false; } catch (error) { r.wrappedEntryThrows = true; r.wrappedEntryError = error.constructor.name; }
    scene.cache.bitmapFont.add('font', entry);
    const make = (text, size = 3) => scene.add.bitmapText(0, 0, 'font', text, size);

    // Missing characters: X, ?, a tab, an emoji (two UTF-16 code units).
    r.width = { AB: make('AB').width, AXB: make('AXB').width, AqB: make('A?B').width, tab: make('A\tB').width, emoji: make('A\u{1F600}B').width };
    r.glyphsDrawn = make('A?B').getTextBounds().characters.length;

    // Wrapping.
    const wrapped = (text, setup) => { const t = make(text); setup(t); return { text: t.getTextBounds().wrappedText, width: t.width }; };
    r.wrapSpaces = wrapped('AB AB AB', (t) => t.setMaxWidth(14));
    r.wrapIgnoresLetterSpacing = wrapped('AB AB', (t) => { t.setLetterSpacing(2); t.setMaxWidth(20); });
    r.wrapUsesScaledPixels = wrapped('AB AB', (t) => { t.setScale(2); t.setMaxWidth(20); });
    r.unbrokenWordOverflows = wrapped('ABABABABAB', (t) => t.setMaxWidth(14));

    // Centre alignment on a half pixel: 'AB' is 6 px, 'A' is 3 px.
    const centred = make('AB\nA'); centred.setCenterAlign();
    r.centreAlignX = centred.getTextBounds().characters.map((c) => c.x);

    // Scale is fontSize / font size.
    r.fontSizeRatio = { fontDataSize: scene.cache.bitmapFont.get('font').data.size, widthAtSize4: make('AB', 4).width };
    return r;
  });
} finally {
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
assert.deepEqual(out.parseReturns, ['data', 'frame', 'texture']);
assert.equal(out.wrappedEntryThrows, true, 'a double-wrapped RetroFont entry must fail');
assert.deepEqual(out.width, { AB: 6, AXB: 6, AqB: 6, tab: 6, emoji: 6 }, 'missing characters add no advance');
assert.equal(out.glyphsDrawn, 2, 'missing characters draw nothing');
assert.equal(out.wrapSpaces.text, 'AB\nAB\nAB');
assert.equal(out.wrapIgnoresLetterSpacing.text, 'AB AB', 'letterSpacing is not part of the wrap measure');
assert.ok(out.wrapIgnoresLetterSpacing.width > 20, 'so the line is wider than maxWidth');
assert.equal(out.wrapUsesScaledPixels.text, 'AB\nAB', 'maxWidth is compared with scaled pixels');
assert.equal(out.unbrokenWordOverflows.text, 'ABABABABAB');
assert.ok(out.unbrokenWordOverflows.width > 14);
assert.deepEqual(out.centreAlignX, [0, 3, 1.5], 'centre alignment lands on a half pixel');
assert.equal(out.fontSizeRatio.widthAtSize4, 8, 'fontSize 4 on a size-3 font scales by 4/3');

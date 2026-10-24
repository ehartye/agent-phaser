import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// The "Find the hits" block of skills/engine-phaser/references/v3-to-v4-migration.md is the list an agent runs over an old codebase.
// This test parses that block and proves each pattern on sample lines, so the checklist cannot drift or break unnoticed.
const text = (await readFile(new URL('../skills/engine-phaser/references/v3-to-v4-migration.md', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const block = text.match(/```text\n([\s\S]*?)\n```/)?.[1] ?? '';
const patterns = Object.fromEntries(block.split('\n').filter(Boolean).map(line => {
  const [, label, kind, source] = /^(\w+)\s+(break|review)\s+(.+)$/.exec(line) ?? assert.fail(`unparsable line: ${line}`);
  return [label, {kind, re: new RegExp(source)}];
}));

// Phaser 3 lines, each of which the named pattern must find.
const v3 = {
  pipeline: ["sprite.setPipeline('Light2D');", 'this.add.sprite(0, 0, "a").setPostPipeline("Outline");', 'new Phaser.Game({ pipeline: { Custom: CustomPipeline } });', "this.lights.enable(); // Light2D"],
  fx: ['sprite.postFX.addGlow(0xffffff);', 'this.cameras.main.preFX.addVignette();'],
  masks: ['const mask = new Phaser.Display.Masks.BitmapMask(this, shape);', 'sprite.setMask(mask);', 'const m = shape.createBitmapMask();', 'graphics.createGeometryMask()'],
  tintfill: ['sprite.setTintFill(0xff0000);', 'if (sprite.tintFill) {}'],
  point: ['const p = new Phaser.Geom.Point(1, 2);', 'Phaser.Geom.Point.Clone(p)'],
  mathconst: ['const full = Phaser.Math.PI2;', 'const s = new Phaser.Structs.Set();'],
  removed: ['this.add.mesh(0, 0, "key");', 'this.add.plane(0, 0, "key");', 'new Phaser.GameObjects.Mesh(scene);', 'this.load.obj("m", "m.obj");', 'this.textures.generate("t", { data: [], pixelWidth: 1 });', 'Phaser.Create.GenerateTexture(cfg);', 'plugins/camera3d/Camera3D', '<script src="phaser-ie9.js">'],
  spine: ['const boy = this.add.spine(0, 0, "boy");', 'class A extends SpineGameObject {}', "this.load.scenePlugin('SpinePlugin', 'plugins/spine.js', 'SpinePlugin', 'spine');"],
  rtdraw: ['const rt = this.add.renderTexture(0, 0, 64, 64);', 'new Phaser.GameObjects.RenderTexture(scene, 0, 0, 8, 8)', 'const dt = this.textures.addDynamicTexture("d", 8, 8); // DynamicTexture'],
  tau: ['const quarter = Phaser.Math.TAU;'],
  shader: ['this.add.shader("fire", 0, 0, 800, 600);', 'new Phaser.GameObjects.Shader(scene, "k")', 'uniform vec2 iResolution;', 'shader.setUniform("uTime", t);'],
  camera: ['const m = camera.matrix;', 'GetCalcMatrix(src, camera)', 'matrix.setQuad(0, 0, 1, 1);'],
  renderer: ['type: Phaser.AUTO,', 'type: Phaser.CANVAS', 'roundPixels: true', 'pixelArt: true'],
  compress: ["this.load.texture('a', { ASTC: 'a.pvr', IMG: 'a.png' });", '// compressed textures'],
};
// Phaser 4 lines that no `break` pattern may flag.
const v4 = [
  'sprite.setTint(0xff0000).setTintMode(Phaser.TintModes.FILL);',
  'sprite.setLighting(true);',
  'sprite.enableFilters(); sprite.filters.internal.addGlow({ color: 0xffffff });',
  'sprite.filters.internal.addMask(shape);',
  'const v = new Phaser.Math.Vector2(1, 2);',
  'const full = Phaser.Math.TAU, quarter = Phaser.Math.PI_OVER_2;',
  'const set = new Set(); const map = new Map();',
  'new Phaser.Game({ type: Phaser.WEBGL, render: { smoothPixelArt: true } });',
  'this.add.mesh2d(0, 0, "key");',
  'graphics.generateTexture("t", 8, 8);',
  'this.textures.createCanvas("c", 8, 8);',
];

test('every label in the pattern block is explained in the table below it, and nothing else is', () => {
  const tableLabels = [...text.matchAll(/^\| ([a-z]+(?:, [a-z]+)*) \| /gm)].flatMap(m => m[1].split(', '));
  assert.deepEqual([...new Set(tableLabels)].sort(), Object.keys(patterns).sort());
  assert.deepEqual(Object.keys(v3).sort(), Object.keys(patterns).sort());
});

for (const [label, lines] of Object.entries(v3)) {
  test(`pattern "${label}" finds Phaser 3 code`, () => {
    for (const line of lines) assert.match(line, patterns[label].re, line);
  });
}

test('no break pattern flags Phaser 4 code', () => {
  for (const [label, {kind, re}] of Object.entries(patterns)) {
    if (kind !== 'break') continue;
    for (const line of v4) assert.doesNotMatch(line, re, `${label}: ${line}`);
  }
});

test('break patterns are the ones that fail or do nothing; review patterns are only flagged for a look', () => {
  assert.deepEqual(Object.entries(patterns).filter(([, p]) => p.kind === 'review').map(([label]) => label).sort(), ['camera', 'compress', 'renderer', 'rtdraw', 'shader', 'spine', 'tau']);
});

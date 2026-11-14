// Proves the texture-memory counters: the in-page sum over game.textures.list, the PNG header reader, the folder sum and its
// command line. The files are real PNGs built here, so the test also shows the point: a small file is a large texture.
// Run: node --test tests/phaser-texture-memory.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MIB, checkTextureBudget, formatMiB, main, measureFolder, measureTextures, pngSize } from '../skills/phaser-verification/scripts/assets/texture-memory.mjs';

const script = fileURLToPath(new URL('../skills/phaser-verification/scripts/assets/texture-memory.mjs', import.meta.url));

// CRC-32 as PNG chunks use it (zlib.crc32 is newer than the oldest Node this repo supports).
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A valid, fully transparent RGBA PNG of the given size. */
function flatPng(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));   // filter byte 0 and zeroed pixels per row
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), 'phaser-texture-memory-'));
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), bytes);
  }
  return dir;
}

const fakeGame = (list) => ({ textures: { list } });
const source = (width, height) => ({ width, height });

test('a texture costs width x height x 4, summed over every source of every key', () => {
  const report = measureTextures(fakeGame({
    __DEFAULT: { source: [source(32, 32)] },
    sheet: { source: [source(2048, 1024)] },
    pages: { source: [source(1024, 1024), source(512, 512)] },
  }));
  assert.equal(report.bytes, 32 * 32 * 4 + 2048 * 1024 * 4 + 1024 * 1024 * 4 + 512 * 512 * 4);
  assert.equal(report.count, 3);
  assert.equal(report.sources, 4);
  assert.deepEqual(report.largest[0], { key: 'sheet', width: 2048, height: 1024, bytes: 8 * MIB });
  assert.deepEqual(report.textures.map((t) => t.key), ['sheet', 'pages', '__DEFAULT']);
  assert.deepEqual(report.textures[1], { key: 'pages', width: 1024, height: 1024, bytes: 5 * MIB }, 'a multi-page texture is the sum of its pages');
});

test('the in-page function is self-contained: its source alone evaluates and gives the same sum', () => {
  const game = fakeGame({ a: { source: [source(100, 50)] }, b: { source: [] }, c: {} });
  const evaluated = new Function(`return (${measureTextures})(arguments[0], 1)`)(game);
  assert.equal(evaluated.bytes, 20000);
  assert.equal(evaluated.largest.length, 1);
  assert.equal(evaluated.count, 3, 'a key with no source is listed at zero bytes, not dropped');
});

test('something that is not a game is refused', () => {
  assert.throws(() => measureTextures({}), /game\.textures\.list is missing/);
  assert.throws(() => measureTextures(null), TypeError);
});

test('the budget check passes at the budget, fails one byte over and names the largest texture', () => {
  const report = measureTextures(fakeGame({ big: { source: [source(1024, 1024)] }, small: { source: [source(16, 16)] } }));
  assert.equal(checkTextureBudget(report, report.bytes).ok, true);
  const over = checkTextureBudget(report, report.bytes - 1);
  assert.equal(over.ok, false);
  assert.equal(over.overBytes, 1);
  assert.match(over.message, /\(over\); largest big 1024x1024 = 4\.0 MiB/);
  assert.throws(() => checkTextureBudget(report, 0), RangeError);
  assert.throws(() => checkTextureBudget({}, 1), TypeError);
  assert.equal(formatMiB(1.5 * MIB), '1.5 MiB');
});

test('pngSize reads the IHDR width and height from bytes 16 to 23', () => {
  const png = flatPng(2048, 1536);
  assert.deepEqual(pngSize(png), { width: 2048, height: 1536 });
  assert.deepEqual(pngSize(png.subarray(0, 24)), { width: 2048, height: 1536 }, 'the first 24 bytes are enough');
  assert.deepEqual([...png.subarray(16, 24)], [0, 0, 8, 0, 0, 0, 6, 0]);
});

test('pngSize refuses bytes that are not a PNG', () => {
  assert.throws(() => pngSize(new Uint8Array(23)), /first 24 bytes/);
  assert.throws(() => pngSize(new Uint8Array(64)), /signature/);
  const noHeader = Buffer.from(flatPng(4, 4)); noHeader.write('tEXt', 12, 'latin1');
  assert.throws(() => pngSize(noHeader), /IHDR/);
  assert.throws(() => pngSize('not bytes'), TypeError);
});

test('a small file is a large texture: a folder of flat PNGs sums by pixels, not by file size', () => {
  const dir = folder({ 'a.png': flatPng(1024, 1024), 'creatures/b.PNG': flatPng(512, 256), 'creatures/notes.txt': 'x', 'node_modules/dep/c.png': flatPng(4096, 4096) });
  try {
    const report = measureFolder(dir);
    assert.equal(report.count, 2, 'subfolders are read, node_modules is not, other files are ignored');
    assert.equal(report.bytes, 1024 * 1024 * 4 + 512 * 256 * 4);
    assert.deepEqual(report.files.map((f) => f.file), ['a.png', 'creatures/b.PNG']);
    assert.ok(report.fileBytes * 100 < report.bytes, `the files weigh ${report.fileBytes} bytes and the textures ${report.bytes}`);
    assert.deepEqual(report.unreadable, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a file named .png that is not one is reported, not counted and not fatal', () => {
  const dir = folder({ 'ok.png': flatPng(8, 8), 'broken.png': 'this is text, longer than twenty-four bytes' });
  try {
    const report = measureFolder(dir);
    assert.equal(report.count, 1);
    assert.equal(report.unreadable.length, 1);
    assert.equal(report.unreadable[0].file, 'broken.png');
    assert.equal(main([dir], { log() {}, error() {} }), 1, 'an unreadable PNG fails the run');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the command line prints the sum and the largest files, and its exit code follows the budget', () => {
  const dir = folder({ 'big.png': flatPng(1024, 1024), 'small.png': flatPng(64, 64) });
  try {
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    const plain = run(dir);
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /2 PNG file\(s\), .* on disk, 4\.0 MiB as textures if all are loaded at once/);
    assert.match(plain.stdout, /4\.0 MiB {2}1024x1024 {2}big\.png/);
    const under = run(dir, '--budget-mb', '5');
    assert.equal(under.status, 0);
    assert.match(under.stdout, /^ok: /m);
    const over = run(dir, '--budget-mb=4', '--top', '1');
    assert.equal(over.status, 1);
    assert.match(over.stdout, /^FAILED: 4\.0 MiB of textures against a budget of 4\.0 MiB \(over\); largest big\.png 1024x1024/m);
    assert.doesNotMatch(over.stdout, /small\.png/);
    const asJson = JSON.parse(run(dir, '--json', '--budget-mb', '1').stdout);
    assert.equal(asJson.bytes, 1024 * 1024 * 4 + 64 * 64 * 4);
    assert.equal(asJson.budget.ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('usage errors exit 2 and name the problem', () => {
  const lines = [];
  const out = { log: (text) => lines.push(text), error: (text) => lines.push(text) };
  assert.equal(main([], out), 2);
  assert.equal(main(['x', '--budget-mb', '0'], out), 2);
  assert.equal(main(['x', '--nope'], out), 2);
  assert.equal(main(['x', 'y'], out), 2);
  assert.equal(main([join(tmpdir(), 'phaser-texture-memory-no-such-folder')], out), 2);
  assert.equal(main(['--help'], out), 0);
  assert.match(lines.join('\n'), /name a folder[\s\S]*positive number[\s\S]*unknown option --nope[\s\S]*unexpected argument y/);
});

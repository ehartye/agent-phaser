// The install-time Phaser patches carry their pin and their removal condition: each one refuses any Phaser version except 4.2.1, changes nothing when it
// refuses, and its header says when to remove it. The skills state this ("version-pinned patches carry a removal condition"), so a patch added later
// without a pin fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const patches = ['phaser-rendering', 'phaser-audio'].flatMap(skill => {
  const dir = join(root, 'skills', skill, 'scripts', 'assets');
  return readdirSync(dir).filter(name => /-patch\.mjs$/.test(name)).map(name => join(dir, name));
});

test('every install-time patch is found (a new one is covered the day it is added)', () => {
  assert.ok(patches.length >= 5, `found ${patches.length}`);
});

test('each patch header names Phaser 4.2.1 and when to remove it', () => {
  for (const file of patches) {
    const header = readFileSync(file, 'utf8').split('\n').filter(line => line.startsWith('//')).join(' ');
    assert.match(header, /Phaser 4\.2\.1/, file);
    assert.match(header, /Remove (?:only )?(?:after|when)\b[^.]*upstream/i, `${file} says what makes it unnecessary`);
  }
});

test('each patch refuses every Phaser version but 4.2.1 and leaves the install as it was', () => {
  for (const version of ['4.2.0', '4.2.2', '4.3.0', '5.0.0', '3.90.0']) {
    const dir = mkdtempSync(join(tmpdir(), 'phaser-patch-pin-'));
    try {
      const manifest = JSON.stringify({ name: 'phaser', version });
      writeFileSync(join(dir, 'package.json'), manifest);
      for (const file of patches) {
        let failure = null;
        try { execFileSync(process.execPath, [file, dir], { stdio: 'pipe' }); } catch (error) { failure = error; }
        assert.ok(failure, `${file} accepted phaser@${version}`);
        assert.equal(failure.status, 1, `${file} exit code for phaser@${version}`);
        assert.match(String(failure.stderr), /requires exactly phaser@4\.2\.1/, `${file} says which version it needs`);
      }
      assert.deepEqual(readdirSync(dir), ['package.json'], `a refusal for phaser@${version} wrote nothing`);
      assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), manifest);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a package that is not phaser is refused too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'phaser-patch-pin-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'not-phaser', version: '4.2.1' }));
    for (const file of patches) assert.throws(() => execFileSync(process.execPath, [file, dir], { stdio: 'pipe' }), /requires exactly phaser@4\.2\.1/, file);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

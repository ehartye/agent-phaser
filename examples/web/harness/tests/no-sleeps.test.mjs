// A guard, run by `node --test` (no browser): the specs contain no fixed sleeps. `waitForTimeout` is a bet about the speed of the machine
// you happen to be on; it flaked when a larger atlas slowed the first boot and it hides the thing being waited for inside a number. The one
// honest exception is a performance sample, which is a window of real time by definition: list that file in ALLOWED and keep the list short.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ALLOWED = new Set([]);                           // e.g. 'perf.spec.mjs'
const files = readdirSync(DIR).filter((f) => /\.mjs$/.test(f) && f !== 'no-sleeps.test.mjs');

/** Line numbers that sleep: a fixed Playwright wait, or an in-page timer promise (use requestAnimationFrame loops there). */
export function sleeps(source) {
  return source.split('\n').flatMap((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return [];
    return /\.waitForTimeout\(|new Promise\(\(?\w*\)? => setTimeout\(\w+, *[1-9]/.test(line) ? [i + 1] : [];
  });
}

test('finds the specs it is meant to guard', () => {
  assert.ok(files.length >= 3, `found ${files.join(', ')}`);
});

test('no spec or helper uses a fixed sleep', () => {
  const hits = files.filter((f) => !ALLOWED.has(f)).flatMap((f) => sleeps(readFileSync(join(DIR, f), 'utf8')).map((n) => `${f}:${n}`));
  assert.deepEqual(hits, [], 'use until / settle / elapsed / framesUntil from tests/wait.mjs');
});

test('the guard can fail (it flags a sleep and ignores a comment)', () => {
  assert.deepEqual(sleeps('await page.waitForTimeout(600);'), [1]);
  assert.deepEqual(sleeps('// page.waitForTimeout(600)'), []);
  assert.deepEqual(sleeps('await new Promise((r) => setTimeout(r, 500));'), [1]);
});

// A guard, run by `node --test` (no browser): the gate-script helper hands every argument to Node exactly as written. Arguments with spaces,
// quotes, parentheses, braces and angle brackets are the ones a `shell: true` spawn mangles on Windows (see ../run-node.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNode } from '../run-node.mjs';

test('arguments with shell metacharacters arrive unchanged', async () => {
  const awkward = `(a) {b} > "c" 'd' & e`;
  const { code, out } = await runNode(['-e', 'process.stdout.write(process.argv[1])', awkward], { stdio: ['ignore', 'pipe', 'inherit'] });
  assert.equal(code, 0);
  assert.equal(out, awkward);
});

test('the child exit code is reported', async () => {
  const { code } = await runNode(['-e', 'process.exit(3)']);
  assert.equal(code, 3);
});

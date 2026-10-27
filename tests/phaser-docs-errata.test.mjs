// The errata tables for Phaser's own documents stay well formed: every row names a Phaser file and an exact needle, cites evidence that exists
// here, and points to a fix that resolves. This cannot see an upstream change; examples/web/phaser-probes/phaser-docs-errata.mjs checks each
// needle against an installed Phaser after an upgrade.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {errataFiles, readRows, root} from '../examples/web/phaser-probes/errata-rows.mjs';

const rows = readRows();
const probes = join(root, 'examples', 'web', 'phaser-probes');

test('both errata pages carry rows', () => {
  assert.equal(errataFiles.every(existsSync), true);
  assert.ok(rows.length >= 15, `found ${rows.length} rows`);
  for (const path of errataFiles) assert.ok(rows.some(r => r.source === path), path);
});

test('every row has a Phaser file, a needle, a behaviour, evidence and a fix', () => {
  for (const r of rows) {
    const at = `${r.source}:${r.line}`;
    assert.equal(r.cells, 5, `${at} has ${r.cells} cells (a needle or cell containing " | " breaks the table)`);
    assert.match(r.file ?? '', /^skills\/[a-z0-9-]+\/SKILL\.md$/, at);
    assert.ok((r.needle ?? '').length >= 8, `${at} needle is missing or too short to be exact`);
    assert.ok(r.does.length > 20, at);
    assert.match(r.evidence, /^\[(tested|documented)\] /, `${at} evidence needs a label`);
    assert.equal(rows.filter(o => o.file === r.file && o.needle === r.needle).length, 1, `${at} duplicates another row`);
  }
});

test('a tested row names a probe file and check that exist in this repository', () => {
  for (const r of rows.filter(r => r.evidence.startsWith('[tested]'))) {
    const at = `${r.source}:${r.line}`;
    const probe = (r.evidence.match(/`([a-z0-9-]+\.mjs)`/) ?? [])[1];
    assert.ok(probe && existsSync(join(probes, probe)), `${at} cites no probe file that exists`);
    const id = (r.evidence.match(/\(`([a-z0-9.-]+)`\)/) ?? [])[1];
    if (id) assert.ok(readFileSync(join(probes, probe), 'utf8').includes(id), `${at} check id ${id} is not in ${probe}`);
  }
});

test('the fix column is "this table" or a link that resolves', () => {
  for (const r of rows) {
    const at = `${r.source}:${r.line}`;
    if (r.fix === 'this table') continue;
    const link = (r.fix.match(/^\[[^\]]+\]\(([^)]+)\)$/) ?? [])[1];
    assert.ok(link, `${at} fix is neither "this table" nor one link`);
    assert.ok(existsSync(resolve(dirname(r.source), link)), `${at} link ${link} does not resolve`);
  }
});

test('the engine-phaser skill sends the reader to both pages', () => {
  const skill = readFileSync(join(root, 'skills', 'engine-phaser', 'SKILL.md'), 'utf8');
  for (const name of ['phaser-docs-errata-names.md', 'phaser-docs-errata-behaviour.md']) assert.ok(skill.includes(`references/${name}`), name);
});

test('the reader sees a row with a pipe in its needle as malformed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'errata-'));
  try {
    const file = join(dir, 'errata.md');
    writeFileSync(file, ['| `skills/x/SKILL.md` | `a | b` | does | [tested] `p.mjs` | this table |', '| not a row |', ''].join('\n'));
    const [row, ...rest] = readRows([file]);
    assert.equal(rest.length, 0);
    assert.notEqual(row.cells, 5);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

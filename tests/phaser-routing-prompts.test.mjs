// The routing prompts and their answer key stay honest: every expected skill exists, ids are unique, the Phaser skills and their near-miss neighbours are all covered,
// and a prompt that carries a `term` still finds that term in its expected skill's description, so an edited description cannot lose its trigger unnoticed.
// The blind-router scoring itself needs a model and is run by hand (see the fixture's `about`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { prompts } = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'phaser-routing-prompts.json'), 'utf8'));
const skills = readdirSync(join(root, 'skills')).filter(d => existsSync(join(root, 'skills', d, 'SKILL.md')));
const description = name => (readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8').match(/^description:\s*(.*)$/m) ?? [])[1] ?? '';

test('every prompt has a text, a unique id and an expected skill that exists', () => {
  assert.ok(prompts.length >= 40, `found ${prompts.length}`);
  assert.equal(new Set(prompts.map(p => p.id)).size, prompts.length, 'ids are unique');
  for (const p of prompts) {
    assert.ok(typeof p.text === 'string' && p.text.length > 15, `prompt ${p.id} has no text`);
    assert.ok(skills.includes(p.expect), `prompt ${p.id} expects ${p.expect}, which is not a skill`);
    for (const alt of p.alt ?? []) assert.ok(skills.includes(alt), `prompt ${p.id} alt ${alt} is not a skill`);
    assert.ok(!(p.alt ?? []).includes(p.expect), `prompt ${p.id} lists its own answer as an alternate`);
  }
});

test('every Phaser skill and each neighbouring engine skill is the answer to at least one prompt', () => {
  const answered = new Set(prompts.map(p => p.expect));
  for (const name of skills.filter(s => /^(phaser-|engine-)/.test(s) && s !== 'engine-visual-polish')) assert.ok(answered.has(name), `no prompt expects ${name}`);
});

test('a prompt with a term finds it in the expected skill description', () => {
  const withTerm = prompts.filter(p => p.term);
  assert.ok(withTerm.length >= 10, 'the edited descriptions are guarded');
  for (const p of withTerm) assert.match(description(p.expect), new RegExp(p.term, 'i'), `prompt ${p.id}: ${p.expect} no longer mentions /${p.term}/`);
});

test('the guard fails when a description loses its term (the check is not vacuous)', () => {
  const p = prompts.find(q => q.term === 'scene\\.transition');
  assert.ok(p && description(p.expect).includes('scene.transition'));
  assert.doesNotMatch(description(p.expect).replaceAll('scene.transition', ''), new RegExp(p.term, 'i'));
});

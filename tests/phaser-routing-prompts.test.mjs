// The routing prompts and their answer key stay honest: every expected skill exists, ids are unique, the Phaser skills and their near-miss neighbours are all covered,
// and a prompt that carries a `term` still finds that term in its expected skill's description, so an edited description cannot lose its trigger unnoticed.
// A prompt whose answer belongs to another plugin is marked `external` (an `alt` outside this plugin is written `plugin:skill`); the name is checked against
// scripts/sibling-skills.json, so the test runs without the sibling plugin installed.
// The blind-router scoring itself needs a model and is run by hand (see the fixture's `about`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { prompts } = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'phaser-routing-prompts.json'), 'utf8'));
const siblings = JSON.parse(readFileSync(join(root, 'scripts', 'sibling-skills.json'), 'utf8'));
const skills = readdirSync(join(root, 'skills')).filter(d => existsSync(join(root, 'skills', d, 'SKILL.md')));
// A local skill name, or `plugin:skill` for a skill the snapshot lists under a sibling plugin.
const isSkill = name => { const [plugin, skill] = name.includes(':') ? name.split(':') : [null, name]; return plugin ? (siblings[plugin] ?? []).includes(skill) : skills.includes(skill); };
const description = name => (readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8').match(/^description:\s*(.*)$/m) ?? [])[1] ?? '';

test('every prompt has a text, a unique id and an expected skill that exists', () => {
  assert.ok(prompts.length >= 40, `found ${prompts.length}`);
  assert.equal(new Set(prompts.map(p => p.id)).size, prompts.length, 'ids are unique');
  for (const p of prompts) {
    assert.ok(typeof p.text === 'string' && p.text.length > 15, `prompt ${p.id} has no text`);
    if (p.external) assert.ok((siblings[p.external] ?? []).includes(p.expect), `prompt ${p.id} expects ${p.expect}, which ${p.external} does not list in scripts/sibling-skills.json`);
    else assert.ok(skills.includes(p.expect), `prompt ${p.id} expects ${p.expect}, which is not a skill`);
    for (const alt of p.alt ?? []) assert.ok(isSkill(alt), `prompt ${p.id} alt ${alt} is not a skill`);
    assert.ok(!(p.alt ?? []).includes(p.expect), `prompt ${p.id} lists its own answer as an alternate`);
  }
});

test('an external prompt names a sibling plugin, and a Phaser prompt names none', () => {
  assert.ok(prompts.some(p => p.external), 'the prompts that belong to agent-engine are kept');
  for (const p of prompts) {
    if (p.external) assert.ok(p.external !== 'agent-phaser' && siblings[p.external], `prompt ${p.id}: external ${p.external} is not a sibling plugin`);
    assert.ok(!p.expect.includes(':'), `prompt ${p.id}: write an external answer as the skill name plus an external plugin`);
  }
});

test('every Phaser skill and each neighbouring engine skill is the answer to at least one prompt', () => {
  const answered = new Set(prompts.map(p => p.expect));
  for (const name of skills.filter(s => /^(phaser-|engine-)/.test(s) && s !== 'engine-visual-polish')) assert.ok(answered.has(name), `no prompt expects ${name}`);
});

test('a prompt with a term finds it in the expected skill description', () => {
  const withTerm = prompts.filter(p => p.term && !p.external);
  assert.ok(withTerm.length >= 10, 'the edited descriptions are guarded');
  for (const p of withTerm) assert.match(description(p.expect), new RegExp(p.term, 'i'), `prompt ${p.id}: ${p.expect} no longer mentions /${p.term}/`);
});

test('the guard fails when a description loses its term (the check is not vacuous)', () => {
  const p = prompts.find(q => q.term === 'scene\\.transition');
  assert.ok(p && description(p.expect).includes('scene.transition'));
  assert.doesNotMatch(description(p.expect).replaceAll('scene.transition', ''), new RegExp(p.term, 'i'));
});

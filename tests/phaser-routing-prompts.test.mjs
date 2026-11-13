// The routing prompts and their answer key stay honest: every expected skill exists, ids are unique, the Phaser skills and their near-miss neighbours are all covered,
// and a prompt that carries a `term` still finds that term in its expected skill's description, so an edited description cannot lose its trigger unnoticed.
// A prompt whose answer belongs to another plugin is marked `external` (an `alt` outside this plugin is written `plugin:skill`); the name is checked against
// scripts/sibling-skills.json, so the test runs without the sibling plugin installed.
// Outcome-language cases are requests that name only the result wanted; each guards the description phrase that should catch it.
// The blind-router scoring itself needs a model and is run by hand (see the fixture's `about`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'phaser-routing-prompts.json'), 'utf8'));
const { prompts } = fixture;
const coverage = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'phaser-feature-coverage.json'), 'utf8'));
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

// These checks protect portable crosswalk/answer-key integrity. Populated fields,
// reachable files and named technologies do not establish semantic completeness,
// live host activation or usefulness; those require independent manual acceptance.
test('family ledger links real reference sections to known owners and routing cases', () => {
  assert.equal(coverage.phaserVersion, '4.2.1');
  const families = coverage.families;
  assert.ok(Array.isArray(families) && families.length > 0);
  assert.equal(new Set(families.map(f => f.id)).size, families.length);
  const represented = new Set();
  for (const f of families) {
    assert.match(f.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(skills.includes(f.primarySkill), f.id);
    for (const secondary of f.secondarySkills) assert.ok(isSkill(secondary), f.id);
    assert.ok(['native', 'workflow'].includes(f.classification), f.id);
    if (f.classification === 'workflow') assert.equal(f.nativeFacility, null, f.id);
    else assert.ok(typeof f.nativeFacility === 'string' && f.nativeFacility.length, f.id);
    assert.ok(f.aliases.length > 0 && f.aliases.every(a => typeof a === 'string' && a.trim()), f.id);
    assert.ok(f.extensionSeam && f.customWorkConditions, f.id);
    assert.ok(f.references.length > 0, f.id);
    for (const ref of f.references) {
      assert.match(ref.path, /^skills\/[a-z-]+\/references\/[a-z0-9-]+\.md$/, f.id);
      assert.ok(existsSync(join(root, ref.path)), `${f.id}: ${ref.path}`);
      const headings = readFileSync(join(root, ref.path), 'utf8').split(/\r?\n/)
        .filter(line => /^#{1,6} /.test(line)).map(line => line.replace(/^#{1,6} /, '').trim());
      assert.ok(headings.includes(ref.section), `${f.id}: missing section ${ref.section}`);
      represented.add(ref.path);
    }
    assert.ok(f.sourceAnchors.length > 0, f.id);
    for (const source of f.sourceAnchors) {
      const url = new URL(source.url);
      assert.equal(url.origin, 'https://github.com', f.id);
      assert.ok(url.pathname.startsWith('/phaserjs/phaser/blob/v4.2.1/'), f.id);
      assert.match(url.hash, /^#L[1-9]\d*$/, f.id);
      assert.ok(['native-api', 'native-boundary'].includes(source.role), f.id);
      assert.ok(['public', 'internal'].includes(source.visibility), f.id);
      assert.ok(source.symbol && source.claim?.length > 20, `${f.id}: claim-specific source required`);
      if (source.visibility === 'internal') assert.equal(source.role, 'native-boundary', `${f.id}: internal methods are evidence, not public entry points`);
    }
    const nativeSymbols = f.sourceAnchors.filter(s => s.role === 'native-api').map(s => s.symbol);
    if (f.classification === 'native') assert.equal(f.nativeFacility, nativeSymbols.join(', '), `${f.id}: facilities need their own API claims`);
    else {
      assert.equal(nativeSymbols.length, 0, `${f.id}: workflow must not claim to be a native API`);
      assert.ok(f.workflowTerms.length, `${f.id}: name the application/tool workflow`);
    }
    assert.ok(f.versionLimits?.length > 30, `${f.id}: scope and version limits required`);
    for (const helper of f.pluginFacilities) {
      assert.match(helper.path, /^skills\/[a-z-]+\/scripts\/assets\/[a-z0-9-]+\.mjs$/);
      const lines = readFileSync(join(root, helper.path), 'utf8').split(/\r?\n/);
      assert.ok(lines[helper.line - 1]?.includes(`export function ${helper.symbol}(`), `${f.id}: plugin export ${helper.symbol}`);
      assert.ok(!nativeSymbols.includes(helper.symbol), `${f.id}: plugin export cannot also be native`);
      assert.ok(helper.claim?.length > 20);
    }
    for (const rejected of f.rejectedAlternatives) {
      assert.ok(rejected.symbol && rejected.reason?.length > 20, f.id);
      assert.ok(rejected.sourceSymbols.length && rejected.sourceSymbols.every(s => f.sourceAnchors.some(a => a.symbol === s)), `${f.id}: rejected alternative needs boundary evidence`);
    }
    assert.deepEqual(f.secondarySkills, f.secondaryRoutes.map(h => h.skill), `${f.id}: every secondary needs a disposition`);
    for (const handoff of f.secondaryRoutes) {
      assert.ok(['task-reference-handoff', 'case-specific-alternate'].includes(handoff.kind), f.id);
      assert.ok(handoff.rationale?.length > 30, f.id);
      assert.ok(existsSync(join(root, handoff.reference)), f.id);
      if (handoff.kind === 'task-reference-handoff') {
        const ownerText = readFileSync(join(root, 'skills', handoff.skill, 'SKILL.md'), 'utf8');
        const target = '../' + handoff.reference.replace(/^skills\//, '');
        assert.ok(ownerText.includes(`](${target})`), `${f.id}: handoff must exist in its entry skill's routing table`);
      } else {
        assert.ok(handoff.caseIds.length > 0, f.id);
        for (const id of handoff.caseIds) assert.ok(prompts.find(p => p.id === id)?.alt?.includes(handoff.skill), `${f.id}: case-specific alternate must exist in its case key`);
      }
    }
    assert.ok(f.evaluationCaseIds.length > 0, f.id);
    const cases = f.evaluationCaseIds.map(id => prompts.find(p => p.id === id));
    assert.ok(cases.every(p => p && p.family === f.id && p.expect === f.primarySkill), f.id);
    assert.ok(cases.some(p => p.kind === 'technology'), `${f.id}: missing technology case`);
  }
  const actual = skills.flatMap(owner => readdirSync(join(root, 'skills', owner, 'references'))
    .filter(file => file.endsWith('.md')).map(file => `skills/${owner}/references/${file}`));
  assert.deepEqual([...represented].sort(), actual.sort(), 'every reference needs an explicit family crosswalk');
});

const routeKey = route => JSON.stringify(route);
const destination = p => p.external ? `${p.external}:${p.expect}` : p.expect;
function assertRoutes(p) {
  const family = p.family ? coverage.families.find(f => f.id === p.family) : null;
  if (p.family) assert.ok(family, `unknown family ${p.family}`);
  const accepted = [destination(p), ...(p.alt ?? [])];
  assert.ok(Array.isArray(p.routes) && p.routes.length > 0, `missing routes ${p.id}`);
  assert.equal(new Set(p.routes.map(routeKey)).size, p.routes.length, `duplicate route ${p.id}`);
  assert.ok(Array.isArray(p.routeJustifications), `missing route justifications ${p.id}`);
  assert.deepEqual(p.routeJustifications.map(j => j.route), p.routes, `unmatched route justification ${p.id}`);
  for (const [index, route] of p.routes.entries()) {
    assert.ok(Array.isArray(route) && route.length >= 1 && route.length <= 2, `route length ${p.id}`);
    assert.ok(route.every(isSkill), `unknown route owner ${p.id}`);
    assert.ok(accepted.includes(route.at(-1)), `route destination ${p.id}`);
    assert.equal(new Set(route).size, route.length, `duplicate route member ${p.id}`);
    const justification = p.routeJustifications[index];
    assert.ok(justification.reason?.length > 20, `unjustified route ${p.id}`);
    const secondary = family?.secondaryRoutes.find(h => h.kind === 'task-reference-handoff' && h.skill === route.at(-1));
    const handoff = route.length === 2 && route[0] !== 'engine-phaser'
      ? family?.secondaryRoutes.find(h => h.kind === 'task-reference-handoff' && h.skill === route[0] && route.at(-1) === family.primarySkill) : null;
    if (route.length === 2 && route[0] !== 'engine-phaser') assert.ok(handoff, `undeclared domain handoff ${p.id}`);
    if (route.length === 2) assert.ok(!route.at(-1).includes(':'), `core/domain routes stay within Phaser ${p.id}`);
    if (secondary || handoff) assert.equal(justification.requiredReference, (secondary ?? handoff).reference, `missing task-reference condition ${p.id}`);
    if (justification.requiredReference) assert.ok(existsSync(join(root, justification.requiredReference)), `missing route reference ${p.id}`);
  }
  for (const owner of accepted) assert.ok(p.routes.some(r => r.at(-1) === owner), `alternate lacks a route ${p.id}: ${owner}`);
  if (p.external) {
    assert.equal(p.forbidPhaserActivation, true, `near miss must exclude all Phaser activation ${p.id}`);
    assert.ok(p.routes.flat().every(s => !skills.includes(s)), `near miss activates Phaser ${p.id}`);
    assert.ok(accepted.every(s => !skills.includes(s)), `near miss accepts a Phaser alternate ${p.id}`);
  }
}

test('every case has exhaustive bounded routes, including original cases and all near misses', () => {
  assert.equal(fixture.nearMissPhaserPolicy, 'forbid-all-local-skills');
  for (const p of prompts) assertRoutes(p);
  for (const owner of skills) {
    assert.ok(prompts.some(p => p.nearMissFor === owner && p.external), `missing near miss for ${owner}`);
  }
});

test('original 43 texts, keys and justified alternates remain unchanged', () => {
  const fields = new Set(['id', 'topic', 'text', 'expect', 'alt', 'term', 'external']);
  const original = prompts.filter(p => p.id <= 43).map(p => Object.fromEntries(Object.entries(p).filter(([k]) => fields.has(k))));
  assert.equal(original.length, 43);
  const digest = createHash('sha256').update(JSON.stringify(original)).digest('hex');
  assert.equal(digest, 'c1a838dae371edcc55ade9d11fefa15e8e95c8b517b753b0030760090dcd6349', 'baseline routing requests/answers changed; independently review before changing this identity');
});

test('route validation rejects missing legacy/near-miss keys, lost alternates and unrelated activation', () => {
  for (const id of [1, 37, 119]) {
    const p = structuredClone(prompts.find(p => p.id === id));
    delete p.routes;
    assert.throws(() => assertRoutes(p), /missing routes/);
  }
  const alternate = structuredClone(prompts.find(p => p.id === 42));
  alternate.routes = alternate.routes.filter(r => !r.at(-1).includes(':'));
  alternate.routeJustifications = alternate.routeJustifications.filter(j => !j.route.at(-1).includes(':'));
  assert.throws(() => assertRoutes(alternate), /alternate lacks a route/);
  const nearMiss = structuredClone(prompts.find(p => p.id === 119));
  nearMiss.alt = ['phaser-audio']; // Even an owner other than nearMissFor must fail.
  nearMiss.routes.push(['phaser-audio']);
  nearMiss.routeJustifications.push({ route: ['phaser-audio'], reason: 'An unjustified activation of another Phaser skill.' });
  assert.throws(() => assertRoutes(nearMiss), /near miss activates Phaser/);
  const unrelated = structuredClone(prompts.find(p => p.id === 57));
  unrelated.routes.push(['phaser-audio', unrelated.expect]);
  unrelated.routeJustifications.push({ route: ['phaser-audio', unrelated.expect], reason: 'This route is not a documented domain handoff.' });
  assert.throws(() => assertRoutes(unrelated), /undeclared domain handoff/);
  const missingReference = structuredClone(prompts.find(p => p.family === 'shared-ui'));
  for (const j of missingReference.routeJustifications) delete j.requiredReference;
  assert.throws(() => assertRoutes(missingReference), /missing task-reference condition/);
});

test('outcome-language cases name only the result, guard a description phrase and cover every skill', () => {
  const cases = prompts.filter(p => p.kind === 'outcome-language');
  const local = cases.filter(p => !p.external);
  for (const name of skills) assert.ok(local.some(p => p.expect === name), `no outcome-language case expects ${name}`);
  assert.ok(cases.some(p => p.external), 'outcome-language near misses are kept');
  for (const p of cases) {
    assert.equal(p.policyCue, 'none');
    assert.ok(p.context?.length > 30, `case ${p.id} has no context line`);
    assert.doesNotMatch(p.text, /phaser|webgl|tween|arcade|bitmaptext|playwright|emitter|filter/i, `case ${p.id} names the engine or an API`);
    if (!p.external) assert.ok(p.term, `case ${p.id} guards no description phrase`);
    for (const name of p.needsBoth ?? []) assert.ok([p.expect, ...(p.alt ?? [])].includes(name), `case ${p.id}: needsBoth ${name} is not an accepted owner`);
  }
});

test('every description states the project trigger within the portable length', () => {
  for (const name of skills) {
    const text = description(name);
    assert.ok(text.length <= 1024, `${name} description is ${text.length} characters`);
    assert.match(text, /Use when working in a project that depends on phaser/, `${name} lost its project trigger`);
    assert.match(text, /even when the user names only the result/, `${name} lost its outcome clause`);
    assert.ok(text.indexOf('Use when') < text.indexOf('Not for'), `${name} states its exclusions before its trigger`);
  }
});

test('task-language risk controls omit native-first policy instructions', () => {
  const requiredFamilies = ['game-architecture', 'particle-emitters', 'curves-followers'];
  const controls = prompts.filter(p => p.kind === 'task-language');
  for (const family of requiredFamilies) assert.ok(controls.some(p => p.family === family), `missing uncued risk ${family}`);
  for (const p of controls) {
    assert.equal(p.policyCue, 'none');
    assert.doesNotMatch(p.text, /native|existing (?:engine )?facilit|before (?:introducing|writing)|where they fit|replace|replacement/i, `coached task-language case ${p.id}`);
  }
  const cued = prompts.find(p => p.id === 130);
  assert.equal(cued.kind, 'policy-cued-task');
  assert.ok(cued.policyCue.length > 30);
});

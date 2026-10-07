import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Repo root: scripts/.. unless AGENT_ENGINE_ROOT points elsewhere.
const ROOT = resolve(process.env.AGENT_ENGINE_ROOT ?? join(import.meta.dirname, '..'));
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const readme = () => readFileSync(join(ROOT, 'README.md'), 'utf8');
const skills = () => readdirSync(join(ROOT, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(ROOT, 'skills', d.name, 'SKILL.md')))
  .map((d) => d.name)
  .sort();

test('plugin.json and marketplace.json carry the same version', () => {
  const plugin = json('.claude-plugin/plugin.json');
  const market = json('.claude-plugin/marketplace.json');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(market.plugins[0].version, plugin.version);
});

test('the README status line names the current plugin version', () => {
  const { version } = json('.claude-plugin/plugin.json');
  assert.match(readme(), new RegExp(`^Early \\(${version.replace(/\./g, '\\.')}\\)\\.`, 'm'));
});

test('the README skills table lists every skill folder, and nothing else', () => {
  const text = readme();
  const section = text.slice(text.indexOf('## Skills'), text.indexOf('## Sample scene'));
  const listed = [...section.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]).sort();
  assert.deepEqual(listed, skills());
});

test('the README status line states the number of skills', () => {
  const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  assert.match(readme(), new RegExp(`^Early \\([^)]*\\)\\. ${words[skills().length]} skills\\.`, 'm'));
});

test('plugin.json keywords name every web 3D stack that has a skill', () => {
  const keywords = json('.claude-plugin/plugin.json').keywords;
  const need = { 'engine-r3f': 'react-three-fiber', 'engine-babylon': 'babylonjs' };
  for (const [skill, keyword] of Object.entries(need)) {
    if (skills().includes(skill)) assert.ok(keywords.includes(keyword), `keyword ${keyword} for ${skill}`);
  }
});

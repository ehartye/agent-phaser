// The same dependency-free merge checks run locally and in CI. Browser, GPU and probe acceptance (the Phaser probes and
// the harness specs) is separate and needs its documented host project; this gate starts no browser and runs no probe.
//
//   node scripts/check.mjs                 the Node tests, then the lint of every folder under skills/
//   node scripts/check.mjs --no-tests      the lints only
//   node scripts/check.mjs --skill <name>  only the named skills' lints, with the flags the gate uses (repeat the
//                                          option or separate names with commas); the test step is skipped
//   node scripts/check.mjs --file <name>   only the findings in the named file (a reference's name with or without .md, or
//                                          SKILL.md), from the skills that have it, with the gate's flags; repeatable; the
//                                          test step is skipped. Combine with --skill to name the skill.
//   node scripts/check.mjs --allow-orphan <file>
//                                          do not report that reference as an orphan before its SKILL.md row exists (repeatable)
// The gate also prints each skill's listing length and headroom and the trigger words two skills share (warnings only), and, in a
// run over every skill, scans every text file for invisible Unicode.
// Every step runs even after one fails, so a single run shows every finding. The last line names what failed.
// Exit code 0 when everything passed, 1 when any step failed, 2 on a usage error.
// AGENT_PHASER_ROOT points the run at another root for skills/ and the tests (lint-skills.mjs still comes from
// this folder, so a fixture root needs no copy of the scripts).
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { discoverSkills } from './lint-skills.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const LINT = join(SCRIPTS, 'lint-skills.mjs');
const UNICODE = join(SCRIPTS, 'scan-unicode.mjs');
const DEFAULT_ROOT = resolve(SCRIPTS, '..');

// All ten Phaser skills pass the strict rules: every claim bullet carries an evidence label, every section of a SKILL.md and
// of each reference has a labelled claim bullet, and SKILL.md bullets are labelled too. Every folder under skills/ with a
// SKILL.md is linted. A folder that is not in this table gets the default rules ([]), so a new skill fails its label rules
// until it complies or earns an entry here. An entry with no folder is an error, so a renamed skill cannot silently lose its
// strictness.
const STRICT = ['--require-claims', '--skill-md-labels'];
export const STRICTNESS = Object.fromEntries([
  'engine-phaser', 'phaser-architecture', 'phaser-audio', 'phaser-input', 'phaser-motion',
  'phaser-physics', 'phaser-pixel-ui', 'phaser-rendering', 'phaser-verification', 'phaser-worlds',
].map((name) => [name, STRICT]));

/**
 * The lints to run: [{ name, dir, flags }] for every folder under skillsDir that has a SKILL.md, sorted by folder.
 * Flags come from the table (copied), or [] for a folder the table does not name. With requireAll (the default) a table
 * entry that matches no skill folder throws an Error naming it.
 */
export function lintPlan(skillsDir, table = STRICTNESS, { requireAll = true } = {}) {
  const plan = discoverSkills(skillsDir).map((dir) => {
    const name = basename(dir);
    return { name, dir, flags: Object.hasOwn(table, name) ? [...table[name]] : [] };
  });
  if (requireAll) {
    const missing = Object.keys(table).filter((name) => !plan.some((p) => p.name === name));
    if (missing.length > 0) {
      throw new Error(`the strictness table names ${missing.join(', ')}, but ${skillsDir} has no such skill folder with a SKILL.md; rename the table entry with the skill`);
    }
  }
  return plan;
}

/**
 * The test files, root-relative with forward slashes: scripts/*.test.mjs, then tests/*.test.mjs, then every *.test.mjs under
 * examples/, so a new example adds its test by existing. A missing folder contributes nothing. node_modules is never searched.
 */
export function discoverTests(root) {
  const list = (dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).sort() : []);
  const flat = (dir) => list(dir).filter((name) => name.endsWith('.test.mjs')).map((name) => `${dir}/${name}`);
  const walk = (dir) => list(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) return walk(rel);
    return name.endsWith('.test.mjs') ? [rel] : [];
  });
  return [...flat('scripts'), ...flat('tests'), ...walk('examples')];
}

const USAGE = `usage: node scripts/check.mjs [--no-tests] [--skill <name>[,<name>...]]... [--file <name>]... [--allow-orphan <file>]...
  (no options)           run the Node tests, then lint every folder under skills/ and scan every text file for invisible Unicode
  --no-tests             skip the Node tests
  --skill <name>         lint only the named skills with the gate's flags (repeatable, comma-separated); skips the tests and the scan
  --file <name>          show only the findings in this file (a reference's name with or without .md, or SKILL.md), from the skills
                         that have it (repeatable); skips the tests and the scan
  --allow-orphan <file>  do not report this reference as an orphan before its SKILL.md row exists (repeatable)
  --help                 print this text`;

/**
 * { skills: null | string[], files, allowOrphans, noTests, help }, or { error }. skills is null when no
 * --skill was given.
 */
export function parseArgs(argv) {
  const parsed = { skills: null, files: [], allowOrphans: [], noTests: false, help: false };
  // The value of --name <value> or --name=<value>; null when it is missing or is the next option.
  const valueOf = (arg, name, i) => {
    const value = arg === name ? argv[i + 1] : arg.slice(name.length + 1);
    return value === undefined || value.startsWith('--') ? null : value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const option = ['--skill', '--file', '--allow-orphan'].find((name) => arg === name || arg.startsWith(`${name}=`));
    if (arg === '--no-tests') parsed.noTests = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (option) {
      const value = valueOf(arg, option, i);
      if (arg === option) i++;
      const names = (value ?? '').split(',').map((name) => name.trim()).filter(Boolean);
      if (names.length === 0) return { error: `${option} needs a ${option === '--skill' ? 'skill name' : 'file name'}` };
      if (option === '--skill') parsed.skills = [...(parsed.skills ?? []), ...names];
      else if (option === '--file') parsed.files.push(...names);
      else parsed.allowOrphans.push(...names);
    } else return { error: arg.startsWith('-') ? `unknown option ${arg}` : `unexpected argument ${arg}` };
  }
  return parsed;
}

/** Run one node child with its output inherited, so everything prints in order. True when it exited 0. */
function step(label, args, { cwd, env }) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.error) console.error(`check: ${label}: ${result.error.message}`);
  return result.status === 0;
}

/** Whether a skill folder has the named file: SKILL.md, or references/<name> with or without .md. */
function hasFile(dir, name) {
  const base = basename(name.replace(/\\/g, '/'));
  if (base === 'SKILL.md') return true;
  return existsSync(join(dir, 'references', base)) || existsSync(join(dir, 'references', `${base}.md`));
}

/** Runs the gate and returns the exit code. */
export function main(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.error) { console.error(`check: ${args.error}\n${USAGE}`); return 2; }
  if (args.help) { console.log(USAGE); return 0; }

  const override = env.AGENT_PHASER_ROOT;
  const root = resolve(override || DEFAULT_ROOT);
  const skillsDir = join(root, 'skills');
  let plan;
  try {
    // A fixture root has only the skills it needs, so a table entry without a folder is an error on the real tree only.
    plan = lintPlan(skillsDir, STRICTNESS, { requireAll: !override });
  } catch (error) {
    console.error(`check: ${error.message}`);
    console.log('check: FAILED strictness table');
    return 1;
  }
  if (plan.length === 0) { console.error(`check: no skills found under ${skillsDir}`); return 2; }

  let selected = plan;
  if (args.skills) {
    const known = plan.map((p) => p.name);
    const unknown = [...new Set(args.skills.filter((name) => !known.includes(name)))];
    if (unknown.length > 0) {
      console.error(`check: unknown skill ${unknown.map((name) => `"${name}"`).join(', ')}; known skills: ${known.join(', ')}`);
      return 2;
    }
    selected = plan.filter((p) => args.skills.includes(p.name));
  }
  if (args.files.length > 0) {
    // A file name picks the skills that have it, among those already selected; SKILL.md is in every skill, so name the skill too.
    const missing = args.files.filter((name) => !selected.some((p) => hasFile(p.dir, name)));
    if (missing.length > 0) {
      console.error(`check: no ${args.skills ? 'selected ' : ''}skill has the file ${missing.map((name) => `"${name}"`).join(', ')}`);
      return 2;
    }
    selected = selected.filter((p) => args.files.some((name) => hasFile(p.dir, name)));
  }
  const orphanless = args.allowOrphans.filter((name) => !selected.some((p) => hasFile(p.dir, name) && basename(name) !== 'SKILL.md'));
  if (orphanless.length > 0) {
    console.error(`check: --allow-orphan ${orphanless.map((name) => `"${name}"`).join(', ')} names no reference in the selected skills`);
    return 2;
  }

  const selection = args.skills !== null || args.files.length > 0;
  const runTests = !selection && !args.noTests;
  const failed = [];
  if (runTests) {
    const tests = discoverTests(root);
    if (tests.length === 0) {
      console.error(`check: no *.test.mjs files under ${join(root, 'scripts')}, ${join(root, 'tests')} or ${join(root, 'examples')}`);
      failed.push('tests');
    } else {
      // Node sets NODE_TEST_CONTEXT in the environment of a running test. A node --test child that inherits it
      // behaves differently by version: on Node 24 it exits 0 without running the files, so the step would pass with
      // nothing run; on Node 20.11 it runs the files but writes a serialized binary report instead of readable text.
      // Removing the variable gives a real, readable run on both.
      const testEnv = { ...env };
      delete testEnv.NODE_TEST_CONTEXT;
      if (!step('tests', ['--test', ...tests], { cwd: root, env: testEnv })) failed.push('tests');
    }
  }
  for (const { name, dir, flags } of selected) {
    const extra = [
      ...args.files.flatMap((file) => ['--file', file]),
      ...args.allowOrphans.flatMap((file) => ['--allow-orphan', file]),
    ];
    if (!step(name, [LINT, dir, ...flags, ...extra], { cwd: root, env })) failed.push(name);
  }
  // Listing lengths and shared trigger words (warnings only), then the whole-checkout scan.
  if (args.files.length === 0 && !step('listing', [LINT, '--listing', ...selected.map((p) => p.dir)], { cwd: root, env })) failed.push('listing');
  if (!selection && !step('unicode', [UNICODE, '--quiet', root], { cwd: root, env })) failed.push('unicode');

  const lints = `${selected.length} lint${selected.length === 1 ? '' : 's'}`;
  console.log(failed.length === 0 ? `check: ok (${runTests ? 'tests + ' : ''}${lints})` : `check: FAILED ${failed.join(', ')}`);
  return failed.length === 0 ? 0 : 1;
}

// Run only when started as the script, not when imported. The paths are compared after realpath, so starting the
// script through a symlink or a different letter case still runs the gate instead of silently doing nothing.
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  const here = fileURLToPath(import.meta.url);
  try {
    return realpathSync.native(here) === realpathSync.native(resolve(entry));
  } catch {
    return here === resolve(entry);
  }
}

if (isEntryPoint()) process.exitCode = main(process.argv.slice(2));

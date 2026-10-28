# Scripts

Dependency-free Node (20.11 or newer) used by the merge gate and by authors. `node scripts/check.mjs` is the one command to run before pushing; the pieces below are what it runs. It starts no browser and runs no probe.

| File | What it does |
| --- | --- |
| `check.mjs` | The gate: the Node tests, a strict lint per skill folder, the listing report, then the invisible-Unicode scan. Options below. |
| `lint-skills.mjs` | The per-skill lint (frontmatter, sizes, selector table, links, placeholders, evidence labels). `lint-skills.test.mjs` tests it. |
| `scan-unicode.mjs` | Invisible Unicode in every tracked and untracked text file. `scan-unicode.test.mjs` tests it. |
| `skill-citations.mjs` | The citation check described below; `sibling-skills.json` is its names-only snapshot. |
| `../tests/release-consistency.test.mjs` | Manifest, README and hygiene checks, and the citation test. |

## The gate

- `node scripts/check.mjs` runs everything. `--no-tests` runs the lints and the scan only.
- The tests are `scripts/*.test.mjs`, `tests/*.test.mjs` and every `*.test.mjs` under `examples/`, so a new example adds its test by existing. The browser probes in `examples/web/phaser-probes/` are not tests of this kind and are never run here.
- All ten skills are linted with `--require-claims --skill-md-labels`: every claim bullet carries an evidence label, every section of a `SKILL.md` and of each reference has a labelled claim bullet, and `SKILL.md` bullets are labelled too. The table in `check.mjs` names the skills; a folder under `skills/` that is not in it gets the default rules and fails its label rules until it complies or earns an entry, and an entry without a folder is an error.
- `--skill <name>` lints only those skills with the gate's flags. `--file <name>` shows only the findings in that file (a reference's name, with or without `.md`, or `SKILL.md`) from the skills that have it. Both skip the tests and the Unicode scan.
- `--allow-orphan <file>` hides the orphan finding for a new reference until its selector row exists. It names a reference of a selected skill, or the run stops with exit code 2.
- `[tested]` means checked in this repo: a browser probe, a Node test or a run recorded in the line; it is a record of what was seen, not a promise about every Phaser version. `[documented]` is Phaser's documentation or source; `[general]` is judgement or an observation not reproduced here.
- The lint also checks: the listing length (`description` + ` - ` + `when_to_use`, warning from 1,400 characters, failure over 1,536), that the description or `when_to_use` has "Use when", that frontmatter is strict YAML (an unquoted value with a colon and a space fails; double-quote it), and that no `$1` or `$ARGUMENTS` placeholder is left in a skill. `SKILL.md` is checked everywhere, code fences included, because the host substitutes text. In a reference only `$ARGUMENTS` is rejected inside code; `$1` is rejected in prose and allowed in code, because shell and regex examples use it. Sizes count bytes with line endings normalised to LF.
- The listing report prints each skill's listing length and headroom, and warns when two skills share two or more trigger words that no third skill uses. It never fails the gate.
- `AGENT_PHASER_ROOT` points the run at another root for `skills/` and the tests; `lint-skills.mjs` still comes from this folder, so a fixture root needs no copy of the scripts.

## Invisible Unicode

`scan-unicode.mjs` rejects format characters (category Cf: zero-width, bidirectional, byte-order mark, soft hyphen), private-use (Co), unassigned (Cn) and the tag block U+E0000 to U+E007F, in any text file, `.mjs` and `.py` sources included. It prints `file:line:column`, the code point and the line with the character shown as `<U+XXXX>`. To write such a character in a test or fixture, build it with `String.fromCodePoint(0xFEFF)` instead of typing it or writing a `\u` escape through an editing tool, which can turn the escape into the literal character. Unassigned depends on the Unicode data of the running Node, so a very new character can be reported as unassigned by an older Node.

## Citing another plugin's skill

The plugins install separately, so a skill never links to another plugin's files. It names the skill, and `skill-citations.mjs` checks the name. It reads `skills/**/*.md`, `examples/**/*.md` and `README.md` (fenced code is ignored) and checks every skill name it can bind to a plugin. `tests/release-consistency.test.mjs` runs it against `sibling-skills.json`, so the check runs by default and needs no sibling checkout. With `AGENT_PHASER_SIBLING_PLUGINS` set to a folder of sibling checkouts it also compares the snapshot with them.

Write a citation in one of these forms; the name is lowercase and hyphenated, a list may use commas, `and` or `or`, and a name may span a line break:

| Form | Example |
| --- | --- |
| plugin, colon, name | `` `agent-engine:engine-asset-import` `` |
| name `in` or `from` plugin | `` `engine-selection` in agent-engine `` |
| name, plugin in parentheses | `` `engine-asset-import` (agent-engine) `` |
| name `skill,` plugin | `` `engine-selection` skill, agent-engine `` |
| plugin's names `skills` | `` the `agent-engine` plugin's engine-selection and engine-asset-import skills `` |
| `its` name `skill`, after the plugin in the same paragraph | `` agent-meshes ... (see its `mesh-build` skill) `` |
| `whose` name, after the plugin in the same paragraph | `` agent-meshes, whose `mesh-tool-selection` decides `` |
| name `skill` (backticked) | `` the `phaser-input` skill `` |

How a name resolves: a name bound to a plugin must be in that plugin's list (the snapshot, or the live checkout in sibling mode); `agent-phaser` resolves against `skills/`. A backticked `name skill` with no plugin resolves in this plugin first, then in the plugin named earlier in its paragraph, and otherwise fails; write the colon form for another plugin's skill. A plugin the snapshot does not list fails. Bare hyphenated words beside the word "skill" are not read as names, `whose` followed by a plugin name is not a citation, and `its` or `whose` with no plugin earlier in the paragraph is not read as a citation.

`sibling-skills.json` lists the skills the sibling plugins have (agent-engine after its Phaser skills moved here). Refresh it from the sibling checkouts with `node scripts/skill-citations.mjs --write-snapshot <folder> [--plugins a,b,c] [--merge]`.

What it cannot see:

- A skill that exists but no longer holds the cited content. A name check passes a pointer to a skill that still exists after the topic moved out of it. Re-read the target when its plugin releases a split.
- A citation written outside these forms, such as "use `x` from the other plugin" with no plugin name, or a name in a table cell with no plugin.
- A snapshot that has gone stale. `sibling-skills.json` is committed and names only (plugin to sorted skill names, no paths or versions).

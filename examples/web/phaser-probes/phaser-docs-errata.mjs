// Run: node phaser-docs-errata.mjs /absolute/path/to/project-with-phaser
// Purpose: after a Phaser upgrade, find the errata rows (skills/engine-phaser/references/phaser-docs-errata-*.md) whose needle is no longer in the
// installed package's own documents. A missing needle means Phaser changed or moved that line: re-check the row and trim it if it is fixed.
// Needs: phaser in the host project; no browser and no GPU. Reads the package only; writes nothing.
// Output: one "present" or "ABSENT" line per row, then a total. Exit code 1 when any row is absent or malformed, 2 on a usage error.
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {readRows} from './errata-rows.mjs';

const project = resolve(process.argv[2] ?? '.');
let packageJson;
try { packageJson = createRequire(resolve(project, 'package.json')).resolve('phaser/package.json'); }
catch { console.error(`phaser is not installed in ${project}`); process.exit(2); }
const phaserDir = dirname(packageJson);
const version = JSON.parse(readFileSync(packageJson, 'utf8')).version;
console.log(`phaser ${version} at ${phaserDir}`);

let absent = 0;
for (const row of readRows()) {
  const where = `${row.file} :: ${row.needle}`;
  const path = row.file && join(phaserDir, row.file.replace(/^skills\//, 'skills/'));
  if (!row.file || !row.needle) { absent++; console.log(`ABSENT  malformed row at line ${row.line} of ${row.source}`); continue; }
  if (!existsSync(path)) { absent++; console.log(`ABSENT  ${where} (file not in this Phaser version)`); continue; }
  if (readFileSync(path, 'utf8').includes(row.needle)) console.log(`present ${where}`);
  else { absent++; console.log(`ABSENT  ${where}`); }
}
console.log(absent ? `${absent} row(s) to re-check against phaser ${version}` : `all rows still match phaser ${version}`);
process.exit(absent ? 1 : 0);

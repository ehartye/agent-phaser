// Reads the errata tables in skills/engine-phaser/references/phaser-docs-errata-*.md into rows. Pure: no Phaser, no browser.
// Shared by tests/phaser-docs-errata.test.mjs (is the table well formed?) and phaser-docs-errata.mjs (is each needle still in the installed package?).
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, '..', '..', '..');
export const errataFiles = ['phaser-docs-errata-names.md', 'phaser-docs-errata-behaviour.md'].map(name => join(root, 'skills', 'engine-phaser', 'references', name));

/** Rows of every errata table: {source, line, file, needle, does, evidence, fix}. A row is a table line whose first cell is a backticked `skills/...` path. */
export function readRows(paths = errataFiles) {
  return paths.flatMap(path => readFileSync(path, 'utf8').split('\n').flatMap((text, index) => {
    if (!/^\| `skills\//.test(text)) return [];
    const cells = text.replace(/^\| /, '').replace(/ \|\s*$/, '').split(' | ');
    const code = cell => (cell.match(/^`([^`]+)`$/) ?? [])[1];
    return [{source: path, line: index + 1, cells: cells.length, file: code(cells[0]), needle: code(cells[1]), does: cells[2], evidence: cells[3], fix: cells[4]}];
  }));
}

// What the loaded textures cost, counted two ways. Pure ES module: no Phaser import, no dependencies.
//
// A texture costs width x height x 4 bytes once it is decoded and uploaded, whatever its file weighs: a flat 2048 x 2048 PNG can be
// a few kilobytes on disk and 16 MiB as a texture. Sum it over everything the game holds and compare it with a budget.
//
//   In a running game:   const report = measureTextures(game);             // `game` is the Phaser.Game
//                        const verdict = checkTextureBudget(report, 256 * MIB);
//   From a browser test: await page.evaluate(`(${measureTextures})(window.__game)`)   // the function is self-contained
//   Before a browser:    node texture-memory.mjs <folder> [--budget-mb <n>] [--top <n>] [--json]
//                        sums the PNG header sizes under a folder; exit 1 over the budget, 2 on a usage error.
//
// What it does not count: mipmaps (+33% when a texture has them), render targets and filter framebuffers the renderer owns,
// the decoded source image the browser may also keep, audio, and the JavaScript heap. It is a floor, not the page's memory.
//
// Proof: `node --test tests/phaser-texture-memory.test.mjs`; against real Phaser 4.2.1,
// `node examples/web/phaser-probes/phaser-verification-content-cost.mjs <host project>`.
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIB = 1024 * 1024;

/**
 * Sum source.width * source.height * 4 over game.textures.list. Self-contained, so its source can be evaluated in a page.
 * Returns { bytes, count, sources, largest: [{ key, width, height, bytes }], textures: [...] } with textures sorted
 * largest first and `largest` its first `top` entries. A texture with several sources (a multi-page atlas) is the sum
 * of its pages; width and height are those of its largest page.
 */
export function measureTextures(game, top = 10) {
  const list = game && game.textures && game.textures.list;
  if (!list || typeof list !== 'object') throw new TypeError('measureTextures needs a Phaser.Game (game.textures.list is missing)');
  const textures = [];
  let bytes = 0, sources = 0;
  for (const key of Object.keys(list)) {
    const pages = Array.isArray(list[key] && list[key].source) ? list[key].source : [];
    let own = 0, width = 0, height = 0;
    for (const page of pages) {
      const w = Number(page && page.width) || 0, h = Number(page && page.height) || 0;
      const size = w * h * 4;
      if (size > 0) sources++;
      if (w * h > width * height) { width = w; height = h; }
      own += size;
    }
    bytes += own;
    textures.push({ key, width, height, bytes: own });
  }
  textures.sort((a, b) => b.bytes - a.bytes || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { bytes, count: textures.length, sources, largest: textures.slice(0, top), textures };
}

/** { ok, bytes, budgetBytes, overBytes, message } for a report from measureTextures or measureFolder. */
export function checkTextureBudget(report, budgetBytes) {
  if (!report || !Number.isFinite(report.bytes)) throw new TypeError('checkTextureBudget needs a report with a bytes total');
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) throw new RangeError('budgetBytes must be a positive number of bytes');
  const ok = report.bytes <= budgetBytes;
  const first = (report.largest ?? [])[0];
  const where = first ? `; largest ${first.key ?? first.file} ${first.width}x${first.height} = ${formatMiB(first.bytes)}` : '';
  return {
    ok, bytes: report.bytes, budgetBytes, overBytes: Math.max(0, report.bytes - budgetBytes),
    message: `${formatMiB(report.bytes)} of textures against a budget of ${formatMiB(budgetBytes)}${ok ? '' : ' (over)'}${where}`,
  };
}

export const formatMiB = (bytes) => `${(bytes / MIB).toFixed(1)} MiB`;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * { width, height } from a PNG's IHDR chunk: big-endian 32-bit integers at bytes 16 to 19 and 20 to 23. Only the first 24
 * bytes are needed. Throws a TypeError when the bytes are not a PNG that starts with IHDR.
 */
export function pngSize(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) throw new TypeError('pngSize needs at least the first 24 bytes of the file');
  if (PNG_SIGNATURE.some((value, i) => bytes[i] !== value)) throw new TypeError('not a PNG: the signature does not match');
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') throw new TypeError('not a PNG: the first chunk is not IHDR');
  const u32 = (at) => bytes[at] * 0x1000000 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
  return { width: u32(16), height: u32(20) };
}

/**
 * Sum width x height x 4 over every .png under a folder (subfolders included, node_modules skipped).
 * Returns { bytes, fileBytes, count, largest, files: [{ file, width, height, bytes, fileBytes }], unreadable: [{ file, reason }] }
 * with files sorted largest first and paths relative to the folder with forward slashes. This is the cost of loading all of
 * them at once, which is what a boot scene that queues the whole folder does.
 */
export function measureFolder(folder, top = 10) {
  const root = resolve(folder);
  if (!statSync(root).isDirectory()) throw new TypeError(`${folder} is not a folder`);
  const files = [], unreadable = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(path); continue; }
      if (!entry.isFile() || !/\.png$/i.test(entry.name)) continue;
      const file = relative(root, path).replace(/\\/g, '/');
      try {
        const data = readFileSync(path);
        const { width, height } = pngSize(data);
        files.push({ file, width, height, bytes: width * height * 4, fileBytes: data.length });
      } catch (error) {
        unreadable.push({ file, reason: error.message });
      }
    }
  };
  walk(root);
  files.sort((a, b) => b.bytes - a.bytes || (a.file < b.file ? -1 : 1));
  const sum = (field) => files.reduce((total, f) => total + f[field], 0);
  return { bytes: sum('bytes'), fileBytes: sum('fileBytes'), count: files.length, largest: files.slice(0, top), files, unreadable };
}

const USAGE = `usage: node texture-memory.mjs <folder> [--budget-mb <n>] [--top <n>] [--json]
  Sums width x height x 4 over every PNG under the folder: the texture memory of loading all of them at once.
  --budget-mb <n>  exit 1 when the sum is over n MiB (no default: measure the weakest device you support)
  --top <n>        how many of the largest files to print (default 10)
  --json           print the whole report as JSON`;

/** The command line. Returns the exit code: 0 ok, 1 over the budget or an unreadable PNG, 2 a usage error. */
export function main(argv, out = console) {
  let folder = null, budgetMb = null, top = 10, asJson = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => (arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i]);
    if (arg === '--help' || arg === '-h') { out.log(USAGE); return 0; }
    else if (arg === '--json') asJson = true;
    else if (arg === '--budget-mb' || arg.startsWith('--budget-mb=')) budgetMb = Number(value());
    else if (arg === '--top' || arg.startsWith('--top=')) top = Number(value());
    else if (arg.startsWith('-')) { out.error(`texture-memory: unknown option ${arg}\n${USAGE}`); return 2; }
    else if (folder === null) folder = arg;
    else { out.error(`texture-memory: unexpected argument ${arg}\n${USAGE}`); return 2; }
  }
  if (folder === null) { out.error(`texture-memory: name a folder\n${USAGE}`); return 2; }
  if (budgetMb !== null && !(budgetMb > 0)) { out.error(`texture-memory: --budget-mb needs a positive number\n${USAGE}`); return 2; }
  if (!Number.isInteger(top) || top < 0) { out.error(`texture-memory: --top needs a whole number\n${USAGE}`); return 2; }
  let report;
  try { report = measureFolder(folder, top); } catch (error) { out.error(`texture-memory: ${error.message}`); return 2; }
  const verdict = budgetMb === null ? null : checkTextureBudget(report, budgetMb * MIB);
  if (asJson) out.log(JSON.stringify({ ...report, budget: verdict }, null, 2));
  else {
    out.log(`${report.count} PNG file(s), ${formatMiB(report.fileBytes)} on disk, ${formatMiB(report.bytes)} as textures if all are loaded at once`);
    for (const f of report.largest) out.log(`  ${formatMiB(f.bytes).padStart(10)}  ${f.width}x${f.height}  ${f.file}  (${(f.fileBytes / 1024).toFixed(0)} KB file)`);
    for (const f of report.unreadable) out.log(`  unreadable  ${f.file}: ${f.reason}`);
    if (verdict) out.log(`${verdict.ok ? 'ok' : 'FAILED'}: ${verdict.message}`);
  }
  return (verdict && !verdict.ok) || report.unreadable.length > 0 ? 1 : 0;
}

function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  const here = fileURLToPath(import.meta.url);
  try { return realpathSync.native(here) === realpathSync.native(resolve(entry)); } catch { return here === resolve(entry); }
}

if (isEntryPoint()) process.exitCode = main(process.argv.slice(2));

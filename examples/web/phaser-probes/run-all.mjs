// Run: node run-all.mjs /absolute/path/to/project-with-phaser-and-playwright [--hardware] [--only <prefix>] [--timeout <seconds>] [--channel <name>] [--list]
// Purpose: run every Phaser probe in this folder against one host project, one at a time, so a Phaser or Playwright upgrade names the references to update.
// Lanes: the default is the software lane (headless Chromium, software rasteriser: logic, counts, flat colours). --hardware also runs the probes that need a
//   GPU and asks the platform GPU backend of the rest that can use one. A probe the chosen lane cannot run is reported as skipped, never as passed.
// Output: one line per probe ("ok", "FAIL" with the last lines of its output, or "skip" with the reason), then a tally. Exit code 1 when any probe fails or times out.
// Needs: phaser 4.2.1 and @playwright/test in the host project. Takes several minutes; writes nothing except what a probe itself writes.
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeExit, parseArgs, plan, summarize } from './run-all-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let options;
try { options = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }

let steps;
try { steps = plan(options, { env: process.env }); } catch (e) { console.error(e.message); process.exit(2); }

if (options.list) {
  for (const s of steps) console.log(`${s.action === 'run' ? 'run ' : 'skip'} ${s.lane.padEnd(8)} ${s.file}${s.reason ? `  (${s.reason})` : ''}`);
  process.exit(0);
}

const host = resolve(options.host);
console.log(`lane: ${options.hardware ? 'hardware (the platform GPU backend where a probe supports it)' : 'software'}; host ${host}; timeout ${options.timeoutSec} s per probe`);

/** Run one probe as a child of this process with no shell, so every argument arrives as written. Resolves { code, timedOut, output }. */
function runProbe(step) {
  return new Promise(done => {
    const child = spawn(process.execPath, [join(here, step.file), host], { env: step.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '', timedOut = false;
    const keep = chunk => { output = (output + chunk).slice(-8000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, options.timeoutSec * 1000);
    child.on('error', error => { clearTimeout(timer); done({ code: 1, timedOut: false, output: String(error) }); });
    child.on('close', code => { clearTimeout(timer); done({ code, timedOut, output }); });
  });
}

const results = [];
for (const step of steps) {
  if (step.action === 'skip') {
    console.log(`skip ${step.file}: ${step.reason}`);
    results.push({ file: step.file, status: 'skipped' });
    continue;
  }
  const started = Date.now();
  const { code, timedOut, output } = await runProbe(step);
  const { status, note } = describeExit(code, timedOut);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (status === 'pass') console.log(`ok   ${step.file} (${seconds} s)`);
  else {
    console.log(`FAIL ${step.file}: ${note} (${seconds} s)`);
    for (const line of output.trim().split('\n').slice(-12)) console.log(`       ${line.slice(0, 220)}`);
  }
  results.push({ file: step.file, status });
}

const tally = summarize(results);
console.log(`${tally.passed} passed, ${tally.failed} failed, ${tally.skipped} skipped${tally.skipped ? ' (skipped is not passed: those probes did not run in this lane)' : ''}`);
process.exit(tally.exit);

// Start a Node script from a gate script (a lane runner, a GPU lock, a retry wrapper) with every argument intact, on Windows too.
//   node run-node.mjs <script-or-flag> [args...]      exits with the child's code
// `spawn(cmd, args, { shell: true })` joins the arguments with spaces and does not quote them (Node warns DEP0190), so an argument with a space,
// a quote, a parenthesis or `>` is re-parsed by the shell: `node -e "f(()=>{})"` creates a file named `{}`. Start `process.execPath` directly
// instead, and resolve a tool's JavaScript entry point (node_modules/@playwright/test/cli.js) rather than its `.cmd` shim.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Run Node with `args` and no shell. Resolves `{ code, out }`; `out` holds stdout only when `options.stdio` pipes it. */
export function runNode(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', ...options, shell: false });
    let out = '';
    child.stdout?.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code } = await runNode(process.argv.slice(2));
  process.exit(code ?? 1);
}

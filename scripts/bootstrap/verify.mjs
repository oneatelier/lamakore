#!/usr/bin/env node
/*
 * P001 — toolchain pin verifier.
 * Reads artifacts/toolchain.lock.json, checks the live toolchain, prints a
 * table, and exits non-zero if ANY pin mismatches (or a pinned tool is
 * missing). No dependencies — node:child_process + node:fs only.
 *
 * Usage: node scripts/bootstrap/verify.mjs [--lock <path>]
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lockIdx = process.argv.indexOf('--lock');
const lockPath = lockIdx >= 0 && process.argv[lockIdx + 1]
  ? path.resolve(process.argv[lockIdx + 1])
  : path.join(root, 'artifacts', 'toolchain.lock.json');

function run(cmd) {
  try {
    return String(execSync(cmd, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })).trim().split('\n')[0];
  } catch {
    return null;
  }
}

let lock;
try {
  lock = JSON.parse(readFileSync(lockPath, 'utf8'));
} catch (e) {
  console.error(`FAIL: cannot read lock file ${lockPath}: ${e.message}`);
  process.exit(1);
}

const rows = [];
let failed = 0;
function check(name, actual, expected, { exact = true } = {}) {
  const ok = actual !== null && (exact ? actual === expected : actual.includes(expected));
  if (!ok) failed += 1;
  rows.push({ tool: name, expected, actual: actual ?? 'MISSING', status: ok ? 'PASS' : 'FAIL' });
}

// Pinned tools: exact match required.
const rustcOut = run('rustc --version'); // "rustc 1.100.0 (hash date)"
check('rustc', rustcOut ? (rustcOut.match(/^rustc (\S+)/) || [])[1] || rustcOut : null, lock.pins.rust.resolved, { exact: true });
const pnpmOut = run('pnpm --version');
check('pnpm', pnpmOut, lock.pins.pnpm.resolved, { exact: true });
const nodeOut = run('node --version'); // "v24.22.3"
check('node', nodeOut ? nodeOut.replace(/^v/, '') : null, lock.pins.node.resolved, { exact: true });
// Unpinned-but-required presence checks (fail only if missing).
const gitOut = run('git --version');
rows.push({ tool: 'git', expected: lock.pins.git.resolved, actual: gitOut ?? 'MISSING', status: gitOut ? 'PASS' : 'FAIL' });
if (!gitOut) failed += 1;
const cargoOut = run('cargo --version');
const cargoOk = cargoOut !== null && cargoOut.includes(lock.pins.rust.resolved);
rows.push({ tool: 'cargo', expected: `cargo ${lock.pins.rust.resolved}*`, actual: cargoOut ?? 'MISSING', status: cargoOk ? 'PASS' : 'FAIL' });
if (!cargoOk) failed += 1;

const w = { tool: 6, expected: 14, actual: 40, status: 6 };
for (const r of rows) {
  w.tool = Math.max(w.tool, r.tool.length);
  w.expected = Math.max(w.expected, String(r.expected).length);
  w.actual = Math.max(w.actual, String(r.actual).length);
}
const line = (r) => `| ${r.tool.padEnd(w.tool)} | ${String(r.expected).padEnd(w.expected)} | ${String(r.actual).padEnd(w.actual)} | ${r.status.padEnd(w.status)} |`;
console.log(`toolchain lock: ${lockPath}`);
console.log(`| ${'tool'.padEnd(w.tool)} | ${'expected'.padEnd(w.expected)} | ${'actual'.padEnd(w.actual)} | ${'status'.padEnd(w.status)} |`);
console.log(`|-${'-'.repeat(w.tool)}-|-${'-'.repeat(w.expected)}-|-${'-'.repeat(w.actual)}-|-${'-'.repeat(w.status)}-|`);
for (const r of rows) console.log(line(r));

if (failed > 0) {
  console.error(`\nFAIL: ${failed} pin check(s) mismatched.`);
  process.exit(1);
}
console.log('\nAll pin checks passed.');

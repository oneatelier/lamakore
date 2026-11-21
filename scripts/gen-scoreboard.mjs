#!/usr/bin/env node
/*
 * Scoreboard generator (P006): single implementation behind scoreboard.yml.
 * Scans eval/ for evidence artifacts; with none present it writes an honest
 * "no evidence yet" scoreboard and never a fabricated pass.
 * Usage: gen-scoreboard.mjs [--root DIR] [--check]
 * --check exits 1 when the committed file is stale (CI drift guard).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, '..');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(p) : [p];
  });
}

export function render(root) {
  const cfg = JSON.parse(readFileSync(path.join(root, 'branding.config.json'), 'utf8'));
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    /* non-checkout context; sha stays unknown */
  }
  const today = new Date().toISOString().slice(0, 10);
  let rows = [];
  try {
    rows = walk(path.join(root, 'eval')).filter((p) => !p.endsWith('.gitkeep'));
  } catch {
    rows = [];
  }
  const body =
    rows.length === 0
      ? 'No eval evidence yet. No pass is claimed; no gate is marked green on the basis of this file.'
      : rows.map((r) => `- ${path.relative(root, r).split(path.sep).join('/')}`).join('\n');
  return (
    `# Parity Scoreboard — ${cfg.productName}\n\n` +
    `Generated: ${today} (nightly, commit ${sha})\n\n` +
    `## Evidence\n\n${body}\n`
  );
}

function main() {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const root = rootIdx >= 0 && args[rootIdx + 1] ? path.resolve(args[rootIdx + 1]) : defaultRoot;
  const out = path.join(root, 'artifacts', 'parity-scoreboard.md');
  const text = render(root);
  if (args.includes('--check')) {
    let cur = null;
    try {
      cur = readFileSync(out, 'utf8');
    } catch {
      cur = null;
    }
    // Date and commit advance nightly; compare only the evidence section.
    const ev = (s) => (s === null ? null : s.split('## Evidence')[1]);
    if (ev(cur) !== ev(text)) {
      console.error('scoreboard: committed file is stale; run node scripts/gen-scoreboard.mjs');
      process.exitCode = 1;
    } else {
      console.log('scoreboard: evidence section current');
    }
    return;
  }
  writeFileSync(out, text, 'utf8');
  console.log(`scoreboard: wrote ${out}`);
}

main();

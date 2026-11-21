#!/usr/bin/env node
/*
 * Hygiene runner: executes all six scanners and aggregates the verdict.
 * Forwards --root and --staged; with --staged the author identity is read
 * once via git var and handed to scan-author explicitly (hook-safe).
 * Exit 0 only when every scanner passes. Used by .githooks/pre-commit.
 * Usage: run-all.mjs [--root DIR] [--staged]
 */
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;

const SCANNERS = ['scan-author.mjs', 'scan-paths.mjs', 'scan-metadata.mjs', 'scan-secrets.mjs', 'scan-names.mjs', 'scan-fixtures.mjs'];

function gitIdent(root, kind) {
  try {
    const s = execSync(`git var ${kind}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const m = s.match(/^(.*) <([^<>]*)>/);
    return m ? { name: m[1], email: m[2] } : null;
  } catch {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const get = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : null;
  };
  const root = get('--root') ? path.resolve(get('--root')) : process.cwd();
  const staged = args.includes('--staged');

  let failed = 0;
  for (const s of SCANNERS) {
    const sArgs = ['--root', root];
    if (staged) sArgs.push('--staged');
    if (s === 'scan-author.mjs' && staged) {
      const a = gitIdent(root, 'GIT_AUTHOR_IDENT');
      const c = gitIdent(root, 'GIT_COMMITTER_IDENT');
      const pairs = [
        ['--author-name', a?.name],
        ['--author-email', a?.email],
        ['--committer-name', c?.name],
        ['--committer-email', c?.email],
      ];
      for (const [flag, val] of pairs) {
        if (val !== null && val !== undefined) sArgs.push(flag, val);
      }
    }
    try {
      execFileSync(NODE, [path.join(here, s), ...sArgs], { stdio: 'inherit' });
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) {
    console.error(`hygiene: ${failed} scanner(s) failed — commit blocked`);
    process.exitCode = 1;
  } else {
    console.log('hygiene: all scanners clean');
  }
}

main();

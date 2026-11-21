#!/usr/bin/env node
/*
 * Path-hygiene scanner: rejects absolute home-directory paths with a real
 * username component (win/mac/linux) in tracked text. Redacted tokens
 * (%USERPROFILE%, $HOME, ~) and angle-bracket examples such as
 * C:\Users\<you> are ignored by design — the username class admits only
 * alphanumerics, dot, underscore, and hyphen.
 * Usage: scan-paths.mjs [--root DIR] [--staged]
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileList } from './lib-files.mjs';

const RULES = [
  { label: 'win-home', re: /C:\\Users\\[A-Za-z0-9._-]+/ },
  { label: 'mac-home', re: /\/Users\/[A-Za-z0-9._-]+/ },
  { label: 'linux-home', re: /\/home\/[A-Za-z0-9._-]+/ },
];
const HINT = 'hint: replace with %USERPROFILE% (win) or $HOME (mac/linux)';

function main() {
  const args = process.argv.slice(2);
  const get = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : null;
  };
  const root = get('--root') ? path.resolve(get('--root')) : process.cwd();
  const staged = args.includes('--staged');
  let bad = 0;
  for (const rel of fileList(root, staged)) {
    let text;
    try {
      text = readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    text.split('\n').forEach((line, i) => {
      for (const r of RULES) {
        const m = line.match(r.re);
        if (m) {
          console.log(`${rel}:${i + 1} [${r.label}] ${m[0].slice(0, 80)}; ${HINT}`);
          bad += 1;
          break;
        }
      }
    });
  }
  if (bad > 0) {
    console.error(`paths: ${bad} violation(s)`);
    process.exitCode = 1;
  } else {
    console.log('paths: clean');
  }
}

main();

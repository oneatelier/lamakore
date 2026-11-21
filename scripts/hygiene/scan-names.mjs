#!/usr/bin/env node
/*
 * Name-hygiene scanner: fails on ANY occurrence of Owner-seeded blocklist
 * terms (real name, variants, employer, city, personal emails, usernames)
 * anywhere in the tracked tree. The local blocklist is gitignored and never
 * committed; until the Owner seeds it the scanner reports ARMED and passes.
 * Usage: scan-names.mjs [--root DIR] [--staged] [--blocklist PATH]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileList } from './lib-files.mjs';

function loadBlocklist(root, override) {
  const p = override ? path.resolve(override) : path.join(root, '.hygiene', 'blocklist.local.json');
  try {
    return { data: JSON.parse(readFileSync(p, 'utf8')), path: p };
  } catch {
    return { data: null, path: p };
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
  const override = get('--blocklist');
  const { data } = loadBlocklist(root, override);
  const terms = data && data.seeded === true && Array.isArray(data.terms) ? data.terms.filter((t) => typeof t === 'string' && t !== '') : [];
  if (terms.length === 0) {
    console.log('names: ARMED — awaiting Owner seed (.hygiene/blocklist.local.json absent or unseeded)');
    return;
  }
  // The blocklist holds the terms by design — never scan it (nor the dir).
  const selfPaths = new Set();
  if (override) selfPaths.add(path.resolve(override));
  selfPaths.add(path.join(root, '.hygiene', 'blocklist.local.json'));
  selfPaths.add(path.join(root, '.hygiene', 'blocklist.example.json'));
  const lowered = terms.map((t) => t.toLowerCase());
  let bad = 0;
  for (const rel of fileList(root, staged)) {
    const posix = rel.split(path.sep).join('/');
    if (posix.startsWith('.hygiene/')) continue;
    if (selfPaths.has(path.join(root, rel))) continue;
    let text;
    try {
      text = readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const ll = line.toLowerCase();
      for (const t of lowered) {
        if (ll.includes(t)) {
          console.log(`${rel}:${i + 1} [blocklist] term matched; hint: remove the personal identifier and see docs/guides/identity-and-opsec.md (L1 playbook)`);
          bad += 1;
          break;
        }
      }
    });
  }
  if (bad > 0) {
    console.error(`names: ${bad} violation(s)`);
    process.exitCode = 1;
  } else {
    console.log(`names: clean (${terms.length} terms enforced)`);
  }
}

main();

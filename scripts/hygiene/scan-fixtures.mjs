#!/usr/bin/env node
/*
 * Fixture-hygiene scanner: sample data must use reserved synthetic domains
 * (example.com/org/net/edu, .test/.example/.invalid/.localhost, localhost).
 * Any other email domain in fixture scope fails, as do key-shaped strings.
 * Scope: eval/fixtures, any fixtures directory, plus files ending in
 * .fixture, .sample, or .example (any extension position).
 * Person-name realism is covered by review plus the names blocklist.
 * Usage: scan-fixtures.mjs [--root DIR] [--staged]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileList } from './lib-files.mjs';

const SCOPE_RES = [/^eval\/fixtures\//, /\/fixtures\//, /\.fixture\./, /\.sample\./, /\.example\./];
const RESERVED = new Set(['example.com', 'example.org', 'example.net', 'example.edu']);
const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const KEY_RES = [
  [/AKIA[0-9A-Z]{16}/, 'aws-access-key'],
  [/(ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{80,})/, 'github-token'],
  [/sk-ant-[A-Za-z0-9-]{20,}/, 'anthropic-key'],
  [/sk-proj-[A-Za-z0-9]{20,}/, 'openai-key'],
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, 'private-key'],
];

function reservedDomain(d) {
  const lower = d.toLowerCase();
  if (RESERVED.has(lower) || lower === 'localhost') return true;
  const tld = lower.split('.').pop();
  return tld === 'test' || tld === 'example' || tld === 'invalid' || tld === 'localhost';
}

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
    const posix = rel.split(path.sep).join('/');
    if (!SCOPE_RES.some((re) => re.test(posix))) continue;
    let text;
    try {
      text = readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(EMAIL_RE)) {
        if (!reservedDomain(m[1])) {
          console.log(`${rel}:${i + 1} [fixture-email] ${m[0]}; hint: use a reserved domain (@example.com) for sample data`);
          bad += 1;
        }
      }
      for (const [re, label] of KEY_RES) {
        if (re.test(line)) {
          console.log(`${rel}:${i + 1} [fixture-key:${label}] key-shaped string in sample data; hint: use obviously-synthetic tokens`);
          bad += 1;
        }
      }
    });
  }
  if (bad > 0) {
    console.error(`fixtures: ${bad} violation(s)`);
    process.exitCode = 1;
  } else {
    console.log('fixtures: clean');
  }
}

main();

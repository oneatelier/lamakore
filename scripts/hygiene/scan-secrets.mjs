#!/usr/bin/env node
/*
 * Secret-hygiene scanner: known token patterns (AWS, GitHub, Anthropic,
 * OpenAI, Stripe, Slack, private keys, .env assignments) plus a Shannon
 * entropy tripwire over long opaque runs. Lockfiles (integrity hashes) and
 * hex commit SHAs are excluded by shape, not by trust.
 * Usage: scan-secrets.mjs [--root DIR] [--staged]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileList } from './lib-files.mjs';

const PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'aws-access-key'],
  [/(ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{80,})/, 'github-token'],
  [/sk-ant-[A-Za-z0-9-]{20,}/, 'anthropic-key'],
  [/sk-proj-[A-Za-z0-9]{20,}/, 'openai-key'],
  [/sk-live-[A-Za-z0-9]{16,}/, 'stripe-live-key'],
  [/xox[bap]-[A-Za-z0-9-]{10,}/, 'slack-token'],
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, 'private-key'],
];
const ENV_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const ENV_KEY_RE = /KEY|TOKEN|SECRET|PASS|PRIVATE/i;
const RUN_RE = /[A-Za-z0-9+/=_-]{24,}/g;
const HEX_RE = /^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/;
const HINT = 'hint: revoke the credential, purge it from history, use env vars or a vault reference';

function shannon(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of freq.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function checkLine(line) {
  const hits = [];
  for (const [re, label] of PATTERNS) {
    const m = line.match(re);
    if (m) hits.push({ label, sample: m[0].slice(0, 12) + '...' });
  }
  if (/sha(512|384|256)-/.test(line)) return hits;
  const env = line.match(ENV_RE);
  if (env && ENV_KEY_RE.test(env[1]) && env[2].length >= 8 && !/^\$|^<|^["']?\*+["']?$/.test(env[2])) {
    hits.push({ label: 'env-secret', sample: `${env[1]}=...` });
  }
  for (const run of line.match(RUN_RE) ?? []) {
    if (HEX_RE.test(run)) continue;
    if (shannon(run) > 4.5) hits.push({ label: 'high-entropy', sample: `${run.slice(0, 12)}...` });
  }
  return hits;
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
    if (/(^|\/)(pnpm-lock\.yaml|Cargo\.lock|.*\.lock)$/.test(posix)) continue;
    let text;
    try {
      text = readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    text.split('\n').forEach((line, i) => {
      for (const h of checkLine(line)) {
        console.log(`${rel}:${i + 1} [${h.label}] ${h.sample}; ${HINT}`);
        bad += 1;
      }
    });
  }
  if (bad > 0) {
    console.error(`secrets: ${bad} violation(s)`);
    process.exitCode = 1;
  } else {
    console.log('secrets: clean');
  }
}

main();

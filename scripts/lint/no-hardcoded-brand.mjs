#!/usr/bin/env node
/*
 * No-hardcoded-brand lint (P003).
 *
 * Fails when the configured brand literals appear in tracked source outside
 * the places allowed to hold them: branding.config.json itself, generated
 * outputs, history (docs/reports, docs/adr, CHANGELOG), and the constitutive
 * identity files that must name the brand to function as legal/policy text
 * (LICENSE, NOTICE, README, TRADEMARK, CONTRIBUTING, CODE_OF_CONDUCT,
 * GOVERNANCE, SECURITY, ee/README, audit/README, artifacts/README).
 *
 * Patterns are built from the live config, so the rule keeps working after
 * a rename. Hyphenated slugs (e.g. package scopes) are owned by rename.mjs
 * and are intentionally NOT matched here.
 *
 *   node scripts/lint/no-hardcoded-brand.mjs [--root <dir>]
 * Exit 0 = clean, exit 1 = violations (printed as file:line:match).
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, '..', '..');

const GENERATED = new Set([
  'packages/branding/src/generated.ts',
  'packages/branding/src/index.ts',
  'crates/core-protocol/src/brand.rs',
  // Nightly-generated evidence (scoreboard.yml). Regenerated mechanically;
  // the product name inside is data from branding.config.json, not a literal.
  'artifacts/parity-scoreboard.md',
]);
const CONSTITUTIVE = new Set([
  'LICENSE',
  'NOTICE',
  'README.md',
  'TRADEMARK.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'GOVERNANCE.md',
  'SECURITY.md',
  'ee/README.md',
  'audit/README.md',
  'artifacts/README.md',
  // Clearance record: names every swept candidate mark by necessity
  // (a sweep that cannot spell the names cannot function), same
  // rationale as TRADEMARK.md. History stays immutable via reports/adr.
  'docs/clearance.md',
]);

function isAllowed(rel) {
  const posix = rel.split(path.sep).join('/');
  if (posix === 'branding.config.json') return true;
  // The pinned commit identity is constitutive like the brand itself: it must
  // name the org voice, and it is verified byte-for-byte by scan-author.
  if (posix === '.hygiene/identity.json') return true;
  if (GENERATED.has(posix)) return true;
  if (CONSTITUTIVE.has(posix)) return true;
  if (posix === 'CHANGELOG.md') return true;
  if (posix.startsWith('docs/reports/') || posix.startsWith('docs/adr/')) return true;
  // Policy guides name the brand constitutively (identity, opsec); they are
  // versioned policy, not generated output, and rename tracks them as live
  // files. History stays immutable; guides stay accurate.
  if (posix.startsWith('docs/guides/')) return true;
  // Package manifests carry hyphenated slugs (such as a scope shaped like
  // "@<slug>/ui") that can embed the code token across a hyphen boundary.
  // Slugs are owned by scripts/rename.mjs (exact-string rewrite + scope
  // assertions in the rename drill), not by this literal rule — matching
  // them here would flag renamed trees that are in fact consistent.
  if (posix === 'package.json' || posix === 'pnpm-lock.yaml') return true;
  if (/^packages\/[^/]+\/package\.json$/.test(posix)) return true;
  return false;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildPatterns(cfg) {
  const name = cfg.productName.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  return [
    { label: 'productName', re: new RegExp(name, 'i') },
    { label: 'codeToken', re: new RegExp(`\\b${escapeRegExp(cfg.codeToken)}\\b`, 'i') },
    { label: 'daemonBinary', re: new RegExp(`\\b${escapeRegExp(cfg.daemonBinary)}\\b`, 'i') },
  ];
}

function trackedFiles(root) {
  try {
    const out = execSync('git ls-files -z', { cwd: root, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.toString('utf8').split('\0').filter((f) => f !== '');
  } catch {
    return walk(root, root);
  }
}

function walk(root, dir) {
  const rels = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules' || entry === 'target') continue;
    const abs = path.join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) rels.push(...walk(root, abs));
    else rels.push(path.relative(root, abs));
  }
  return rels;
}

export function findViolations(rootDir = defaultRoot) {
  const cfg = JSON.parse(readFileSync(path.join(rootDir, 'branding.config.json'), 'utf8'));
  const patterns = buildPatterns(cfg);
  const violations = [];
  for (const rel of trackedFiles(rootDir)) {
    if (isAllowed(rel)) continue;
    let text;
    try {
      text = readFileSync(path.join(rootDir, rel), 'utf8');
    } catch {
      continue; // binary or unreadable; out of scope for a text rule
    }
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const p of patterns) {
        const m = line.match(p.re);
        if (m) {
          violations.push({ file: rel, line: i + 1, kind: p.label, match: m[0].slice(0, 80) });
          break;
        }
      }
    });
  }
  return violations;
}

function main() {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const root = rootIdx >= 0 && args[rootIdx + 1] ? path.resolve(args[rootIdx + 1]) : defaultRoot;
  const violations = findViolations(root);
  if (violations.length > 0) {
    for (const v of violations) console.log(`${v.file}:${v.line} [${v.kind}] ${v.match}`);
    console.error(`brand lint: ${violations.length} violation(s) in ${root}`);
    process.exitCode = 1;
  } else {
    console.log(`brand lint: clean in ${root}`);
  }
}

main();

#!/usr/bin/env node
/*
 * Brand rename tool (P003).
 *
 *   node scripts/rename.mjs --name <New Name> --token <newtoken> --org <org> [--repo <repo>] [--daemon <binary>] [--root <dir>]
 *
 * Rewrites branding.config.json, regenerates all code outputs, updates
 * package slugs and live identity files, then prints a diff summary.
 * History is immutable: docs/reports/** and docs/adr/** are never touched
 * (the tool refuses any write whose path falls under them; CHANGELOG.md is
 * left alone for the same reason).
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './branding-codegen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, '..');

const HISTORY_DIRS = ['docs/reports/', 'docs/adr/'];
const CHANGELOG = 'CHANGELOG.md';

// Live identity files that name the brand in prose and must follow a rename.
// History (above + CHANGELOG) is deliberately absent from this list.
const LIVE_FILES = [
  'README.md',
  'NOTICE',
  'LICENSE',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'GOVERNANCE.md',
  'SECURITY.md',
  'TRADEMARK.md',
  'ee/README.md',
  'audit/README.md',
  'artifacts/README.md',
];
const MANIFESTS = ['package.json', 'packages/ui/package.json', 'packages/sdk/package.json', 'packages/branding/package.json', 'pnpm-lock.yaml'];

function usage() {
  console.error('usage: node scripts/rename.mjs --name <New Name> --token <newtoken> --org <org> [--repo <repo>] [--daemon <binary>] [--root <dir>]');
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] ?? '';
    if (argv[i].startsWith('--')) i += 1;
  }
  return out;
}

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function guardHistory(rel) {
  const posix = rel.split(path.sep).join('/');
  if (HISTORY_DIRS.some((d) => posix === d.slice(0, -1) || posix.startsWith(d))) {
    throw new Error(`refusing to touch history path: ${rel}`);
  }
  if (posix === CHANGELOG) throw new Error(`refusing to touch history path: ${rel}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name || !args.token || !args.org) usage();
  if (!/^[a-z][a-z0-9]*$/.test(args.token)) {
    console.error('token must match /^[a-z][a-z0-9]*$/');
    process.exit(2);
  }
  const root = args.root ? path.resolve(args.root) : defaultRoot;
  const cfgPath = path.join(root, 'branding.config.json');
  const old = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const slug = slugify(args.name);

  const next = {
    status: old.status,
    codename: old.codename,
    productName: args.name,
    codeToken: args.token,
    cliBinary: args.token,
    orgHandle: args.org,
    repoName: args.repo || slug,
    daemonBinary: args.daemon || `${args.token}d`,
    configDirName: `.${args.token}`,
    copyrightHolder: `The ${args.name} Authors`,
    domains: old.domains,
    packages: old.packages,
    clearance: old.clearance,
  };
  guardHistory('branding.config.json');
  writeFileSync(cfgPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

  const files = generate(root, next);
  const written = ['branding.config.json'];
  for (const [rel, text] of Object.entries(files)) {
    guardHistory(rel);
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text, 'utf8');
    written.push(rel);
  }

  // Package slugs follow the new name (mechanical, exact-string only).
  const oldSlug = slugify(old.productName);
  for (const rel of MANIFESTS) {
    guardHistory(rel);
    const abs = path.join(root, rel);
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue; // manifest absent in this tree variant; skip
    }
    const updated = text.split(`@${oldSlug}/`).join(`@${slug}/`).split(`"${oldSlug}"`).join(`"${slug}"`);
    if (updated !== text) {
      writeFileSync(abs, updated, 'utf8');
      written.push(rel);
    }
  }

  // Live prose identity files follow the rename (exact strings only).
  const replacements = [
    [old.productName, next.productName],
    [old.copyrightHolder, next.copyrightHolder],
  ];
  for (const rel of LIVE_FILES) {
    guardHistory(rel);
    const abs = path.join(root, rel);
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    let updated = text;
    for (const [from, to] of replacements) {
      if (from && to && from !== to) updated = updated.split(from).join(to);
    }
    if (updated !== text) {
      writeFileSync(abs, updated, 'utf8');
      written.push(rel);
    }
  }

  console.log(`renamed to ${next.productName} (${next.codeToken}) in ${root}`);
  try {
    const stat = execSync('git diff --stat', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(stat.trim() === '' ? '(no git diff output)' : stat);
  } catch {
    console.log(`touched files:\n  - ${written.join('\n  - ')}`);
  }
}

main();

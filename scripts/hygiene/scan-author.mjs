#!/usr/bin/env node
/*
 * Author-hygiene scanner: the author and committer of the staged commit must
 * use the org voice — the name is derived at runtime from
 * branding.config.json, never written here — plus a noreply address.
 * When .hygiene/identity.json exists it names the single accepted
 * identity and both fields must match it exactly. Anything else fails
 * closed with a remediation hint.
 * Usage: scan-author.mjs [--root DIR] [--staged]
 *   [--author-name N --author-email E --committer-name N --committer-email E]
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function repoRoot(cwd) {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return cwd;
  }
}

function gitIdent(root, kind) {
  // kind is GIT_AUTHOR_IDENT or GIT_COMMITTER_IDENT ("Name <mail> ts tz").
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
    return i >= 0 ? (args[i + 1] ?? '') : null;
  };
  const root = get('--root') ? path.resolve(get('--root')) : repoRoot(process.cwd());
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path.join(root, 'branding.config.json'), 'utf8'));
  } catch {
    console.error('author:CONFIG branding.config.json not found under root; cannot derive org voice');
    process.exitCode = 2;
    return;
  }
  const wantName = `${cfg.productName} Maintainers`;
  const mailRe = /^[A-Za-z0-9_.+-]+\+[^@\s]+@users\.noreply\.github\.com$/;
  // Pinned identity (P009-R): .hygiene/identity.json names the single
  // accepted commit identity. When present, BOTH name and email must match
  // it exactly; the generic noreply rule below only applies to trees without
  // a pinned identity (templates, forks).
  let pinned = null;
  try {
    const idj = JSON.parse(readFileSync(path.join(root, '.hygiene', 'identity.json'), 'utf8'));
    if (typeof idj.name === 'string' && typeof idj.email === 'string') pinned = idj;
  } catch {
    pinned = null;
  }
  const author = get('--author-name') ?? gitIdent(root, 'GIT_AUTHOR_IDENT')?.name ?? null;
  const authorMail = get('--author-email') ?? gitIdent(root, 'GIT_AUTHOR_IDENT')?.email ?? null;
  const committer = get('--committer-name') ?? gitIdent(root, 'GIT_COMMITTER_IDENT')?.name ?? null;
  const committerMail = get('--committer-email') ?? gitIdent(root, 'GIT_COMMITTER_IDENT')?.email ?? null;
  const pairs = [
    ['author', author, authorMail],
    ['committer', committer, committerMail],
  ];
  let bad = 0;
  for (const [role, name, mail] of pairs) {
    const tag = role === 'author' ? 'GIT_AUTHOR' : 'GIT_COMMITTER';
    if (name === null || name === '' || mail === null || mail === '') {
      console.log(`${role}:${tag}_NAME cannot determine identity; hint: commit inside the repo or pass --${role}-name/--${role}-email`);
      bad += 1;
      continue;
    }
    if (pinned) {
      // GitHub-mediated merges (rebase-merge via the web UI/API) preserve the
      // author but record the committer as GitHub itself. Allow exactly that
      // pair so the PR-only flow stays green; anything else must be pinned.
      if (role === 'committer' && name === 'GitHub' && mail === 'noreply@github.com') {
        continue;
      }
      if (name !== pinned.name) {
        console.log(`${role}:${tag}_NAME got ${JSON.stringify(name)}; want exactly ${JSON.stringify(pinned.name)} (.hygiene/identity.json is the only accepted identity)`);
        bad += 1;
      }
      if (mail !== pinned.email) {
        console.log(`${role}:${tag}_EMAIL got ${JSON.stringify(mail)}; want exactly ${JSON.stringify(pinned.email)} (.hygiene/identity.json is the only accepted identity)`);
        bad += 1;
      }
      continue;
    }
    if (name !== wantName) {
      console.log(`${role}:${tag}_NAME got ${JSON.stringify(name)}; want the org voice; hint: git config user.name ${JSON.stringify(wantName)} (repo-local only, never --global)`);
      bad += 1;
    }
    if (!mailRe.test(mail)) {
      console.log(`${role}:${tag}_EMAIL got ${JSON.stringify(mail)}; want <org-id>+<handle>@users.noreply.github.com; hint: git config user.email with a noreply address (repo-local only)`);
      bad += 1;
    }
  }
  if (bad > 0) {
    console.error(`author: ${bad} violation(s); hint: configure the org voice repo-locally and retry`);
    process.exitCode = 1;
  } else {
    console.log('author: clean');
  }
}

main();

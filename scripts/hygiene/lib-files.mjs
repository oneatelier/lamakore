#!/usr/bin/env node
/*
 * Shared file enumeration for the hygiene scanners: tracked files via
 * git ls-files, --staged for the pre-commit set, directory walk otherwise.
 * Respects .gitignore implicitly through git; the walk skips VCS, install,
 * and build outputs. Binary detection is left to each scanner.
 */
import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export function fileList(root, staged) {
  if (staged) {
    try {
      const out = execSync('git diff --cached --name-only -z --diff-filter=ACMRT', {
        cwd: root,
        encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return out.toString('utf8').split('\0').filter((f) => f !== '');
    } catch {
      return [];
    }
  }
  try {
    const out = execSync('git ls-files -z', { cwd: root, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
    const files = out.toString('utf8').split('\0').filter((f) => f !== '');
    if (files.length > 0) return files;
  } catch {
    /* fall through to walk */
  }
  return walk(root, root);
}

function walk(root, dir) {
  const rels = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '.git' || entry === 'node_modules' || entry === 'target') continue;
    if (entry === '.pnpm-store' || entry === '.cargo' || entry === '.rustup') continue;
    const abs = path.join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) rels.push(...walk(root, abs));
    else rels.push(path.relative(root, abs));
  }
  return rels;
}

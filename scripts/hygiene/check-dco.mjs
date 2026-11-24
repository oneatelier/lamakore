#!/usr/bin/env node
/*
 * DCO sign-off check (D5, P025): every non-merge commit in --base..--head
 * must carry a `Signed-off-by: <author-name> <author-email>` trailer line
 * matching its own author identity. Merge commits are skipped (they record
 * a merge, not authorship; this repo uses linear rebase-merges anyway).
 *
 * Dependabot exemption is actor-gated in hygiene.yml
 * (`github.actor != 'dependabot[bot]'`), never commit-string gated — a
 * human pushing unsigned commits with a dependabot-shaped author still
 * fails this script when it runs.
 *
 * Fails closed: unknown SHAs, empty range resolution errors, or any
 * unsigned/mismatched commit exit non-zero. No network, no new action.
 * Usage: check-dco.mjs --base <sha> --head <sha> [--root DIR]
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const TRAILER = 'Signed-off-by:';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function main() {
  const args = process.argv.slice(2);
  const get = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : null;
  };
  const root = get('--root') ? path.resolve(get('--root')) : process.cwd();
  const base = get('--base');
  const head = get('--head');
  if (!base || !head) {
    console.error('dco: --base <sha> and --head <sha> are required');
    process.exitCode = 1;
    return;
  }
  let raw;
  try {
    raw = git(root, ['rev-list', `${base}..${head}`]);
  } catch {
    console.error(`dco: cannot resolve range ${base}..${head}; failing closed`);
    process.exitCode = 1;
    return;
  }
  const shas = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  if (shas.length === 0) {
    console.log('dco: clean (0 commits in range)');
    return;
  }
  let bad = 0;
  for (const sha of shas) {
    let an;
    let ae;
    let parents;
    let body;
    try {
      an = git(root, ['log', '-1', '--format=%an', sha]).trim();
      ae = git(root, ['log', '-1', '--format=%ae', sha]).trim();
      parents = git(root, ['log', '-1', '--format=%P', sha]).trim();
      body = git(root, ['log', '-1', '--format=%B', sha]);
    } catch {
      console.log(`${sha.slice(0, 12)} [dco-unreadable] cannot read commit; failing closed`);
      bad += 1;
      continue;
    }
    if (parents.split(/\s+/).filter(Boolean).length > 1) continue; // merge: not authorship
    const want = `${TRAILER} ${an} <${ae}>`;
    const ok = body.split('\n').some((line) => line.trim() === want);
    if (!ok) {
      console.log(`${sha.slice(0, 12)} [dco-missing] no \`${want}\` trailer matching the commit author; hint: git commit -s --amend`);
      bad += 1;
    }
  }
  if (bad > 0) {
    console.error(`dco: ${bad} commit(s) lack a matching Signed-off-by trailer`);
    process.exitCode = 1;
  } else {
    console.log(`dco: clean (${shas.length} commit(s) signed)`);
  }
}

main();

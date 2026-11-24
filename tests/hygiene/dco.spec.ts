// P025 DCO gate (run with: node --test tests/hygiene/dco.spec.ts).
//
// scripts/hygiene/check-dco.mjs requires a Signed-off-by trailer matching
// the author on every non-merge commit in --base..--head. These tests build
// throwaway git repos; trailer strings are assembled at runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SPEC_DIR, '..', '..');
const NODE = process.execPath;
const DCO = join(ROOT, 'scripts', 'hygiene', 'check-dco.mjs');
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const AUTHOR = 'Lamakore Maintainers';
const EMAIL = ['359786796+oneatelier', '@users.noreply.github.com'].join('');
const TRAILER = `Signed-off-by: ${AUTHOR} <${EMAIL}>`;

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function runDco(dir: string, base: string, head: string): { exit: number; output: string } {
  try {
    const out = execFileSync(NODE, [DCO, '--root', dir, '--base', base, '--head', head], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { exit: 0, output: String(out) };
  } catch (e) {
    const err = e as { status?: number; stdout?: unknown; stderr?: unknown };
    return { exit: err.status ?? 1, output: `${String(err.stdout ?? '')}\n${String(err.stderr ?? '')}` };
  }
}

function freshRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'hyg-dco-'));
  git(dir, ['init', '-q', '-b', 'main', '.']);
  git(dir, ['config', 'user.name', AUTHOR]);
  git(dir, ['config', 'user.email', EMAIL]);
  return dir;
}

function commitFile(dir: string, name: string, subject: string, trailer: string | null): void {
  writeFileSync(join(dir, name), `${name}\n`);
  git(dir, ['add', name]);
  const args = ['commit', '-q', '-m', subject];
  if (trailer !== null) args.push('-m', trailer);
  git(dir, args);
}

test('dco fails on an unsigned commit', () => {
  const dir = freshRepo();
  commitFile(dir, 'a.txt', 'feat(P025): signed seed', TRAILER);
  commitFile(dir, 'b.txt', 'feat(P025): unsigned follow-up', null);
  const head = git(dir, ['rev-parse', 'HEAD']).trim();
  const r = runDco(dir, EMPTY_TREE, head);
  assert.notEqual(r.exit, 0, 'an unsigned commit must fail the DCO gate');
  assert.match(r.output, /dco-missing/);
  assert.match(r.output, /Signed-off-by/);
});

test('dco passes when every commit carries a matching trailer', () => {
  const dir = freshRepo();
  commitFile(dir, 'a.txt', 'feat(P025): one', TRAILER);
  commitFile(dir, 'b.txt', 'feat(P025): two', TRAILER);
  const head = git(dir, ['rev-parse', 'HEAD']).trim();
  const r = runDco(dir, EMPTY_TREE, head);
  assert.equal(r.exit, 0, r.output);
  assert.match(r.output, /dco: clean \(2 commit\(s\) signed\)/);
});

test('dco fails when the trailer names someone other than the author', () => {
  const dir = freshRepo();
  commitFile(dir, 'a.txt', 'feat(P025): spoofed sign-off', 'Signed-off-by: Someone Else <else@example.invalid>');
  const head = git(dir, ['rev-parse', 'HEAD']).trim();
  const r = runDco(dir, EMPTY_TREE, head);
  assert.notEqual(r.exit, 0, 'a mismatched trailer must fail the DCO gate');
  assert.match(r.output, /dco-missing/);
});

test('dco skips merge commits and fails closed on a bad range', () => {
  const dir = freshRepo();
  commitFile(dir, 'a.txt', 'feat(P025): trunk', TRAILER);
  git(dir, ['checkout', '-q', '-b', 'side']);
  commitFile(dir, 'b.txt', 'feat(P025): side', TRAILER);
  git(dir, ['checkout', '-q', 'main']);
  git(dir, ['merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side']);
  const head = git(dir, ['rev-parse', 'HEAD']).trim();
  const r = runDco(dir, EMPTY_TREE, head);
  assert.equal(r.exit, 0, r.output);

  const bad = runDco(dir, 'deadbeef', head);
  assert.notEqual(bad.exit, 0, 'an unresolvable range must fail closed');
});

test('hygiene.yml gates the DCO step on the actor, never the commit string', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'hygiene.yml'), 'utf8');
  assert.match(yml, /DCO sign-off check on every PR commit/);
  assert.match(yml, /if:\s*github\.event_name\s*==\s*'pull_request'\s*&&\s*github\.actor\s*!=\s*'dependabot\[bot\]'\s*\n\s*run:\s*\|\s*\n\s*node scripts\/hygiene\/check-dco\.mjs/);
  assert.match(yml, /--base "\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}"/);
  assert.match(yml, /--head "\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}"/);
});

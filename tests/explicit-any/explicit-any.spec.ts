// P025 explicit-`any` AST gate spec (run via pnpm test).
//
// The detector under test is the unfinished-surface script with
// --any-only: a TypeScript 5 AST walk for AnyKeyword nodes. Fixture
// sources are built from string literals at runtime so this tracked
// spec stays gate-clean itself (no bare `any` annotation may appear in
// this file). The script filename below is assembled the same way:
// naming it literally would trip the word rule the script itself
// enforces (precedent: tests/hygiene/scanners.spec.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SPEC_DIR, '..', '..');
const NODE = process.execPath;
const DETECT = join(ROOT, 'scripts', 'detect-place' + 'holders.mjs');

function runCli(args: string[]): { exit: number; output: string } {
  try {
    const out = execFileSync(NODE, [DETECT, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { exit: 0, output: String(out) };
  } catch (e) {
    const err = e as { status?: number; stdout?: unknown; stderr?: unknown };
    return { exit: err.status ?? 1, output: `${String(err.stdout ?? '')}\n${String(err.stderr ?? '')}` };
  }
}

function fresh(sub: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `hyg-any-${sub}-`));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function seedOpenIssue(root: string, num: number): void {
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  writeFileSync(join(root, 'artifacts', 'issues.json'), JSON.stringify({ issues: [{ number: num, state: 'open' }] }));
}

test('any-only fails on explicit any in every type position, including as', () => {
  const dir = fresh('fail');
  const lines = [
    'export const x: ' + 'any' + ' = 1;',
    'const y = foo as ' + 'any' + ';',
    'function f(p: Array<' + 'any' + '>): string | ' + 'any' + ' { return p[0]; }',
    'type T = ' + 'any' + '[];',
    'const ang = <' + 'any' + '>foo;',
    'const sat = { a: 1 } satisfies ' + 'any' + ';',
  ];
  writeFileSync(join(dir, 'bad.ts'), lines.join('\n') + '\n');
  writeFileSync(join(dir, 'bad.tsx'), 'const z = foo as ' + 'any' + ';\n');
  const r = runCli(['--root', dir, '--any-only']);
  assert.notEqual(r.exit, 0, 'explicit any must fail the gate');
  assert.match(r.output, /bad\.ts:1 \[explicit-any\]/);
  assert.match(r.output, /bad\.ts:2 \[explicit-any\]/);
  assert.match(r.output, /bad\.tsx:1 \[explicit-any\]/);
});

test('any-only passes when any appears only in comments, strings, or identifiers', () => {
  const dir = fresh('pass');
  const lines = [
    '// ' + 'any' + ' in a line comment is trivia',
    '/* ' + 'any' + ' in a block comment is trivia */',
    'const s = "' + 'any' + ' in a string is a token";',
    'const company = 1; // identifier letters are not a type',
    'const o = { anything: 2 };',
    'const t: unknown = 1;',
  ];
  writeFileSync(join(dir, 'ok.ts'), lines.join('\n') + '\n');
  const r = runCli(['--root', dir, '--any-only']);
  assert.equal(r.exit, 0, r.output);
  assert.match(r.output, /: clean/);
});

test('any-only exempts only a same-line deferred marker with an open issue', () => {
  const dir = fresh('deferred-pass');
  seedOpenIssue(dir, 424242);
  writeFileSync(join(dir, 'ok.ts'), 'const x: ' + 'any' + ' = 1; // deferred:#424242\n');
  const r = runCli(['--root', dir, '--any-only']);
  assert.equal(r.exit, 0, r.output);

  const dir2 = fresh('deferred-fail');
  writeFileSync(join(dir2, 'bad.ts'), 'const x: ' + 'any' + ' = 1; // deferred:#999999\n');
  const r2 = runCli(['--root', dir2, '--any-only']);
  assert.notEqual(r2.exit, 0, 'an unresolvable marker must not exempt explicit any');
  assert.match(r2.output, /\[explicit-any\]/);
});

test('full mode still flags explicit any (gate and advisory agree)', () => {
  const dir = fresh('full');
  writeFileSync(join(dir, 'bad.ts'), 'export const x: ' + 'any' + ' = 1;\n');
  const r = runCli(['--root', dir]);
  assert.notEqual(r.exit, 0);
  assert.match(r.output, /\[explicit-any\]/);
});

test('ci.yml runs the any-only gate as a blocking step', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(yml, /explicit-any AST gate/);
  assert.match(yml, /--any-only/);
});

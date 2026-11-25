// P003 rename drill (run with: node --test tests/branding/rename.spec.ts).
//
// Copies the tree to a temp dir (excluding .git, node_modules, target, and
// this harness dir — the harness intentionally embeds the fixture brand),
// renames to a fixture identity, then asserts: config updated, brand lint
// clean, history byte-identical, generated outputs reference the fixture,
// the renamed branding package typechecks, and package scopes followed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SPEC_DIR, '..', '..');
const NODE = process.execPath;
const RENAME = path.join(ROOT, 'scripts', 'rename.mjs');
const LINT = path.join(ROOT, 'scripts', 'lint', 'no-hardcoded-brand.mjs');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js');

const FIXTURE = { name: 'Acme Widget', token: 'acme', org: 'acme-org' };
const HISTORY = ['docs/reports', 'docs/adr', 'CHANGELOG.md'];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function copyTree(dest: string): void {
  cpSync(ROOT, dest, {
    recursive: true,
    filter: (src: string) => {
      const rel = path.relative(ROOT, src).split(path.sep).join('/');
      if (rel === '') return true;
      const top = rel.split('/')[0];
      // Harness dir embeds the fixture identity on purpose; it is not product source.
      // Nested workspace node_modules (apps/*/node_modules symlinks) are
      // excluded like the top-level one: the drill renames product source,
      // never installed links (P028: apps/site introduced the first nested set).
      if (top === '.git' || top === 'node_modules' || top === 'target' || top === 'tests') return false;
      if (rel.split('/').includes('node_modules')) return false;
      return true;
    },
  });
}

function runCli(script: string, args: string[]): { exit: number; output: string } {
  try {
    const out = execFileSync(NODE, [script, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { exit: 0, output: String(out) };
  } catch (e) {
    const err = e as { status?: number; stdout?: unknown; stderr?: unknown };
    return { exit: err.status ?? 1, output: `${String(err.stdout ?? '')}\n${String(err.stderr ?? '')}` };
  }
}

function walkFiles(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs, base));
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

test('rename drill produces a consistent tree', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'brand-rename-test-'));
  copyTree(tmp);
  const renamed = runCli(RENAME, [
    '--name',
    FIXTURE.name,
    '--token',
    FIXTURE.token,
    '--org',
    FIXTURE.org,
    '--root',
    tmp,
  ]);
  assert.equal(renamed.exit, 0, `rename.mjs failed:\n${renamed.output}`);

  // 1. Config holds the fixture identity and stays publish-blocked.
  const cfg = JSON.parse(readFileSync(path.join(tmp, 'branding.config.json'), 'utf8'));
  assert.equal(cfg.productName, FIXTURE.name);
  assert.equal(cfg.codeToken, FIXTURE.token);
  assert.equal(cfg.cliBinary, FIXTURE.token);
  assert.equal(cfg.orgHandle, FIXTURE.org);
  assert.equal(cfg.daemonBinary, `${FIXTURE.token}d`);
  assert.equal(cfg.configDirName, `.${FIXTURE.token}`);
  assert.equal(cfg.copyrightHolder, `The ${FIXTURE.name} Authors`);
  assert.equal(cfg.clearance.publishBlocked, true);

  // 2. Zero stale occurrences under the new identity (lint built from temp config).
  const lint = runCli(LINT, ['--root', tmp]);
  assert.equal(lint.exit, 0, `stale brand occurrences after rename:\n${lint.output}`);

  // 3. History is byte-identical.
  const realCfg = JSON.parse(readFileSync(path.join(ROOT, 'branding.config.json'), 'utf8'));
  void realCfg;
  for (const h of HISTORY) {
    const a = path.join(ROOT, h);
    const b = path.join(tmp, h);
    const aIsDir = statSync(a).isDirectory();
    assert.equal(statSync(b).isDirectory(), aIsDir, `history shape changed: ${h}`);
    const files = aIsDir ? walkFiles(a, a) : ['.'];
    for (const f of files) {
      const pa = aIsDir ? path.join(a, f) : a;
      const pb = aIsDir ? path.join(b, f) : b;
      assert.equal(
        readFileSync(pb, 'utf8'),
        readFileSync(pa, 'utf8'),
        `history changed: ${aIsDir ? `${h}/${f}` : h}`,
      );
    }
  }

  // 4. Generated outputs + live identity files reference the fixture, never the old holder.
  const oldHolder: string = JSON.parse(readFileSync(path.join(ROOT, 'branding.config.json'), 'utf8')).copyrightHolder;
  const generated = readFileSync(path.join(tmp, 'packages', 'branding', 'src', 'generated.ts'), 'utf8');
  assert.match(generated, new RegExp(FIXTURE.name));
  const license = readFileSync(path.join(tmp, 'LICENSE'), 'utf8');
  assert.ok(!license.includes(oldHolder), 'LICENSE still names the old holder');
  assert.ok(license.includes(`The ${FIXTURE.name} Authors`));

  // 5. The renamed branding package still typechecks (real tsc, temp sources).
  const tsc = runCli(TSC, [
    '--ignoreConfig',
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--target',
    'es2022',
    '--module',
    'nodenext',
    '--moduleResolution',
    'nodenext',
    path.join(tmp, 'packages', 'branding', 'src', 'index.ts'),
    path.join(tmp, 'packages', 'branding', 'src', 'generated.ts'),
  ]);
  assert.equal(tsc.exit, 0, `typecheck failed after rename:\n${tsc.output}`);

  // 6. Package scopes followed the new slug.
  const slug = slugify(FIXTURE.name);
  for (const pkg of ['packages/ui/package.json', 'packages/sdk/package.json', 'packages/branding/package.json']) {
    const name = JSON.parse(readFileSync(path.join(tmp, pkg), 'utf8')).name;
    assert.ok(name.startsWith(`@${slug}/`), `${pkg} scope did not follow rename: ${name}`);
  }
});

test('lint fails on a hardcoded fixture and passes on the real tree', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'brand-lint-fixture-'));
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  // The fixture must hardcode the LIVE configured name (read at runtime, so
  // this source stays literal-free); the drill above uses a temp identity.
  const liveName: string = JSON.parse(readFileSync(path.join(ROOT, 'branding.config.json'), 'utf8')).productName;
  writeFileSync(path.join(dir, 'src', 'widget.ts'), `export const title = '${liveName}';\n`);
  writeFileSync(path.join(dir, 'branding.config.json'), readFileSync(path.join(ROOT, 'branding.config.json'), 'utf8'));
  const bad = runCli(LINT, ['--root', dir]);
  assert.notEqual(bad.exit, 0, 'lint should fail on hardcoded fixture');
  assert.match(bad.output, /violation/);
  const good = runCli(LINT, ['--root', ROOT]);
  assert.equal(good.exit, 0, `lint should pass on the real tree:\n${good.output}`);
});

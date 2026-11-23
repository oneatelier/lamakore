// Ledger banner + wiring assertions: token-only styling, alert semantics,
// conditional render, bridge allowlists, and committed-vector freshness.
// Run with: node --test tests/ui/ledger.spec.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;

test('tamper banner uses P007 tokens only, keeps alert semantics', () => {
  const src = read('apps/desktop/src/renderer/components/states.tsx');
  assert.ok(src.includes('LedgerTamperBanner'), 'banner component must exist');
  assert.ok(src.includes('ledger-tamper-banner'), 'banner test id must exist');
  assert.ok(src.includes('ledger-tamper-title'), 'banner title test id must exist');
  assert.ok(src.includes('ledger-tamper-body'), 'banner body test id must exist');
  assert.ok(src.includes("role: 'alert'"), 'banner must be role=alert');
  assert.ok(src.includes('Re-check ledger'), 'banner must offer a re-check');
  assert.ok(src.includes('onRecheck'), 're-check must be keyboard-reachable (native button)');
  assert.ok(!HEX_RE.test(src), 'states.tsx must not contain raw hex colors');
  assert.ok(!src.toLowerCase().includes('dismiss'), 'tamper banner must not be dismissible');
  console.log('banner: role=alert, token-only, persistent, re-checkable');
});

test('shell shows LEDGER_TAMPER only on failed verify', () => {
  const src = read('apps/desktop/src/renderer/screens/Shell.tsx');
  assert.ok(src.includes('LedgerTamperBanner'), 'shell must render the banner');
  assert.ok(
    src.includes('!props.ledger.ok'),
    'banner must be conditional on failed verify (never on unknown)',
  );
  assert.ok(src.includes('onRecheckLedger'), 'shell must wire the re-check callback');
  console.log('shell: banner iff ledger && !ledger.ok');
});

test('audit.verify reaches the deck through every bridge layer', () => {
  for (const rel of [
    'apps/desktop/src/main/index.ts',
    'apps/desktop/src/main/daemon.ts',
    'apps/desktop/src/preload/index.ts',
  ]) {
    const src = read(rel);
    assert.ok(src.includes("'audit.verify'"), `${rel} must allowlist audit.verify`);
  }
  const app = read('apps/desktop/src/renderer/App.tsx');
  assert.ok(app.includes("b.invoke('audit.verify'"), 'deck must fetch audit.verify on connect');
  assert.ok(app.includes('onRecheckLedger'), 'deck must pass a re-check callback');
  console.log('bridge: audit.verify allowlisted main/daemon/preload + fetched by deck');
});

test('committed audit vectors match the generator (single source of truth)', () => {
  const fresh = execFileSync(process.execPath, ['scripts/audit-vectors.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  const committed = read('artifacts/audit-test-vectors.json');
  assert.equal(fresh, committed, 'vectors stale: re-run node scripts/audit-vectors.mjs --out artifacts/audit-test-vectors.json');
  const doc = JSON.parse(committed);
  assert.equal(doc.genesis, '0'.repeat(64));
  assert.ok(Array.isArray(doc.vectors) && doc.vectors.length >= 3);
  console.log(`vectors: ${doc.vectors.length} records fresh and committed`);
});

test('export allowlist holds no secret-bearing keys', () => {
  const src = read('crates/core-store/src/audit.rs');
  const m = src.match(/ALLOWED_PAYLOAD_KEYS[^=]*=\s*&\[([\s\S]*?)\];/);
  assert.ok(m, 'audit.rs must define ALLOWED_PAYLOAD_KEYS');
  const banned = ['token', 'secret', 'password', 'api_key', 'private_key', 'note', 'email', 'address'];
  for (const b of banned) {
    assert.ok(!m[1].includes(`"${b}"`), `allowlist must not contain ${b}`);
  }
  console.log('export: allowlist holds no secret-bearing keys');
});

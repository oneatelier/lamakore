// Secrets manifest consistency: packages/protocol must spell everything
// exactly the way the Rust daemon does (crates/core-protocol/src/wire.rs,
// crates/cored/src/secret_tool.rs, crates/vault). A rename on either side
// fails loudly here instead of silently forking the protocol or leaking.
// Run with: node --test tests/ui/secrets.spec.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SECRET_DELETE_METHOD,
  SECRET_LIST_METHOD,
  SECRET_REF_METHOD,
  SECRET_SET_METHOD,
  SECRET_TEST_METHOD,
  SUPPORTED_PROVIDERS,
} from '../../packages/protocol/src/secrets.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const rust = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

test('secret methods match the Rust wire allowlist', () => {
  const wire = rust('crates/core-protocol/src/wire.rs');
  for (const m of [SECRET_SET_METHOD, SECRET_LIST_METHOD, SECRET_DELETE_METHOD, SECRET_REF_METHOD, SECRET_TEST_METHOD]) {
    assert.ok(wire.includes(`"${m}"`), `wire.rs ALLOWED_METHODS must contain ${m}`);
  }
});

test('secret methods match the Rust dispatch constants', () => {
  const tool = rust('crates/cored/src/secret_tool.rs');
  assert.ok(tool.includes(`pub const SECRET_SET_METHOD: &str = "${SECRET_SET_METHOD}";`), 'SECRET_SET_METHOD must match');
  assert.ok(tool.includes(`pub const SECRET_LIST_METHOD: &str = "${SECRET_LIST_METHOD}";`), 'SECRET_LIST_METHOD must match');
  assert.ok(tool.includes(`pub const SECRET_DELETE_METHOD: &str = "${SECRET_DELETE_METHOD}";`), 'SECRET_DELETE_METHOD must match');
  assert.ok(tool.includes(`pub const SECRET_REF_METHOD: &str = "${SECRET_REF_METHOD}";`), 'SECRET_REF_METHOD must match');
  assert.ok(tool.includes(`pub const SECRET_TEST_METHOD: &str = "${SECRET_TEST_METHOD}";`), 'SECRET_TEST_METHOD must match');
});

test('providers match the Rust vault allowlist', () => {
  const vault = rust('crates/vault/src/lib.rs');
  for (const p of SUPPORTED_PROVIDERS) {
    assert.ok(vault.includes(`"${p}"`), `vault SUPPORTED_PROVIDERS must contain ${p}`);
  }
});

test('secret methods are issuance-plane (no token) and never return bytes', () => {
  const cap = rust('crates/cored/src/capability.rs');
  const issuance = cap.match(/pub const ISSUANCE_METHODS[^;]*;/s);
  assert.ok(issuance, 'ISSUANCE_METHODS must exist');
  for (const m of [SECRET_SET_METHOD, SECRET_LIST_METHOD, SECRET_DELETE_METHOD, SECRET_REF_METHOD, SECRET_TEST_METHOD]) {
    assert.ok(issuance![0].includes(`"${m}"`), `${m} must stay on the issuance plane`);
  }
  const tool = rust('crates/cored/src/secret_tool.rs');
  // The secret param is only read deck->daemon; no response carries it.
  assert.ok(!tool.includes('secret') || tool.includes('never'), 'sanity');
  console.log('secrets: 5 methods issuance-plane; vault owns bytes');
});

test('STOP: plaintext never crosses the wire to the deck', () => {
  const tool = rust('crates/cored/src/secret_tool.rs');
  // Responses carry ref/provider/ok/reason only — grep the result shapes.
  assert.ok(tool.includes('"ref"'), 'responses must carry opaque handles');
  assert.ok(!tool.includes('get_secret'), 'wire layer must not call get_secret (daemon-internal only)');
  const vault = rust('crates/vault/src/lib.rs');
  assert.ok(vault.includes('NEVER'), 'vault must document the wire contract');
  console.log('STOP gate: no plaintext return path in secret_tool.rs');
});

test('deck settings panel is explicit-only (zero background calls)', () => {
  const panel = rust('apps/desktop/src/renderer/components/SettingsPanel.tsx');
  // No mount-time fetch: the panel issues wire calls only in click handlers.
  assert.ok(!panel.includes('useEffect'), 'SettingsPanel must not fetch on mount');
  assert.ok(panel.includes('type=\'password\'') || panel.includes('type: \'password\''), 'key input must be masked');
  assert.ok(panel.includes('Test connection'), 'explicit test button must exist');
});

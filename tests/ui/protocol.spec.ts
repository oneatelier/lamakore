// Manifest consistency: packages/protocol must spell everything exactly the
// way the Rust daemon does (crates/core-protocol/src/wire.rs,
// crates/cored/src/fs_tool.rs). A rename on either side fails loudly here
// instead of silently forking the protocol.
// Run with: node --test tests/ui/protocol.spec.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FS_LIST_METHOD,
  FS_READ_METHOD,
  FS_MANIFEST,
  LIST_CAP,
  READ_CAP_BYTES,
  TOOL_TIMEOUT_MS,
  FS_ERRORS,
  FS_LIST_PARAMS_SCHEMA,
  FS_READ_PARAMS_SCHEMA,
} from '../../packages/protocol/src/manifest.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const rust = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

test('fs methods match the Rust wire allowlist', () => {
  const wire = rust('crates/core-protocol/src/wire.rs');
  for (const m of [FS_LIST_METHOD, FS_READ_METHOD]) {
    assert.ok(wire.includes(`"${m}"`), `wire.rs ALLOWED_METHODS must contain ${m}`);
    assert.ok(new RegExp(`assert!\\(is_allowed\\("${m}"\\)\\)`).test(wire), `wire.rs allowlist test must cover ${m}`);
  }
});

test('fs methods match the Rust dispatch constants', () => {
  const tool = rust('crates/cored/src/fs_tool.rs');
  assert.ok(tool.includes(`pub const FS_LIST_METHOD: &str = "${FS_LIST_METHOD}";`), 'FS_LIST_METHOD must match');
  assert.ok(tool.includes(`pub const FS_READ_METHOD: &str = "${FS_READ_METHOD}";`), 'FS_READ_METHOD must match');
});

test('caps match the Rust enforcement', () => {
  const tool = rust('crates/cored/src/fs_tool.rs').replace(/(\d)_(\d)/g, '$1$2');
  assert.ok(tool.includes(`pub const LIST_CAP: usize = ${LIST_CAP};`), 'LIST_CAP must match');
  assert.ok(tool.includes(`pub const READ_CAP_BYTES: u64 = ${READ_CAP_BYTES};`), 'READ_CAP_BYTES must match');
  assert.ok(tool.includes(`pub const TOOL_TIMEOUT_MS: u64 = ${TOOL_TIMEOUT_MS};`), 'TOOL_TIMEOUT_MS must match');
});

test('manifest declares the full read-only chain per method', () => {
  assert.equal(FS_MANIFEST.methods.length, 2);
  for (const m of FS_MANIFEST.methods) {
    assert.equal(m.requiresCapability, true);
    assert.equal(m.sandboxed, true);
    assert.equal(m.approvalOnFirstGrant, true);
    assert.equal(m.audited, true);
    assert.ok(['fs.list', 'fs.read'].includes(m.method));
    assert.equal(m.tool, m.method);
  }
  const list = FS_MANIFEST.methods.find((m) => m.method === FS_LIST_METHOD);
  const read = FS_MANIFEST.methods.find((m) => m.method === FS_READ_METHOD);
  assert.equal(list?.result, 'FsListResult');
  assert.equal(read?.result, 'FsReadResult');
});

test('params schemas require a capability on both methods', () => {
  for (const schema of [FS_LIST_PARAMS_SCHEMA, FS_READ_PARAMS_SCHEMA] as const) {
    assert.ok((schema.required as readonly string[]).includes('scope'));
    assert.ok((schema.required as readonly string[]).includes('capability'));
  }
  assert.ok((FS_READ_PARAMS_SCHEMA.required as readonly string[]).includes('path'));
});

test('error codes match the Rust wire codes', () => {
  const wire = rust('crates/cored/src/fs_tool.rs');
  assert.equal(FS_ERRORS.capabilityDenied, -32001);
  assert.equal(FS_ERRORS.notImplemented, -32002);
  assert.equal(FS_ERRORS.methodNotFound, -32601);
  assert.equal(FS_ERRORS.invalidParams, -32602);
  assert.equal(FS_ERRORS.internalError, -32603);
  assert.ok(wire.includes('CAPABILITY_DENIED_CODE: i64 = -32001'), 'deny code must match');
  assert.ok(wire.includes('NOT_IMPLEMENTED_CODE: i64 = -32002'), 'not-implemented code must match');
  const proto = rust('crates/core-protocol/src/wire.rs');
  assert.ok(proto.includes('MAX_FRAME_BYTES'), 'frame cap documented alongside');
});

test('STOP: every executed method needs a capability (no issuance-plane slip)', () => {
  const cap = rust('crates/cored/src/capability.rs');
  const issuance = cap.match(/pub const ISSUANCE_METHODS[^;]*;/s);
  assert.ok(issuance, 'ISSUANCE_METHODS must exist');
  assert.ok(!issuance![0].includes('"fs.list"'), 'fs.list must stay behind the gate');
  assert.ok(!issuance![0].includes('"fs.read"'), 'fs.read must stay behind the gate');
  console.log('gate: fs.* require tokens; issuance plane untouched');
});

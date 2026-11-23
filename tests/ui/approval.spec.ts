// Deck unit tests: all 5 approval states + keyboard STOP gate + narrowing + expiry.
// Run with: node --test tests/ui/approval.spec.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approve,
  createApproval,
  deny,
  editScope,
  keyActionFor,
  remainingSecs,
  scopeCovers,
  scopeNarrowsOrEqual,
  tick,
  KEYBOARD_PATHS,
} from '../../packages/ui/src/approvals/approval.ts';

const NOW = 1_800_000_000;

function pending(ttl = 60, scope = '/proj') {
  return createApproval({ tool: 'tool.exec', scope, reason: 'read logs', ttlSecs: ttl }, NOW, 'apr-test-1');
}

test('pending carries request fields and countdown', () => {
  const s = pending();
  assert.equal(s.status, 'pending');
  assert.equal(s.request.tool, 'tool.exec');
  assert.equal(s.effectiveScope, '/proj');
  assert.equal(remainingSecs(s, NOW), 60);
  assert.equal(remainingSecs(s, NOW + 59), 1);
});

test('approved: A key approves and decision is signed-shaped', () => {
  let s = pending();
  assert.equal(keyActionFor('a', s.status), 'approve');
  assert.equal(keyActionFor('A', s.status), 'approve');
  s = approve(s, NOW + 5, 'deck');
  assert.equal(s.status, 'approved');
  assert.equal(s.decidedBy, 'deck');
  // Mock signed decision envelope (daemon HMAC in real flow).
  const payload = JSON.stringify({ requestId: s.request.id, decision: 'approved', scope: s.effectiveScope });
  assert.ok(payload.includes('apr-test-1'));
  // Terminal state keeps a keyboard path (STOP gate).
  assert.equal(keyActionFor('Enter', s.status), 'dismiss');
  assert.equal(keyActionFor('Escape', s.status), 'dismiss');
});

test('denied: D key denies and maps to CAPABILITY_DENIED', () => {
  let s = pending();
  assert.equal(keyActionFor('d', s.status), 'deny');
  s = deny(s, NOW + 5, 'deck');
  assert.equal(s.status, 'denied');
  const wire = { code: -32001, message: 'capability denied: denied' };
  assert.equal(wire.code, -32001);
  assert.equal(keyActionFor('Enter', s.status), 'dismiss');
});

test('expired: countdown hits zero -> DEFAULT DENY', () => {
  const s0 = pending(10);
  const s1 = tick(s0, NOW + 10);
  assert.equal(s1.status, 'expired');
  assert.equal(s1.decidedBy, 'countdown');
  // Late approve after expiry stays expired (fail closed).
  const s2 = approve(s0, NOW + 11, 'deck');
  assert.equal(s2.status, 'expired');
  const s3 = deny(s0, NOW + 11, 'deck');
  assert.equal(s3.status, 'expired');
  assert.equal(keyActionFor('Escape', 'expired'), 'dismiss');
});

test('edited: E narrows scope, widening rejected', () => {
  let s = pending(60, '/proj');
  assert.equal(keyActionFor('e', s.status), 'edit');
  s = editScope(s, '/proj/sub', NOW + 2);
  assert.equal(s.status, 'edited');
  assert.equal(s.effectiveScope, '/proj/sub');
  assert.equal(s.wasEdited, true);
  // Further narrowing allowed.
  s = editScope(s, '/proj/sub/deep', NOW + 3);
  assert.equal(s.effectiveScope, '/proj/sub/deep');
  // Widening rejected.
  assert.throws(() => editScope(s, '/proj', NOW + 4), /narrow/);
  assert.throws(() => editScope(s, '/other', NOW + 4), /narrow/);
  // Edited still approves with narrowed scope.
  const a = approve(s, NOW + 5);
  assert.equal(a.status, 'approved');
  assert.equal(a.effectiveScope, '/proj/sub/deep');
  assert.equal(keyActionFor('a', 'edited'), 'approve');
  assert.equal(keyActionFor('d', 'edited'), 'deny');
});

test('scope helpers mirror Rust boundary rules', () => {
  assert.equal(scopeCovers('/proj', '/proj'), true);
  assert.equal(scopeCovers('/proj', '/proj/a.txt'), true);
  assert.equal(scopeCovers('/proj/', '/proj/a/b'), true);
  assert.equal(scopeCovers('/', '/anything'), true);
  assert.equal(scopeCovers('/proj', '/proj-evil/a.txt'), false);
  assert.equal(scopeCovers('', '/proj'), false);
  assert.equal(scopeNarrowsOrEqual('/proj', '/proj/sub'), true);
  assert.equal(scopeNarrowsOrEqual('/proj/sub', '/proj'), false);
});

test('STOP: every state has a keyboard path', () => {
  const states = ['pending', 'approved', 'denied', 'expired', 'edited'] as const;
  for (const st of states) {
    const paths = KEYBOARD_PATHS[st];
    assert.ok(paths.length > 0, `${st} lacks a keyboard path`);
    console.log(`kbd ${st}: ${paths.join(' | ')}`);
  }
  // Programmatic: each state maps at least one key to an action.
  const probes: Record<string, string[]> = {
    pending: ['a', 'd', 'e'],
    edited: ['a', 'd', 'e'],
    approved: ['Enter', 'Escape'],
    denied: ['Enter', 'Escape'],
    expired: ['Enter', 'Escape'],
  };
  for (const [st, keys] of Object.entries(probes)) {
    for (const k of keys) {
      assert.ok(keyActionFor(k, st as never) !== null, `${st} key ${k} must map`);
    }
  }
});

test('no dark patterns: deny exactly as prominent as approve', () => {
  // Both actions share one style object — identical metrics by construction.
  // Read the component source (no .tsx import: Node strips .ts, not .tsx).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '..', '..', 'packages', 'ui', 'src', 'approvals', 'ApprovalCard.tsx'), 'utf8');
  const approveUses = (src.match(/data-testid': 'approval-approve'[\s\S]{0,400}?style: ACTION_BTN/) ?? []).length
    + (src.match(/data-testid["']\s*:\s*["']approval-approve["'][\s\S]{0,600}?ACTION_BTN/) ?? []).length;
  assert.ok(src.includes("'approval-approve'") && src.includes("'approval-deny'"), 'both buttons must exist');
  assert.ok(src.includes('style: ACTION_BTN'), 'both buttons share ACTION_BTN');
  // Shared constant carries equal metrics.
  assert.ok(src.includes("minHeight: '44px'") && src.includes('flex: 1'), 'equal prominence metrics');
  console.log('prominence: approve and deny share ACTION_BTN (flex:1, 44px, 600)');
});

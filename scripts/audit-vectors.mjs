#!/usr/bin/env node
/*
 * Audit-chain test vectors: the single source of truth pinning the
 * hash algorithm shared by the Rust chain (`crates/core-store/src/audit.rs`)
 * and these docs. Prints JSON to stdout; use --out <path> to write
 * artifacts/audit-test-vectors.json instead.
 *
 * The algorithm: payload_hash = SHA256(canonical_json(payload)) with
 * recursively sorted object keys and compact separators; event hash =
 * SHA256("audit-v1\\n{seq}\\n{ts}\\n{actor}\\n{event}\\n{payload_hash}\\n{prev_hash}").
 * Genesis prev_hash is 64 zeros. Canonical timestamps are UTC RFC3339.
 *
 * Usage: node scripts/audit-vectors.mjs [--out artifacts/audit-test-vectors.json]
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const GENESIS = '0'.repeat(64);

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(',')}}`;
}

const sha256hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const payloadHash = (payload) => sha256hex(canonical(payload));
const eventHash = (seq, ts, actor, event, ph, prev) =>
  sha256hex(`audit-v1\n${seq}\n${ts}\n${actor}\n${event}\n${ph}\n${prev}`);

function main() {
  const records = [
    {
      seq: 1,
      ts: '2026-11-22T00:00:00Z',
      actor: 'wire-client',
      event: 'capability.requested',
      // Deliberately unsorted keys: the canonical form must sort them.
      payload: { tool: 'tool.exec', request_id: 'req-1' },
    },
    {
      seq: 2,
      ts: '2026-11-22T00:00:01Z',
      actor: 'wire-client',
      event: 'capability.granted',
      payload: { grant_id: 7, tool: 'tool.exec' },
    },
    {
      seq: 3,
      ts: '2026-11-22T00:00:02Z',
      actor: 'deck',
      event: 'approval.denied',
      payload: { tool: 'tool.exec', request_id: 'apr-9' },
    },
  ];
  let prev = GENESIS;
  const vectors = records.map((r) => {
    const canon = canonical(r.payload);
    const ph = sha256hex(canon);
    const h = eventHash(r.seq, r.ts, r.actor, r.event, ph, prev);
    const v = { ...r, canonical_payload: canon, payload_hash: ph, prev_hash: prev, hash: h };
    prev = h;
    return v;
  });
  // A byte-flip case: flipping the last payload char must change everything.
  const flipped = { ...vectors[1].payload, tool: 'tool.exed' };
  const doc = {
    genesis: GENESIS,
    domain: 'audit-v1',
    epoch_example: { epoch_secs: 1800000000, rfc3339: '2027-01-15T08:00:00Z' },
    vectors,
    tamper_case: {
      seq: 2,
      original_payload: vectors[1].payload,
      flipped_payload: flipped,
      flipped_payload_hash: payloadHash(flipped),
      note: 'any byte flip changes payload_hash, so verify fails at seq 2 with payload-hash-mismatch',
    },
  };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  const out = process.argv.includes('--out')
    ? path.resolve(process.argv[process.argv.indexOf('--out') + 1])
    : null;
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
}

main();

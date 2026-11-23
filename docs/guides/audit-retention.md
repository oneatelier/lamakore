# Audit log retention (pre-alpha, local-only)

The daemon keeps an **append-only, hash-chained audit log** in the local
store file. This guide says what is logged, what is never logged, how to
read and verify it, and how to purge it.

## Where it lives

One SQLite file, owner-only on disk, next to everything else the daemon
keeps:

- Windows: `%APPDATA%\<token-dir>\store.db`
- macOS: `~/Library/Application Support/<token-dir>/store.db`
- Linux: `$XDG_DATA_HOME/<token-dir>/store.db` (or `~/.local/share/...`)

(`<token-dir>` is the provisional brand token directory; see
`Store::db_path_under`.) There is no server copy, no sync, no telemetry.
Purging the log is deleting this file (below).

## What is logged

Each row carries `seq`, `ts` (UTC, `YYYY-MM-DDTHH:MM:SSZ`), `actor`,
`event`, `payload_hash`, `prev_hash`, and `hash` (SHA-256 chain, fixed
genesis of 64 zeros). Events recorded today:

- `capability.requested`, `capability.granted`, `capability.revoked`,
  `capability.denied` (with a machine-readable reason slug)
- `approval.requested`, `approval.approved`, `approval.edited`,
  `approval.denied`, `approval.expired`

Payloads hold identifiers and scopes only (`request_id`, `grant_id`,
`tool`, `scope`, `method`, `decision`, `expires_at`, and the denial-reason
slug). Legacy free-text detail written before the chain is preserved
verbatim for continuity.

## What is never logged

- Capability tokens, signatures, or the device root key.
- Secrets of any kind (`token`, `secret`, `password`, `api_key`,
  `private_key`, …).
- Identity or PII: the daemon never collects names, emails, addresses, or
  credentials, so there is nothing of that kind to log. `actor` is a token
  id when one was presented, otherwise a fixed label (`wire-client`,
  `deck`, `anonymous`, `countdown`).
- Scope paths can name local directories. They stay in the local file and
  are kept in exports because they are the audit meaning — but they never
  leave the device through any daemon path.

Export (`audit.export`) enforces this mechanically: the JSONL envelope keys
are fixed and payloads pass an allowlist. Anything else is dropped, never
redacted-in-place. The export conformance test asserts the exact envelope
and scans every line for banned material.

## Verify

- The daemon verifies the chain on every startup and logs
  `ledger: ok …` or `ledger: TAMPER …` to stderr. A break never stops
  serving: the deck must stay reachable to show `LEDGER_TAMPER`.
- Any wire client can call `audit.verify` at any time. It returns
  `{ok, events, bad_seq, bad_reason, head}` — read-only, no token needed.

## Purge (your right, your device)

Pre-alpha, there is no retention policy to satisfy and no remote copy to
chase. To start a fresh log:

1. Quit the app (so the daemon exits and releases the file).
2. Delete `store.db` from the directory above.
3. Reopen the app. The next append starts at `seq` 1 from genesis, and
   `audit.verify` reports `ok` with `0` events before that.

Purging deletes grants and approvals stored alongside the log; capability
tokens already issued stop working (their grants are gone) and tools
re-request approval. That is the intended fail-closed behavior.

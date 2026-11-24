# ADR-007 — Vault at Rest: OS Keychain Now, SQLCipher Deferred

- **Status:** Accepted
- **Date:** 2026-11-24
- **Scope:** At-rest protection for provider API keys and the local store
- **Inputs:** `crates/vault/src/lib.rs`, `crates/cored/src/secret_tool.rs`,
  `crates/core-store/src/lib.rs`, `crates/core-store/migrations/0001_init.sql`,
  `docs/reports/report-vault.md`

## 1. Context

Provider API keys are the highest-value bytes on the device. The store
(`core-store`, SQLite via `rusqlite/bundled`) holds sessions, messages,
tool calls, approvals, capability grants, audit rows, and settings behind
owner-only ACLs (Unix `0700`/`0600`, Windows `icacls` owner-only) with
WAL + integrity checks — but the file itself is plaintext SQLite. The
schema test asserts there are NO secret columns anywhere: credentials
stay in the vault. The question is whether the whole store file needs
SQLCipher page-level encryption now.

## 2. Decision

- **Provider keys live ONLY in the OS keychain** (Windows Credential
  Manager / macOS Keychain / Linux Secret Service) via `crates/vault`.
  SQLite never holds them — asserted by the `no-secret-columns` schema
  test, and by the wire contract (daemon never returns plaintext).
- **SQLCipher for `store.db` is DEFERRED, revisit on 2027-03-01.**
  Until then the store relies on owner-only filesystem ACLs + OS full-disk
  encryption + the hash-chained audit log. No SQLCipher dependency, no
  key-management ceremony, no migration risk in pre-alpha.
- The deferral costs nothing for keys: they are already outside SQLite.
  What stays plaintext at rest is non-secret operational data (chat
  history, grants, audit chain) readable only by the device owner.

## 3. Why not now

- The threat the keychain already answers (another user or process
  reading key bytes off disk) does not apply to the store: there are no
  key bytes in it to read.
- SQLCipher would add a second secret (the database key) that itself
  needs OS-keychain storage, backup, and rotation — pure complexity
  without new coverage while the data classification is "local-only,
  owner-only, no sync, no PII collection."
- Pre-alpha churn (migrations, crash-recovery, concurrent WAL writers)
  is safer to prove on plaintext SQLite first; encrypting now would
  entangle the crash-recovery and integrity evidence (P011) with cipher
  behavior.

## 4. Consequences

- `store.db` remains plaintext SQLite with owner-only ACLs; operators
  rely on OS disk encryption for stolen-device coverage.
- Any future column that could hold key material is rejected by the
  schema test — the vault stays the only secret store by construction.
- Audit export stays allowlisted (`provider` names the slot, never the
  bytes); adding SQLCipher later does not change the export contract.

## 5. Reversal triggers (revisit 2027-03-01 or earlier if hit)

- A sync, backup, or multi-device story appears (data leaves the device).
- The store starts holding PII, credentials, or anything beyond the
  current local-only operational set.
- An OS ships without usable owner-only ACLs on our data dir, or
  full-disk encryption cannot be assumed.
- A customer, auditor, or platform policy requires at-rest encryption
  regardless of ACLs.

If any trigger fires, open the SQLCipher proposal with a migration plan
(rekey, backup compatibility, crash-recovery re-proof) — never a silent
flag-flip.

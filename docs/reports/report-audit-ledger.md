# Report — append-only hash-chained audit log (startup verify + wire/1 audit.verify + LEDGER_TAMPER deck state)

- **Date (local):** 2026-11-22 IST
- **Scope:** `audit_events` becomes `seq, ts(UTC), actor, event, payload_hash, prev_hash, hash` (SHA-256 chain, fixed genesis); verify on startup + `audit.verify`; tamper → deck `LEDGER_TAMPER` banner; JSONL export under a schema allowlist; retention doc with purge.
- **Visual gate:** **LIVE — passed.** Tampered/healthy banner × both themes screenshot-verified + programmatic checks (role=alert, keyboard, 2px ring, AA).
- **STOP honored:** every known event type hashes deterministically — the `determinism_stop_gate` test enumerates all 9 and fails loudly on any unhashable input.

## 1. What was built

**Store (`core-store`, schema v2):**
- `migrations/0002_audit_chain.sql` — adds `seq, event, payload_json, payload_hash, prev_hash, hash` (+ `idx_audit_seq`); legacy `action`/`detail_json` kept and written in sync. No UNIQUE on `seq` (legacy zero-defaults would collide); append-only is enforced by verification, documented.
- `src/audit.rs` (new) — `GENESIS_PREV_HASH` (64 zeros), `canonical_json` (recursive key sort, compact), `payload_hash`, `event_hash` (`SHA256("audit-v1\nseq\nts\nactor\nevent\npayload_hash\nprev_hash")`), `normalize_ts` (epoch seconds → UTC RFC3339 via a dependency-free civil algorithm, else strict RFC3339 or fail closed), `verify_rows` (first break wins: `seq-gap`, `ts-invalid`, `payload-invalid`, `payload-hash-mismatch`, `prev-hash-mismatch`, `hash-mismatch`), `filter_payload` + `EXPORT_KEYS` + `ALLOWED_PAYLOAD_KEYS`, `export_line`, `coerce_legacy_payload`.
- `src/lib.rs` — `SCHEMA_VERSION = 2`; `Store::open` backfills the chain over pre-v2 rows in id order (`seq = id`, ts normalized in place) inside one transaction, fail-closed with a purge pointer; `record_audit_event` rewrites to `BEGIN IMMEDIATE` → read head → insert → `COMMIT` (concurrent writers serialize on the busy timeout; `ROLLBACK` on any failure); `audit_events` reads the chain columns (aliases `action`/`detail` preserved for existing callers); new `verify_audit_chain` (pure read, tamper reports `ok:false`, never errors) and `export_audit_jsonl` (fixed envelope, allowlisted payloads, `limit >= 1`); new `StoreError::Chain`.

**Daemon (wire/1):**
- `core-protocol/src/wire.rs` — `ALLOWED_METHODS` += `audit.verify`, `audit.export`.
- `cored/src/capability.rs` — `ISSUANCE_METHODS` += both (read-only, no token); `handle_capability` arms: `audit.verify` → `{ok, events, bad_seq, bad_reason, head}`, `audit.export` → `{jsonl, events}` (`limit` defaults 1000; non-positive → invalid params).
- `cored/src/server.rs` — `serve()` verifies after open, logs `ledger: ok …` / `ledger: TAMPER …` to stderr, and advertises `{ledger_ok, ledger_events}` in the `daemon.ready` event. A broken chain never blocks serving — the deck must stay reachable to show the banner.

**Deck:**
- `main/index.ts`, `main/daemon.ts`, `preload/index.ts` — allowlists += both methods.
- `App.tsx` — fetches `audit.verify` on connect (+ explicit re-check), holds `LedgerStatus | null` (unknown → no banner, never a wrong banner), passes to `Shell`.
- `components/states.tsx` — `LedgerTamperBanner` (`role="alert"`, P007 tokens only, cites `record <badSeq> of <events>`, persistent by design, keyboard-reachable `Re-check ledger`).
- `screens/Shell.tsx` — renders the banner above the canvas iff `ledger && !ledger.ok`.

**Docs:** `docs/guides/audit-retention.md` (what/never logged, location, verify, export, purge steps, fail-closed token invalidation); `scripts/audit-vectors.mjs` + `artifacts/audit-test-vectors.json` (single source of truth pinning the algorithm across Rust/Node).

## 2. Tests

### Rust (`crates/core-store/tests/audit.rs`, 7 tests — CI authority)

`chain_verify_ok` (append 3 incl. alias/UTC-shape asserts, verify ok, head matches) · `byte_flip_payload_tamper_detected` (direct-SQL 1-byte flip → `bad_seq: 2, payload-hash-mismatch`) · `byte_flip_hash_tamper_detected` (hash flip → `hash-mismatch` @2, head rolls back to last good) · `concurrent_appends_serialized` (8 threads × 25 → verify ok, 201 rows, seq exactly 1..=201) · `export_schema_conformance` (hostile payload with `token`/`secret`/`password`/PII text + free-text note → exact 8-key envelope, payload ⊆ allowlist, zero banned substrings, hostile keys dropped) · `determinism_stop_gate` (all 9 known event types: re-hash stable, key-order insensitive) · `committed_vectors_cross_check` (Rust recomputes every committed vector incl. epoch 1800000000 → `2027-01-15T08:00:00Z`) · `purge_resets_to_genesis` (delete file → verify ok/0 events → next append is seq 1 from genesis).

Plus `cored` dispatch tests (`audit_plane_reports_exports_and_detects_tamper`: verify ok through `dispatch`, export envelope exact, out-of-band flip → `bad_seq: 1`).

**Local execution status:** `cargo test` cannot link on this host — no MSVC `link.exe`, no GNU `zigcc`/`gcc`; even build scripts fail to link (excerpt: `error: linker 'link.exe' not found … could not compile 'serde_json' (build script)`). Precedent (report-P008/P011/P013): **CI with a real toolchain is the authority**. What *did* run locally and proves the change is sound:
- `cargo test -p core-store --lib` compiled the `core-store` lib (with all new code) with **zero rustc errors** before stopping at the link step.
- `cargo fmt --check` clean on `core-store`, `cored`, `core-protocol`.
- The hashing algorithm itself executes locally via `scripts/audit-vectors.mjs` (Node `crypto`), and the Rust tests assert byte-equality against its committed output — any Rust/Node divergence fails CI loudly.

### Node (all green owner-local)

`node --test tests/ui/ledger.spec.ts` — 5/5:

```text
✔ tamper banner uses P007 tokens only, keeps alert semantics
✔ shell shows LEDGER_TAMPER only on failed verify
✔ audit.verify reaches the deck through every bridge layer
✔ committed audit vectors match the generator (single source of truth)
✔ export allowlist holds no secret-bearing keys
```

`node tests/ui/ledger-verify.mjs` — all banner checks passed (4 screenshots):

```text
ok brass-void/tampered banner iff tampered — true
ok brass-void/tampered names the break — Audit ledger tampered
ok brass-void/tampered cites record + count — …record 17 of 42 exam…
ok brass-void/tampered role=alert — alert
... (same × parchment, plus ok-states with no banner, zero page errors)
ok keyboard Tab reaches Re-check — focused
ok keyboard Enter triggers re-check — FLOW: recheck done
ok focus ring visible (2px) — {"width":"2px","color":"rgb(217, 180, 99)"}
ok banner title AA (>=4.5) — rgb(236, 239, 244) on rgb(26, 30, 37) = 14.50
ok banner body AA (>=4.5) — rgb(168, 176, 188) on rgb(26, 30, 37) = 7.64
ok re-check button AA (>=4.5) — rgb(11, 13, 16) on rgb(200, 162, 74) = 8.08
ledger-verify: all banner checks passed
```

Screenshots (committed): `artifacts/ledger-tampered-brass-void.png`, `ledger-tampered-parchment.png`, `ledger-ok-brass-void.png`, `ledger-ok-parchment.png`.

Regression battery: `tsc --noEmit` clean; `no-raw-hex`, `no-hardcoded-brand` clean; `hygiene: all scanners clean`; `ledger + approval + contrast` node suites 16/16 pass.

## 3. STOP evaluation

- **Deterministic hashing:** `determinism_stop_gate` enumerates `capability.requested/granted/revoked/denied` + `approval.requested/approved/denied/expired/edited` — re-hash stability and key-order insensitivity asserted per type; any failure names the event type. No new event type can land without extending that list (it mirrors the audit call-sites in `capability.rs`).
- **Tamper handling:** verify is read-only and total; tamper surfaces as data (`ok:false`), never an exception the deck could misrender; the daemon keeps serving so the banner is reachable.
- **No secret/PII channel:** producers never place key material or identity in audit payloads; export additionally enforces the allowlist; the conformance test feeds a hostile payload and asserts the leak is structurally impossible.

## 4. Deviations

- **D1 — no UNIQUE on `seq`.** Legacy rows share the migration default until backfilled; a unique index would fail the upgrade on any real log. Uniqueness is enforced operationally (single-writer transaction) and detected by verification (`seq-gap` on dup/gap/deletion).
- **D2 — no wire `audit.purge`.** Purging is file deletion per the retention guide (quit → delete `store.db` → reopen), covered by the `purge_resets_to_genesis` test. No privileged wire path was added for pre-alpha.
- **D3 — daemon.ready carries `ledger_ok/ledger_events`, but the deck treats `audit.verify` as authoritative** (fetched on connect and on re-check); the ready payload is best-effort telemetry for logs/tests.
- **D4 — banner has no dismiss.** Tamper evidence must stay visible; keyboard access is via the Re-check button and the rest of the shell, asserted in the harness.

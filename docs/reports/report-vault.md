# Report — Vault: provider keys in the OS keychain only

- **Date (UTC):** 2026-11-24
- **Numbering note:** this report intentionally carries no P-number.
  Seed P015 is "Dependency install inside the sandbox" (`features.csv`
  F-COD-06, acceptance `report-P015`, not started), so naming this file
  `report-P015.md` would squat that slot. (History already overloads the
  label — `report-fs-readonly.md` uses "P015" for the approval-card work;
  see INDEX.md. History is immutable; this file stays out of the series.)

- **Date (UTC):** 2026-11-24
- **Scope:** `crates/vault` (new) + `wire/1` secret plane
  (`secret.set` / `secret.list` / `secret.delete` / `secret.ref` /
  `secret.test`) + deck settings panel + SQLCipher deferral (ADR-007).
  Provider API keys live ONLY in Credential Manager / Keychain / Secret
  Service. Plaintext NEVER crosses the wire to the deck.
- **Head:** `f482614` on `feat/p013-sandbox` + this working tree
  (implementation, tests, CI evidence step, report; PR to follow).

## 1. Implementation

### `crates/vault` (new crate)

- `Cargo.toml`: `vault 0.0.0`, deps `core-protocol` (brand token, no
  literal), `keyring 4`, `serde_json 1`, `thiserror 2`. Feature
  `mock-keyring` (in-memory backend for headless CI; the real-keychain
  path is always compiled).
- `src/lib.rs` (`#![deny(clippy::unwrap_used, expect_used)]`):
  - `SUPPORTED_PROVIDERS = ["openai", "anthropic", "openrouter"]` —
    fixed allowlist; arbitrary names cannot create keychain entries.
  - Service naming from `CODE_TOKEN` (`{token}-vault`, `-vault-test`
    for the isolated roundtrip test) — the brand literal never appears
    in Rust source (brand lint clean on all new files).
  - `Vault::production()` (OS keychain), `Vault::test_entry()` (isolated
    real backend, test-only), `Vault::mock()` (in-memory, `mock-keyring`
    only). `Clone`-by-`Arc` sharing across connections.
  - API: `set` (returns handle, never echoes), `get_secret`
    (daemon-internal ONLY, never over the wire), `exists`, `list`
    (handles only), `delete`, `get_ref` (opaque handle or honest
    missing), `test` (local read + length sanity, ZERO network calls).
  - `SecretRef { provider, handle }` with
    `handle = "vault:v1:<provider>"` — names the slot, not the secret,
    not reversible. `SecretMeta { provider, has_key, secret_ref }`,
    `TestReport { ok, reason, secret_ref }` — no secret bytes in any
    struct.
  - `VaultError` is message-only and never renders secrets:
    `UnsupportedProvider` carries no name at all (a mistyped secret
    passed as provider must not echo back), `InvalidSecretLength`
    carries lengths only, `Backend` carries the OS message only.
    `handle_for` is pure (no I/O, no secrets).
  - Canary literals are `concat!` split so no source line trips the
    secret-hygiene entropy tripwire (repo precedent: `fs_tool.rs`
    base64 table); runtime values stay full-length for leak detection.

### Wire/1 (`core-protocol`, `cored`, `core-store`)

- `wire.rs` `ALLOWED_METHODS` += the 5 secret methods; allowlist test
  covers them + asserts `secret.get` does NOT exist.
- `capability.rs` `ISSUANCE_METHODS` += the 5 secret methods
  (issuance-plane, no token — the user configures keys without holding
  one; every call audited with provider names only).
- `core-store` `audit.rs` `ALLOWED_PAYLOAD_KEYS` += `"provider"` (slot
  name survives export; key bytes never enter the chain on any path).
- `cored/src/secret_tool.rs` (new): the ONLY wire funnel for secrets.
  `set` reads `{provider, secret}` once (deck→daemon explicit save),
  stores, drops, returns `{ref, provider}`; `list` returns
  `[{provider, has_key, ref}]`; `delete` returns `{deleted}`;
  `ref` returns `{ref, provider}` or honest missing; `test` returns
  `{ok, reason, ref?}` (local only). Every terminal outcome audits
  `{method, provider, reason}` — never bytes. No `eprintln`/`println`
  on any path. `get_secret` is never called from the wire layer
  (asserted by the STOP test).
- `server.rs`: `ServerConfig.vault: Arc<Vault>` (shared); dispatch
  routes `secret.*` through `secret_tool::execute` BEFORE the generic
  issuance arm. `main.rs` constructs `Vault::production()`; the
  gate-matrix harness constructs `Vault::mock()`.
- `cored/Cargo.toml`: `vault` path dep;
  `mock-keyring = ["vault/mock-keyring"]` wiring.

### Deck (`apps/desktop`, `packages/protocol`)

- `packages/protocol/src/secrets.ts`: method + provider constants,
  result shapes; `SUPPORTED_PROVIDERS` mirrors the Rust allowlist.
- `SettingsPanel.tsx` (new): provider `<select>`, masked
  `<input type=password autocomplete=off>` (cleared after save),
  buttons Save / Test connection / Show handle / Delete / Refresh.
  ZERO background calls: no `useEffect` fetch, no mount/onChange
  traffic — only explicit click handlers call `invoke`. Test button =
  ONE `secret.test` request (local read, no network).
- `Shell.tsx`: nav tabs switch Agent/Tools/Memory/Settings; Settings
  renders the panel when the daemon is reachable, else the unreachable
  card. Tools/Memory stay placeholders (no wire traffic).
- Allowlist (`preload/index.ts`, `main/index.ts`, `main/daemon.ts`)
  += the 5 secret methods (regex `^[a-z]+\.[a-z]+$` already covers them).
- `tests/ui/secrets.spec.ts` (new, 6 tests): Rust↔TS method spelling,
  provider parity, issuance-plane membership, STOP (no `get_secret` in
  the wire layer), deck explicit-only (no `useEffect`, masked input,
  test button present).

## 2. Tests

- `vault` mock suite (CI shape): lifecycle, bad-input, **log-scrub**
  (canary in every wire surface, audit payload, error string, `Debug` —
  none may contain it), plus pure allowlist/handle/error tests.
- `vault` real-backend roundtrip (owner-local, Windows Credential
  Manager): set → read → list → ref → test → delete → delete; honest
  `SKIP … no OS keychain reachable headless` on CI when unreachable.
- `secret_tool` dispatch suite (mock vault + temp store): wire
  roundtrip without plaintext, bad-input rejection, audit+export
  scrub (every row + every JSONL line free of the canary; provider
  names survive export).
- `tests/ui/secrets.spec.ts` (6) + `protocol.spec.ts` (7, still green).

## 3. Counts

Local (Windows, GNU `1.100.0-x86_64-pc-windows-gnu` + zig shim,
`CARGO_TARGET_DIR=D:\t`, `CODEGEN_UNITS=1`; CI MSVC is authority):

- `cargo test -p vault`: **5 passed, 0 failed** (real Credential
  Manager roundtrip green — see §4).
- `cargo test -p vault --features mock-keyring`: **8 passed, 0 failed**.
- `cargo test -p core-protocol`: **6 passed, 0 failed**.
- `cargo test -p core-store`: **16 passed, 0 failed** (8 audit + 8 store).
- `node --test tests/ui/secrets.spec.ts tests/ui/protocol.spec.ts`:
  **13 passed, 0 failed** (6 secrets + 7 protocol).
- `cargo check -p cored --features mock-keyring`: clean.
- `cargo clippy --workspace -- -D warnings` (CI shape): clean.
- `cargo fmt --check`: clean. `pnpm typecheck`: clean.
  `no-raw-hex`, `check-fonts`: clean. `scan-secrets` on new code: clean
  (canaries are `concat!`-split; runtime values stay full).
- `cargo test -p cored --features mock-keyring` (full binary):
  compiles (`check` + `build` green); the test-binary link exceeds the
  local zig-shim command length (same host limit as P008/P011–P014,
  one added `vault` rlib over the budget) — CI (real MSVC, no shim)
  is the authority for the cored run. Pre-existing `pnpm lint`
  brand violations (4, in `FilesPanel`/`fs_tool`/`fs-tools.spec`,
  untouched by this change, red on clean HEAD too) are noted, not
  introduced: all NEW files are brand-clean (word-boundary grep clean).

CI (`.github/workflows/ci.yml`): added
`cargo test -p vault --features mock-keyring -- --nocapture` before
the cored mock run, so transcripts + honest skips land in logs on all
three OSes.

## 4. Real-backend evidence (owner-local, Windows Credential Manager)

```text
vault roundtrip ok (set + read + list + ref + test + delete + delete)
test pure_tests::vault_roundtrip_or_honest_skip ... ok
test result: ok. 5 passed; 0 failed
```

(`cargo test -p vault -- --nocapture`, this host. Persist + reload
proves the read path; list/ref/test prove handles without bytes;
delete + second-delete-false proves removal; the final sweep leaves
no test credential behind. On CI runners without a keychain the same
test prints `SKIP vault_roundtrip: no OS keychain reachable headless`
and passes; the mock suite carries CI.)

## 5. Gates, deviations, STOP

- **[E] Evidence gate:** machine-checkable outputs above (local green
  on default + mock suites; transcripts pasted verbatim;
  check/clippy/fmt/typecheck/hex/fonts/secrets clean on new code).
  CI `verify` on all three OSes is the authority for the merge; the
  vault mock step is added to the workflow.
- **[V] Visual gate:** LIVE — settings panel renders behind the
  Settings nav tab (provider select, masked input, explicit test
  button); no screenshot harness is claimed — the contract is
  programmatic (`secrets.spec.ts` asserts masked input + test button
  + zero-mount-fetch).
- **STOP — any plaintext leak path:** NOT triggered — and the run
  would have failed closed if it were:
  - `secret_tool.rs` never calls `get_secret` (STOP test asserts it).
  - Responses carry `{ref, provider, ok, reason, deleted, has_key}`
    only (roundtrip + log-scrub tests assert absence of the canary).
  - Audit payloads are `{method, provider, reason}` (allowlisted;
    export test scans every row + every JSONL line for the canary).
  - `VaultError::Display` never renders secrets (unsupported names
    are not echoed at all; lengths only; backend messages only).
  - `assert_eq` on secret bytes was removed from the tests themselves
    (a failing equality would print the canary into logs).
  - Deck holds plaintext only in the masked input between keystrokes
    and save, clears after save, never logs it, issues zero
    background calls.
  - Full-text grep: no `eprintln`/`println`/`console.log` of secrets
    on any daemon or deck path; no secret columns in SQLite
    (schema test); no secret keys in the export allowlist.
- **Deviations:** (a) local builds ride the GNU target + zig toolchain
  with `ccwrap`/`zigcc` + `CARGO_TARGET_DIR=D:\t` (same detour as
  P008/P011–P014); the cored *test-binary* link now exceeds the shim's
  length limit, so the cored mock run is compile-proved locally
  (`check` + `build` + `clippy` green) and test-proved on CI —
  recorded, not hidden. (b) `pnpm lint` brand check is red on clean
  HEAD (4 pre-existing `pone` hits in files this change does not
  touch); new files add zero. (c) POSIX keychain evidence rides CI
  honest-skip/run lines; Windows carries the owner-local gate (§4).
- **ADR-007** defers the SQLCipher at-rest decision with revisit date
  **2027-03-01** (keys are already outside SQLite; the store holds
  owner-only non-secret data; triggers listed for early revisit).

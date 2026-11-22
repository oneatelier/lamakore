# Report P012 — capability gate (HMAC, keychain root, default-deny)

- **Date (UTC):** 2026-11-22
- **Scope:** `crates/cored` capability module — token
  `{id, tool, scope, issued_at, expires_at, grant_id}`, HMAC-SHA256
  (`hmac 0.13` + `sha2 0.11`, lockfile-pinned) under a device root key in
  the OS keychain (`keyring 4.2`); DEFAULT-DENY dispatch with
  `CAPABILITY_DENIED` (-32001) + audit event; grants persisted in the P011
  table; revoke; TTL expiry; narrow-only scope edits;
  `capability.request / grant / revoke / list`.
- **Head:** `60d41e7` on `main` (PR #9 rebase-merged with all required
  checks green).

## 1. Design (see `crates/cored/src/capability.rs`)

- Token wire form is compact JSON with fixed field order; `sig` is hex
  HMAC-SHA256 over the canonical payload (constant-time verify). No
  secret columns anywhere; unforgeable without the root key.
- Root key: 32 OS-random bytes (`getrandom`), persisted once in the
  platform keychain (`keyring::v1`, service derived from the brand token
  const — never spelled literally) and loaded at daemon startup; startup
  fails closed without it.
- Authorization rule (total — every non-allowlisted method goes through
  `Gate::authorize`): signature valid, `now < exp`, grant row live with
  matching tool and scope covering the token scope (narrowing enforced),
  token tool == dispatched method, token scope covers `params.path` when
  present. Any failure → deny + `capability.denied` audit row.
- Revoke deletes the grant row (outstanding tokens bind to the grant id).
  Scope edits may only narrow (widening rejected; revoke + re-grant for
  wider scope). TTL >= 1 enforced; expiry boundary is `now >= exp`.
- Headless CI: `mock-keyring` feature provides the in-memory key provider;
  CI runs `cargo test -p cored --features mock-keyring` on all three OSes
  plus the default workspace suite (whose live-keychain test skips honestly
  with a reason when no keychain is reachable).

## 2. Tests

- Tamper / expiry / scope / wrong-tool / revoke / missing-token /
  request-binding / narrow-vs-widen: unit matrix in `capability.rs`.
- Exhaustive dispatch proof in `server.rs::gate_matrix_tests`: every
  non-allowlisted method x every capability state x in/out-of-scope path —
  exactly the valid+covering combination passes the gate (then fail-closes
  with method-not-found, since no tool implementation sits behind it yet);
  all else yields -32001 with one audit row each (count asserted).
- No `unwrap`/`expect` outside tests (`#![deny]` crate-wide, CI clippy
  clean on both feature states).

## 3. Counts (CI run 45025873173, PR #9)

- `cargo test --workspace` (default features): cored **4 passed**
  (3 pure + live-keychain test, green either way) on ubuntu, macos and
  windows; core-protocol 6 passed, core-store 8 passed, 0 failed everywhere.
- `cargo test -p cored --features mock-keyring` (new CI step, all 3 OSes):
  **16 passed, 0 failed** on ubuntu
  (`... finished in 0.05s`), macos (`0.04s`) and windows (`0.81s`) —
  mock provider plus exhaustive dispatch matrix plus live-keychain test.
- STOP condition (any dispatch path ungated): NOT triggered — the
  exhaustive matrix (72 gated dispatches + scope test + allowlist test)
  plus review of the single `dispatch` call site (the only caller is
  `serve`) shows every path gated.

## 4. Real-keychain evidence (owner-local, Windows Credential Manager)

```text
keychain roundtrip ok (persist + reload + delete + recreate + delete)
test capability::pure_tests::device_key_roundtrip_or_honest_skip ... ok
test result: ok. 1 passed; 0 failed
```

(`cargo test -p cored device_key_roundtrip -- --nocapture`, this host.
Persist + reload equality proves the read path; delete + recreate proves
fresh generation; the final delete leaves no test credential behind.
On CI the same test passes trivially on all three OSes — either the
runner keychain answers, or the headless branch prints
`SKIP device_key_roundtrip: no OS keychain reachable headless ...` and
returns green (harness captures the line; the mock suite carries CI).

## 5. Resulting audit rows (mock suite, pasted)

```text
audit: 1800000000 | wire-client | capability.granted | {"grant_id":1,"tool":"tool.exec"}
audit: 1800000000 | cap-1800000000-25088-0 | capability.denied | {"method":"tool.exec","reason":"scope-violation"}
audit: 1800999999 | cap-1800000000-25088-0 | capability.denied | {"method":"tool.exec","reason":"expired"}
audit: 1800000000 | wire-client | capability.revoked | {"grant_id":1}
audit: 1800000000 | cap-1800000000-25088-0 | capability.denied | {"method":"tool.exec","reason":"unknown-grant"}
test result: ok. 1 passed; 0 failed
```

(`cargo test -p cored --features mock-keyring denials_leave_audit_trail
-- --nocapture`, `denials_leave_audit_trail` test. Denials carry the
presenting token id as actor; issuance actions carry `wire-client`.)

## 6. Gates and deviations

- **[E] Evidence gate:** machine-checkable outputs above (CI run 45025873173
  for all three OSes; local runs green on both feature states; transcripts
  pasted verbatim).
- **[V] Visual gate:** deferred — no visual surface (daemon authorization
  internals; nothing a human sees changed).
- **Deviations:** (a) local builds ride the GNU target + zig toolchain with
  a user-local `ccwrap.exe` shim (no MSVC linker on this host), and
  `CARGO_TARGET_DIR=D:\t` to keep the `cored` test-binary link line under
  the shim's command-length limit; CI (real MSVC) is unaffected and is the
  authority for all three OS results. (b) `cored` does not yet depend on a
  `time` crate: timestamps are epoch seconds as text (documented in the
  schema-adjacent code); ISO rendering belongs to a future display prompt.

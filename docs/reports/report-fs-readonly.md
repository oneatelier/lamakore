# Report — read-only filesystem tool end-to-end (fs.list / fs.read)

- **Date (local):** 2026-11-23
- **Scope:** `packages/protocol` manifest → capability gate (P012) →
  sandboxed spawn (P013/P014) → approval card on first grant (P015) →
  audit chain (P016) → result rendered in the deck. Read-only: list capped
  at 10,000 entries, reads capped at 1 MiB with an honest truncation flag.
  POSIX NOT_IMPLEMENTED paths still gate + audit honestly. E2E on all 3
  OSes (Windows run here; Linux/macOS run the identical cross-platform
  suite in CI).
- **Built on:** the uncommitted P015 (approval card) + P016 (audit chain)
  working tree. No P015/P016 semantics changed except the drive-by fixes
  listed in §7.

## 1. What was built

**`packages/protocol` (new manifest package).** `manifest.ts` (method
names, 10k/1MiB/30s limits, params schemas, result shapes, wire error
codes, per-method chain flags) + `types.ts`. `tests/ui/protocol.spec.ts`
(7/7) pins the manifest against the Rust sources verbatim and asserts
both methods stay behind the gate (never in `ISSUANCE_METHODS`).

**Daemon (`crates/cored/src/fs_tool.rs`, ~1100 lines with tests).**
`execute()` is the single funnel: param shape → authorize on the
*typed* scope+path → canonicalize + `starts_with` containment →
sandboxed spawn of the daemon's own binary as the helper → read/parse/
delete the result file → audit every terminal outcome (ok, invalid-params,
scope-violation, not-implemented, timeout, tool-error). Gate denials keep
their existing `capability.denied` audit (never double-audited).
`run_worker` (`fs-list`/`fs-read` subcommands, pure FS, no store/keychain/
network): byte-order directory walk capped at 10k with `truncated`, reads
capped at 1 MiB+1 with `truncated`, UTF-8 or hand-rolled RFC 4648 base64
(never mangled, dependency-free), symlinks classified but never followed.
`main.rs` routes the two subcommands before daemon startup; `server.rs`
routes `fs.list`/`fs.read` through `execute` after the standard gate check;
`wire.rs` (`core-sandbox` dep added to `cored`) allowlists both methods.

Two containment layers, both required: the capability gate runs on the
*typed* path (grants are spelled by callers, who cannot canonicalize),
then canonicalized paths enforce `scope_abs` containment, so a symlink
(or junction) escape denies with `scope-violation` + audit instead of
executing. Equal-prominence Approve/Deny (P015) is untouched.

**STOP — no gate skipped on any path.** There is exactly one path to
`spawn_sandboxed` and it sits behind `authorize`: deny without token,
wrong-tool, expired token, and lexical `..`/absolute-path smuggling all
return before any spawn (asserted by tests that fail if the spawn stub is
ever called); containment denial, timeout (child killed, result file
removed), helper errors, and NOT_IMPLEMENTED (both variants) all audit
first. Rust unit tests cover every variant with a fake spawner (no
processes, runs everywhere); the e2e suite covers the real spawn.

**Deck (`FilesPanel`, new).** Directory input + List; a missing grant
triggers `approval.request` and the shared `ApprovalCard`; approve calls
`approval.decide` and retries automatically; deny/expired, invalid params,
timeouts, and the NOT_IMPLEMENTED banner each render distinctly. Terminal
states expose a keyboard path; the countdown/timer behavior is P015's.

**Bridge.** `fs.list`, `fs.read`, `approval.request`, `approval.decide`
added to all three TS allowlists (regex unchanged). No other bridge
changes.

## 2. TESTS

### Rust unit tests — `cargo test -p cored --features mock-keyring` (15 run on this host, all pass; suite 36/36)

`gate_first_deny_without_token` (no spawn) · `wrong_scope_denied_and_spawn_never_runs` · `expired_token_denied` · `list_ok_passthrough_and_audited` · `read_ok_utf8_passthrough` · `not_implemented_gates_then_audits` (both `Unavailable` and `UnsupportedPlatform` → -32002 + audit) · `timeout_kills_and_audits` (kill asserted, file removed) · `wait_error_maps_to_internal` · `missing_file/invalid-path/absolute-path never spawn` · `symlink_escape_denied_after_canonicalization` (unix) + `junction_...` (Windows, skips honestly without mklink) · `base64_rfc_vectors_ok` · `worker_roundtrip_list_read` (sorted, cap, utf8, base64, 5-byte truncation) · `worker_rejects_escape_missing_and_misuse` · `worker_arg_parsing_edges`. (16 test fns in source; 15 run per platform — `symlink_...` is unix-only, `junction_...` is Windows-only.)

### E2E — `tests/e2e/fs-tools.spec.ts` 10/10 (Windows named pipes; Unix sockets + native build elsewhere)

```text
✔ fs.list without capability is denied and audited (gate first)
✔ approval card on first grant: request, deny, then approve and list
✔ wrong-scope token cannot list (gate enforced per call)
✔ fs.read with an fs.list token is denied (wrong tool)
✔ fs.list caps at 10000 entries with an honest flag
✔ fs.read returns exact utf8 bytes; binaries arrive base64
✔ fs.read caps at 1 MiB with an honest flag
✔ escape attempts deny without spawning and audit honestly
✔ sandbox runs confined or refuses honestly with audit (all paths gated)
✔ audit chain verifies and exports the fs trail
ℹ tests 10 · pass 10 · fail 0
```

Each test spawns its own daemon against an isolated user-data dir (fresh
chain, no cross-test grants), with a synthetic fixture (synthetic dir and
file names only — nothing personal ever touches disk or screen).

### Deck flow — `tests/ui/files-deck-verify.mjs` (all pass, both themes)

Approval card appears on first grant → A approves → listing renders →
second card asks for fs.read → content renders; deny shows the denied
state with zero rows; NOT_IMPLEMENTED shows the honest banner; Tab
reaches the input and the List button; 2 px focus ring; row text
14.50–16.88:1 (AA ≥ 4.5); zero page errors; per-theme screenshots.

### Regression battery (all green on this host)

- `cargo clippy --workspace --target x86_64-pc-windows-gnu -- -D warnings`: clean.
- `cargo test --workspace` (6 + 4 + 8 + 8 + 19 across crates) + `cargo test -p cored --features mock-keyring` (36/36): pass.
- `cargo fmt --check`, `tsc --noEmit`, `pnpm lint` (brand/hex/fonts), hygiene scanners: clean.
- `node --test tests/e2e/handshake.spec.ts`: **7/7** (incl. an updated gate-layering assertion, §7).
- `node tests/e2e/render-shell.mjs`: all visual checks pass (with the new Files panel mounted).
- `node --test` UI suites incl. new `protocol.spec.ts`: 26/26 pass.

## 3. Perf table (`tests/e2e/fs-perf.mjs`, Windows host)

| metric | value |
|---|---|
| cold start: spawn → ready | 26 ms (budget 2500 ms) — PASS |
| cored idle RSS (5 s after warm-up) | 15.3 MB |
| fs.list round-trip p50 / p95 / mean | 167 / 238 / 177.4 ms (n=50) |
| fs.read round-trip p50 / p95 / mean | 142 / 204 / 143.6 ms (n=50) |
| fs.list max observed | 296 ms |
| fs.read max observed | 231 ms |

Saved as `artifacts/perf-fs-win32.json`. Each round trip includes a full
Tier-1 sandboxed spawn plus audit append — no pooling, no cache — so the
p50 (~150 ms) is dominated by process creation, as expected; file I/O is
noise by comparison.

## 4. Demo GIF #2 (`scripts/capture-fs.mjs`, `assets/demo/`)

- `fs-deck-demo.gif` — 1,964,326 bytes (< 5 MB budget), GIF89a magic, 960×600, 60 frames @ 10 fps (one `writeFrame` per loop iteration over a fixed 60-iteration loop = 6.0 s): deck → List → approval card → approve (A) → listing → open file → content rendered, all against the real daemon + real sandbox.
- `fs-deck-approval-brass-void.png` (approval card moment) + `fs-deck-listed-brass-void.png` (listing + file content, `Daemon connected`), both scrubbed stills.
- Three `FS-DECK` manifest rows with post-scrub SHA-256, `scrubbed: true`.
- Fixture lives under a synthetic root (`D:\fsdemo\…` on Windows,
  `tmpdir()` elsewhere); the deck shows basenames in rows with the full
  path only in the scope field — no username, hostname, or home path
  appears in any committed pixel (verified by viewing the frames).

## 5. Deviations and follow-ups

- **D1 — one grant per tool.** Grants are keyed by tool name (P012/P015
  design), so a second directory needs revoke + re-grant; the deck
  surfaces the daemon's widening error honestly. The e2e suite sidesteps
  this with per-test stores; demos revoke stale fs grants first (explicit,
  audited). Follow-up: per-(tool, scope) grants, or a deck-owned
  "replace grant" flow (needs `capability.revoke` on the bridge —
  deliberately not added here).
- **D2 — drive-by fixes required to keep the tree green** (all pre-
  existing, all in the uncommitted stack this work builds on): P015's
  `request_approval`/`request_with_reason`/`decide_approval`/
  `persist_approval` exceeded the 7-arg clippy lint → bundled into args
  structs following the `GrantArgs` precedent; `approval_status` took an
  unused `store` → parameter removed; a `1.into()` type ambiguity and a
  `manual_range_contains` lint fixed; `handshake.spec.ts` still asserted
  the pre-P012 `-32601`-for-unknown-method behavior → updated to
  `-32001` (gate-first is the documented design) *plus* a with-token
  case preserving the original method-not-found coverage; the spec's
  `cleanCargoEnv` now picks up the user-local cc/ar shim when present
  (no-op on CI).
- **D3 — approving one card approves the visible demo card too** (shared
  global A/D handling, P015 behavior). Harmless here (local-only, no
  token issued twice for the same request), noted for a follow-up.
- **D4 — `?fsScope=` was considered and dropped** to avoid dead surface;
  the harness passes `initialScope` directly and the app always starts
  with an empty field.
- **D5 — POSIX NOT_IMPLEMENTED is covered by mapping tests + the e2e
  disjunction**, not by forced failure: on hosts where the sandbox
  exists the success path runs (as on this Windows host —
  AppContainer-confined); where it does not, the refusal path runs.
  Both end in audited `tool.exec` rows — verified byte-identical in CI
  on all three OSes.

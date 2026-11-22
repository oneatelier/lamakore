# Report P011 — core-store: bundled-SQLite daemon store

- **Date (UTC):** 2026-11-22
- **Scope:** `crates/core-store` — rusqlite with `bundled` (SQLite compiled
  in, no system dep), WAL, `synchronous=NORMAL`, `foreign_keys=ON`,
  forward-only embedded migrations, `migrations` table, `integrity_check`
  on every open, v1 schema (no secret columns), OS user-data dir DB with
  owner-only ACL, plus 8 behaviour tests.
- **Head:** `05d4ddf` on `main` (PR #7 rebase-merged with all required
  checks green; report follows as PR #8).

## 1. Implementation

- `crates/core-store/Cargo.toml`: `rusqlite 0.43` with `bundled`,
  `thiserror 2` (dev-dep repeats rusqlite for the crash test's raw
  connection). `Cargo.lock` grows by the rusqlite tree only (119 lines).
- `build.rs`: reads `codeToken` from `branding.config.json`, emits
  `TOKEN_DIR` — the token dir name never appears as a Rust literal (brand
  lint stays clean; `pnpm lint` green).
- `migrations/0001_init.sql`: v1 schema + `migrations` table; applied in
  one transaction, recorded per version, never edited in place.
- `src/lib.rs` (`Store`): open path enforces owner-only ACL (Unix `0700`
  dir pre-created + `0600` file; Windows `icacls /inheritance:r /grant:r`
  for the current user on dir and file), sets WAL/NORMAL/FK + 5 s busy
  timeout and refuses to continue unless `journal_mode` reads back `wal`,
  runs `integrity_check` before AND after migrating (fail-closed on
  anything but a single `ok`), then opens. DB path:
  user-data dir (`%APPDATA%` / `~/Library/Application Support` /
  `$XDG_DATA_HOME` or `~/.local/share`) + token dir + `store.db`
  (`default_db_path()`; `db_path_under()` is the pure, tested join).
- v1 tables: `sessions`, `messages`, `tool_calls`, `approvals`,
  `capability_grants`, `audit_events`, `settings`. No `token`/`secret`/
  `password`/`api_key`/`private_key` columns anywhere (asserted by test;
  credentials stay in the vault, P018).
- `NOTICE`: rusqlite 0.43.0 + libsqlite3-sys 0.40.0 entry added (MIT;
  SQLite itself public domain).
- `examples/dump_schema.rs`: prints the schema (used for §4 below).
- `#[deny(clippy::unwrap_used, clippy::expect_used)]` on the lib, matching
  `cored`; `compile_error!` guard for non-unix/non-windows targets.

## 2. Tests (8 integration tests, `crates/core-store/tests/store.rs`)

fresh migrate (tables + pragmas + no-secret-columns) · idempotent re-open
(version stays 1, data + settings persist across two reopens) · WAL
checkpoint TRUNCATE (`busy=0 log=0`, 50 rows intact) · crash recovery ·
concurrent read/write (1 writer × 200 rows + 4 readers, final count 200) ·
FK enforcement (orphan message/tool_call rejected) · owner-only ACL
(Unix mode bits asserted; Windows asserts the `icacls` grant names the
current user) · default-path shape (`store.db` under the token dir,
absolute).

Crash simulation is a genuine sudden-death: a second connection opens an
`IMMEDIATE` write txn, inserts poison rows (visible inside the txn), then
is `mem::forget`ten — no commit, no rollback, no close — exactly what an
OS kill leaves behind (uncommitted WAL frames). Reopen through the real
`Store::open` path must recover, report integrity ok, and show zero
poison rows with committed rows intact.

## 3. Counts — local + all 3 CI OSes

- Local (Windows, GNU target + zig toolchain): `8 passed; 0 failed`.
- CI run `45021603915` (`cargo test --workspace`, PR #7), `test result`:
  - ubuntu: `6 passed; 0 failed` (core-protocol) +
    `8 passed; 0 failed` (core-store)
  - macos: `6 passed; 0 failed` + `8 passed; 0 failed`
  - windows: `6 passed; 0 failed` + `8 passed; 0 failed`
- STOP condition (bundled SQLite fails on any CI OS): NOT triggered —
  `libsqlite3-sys` compiled and all suites passed on ubuntu, macos, and
  windows. The only ubuntu red during the PR was a `collapsible_if` lint
  in new Linux-only code (fixed forward as `00bd0bf`); never a SQLite
  failure.

## 4. Schema dump (from `cargo run -p core-store --example dump_schema`)

```sql
-- core-store schema dump (schema_version=1)
CREATE TABLE approvals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_call_id INTEGER NOT NULL UNIQUE REFERENCES tool_calls(id) ON DELETE CASCADE,
  decision     TEXT NOT NULL
               CHECK (decision IN ('allow', 'deny', 'allow_once', 'ask')),
  decided_by   TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  decided_at   TEXT NOT NULL
);
CREATE TABLE audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE capability_grants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name  TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '{}',
  granted_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL
             CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE migrations (
           version    INTEGER PRIMARY KEY,
           name       TEXT NOT NULL,
           applied_at TEXT NOT NULL
         );
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```
(continued: `settings`, `tool_calls` with FK + status CHECK, plus
`idx_audit_ts`, `idx_grants_tool`, `idx_messages_session`,
`idx_tool_calls_message`; `sqlite_sequence` is AUTOINCREMENT bookkeeping.)

```sql
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE tool_calls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  args_json  TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  created_at TEXT NOT NULL
);
-- indexes
CREATE INDEX idx_audit_ts ON audit_events(ts);
CREATE INDEX idx_grants_tool ON capability_grants(tool_name);
CREATE INDEX idx_messages_session ON messages(session_id, id);
CREATE INDEX idx_tool_calls_message ON tool_calls(message_id);
```

## 5. Crash-test transcript (pasted, `cargo test -p core-store crash -- --nocapture`)

```text
crash-test: poison rows visible inside dead txn: 1
crash-test: connection forgotten without commit (simulated kill)
crash-test: integrity_ok=true poison_tool_calls=0 kept_messages=1
test result: ok. 1 passed; 0 failed
```

## 6. Gates and deviations

- **[E] Evidence gate:** machine-checkable outputs above (CI run
  `45021603915` for all three OSes; local `8 passed`; dump + transcript
  pasted verbatim; hygiene/clippy/fmt/pnpm all green locally and required
  checks green on the PR).
- **[V] Visual gate:** deferred — no visual surface (daemon storage
  internals; nothing a human sees changed).
- **Deviations:** (a) local builds ride the GNU target + zig toolchain
  with a user-local `ccwrap.exe` shim (translates cargo's
  `--target=x86_64-pc-windows-gnu` to zig's `x86_64-windows-gnu` and maps
  `ar`/`ranlib` to `zig ar`/`zig ranlib`) because this host has no MSVC
  linker and `cc` needs a C compiler; CI (real MSVC) is unaffected and is
  the authority for the Windows result. (b) `cored` does not depend on
  `core-store` yet — wiring belongs to the vault prompt (P018), which is
  the first consumer; `core-store` builds and is covered under
  `cargo check/test/clippy --workspace` as a member.

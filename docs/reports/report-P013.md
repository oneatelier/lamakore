# Report P013 — Tier-1 Windows sandbox (Job Objects + AppContainer)

- **Date (UTC):** 2026-11-22
- **Scope:** `crates/core-sandbox` Tier-1 — Windows Job Object
  (`KILL_ON_JOB_CLOSE`, no breakaway, UI restrictions) + AppContainer
  profile with ZERO capabilities (no network, no broad FS) + DACL grant of
  the declared scope dir to the AppContainer SID. `spawn_sandboxed` is the
  helper P017 dispatches through. `windows 0.62` lockfile-pinned with
  `Win32_Foundation / Win32_Security / Win32_Security_Authorization /
  Win32_Security_Isolation / Win32_System_JobObjects / Win32_System_Threading`.
- **Head:** `fb2c3c9` on `main` + this working tree (implementation, tests,
  report; PR to follow).

## 1. Implementation (`crates/core-sandbox/src/tier1.rs`)

- Profile name from `branding.config.json` `codeToken` via `build.rs`
  (`{token}-tool-sandbox`, here `pone-tool-sandbox`); the brand literal
  never appears in Rust source (brand lint clean).
- `appcontainer_sid()`: `DeriveAppContainerSidFromAppContainerName`, else
  `CreateAppContainerProfile` with `None` capabilities (zero caps). Both
  failures map to `SandboxError::Api` with `AppContainer` in the detail so
  the tests can honestly SKIP when AppContainer is unavailable.
- `grant_scope_access()`: `GetNamedSecurityInfoW` → `SetEntriesInAclW`
  (`GRANT_ACCESS`, `GENERIC_ALL`, `SUB_CONTAINERS_AND_OBJECTS_INHERIT`,
  `TRUSTEE_IS_SID`/`TRUSTEE_IS_UNKNOWN`) → `SetNamedSecurityInfoW`,
  preserving the existing DACL. `LocalFree` for both descriptors.
- `create_job()`: `CreateJobObjectW`, then
  `JobObjectExtendedLimitInformation` with
  `LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` only (breakaway
  deliberately absent), then `JobObjectBasicUIRestrictions` with all eight
  `JOB_OBJECT_UILIMIT_*` bits (255).
- `spawn_in_appcontainer()`: `SECURITY_CAPABILITIES{AppContainerSid,
  Capabilities=NULL, Count=0}` via `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`,
  `CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW`,
  working directory = absolutized `scope_dir` (NOTE: `canonicalize` yields a
  `\\?\`-prefixed verbatim path that `CreateProcessW` rejects as cwd with
  `FILE_NOT_FOUND`, so `std::path::absolute` is used), then
  `AssignProcessToJobObject` before `ResumeThread` (closes the assign race).
- `SandboxedChild`: holds Job + process + thread; `Drop` closes all three
  (closing the last Job handle kills the tree via `KILL_ON_JOB_CLOSE`).
  `is_alive()` (`GetExitCodeProcess` vs 259), `is_in_job()`
  (`IsProcessInJob`), `wait()`, `wait_timeout()`, `kill()`
  (`TerminateJobObject`, fallback `TerminateProcess`). `Send` impl for
  future P017 dispatch.
- `Cargo.toml`: `thiserror 2` + Windows-only `windows 0.62` with the six
  features above. `Cargo.lock` pins `windows 0.62.2` (+108 lines for the
  windows tree; no other new deps).

## 2. Tests (`crates/core-sandbox/tests/tier1.rs`)

Windows (CI + owner-local), each with honest AppContainer-unavailable SKIP:

- `child_write_outside_scope_denied`: PowerShell tries
  `Set-Content <outside>`; must record `denial.txt` inside scope with
  `Access to the path … is denied`, leave `outside.txt` absent, exit ≠ 0.
- `child_tcp_connect_fails`: parent `TcpListener(127.0.0.1:0)`; child
  PowerShell `TcpClient.BeginConnect` 3 s; must record `netdenial.txt`,
  never create `netok.txt`, listener must accept nothing, exit ≠ 0.
- `parent_killed_child_dies`: spawn `Start-Sleep 30`, assert `is_alive` +
  `is_in_job` + `tasklist` shows pid, `drop` the job, poll `tasklist /FO CSV`
  up to 5 s; must be dead (P008 kill-drill shape).
- `spawn_overhead_p50`: 50× `cmd /C exit 0` + `wait`, sorted durations,
  prints `min/p50/max`, asserts `p50 < 2000 ms`.

Non-Windows (ubuntu/macos CI):

- `spawn_returns_not_implemented_off_windows` + `not_implemented_code_is_stable`:
  `Err(UnsupportedPlatform)`, `wire_code() == -32002`.

## 3. Counts

Local (Windows, GNU `1.100.0-x86_64-pc-windows-gnu` + zig `0.17.1` via
user-local `ccwrap`/`zigcc`, `CARGO_TARGET_DIR=D:\t` for the `cored`
link-line limit; CI MSVC is the authority):

- `cargo test --workspace`: core-protocol **6 passed**, core-sandbox lib
  **0** + `tier1` **4 passed**, core-store **8 passed**, cored **4 passed**,
  0 failed everywhere.
- `cargo test -p cored --features mock-keyring`: **16 passed, 0 failed**.
- `cargo clippy --workspace --all-targets -- -D warnings`: clean.
- `cargo fmt --check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (22 passed):
  all green.

CI (`verify` on ubuntu/macos/windows): `cargo test --workspace` runs the
same suites; Windows runs the 4 enforcement tests for real, ubuntu/macos
run the 2 NOT_IMPLEMENTED tests. STOP below covers the AppContainer-absent
case.

## 4. Real denial outputs (owner-local, pasted verbatim)

Write-outside-scope (`--nocapture`):

```text
write-deny: child pid=11772 exit=1
write-deny denial.txt:
System.UnauthorizedAccessException: Access to the path '%USERPROFILE%\AppData\Local\Temp\core-sandbox-5620-1-write-deny\outside.txt' is denied.
   at System.IO.__Error.WinIOError(Int32 errorCode, String maybeFullPath)
   at System.IO.FileStream.Init(String path, FileMode mode, FileAccess access, Int32 rights, Boolean useRights, FileShare share, Int32 bufferSize, FileOptions options, SECURITY_ATTRIBUTES secAttrs, String msgPath, Boolean bFromProxy, Boolean useLongPath, Boolean checkHost)
   at System.IO.FileStream..ctor(String path, FileMode mode, FileAccess access, FileShare share)
   at Microsoft.PowerShell.Commands.FileSystemContentReaderWriter.CreateStreams(String filePath, String streamName, FileMode fileMode, FileAccess fileAccess, FileShare fileShare, Encoding fileEncoding)
   at Microsoft.PowerShell.Commands.FileSystemProvider.GetContentWriter(String path)

write-deny: outside exists=false unexpected exists=false
```

TCP-connect (`--nocapture`):

```text
net-deny: listener on 127.0.0.1:54937
net-deny: child pid=21904 exit=1
net-deny: listener got no connection as expected: A non-blocking socket operation could not be completed immediately. (os error 10035)
net-deny netdenial.txt:
System.Management.Automation.RuntimeException: connect timeout
```

The scope grant works: both children wrote their `*denial.txt` files
*inside* the granted scope while the outside write and the loopback
connect both failed.

## 5. Kill-drill transcript (owner-local, pasted verbatim)

```text
kill-drill: spawned pid=10528
kill-drill tasklist before:

Image Name                     PID Session Name        Session#    Mem Usage
========================= ======== ================ =========== ============
powershell.exe               10528 Console                    1     56,040 K

kill-drill poll 0: still=false
kill-drill: pid=10528 dead=true after=279.6033ms
```

`IsProcessInJob` is asserted true before the drop in the test
(`is_in_job()`); `tasklist` confirms live-before and dead-after with no
orphan. Earlier runs: `pid=15668 dead after 439 ms`, `pid=23756 dead after
390 ms`, `pid=18148 dead after 283 ms` — all < 500 ms.

## 6. Spawn overhead (owner-local, pasted verbatim)

```text
spawn overhead over 50 runs: min=21.65ms p50=37.9673ms max=92.4886ms
```

p50 **≈ 38 ms** (earlier runs: 77 ms, 69 ms, 37 ms depending on load;
all < 100 ms, budget 2000 ms). Cost is one Job + one AppContainer spawn +
one DACL grant per call — no VM.

## 7. Gates and deviations

- **[E] Evidence gate:** machine-checkable outputs above (local green on
  both default and `mock-keyring` suites; transcripts pasted verbatim;
  hygiene/clippy/fmt/pnpm all green). CI `verify` on all three OSes is the
  authority for the merge; this report follows with the numbers.
- **[V] Visual gate:** deferred — no visual surface (sandbox internals;
  nothing a human sees changed).
- **STOP — AppContainer unavailable on CI:** the Windows tests detect
  `Api` failures whose detail/op mentions `AppContainer`/`Isolation` and
  print `SKIP … AppContainer unavailable on this host` + pass instead of
  faking green. If `windows-latest` ever shows SKIP, it is recorded in CI
  logs and the owner-local evidence above (§4–§6) carries the gate — never
  a fabricated pass. On this host AppContainer is available
  (`S-1-15-2-…` derived/created; all 4 tests ran for real, no SKIP).
- **Deviations:** (a) local builds ride the GNU target + zig toolchain
  with user-local `ccwrap`/`zigcc` shims and `CARGO_TARGET_DIR=D:\t` to
  keep the `cored` test-binary link line under the shim's length limit
  (same detour as P008/P011/P012); CI (real MSVC, default target dir) is
  unaffected and is the authority. (b) `scope_dir` is absolutized with
  `std::path::absolute`, not `canonicalize`: the latter yields a
  `\\?\`-prefixed verbatim path that `CreateProcessW` rejects as the child
  cwd with `FILE_NOT_FOUND` (found during bring-up; Job-only probe passed,
  AppContainer probe failed until the fix).

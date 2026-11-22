# Report P008 — Electron Shell, Rust Daemon, Wire/1 Handshake

- **Date (local):** 2026-11-22 IST
- **Visual gate:** **LIVE — passed.** Shell renders in brass-void + parchment;
  all four connection states verified by screenshot + programmatic checks.

## 1. Objective

A real desktop window driven by a real Rust core over a real local-only
IPC contract: Electron 45.4.1 shell, `cored` daemon, `wire/1` handshake,
kill-proof lifecycle, and proof of every acceptance claim.

## 2. Evidence

**E2E (`node --test tests/e2e/handshake.spec.ts`): 7/7 pass.**
- wire/1 handshake succeeds; `system.health` returns ok; `system.info`
  carries brand constants; unknown methods → -32601.
- Version/build/token mismatches are each REFUSED with a reason; the
  daemon closes the connection.
- App boots, handshakes, and reports cold start: **173 ms in-app
  (spawn→handshake), 532 ms wall** — budget 2500 ms.
- Kill drill: daemon killed mid-session → UI shows `unreachable` inside
  the 6 s budget → auto-restart reconnects with a new pid, app alive,
  zero `cored` processes remain afterwards (no orphans).
- `netstat -ano -p TCP` while app (PID 7180) + daemon (PID 22724) ran:
  system listeners exist (RPC/SMB) but **zero LISTENING sockets owned by
  the app or the daemon**. Named pipes do not appear in netstat by design.
- `cargo clippy --workspace --target x86_64-pc-windows-gnu -- -D warnings`
  exits 0; `git grep` proves zero `unwrap()`/`expect(` outside
  `#[cfg(test))` modules (crate-level `#![deny]` is the enforcer).
- 6 Rust unit tests green (framing round-trip, handshake accept/refuse
  matrix, ring spill + cumulative ack).

**Visual (headless Chrome + `tests/e2e/render-shell.mjs`, all pass):**
- 2 themes × 4 states screenshot-verified by the engineer
  (`artifacts/shell-*.png`): connecting, connected, unreachable (with
  recovery action), degraded (banner + Retry) — all designed, no
  placeholder text.
- Keyboard Tab walks 16 stops across nav, theme buttons, actions, link,
  input; focus shows the 2 px brass ring (`rgb(217, 180, 99)`);
  no default browser outline survives (`:focus{outline:none}` +
  `:focus-visible` ring in generated CSS).
- CLS 0.0001 (≤ 0.02); rAF resize loop 120 fps headless software GL
  (60 fps target is native-GPU; compositing is transform/opacity-only).

**STOP evaluation (halt conditions, both clear):**
- No TCP listener anywhere in the daemon or app path — verified above.
- `contextIsolation:true, nodeIntegration:false, sandbox:true,
  webSecurity:true, allowRunningInsecureContent:false` + strict CSP +
  blocked navigation/popups/webviews — verbatim in
  `apps/desktop/src/main/window.ts`; no `@electron/remote` anywhere.

## 3. Toolchain detour (local-only, CI unaffected)

This host has no MSVC linker (VS Build Tools blocked since P001, still
unelevated). Local Rust builds now ride a pinned GNU toolchain
(`1.100.0-x86_64-pc-windows-gnu` via rustup) plus a user-local zig 0.17.1
as linker (`zig cc -target x86_64-windows-gnu` via a `zigcc` shim that
drops MSVC-only flags, forwards `-Wl,*.def` as bare inputs with
`--export-all-symbols`, and injects a hand-built `synchronization`
import/def pair after proving the system DLL name does not exist as a
file). `.cargo/config.toml` only reroutes the GNU target, so CI on
`windows-latest` (real MSVC) is untouched. The e2e spec pins
`RUSTUP_TOOLCHAIN` itself. Full chain documented for reproducibility.

## 4. Deviations

- **D1 — unreachable is surfaced on certain death, then retried.**
  The prompt orders restart-then-surface; the implementation shows the
  truthful state immediately on child exit (which is what lets the 6 s
  budget hold) while background restarts proceed capped at 3. Manual
  Retry re-arms the budget. No silent infinite respawn in any path.
- **D2 — `?theme=`/`?conn=` screenshot overrides** in the dev entry
  (documented test hooks, not user paths).
- **D3 — CSP keeps `style-src 'unsafe-inline'`** for React inline styles;
  the follow-up moves styles to classes (recorded, not hidden).
- **D4 — prebuilt `synchronization.dll` forwarder** lives in the
  user-local tools dir (never in the repo) because the system exposes
  those APIs only via API set; CI/real toolchains link the real import
  lib and never see the shim.
- **D5 — ?conn override + E2E_SMOKE flag** are harness-only; production
  boot always performs the full handshake or quits non-zero.

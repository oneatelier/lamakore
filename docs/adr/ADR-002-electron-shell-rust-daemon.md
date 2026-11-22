# ADR-002 — Electron Shell, Rust Daemon

- **Status:** Accepted
- **Date:** 2026-11-22
- **Scope:** PROJECT ONE desktop runtime (all three OS images)
- **Inputs:** `apps/desktop`, `crates/cored`, `docs/reports/report-P008.md`

## 1. Context

The product is a unified agent desktop: a real window, GPU-accelerated
rendering on all three OS images, and a trusted native core. The shell
decision gates everything downstream (P007 visual work, P008 RAM gate,
all renderer prompts).

## 2. Decision — Electron 45.4.1 (Chromium 156), Rust daemon

Electron over Tauri, pinned at 45.4.1, with the renderer treated as
untrusted (ADR-000) and all capability in a Rust daemon over a local-only
wire protocol (ADR-006).

## 3. Why Electron (verified reason)

- **WebGPU is unavailable in WKWebView before macOS 26.** The N2
  requirement is uniform GPU-accelerated 3D on macOS, Windows, and Linux.
  Tauri's macOS webview cannot provide it on the OS versions we support;
  Chromium 156 provides WebGPU on all three targets today.
- **WebKitGTK's Linux GPU path is unreliable** (hardware-dependent
  acceleration, widely reported rendering fallbacks). Chromium's Linux
  GPU stack is the tested one.
- The daemon boundary (ADR-000/ADR-006) makes the shell choice
  replaceable: if a future webview reaches parity, only the thin
  host layer moves.

## 4. Hardening (non-negotiable, verified in report-P008)

`contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`,
`webSecurity:true`, `allowRunningInsecureContent:false`, strict CSP,
blocked remote navigation and `window.open`, no `@electron/remote`, no
nodeIntegration in any webview, allowlisted `contextBridge` surface only.

## 5. Reversal trigger

**If the RAM gate fails, reopen this ADR.** If the idle shell plus
daemon plus local model cannot fit the P000 budget on the reference
host, the shell choice is back on the table (lighter host, deferred 3D,
or remote-render) — with fresh measurements, not opinions.
Electron is not load-bearing for identity, protocol, or policy.

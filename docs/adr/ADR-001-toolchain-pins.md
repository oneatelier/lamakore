# ADR-001 — Toolchain Pins

- **Status:** Accepted
- **Date:** 2026-11-21
- **Scope:** PROJECT ONE build toolchain (all platforms)
- **Inputs:** `artifacts/toolchain.lock.json`, `scripts/bootstrap/*.ps1|*.sh`, `scripts/bootstrap/verify.mjs`, `docs/reports/report-P001.md`

## 1. Context

P000 proved the reference machine is clean: no git, no Node, no Rust, no
compiler, non-elevated shell. Every later prompt (P002 Electron pin,
P007 GPU, P008 perf gates) needs a reproducible foundation, so P001 pins
exact versions with integrity data instead of "latest".

## 2. Decision — the pins

| Tool | Requested pin | Resolved on DESKTOP-LUIL8F6 | Source | Integrity |
|---|---|---|---|---|
| Rust | 1.100.0 (rel. 2026-11-12, channel manifest confirmed) | 1.100.0, edition 2024 | rustup stable channel (`static.rust-lang.org`) | `managed-by:rustup` |
| pnpm | 12.22.0 (npm publish 2026-11-17T20:01:11Z, confirmed) | 12.22.0 | corepack / npm registry | `managed-by:corepack` |
| Node | newest 24.x LTS at runtime | 24.22.3 (index 2026-11-10, LTS "Krypton") | nodejs.org dist | SHA256 `4a1ab5bd…f7db545` (SHASUMS256.txt) for the fetched asset |
| Git | unpinned (latest stable) | 2.56.1 (winget) / portable fallback | winget `Git.Git` / git-for-windows releases | `managed-by:winget` or release-notes SHA |
| Electron | **45.4.1 (Chromium 156) — pinned in P002, NOT installed here** | n/a | npm registry (publish 2026-11-19 confirmed present) | P002's lock |
| VS Build Tools | C++ workload (Windows) | present-or-blocked (see §4) | winget `Microsoft.VisualStudio.2022.BuildTools` | `managed-by:winget` |
| Windows SDK | 10.x | 10.0.26100.0 (preinstalled, reused) | preinstalled | n/a |

Full per-asset URLs + digests live in `artifacts/toolchain.lock.json`.
`node scripts/bootstrap/verify.mjs` enforces rustc/pnpm/node exactly and
exits non-zero on any mismatch.

## 3. Why each pin (and the runner-up)

- **Rust 1.100.0.** First stable train cut after the P000 inventory date
  with edition-2024 fully stabilized for our use; new enough for
  `let`-chains/async-drop semantics the daemon will rely on, old enough
  that crates (napi, tokio) have published compatible versions.
  Runner-up: 1.99.x — rejected: would forfeit the stabilized APIs without
  any MSRV pressure from our (greenfield) dependency set.
- **pnpm 12.22.0, NOT 10/11.** Prompt-mandated major line; 12.22.0 is the
  latest 12.x patch at bootstrap time with the isolated-store layout P002
  assumes. Runner-up: pnpm 11 LTS — rejected: lockfile format drift
  between majors would silently re-resolve the P002 Electron tree.
- **Node newest 24.x LTS (24.22.3 observed).** Electron 45 runs on a
  Node 22+ ABI-compatible runtime; Node 24 LTS is the active LTS at
  bootstrap, and resolving the patch live (then freezing it in the lock)
  avoids shipping a stale-patch script. Runner-up: Node 22 LTS —
  rejected: shorter remaining support window for a new desktop app.
- **Electron 45.4.1 deferred to P002.** The shell (Node ABI, Chromium
  156, RAM footprint) is P002's decision with its own lock entry;
  installing it here would pre-empt the RAM-gate evidence P008 needs.

## 4. Platform notes (this host)

The bootstrap shell is **non-elevated**, so `windows.ps1` branches:
elevated → machine-wide (winget/MSI); non-elevated → SHA256-verified
user-local installs (PortableGit SFX, Node zip) under
`%LOCALAPPDATA%\Programs\project-one` + User PATH. VS Build Tools
**cannot** install without elevation: the script skips it with the exact
elevated re-run command rather than failing the pins or downgrading.
Windows SDK 10.0.26100.0 was already present and is reused.

## 5. Reversal triggers

- **Rust:** if a daemon dependency requires an MSRV > 1.100.0 with no
  backport, reopen with the exact crate + error; prefer bumping forward
  only, never sideways.
- **pnpm:** if P002's Electron 45.4.1 tree fails to resolve under pnpm 12
  (e.g. postinstall lifecycle breakage), reopen with the failing package
  log; do not silently fall back to npm.
- **Node:** if Electron 45's ABI rejects Node 24 headers at build time,
  pin the newest 22.x LTS instead and record the ABI error verbatim.
- **Electron (P002):** if Electron 45 breaches the RAM gate in P008
  (idle shell + daemon + small_7b model exceeding usable RAM), reopen
  ADR-002 — shell choice is downstream of this ADR's toolchain, not
  above it.

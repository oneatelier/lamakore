# Report P001 — Pinned Toolchain Bootstrap

- **Date (local):** 2026-11-21 ~21:03 IST (lock `generated_at`)
- **Host:** DESKTOP-LUIL8F6 (Windows 11 Home SL 10.0.26300 x64)
- **Mode:** Installs performed (P000's no-install constraint is lifted by this prompt).
- **Visual gate:** **N/A — deferred.** No UI in this prompt; no pass claimed.

## 1. Objective

Install a reproducible, version-pinned toolchain on the clean P000 host
and record exact resolved versions with integrity data.

## 2. What ran (in order, per prompt)

`scripts/bootstrap/windows.ps1` (selected per `machine-profile.json` OS;
macOS/Linux scripts provided unexecuted — see §7):

1. Git → 2. GitHub-API-resolved PortableGit SFX, SHA-verified (non-elevated shell)
2. Node 24 LTS → resolved **24.22.3** live from `nodejs.org/download/release/index.json`, SHA-verified zip (non-elevated) / MSI (elevated)
3. `corepack enable` → `corepack prepare pnpm@12.22.0 --activate`
4. `rustup` (rustup-init.exe, SHA-verified) → `rustup toolchain install 1.100.0 && rustup default 1.100.0`
5. Build deps → Windows SDK 10.0.26100.0 reused as present; VS Build Tools C++ workload **skipped with the exact elevated command** (non-elevated shell cannot install it; reported, not downgraded)

Full transcript: `artifacts/bootstrap-windows.log` (first run) and
`artifacts/bootstrap-windows-rerun.log` (idempotency run).

## 3. Resolved versions (all observed, none invented)

| Tool | Requested | Resolved (observed) | Source | Integrity |
|---|---|---|---|---|
| Rust | 1.100.0 | 1.100.0 — `rustc 1.100.0 (0ef1bc386 2026-11-09)`, cargo 1.100.0, channel date 2026-11-12 | rustup / static.rust-lang.org | `managed-by:rustup` (+ rustup-init.exe SHA256 verified pre-exec, recorded in lock) |
| pnpm | 12.22.0 | 12.22.0 (npm publish 2026-11-17 confirmed via registry) | corepack / npm registry | `managed-by:corepack` |
| Node | newest 24.x LTS at runtime | **24.22.3** (index 2026-11-10, LTS "Krypton") | nodejs.org dist | SHA256 `e612af99…5f7d9f` from SHASUMS256.txt, verified pre-extract |
| Git | latest stable (unpinned) | 2.56.1.windows.1 | git-for-windows release | SHA256 `9dd04a60…b49c7` from release notes via API, verified pre-extract |
| Electron | 45.4.1 | **NOT INSTALLED** (P002) | npm registry (publish 2026-11-19 confirmed) | P002's lock |

Machine-readable: `artifacts/toolchain.lock.json` (schema `1.0.0-p001`).

## 4. Deviations and incidents (all in the open)

- **D1 — non-elevated shell.** The bootstrap shell is not elevated
  (confirmed via `WindowsPrincipal.IsInRole(Administrator)` = False), so
  `windows.ps1` takes the user-local branch: PortableGit SFX + Node zip
  under `%LOCALAPPDATA%\Programs\project-one` with SHA256 verification,
  User-PATH registration. Machine-wide MSI/winget paths are kept for
  elevated runs. Same pins, same hashes, different prefix.
- **D2 — release-notes hash format.** First Git attempt aborted on a
  SHA256 mismatch: my parser expected `hash filename`, upstream
  publishes `filename | hash`, and `\s+` matched across newlines pairing
  the wrong hash. The download was byte-perfect (size = asset size, hash
  re-confirmed after fixing the regex to `name\s*\|\s*([0-9a-f]{64})`).
  Fail-closed behavior worked as designed — the script aborted rather
  than installing.
- **D3 — corepack arg quoting.** `corepack prepare "pnpm@12.22.0 --activate"`
  passed the flag as part of the version tag (corepack fell back to
  12.21.0 and the script's exact-match guard aborted). Fixed to
  `corepack prepare "pnpm@X" --activate` in all three scripts.
- **D4 — PowerShell 5.1.** The host default is WinPS 5.1, not PS7: the
  `?:` ternary in the summary block failed to parse. Rewrote 5.1-clean.
  All bootstrap scripts are now 5.1-compatible by construction.
- **D5 — VS Build Tools blocked (reported, not a STOP).** Requires
  elevation; the non-elevated run skips with the exact re-run command.
  STOP applies to pins — every pin installed — so no halt; C++ link
  builds stay blocked until an elevated run.
- **D6 — cosmetic:** `rustup --version` prints an info notice on stderr
  that PowerShell surfaces red; suppressed with `2>$null` after the
  verified runs (display-only, no behavior change).

## 5. Gate self-scores

| Gate | Result |
|---|---|
| [E] `node scripts/bootstrap/verify.mjs` exits 0, prints rustc 1.100.0 and pnpm 12.22.0 exactly | **PASS** — exit 0, all 5 rows PASS (rustc/pnpm/node exact, git + cargo presence) |
| [E] lock contains an actually-observed Node 24.x patch | **PASS** — 24.22.3 resolved live from the official index and re-observed via `node --version` in a fresh shell |
| [E] bootstrap re-run is idempotent | **PASS** — second run exit 0; git/node/pnpm/rust all `[ok]/[skip]`, zero duplicate installs (`bootstrap-windows-rerun.log`) |
| [V] Visual verification | **N/A — deferred.** No UI; no pass claimed. |
| STOP (pin uninstallable → halt, no downgrade) | **Not triggered.** All four pins installed at exact versions; VSBT is a platform dep, not a pin, and was reported not downgraded. |

## 6. Next steps

1. **Elevated run** (human or elevated agent): re-run `windows.ps1` elevated to take the machine-wide path if desired and, critically, to install the VS Build Tools C++ workload; then `verify.mjs` again.
2. **P002:** pin + install Electron 45.4.1 (Chromium 156) with its own lock entry; `npm ci` stays forbidden (no package-lock.json in repo).
3. P000's deferred `chore(P000)` commit is folded into this prompt's commit sequence below.

## 7. Unexecuted scripts

`scripts/bootstrap/macos.sh` and `linux.sh` were written (same pins,
same SHA-verify-then-install discipline, no webkit2gtk) but **not
executed** — this host is Windows. They carry the D3 corepack fix and
await their platforms; running them here is impossible, claiming
otherwise would be fabrication.

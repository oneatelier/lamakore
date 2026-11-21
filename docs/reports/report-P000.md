# Report P000 — Clean-Machine Inventory & Threat Boundary

- **Date (local):** 2026-11-21 20:40 IST (UTC+05:30)
- **Host:** DESKTOP-LUIL8F6
- **Mode:** No installs performed (per prompt constraint). Shell-only probing.
- **Visual gate:** **deferred to P007** — no UI exists in this prompt; no pass claimed.

## 1. Objective

Establish ground truth about the clean host and write the first ADR, so
that GPU tier, sandbox driver order, and local-model feasibility in later
prompts rest on measured facts instead of assumptions.

## 2. Commands run

All read-only; nothing installed, no service or feature state changed.

**OS / CPU / memory:**
`$PSVersionTable` · `Get-ComputerInfo -Property OsName,OsVersion,OsBuildNumber,OsArchitecture,OsLocale,TimeZone,TotalPhysicalMemory,CsProcessors`
· `Get-CimInstance Win32_OperatingSystem` (Caption, Version, BuildNumber, OSArchitecture, TotalVisibleMemorySize, FreePhysicalMemory, TotalVirtualMemorySize, Locale)
· `Get-CimInstance Win32_Processor` · `Get-CimInstance Win32_ComputerSystem`
· `systeminfo` (memory/VBS/hypervisor cross-check) · `cmd /c ver`

**GPU:** `Get-CimInstance Win32_VideoController` (Name, AdapterCompatibility, DriverVersion, DriverDate, AdapterRAM, resolution)
· `wmic path win32_VideoController get name,DriverVersion` (**failed** — see §4.1)

**Swap/disk:** `Get-CimInstance Win32_PageFileUsage` · `Get-CimInstance Win32_PageFileSetting`
· `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='D:'"` · `Get-PSDrive -PSProvider FileSystem`
· `fsutil volume diskfree D:` (**failed** — see §4.9)

**Shell/locale/TZ:** `$PSVersionTable.PSVersion` · `cmd /c ver` · `Get-Command pwsh` (absent)
· `Get-Culture` · `[System.TimeZoneInfo]::Local` · `tzutil /g` · `Get-ExecutionPolicy -List`

**Sandbox posture:** `Get-ComputerInfo -Property HyperV*` · `systeminfo` VBS/hypervisor lines
· `Get-WindowsOptionalFeature -Online -FeatureName <…>` ×7 (**all failed** — see §4.2–4.4)
· `wsl --status` · `Get-MpComputerStatus` · `whoami /priv`

**Tooling (each: `Get-Command` + `where.exe` + `<tool> --version`):**
git, node, npm, pnpm, corepack, rustc, cargo, rustup, python, python3, docker, podman, cmake, cl, gcc, clang, cc, tcc, make, ninja, signtool, certutil, code, just, ollama
— plus `Test-Path` guards (Git, nodejs, VS, .cargo, .rustup, nvm, Ollama, WinGet packages),
`(Get-Item signtool.exe).VersionInfo`, `dotnet --version`, `winget --version`,
and registry `HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots`.

## 3. Full profile table

| # | Item | Value (measured) | Source |
|---|---|---|---|
| 1 | OS name | Microsoft Windows 11 Home Single Language | CIM Caption |
| 2 | OS version / build | 10.0.26300 / 26300 (rev 26300.9974 via `cmd /c ver`) | CIM + ver |
| 3 | Architecture | x64 (64-bit; x64-based PC) | CIM + systeminfo |
| 4 | Total RAM | 16 849 256 448 B = 16 069 MiB (15.69 GiB usable) | CIM TotalPhysicalMemory |
| 5 | Free RAM (at probe) | 6 370 564 KiB (~6.07 GiB; systeminfo said 6 309 MB minutes apart) | CIM FreePhysicalMemory |
| 6 | Swap | `C:\pagefile.sys`, initial 24 576 MB / max 32 768 MB; 25 165 824 KiB stored; virt-max 41 620 176 KiB | CIM PageFile* |
| 7 | CPU model | 13th Gen Intel(R) Core(TM) i5-1334U (GenuineIntel) | CIM Processor |
| 8 | Cores | 10 physical / 12 logical | CIM Processor |
| 9 | GPU vendor/model | Intel Corporation / Intel(R) Iris(R) Xe Graphics | CIM VideoController |
| 10 | GPU driver | 32.0.101.7092, dated 2026-09-03 | CIM VideoController |
| 11 | GPU memory | 2 147 479 552 B aperture — **shared system memory, not dedicated VRAM** | CIM AdapterRAM + note |
| 12 | Display | 1920×1080 | CIM |
| 13 | Workspace disk | D: (Private, NTFS) — size 108 145 930 240 B, free 107 924 402 176 B (~100.5 GiB) | CIM LogicalDisk |
| 14 | System disk | C: 150.75 GB free | Get-PSDrive |
| 15 | Shell | Windows PowerShell 5.1.26100.9818 (Desktop) + cmd 10.0.26300.9974; pwsh 7+ absent | $PSVersionTable, ver |
| 16 | Locale | en-US (LCID 1033) | Get-Culture |
| 17 | Timezone | India Standard Time, +05:30, no DST | TimeZoneInfo + tzutil |
| 18 | git / node / npm / pnpm / corepack | **absent** (pnpm payload remnant in %APPDATA%\npm, unrunnable without node) | where/Get-Command |
| 19 | rustc / cargo / rustup | **absent** (no .cargo/.rustup) | Get-Command + Test-Path |
| 20 | python3 / python | `python3` = Store stub only (**absent**); `python` 3.13.17 **present** (per-user) | --version probes |
| 21 | docker / podman | **absent** | Get-Command |
| 22 | cmake / C compiler | **absent** (cl/gcc/clang/cc/tcc/make/ninja unresolvable; VS x86 remnant dir unverified) | where.exe sweep |
| 23 | Code signing | **present**: SDK 10.0.26100.0 `signtool.exe` (ProductVersion 10.0.26100.9457) by full path, not on PATH; certutil present | Test-Path + VersionInfo |
| 24 | Extras present | dotnet 8.0.426, winget 1.29.380, VS Code, Windows SDK 10.0.26100.0, VBS running, hypervisor present, Defender real-time ON | --version / status |
| 25 | WSL | wsl.exe exists, **no distro installed** | `wsl --status` |
| 26 | Derived `gpu_tier` | **A** — modern integrated, WebGPU-capable (D3D12 backend); capability claim only, P007 must probe | derivation §5 |
| 27 | Derived `local_model_class` | **small_7b** — 15.69 GiB usable sits under the 16 GiB cut; ~6 GiB free at idle | derivation §5 |
| 28 | Derived `sandbox_drivers_available` | job_objects, appcontainer_and_integrity_levels, lpac, vbs_hvci_running, defender_realtime_protection | derivation §5 |

## 4. Every UNKNOWN + why

1. **GPU WMIC cross-check** — `wmic path win32_VideoController get name,DriverVersion` → "`wmic` is not recognized" (WMIC removed on this build). Non-blocking: CIM returned the full GPU record.
2. **Hyper-V feature state** — `Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V` → "requires elevation". Non-elevated inventory cannot determine it.
3. **WSL2 feature state** — same command for `Microsoft-Windows-Subsystem-Linux` → elevation error. (`wsl.exe` itself reports no distro installed.)
4. **Sandbox/Containers/VMP states** — same elevation error for `Windows-Sandbox`, `Containers`, `VirtualMachinePlatform`, `IsolatedUserMode`.
5. **python3 version** — `python3 --version` resolves only to the Store stub ("Python was not found"). Real interpreter exists solely as `python` 3.13.17.
6. **Linked C compiler** — `where.exe` for cl/gcc/clang/cc (plus tcc/make/ninja) all report "Could not find files". A `Microsoft Visual Studio` remnant dir exists under Program Files (x86) but no compiler was verified, so ABSENT — not guessed.
7. **CIM FreeVirtualMemorySize** — returned empty; substituted `systeminfo` (Virtual Memory Available 27 087 MB / Max 40 645 MB).
8. **Dedicated VRAM** — AdapterRAM on an iGPU is the shared aperture; recorded raw (2 147 479 552) with an explicit shared-memory note.
9. **fsutil cross-check** — `fsutil volume diskfree D:` → "Error 5: Access is denied". Used Win32_LogicalDisk + Get-PSDrive instead.
10. **Determinism re-run** — `node scripts/inventory.mjs --check …` cannot execute: node is absent. Determinism is by construction (fixed key order, single timestamp); re-run is mandatory once node lands (P001).
11. **VCS commit** — `git commit` impossible: git absent, installs forbidden. Message reserved: `chore(P000): host inventory and threat boundary ADR-000`.

## 5. Decisions made

- **D1 — Tiering is capability-based, fail-closed.** `gpu_tier` derives from vendor/generation + driver recency; any UNKNOWN GPU fails closed to C. Iris Xe + Sept-2026 driver → **A** (WebGPU acceleration assumed, GPGPU budgets not).
- **D2 — Boundary RAM rule is half-open; nominal 16 GB down-tiers.** Usable 15.69 GiB < 16 GiB cut with ~6 GiB free at idle → **small_7b**. A ~14B model would leave no headroom for OS + Electron + daemon.
- **D3 — Sandbox driver order: Job Objects → AppContainer/IL → LPAC**, then (opt-in, post-elevation) Hyper-V/WSL2/Sandbox. Container-based isolation is not a design dependency on this host.
- **D4 — Trust boundary fixed in ADR-000** (renderer untrusted; daemon trusted core; tools sandboxed; web content hostile) and binding on all later prompts.
- **D5 — No values guessed, ever.** Eleven UNKNOWNs recorded with failing commands rather than inferred (notably: no GPU model/VRAM invention, no compiler assumption from the VS remnant dir).

## 6. Deviations (from the letter of P000)

- **V1** — `wmic` unavailable; substituted `Get-CimInstance Win32_VideoController` (superset of the same data). No information lost.
- **V2** — Optional-feature states are UNKNOWN (elevation-gated) rather than present/absent. Sandbox order in ADR-000 is built only on no-elevation primitives to stay honest.
- **V3** — `scripts/inventory.mjs` could not be executed here (node absent); `artifacts/machine-profile.json` was produced via the documented Node-free fallback using the identical schema. `--check` re-run deferred to P001.
- **V4** — Strict "byte-identical except timestamp" cannot hold for live counters (`memory.free_bytes`, `disk.free_bytes`) under OS load; `--check` ignores only `generated_at` per the letter of the spec but *lists* differing keys so counter drift is distinguishable from real nondeterminism.
- **V5** — Commit deferred (git absent, installs forbidden). All deliverable files are written in place; commit message reserved.
- **V6** — `.gitignore` adds the minimal conventional set (editor droppings, logs, dist/) beyond the required OS-cruft/node_modules/target/.env* lines.

## 7. Gate self-scores

| Gate | Result |
|---|---|
| [E] `machine-profile.json` parses; every required key present; no nulls; tiers derived | **PASS** (validated with `python -c json.load`; tiers carry explicit rationales, UNKNOWNs are strings) |
| [E] Re-running `scripts/inventory.mjs` byte-identical except timestamp | **DEFERRED** — node absent so the script cannot run here; deterministic by construction; must re-run with `--check` in P001. Not claimed as passed. |
| [V] Visual verification | **N/A — deferred to P007.** No UI in this prompt; no pass claimed. |
| STOP condition (cannot determine OS or RAM) | **Not triggered** — both determined via CIM + cross-checks. No halt. |
| COMMIT `chore(P000): …` | **DEFERRED** — git absent; message reserved, files in place. |

## 8. Next steps

1. **P001 bootstrap:** install git + Node LTS (pinned, checksummed, workspace-local or per-user, no elevation assumption), then run `node scripts/inventory.mjs --check artifacts/machine-profile.json` and close V3/V5 with a real commit.
2. **P002 toolchain:** Rust (rustup pinned) + C++ build prerequisites for Electron/Rust; re-probe §3 rows 19/22 and update the profile.
3. **Sandbox spike:** prototype Job-Object + AppContainer confinement for tool processes; attempt one elevated session to resolve §4 items 2–4 and promote/demote drivers.
4. **P007 GPU probe:** replace the tier-A capability assumption with a real WebGPU feature/adapter probe + shared-memory bandwidth micro-benchmark.
5. **Model router:** encode the `small_7b` ceiling — local quantized-7B offline tier plus mandatory remote-inference path (ADR-000 consequence 1).

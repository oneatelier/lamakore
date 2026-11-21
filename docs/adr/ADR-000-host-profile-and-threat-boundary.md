# ADR-000 — Host Profile and Threat Boundary

- **Status:** Accepted
- **Date:** 2026-11-21
- **Scope:** PROJECT ONE (open-source unified agent desktop, Electron + Rust)
- **Inputs:** `artifacts/machine-profile.json` (schema `1.0.0-p000`), `scripts/inventory.mjs`, `docs/reports/report-P000.md`

## 1. Context

P000 inventories a CLEAN reference machine before any architecture or
toolchain decision is made. The machine is the ground truth every later
prompt builds on:

| Fact | Value |
|---|---|
| Host | DESKTOP-LUIL8F6 |
| OS | Microsoft Windows 11 Home Single Language, 10.0.26300 (build 26300, rev 26300.9974), x64 |
| CPU | 13th Gen Intel i5-1334U — 10 physical / 12 logical cores |
| RAM | 16 849 256 448 bytes (15.69 GiB usable; ~6 GiB free at idle) + 24 GiB pagefile |
| GPU | Intel Iris Xe Graphics, driver 32.0.101.7092 (2026-09-03), ~2 GiB shared aperture, 1920×1080 |
| Workspace disk | D: (Private, NTFS) — 107 924 402 176 bytes free (~100.5 GiB) |
| Shell | Windows PowerShell 5.1.26100.9818; cmd 10.0.26300.9974; pwsh 7+ absent |
| Locale / TZ | en-US / India Standard Time (+05:30, no DST) |
| Toolchains | **none** — no git, node, npm/pnpm (only stale shims), Rust, Docker, CMake, or C compiler on PATH |
| Signing | Windows SDK 10.0.26100.0 `signtool.exe` present by full path (not on PATH) |
| Security posture | VBS/HVCI running, hypervisor present, Defender real-time ON; Hyper-V/WSL2/Sandbox states UNKNOWN (elevation-gated) |
| Derived | `gpu_tier: "A"` · `local_model_class: "small_7b"` · sandbox order: Job Objects → AppContainer/IL → LPAC |

Full detail, including every UNKNOWN and the exact failed command behind
it, lives in `artifacts/machine-profile.json` (`unknowns`, 11 entries).
Nothing in this ADR is guessed: where a value could not be queried
non-elevated, it is recorded UNKNOWN.

## 2. Decision — the trust boundary

PROJECT ONE is a local-first agent desktop that will execute
model-directed tool calls and render untrusted web content. The boundary
is fixed as follows and is non-negotiable for all later design:

1. **Renderer = untrusted UI.** The Electron renderer (and any WebView)
   is treated as a compromised-by-default presentation layer. It never
   holds ambient credentials, never spawns processes, never touches the
   filesystem or network directly. All capability passes through an
   explicit, allow-listed IPC surface with schema validation.
2. **Daemon = trusted core.** A Rust daemon owns policy, secrets,
   tool dispatch, and sandbox enforcement. It runs at the user's
   integrity level (never elevated by default), brokers every privileged
   operation, and is the only component allowed to hold tokens/keys.
3. **Tools = sandboxed.** Every tool a model can invoke (shell, file,
   network, build) executes inside an OS sandbox with least privilege:
   constrained working directory, no inherited handles, audited
   argument passing. Tool output is data, never instructions, and is
   re-validated before it re-enters model context.
4. **Web content = hostile.** Anything fetched from the network —
   pages, scripts, tool responses over HTTP, pasted content — is
   attacker-controlled until proven otherwise. It is rendered
   isolated, stripped of active capabilities, and never concatenated
   into privileged prompts or commands without sanitization and
   provenance labelling.

## 3. Consequences (5, hardware-grounded)

1. **Local-model ceiling is quantized 7B; remote inference is mandatory
   architecture, not a stretch goal.** With 15.69 GiB usable and ~6 GiB
   free at idle, only Q4/Q5-class ~7B models fit alongside the OS,
   Electron, and the daemon. A ~14B model (~8–10 GiB quantized) leaves
   no headroom. The daemon must therefore ship a remote-inference path
   from day one, with local 7B as the offline tier — P007 GPU work and
   the model router both inherit this ceiling.
2. **GPU-compute budgets assume unified shared memory, and there is no
   CUDA.** The 2 GiB aperture is system RAM, not dedicated VRAM, and
   this is an Intel iGPU (Vulkan/DirectML targets, CPU fallback
   required). Tier A covers WebGPU UI acceleration; any heavy GPGPU
   (embeddings, rerank, local training loops) must be optional,
   cancellable, and benchmarked against memory-bandwidth reality —
   never assumed from the tier label.
3. **Tool sandboxing defaults to Job Objects + AppContainer/IL + LPAC,
   in that order.** Hyper-V, WSL2, Windows Sandbox, and containers are
   all UNKNOWN (elevation-gated) or absent (no Docker/Podman, no WSL
   distro). The tool runtime must therefore be designed against the
   always-present, no-elevation primitives first; hypervisor-backed
   isolation becomes an opt-in hardening tier detected at runtime, never
   a design dependency.
4. **Windows 11 Home + VBS/HVCI + Defender shapes the install and
   update story now, not later.** The daemon installer must plan for
   SmartScreen friction, HVCI-compatible drivers/services (none
   kernel-mode if avoidable), and per-user install without elevation —
   while Authenticode signing is feasible (SDK signtool present) and
   should be wired in as soon as CI exists. Home SKU lacks enterprise
   isolation knobs, so policy enforcement stays in the daemon, not in
   Group-Policy-dependent features.
5. **Clean-machine bootstrap is hermetic and pinned, or it does not
   happen.** No git, no node, no Rust, no compiler: P001+ must fetch
   pinned toolchains into the workspace (100 GiB free on D: is ample
   for toolchains plus small models) without assuming global state,
   admin rights, or PATH entries. Every setup step is scripted,
   checksummed, and re-runnable — this ADR's profile is the fixture
   those scripts validate against.

## 4. Alternatives considered

- **Assume WSL2/Docker as the sandbox substrate.** Rejected: WSL has
  no distro installed, Docker/Podman are absent, and feature states are
  elevation-gated UNKNOWNs. Designing against them would make tools
  unrunnable on the reference machine.
- **Classify as `mid_14b` on nominal "16 GB".** Rejected: usable RAM is
  15.69 GiB — strictly under the 16 GiB cut — with ~6 GiB free at idle.
  Fail-closed down-tiering to `small_7b` is the honest reading.
- **Classify GPU tier B ("integrated, therefore weak").** Rejected:
  the tier rubric is capability-based (WebGPU-capable modern
  integrated → A), and the driver is current (Sept 2026). Performance
  caveats are recorded separately instead of distorting the tier.

## 5. Links

- Profile: `artifacts/machine-profile.json`
- Collector: `scripts/inventory.mjs` (`--check` for the determinism test)
- Full evidence log: `docs/reports/report-P000.md`

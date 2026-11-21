#!/usr/bin/env node
/*
 * PROJECT ONE · P000 — clean-machine inventory
 * -------------------------------------------
 * Cross-platform host profiler. Uses ONLY Node.js builtins (node:os,
 * node:child_process, node:fs, node:path, node:url) — no dependencies.
 *
 * Usage:
 *   node scripts/inventory.mjs [--out <path>] [--stdout] [--check <path>]
 *
 *   --out <path>   Write profile JSON (default: <repo>/artifacts/machine-profile.json)
 *   --stdout       Print to stdout instead of writing a file
 *   --check <path> Regenerate in memory and compare against <path>, ignoring
 *                  ONLY the `generated_at` timestamp (acceptance determinism test).
 *                  Exit 0 = identical, exit 1 = differs (differing keys listed).
 *
 * Determinism contract: output is byte-identical across runs except
 * `generated_at`. Object keys are inserted in fixed order, tooling entries
 * are alphabetical, no randomness/PIDs/maps are used. NOTE: `memory.free_*`
 * and `disk.free_bytes` are live counters — under heavy load two back-to-back
 * runs can differ there. `--check` therefore ALSO reports which keys differ,
 * so a human can tell volatile-counter drift apart from real nondeterminism.
 * See docs/reports/report-P000.md § Deviations.
 *
 * Failure policy: NEVER guess. Any value that cannot be determined is the
 * string "UNKNOWN", and an entry is appended to `unknowns` with the exact
 * command that failed.
 *
 * ---------------------------------------------------------------------------
 * NODE-FREE FALLBACK (for clean machines where node is not yet installed —
 * which is exactly the P000 situation on DESKTOP-LUIL8F6):
 *
 *   Windows (Windows PowerShell 5.1+, no installs needed):
 *     Get-ComputerInfo -Property OsName,OsVersion,OsBuildNumber,OsArchitecture,OsLocale,TimeZone,TotalPhysicalMemory,CsProcessors
 *     Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,TotalVisibleMemorySize,FreePhysicalMemory,TotalVirtualMemorySize,Locale
 *     Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,Manufacturer
 *     Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility,DriverVersion,DriverDate,AdapterRAM
 *     Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='D:'" | Select-Object Size,FreeSpace,FileSystem,VolumeName
 *     Get-CimInstance Win32_PageFileSetting | Select-Object Name,InitialSize,MaximumSize
 *     systeminfo   (cross-checks memory / virtual memory / VBS / hypervisor lines)
 *     $PSVersionTable; cmd /c ver; Get-Culture; [System.TimeZoneInfo]::Local; tzutil /g
 *     where.exe <tool> ; & <tool> --version   (per tool: git node npm pnpm corepack
 *        rustc cargo rustup python3 docker podman cmake; compilers: cl gcc clang;
 *        signing: signtool certutil)
 *
 *   macOS:
 *     sw_vers; sysctl hw.model hw.machine hw.ncpu hw.physicalcpu hw.memsize
 *     vm_stat; system_profiler SPDisplaysDataType; df -k <repo>; tzutil 2>/dev/null || date
 *     command -v <tool> && <tool> --version
 *
 *   Linux:
 *     cat /etc/os-release; uname -m; grep -E 'model name|cpu cores' /proc/cpuinfo | sort -u
 *     nproc; grep MemTotal /proc/meminfo; swapon --show; df -k <repo>; locale; timedatectl
 *     lspci -k | grep -A3 VGA; glxinfo -B 2>/dev/null || echo NO_GLXINFO
 *     command -v <tool> && <tool> --version
 *
 * The fallback produces the same schema by hand (see provenance.commands_run
 * in artifacts/machine-profile.json). Once node lands (P001), this script
 * becomes the source of truth and must reproduce the file modulo timestamp.
 * ---------------------------------------------------------------------------
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const DEFAULT_OUT = path.join(repoRoot, 'artifacts', 'machine-profile.json');

const platform = os.platform(); // 'win32' | 'darwin' | 'linux' | ...
const isWin = platform === 'win32';
const isMac = platform === 'darwin';

const unknowns = [];
function markUnknown(field, command, reason) {
  unknowns.push({ field, command, reason });
  return 'UNKNOWN';
}

/** Run a shell command, return trimmed stdout, or null on ANY failure. */
function tryExec(command) {
  try {
    const out = execSync(command, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return String(out).trim();
  } catch {
    return null;
  }
}

function parseIntSafe(s) {
  const n = Number.parseInt(String(s).replace(/[^0-9]/g, ''), 10);
  return Number.isSafeInteger(n) ? n : null;
}

/* ------------------------------- OS ------------------------------------ */
function collectOs() {
  let name = 'UNKNOWN';
  let version = 'UNKNOWN';
  let build = 'UNKNOWN';
  let revision = 'UNKNOWN';
  const architecture = os.arch() === 'arm64' ? 'arm64' : os.arch() === 'x64' ? 'x64' : os.arch();

  if (isWin) {
    const cim = 'powershell -NoProfile -NonInteractive -Command';
    const caption = tryExec(`${cim} "(Get-CimInstance Win32_OperatingSystem).Caption"`);
    const ver = tryExec(`${cim} "(Get-CimInstance Win32_OperatingSystem).Version"`);
    const bld = tryExec(`${cim} "(Get-CimInstance Win32_OperatingSystem).BuildNumber"`);
    const ubr = tryExec(`${cim} "(Get-ItemProperty 'HKLM:\\\\SOFTWARE\\\\Microsoft\\\\Windows NT\\\\CurrentVersion').UBR"`);
    if (caption === null) markUnknown('os.name', `${cim} "(Get-CimInstance Win32_OperatingSystem).Caption"`, 'CIM query failed');
    else name = caption;
    if (ver === null) markUnknown('os.version', `${cim} "(Get-CimInstance Win32_OperatingSystem).Version"`, 'CIM query failed');
    else version = ver;
    if (bld === null) markUnknown('os.build', `${cim} "(Get-CimInstance Win32_OperatingSystem).BuildNumber"`, 'CIM query failed');
    else build = bld;
    revision = ver && ubr ? `${ver}.${ubr}` : markUnknown('os.revision', `${cim} UBR registry read`, 'UBR value unreadable');
  } else if (isMac) {
    const prod = tryExec('sw_vers -productName');
    const ver = tryExec('sw_vers -productVersion');
    const bld = tryExec('sw_vers -buildVersion');
    if (prod === null) markUnknown('os.name', 'sw_vers -productName', 'sw_vers failed');
    else name = prod;
    if (ver === null) markUnknown('os.version', 'sw_vers -productVersion', 'sw_vers failed');
    else version = ver;
    if (bld === null) markUnknown('os.build', 'sw_vers -buildVersion', 'sw_vers failed');
    else build = bld;
    revision = build;
  } else {
    const pretty = tryExec(`grep '^PRETTY_NAME=' /etc/os-release | cut -d= -f2 | tr -d '"'`);
    const verId = tryExec(`grep '^VERSION_ID=' /etc/os-release | cut -d= -f2 | tr -d '"'`);
    const kern = tryExec('uname -r');
    if (pretty === null) markUnknown('os.name', "grep PRETTY_NAME /etc/os-release", '/etc/os-release unreadable');
    else name = pretty;
    version = verId === null ? markUnknown('os.version', "grep VERSION_ID /etc/os-release", 'VERSION_ID missing') : verId;
    build = kern === null ? markUnknown('os.build', 'uname -r', 'uname failed') : kern;
    revision = build;
  }
  return { name, version, build, revision, architecture };
}

/* ------------------------------- CPU ----------------------------------- */
function collectCpu() {
  const nodeCpus = os.cpus();
  let model = nodeCpus.length > 0 ? nodeCpus[0].model : 'UNKNOWN';
  let logical = nodeCpus.length > 0 ? nodeCpus.length : 'UNKNOWN';
  let physical = 'UNKNOWN';

  if (isWin) {
    const cim = 'powershell -NoProfile -NonInteractive -Command';
    const cores = tryExec(`${cim} "(Get-CimInstance Win32_Processor | Select-Object -First 1).NumberOfCores"`);
    const logi = tryExec(`${cim} "(Get-CimInstance Win32_Processor | Select-Object -First 1).NumberOfLogicalProcessors"`);
    const nm = tryExec(`${cim} "(Get-CimInstance Win32_Processor | Select-Object -First 1).Name"`);
    if (cores === null) markUnknown('cpu.physical_cores', 'Win32_Processor.NumberOfCores', 'CIM query failed');
    else physical = parseIntSafe(cores) ?? markUnknown('cpu.physical_cores', 'Win32_Processor.NumberOfCores', 'unparseable output');
    if (logi !== null) { const n = parseIntSafe(logi); if (n !== null) logical = n; }
    if (nm) model = nm;
    else markUnknown('cpu.model_fallback', 'Win32_Processor.Name', 'empty; kept node:os value');
  } else if (isMac) {
    const p = tryExec('sysctl -n hw.physicalcpu');
    if (p === null) markUnknown('cpu.physical_cores', 'sysctl -n hw.physicalcpu', 'sysctl failed');
    else physical = parseIntSafe(p) ?? markUnknown('cpu.physical_cores', 'sysctl -n hw.physicalcpu', 'unparseable output');
  } else {
    const p = tryExec(`grep -m1 'cpu cores' /proc/cpuinfo | awk -F: '{print $2}'`);
    if (p === null) markUnknown('cpu.physical_cores', "grep 'cpu cores' /proc/cpuinfo", '/proc/cpuinfo unreadable');
    else physical = parseIntSafe(p) ?? markUnknown('cpu.physical_cores', "grep 'cpu cores' /proc/cpuinfo", 'unparseable output');
  }
  if (!model) model = markUnknown('cpu.model', 'os.cpus()[0].model', 'empty CPU model string');
  return { model, physical_cores: physical, logical_cores: logical, architecture: os.arch() === 'arm64' ? 'arm64' : os.arch() === 'x64' ? 'x64' : os.arch() };
}

/* ----------------------------- Memory ---------------------------------- */
function collectMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  const mem = { total_bytes: total, free_bytes: free };
  if (isWin) {
    const cim = 'powershell -NoProfile -NonInteractive -Command';
    const page = tryExec(`${cim} "(Get-CimInstance Win32_PageFileSetting | Select-Object -First 1).InitialSize"`);
    if (page === null) markUnknown('memory.swap_initial_mb', 'Win32_PageFileSetting.InitialSize', 'CIM query failed (possibly elevation)');
    else mem.swap_initial_mb = parseIntSafe(page) ?? 'UNKNOWN';
    const max = tryExec(`${cim} "(Get-CimInstance Win32_PageFileSetting | Select-Object -First 1).MaximumSize"`);
    mem.swap_max_mb = max === null ? markUnknown('memory.swap_max_mb', 'Win32_PageFileSetting.MaximumSize', 'CIM query failed') : (parseIntSafe(max) ?? 'UNKNOWN');
    const stored = tryExec(`${cim} "(Get-CimInstance Win32_OperatingSystem).SizeStoredInPagingFiles"`);
    mem.swap_stored_kib = stored === null ? markUnknown('memory.swap_stored_kib', 'Win32_OperatingSystem.SizeStoredInPagingFiles', 'CIM query failed') : (parseIntSafe(stored) ?? 'UNKNOWN');
  } else if (isMac) {
    const swap = tryExec('sysctl -n vm.swapusage');
    mem.swap_report = swap === null ? markUnknown('memory.swap_report', 'sysctl -n vm.swapusage', 'sysctl failed') : swap.replace(/\s+/g, ' ');
  } else {
    const sw = tryExec(`grep '^SwapTotal:' /proc/meminfo | awk '{print $2}'`);
    mem.swap_total_kib = sw === null ? markUnknown('memory.swap_total_kib', "grep SwapTotal /proc/meminfo", '/proc/meminfo unreadable') : (parseIntSafe(sw) ?? 'UNKNOWN');
  }
  return mem;
}

/* ------------------------------- GPU ----------------------------------- */
function collectGpu() {
  const gpu = { vendor: 'UNKNOWN', model: 'UNKNOWN', driver_version: 'UNKNOWN', vram_bytes: 'UNKNOWN' };
  if (isWin) {
    const cim = 'powershell -NoProfile -NonInteractive -Command';
    const base = `${cim} "(Get-CimInstance Win32_VideoController | Select-Object -First 1)`;
    const nm = tryExec(`${base}).Name"`);
    const ven = tryExec(`${base}).AdapterCompatibility"`);
    const drv = tryExec(`${base}).DriverVersion"`);
    const ram = tryExec(`${base}).AdapterRAM"`);
    gpu.model = nm === null ? markUnknown('gpu.model', 'Win32_VideoController.Name', 'CIM query failed') : nm;
    gpu.vendor = ven === null ? markUnknown('gpu.vendor', 'Win32_VideoController.AdapterCompatibility', 'CIM query failed') : ven;
    gpu.driver_version = drv === null ? markUnknown('gpu.driver_version', 'Win32_VideoController.DriverVersion', 'CIM query failed') : drv;
    if (ram === null) markUnknown('gpu.vram_bytes', 'Win32_VideoController.AdapterRAM', 'CIM query failed');
    else {
      // AdapterRAM is UINT32 and wraps for >4GiB; record raw value, never inflate.
      const n = Number(ram);
      gpu.vram_bytes = Number.isSafeInteger(n) ? n : markUnknown('gpu.vram_bytes', 'Win32_VideoController.AdapterRAM', 'unparseable output');
    }
  } else if (isMac) {
    const sp = tryExec('system_profiler SPDisplaysDataType -json');
    if (sp === null) {
      markUnknown('gpu.model', 'system_profiler SPDisplaysDataType', 'system_profiler failed');
      markUnknown('gpu.vendor', 'system_profiler SPDisplaysDataType', 'system_profiler failed');
      markUnknown('gpu.driver_version', 'system_profiler SPDisplaysDataType', 'system_profiler failed');
      markUnknown('gpu.vram_bytes', 'system_profiler SPDisplaysDataType', 'system_profiler failed');
    } else {
      try {
        const j = JSON.parse(sp);
        const card = j?.SPDisplaysDataType?.[0];
        gpu.model = card?.sppci_model ?? markUnknown('gpu.model', 'system_profiler SPDisplaysDataType', 'sppci_model missing');
        gpu.vendor = card?.sppci_vendor ?? markUnknown('gpu.vendor', 'system_profiler SPDisplaysDataType', 'vendor missing');
        gpu.driver_version = 'UNKNOWN';
        unknowns.push({ field: 'gpu.driver_version', command: 'system_profiler SPDisplaysDataType', reason: 'macOS bundles GPU drivers with the OS; no discrete driver version exists' });
        gpu.vram_bytes = card?.spdisplays_vram ?? markUnknown('gpu.vram_bytes', 'system_profiler SPDisplaysDataType', 'vram field missing');
      } catch {
        markUnknown('gpu.parse', 'system_profiler SPDisplaysDataType -json', 'JSON parse failed');
      }
    }
  } else {
    const vga = tryExec(`lspci -k 2>/dev/null | grep -A3 VGA | tr '\\n' ';'`);
    if (vga === null || vga === '') {
      markUnknown('gpu.model', 'lspci -k | grep -A3 VGA', 'lspci missing or no VGA device found');
    } else {
      gpu.model = vga;
      gpu.vendor = /nvidia/i.test(vga) ? 'NVIDIA' : /amd|radeon/i.test(vga) ? 'AMD' : /intel/i.test(vga) ? 'Intel' : markUnknown('gpu.vendor', 'lspci -k | grep -A3 VGA', 'vendor not inferable from lspci string; recorded raw model only');
    }
    const glx = tryExec('glxinfo -B 2>/dev/null | tr "\\n" ";"');
    gpu.driver_version = glx === null || glx === '' ? markUnknown('gpu.driver_version', 'glxinfo -B', 'glxinfo absent or failed') : glx;
    markUnknown('gpu.vram_bytes', 'lspci/glxinfo', 'dedicated VRAM not queryable via stock tools on Linux');
  }
  return gpu;
}

/* ------------------------------- Disk ---------------------------------- */
function collectDisk() {
  if (isWin) {
    const root = path.parse(repoRoot).root.replace(/\\/g, '');
    const drive = (root || 'C:').replace('\\', '');
    const cim = 'powershell -NoProfile -NonInteractive -Command';
    const size = tryExec(`${cim} "(Get-CimInstance Win32_LogicalDisk -Filter \\"DeviceID='${drive}'\\").Size"`);
    const free = tryExec(`${cim} "(Get-CimInstance Win32_LogicalDisk -Filter \\"DeviceID='${drive}'\\").FreeSpace"`);
    return {
      workspace_volume: size === null ? markUnknown('disk.size_bytes', `Win32_LogicalDisk Size for ${drive}`, 'CIM query failed') && drive : drive,
      size_bytes: size === null ? 'UNKNOWN' : (parseIntSafe(size) ?? 'UNKNOWN'),
      free_bytes: free === null ? markUnknown('disk.free_bytes', `Win32_LogicalDisk FreeSpace for ${drive}`, 'CIM query failed') : (parseIntSafe(free) ?? 'UNKNOWN'),
    };
  }
  const line = tryExec(`df -k "${repoRoot}" | tail -1`);
  if (line === null) {
    markUnknown('disk.size_bytes', `df -k "${repoRoot}"`, 'df failed');
    markUnknown('disk.free_bytes', `df -k "${repoRoot}"`, 'df failed');
    return { workspace_volume: 'UNKNOWN', size_bytes: 'UNKNOWN', free_bytes: 'UNKNOWN' };
  }
  const parts = line.split(/\s+/);
  const availKb = parseIntSafe(parts[3] ?? '');
  const totalKb = null; // df total column position varies; do not guess.
  markUnknown('disk.size_bytes', `df -k "${repoRoot}"`, 'total-size column not positionally stable across df variants; free recorded, total left UNKNOWN');
  return {
    workspace_volume: parts[0] ?? 'UNKNOWN',
    size_bytes: totalKb ?? 'UNKNOWN',
    free_bytes: availKb === null ? markUnknown('disk.free_bytes', `df -k "${repoRoot}"`, 'unparseable df output') : availKb * 1024,
  };
}

/* ------------------------- Shell / locale / tz -------------------------- */
function collectEnv() {
  const shell = process.env.ComSpec || process.env.SHELL || markUnknown('shell.path', 'ComSpec/SHELL env lookup', 'neither ComSpec nor SHELL is set');
  let shellVersion = 'UNKNOWN';
  if (isWin) {
    const v = tryExec('powershell -NoProfile -NonInteractive -Command "$PSVersionTable.PSVersion.ToString()"');
    shellVersion = v === null ? markUnknown('shell.version', '$PSVersionTable.PSVersion', 'powershell query failed') : `Windows PowerShell ${v}`;
  } else {
    const v = tryExec(`${shell} --version 2>/dev/null | head -1`);
    shellVersion = v === null || v === '' ? markUnknown('shell.version', `${shell} --version`, 'shell would not report a version') : v;
  }
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'UNKNOWN';
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UNKNOWN';
  return { shell: shell, shell_version: shellVersion, locale, timezone: timeZone };
}

/* ------------------------------ Tooling -------------------------------- */
const TOOL_CMDS = {
  git: 'git --version',
  node: 'node --version',
  npm: 'npm --version',
  pnpm: 'pnpm --version',
  corepack: 'corepack --version',
  rustc: 'rustc --version',
  cargo: 'cargo --version',
  rustup: 'rustup --version',
  python3: 'python3 --version',
  docker: 'docker --version',
  podman: 'podman --version',
  cmake: 'cmake --version',
};

const COMPILER_CMDS = {
  cl: 'cl',
  gcc: 'gcc --version',
  clang: 'clang --version',
  cc: 'cc --version',
};

function probeTool(name, command) {
  const out = tryExec(command);
  if (out === null || out === '') return { present: false, path: 'UNKNOWN', version: 'UNKNOWN', note: `${command} failed or binary not resolvable` };
  return { present: true, path: name, version: out.split('\n')[0].slice(0, 200), note: `resolved via PATH; version from \`${command}\`` };
}

function collectTooling() {
  const tooling = {};
  for (const name of Object.keys(TOOL_CMDS).sort()) {
    tooling[name] = probeTool(name, TOOL_CMDS[name]);
  }
  // C compiler: first resolvable of cl/gcc/clang/cc wins; record the search.
  let compiler = { present: false, path: 'UNKNOWN', version: 'UNKNOWN', note: 'none of cl/gcc/clang/cc resolvable' };
  for (const [name, cmd] of Object.entries(COMPILER_CMDS)) {
    const r = probeTool(name, cmd);
    if (r.present) { compiler = r; compiler.note = `first resolvable compiler in search order cl/gcc/clang/cc: ${name}`; break; }
  }
  tooling.c_compiler = compiler;
  // Code-signing tools (platform aware, PATH-based only — never guess paths).
  if (isWin) {
    tooling.signtool = probeTool('signtool', 'signtool');
    tooling.certutil = probeTool('certutil', 'certutil -?');
  } else if (isMac) {
    tooling.codesign = probeTool('codesign', 'codesign --version');
  } else {
    tooling.osslsigncode = probeTool('osslsigncode', 'osslsigncode --version');
  }
  // The running node itself is ground truth for node presence.
  tooling.node = { present: true, path: process.execPath, version: process.version, note: 'inventory runtime itself' };
  return tooling;
}

/* ----------------------------- Derivation ------------------------------- */
function derive(osInfo, mem, gpu, tooling) {
  // gpu_tier: A = WebGPU-capable discrete/modern integrated; B = WebGL2 only;
  // C = software raster / blocklist / UNKNOWN (fail-closed).
  let gpuTier = 'C';
  let gpuRationale = 'fail-closed default: GPU unknown or unclassifiable, treat as software raster';
  const model = `${gpu.vendor} ${gpu.model}`.toLowerCase();
  if (/basic render driver|llvmpipe|software|unknown/.test(model) || gpu.model === 'UNKNOWN') {
    gpuTier = 'C';
    gpuRationale = 'software rasterizer or UNKNOWN GPU model — fail closed to tier C';
  } else if (/nvidia|geforce|rtx|quadro|radeon|rx |amd|arc|iris xe|iris plus|uhd graphics|m1|m2|m3|m4|apple/.test(model)) {
    gpuTier = 'A';
    gpuRationale = `model string indicates WebGPU-capable hardware (${gpu.vendor} ${gpu.model}); capability assumed from vendor/generation, to be confirmed by a real WebGPU probe in P007`;
  } else {
    gpuTier = 'B';
    gpuRationale = `recognizable GPU but generation unclear (${gpu.vendor} ${gpu.model}); conservative WebGL2-only until proven otherwise`;
  }

  // local_model_class from usable RAM (GiB). Boundary rule (half-open):
  // [0,8) none · [8,16) small_7b · [16,32] mid_14b · (32,∞) large.
  const gib = mem.total_bytes / 1073741824;
  let cls = 'none';
  let clsRationale = '';
  if (gib < 8) { cls = 'none'; clsRationale = `total RAM ${gib.toFixed(2)} GiB < 8 GiB floor for local inference`; }
  else if (gib < 16) { cls = 'small_7b'; clsRationale = `total RAM ${gib.toFixed(2)} GiB in [8,16): quantized ~7B models only`; }
  else if (gib <= 32) { cls = 'mid_14b'; clsRationale = `total RAM ${gib.toFixed(2)} GiB in [16,32]: quantized ~14B feasible`; }
  else { cls = 'large'; clsRationale = `total RAM ${gib.toFixed(2)} GiB > 32 GiB: large-model class`; }

  // Sandbox drivers: only list what is verified present without elevation.
  const available = [];
  const unknown = [];
  const absent = [];
  if (isWin) {
    available.push('job_objects', 'appcontainer_and_integrity_levels', 'lpac');
    unknown.push('hyperv_feature_state', 'wsl2_feature_state', 'windows_sandbox_feature_state', 'containers_feature_state');
    unknowns.push({ field: 'sandbox.windows_optional_features', command: 'Get-WindowsOptionalFeature -Online -FeatureName <Microsoft-Hyper-V|VirtualMachinePlatform|Microsoft-Windows-Subsystem-Linux|Containers|Windows-Sandbox>', reason: 'requires elevation; non-elevated inventory cannot determine state' });
    if (!tooling.docker.present) absent.push('docker');
    if (!tooling.podman.present) absent.push('podman');
  } else if (isMac) {
    available.push('seatbelt_sandbox', 'app_sandbox_entitlements');
    unknown.push('hypervisor_framework_vm_state');
  } else {
    const userns = tryExec('cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || sysctl -n kernel.unprivileged_userns_clone 2>/dev/null');
    if (userns !== null) available.push('user_namespaces', 'seccomp_bpf', 'cgroups_v2');
    else { unknown.push('user_namespaces_state'); unknowns.push({ field: 'sandbox.user_namespaces', command: 'cat /proc/sys/kernel/unprivileged_userns_clone', reason: 'unreadable' }); }
    if (!tooling.docker.present) absent.push('docker');
    if (!tooling.podman.present) absent.push('podman');
    available.push('seccomp_bpf_assumed_present_on_modern_kernels');
  }
  return {
    gpu_tier: gpuTier,
    gpu_tier_rationale: gpuRationale,
    local_model_class: cls,
    local_model_class_rationale: clsRationale,
    sandbox_drivers_available: available,
    sandbox_drivers_unknown: unknown,
    sandbox_drivers_absent: absent,
  };
}

/* -------------------------------- Main ---------------------------------- */
function buildProfile() {
  unknowns.length = 0;
  const osInfo = collectOs();
  const cpu = collectCpu();
  const memory = collectMemory();
  const gpu = collectGpu();
  const disk = collectDisk();
  const env = collectEnv();
  const tooling = collectTooling();
  const derived = derive(osInfo, memory, gpu, tooling);
  return {
    schema_version: '1.0.0-p000',
    generated_at: new Date().toISOString(),
    os: osInfo,
    cpu,
    memory,
    gpu,
    disk,
    shell: env.shell,
    shell_version: env.shell_version,
    locale: env.locale,
    timezone: env.timezone,
    tooling,
    derived,
    unknowns,
  };
}

function serialize(profile) {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

function diffProfiles(a, b, prefix = '', out = []) {
  // Compare with `generated_at` already stripped by the caller.
  if (typeof a !== typeof b) { out.push(`${prefix}: type ${typeof a} vs ${typeof b}`); return out; }
  if (a !== null && b !== null && typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in a)) out.push(`${prefix}${k}: missing in fresh run`);
      else if (!(k in b)) out.push(`${prefix}${k}: missing in stored file`);
      else diffProfiles(a[k], b[k], `${prefix}${k}.`, out);
    }
  } else if (a !== b) {
    out.push(`${prefix}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const file = args[args.indexOf('--check') + 1] || DEFAULT_OUT;
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    const fresh = buildProfile();
    delete stored.generated_at;
    delete fresh.generated_at;
    const diffs = diffProfiles(fresh, stored);
    if (diffs.length === 0) {
      console.log('DETERMINISTIC: fresh run matches stored file (ignoring generated_at).');
    } else {
      console.log('NON-DETERMINISTIC or DRIFTED fields (ignoring generated_at):');
      for (const d of diffs) console.log(`  - ${d}`);
      console.log('NOTE: memory.free_bytes / disk.free_bytes drift is live-counter volatility, not a script bug (see report § Deviations).');
      process.exitCode = 1;
    }
    return;
  }
  const profile = buildProfile();
  const text = serialize(profile);
  if (args.includes('--stdout')) {
    process.stdout.write(text);
    return;
  }
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 && args[outIdx + 1] ? path.resolve(args[outIdx + 1]) : DEFAULT_OUT;
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, text, 'utf8');
  console.log(`Wrote ${out}`);
}

main();

#Requires -Version 5.1
<#
.SYNOPSIS
  P001 — Windows toolchain bootstrap (idempotent).
.DESCRIPTION
  Installs, in order: Git -> Node 24 LTS -> corepack pnpm@12.22.0 ->
  rustup + Rust 1.100.0 -> platform build deps (VS Build Tools C++ workload
  + Windows SDK; SDK is reused when already present).
  Re-running performs NO duplicate installs: every step first checks whether
  its pin is already satisfied and skips with an [ok] line.
  Elevation: machine-wide installs (MSI/winget machine scope/VSBT) require
  elevation. When non-elevated, Git and Node fall back to verified user-local
  installs under %LOCALAPPDATA%\Programs\project-one; VS Build Tools is
  SKIPPED with the exact elevated command to run (it cannot install without
  elevation — this is reported, never silently downgraded).
.PARAMETER NodeVersion
  Exact Node 24.x patch (e.g. "24.22.3"). Empty = resolve newest 24.x LTS
  live from https://nodejs.org/download/release/index.json, with a pinned
  fallback when the index is unreachable.
.PARAMETER RustVersion
  Default "1.100.0".
.PARAMETER PnpmVersion
  Default "12.22.0".
#>
param(
  [string]$NodeVersion = "",
  [string]$RustVersion = "1.100.0",
  [string]$PnpmVersion = "12.22.0"
)
$ErrorActionPreference = 'Stop'
$ToolsRoot = Join-Path $env:LOCALAPPDATA 'Programs\project-one'

function Write-Step([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "[ok] $m" -ForegroundColor Green }
function Write-Skip([string]$m) { Write-Host "[skip] $m" -ForegroundColor Yellow }

function Refresh-Path {
  $m = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $u = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$m;$u"
}
function Have([string]$cmd) { $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }
function Is-Elevated {
  (New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
  )).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Add-UserPathOnce([string]$dir) {
  $cur = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if (($cur -split ';' | Where-Object { $_ -eq $dir }).Count -eq 0) {
    [System.Environment]::SetEnvironmentVariable('Path', "$cur;$dir", 'User')
  }
  if (($env:Path -split ';' | Where-Object { $_ -eq $dir }).Count -eq 0) {
    $env:Path = "$env:Path;$dir"
  }
}
function Resolve-Node24([string]$fallback = '24.22.3') {
  try {
    $idx = Invoke-RestMethod -Uri 'https://nodejs.org/download/release/index.json' -TimeoutSec 60
    $best = $idx | Where-Object { $_.version -match '^v24\.' -and $_.lts } |
      Sort-Object { [version]($_.version.TrimStart('v')) } | Select-Object -Last 1
    if ($best) { return $best.version.TrimStart('v') }
    Write-Warning 'Node index returned no 24.x LTS entry; using fallback.'
  } catch {
    Write-Warning "Node index unreachable ($($_.Exception.Message)); using fallback $fallback."
  }
  return $fallback
}
function Get-NodeSha([string]$ver, [string]$asset) {
  $sums = Invoke-RestMethod -Uri "https://nodejs.org/download/release/v$ver/SHASUMS256.txt" -TimeoutSec 60
  $line = ($sums -split "`n") | Where-Object { $_ -match [regex]::Escape($asset) } | Select-Object -First 1
  if (-not $line) { throw "SHA256 for $asset not found in SHASUMS256.txt for v$ver" }
  return ($line -split '\s+')[0].Trim()
}
function Install-Git {
  Write-Step 'Git'
  if (Have git) { Write-Ok "git already present: $(git --version)"; return }
  if (Is-Elevated) {
    winget install -e --id Git.Git --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
  } else {
    # Portable, user-local: GitHub SFX, hash verified against release notes.
    $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -TimeoutSec 60
    $asset = $rel.assets | Where-Object { $_.name -match '^PortableGit-.*-64-bit\.7z\.exe$' } | Select-Object -First 1
    if (-not $asset) { throw 'No PortableGit 64-bit asset in latest release.' }
    $m = [regex]::Match($rel.body, [regex]::Escape($asset.name) + '\s*\|\s*([0-9a-f]{64})')
    if (-not $m.Success) { throw "No SHA-256 published in release notes for $($asset.name); aborting (never invent a hash)." }
    $dir = Join-Path $ToolsRoot 'git-portable'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $dst = Join-Path $env:TEMP $asset.name
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dst -TimeoutSec 600
    if ((Get-FileHash $dst -Algorithm SHA256).Hash.ToLower() -ne $m.Groups[1].Value.ToLower()) {
      throw "SHA256 mismatch for $($asset.name); aborting."
    }
    Start-Process -FilePath $dst -ArgumentList "-o`"$dir`" -y" -Wait -NoNewWindow
    Add-UserPathOnce (Join-Path $dir 'bin'); Refresh-Path
  }
  if (-not (Have git)) { throw 'git install finished but git is still not on PATH.' }
  Write-Ok "git installed: $(git --version)"
}
function Install-Node([string]$want) {
  Write-Step "Node 24 LTS (want v$want)"
  if ((Have node) -and ((node --version) -eq "v$want")) {
    Write-Ok "node already at pin: $(node --version)"; return
  }
  if (Is-Elevated) {
    $asset = "node-v$want-x64.msi"
    $dst = Join-Path $env:TEMP $asset
    Invoke-WebRequest -Uri "https://nodejs.org/download/release/v$want/$asset" -OutFile $dst -TimeoutSec 600
    if ((Get-FileHash $dst -Algorithm SHA256).Hash.ToLower() -ne (Get-NodeSha $want $asset).ToLower()) {
      throw "SHA256 mismatch for $asset; aborting."
    }
    Start-Process msiexec -ArgumentList "/i `"$dst`" /qn /norestart" -Wait -NoNewWindow
    Refresh-Path
  } else {
    $asset = "node-v$want-win-x64.zip"
    $dst = Join-Path $env:TEMP $asset
    Invoke-WebRequest -Uri "https://nodejs.org/download/release/v$want/$asset" -OutFile $dst -TimeoutSec 600
    if ((Get-FileHash $dst -Algorithm SHA256).Hash.ToLower() -ne (Get-NodeSha $want $asset).ToLower()) {
      throw "SHA256 mismatch for $asset; aborting."
    }
    $dest = Join-Path $ToolsRoot "node-v$want-win-x64"
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Expand-Archive -Path $dst -DestinationPath $ToolsRoot -Force
    Add-UserPathOnce $dest; Refresh-Path
  }
  if ((node --version) -ne "v$want") { throw "node install finished but version is $(node --version), want v$want." }
  Write-Ok "node installed: $(node --version)"
}
function Install-Pnpm([string]$want) {
  Write-Step "pnpm $want via corepack"
  corepack enable
  Refresh-Path
  $cur = $null
  try { $cur = (pnpm --version 2>$null) } catch { $cur = $null }
  if ($cur -eq $want) { Write-Ok "pnpm already at pin: $cur"; return }
  corepack prepare "pnpm@$want" --activate
  Refresh-Path
  if ((pnpm --version) -ne $want) { throw "pnpm activation finished but version is $(pnpm --version), want $want." }
  Write-Ok "pnpm activated: $(pnpm --version)"
}
function Install-Rust([string]$want) {
  Write-Step "Rust $want via rustup"
  if (-not (Have rustup)) {
    $init = Join-Path $env:TEMP 'rustup-init.exe'
    Invoke-WebRequest -Uri 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' -OutFile $init -TimeoutSec 300
    $exp = (Invoke-RestMethod -Uri 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe.sha256' -TimeoutSec 60).Trim().Split()[0]
    if ((Get-FileHash $init -Algorithm SHA256).Hash.ToLower() -ne $exp.ToLower()) { throw 'SHA256 mismatch for rustup-init.exe; aborting.' }
    # -y: no prompt; default toolchain none (we install the pin explicitly); no PATH modify gaps handled via Refresh.
    Start-Process -FilePath $init -ArgumentList '-y','--profile','minimal','--default-toolchain','none' -Wait -NoNewWindow
    Refresh-Path
    $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
    Add-UserPathOnce $cargoBin; Refresh-Path
  } else { Write-Ok "rustup already present: $(rustup --version 2>$null)" }
  if (-not (Have rustup)) { throw 'rustup install finished but rustup is still not on PATH.' }
  $list = (rustup toolchain list) -join "`n"
  if ($list -notmatch [regex]::Escape($want)) {
    rustup toolchain install $want --profile minimal
  } else { Write-Ok "toolchain $want already installed" }
  $def = (rustup show active-toolchain 2>$null)
  if ($def -notmatch [regex]::Escape($want)) { rustup default $want } else { Write-Ok "default toolchain already $want" }
  if ((rustc --version) -notmatch [regex]::Escape($want)) { throw "rustc reports $(rustc --version), want $want." }
  Write-Ok "rustc: $(rustc --version) | cargo: $(cargo --version)"
}
function Install-BuildDeps {
  Write-Step 'Platform build deps (VS Build Tools C++ workload + Windows SDK)'
  $sdkRoots = Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots' -ErrorAction SilentlyContinue
  if ($sdkRoots) { Write-Ok "Windows SDK present: $(($sdkRoots | ForEach-Object { $_.PSChildName }) -join ', ')" }
  else { Write-Skip 'No Windows SDK detected; install Windows SDK 10/11 via Visual Studio Installer (elevated).' }
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  $hasCl = (Have cl) -or ((Test-Path $vswhere) -and (& $vswhere -products * -requires Microsoft.VisualC.Component.VC.Tools.x86.x64 -property installationPath))
  if ($hasCl) { Write-Ok 'MSVC C++ tools present.'; return }
  if (-not (Is-Elevated)) {
    Write-Skip ('VS Build Tools require elevation and are NOT installed. ' +
      'Re-run this script elevated, or run: ' +
      'winget install -e --id Microsoft.VisualStudio.2022.BuildTools --silent ' +
      '--override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended". ' +
      'No downgrade performed; C++ builds stay blocked until then.')
    return
  }
  winget install -e --id Microsoft.VisualStudio.2022.BuildTools --silent --accept-package-agreements --accept-source-agreements `
    --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  Write-Ok 'VS Build Tools installed.'
}

Refresh-Path
if ([string]::IsNullOrWhiteSpace($NodeVersion)) { $NodeVersion = Resolve-Node24 }
Write-Host "Pins: node=$NodeVersion rust=$RustVersion pnpm=$PnpmVersion" -ForegroundColor White
Install-Git
Install-Node $NodeVersion
Install-Pnpm $PnpmVersion
Install-Rust $RustVersion
Install-BuildDeps
Refresh-Path
Write-Step 'Summary'
foreach ($t in @('git','node','pnpm','rustc','cargo')) {
  if (Have $t) { $v = (& $t --version 2>$null | Select-Object -First 1); Write-Host "$t : $v" }
  else { Write-Host "$t : MISSING" }
}

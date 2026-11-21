#!/usr/bin/env bash
# P001 — Linux toolchain bootstrap (idempotent, Debian/Ubuntu-first).
# Installs: git -> Node 24 LTS (tarball, SHA-verified) -> corepack pnpm@12.22.0
# -> rustup + Rust 1.100.0 -> build deps (build-essential, pkg-config,
# libssl-dev, libsqlite3-dev, libayatana-appindicator3-dev, librsvg2-dev,
# libsecret-1-dev). No webkit2gtk — this is an Electron app, not Tauri.
# Re-running skips every satisfied pin (apt-get install -y is idempotent).
set -euo pipefail

RUST_VERSION="${RUST_VERSION:-1.100.0}"
PNPM_VERSION="${PNPM_VERSION:-12.22.0}"
NODE_FALLBACK="24.22.3"
NODE_PREFIX="${NODE_PREFIX:-$HOME/.local/node-vXXX}"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

resolve_node24() {
  if [ -n "${NODE_VERSION:-}" ]; then echo "$NODE_VERSION"; return; fi
  local best=""
  best="$(curl -fsSL --max-time 60 https://nodejs.org/download/release/index.json \
    | python3 -c 'import json,sys
idx=json.load(sys.stdin)
c=[e["version"].lstrip("v") for e in idx if e["version"].startswith("v24.") and e["lts"]]
def k(v): return tuple(int(x) for x in v.split("."))
print(max(c,key=k) if c else "")')" || true
  if [ -z "$best" ]; then echo "WARN: Node index unreachable; fallback $NODE_FALLBACK" >&2; best="$NODE_FALLBACK"; fi
  echo "$best"
}

have() { command -v "$1" >/dev/null 2>&1; }

echo "==> Build deps (apt)"
$SUDO apt-get update
$SUDO apt-get install -y git curl ca-certificates build-essential pkg-config \
  libssl-dev libsqlite3-dev libayatana-appindicator3-dev librsvg2-dev libsecret-1-dev
echo "[ok] $(git --version)"

NODE_WANT="$(resolve_node24)"
echo "==> Node 24 LTS (want v$NODE_WANT)"
DEST="${NODE_PREFIX//XXX/$NODE_WANT}"
if have node && [ "$(node --version)" = "v$NODE_WANT" ]; then
  echo "[ok] node already at pin: $(node --version)"
else
  ASSET="node-v$NODE_WANT-linux-x64.tar.xz"
  cd /tmp
  curl -fsSLO --max-time 600 "https://nodejs.org/download/release/v$NODE_WANT/$ASSET"
  SHA="$(curl -fsSL --max-time 60 "https://nodejs.org/download/release/v$NODE_WANT/SHASUMS256.txt" | awk -v a="$ASSET" '$2==a{print $1}')"
  [ -n "$SHA" ] || { echo "[fail] no SHA in SHASUMS for $ASSET"; exit 1; }
  echo "$SHA  $ASSET" | sha256sum -c - || { echo "[fail] SHA256 mismatch for $ASSET"; exit 1; }
  rm -rf "$DEST"; mkdir -p "$(dirname "$DEST")"
  tar -xJf "$ASSET" -C "$(dirname "$DEST")"
  export PATH="$DEST/bin:$PATH"
  grep -q "$DEST/bin" ~/.profile 2>/dev/null || echo "export PATH=\"$DEST/bin:\$PATH\"" >> ~/.profile
  [ "$(node --version)" = "v$NODE_WANT" ] || { echo "[fail] node is $(node --version)"; exit 1; }
  echo "[ok] node installed: $(node --version)"
fi
export PATH="$DEST/bin:$PATH"

echo "==> pnpm $PNPM_VERSION via corepack"
corepack enable || $SUDO corepack enable
if [ "$(pnpm --version 2>/dev/null || true)" = "$PNPM_VERSION" ]; then
  echo "[ok] pnpm already at pin: $(pnpm --version)"
else
  corepack prepare "pnpm@$PNPM_VERSION" --activate
  [ "$(pnpm --version)" = "$PNPM_VERSION" ] || { echo "[fail] pnpm is $(pnpm --version)"; exit 1; }
  echo "[ok] pnpm activated: $(pnpm --version)"
fi

echo "==> Rust $RUST_VERSION via rustup"
export PATH="$HOME/.cargo/bin:$PATH"
if ! have rustup; then
  curl -fsSL --max-time 300 https://sh.rustup.rs -o /tmp/rustup-init.sh
  sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain none
fi
if ! rustup toolchain list | grep -q "$RUST_VERSION"; then
  rustup toolchain install "$RUST_VERSION" --profile minimal
else echo "[ok] toolchain $RUST_VERSION already installed"; fi
if ! rustup show active-toolchain 2>/dev/null | grep -q "$RUST_VERSION"; then
  rustup default "$RUST_VERSION"
else echo "[ok] default toolchain already $RUST_VERSION"; fi
rustc --version | grep -q "$RUST_VERSION" || { echo "[fail] rustc mismatch: $(rustc --version)"; exit 1; }
echo "[ok] $(rustc --version) | $(cargo --version)"

echo "==> Summary"
git --version; node --version; pnpm --version; rustc --version; cargo --version

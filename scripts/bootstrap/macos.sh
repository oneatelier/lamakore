#!/usr/bin/env bash
# P001 — macOS toolchain bootstrap (idempotent).
# Installs: Git (via Xcode CLT) -> Node 24 LTS (pkg, SHA-verified) ->
# corepack pnpm@12.22.0 -> rustup + Rust 1.100.0 -> Xcode Command Line Tools.
# Re-running skips every satisfied pin. No Homebrew dependency by design
# (CLT git + direct Node pkg keep this hermetic); no webkit2gtk (Electron app).
set -euo pipefail

RUST_VERSION="${RUST_VERSION:-1.100.0}"
PNPM_VERSION="${PNPM_VERSION:-12.22.0}"
NODE_FALLBACK="24.22.3"

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

echo "==> Xcode Command Line Tools"
if xcode-select -p >/dev/null 2>&1; then
  echo "[ok] CLT present: $(xcode-select -p)"
else
  echo "[install] requesting CLT (follow the GUI prompt, then re-run)…"
  xcode-select --install || true
  echo "[blocked] CLT install is interactive; re-run this script after it finishes."
  exit 1
fi

if have git; then echo "[ok] git: $(git --version)"; else
  echo "[blocked] git should ship with the CLT; check 'xcode-select -p' and PATH."; exit 1
fi

NODE_WANT="$(resolve_node24)"
echo "==> Node 24 LTS (want v$NODE_WANT)"
if have node && [ "$(node --version)" = "v$NODE_WANT" ]; then
  echo "[ok] node already at pin: $(node --version)"
else
  ASSET="node-v$NODE_WANT.pkg"
  cd /tmp
  curl -fsSLO --max-time 600 "https://nodejs.org/download/release/v$NODE_WANT/$ASSET"
  SHA="$(curl -fsSL --max-time 60 "https://nodejs.org/download/release/v$NODE_WANT/SHASUMS256.txt" | awk -v a="$ASSET" '$2==a{print $1}')"
  [ -n "$SHA" ] || { echo "[fail] no SHA in SHASUMS for $ASSET"; exit 1; }
  echo "$SHA  $ASSET" | shasum -a 256 -c - || { echo "[fail] SHA256 mismatch for $ASSET"; exit 1; }
  sudo installer -pkg "$ASSET" -target /
  [ "$(node --version)" = "v$NODE_WANT" ] || { echo "[fail] node is $(node --version), want v$NODE_WANT"; exit 1; }
  echo "[ok] node installed: $(node --version)"
fi

echo "==> pnpm $PNPM_VERSION via corepack"
corepack enable
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
  # sh.rustup.rs is a redirector; integrity comes from rustup's self-update channel (recorded as managed-by:rustup).
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

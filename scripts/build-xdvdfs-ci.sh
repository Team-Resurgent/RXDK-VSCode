#!/usr/bin/env bash
# CI: build xdvdfs for all VSIX RIDs on macos-latest (native mac + Zig cross for win/linux).
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
xdvdfs_root="$repo_root/external/xdvdfs"
publish_root="$xdvdfs_root/out/publish"

if [[ ! -d "$xdvdfs_root" ]]; then
  echo "xdvdfs submodule missing at $xdvdfs_root" >&2
  echo "Run: git submodule update --init external/xdvdfs" >&2
  exit 1
fi

if ! command -v zig >/dev/null 2>&1; then
  echo "Zig is required for win/linux xdvdfs cross builds on macOS CI." >&2
  exit 1
fi

echo "=== xdvdfs CI (antangelo/xdvdfs) ==="
echo "Using zig: $(command -v zig)"
cd "$xdvdfs_root"

rustup target add \
  x86_64-apple-darwin \
  aarch64-apple-darwin \
  x86_64-unknown-linux-musl \
  x86_64-pc-windows-msvc

if ! cargo zigbuild --version >/dev/null 2>&1; then
  echo "Installing cargo-zigbuild..."
  cargo install cargo-zigbuild --locked
fi

stage() {
  local rid="$1"
  local target="$2"
  local ext="$3"
  local artifact="target/${target}/release/xdvdfs${ext}"
  local dest_dir="${publish_root}/${rid}"
  local dest="${dest_dir}/xdvdfs${ext}"

  if [[ ! -f "$artifact" ]]; then
    echo "Missing build output: $artifact" >&2
    exit 1
  fi
  mkdir -p "$dest_dir"
  cp -f "$artifact" "$dest"
  chmod +x "$dest"
  echo "OK: $dest"
}

echo "Building xdvdfs for osx-arm64 (aarch64-apple-darwin)..."
cargo build -p xdvdfs-cli --release --target aarch64-apple-darwin
stage osx-arm64 aarch64-apple-darwin ""

echo "Building xdvdfs for osx-x64 (x86_64-apple-darwin)..."
cargo build -p xdvdfs-cli --release --target x86_64-apple-darwin
stage osx-x64 x86_64-apple-darwin ""

echo "Building xdvdfs for linux-x64 (x86_64-unknown-linux-musl via cargo-zigbuild)..."
cargo zigbuild -p xdvdfs-cli --release --target x86_64-unknown-linux-musl
stage linux-x64 x86_64-unknown-linux-musl ""

echo "Building xdvdfs for win-x64 (x86_64-pc-windows-msvc via cargo-zigbuild)..."
cargo zigbuild -p xdvdfs-cli --release --target x86_64-pc-windows-msvc
stage win-x64 x86_64-pc-windows-msvc ".exe"

echo "OK: xdvdfs built for all RIDs under $publish_root"

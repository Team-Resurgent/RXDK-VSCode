#!/usr/bin/env bash
# Build xdvdfs for osx-x64 and osx-arm64 on a macOS runner (Xcode SDK, no Zig).
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
xdvdfs_root="$repo_root/external/xdvdfs"
publish_root="$xdvdfs_root/out/publish"

if [[ ! -d "$xdvdfs_root" ]]; then
  echo "xdvdfs submodule missing at $xdvdfs_root" >&2
  echo "Run: git submodule update --init external/xdvdfs" >&2
  exit 1
fi

echo "=== xdvdfs macOS (antangelo/xdvdfs) ==="
cd "$xdvdfs_root"

rustup target add x86_64-apple-darwin aarch64-apple-darwin

echo "Building xdvdfs for osx-arm64 (aarch64-apple-darwin)..."
cargo build -p xdvdfs-cli --release --target aarch64-apple-darwin

echo "Building xdvdfs for osx-x64 (x86_64-apple-darwin)..."
cargo build -p xdvdfs-cli --release --target x86_64-apple-darwin

mkdir -p "$publish_root/osx-arm64" "$publish_root/osx-x64"
cp -f target/aarch64-apple-darwin/release/xdvdfs "$publish_root/osx-arm64/xdvdfs"
cp -f target/x86_64-apple-darwin/release/xdvdfs "$publish_root/osx-x64/xdvdfs"
chmod +x "$publish_root/osx-arm64/xdvdfs" "$publish_root/osx-x64/xdvdfs"

echo "OK: $publish_root/osx-arm64/xdvdfs"
echo "OK: $publish_root/osx-x64/xdvdfs"

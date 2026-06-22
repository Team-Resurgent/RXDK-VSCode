#!/usr/bin/env bash
# Install rxdk-vscode VSIX into VS Code and/or Cursor (macOS / Linux / Windows Git Bash).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$script_dir/.." && pwd)"

target="auto"
build=0
force=0
vsix=""

usage() {
    echo "Usage: $0 [-Build] [-Force] [-Target auto|vscode|cursor|both] [-VsixPath path/to.vsix]"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -Build) build=1 ;;
        -Force) force=1 ;;
        -Target) target="${2:?}"; shift ;;
        -VsixPath) vsix="${2:?}"; shift ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
    shift
done

args=(-Target "$target")
if [[ "$build" -eq 1 ]]; then args+=(-Build); fi
if [[ "$force" -eq 1 ]]; then args+=(-Force); fi
if [[ -n "$vsix" ]]; then args+=(-VsixPath "$vsix"); fi

if command -v pwsh >/dev/null 2>&1; then
    pwsh -NoProfile -ExecutionPolicy Bypass -File "$script_dir/install-extension.ps1" -ExtensionRoot "$root" "${args[@]}"
elif command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -ExecutionPolicy Bypass -File "$script_dir/install-extension.ps1" -ExtensionRoot "$root" "${args[@]}"
else
    echo "PowerShell is required. Install PowerShell 7+ or use VS Code/Cursor: Install from VSIX..." >&2
    exit 1
fi

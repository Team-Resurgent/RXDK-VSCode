#!/usr/bin/env bash
# Install rxdk-vscode VSIX into VS Code and/or Cursor (macOS / Linux / Git Bash).
# Does not require PowerShell except for -Build (repo dev: build VSIX first).
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$script_dir"
if ! compgen -G "$root/rxdk-vscode-"*.vsix >/dev/null; then
  root="$(cd "$script_dir/.." && pwd)"
fi

target="auto"
build=0
force=0
vsix=""

usage() {
  echo "Usage: $0 [-Build] [-Force] [-Target auto|vscode|cursor|both] [-VsixPath path/to.vsix]"
  echo "  Installs using the code/cursor CLI (PowerShell not required unless -Build)."
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -Build) build=1 ;;
    -Force) force=1 ;;
    -Target) target="${2:?}"; shift ;;
    -VsixPath) vsix="${2:?}"; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
  shift
done

resolve_vsix() {
  if [[ -n "$vsix" ]]; then
    if [[ ! -f "$vsix" ]]; then
      echo "VSIX not found: $vsix" >&2
      exit 1
    fi
    printf '%s\n' "$(cd "$(dirname "$vsix")" && pwd)/$(basename "$vsix")"
    return 0
  fi
  local matches=()
  shopt -s nullglob
  matches=("$root"/rxdk-vscode-*.vsix)
  shopt -u nullglob
  if [[ ${#matches[@]} -eq 0 ]]; then
    echo "No rxdk-vscode-*.vsix in $root" >&2
    echo "Download the release zip or run from a repo after: ./scripts/build-vsix.ps1" >&2
    exit 1
  fi
  local newest="${matches[0]}"
  for f in "${matches[@]}"; do
    if [[ "$f" -nt "$newest" ]]; then
      newest="$f"
    fi
  done
  printf '%s\n' "$newest"
}

find_vscode_cli() {
  local candidates=(
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
    "/usr/local/bin/code"
    "/usr/bin/code"
  )
  local p
  for p in "${candidates[@]}"; do
    if [[ -x "$p" ]]; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  if command -v code >/dev/null 2>&1; then
    command -v code
    return 0
  fi
  return 1
}

find_cursor_cli() {
  local candidates=(
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
    "/usr/local/bin/cursor"
    "/usr/bin/cursor"
  )
  local p
  for p in "${candidates[@]}"; do
    if [[ -x "$p" ]]; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  if command -v cursor >/dev/null 2>&1; then
    command -v cursor
    return 0
  fi
  return 1
}

install_with_cli() {
  local id="$1"
  local cli="$2"
  local package="$3"
  local -a args=(--install-extension "$package")
  if [[ "$force" -eq 1 ]]; then
    args+=(--force)
  fi
  echo "=== Installing into $id ==="
  echo "CLI:  $cli"
  echo "VSIX: $package"
  NODE_OPTIONS='--no-deprecation' "$cli" "${args[@]}"
  echo "OK: $id"
}

run_build_via_powershell() {
  local ps1="$script_dir/install-extension.ps1"
  local -a args=(-ExtensionRoot "$root" -Target "$target")
  if [[ "$force" -eq 1 ]]; then args+=(-Force); fi
  if [[ -n "$vsix" ]]; then args+=(-VsixPath "$vsix"); fi
  args+=(-Build)

  if command -v pwsh >/dev/null 2>&1; then
    pwsh -NoProfile -ExecutionPolicy Bypass -File "$ps1" "${args[@]}"
  elif command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -ExecutionPolicy Bypass -File "$ps1" "${args[@]}"
  else
    echo "-Build requires PowerShell (install PowerShell 7+ or build the VSIX on Windows)." >&2
    exit 1
  fi
}

if [[ "$build" -eq 1 ]]; then
  run_build_via_powershell
  exit 0
fi

case "$target" in
  auto|both) want_vscode=1; want_cursor=1 ;;
  vscode) want_vscode=1; want_cursor=0 ;;
  cursor) want_vscode=0; want_cursor=1 ;;
  *) echo "Invalid -Target: $target" >&2; usage ;;
esac

package="$(resolve_vsix)"
vscode_cli=""
cursor_cli=""
installed=0

if [[ "$want_vscode" -eq 1 ]]; then
  if vscode_cli="$(find_vscode_cli)"; then
    install_with_cli vscode "$vscode_cli" "$package"
    installed=$((installed + 1))
  fi
fi

if [[ "$want_cursor" -eq 1 ]]; then
  if cursor_cli="$(find_cursor_cli)"; then
    if [[ -n "$vscode_cli" && "$cursor_cli" == "$vscode_cli" ]]; then
      echo "Skipping cursor (same CLI as vscode): $cursor_cli"
    else
      install_with_cli cursor "$cursor_cli" "$package"
      installed=$((installed + 1))
    fi
  fi
fi

if [[ "$installed" -eq 0 ]]; then
  echo "No VS Code or Cursor CLI found." >&2
  echo "Install VS Code or Cursor and ensure 'code' or 'cursor' is on PATH," >&2
  echo "or use the editor UI: Extensions -> ... -> Install from VSIX..." >&2
  exit 1
fi

echo ""
echo "Installed. Reload the editor window (Developer: Reload Window)."

# Bundle rxdk-vscode-*.vsix with cross-platform install scripts for GitHub Releases.
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [string]$VsixPath = ''
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)

function Resolve-VsixFile {
    param([string]$Root, [string]$Explicit)
    if ($Explicit) {
        $full = [IO.Path]::GetFullPath($Explicit)
        if (-not (Test-Path -LiteralPath $full)) {
            throw "VSIX not found: $full"
        }
        return Get-Item -LiteralPath $full
    }
    $vsix = Get-ChildItem -LiteralPath $Root -Filter 'rxdk-vscode-*.vsix' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $vsix) {
        throw "No rxdk-vscode-*.vsix in $Root. Run scripts/build-vsix.ps1 first."
    }
    return $vsix
}

function Get-VersionFromVsixName([string]$Name) {
    if ($Name -match '^rxdk-vscode-(.+)\.vsix$') {
        return $Matches[1]
    }
    throw "Unexpected VSIX name: $Name"
}

$vsix = Resolve-VsixFile -Root $ExtensionRoot -Explicit $VsixPath
$version = Get-VersionFromVsixName $vsix.Name
$releaseDir = Join-Path $ExtensionRoot 'release'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$zipName = "rxdk-vscode-$version.zip"
$zipPath = Join-Path $releaseDir $zipName

$stageRoot = Join-Path ([IO.Path]::GetTempPath()) "rxdk-release-$([Guid]::NewGuid().ToString('n'))"
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null
try {
    Copy-Item -LiteralPath $vsix.FullName -Destination (Join-Path $stageRoot $vsix.Name) -Force

    $installPs1 = Join-Path $PSScriptRoot 'install-extension.ps1'
    $installSh = Join-Path $PSScriptRoot 'install-extension.sh'
    $installCmd = Join-Path $ExtensionRoot 'install-extension.cmd'
    foreach ($src in @($installPs1, $installSh, $installCmd)) {
        if (-not (Test-Path -LiteralPath $src)) {
            throw "Missing install script: $src"
        }
        Copy-Item -LiteralPath $src -Destination (Join-Path $stageRoot (Split-Path -Leaf $src)) -Force
    }

    $readme = @"
RXDK VS Code / Cursor extension v$version
=========================================

Contents:
  $($vsix.Name)              Extension package
  install-extension.cmd      Windows installer (double-click or cmd)
  install-extension.ps1      Windows / cross-platform (PowerShell)
  install-extension.sh       macOS / Linux (bash; uses code/cursor CLI, no PowerShell)

Quick install
-------------

Windows (VS Code and/or Cursor):
  install-extension.cmd
  or: powershell -ExecutionPolicy Bypass -File .\install-extension.ps1

macOS / Linux:
  chmod +x install-extension.sh
  ./install-extension.sh

  Uses the code/cursor CLI only (PowerShell not required).
  -Build (repo dev) still requires PowerShell 7+ to run build-vsix.ps1.

Options:
  -Target vscode|cursor|both   default: install into every editor found
  -Force                       reinstall if already installed

Manual install:
  VS Code / Cursor -> Extensions -> ... -> Install from VSIX... -> select $($vsix.Name)

After install:
  Reload the editor window (Developer: Reload Window).

Notes:
  - Xbox headers/libs clone from RXDK-SDK on first launch.
  - .NET 8 runtime is installed automatically when missing (deploy/debug tools).
  - Compiling Xbox titles uses Zig (installed by RXDK prerequisites) on Windows, macOS, and Linux.
"@
    Set-Content -LiteralPath (Join-Path $stageRoot 'README-INSTALL.txt') -Value $readme -Encoding UTF8

    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    $archivePaths = @(Get-ChildItem -LiteralPath $stageRoot -File | ForEach-Object { $_.FullName })
    if ($archivePaths.Count -eq 0) {
        throw "No files staged under $stageRoot"
    }
    Compress-Archive -Path $archivePaths -DestinationPath $zipPath -CompressionLevel Optimal

    $sizeMb = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 2)
    Write-Host "OK: $zipPath ($sizeMb MB)" -ForegroundColor Green
    Write-Host "  $($vsix.Name)" -ForegroundColor Green
    Write-Host '  install-extension.cmd / .ps1 / .sh' -ForegroundColor Green
    Write-Host '  README-INSTALL.txt' -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $stageRoot) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

exit 0

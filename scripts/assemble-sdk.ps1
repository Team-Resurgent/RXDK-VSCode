# Assemble sdk/ for the extension: a VERSION.txt marker only.
#
# The title build/deploy/run pipeline itself is no longer PowerShell -- it's
# plain compiled JS (dist/extension/cli.js, invoked directly by generated
# tasks.json; see src/cli.ts) shipped alongside the rest of the extension's own
# `npm run compile` output, so there is nothing under scripts/sdk/ left to stage
# here (the folder was removed entirely as part of the PowerShell-to-TS
# migration). Host tools (imagebld, xdvdfs, xbcp, xbox-launch, xboxdbg-bridge,
# xbwatson) are downloaded per-platform at runtime via the host-tools
# prerequisite (src/hostTools.ts) into …/RXDK/tools; headers/libs are cloned
# from RXDK-SDK on extension activate. The -CrossPlatformTools / -WindowsOnly
# switches are accepted for pipeline compatibility but no longer stage anything.
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$CrossPlatformTools,
    [switch]$WindowsOnly,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)
$sdkRoot = Join-Path $ExtensionRoot 'sdk'

# Clean any previously-staged include/lib/tools/scripts (all runtime-provided,
# or removed entirely, now).
foreach ($stale in @('include', 'lib', 'tools', 'scripts')) {
    $stalePath = Join-Path $sdkRoot $stale
    if (Test-Path -LiteralPath $stalePath) {
        Remove-Item -LiteralPath $stalePath -Recurse -Force
    }
}
New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null

@"
rxdk-sdk=cloned-on-activate
tools=runtime-prerequisite
pipeline=dist/extension/cli.js
staged=$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
"@ | Set-Content -LiteralPath (Join-Path $sdkRoot 'VERSION.txt') -Encoding ASCII

Write-Host "OK: assembled sdk/ (VERSION.txt only; pipeline is dist/extension/cli.js, tools via runtime prerequisite, include/lib from RXDK-SDK clone on activate)" -ForegroundColor Green

# Explicit success code: this script runs no external command that would set
# $LASTEXITCODE, and sync-all.ps1 checks it after invoking us.
exit 0

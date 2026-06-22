# Build a cross-platform RXDK VSIX (Windows host tools for all RIDs + bundled SDK).
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$Build,
    [switch]$SkipToolsBuild,
    [switch]$Install
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)

$syncArgs = @{
    ExtensionRoot      = $ExtensionRoot
    Package            = $true
    CrossPlatformTools = $true
}
if ($Build) {
    $syncArgs['Build'] = $true
}
if (-not $SkipToolsBuild) {
    $syncArgs['BuildTools'] = $true
}
if ($Install) {
    $syncArgs['InstallExtension'] = $true
}

Write-Host '=== RXDK VSIX build (cross-platform tools) ===' -ForegroundColor Cyan
& (Join-Path $ExtensionRoot 'scripts\sync-all.ps1') @syncArgs

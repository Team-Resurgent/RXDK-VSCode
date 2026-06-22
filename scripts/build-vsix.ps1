# Build a cross-platform RXDK VSIX (host tools + SDK scripts; headers/libs from RXDK-SDK clone on activate).
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$SkipToolsBuild,
    [switch]$Install,
    [switch]$SkipXdvdfsBuild
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)

$syncArgs = @{
    ExtensionRoot      = $ExtensionRoot
    Package            = $true
    CrossPlatformTools = $true
}
if (-not $SkipToolsBuild) {
    $syncArgs['BuildTools'] = $true
}
if ($SkipXdvdfsBuild) {
    $syncArgs['SkipXdvdfsBuild'] = $true
}
if ($Install) {
    $syncArgs['InstallExtension'] = $true
}

Write-Host '=== RXDK VSIX build (cross-platform tools) ===' -ForegroundColor Cyan
& (Join-Path $ExtensionRoot 'scripts\sync-all.ps1') @syncArgs

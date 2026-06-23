# Build a cross-platform RXDK VSIX (host tools + SDK scripts; headers/libs from RXDK-SDK clone on activate).
param(
    [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..'),
    [switch]$SkipToolsBuild,
    [switch]$Install,
    [switch]$WindowsOnly
)
$ErrorActionPreference = 'Stop'
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)

$syncArgs = @{
    ExtensionRoot = $ExtensionRoot
    Package         = $true
}
if (-not $WindowsOnly) {
    $syncArgs['CrossPlatformTools'] = $true
} else {
    $syncArgs['WindowsOnly'] = $true
}
if (-not $SkipToolsBuild) {
    $syncArgs['BuildTools'] = $true
}
if ($Install) {
    $syncArgs['InstallExtension'] = $true
}

$label = if ($WindowsOnly) { 'Windows-only tools' } else { 'cross-platform tools' }
Write-Host "=== RXDK VSIX build ($label) ===" -ForegroundColor Cyan
& (Join-Path $ExtensionRoot 'scripts\sync-all.ps1') @syncArgs
